"""Frozen context references and concise prompts; no models or geometry repair."""
import hashlib
import io
import json
import math

from PIL import Image
from .evaluate import digest, read
from .short_prompt import build as full_prompt, carries_foreground, exclusions

MODE = 'context-crops'
POLICY = 'material-context-expand-v1'
GROUP_POLICY = 'compatible-size-and-kind-context-grid-v1'
PROMPT_PREFIX_V1 = 'visual-material-context-prompt-v1:\n'
PROMPT_PREFIX_V2 = 'visual-material-context-prompt-v2:\n'
PROMPT_PREFIX_V3 = 'visual-material-context-prompt-v3:\n'
PROMPT_PREFIX_V4 = 'visual-material-context-prompt-v4:\n'
PROMPT_PREFIX_V5 = 'visual-material-context-prompt-v5:\n'
PROMPT_PREFIX_V6 = 'visual-material-context-prompt-v6:\n'
PROMPT_PREFIX_V7 = 'visual-material-context-prompt-v7:\n'
PROMPT_PREFIXES = (PROMPT_PREFIX_V1, PROMPT_PREFIX_V2, PROMPT_PREFIX_V3, PROMPT_PREFIX_V4, PROMPT_PREFIX_V5, PROMPT_PREFIX_V6, PROMPT_PREFIX_V7)
# Historical callers and frozen plans used this name for v1.
PROMPT_PREFIX = PROMPT_PREFIX_V1


def validate_mode(mode):
    if mode not in ('full', MODE):raise ValueError('GENERATION_REFERENCE')
    return mode


def geometry(asset, size):
    """Expand context only. The delivery region and dimensions are never changed."""
    width,height=size;l,t,r,b=asset['source_region']
    background=asset['role']=='background'
    margin=0 if background else min(64,max(8,math.ceil(.10*min(r-l,b-t))))
    region=[0,0,width,height] if background else [max(0,l-margin),max(0,t-margin),min(width,r+margin),min(height,b+margin)]
    x,y,rr,bb=region;w,h=rr-x,bb-y
    target=[l-x,t-y,r-x,b-y]
    return dict(materialId=asset['id'],reference='reference.png' if background else
                'materials/'+asset['id']+'/context-reference.png',cropRegion=region,
                referenceSize=[w,h],targetBox=target,
                targetBoxNorm=[round(target[0]/w,8),round(target[1]/h,8),
                               round(target[2]/w,8),round(target[3]/h,8)],contextMargin=margin)


def png_bytes(image):
    buffer=io.BytesIO();image.save(buffer,format='PNG');return buffer.getvalue()


def materialize(folder, plan, picture):
    source_sha=digest(folder/'reference.png');refs=[]
    for asset in plan['assets']:
        item=geometry(asset,picture.size)
        path=folder/item['reference']
        if item['reference']!='reference.png':path.write_bytes(png_bytes(picture.crop(item['cropRegion'])))
        refs.append(dict(**item,sourceSha256=source_sha,sha256=digest(path)))
    return dict(kind='ui_generation_references_v1',mode=MODE,policy=POLICY,
                source='reference.png',sourceSha256=source_sha,sourceSize=list(picture.size),references=refs)


def request_references(document, material_ids):
    index={item['materialId']:item for item in document['references']}
    return [dict(**index[key],referenceIndex=i+1,cellIndex=i) for i,key in enumerate(material_ids)]


def verify(folder, plan, snapshot, picture):
    """Recompute all geometry, source/crop fingerprints and review target crops."""
    if 'generation-references.json' not in snapshot['files']:raise ValueError('UNBOUND_CONTEXT_REFERENCES')
    document=read(folder/'generation-references.json');source_sha=digest(folder/'reference.png');refs=[]
    for asset in plan['assets']:
        item=geometry(asset,picture.size);path=folder/item['reference']
        if item['reference'] not in snapshot['files']:raise ValueError('UNBOUND_CONTEXT_REFERENCE')
        expected_sha=(source_sha if item['reference']=='reference.png' else
                      hashlib.sha256(png_bytes(picture.crop(item['cropRegion']))).hexdigest())
        if digest(path)!=expected_sha:raise ValueError('CONTEXT_REFERENCE_MISMATCH')
        refs.append(dict(**item,sourceSha256=source_sha,sha256=expected_sha))
        # Review evidence remains the original target bbox, including sheet members.
        target='materials/'+asset['id']+'/reference-crop.png'
        if target not in snapshot['files']:raise ValueError('UNBOUND_EXECUTION_INPUT')
        with Image.open(folder/target) as image:
            expected=picture.crop(asset['source_region'])
            if image.size!=expected.size or image.convert('RGBA').tobytes()!=expected.tobytes():
                raise ValueError('CROP_REFERENCE_MISMATCH')
    expected=dict(kind='ui_generation_references_v1',mode=MODE,policy=POLICY,
                  source='reference.png',sourceSha256=source_sha,sourceSize=list(picture.size),references=refs)
    if document!=expected:raise ValueError('CONTEXT_REFERENCE_METADATA_MISMATCH')
    return document


def local_box(box, reference, size):
    """Convert original normalized coordinates into this crop's normalized space."""
    x,y,_,_=reference['cropRegion'];w,h=reference['referenceSize'];width,height=size
    l,t,r,b=box
    return [round((l*width-x)/w,8),round((t*height-y)/h,8),
            round((r*width-x)/w,8),round((b*height-y)/h,8)]


def entry(visual, material, asset, reference, size, index, *, include_exclusion_details=False):
    l,t,r,b=material['bboxNorm'];parts=[]
    for obj in visual['objects']:
        if obj['materialId']!=material['id']:continue
        part=dict(id=obj['id'],kind=obj['kind'],appearance=obj['label'])
        box=obj.get('bboxNorm')
        if box is not None:
            ll,tt,rr,bb=box
            part.update(referenceBox=local_box(box,reference,size),
                withinMaterial=[round(((ll+rr)/2-l)/(r-l),6),round(((tt+bb)/2-t)/(b-t),6),
                                round((rr-ll)/(r-l),6),round((bb-tt)/(b-t),6)])
        parts.append(part)
    # Include foreign units visible in the context rim too, without assigning them.
    x,y,rr,bb=reference['cropRegion'];width,height=size
    scope={**material,'bboxNorm':[x/width,y/height,rr/width,bb/height]}
    foreign=exclusions(visual,scope)
    removed=[dict(material=item['material'],referenceBox=local_box(item['referenceBox'],reference,size))
             for item in foreign]
    if include_exclusion_details:
        for removed_item, source in zip(removed, foreign):
            # Preserve every object description, including repeated independent instances.
            removed_item['excludeArtwork']=list(source['excludeArtwork'])
    summary={} if any(part['appearance']==material['label'] for part in parts) else {'artwork':material['label']}
    return dict(referenceIndex=index+1,cellIndex=index,materialId=material['id'],**summary,
        targetBox=reference['targetBoxNorm'],artworkPixelSize=asset['output_size'],
        preserveText=material['preserveText'],parts=parts,exclude=removed,
        surface='continuous-panel' if carries_foreground(visual,material) else 'owned-artwork')


def action_entry(visual, material, asset, reference, size, index):
    """v4 ownership actions from reviewed z order; boxes remain locators, not masks."""
    own=entry(visual,material,asset,reference,size,index)
    if own['parts']:
        own.pop('artwork',None)  # Object appearance is the keep identity.
    own['keepOnly']=own.pop('parts')
    own['zOrder']=material['zOrder']
    x,y,r,b=reference['cropRegion'];width,height=size
    foreign=[]
    for other in visual['materials']:
        if other['id']==material['id'] or other['role']=='background':continue
        ll,tt,rr,bb=other['bboxNorm']
        if max(x/width,ll)>=min(r/width,rr) or max(y/height,tt)>=min(b/height,bb):continue
        relation=('underlay' if other['zOrder']<material['zOrder'] else
                  'overlay' if other['zOrder']>material['zOrder'] else 'same-depth')
        members=[]
        for obj in visual['objects']:
            if obj['materialId']!=other['id']:continue
            item=dict(id=obj['id'],appearance=obj['label'])
            if obj.get('bboxNorm') is not None:
                item['referenceBox']=local_box(obj['bboxNorm'],reference,size)
            members.append(item)
        foreign.append(dict(materialId=other['id'],relation=relation,
                            referenceBox=local_box(other['bboxNorm'],reference,size),members=members))
    own['exclude']=foreign
    return own


def reconstruct_prompt(entries, group, *, version='v5'):
    """v5: a positive drawing task; reviewed identities and locators stay bound."""
    def parts(rows):
        result=[]
        for index,row in enumerate(rows,1):
            detail=str(index)+': '+row['appearance']
            if 'kind' in row:detail+=' ('+row['kind']+')'
            if 'referenceBox' in row:detail+=' at '+json.dumps(row['referenceBox'],separators=(',',':'))
            if 'withinMaterial' in row:detail+=' within '+json.dumps(row['withinMaterial'],separators=(',',':'))
            result.append(detail)
        return '; '.join(result)
    def foreign(entry,relation):
        rows=[]
        for item in entry['exclude']:
            if item['relation']!=relation:continue
            box=item['referenceBox']
            for member in item['members']:
                value=dict(member)
                if 'referenceBox' not in value:
                    if box[0]<=0 and box[1]<=0 and box[2]>=1 and box[3]>=1:
                        value['appearance']+=' (across reference)'
                    else:value['referenceBox']=box
                rows.append(value)
        return parts(rows)
    task='Reconstruct one complete independent owned material from this UI reference. '
    if group:
        task+=(f'Grid {group["grid"][0]}x{group["grid"][1]}, row-major, canvas '
               f'{group["outputSize"][0]}:{group["outputSize"][1]}; one material per cell, unused cells empty. '
               'Use one common uniform scale across cells. ')
    for entry in entries:
        task+=(f'Reference {entry["referenceIndex"]}, cell {entry["cellIndex"]}: owned parts: '+
               (parts(entry['keepOnly']) or entry.get('artwork',''))+'. ')
        overlays=foreign(entry,'overlay');underlays=foreign(entry,'underlay');peers=foreign(entry,'same-depth')
        if overlays:
            if version=='v6':
                task+='Remove these foreign overlays: '+overlays+'. Continue only existing owned surface actually hidden by these overlays; leave no artificial holes, recesses or ghosts. '
            else:
                task+='Continue only existing owned surface actually hidden by these overlays: '+overlays+'. Removal must leave no artificial holes, recesses or ghosts. '
        if underlays:task+='Exclude foreign underlays: '+underlays+'. '
        if peers:task+='Exclude same-depth foreign parts: '+peers+'; do not invent hidden owned art. '
        task+=('Crop '+json.dumps(entry['artworkPixelSize'],separators=(',',':'))+
               ', targetBox '+json.dumps(entry['targetBox'],separators=(',',':'))+
               '; preserveText '+json.dumps(entry['preserveText'],ensure_ascii=False,separators=(',',':'))+'. ')
    return (task+'Keep all owned parts, original state/count/contours/proportions/color/texture/ornaments and '
            'reference highlights/gradients. Keep offsets, no recentering/enlargement/redesign. '
            'Boxes=local normalized locators, not masks; within=(centerX,centerY,width,height) before padding; '
            'crop size differs from alpha bounds. Remove ordinary letters/numbers except preserveText; keep owned '
            'single-character icon pictograms. Fill glyphs with owned surface; text space empty, other parts fixed. '
            'Retain genuine owned holes/translucency, not scene. PNG: continuous alpha outside owned contours, 10% '
            'fully transparent margin each side, uniform scale, no stretch. No added UI/backing/borders/glow/bridges.')


def prompt(visual, plan, material_ids, group=None, version='v3'):
    """Compile frozen plan data once, with no LLM rewriting or extra grouping call."""
    if version not in ('v1','v2','v3','v4','v5','v6','v7'):raise ValueError('CONTEXT_PROMPT_VERSION')
    if visual.get('backgroundMode') not in ('scene-only','preserve-underlay') or visual.get('textPolicy')!='remove-business-text':
        raise ValueError('EXPLICIT_SCOPE_REQUIRED')
    materials={m['id']:m for m in visual['materials']};assets={a['id']:a for a in plan['assets']}
    if any('preserveText' not in materials[key] for key in material_ids):raise ValueError('EXPLICIT_TEXT_EXCEPTIONS_REQUIRED')
    if len(material_ids)==1 and assets[material_ids[0]]['role']=='background':
        return full_prompt(visual,material_ids[0],plan['canvas'])
    if not 1<=len(material_ids)<=4:raise ValueError('CONTEXT_REFERENCE_LIMIT')
    builder=action_entry if version in ('v4','v5','v6','v7') else entry
    entries=[builder(visual,materials[key],assets[key],geometry(assets[key],plan['canvas']),plan['canvas'],i)
             for i,key in enumerate(material_ids)]
    if version=='v7':
        from .context_short_actions import build
        short=build(visual,materials[material_ids[0]],entries,group)
        return short if short is not None else reconstruct_prompt(entries,group,version='v6')
    if version in ('v5','v6'):return reconstruct_prompt(entries,group,version=version)
    if version=='v4':
        layout=(f'Grid {group["grid"][0]}x{group["grid"][1]} row-major, canvas '
                f'{group["outputSize"][0]}:{group["outputSize"][1]}; one material per cell, unused cells empty. '
                if group else 'One complete material. ')
        scale='Use one common uniform scale across cells. ' if group else ''
        return ('Use context crops by 1-based referenceIndex. '+layout+
                'keepOnly lists owned parts; exclude lists foreign members. targetBox/referenceBox are local '
                'normalized locators, not masks; outside targetBox is context. artworkPixelSize is target '
                'crop size, not alpha bounds; withinMaterial=(centerX,centerY,width,height) before padding. '
                'Keep owned parts, observed state, count, full contours, color, texture, ornaments, original '
                'proportions and offsets at one uniform scale; do not recenter or enlarge. '+scale+
                'Underlay: remove outside owned contours, never copy backing. Overlay: remove and continue '
                'only owned surface actually behind it, without punching holes or filling true openings. '
                'Same-depth: exclude without inventing hidden owned art. Remove ordinary letters/numbers '
                'except exact preserveText; keep owned single-character icon pictograms. Clear glyphs into '
                'owned surface, leave text space empty and other parts fixed. Output PNG with continuous '
                'alpha outside owned contours and real gaps; preserve true holes and translucency, no scene. '
                'Keep 10% fully transparent margin on all sides without stretch. No new style, backing, '
                'bridges or other UI; no downstream restoration. Entries: '+
                json.dumps(entries,ensure_ascii=False,separators=(',',':')))
    layout=(f'Grid {group["grid"][0]} columns by {group["grid"][1]} rows, row-major; '
            f'canvas aspect {group["outputSize"][0]}:{group["outputSize"][1]}. Exactly one assigned material per cell; '
            'unused cells stay empty. ' if group else 'Produce one complete assigned material. ')
    surface=('For continuous-panel, fill removed foreign footprints with matching panel surface, never holes or '
             'empty frames; preserve genuine openings and surface translucency. ' if
             any(item['surface']=='continuous-panel' for item in entries) else '')
    if version in ('v2','v3'):
        layout=(f'Grid {group["grid"][0]} columns by {group["grid"][1]} rows, row-major; canvas aspect '
                f'{group["outputSize"][0]}:{group["outputSize"][1]}. One assigned material per cell; '
                'unused cells empty. cellIndex is 0-based. ' if group else
                'Output one complete assigned material. ')
        scale=('For sheets use one common uniform scale. ' if group else '')
        v2_surface=('Continuous panels fill excluded footprints with panel surface, no holes/ghosts; '
                    'retain genuine openings/translucency. ' if
                    any(item['surface']=='continuous-panel' for item in entries) else '')
        result=('Use context crops in 1-based referenceIndex order. '+layout+
                'targetBox/referenceBox are local normalized locators, not masks; outside targetBox is context. '
                'artworkPixelSize is planned crop size, not alpha bounds or placement. parts identify ownership; '
                'withinMaterial=(centerX,centerY,width,height) fractions before padding. Preserve observed state, '
                'complete contours, count, color, texture, ornaments and offsets at one rigid uniform x/y scale; '
                'no part recentering/enlargement. '+scale+
                'Remove ordinary letters/numbers except exact preserveText; retain owned single-character icon '
                'pictograms. Fill glyph footprints with owned surface, leave text space empty and other parts fixed. '
                'Exclude foreign units with their backing, frames and ornaments; exclusions override descriptions. '+
                v2_surface+'Output PNG with real continuous alpha outside complete contours and genuine gaps; '
                'retain owned translucency without underlying scene. Keep 10% fully transparent margin on all '
                'sides without stretch. No redesign, added borders/glow/shared backing/bridges/grid labels/other '
                'UI/scene. No program restores missing artwork. Entries: '+
                json.dumps(entries,ensure_ascii=False,separators=(',',':')))
        if version=='v2':return result
        rule=('When foreign exclusions cover an owned surface, continue that owned surface through their '
              'footprints, not transparent holes or placeholders; retain genuine gaps and original translucency. ')
        return result.replace('Entries: ',rule+'Entries: ',1)
    return ('Copy the listed owned artwork from attached context crops in 1-based referenceIndex order. '
            +layout+'cellIndex is 0-based. targetBox and referenceBox are normalized local coordinates in that '
            'attachment. Boxes locate owners, not masks; outside targetBox is context, not extra output. '
            'Keep every described owned part, complete contours, color, texture and observed state. '
            'Appearance identifies parts; coordinates control layout. withinMaterial is centerX,centerY,width,height '
            'as fractions before padding. Keep each material rigid: one uniform x/y scale, original artworkPixelSize '
            'aspect and internal offsets; do not recenter or enlarge parts. For sheets use one common uniform scale '
            'based on artworkPixelSize. Remove ordinary letters/numbers except exact preserveText; retain owned '
            'single-character icon pictograms. Restore only surface under glyphs; leave their space empty. '
            'Exclude listed foreign units completely, including backing, frames and attached ornaments; exclusions '
            'override decoration descriptions. '+surface+
            'No redesign, added borders, glow or decoration. Output PNG with real continuous alpha outside complete '
            'contours and in genuine gaps; retain owned translucency without underlying scene. Keep at least 10% '
            'fully transparent margin on every side, without changing artwork proportions. No shared backing, '
            'bridges, grid marks, cell labels or other UI/scene. No program restores missing artwork. '
            'Entries: '+json.dumps(entries,ensure_ascii=False,separators=(',',':')))
