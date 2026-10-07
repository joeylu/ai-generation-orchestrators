"""Bounded single-material edit exchange; preparation and replay never call a model."""
import json
import re
from pathlib import Path

from PIL import Image

from .evaluate import read, save, digest
from .freeze_visual import inspect, body_digest
from . import ownership_observation as ownership


KIND = 'ui_material_cleanup_v1'
PROMPT_VERSION = 'cleanup-ownership-first-v3'
DIRECT_PROMPT_VERSION = 'cleanup-delete-direct-v2'
LEGACY_PROMPT_VERSION = 'cleanup-catalog-v1'
SCHEMA = dict(type='object', additionalProperties=False,
    required=['kind','materialId','ownedOnly','removeForeign','sourceSize','contextGeometry','ownershipRegion','preserveText'],
    properties=dict(kind=dict(const=KIND),materialId=dict(type='string',minLength=1),
        ownedOnly=dict(type='array',minItems=1,items=dict(type='object')),
        removeForeign=dict(type='array',minItems=1,items=dict(type='object')),
        sourceSize=dict(type='array',minItems=2,maxItems=2,items=dict(type='integer',minimum=1)),
        contextGeometry=dict(type='object'),ownershipRegion=dict(type='array'),preserveText=dict(type='array')))


def _visual(snapshot):
    path=snapshot/'evidence/revised-visual-plan.json'
    return read(path if path.exists() else snapshot/'evidence/m1-draft.json')


def _same_origin(snapshot, manifest, old_snapshot, old_manifest):
    for key in ('sourcePlanSha256','visualPolicySha256','visualTexturePolicy',
                'visualTexturesSha256','visualTextureBindingsSha256',
                'materialReusePolicy','materialReuseSha256','generatedMaterialCount','materialCount',
                'backgroundRegionPolicy','backgroundRegionDigest','backgroundRegionMaterialId'):
        if manifest.get(key)!=old_manifest.get(key):
            raise ValueError('CLEANUP_SOURCE_PLAN_OR_POLICY_CHANGED')
    if digest(snapshot/'reference.png')!=digest(old_snapshot/'reference.png'):
        raise ValueError('CLEANUP_REFERENCE_CHANGED')
    if _visual(snapshot)!=_visual(old_snapshot):raise ValueError('CLEANUP_VISUAL_PLAN_CHANGED')
    for name in ('execution-plan.candidate.json','placements.json'):
        if read(snapshot/name)!=read(old_snapshot/name):
            raise ValueError('CLEANUP_COMPILED_STRUCTURE_CHANGED')


def _source(source_job, request_id, material_id):
    # Delayed imports keep the executor/host helper dependency acyclic.
    from . import experimental_executor as ex
    from .host_material_review import source, candidate_sheet_cells
    config,row,receipt,raw=source(source_job,request_id)
    if 'cleanup' in config:raise ValueError('CLEANUP_RECURSIVE_SOURCE_UNSUPPORTED')
    if material_id not in row.get('materialIds',[request_id]):
        raise ValueError('CLEANUP_SOURCE_MATERIAL_MISMATCH')
    auth=ex.verified(source_job/'authorization.json')
    submission=ex.verified(source_job/'attempts'/request_id/'submission.json')
    if (auth.get('snapshotDigest')!=config['snapshotDigest'] or
            auth.get('automaticRetries')!=0 or not auth.get('approval','').strip() or
            submission['authorizationDigest']!=auth['digest'] or
            receipt.get('status')!='raw_received'):
        raise ValueError('CLEANUP_SOURCE_AUTHORIZATION_MISMATCH')
    with Image.open(raw) as image:
        image.load();image=image.convert('RGBA')
        if row.get('kind')=='sheet':
            boxes,split=candidate_sheet_cells(image,row)
            box=boxes[row['materialIds'].index(material_id)]
            cell=image.crop(box)
        else:
            box=[0,0,image.width,image.height];split=None;cell=image.copy()
    paths={'job.json':source_job/'job.json','authorization.json':source_job/'authorization.json',
           'submission.json':source_job/'attempts'/request_id/'submission.json',
           'received.json':source_job/'attempts'/request_id/'received.json',
           'raw.png':raw}
    lineage=dict(sourceJob=str(source_job),sourceRequestId=request_id,materialId=material_id,
        jobDigest=config['digest'],snapshotDigest=config['snapshotDigest'],
        submissionDigest=submission['digest'],rawSha256=receipt['rawSha256'],
        files={name:digest(path) for name,path in paths.items()},sourceBox=list(box),sheetSplit=split,
        originalSheetExtractionPromoted=False)
    return config,lineage,cell


def _inputs(snapshot, material_id, cell):
    visual=_visual(snapshot);plan=read(snapshot/'execution-plan.candidate.json')
    entry=ownership.inventory(visual,plan,
                              [material_id])['entries'][0]
    if not entry['foreign']:raise ValueError('CLEANUP_FOREIGN_TARGETS_REQUIRED')
    from .context_references import geometry
    asset=next(a for a in plan['assets'] if a['id']==material_id)
    material=next(m for m in visual['materials'] if m['id']==material_id)
    placement=next(p for p in read(snapshot/'placements.json')['materials'] if p['id']==material_id)
    result=dict(kind=KIND,materialId=material_id,ownedOnly=entry['owned'],
                removeForeign=entry['foreign'],sourceSize=list(cell.size),
                contextGeometry=geometry(asset,plan['canvas']),ownershipRegion=placement['sourceRegion'],
                preserveText=material.get('preserveText',[]))
    from jsonschema import Draft202012Validator
    Draft202012Validator(SCHEMA).validate(result)
    return result


def _prompt_v1(inputs):
    return ('Single-material clean-plate EDIT. Image 1 is the actual contaminated generated material; '
        'image 2 is the original local context reference, not another output to copy. '
        'Return exactly one PNG material on the same '+str(inputs['sourceSize'][0])+' x '+
        str(inputs['sourceSize'][1])+' pixel canvas. Image 2 determines the original owned body '
        'outer contour, aspect ratio and relative internal layout. Image 1 is the edit source. '
        'Correct an incorrect body shape using image 2 when necessary; keep owned holes, '
        'continuous alpha, colors, lighting and texture identity. Do not move individual owned '
        'decorations independently or change their relative layout. '
        'Preserve every ownedOnly object. Remove every removeForeign object, including its '
        'outline, shadow, contents and text; reconstruct only the underlying owned surface. '
        'Do not remove an owned hole or invent a transparent hole where foreign artwork stood. '
        'Remove ordinary business labels, numbers and text; preserve only text explicitly '
        'declared in preserveText. Preserve continuous soft alpha; zero RGB where '
        'alpha is zero. No new objects, collage or sheet. OwnershipRegion and targetBox are '
        'ownership locators, not a measured body box; do not fill or stretch artwork to them.\n'
        'contextGeometry: '+json.dumps(inputs['contextGeometry'],sort_keys=True)+'\n'
        'ownershipRegion: '+json.dumps(inputs['ownershipRegion'])+'\n'
        'preserveText: '+json.dumps(inputs['preserveText'],ensure_ascii=False)+'\n'
        'ownedOnly: '+json.dumps(inputs['ownedOnly'],ensure_ascii=False,sort_keys=True)+'\n'
        'removeForeign: '+json.dumps(inputs['removeForeign'],ensure_ascii=False,sort_keys=True)+'\n')


def _name(identifier):
    """Readable identifier words, with no inferred appearance or sample vocabulary."""
    separated=re.sub(r'(?<=[a-z0-9])(?=[A-Z])',' ',identifier)
    return re.sub(r'[_\-\s]+',' ',separated).strip()


def _prompt_v2(inputs):
    width,height=inputs['sourceSize']
    lines=[
        'CLEAN-PLATE EDIT: DELETE the listed foreign objects from image 1.',
        'Return one PNG containing ONLY the owned objects below. Everything else must be absent.',
        'For every DELETE entry remove the whole object: body, frame, contents, shadow and text. '
        'Replace it with the underlying owned surface; do not leave an empty card/frame or cut a new hole.',
        'removeForeign:',
    ]
    # One explicit action for every catalog member. Never repeat foreign appearance
    # prose (which may itself say "preserve") as a positive drawing instruction.
    for item in inputs['removeForeign']:
        lines.append('- DELETE '+_name(item['objectId'])+' ['+item['materialId']+'/'+item['objectId']+'].')
    lines.extend([
        'ownedOnly — the ONLY KEEP list:',
        *['- KEEP '+item['objectId']+': '+item['appearance'] for item in inputs['ownedOnly']],
        'Image 2 provides ONLY the original shape, aspect ratio and relative layout of these owned objects. '
        'Do not copy its foreign children, cards, items, icons or buttons into the result.',
        'Correct an incorrect owned body shape using image 2. Preserve owned texture identity, '
        'decorations, lighting, holes and their relative layout; do not move decorations independently.',
        'Remove ordinary business labels and numbers. Text allowed to remain: '+
            (json.dumps(inputs['preserveText'],ensure_ascii=False) if inputs['preserveText'] else 'NONE')+'.',
        'Use the same '+str(width)+' x '+str(height)+' pixel canvas. Preserve continuous soft alpha; '
        'zero RGB where alpha is zero. No added objects, collage or sheet.',
        'Image 2 ownership targetBox (pixels): '+str(inputs['contextGeometry']['targetBox'])+
        ' in reference size '+str(inputs['contextGeometry']['referenceSize'])+'. This locates ownership; '
        'it is not a measured body box and must not be filled or used to stretch artwork.',
        'Final check: every DELETE object is absent; only the KEEP list remains.',
    ])
    return '\n'.join(lines)+'\n'


def _prompt_v3(inputs):
    from .context_owned_actions import OWNERSHIP_PRIORITY, FOREIGN_REMOVAL_RULES
    width,height=inputs['sourceSize']
    lines=[
        'CLEAN-PLATE EDIT: DELETE the listed foreign objects from image 1.',
        'Return one PNG containing ONLY the owned objects below. Everything else must be absent.',
        OWNERSHIP_PRIORITY,
        'Image 1 is the actual contaminated generated material. Image 2 is the original local '
        'context reference; use it only for the owned shape, aspect ratio and relative layout. '
        'Do not copy its foreign children, cards, items, icons or buttons into the result.',
        'DELETE each listed foreign unit completely: body, backing, frame, contents, ornaments, '
        'outline, shadow, glow and text. Removing its text alone is insufficient.',
        'removeForeign:',
    ]
    for item in inputs['removeForeign']:
        relation=item['relation']
        if relation not in ('overlay','underlay','same-depth'):
            raise ValueError('CLEANUP_FOREIGN_RELATION')
        locator=json.dumps(item['referenceBox'],separators=(',', ':'))
        lines.append('- DELETE '+_name(item['objectId'])+' ['+item['materialId']+'/'+item['objectId']+
                     ']. relation='+relation+'; referenceBox='+locator+'.')
    lines.extend([
        FOREIGN_REMOVAL_RULES,
        'ownedOnly — the ONLY KEEP list:',
        *['- KEEP '+item['objectId']+': '+item['appearance'] for item in inputs['ownedOnly']],
        'Correct an incorrect owned body shape using image 2. Preserve owned identity, texture, '
        'decorations, lighting, genuine holes and translucency, proportions and relative offsets. '
        'Do not move decorations independently. A parent owns only its substrate and explicitly '
        'listed ornaments; separately assigned children are absent. A child excludes its parent backing.',
        'Remove ordinary business labels and numbers. Text allowed to remain: '+
            (json.dumps(inputs['preserveText'],ensure_ascii=False) if inputs['preserveText'] else 'NONE')+'.',
        'Use the same '+str(width)+' x '+str(height)+' pixel canvas. Preserve continuous soft alpha; '
        'zero RGB where alpha is zero. No added objects, collage or sheet.',
        'Image 2 ownership targetBox (pixels): '+str(inputs['contextGeometry']['targetBox'])+
        ' in reference size '+str(inputs['contextGeometry']['referenceSize'])+'. referenceBox values '
        'are normalized locators within image 2. These boxes are not masks or measured body bounds; '
        'never fill them, stretch artwork to them or cut their rectangles out of an owned surface.',
        'Final check: every DELETE object is absent; every KEEP object is complete.',
    ])
    return '\n'.join(lines)+'\n'


def _prompt(inputs, version=LEGACY_PROMPT_VERSION):
    """Version dispatch preserves byte-for-byte replay of historical frozen prompts."""
    if version==LEGACY_PROMPT_VERSION:return _prompt_v1(inputs)
    if version==DIRECT_PROMPT_VERSION:return _prompt_v2(inputs)
    if version==PROMPT_VERSION:return _prompt_v3(inputs)
    raise ValueError('CLEANUP_PROMPT_VERSION')


def prepare_cleanup(snapshot, expected_digest, output, material_id, source_job,
                    source_request_id=None):
    """Create one fresh ordinary exchange job with frozen edit inputs and source lineage."""
    from . import experimental_executor as ex
    snapshot=Path(snapshot).resolve();output=Path(output).resolve();source_job=Path(source_job).resolve()
    request_id=source_request_id or material_id
    if output.exists() or output.is_relative_to(source_job) or output.is_relative_to(snapshot):
        raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    manifest=inspect(snapshot,expected_digest)
    old_config,lineage,cell=_source(source_job,request_id,material_id)
    old_snapshot=source_job/'snapshot'
    _same_origin(snapshot,manifest,old_snapshot,inspect(old_snapshot,old_config['snapshotDigest']))
    rows=read(snapshot/'requests.json')['requests']
    row=next((r for r in rows if r['asset']==material_id),None)
    if row is None or row.get('kind')=='sheet' or row.get('materialIds',[material_id])!=[material_id]:
        raise ValueError('CLEANUP_SINGLETON_SNAPSHOT_REQUIRED')
    inputs=_inputs(snapshot,material_id,cell)
    # Mark the initial record unusable before writing edit artifacts. An
    # interrupted preparation must never become an ordinary acquisition job.
    config=ex.prepare(snapshot,expected_digest,output,[material_id],_cleanup_material_id=material_id)
    folder=output/'cleanup';folder.mkdir()
    cell.save(folder/'cleanup-source.png')
    from .context_references import png_bytes
    with Image.open(snapshot/'reference.png') as reference:
        (folder/'reference-context.png').write_bytes(png_bytes(reference.crop(inputs['contextGeometry']['cropRegion'])))
    save(folder/'inputs.json',inputs);save(folder/'schema.json',SCHEMA)
    save(folder/'source-lineage.json',lineage)
    (folder/'prompt.txt').write_text(_prompt(inputs,PROMPT_VERSION),encoding='utf-8')
    binding=dict(kind=KIND,promptVersion=PROMPT_VERSION,materialId=material_id,sourceJob=str(source_job),
        sourceRequestId=request_id,sourceLineageSha256=digest(folder/'source-lineage.json'),
        sourceCellSha256=digest(folder/'cleanup-source.png'),
        files={p.name:digest(p) for p in sorted(folder.iterdir())})
    config={k:v for k,v in config.items() if k!='digest'}
    config['cleanup']=binding
    # The output was exclusively created above. This is the same deterministic
    # preparation transaction: no authorization or submission exists yet.
    # Freeze the additional edit binding before making this new job usable.
    result={**config,'digest':body_digest(config)}
    (output/'job.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    ex.load_job(output)
    return result


def verify_cleanup(job, config, index):
    """Replay every source/input binding before authorization or dispatch."""
    job=Path(job).resolve();binding=config['cleanup'];mid=binding['materialId']
    if (binding.get('kind')!=KIND or config['assets']!=[mid] or
            config.get('maximumCalls')!=1 or config.get('automaticRetries')!=0 or
            mid not in index or index[mid].get('kind')=='sheet' or 'promptVariant' in config):
        raise ValueError('CLEANUP_JOB_BINDING')
    folder=job/'cleanup'
    required={'inputs.json','schema.json','source-lineage.json','prompt.txt',
              'cleanup-source.png','reference-context.png'}
    if set(binding['files'])!=required:raise ValueError('CLEANUP_INPUT_COVERAGE')
    for name,sha in binding['files'].items():
        if digest(folder/name)!=sha:raise ValueError('CLEANUP_INPUT_CHANGED')
    if (binding['sourceCellSha256']!=digest(folder/'cleanup-source.png') or
            binding['sourceLineageSha256']!=digest(folder/'source-lineage.json')):
        raise ValueError('CLEANUP_FINGERPRINT_CHANGED')
    source_job=Path(binding['sourceJob'])
    old_config,lineage,cell=_source(source_job,binding['sourceRequestId'],mid)
    if read(folder/'source-lineage.json')!=lineage:raise ValueError('CLEANUP_SOURCE_CHANGED')
    snapshot=job/'snapshot'
    _same_origin(snapshot,inspect(snapshot,config['snapshotDigest']),source_job/'snapshot',
                 inspect(source_job/'snapshot',old_config['snapshotDigest']))
    with Image.open(folder/'cleanup-source.png') as stored:
        stored.load()
        if stored.size!=cell.size or stored.convert('RGBA').tobytes()!=cell.tobytes():
            raise ValueError('CLEANUP_SOURCE_PIXELS_CHANGED')
    inputs=_inputs(snapshot,mid,cell)
    from .context_references import png_bytes
    with Image.open(snapshot/'reference.png') as reference:
        if (folder/'reference-context.png').read_bytes()!=png_bytes(reference.crop(inputs['contextGeometry']['cropRegion'])):
            raise ValueError('CLEANUP_CONTEXT_CHANGED')
    if read(folder/'inputs.json')!=inputs or read(folder/'schema.json')!=SCHEMA:
        raise ValueError('CLEANUP_CATALOG_CHANGED')
    # Jobs frozen before prompt versioning have the exact historical v1 prompt.
    if (folder/'prompt.txt').read_text(encoding='utf-8')!=_prompt(inputs,binding.get('promptVersion',LEGACY_PROMPT_VERSION)):
        raise ValueError('CLEANUP_PROMPT_CHANGED')
    return binding


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='cmd',required=True)
    p=sub.add_parser('prepare');p.add_argument('--snapshot',required=True)
    p.add_argument('--expected-digest',required=True);p.add_argument('--output',required=True)
    p.add_argument('--material-id',required=True);p.add_argument('--source-job',required=True)
    p.add_argument('--source-request-id')
    args=parser.parse_args()
    print(json.dumps(prepare_cleanup(args.snapshot,args.expected_digest,args.output,args.material_id,
                                    args.source_job,args.source_request_id),ensure_ascii=True,indent=2))
