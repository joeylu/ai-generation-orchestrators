"""Deterministic generation grouping; delivery material identities never merge."""
import hashlib
import json
import math

from .short_prompt import FOREGROUND_FIDELITY, TEXT_REMOVAL_LAYOUT, LOCAL_LAYOUT, OWNERSHIP_SCOPE, object_content, exclusions


def family(visual, asset):
    objects=[o for o in visual['objects'] if o['materialId']==asset['id']]
    if asset['role']=='background' or any(o['kind'] in ('panel','unknown','logo') for o in objects):
        return None
    for kind in ('button','card','illustration','icon','badge','decoration'):
        matches=[o for o in objects if o['kind']==kind]
        if matches:
            return kind if len(matches)==1 else None
    return None


GROUP_POLICIES={'compatible-size-and-kind-grid-v1':1.5,
                'compatible-size-and-kind-grid-v2':1.2}
DEFAULT_GROUP_POLICY='compatible-size-and-kind-grid-v1'


def compatible(left, right, max_aspect):
    w,h=left['output_size'];ww,hh=right['output_size']
    # Keep historical and experimental grouping policies reconstructible from
    # their frozen snapshots. Grouping alone does not prove generated geometry.
    return max(w/ww,ww/w,h/hh,hh/h)<=2 and max((w/h)/(ww/hh),(ww/hh)/(w/h))<=max_aspect


def build_groups(visual, plan, policy=DEFAULT_GROUP_POLICY):
    if policy not in GROUP_POLICIES:raise ValueError('UNKNOWN_GROUP_POLICY')
    max_aspect=GROUP_POLICIES[policy]
    pending=list(plan['assets']);groups=[];known={a['id'] for a in pending}
    while pending:
        first=pending.pop(0);members=[first];kind=family(visual,first)
        if kind:
            for other in list(pending):
                if len(members)==6:break
                if family(visual,other)==kind and all(compatible(a,other,max_aspect) for a in members):
                    members.append(other);pending.remove(other)
        ids=[a['id'] for a in members]
        if len(ids)==1:
            groups.append(dict(id=ids[0],mode='single',materialIds=ids))
            continue
        key='sheet-'+hashlib.sha256('\n'.join(ids).encode()).hexdigest()[:16]
        if key in known:raise ValueError('GENERATION_GROUP_ID_COLLISION')
        ratio=first['output_size'][0]/first['output_size'][1]
        columns=1 if ratio>2 else len(ids) if ratio<.5 else math.ceil(math.sqrt(len(ids)))
        rows=math.ceil(len(ids)/columns)
        w=max(a['output_size'][0] for a in members)*columns*1.4
        h=max(a['output_size'][1] for a in members)*rows*1.4
        scale=1536/max(w,h)
        canvas=[max(64,round(w*scale/8)*8),max(64,round(h*scale/8)*8)]
        groups.append(dict(id=key,mode='sheet',materialIds=ids,grid=[columns,rows],outputSize=canvas))
    return dict(kind='ui_generation_groups_v1',policy=policy,
                materialCount=len(plan['assets']),plannedCalls=len(groups),groups=groups)


def sheet_prompt(visual, plan, group, *, legacy_without_attached_props=False):
    materials={m['id']:m for m in visual['materials']};assets={a['id']:a for a in plan['assets']}
    entries=[];foreign={};foreign_keys={}
    for i,key in enumerate(group['materialIds']):
        m=materials[key];w,h=assets[key]['output_size']
        excluded=[]
        for item in exclusions(visual,m):
            signature=json.dumps(item,sort_keys=True,ensure_ascii=False)
            if signature not in foreign_keys:
                ref='foreign-'+str(len(foreign));foreign_keys[signature]=ref;foreign[ref]=item
            excluded.append(foreign_keys[signature])
        entries.append(dict(cellIndex=i,materialId=key,artwork=m['label'],referenceBox=m['bboxNorm'],
            referencePixelSize=[w,h],preserveText=m.get('preserveText',[]),
            retain=object_content(visual,m),excludeReferences=excluded))
    detail='integrated symbols and observed state' if legacy_without_attached_props else 'integrated symbols, small attached props and observed state'
    return ('Use the full reference image to generate ONE transparent RGBA asset sheet. '
            f'Canvas aspect {group["outputSize"][0]}:{group["outputSize"][1]}; equal-cell grid '
            f'{group["grid"][0]} columns by {group["grid"][1]} rows. '
            'Cell indices are zero-based, left to right then top to bottom. Put exactly the specified '
            'whole material in each assigned cell; leave unused cells completely transparent. '
            'Use a common uniform scale based on referencePixelSize. '+LOCAL_LAYOUT+
            'Keep at least 10% of each cell dimension fully transparent on every side. No shared backing, '
            'bridges, touching artwork across cells, labels, cell numbers or grid lines. '
            'Preserve each artwork aspect, '+detail+'. Remove only business '
            'lettering except each entry\'s exact preserveText. Exclude foreign artwork completely; '
            'do not leave placeholders. '+OWNERSHIP_SCOPE+TEXT_REMOVAL_LAYOUT+FOREGROUND_FIDELITY+
            'No program will redraw missing pixels. Foreign artwork (exclude only the references named '
            'by each entry): '+json.dumps(foreign,ensure_ascii=False)+
            '. Entries: '+json.dumps(entries,ensure_ascii=False))


def compact_sheet_prompt(visual, plan, group):
    """Bound experiment for a single sheet; keeps each material's local anchors."""
    if group['mode']!='sheet':raise ValueError('SHEET_REQUIRED')
    materials={m['id']:m for m in visual['materials']}
    assets={a['id']:a for a in plan['assets']}
    entries=[]
    for i,key in enumerate(group['materialIds']):
        m=materials[key];asset=assets[key]
        parts=[]
        for obj in visual['objects']:
            if obj['materialId']!=key:continue
            box=obj.get('bboxNorm')
            if box is None:
                parts.append(dict(kind=obj['kind'],artwork=obj['label']))
                continue
            l,t,r,b=m['bboxNorm'];ll,tt,rr,bb=box
            parts.append(dict(kind=obj['kind'],center=[round(((ll+rr)/2-l)/(r-l),4),
                round(((tt+bb)/2-t)/(b-t),4)],size=[round((rr-ll)/(r-l),4),
                round((bb-tt)/(b-t),4)]))
        entries.append(dict(cellIndex=i,materialId=key,artwork=m['label'],
            referenceBox=m['bboxNorm'],referencePixelSize=asset['output_size'],
            parts=parts,exclude=[e['material'] for e in exclusions(visual,m)],
            **({'preserveText':m['preserveText']} if m.get('preserveText') else {})))
    return ('Use the full reference to make ONE transparent RGBA sheet. Grid '
            f'{group["grid"][0]} columns by {group["grid"][1]} rows, row-major; '
            f'canvas aspect {group["outputSize"][0]}:{group["outputSize"][1]}. '
            'Put exactly one complete assigned material in each cell, with at least 10% '
            'transparent margin on every side; unused cells stay empty. No connected '
            'backing, touching cells, grid marks or labels. '
            'For each cell preserve the original outer-contour aspect and all parts as one '
            'rigid layout: one scale for x and y. The grid cell adds transparent padding; '
            'its shape must not flatten or widen the artwork. '
            'referenceBox locates the whole material. Each part center and size are fractions '
            'of that material BEFORE padding. Keep every part at that same relative '
            'center and size, including small icons. Do not enlarge an icon, move it toward the '
            'cell center or into removed lettering space. Keep item artwork at its original '
            'relative scale; do not expand it to fill blank card surface. '
            'Remove ordinary lettering and numbers except exact preserveText. Restore only the '
            'surface underneath removed glyphs. Retain owned frame details and observed state; '
            'exclude every named foreign unit completely. Reference boxes locate ownership; '
            'they are not masks and do not assign all enclosed pixels. Do not add glow, outlines '
            'or decorations. Output real alpha outside each complete contour. '
            'Entries: '+json.dumps(entries,ensure_ascii=False,separators=(',',':')))


def preview(snapshot, expected_digest, output):
    """Read an immutable snapshot and write a non-authorizable grouping preview."""
    from pathlib import Path
    from .evaluate import read, save, digest
    from .freeze_visual import inspect
    from .execution_preflight import preflight
    snapshot=Path(snapshot);output=Path(output)
    preflight(snapshot,expected_digest)
    path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(path if path.exists() else snapshot/'evidence/m1-draft.json')
    plan=read(snapshot/'execution-plan.candidate.json');groups=build_groups(visual,plan)
    output.mkdir(parents=True,exist_ok=False)
    prompts={}
    for group in groups['groups']:
        if group['mode']=='sheet':
            path=output/(group['id']+'.txt');path.write_text(sheet_prompt(visual,plan,group)+'\n',encoding='utf-8')
            prompts[path.name]=digest(path)
    inspect(snapshot,expected_digest)
    result=dict(kind='ui_generation_group_preview_v1',snapshotDigest=expected_digest,
        status='preview_only_new_run_required',materialCount=groups['materialCount'],
        plannedCalls=groups['plannedCalls'],groups=groups['groups'],promptSha256=prompts,
        generationCalls=0,humanVisualAcceptance=False)
    save(output/'grouping-preview.json',result)
    return result
