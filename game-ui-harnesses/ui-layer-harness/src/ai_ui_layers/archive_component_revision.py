"""Atomic archive component additions/replacements, with genuine observed sources."""
from copy import deepcopy
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import tempfile

from jsonschema import Draft202012Validator
from PIL import Image
from .evaluate import read, save, digest
from .experimental_executor import record, verified
from .layer_package import composite, write_package, check_composition, validate_archive
from . import archive_component_exchange as exchange
from . import host_geometry_observation as geo
from . import observed_geometry_revision as observed
from . import viewport_geometry_revision as viewport

KIND='ui_archive_component_selection_v1'
POLICY='atomic-observed-archive-components-v1'
STORAGE_POLICY=viewport.POLICY
FLAGS=dict(viewport.FLAGS)
SHA=dict(type='string',pattern='^[0-9a-f]{64}$')
ID=dict(type='string',pattern='^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')
CHILD=dict(type='object',additionalProperties=False,
    required=['componentId','observationDirectory','requestSha256','responseSha256'],
    properties=dict(componentId=ID,observationDirectory=dict(type='string',minLength=1),
                    requestSha256=SHA,responseSha256=SHA))
OPERATION=dict(type='object',additionalProperties=False,
    required=['mode','parentLayerId','parentSha256','children'],properties=dict(
        mode=dict(enum=['append-children','replace-parent']),parentLayerId=ID,parentSha256=SHA,
        children=dict(type='array',minItems=1,maxItems=128,items=CHILD)))
BACKGROUND=dict(type='object',additionalProperties=False,required=['layerId','jobDirectory','receiptSha256'],
    properties=dict(layerId=ID,jobDirectory=dict(type='string',minLength=1),receiptSha256=SHA))
SCHEMA=dict(type='object',additionalProperties=False,
    required=['kind','sourceArchive','sourceArchiveSha256','fitPolicy','operations'],
    properties=dict(kind=dict(const=KIND),sourceArchive=dict(type='string',minLength=1),
        sourceArchiveSha256=SHA,fitPolicy=deepcopy(observed.SCHEMA['properties']['fitPolicy']),
        operations=dict(type='array',maxItems=128,items=OPERATION),
        backgroundUpdates=dict(type='array',minItems=1,maxItems=128,items=BACKGROUND)))


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _preflight(spec):
    Draft202012Validator(SCHEMA).validate(spec)
    tolerance=spec['fitPolicy']['maximumResidualPixels']
    if not math.isfinite(tolerance):raise ValueError('FINITE_RESIDUAL_POLICY_REQUIRED')
    loaded=exchange.load_archive(spec['sourceArchive'])
    if loaded['sourceArchiveSha256']!=spec['sourceArchiveSha256']:
        raise ValueError('COMPONENT_REVISION_SOURCE_ARCHIVE_CHANGED')
    layers={l['id']:l for l in loaded['composition']['layers']}
    parents=[op['parentLayerId'] for op in spec['operations']]
    children=[child['componentId'] for op in spec['operations'] for child in op['children']]
    if len(parents)!=len(set(parents)) or any(mid not in layers for mid in parents):
        raise ValueError('KNOWN_UNIQUE_OPERATION_PARENTS_REQUIRED')
    if len(children)!=len(set(children)) or set(children)&set(layers):
        raise ValueError('NEW_UNIQUE_COMPONENT_IDS_REQUIRED')
    reference_sha=_sha(loaded['referenceBytes']);proofs={};missing=[]
    backgrounds=spec.get('backgroundUpdates',[])
    background_ids=[update['layerId'] for update in backgrounds]
    if not parents and not backgrounds:raise ValueError('NONEMPTY_COMPONENT_OR_BACKGROUND_REVISION_REQUIRED')
    if len(background_ids)!=len(set(background_ids)) or set(background_ids)&set(parents):
        raise ValueError('UNIQUE_BACKGROUND_UPDATE_IDS_REQUIRED')
    background_proofs={}
    for update in backgrounds:
        from . import archive_background_exchange as background
        mid=update['layerId'];job=Path(update['jobDirectory']).resolve()
        if digest(job/'received.json')!=update['receiptSha256']:
            raise ValueError('BACKGROUND_REVISION_RECEIPT_SHA_CHANGED')
        proof=background.verify_received(job);binding=proof['binding'];layer=layers.get(mid)
        if (layer is None or layer['role']!='background' or proof['layerId']!=mid
            or layer['x']-loaded['worldShift'][0]!=0 or layer['y']-loaded['worldShift'][1]!=0
            or [layer['width'],layer['height']]!=loaded['originalSize']
            or binding.get('sourceArchiveSha256')!=loaded['sourceArchiveSha256']
            or binding.get('innerArchiveSha256')!=loaded['innerArchiveSha256']
            or binding.get('sourceSha256')!=_sha(loaded['files'][layer['path']])
            or binding.get('parentSha256')!=_sha(loaded['files'][layer['path']])
            or binding.get('referenceSha256')!=reference_sha
            or binding.get('receiptSha256')!=update['receiptSha256']
            or digest(Path(proof['candidatePath']))!=binding.get('candidateSha256')):
            raise ValueError('BACKGROUND_REVISION_SOURCE_SCOPE_MISMATCH')
        with Image.open(proof['candidatePath']) as image:
            image.load()
            if (image.format!='PNG' or image.mode!='RGBA' or list(image.size)!=loaded['originalSize']
                or image.getchannel('A').getextrema()!=(255,255)):
                raise ValueError('BACKGROUND_REVISION_ORIGINAL_OPAQUE_RGBA_REQUIRED')
        background_proofs[mid]=proof
    proofs['@backgroundUpdates']=background_proofs
    for op in spec['operations']:
        parent=layers[op['parentLayerId']]
        if _sha(loaded['files'][parent['path']])!=op['parentSha256']:
            raise ValueError('COMPONENT_REVISION_PARENT_SHA_CHANGED')
        for child in op['children']:
            item=Path(child['observationDirectory']).resolve()
            request_path=item/'request.json';response_path=item/'answer/response.json'
            # Existing bytes with the wrong hash are invalid evidence, not a missing child.
            for path,sha in ((request_path,child['requestSha256']),(response_path,child['responseSha256'])):
                if path.exists() and digest(path)!=sha:raise ValueError('COMPONENT_REVISION_OBSERVATION_SHA_CHANGED')
            absent=[str(p) for p in (request_path,response_path,item/'result.json') if not p.is_file()]
            if absent:
                missing.extend(absent);proofs[child['componentId']]=dict(reason='missing-required-sealed-observation')
                continue
            request,answer,source,reference=exchange.verify_observation(item)
            scope=request.get('scope',{})
            if (request.get('layerId')!=child['componentId'] or request.get('componentId')!=child['componentId']
                or request.get('parentLayerId')!=op['parentLayerId'] or request.get('parentSha256')!=op['parentSha256']
                or request.get('sourceArchiveSha256')!=loaded['sourceArchiveSha256']
                or request.get('innerArchiveSha256')!=loaded['innerArchiveSha256']
                or request.get('referenceSha256')!=reference_sha or Path(reference).read_bytes()!=loaded['referenceBytes']
                or request.get('referenceSize')!=loaded['originalSize'] or request.get('sourceSha256')!=digest(Path(source))
                or request.get('component',{}).get('role')!='foreground'
                or scope.get('kind')!='ui_component_owned_target_v1' or scope.get('componentId')!=child['componentId']
                or scope.get('parentLayerId')!=op['parentLayerId'] or scope.get('parentBoundsAreNotBody') is not True):
                raise ValueError('COMPONENT_REVISION_OBSERVATION_SCOPE_MISMATCH')
            proofs[child['componentId']]=dict(request=request,answer=answer,source=Path(source),
                assessment=geo.assess(request,answer),requestSha256=child['requestSha256'],responseSha256=child['responseSha256'])
    return loaded,proofs,sorted(set(missing))


def _inputs(selection,spec,proofs,missing):
    inventories={};absent=list(missing)
    for op in spec['operations']:
        for child in op['children']:
            item=Path(child['observationDirectory']).resolve()
            if item.exists():inventories[str(item)]=observed._tree(item)
            else:absent.append(str(item))
            request=proofs[child['componentId']].get('request')
            if request is None and (item/'request.json').is_file():request=read(item/'request.json')
            if request and request.get('editJobPath'):
                job=Path(request['editJobPath']).resolve()
                if job.exists():inventories[str(job)]=observed._tree(job)
                else:absent.append(str(job))
    for update in spec.get('backgroundUpdates',[]):
        job=Path(update['jobDirectory']).resolve();inventories[str(job)]=observed._tree(job)
    return dict(files={str(selection):digest(selection),str(Path(spec['sourceArchive']).resolve()):spec['sourceArchiveSha256']},
                inventories=inventories,missingPaths=sorted(set(absent)))


def _unchanged(inputs):
    observed._unchanged(inputs)
    if any(Path(path).exists() for path in inputs['missingPaths']):
        raise ValueError('FROZEN_MISSING_COMPONENT_EVIDENCE_APPEARED')


def _build(spec,loaded,proofs,temp):
    original=temp/'original';original.mkdir()
    for name,data in loaded['files'].items():
        path=original/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    previous=deepcopy(loaded['composition']);before=composite(original,previous)
    with Image.open(original/'preview.png') as image:
        if image.convert('RGBA').tobytes()!=before.tobytes():raise ValueError('COMPONENT_SOURCE_PREVIEW_MISMATCH')
    old_shift=loaded['worldShift'];old_layers={layer['id']:layer for layer in previous['layers']}
    operations={op['parentLayerId']:op for op in spec['operations']};new_layers=[];sources={};records=[]
    unchanged=[];lineage=[];background_records=[]
    for old in previous['layers']:
        parent=deepcopy(old);parent['x']-=old_shift[0];parent['y']-=old_shift[1]
        mid=parent['id'];op=operations.get(mid);children=[];failures=[];child_rows=[]
        if op is not None:
            for child in op['children']:
                cid=child['componentId'];proof=proofs[cid]
                child_row=dict(componentId=cid,status='unresolved',requestSha256=child['requestSha256'],
                               responseSha256=child['responseSha256'])
                if 'request' not in proof:
                    child_row['reason']=proof['reason'];failures.append(cid)
                else:
                    request=proof['request'];answer=proof['answer'];assessment=proof['assessment']
                    child_row.update(observation=answer,assessment=assessment,sourceEvidence={k:deepcopy(request[k]) for k in
                        ('parentLayerId','parentSha256','componentId','component','scope','sourceArchiveSha256',
                         'innerArchiveSha256','sourceSha256','referenceSha256','sourceSize','referenceSize',
                         'editBinding') if k in request})
                    if not assessment['geometryUsableCandidate']:
                        child_row['reason']='unresolved-observed-component-geometry';failures.append(cid)
                    else:
                        try:
                            fitted=observed.fit(answer,spec['fitPolicy']['maximumResidualPixels'])
                            image,geometry=viewport.transform(proof['source'],fitted)
                            path=temp/f'child-{len(records)}-{len(child_rows)}.png';image.save(path)
                            region=geometry['layerCanvasRegion']
                            layer=dict(id=cid,name=request['component']['name'],role='foreground',path='unassigned',
                                x=region[0],y=region[1],width=image.width,height=image.height,visible=True)
                            children.append((layer,dict(path=str(path),sha256=digest(path))))
                            child_row.update(status='geometry-candidate',reason='actual-observed-uniform-fit',geometry=geometry,
                                renderedSha256=digest(path),rawSha256=digest(proof['source']))
                        except ValueError as exc:child_row['reason']=str(exc);failures.append(cid)
                child_rows.append(child_row)
            applied=not failures
            operation_record=dict(parentLayerId=mid,parentSha256=op['parentSha256'],mode=op['mode'],
                status='applied' if applied else 'retained-parent-atomic-operation-unresolved',
                failedChildren=failures,children=child_rows,addedComponentIds=[c['componentId'] for c in op['children']] if applied else [],
                removedParentIds=[mid] if applied and op['mode']=='replace-parent' else [])
            if not applied:
                for row in child_rows:row['addedToComposition']=False
            else:
                for row in child_rows:row['addedToComposition']=True
            records.append(operation_record)
        else:applied=False
        keep_parent=op is None or not applied or op['mode']=='append-children'
        if keep_parent:
            new_layers.append(parent)
            background_proof=proofs['@backgroundUpdates'].get(mid)
            if background_proof:
                path=Path(background_proof['candidatePath']);sources[mid]=dict(path=str(path),sha256=digest(path))
                background_records.append(dict(layerId=mid,status='applied-native-region-background-update',
                    editRegion=background_proof['editRegion'],binding=background_proof['binding'],
                    originalCoordinateLayer=deepcopy(parent),canvasIdentityDoesNotProveInternalObjects=True,
                    bodyFitPerformed=False,**FLAGS))
            else:
                sources[mid]=dict(path=str(original/old['path']),sha256=digest(original/old['path']))
                unchanged.append(dict(layerId=mid,originalLayer=deepcopy(old),originalCoordinateLayer=deepcopy(parent),sha256=sources[mid]['sha256']))
        if op is not None and applied:
            for layer,source in children:new_layers.append(layer);sources[layer['id']]=source
    if not new_layers:raise ValueError('NONEMPTY_COMPONENT_COMPOSITION_REQUIRED')
    w,h=loaded['originalSize']
    bounds=[min(0,*[l['x'] for l in new_layers]),min(0,*[l['y'] for l in new_layers]),
            max(w,*[l['x']+l['width'] for l in new_layers]),max(h,*[l['y']+l['height'] for l in new_layers])]
    shift=[-bounds[0],-bounds[1]];world_size=[bounds[2]-bounds[0],bounds[3]-bounds[1]]
    for index,layer in enumerate(new_layers):
        original_region=[layer['x'],layer['y'],layer['x']+layer['width'],layer['y']+layer['height']]
        layer.update(x=layer['x']+shift[0],y=layer['y']+shift[1],path=f'layers/layer-{index+1:03}.png')
        lineage.append(dict(layerId=layer['id'],storedSha256=sources[layer['id']]['sha256'],
                            originalCoordinateStorageRegion=original_region,worldLayer=deepcopy(layer)))
    composition=dict(previous,canvas=dict(width=world_size[0],height=world_size[1]),layers=new_layers)
    check_composition(composition)
    reference=temp/'world-reference.png';original_reference=temp/'original-reference.png'
    original_reference.write_bytes(loaded['referenceBytes'])
    with Image.open(io.BytesIO(loaded['referenceBytes'])) as image:
        extended=Image.new('RGBA',tuple(world_size));extended.paste(image.convert('RGBA'),tuple(shift));extended.save(reference)
    folder=temp/'world';folder.mkdir();(folder/'layers').mkdir()
    for layer in new_layers:shutil.copyfile(sources[layer['id']]['path'],folder/layer['path'])
    world=composite(folder,composition);world.save(temp/'world-preview.png')
    viewport_info=dict(kind='ui_original_viewport_v1',policy=STORAGE_POLICY,
        worldBoundsInOriginalCoordinates=bounds,worldShift=shift,originalSize=[w,h],worldSize=world_size,
        worldViewportBox=[shift[0],shift[1],shift[0]+w,shift[1]+h],originalReferenceSha256=_sha(loaded['referenceBytes']),
        worldReferenceSha256=digest(reference),displayPolicy='exact original viewport slice; complete layer alpha retained in world storage')
    world.crop(viewport_info['worldViewportBox']).save(temp/'viewport-preview.png')
    proposal=dict(kind=KIND,policy=POLICY,storagePolicy=STORAGE_POLICY,sourceArchiveSha256=loaded['sourceArchiveSha256'],
        innerArchiveSha256=loaded['innerArchiveSha256'],fitPolicy=spec['fitPolicy'],viewport=viewport_info,
        operations=records,backgroundUpdates=background_records,lineage=lineage,unchangedLayers=unchanged,composition=composition,**FLAGS)
    proposal['proposalDigest']=viewport._canonical(proposal)
    return original,composition,sources,reference,proposal


def freeze(selection,output,actual_user_policy_instruction):
    if not isinstance(actual_user_policy_instruction,str) or not actual_user_policy_instruction.strip():
        raise ValueError('ACTUAL_COMPONENT_STRUCTURE_POLICY_INSTRUCTION_REQUIRED')
    selection=Path(selection).resolve();output=Path(output).resolve();spec=read(selection)
    loaded,proofs,missing=_preflight(spec);inputs=_inputs(selection,spec,proofs,missing)
    viewport._fresh(output,[*inputs['files'],*inputs['inventories'],*inputs['missingPaths']])
    with tempfile.TemporaryDirectory(prefix='component-freeze-') as temporary:
        temp=Path(temporary);_,_,_,_,proposal=_build(spec,loaded,proofs,temp)
        _unchanged(inputs);output.mkdir(parents=True)
        for name in ('world-preview.png','viewport-preview.png'):shutil.copyfile(temp/name,output/name)
    save(output/'selection.json',spec);save(output/'schema.json',SCHEMA)
    save(output/'proposal.json',proposal)
    save(output/'policy-authorization.json',dict(kind='ui_archive_component_policy_authorization_v1',policy=POLICY,
        storagePolicy=STORAGE_POLICY,actualUserPolicyInstruction=actual_user_policy_instruction,
        proposalDigest=proposal['proposalDigest'],sourceArchiveSha256=spec['sourceArchiveSha256']))
    return record(output/'freeze.json',dict(kind=KIND,policy=POLICY,storagePolicy=STORAGE_POLICY,approved=True,
        selectionSha256=digest(output/'selection.json'),schemaSha256=digest(output/'schema.json'),
        authorizationSha256=digest(output/'policy-authorization.json'),proposalSha256=digest(output/'proposal.json'),
        proposalDigest=proposal['proposalDigest'],previewFiles={n:digest(output/n) for n in ('world-preview.png','viewport-preview.png')},
        **inputs,**FLAGS))


def revise(frozen,expected_digest,output,viewer):
    frozen=Path(frozen).resolve();output=Path(output).resolve();viewer=Path(viewer).resolve();config=verified(frozen/'freeze.json')
    if (config.get('kind')!=KIND or config.get('policy')!=POLICY or config.get('storagePolicy')!=STORAGE_POLICY
        or config.get('approved') is not True or config['digest']!=expected_digest):
        raise ValueError('APPROVED_ATOMIC_COMPONENT_FREEZE_REQUIRED')
    for name,field in (('selection.json','selectionSha256'),('schema.json','schemaSha256'),
                       ('proposal.json','proposalSha256'),('policy-authorization.json','authorizationSha256')):
        if digest(frozen/name)!=config[field]:raise ValueError('FROZEN_COMPONENT_REVISION_CHANGED')
    if read(frozen/'schema.json')!=SCHEMA:raise ValueError('COMPONENT_REVISION_SCHEMA_CHANGED')
    for name,sha in config['previewFiles'].items():
        if digest(frozen/name)!=sha:raise ValueError('FROZEN_COMPONENT_PREVIEW_CHANGED')
    authorization=read(frozen/'policy-authorization.json')
    if (authorization.get('kind')!='ui_archive_component_policy_authorization_v1' or authorization.get('policy')!=POLICY
        or authorization.get('storagePolicy')!=STORAGE_POLICY or not authorization.get('actualUserPolicyInstruction')
        or authorization.get('proposalDigest')!=config['proposalDigest']):
        raise ValueError('COMPONENT_STRUCTURE_AUTHORIZATION_REQUIRED')
    _unchanged(config);spec=read(frozen/'selection.json');loaded,proofs,_=_preflight(spec)
    viewport._fresh(output,[frozen,viewer,*config['files'],*config['inventories'],*config['missingPaths']])
    with tempfile.TemporaryDirectory(prefix='component-revision-') as temporary:
        temp=Path(temporary);original,composition,sources,reference,proposal=_build(spec,loaded,proofs,temp)
        if proposal['proposalDigest']!=config['proposalDigest'] or proposal!=read(frozen/'proposal.json'):
            raise ValueError('APPROVED_COMPONENT_PROPOSAL_CHANGED')
        _unchanged(config);output.mkdir(parents=True)
        inherited=json.loads(loaded['files']['review.json'])
        issues=list(inherited['issues'])+['Atomic observed components candidate; strict registration and human acceptance remain false.',
                                       'Viewport contract: '+json.dumps(proposal['viewport'],sort_keys=True)]
        issues.extend('Component operation: '+json.dumps(observed._public(row),ensure_ascii=False,sort_keys=True) for row in proposal['operations'])
        issues.extend('Background update: '+json.dumps(observed._public(row),ensure_ascii=False,sort_keys=True) for row in proposal['backgroundUpdates'])
        package=write_package(reference,composition,sources,output/'delivery',viewer,issues)
        validate_archive(output/'delivery/ui-layers.zip');published=output/'delivery/package'
        world=composite(published,composition)
        with Image.open(published/'preview.png') as image:
            if world.tobytes()!=image.tobytes():raise ValueError('COMPONENT_WORLD_RECOMPOSITION_MISMATCH')
        world.crop(proposal['viewport']['worldViewportBox']).save(output/'delivery/viewport-preview.png')
        with Image.open(output/'delivery/viewport-preview.png') as image,Image.open(temp/'viewport-preview.png') as expected:
            if image.tobytes()!=expected.tobytes():raise ValueError('COMPONENT_VIEWPORT_SLICE_MISMATCH')
        (output/'delivery/original-reference.png').write_bytes(loaded['referenceBytes'])
        save(output/'delivery/viewport.json',proposal['viewport']);wrapper=viewport._wrapper(output/'delivery')
        by_id={layer['id']:layer for layer in composition['layers']};shift=proposal['viewport']['worldShift']
        for preserved in proposal['unchangedLayers']:
            layer=by_id[preserved['layerId']];original_layer=preserved['originalCoordinateLayer']
            if (digest(published/layer['path'])!=preserved['sha256'] or
                layer['x']-shift[0]!=original_layer['x'] or layer['y']-shift[1]!=original_layer['y'] or
                layer['width']!=original_layer['width'] or layer['height']!=original_layer['height']):
                raise ValueError('UNCHANGED_PARENT_BYTES_OR_ORIGINAL_COORDINATES_CHANGED')
        _unchanged(config)
        provenance=dict(proposal,frozenDigest=expected_digest,authorizationSha256=config['authorizationSha256'],
            sourceManifest=json.loads(loaded['files']['manifest.json']),sourceReview=inherited,
            originalComposition=loaded['composition'],oldWorldShift=loaded['worldShift'],
            packageSha256=package['sha256'],viewportArchiveSha256=wrapper['sha256'])
        save(output/'revision-provenance.json',provenance)
        result=dict(package,status='pending-human-review',policy=POLICY,storagePolicy=STORAGE_POLICY,
            operations=proposal['operations'],backgroundUpdates=proposal['backgroundUpdates'],
            viewport=proposal['viewport'],proposalDigest=proposal['proposalDigest'],
            innerPackageSha256=package['sha256'],viewportArchiveSha256=wrapper['sha256'],viewportArchiveBytes=wrapper['bytes'],
            companionFiles={n:digest(output/'delivery'/n) for n in ('viewport.json','viewport-preview.png',
                'original-reference.png','viewport-checksums.json')},provenanceSha256=digest(output/'revision-provenance.json'),**FLAGS)
        save(output/'result.json',result);return result
