"""Bind declared internal geometry to new image jobs, preserving old prompts."""
import json
from pathlib import Path

from .evaluate import read, digest
from .experimental_executor import verified

KIND='ui_generation_layout_binding_v1'
POLICY='declared-internal-structure-v1'
REFERENCE_STRUCTURE='reference-owned-structure-v2'
REFERENCE_EDIT='reference-owned-structure-edit-v3'
FILE='generation-layout.json'


def checked(snapshot, path, requests):
    from . import host_layout_registration as layout
    from .layout_registration_revision import _box
    snapshot=Path(snapshot);path=Path(path);value=verified(path)
    if value.get('kind')!=layout.KIND or value.get('policy')!=layout.POLICY:
        raise ValueError('GENERATION_LAYOUT_CONTRACT_REQUIRED')
    visual_name='evidence/revised-visual-plan.json'
    if not (snapshot/visual_name).exists():visual_name='evidence/m1-draft.json'
    names=('reference.png','placements.json',visual_name)
    if value.get('planningBindings')!={name:digest(snapshot/name) for name in names}:
        raise ValueError('GENERATION_LAYOUT_PLANNING_CHANGED')
    contract={key:value[key] for key in ('kind','referenceSha256','constraints','knownDifferences')}
    contract['materials']=[{k:v for k,v in row.items() if k!='targetBox'} for row in value['materials']]
    layout.validate_contract(contract,digest(snapshot/'reference.png'),value.get('internalTargetsPolicy'))
    placements={row['id']:row['sourceRegion'] for row in read(snapshot/'placements.json')['materials']}
    owned={row['id']:row['role'] for row in read(snapshot/visual_name)['materials']}
    for row in value['materials']:
        key=row['materialId'];target=row['targetBox'];_box(target)
        if owned.get(key)!='foreground' or placements.get(key)!=target:
            raise ValueError('GENERATION_LAYOUT_TARGET_CHANGED')
        if any(not target[1]+3<y<target[3]-3 for y in row.get('horizontalDividerTargets',[])):
            raise ValueError('GENERATION_LAYOUT_DIVIDER_OUTSIDE_TARGET')
        if any(not target[1]+3<y<target[3]-3 for band in row.get('horizontalBandTargets',[]) for y in band):
            raise ValueError('GENERATION_LAYOUT_BAND_OUTSIDE_TARGET')
    selected={mid for row in requests for mid in row.get('materialIds',[row['asset']])}
    ids=sorted(row['materialId'] for row in value['materials']
               if row['materialId'] in selected and (row.get('horizontalDividerTargets') or row.get('horizontalBandTargets')))
    return value,dict(kind=KIND,policy=POLICY,sha256=digest(path),
                      referenceSha256=value['referenceSha256'],materialIds=ids)


def materialize(snapshot, path, output, requests, *, reference_structure=False, edit_only=False):
    value,binding=checked(snapshot,path,requests)
    if not binding['materialIds']:return None
    target=Path(output)/FILE
    target.write_bytes(Path(path).read_bytes())
    if digest(target)!=binding['sha256']:raise ValueError('GENERATION_LAYOUT_CHANGED')
    if edit_only:binding['promptPolicy']=REFERENCE_EDIT
    elif reference_structure:binding['promptPolicy']=REFERENCE_STRUCTURE
    return binding


def verify(job, config, requests):
    binding=config['layoutGeneration']
    _,expected=checked(Path(job)/'snapshot',Path(job)/FILE,requests)
    if 'promptPolicy' in binding:
        if (binding['promptPolicy'] not in (REFERENCE_STRUCTURE,REFERENCE_EDIT) or
                (binding['promptPolicy']==REFERENCE_STRUCTURE and ('cleanup' in config or config.get('cleanupRequired')))):
            raise ValueError('GENERATION_LAYOUT_PROMPT_POLICY')
        expected['promptPolicy']=binding['promptPolicy']
    if binding!=expected or not binding['materialIds']:
        raise ValueError('GENERATION_LAYOUT_BINDING_CHANGED')
    return verified(Path(job)/FILE)


def guidance(job, config, row):
    value=verify(job,config,[r for r in read(Path(job)/'snapshot/requests.json')['requests']
                             if r['asset'] in config['assets']])
    snapshot=Path(job)/'snapshot';visual_path=snapshot/'evidence/revised-visual-plan.json'
    if not visual_path.exists():visual_path=snapshot/'evidence/m1-draft.json'
    visual=read(visual_path)
    from PIL import Image
    with Image.open(snapshot/'reference.png') as image:width,height=image.size
    ids=row.get('materialIds',[row['asset']]);lines=[]
    reconstruct=config['layoutGeneration'].get('promptPolicy')==REFERENCE_STRUCTURE
    edit_only=config['layoutGeneration'].get('promptPolicy')==REFERENCE_EDIT
    for declaration in value['materials']:
        key=declaration['materialId'];targets=declaration.get('horizontalDividerTargets',[])
        bands=declaration.get('horizontalBandTargets',[])
        if key not in ids or not (targets or bands):continue
        left,top,right,bottom=declaration['targetBox']
        if edit_only:
            lines.append('REFERENCE EDIT for material '+key+': keep the original owned subject, silhouette, '
                'borders, corners, colors, section bands and surface gaps. Remove DELETE units and ordinary '
                'text; keep all other owned elements fixed. Preserve owned region proportions '+
                str(right-left)+':'+str(bottom-top)+' before transparent padding.')
        if reconstruct:
            lines.append('REFERENCE STRUCTURE RECONSTRUCTION for material '+key+
                ': reconstruct its complete owned visible structure from the attached original reference '
                'pixels only. The original reference is the sole geometry and appearance target. '
                'Match the owned silhouette, border weight, corners, colors, section bands and intervening '
                'surface gaps, including any narrow strip between the outer border and the first band. '
                'Do not replace those gaps with an expanded section band. Preserve the owned region '
                'proportions '+str(right-left)+':'+str(bottom-top)+
                ' before transparent padding; neighboring UI in a context crop does not enlarge this region. '
                'Reconstruct only existing owned surface behind DELETE overlays. Keep DELETE units absent, '
                'ordinary text space empty, and the frozen cell layout and uniform scale unchanged.')
        if targets:
            positions=[round((y-top)/(bottom-top),8) for y in targets]
            lines.append('Material '+key+' (cell '+str(ids.index(key))+'): keep exactly '+str(len(targets))+
                ' independent thin horizontal divider lines, in top-to-bottom order at withinMaterial Y '+
                json.dumps(positions,separators=(',',':'))+'. Original reference Y pixels '+
                json.dumps(targets,separators=(',',':'))+'; ownership region '+
                json.dumps([left,top,right,bottom],separators=(',',':'))+'.')
        if bands:
            positions=[[round((y-top)/(bottom-top),8) for y in band] for band in bands]
            lines.append('Material '+key+': preserve full-width section bands at original Y half-open ranges '+
                json.dumps(bands,separators=(',',':'))+'; withinMaterial Y ranges '+
                json.dumps(positions,separators=(',',':'))+'. Both edges are required. Preserve the intervening '
                'light surface strips, including any visible strip below separately assigned tabs. '
                'Do not expand a band into those strips or treat a band edge as a divider.')
        parts=[]
        for obj in visual['objects']:
            box=obj.get('bboxNorm')
            if obj['materialId']!=key or box is None:continue
            local=[round((box[0]*width-left)/(right-left),8),round((box[1]*height-top)/(bottom-top),8),
                   round((box[2]*width-left)/(right-left),8),round((box[3]*height-top)/(bottom-top),8)]
            parts.append(dict(objectId=obj['id'],withinMaterialBox=local))
        if parts:lines.append('Preserve these reviewed owned element locators: '+json.dumps(parts,separators=(',',':'))+'.')
    if not lines:return ''
    if edit_only:
        return ('\nDECLARED INTERNAL STRUCTURE (reference locators for preservation):\n'+'\n'.join(lines)+
            '\nY fractions are within the original owned region before transparent padding. Keep the '
            'original lines, bands and intervening gaps at their reference spacing. Band boundaries and '
            'the outer border are distinct from divider lines. DELETE ownership still takes priority.\n')
    return ('\nDECLARED INTERNAL STRUCTURE (reviewed geometry, part of the owned material):\n'+
        '\n'.join(lines)+'\nThese Y fractions are measured from the top of the owned region before '
        'transparent padding, not from the output canvas. Preserve the reference spacing and every '
        'owned section band, including the surface gaps between dividers and bands. Band boundaries '
        'and the outer border do not count as divider lines. Do not merge, omit, duplicate or evenly '
        'redistribute the lines. For an edit, correct misplaced lines and restore missing declared '
        'lines using the reference; these reviewed targets override the generated divider offsets. '
        'Keep unrelated owned artwork fixed. These declarations do not '
        'restore foreign controls or text; the ownership DELETE list still takes priority.\n')
