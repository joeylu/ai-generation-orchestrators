"""Four-type visual observations -> official freeze and v2 handoff build inputs.

Material geometry/identity and footer evidence are supplied observations, never
inferred by the compiler. No provider calls occur in compile_delivery.
"""
import copy
import math
from pathlib import Path
import re
import shutil
import subprocess

from PIL import Image
from .common import read_json, write_json, require, digest, sha256, safe_relative, load_verified_image
from .vision_draft import compile_draft
from .component_boards import plan_boards
from .contract import validate
from .capabilities import audit
from .layout_spacing import require_export_spacing
from .reference_delivery import validate_mapping, validate_states


def _copy(source, target):
    target.parent.mkdir(parents=True,exist_ok=True)
    require(not target.exists(),'OUTPUT_EXISTS');shutil.copyfile(source,target)
    require(sha256(source)==sha256(target),'ADAPTER_COPY_CHANGED')
    return target


def _cli(component_root, args, timeout=60):
    r=subprocess.run(['node',str(Path(component_root).resolve()/'scripts/cli.mjs'),*map(str,args)],capture_output=True,text=True,timeout=timeout)
    require(r.returncode==0,'ADAPTER_CONSUMER_CLI_REJECTED')
    return r.stdout


def button_text_state(text,font_size,width,height):
    """Explicit compiler layout policy: one centered line, separate from skin extent."""
    line_height=font_size*1.25
    require(line_height<=height,'ADAPTER_BUTTON_TEXT_HEIGHT')
    layout=dict(x=0,y=(height-line_height)/2,width=width,height=line_height)
    return dict(labelLayout=dict(coordinateSpace='target-component-local',**layout),
                labelLines=dict(version='1.0',coordinateSpace='target-component-local',lines=[
                    dict(text=text,fontSize=font_size,fontWeight='normal',align='center',layout=layout)]))


def compile_delivery(reference, response, output, component_root, maximum_calls):
    """Build only authored inputs; frozen/bundle/delivery receipts remain program-owned."""
    if isinstance(response,dict) and response.get('kind')=='ui_native_delivery_input_v1':
        from .native_delivery import compile_native_delivery
        return compile_native_delivery(reference,response,output,component_root,maximum_calls)
    require(set(response)=={'draft','observations'},'ADAPTER_RESPONSE_FIELDS')
    draft=copy.deepcopy(response['draft']);obs=response['observations']
    required={'version','referenceSha256','geometryCorrections','panelFooters','materials'}
    require(required<=set(obs)<=required|{'textGeometry'} and obs['version']=='delivery-observations-1','ADAPTER_OBSERVATIONS')
    picture,proof=load_verified_image(Path(reference))
    require(proof['sha256']==obs['referenceSha256'] and list(picture.size)==draft.get('canvas'),'ADAPTER_REFERENCE_BINDING')
    # This first adapter only supports identity mapping, rejecting EXIF transforms.
    with Image.open(reference) as image:
        require(image.getexif().get(274,1)==1 and list(image.size)==draft['canvas'],'ADAPTER_REFERENCE_TRANSFORM_UNSUPPORTED')
    compile_draft(draft)  # validate before applying bounded corrections
    nodes={n['id']:n for n in draft['nodes']};seen=set()
    require(isinstance(obs['geometryCorrections'],list),'ADAPTER_CORRECTIONS')
    for row in obs['geometryCorrections']:
        require(set(row)=={'componentId','rect','reason'} and row['componentId'] in nodes and row['componentId'] not in seen,'ADAPTER_CORRECTION_ID')
        require(isinstance(row['reason'],str) and bool(row['reason'].strip()),'ADAPTER_CORRECTION_EVIDENCE')
        nodes[row['componentId']]['rect']=row['rect'];seen.add(row['componentId'])
    compiled=compile_draft(draft);doc=compiled['semantic-document.json']
    text_geometry=obs.get('textGeometry',{})
    require(isinstance(text_geometry,dict) and all(k in nodes and nodes[k]['type'] in ('Text','Button') for k in text_geometry),'ADAPTER_TEXT_GEOMETRY_IDS')
    critical=[n['id'] for n in nodes.values() if n['role'] in ('title','subtitle')]
    require(all(k in text_geometry for k in critical),'ADAPTER_TEXT_GEOMETRY_REQUIRED')
    compiled['visual-observations.json']['requiredTextGeometryIds']=critical
    for spec in compiled['visual-observations.json']['texts']:
        if spec['componentId'] in text_geometry:spec['geometry']=copy.deepcopy(text_geometry[spec['componentId']])
    require(all(all(type(v) is int for v in n['rect']) for n in nodes.values()),'ADAPTER_INTEGER_SOURCE_REGIONS')
    materials={};require(isinstance(obs['materials'],list),'ADAPTER_MATERIALS')
    for row in obs['materials']:
        require(set(row)=={'componentId','description'} and row['componentId'] in nodes and row['componentId'] not in materials,'ADAPTER_MATERIAL_ID')
        require(isinstance(row['description'],str) and 1<=len(row['description'])<=1600,'ADAPTER_MATERIAL_DESCRIPTION')
        materials[row['componentId']]=row['description']
    require(set(materials)=={n['id'] for n in nodes.values() if n['type']!='Text'},'ADAPTER_MATERIAL_COVERAGE')
    spacing=dict(version='1.1',panelFooters=[],scrollBottomSpaces=[],nonFooterButtons={})
    require(isinstance(obs['panelFooters'],list),'ADAPTER_FOOTERS')
    for row in obs['panelFooters']:
        require(set(row)=={'componentId','innerBottom','minimumGap','evidence'} and row['componentId'] in nodes,'ADAPTER_FOOTER_SCHEMA')
        spacing['panelFooters'].append(dict(panelId=row['componentId'],componentIds=[n['id'] for n in nodes.values() if n['parentId']==row['componentId'] and n['type']=='Button'],innerBottom=row['innerBottom'],minimumGap=row['minimumGap'],evidence=row['evidence']))
    spacing_report=require_export_spacing(doc,spacing)
    output=Path(output);require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    original=_copy(Path(reference),output/('original'+Path(reference).suffix))
    for name,value in compiled.items():write_json(output/name,value)
    write_json(output/'response.json',response);write_json(output/'applied-draft.json',draft)
    write_json(output/'layout-spacing.json',spacing);write_json(output/'spacing-check.json',spacing_report)
    cli_result=_cli(component_root,['validate',output/'semantic-document.json'])
    write_json(output/'consumer-preflight.json',dict(exitCode=0,stdout=cli_result,scope='pure_document_no_materials'))
    canvas=draft['canvas'];assets=[];placed=[];catalog=[];strategies={}
    def asset(key,rect,mode,prompt,component_id=None):
        x,y,w,h=rect
        assets.append(dict(id=key,role='background' if mode=='opaque_canvas' else 'important_component',route='generated_completion' if mode=='opaque_canvas' else 'generated_isolation',source_region=[x,y,x+w,y+h],output_size=[w,h],output_mode=mode,prompt=prompt,source_asset=None))
        placed.append(dict(id=key,asset=key,xy=[x,y]))
    asset('background',[0,0,*canvas],'opaque_canvas','Complete the reference scene with ALL foreground UI removed: panel frames, ornaments, slot surfaces, icons, buttons and all text. Preserve only the environmental background. No UI ghosts or text.')
    catalog.append(dict(componentId='background',componentType='Image',layerId='background',rect=[0,0,*canvas],generationAsset='background',board=None))
    for i,n in enumerate(nodes.values()):
        if n['type']=='Text':continue
        key=f'part-{i:03d}'
        catalog.append(dict(componentId=n['id'],componentType=n['type'],layerId=key,rect=n['rect'],generationAsset=key if n['type']=='Panel' else 'board-'+n['type'].lower(),board=None if n['type']=='Panel' else n['type'].lower()))
        if n['type']=='Panel':
            asset(key,n['rect'],'keyed_component',materials[n['id']]+' Preserve all complete outer ornaments and empty owned slot surfaces. Remove all Text, child icons and child Button skins. Uniform solid #F808F8 key backdrop; no checkerboard or text.')
    for kind in ('Button','Image'):
        parts=[r for r in catalog if r['componentType']==kind and r['componentId']!='background']
        if not parts:continue
        # Near-balanced relative windows; dimensions derived from declared part sizes.
        edge=16*math.ceil(max(sum(r['rect'][2]+16 for r in parts)+16,max(r['rect'][3] for r in parts)+16)/16)
        require(edge<=4096,'ADAPTER_BOARD_LIMIT')
        observations=dict(kind='ai_ui_material_observations_v2',strategy='component-family-board-v1',packing_canvas=[edge,edge],extraction_policy=dict(version='1.0',mode='relative-cell',target_padding=2,max_canvas_aspect_error=0.15),assets=[dict(id=r['layerId'],component_type=kind,component_group=kind.lower(),target_size=r['rect'][2:],source_reusable=False,source_evidence='') for r in parts])
        strategy=plan_boards(observations);board=strategy['boards'][0]
        write_json(output/('strategy-'+kind.lower()+'.json'),strategy);strategies[kind.lower()]=dict(path='strategy-'+kind.lower()+'.json',digest=strategy['digest'])
        descriptions=[]
        for slot,row in zip(board['slots'],parts):
            descriptions.append(f"{slot['asset_id']} in window {slot['search_window']}: {materials[row['componentId']]} Reference region {row['rect']}.")
        prompt=f"component-family-board-v1:{strategy['digest']}:{kind.lower()} component-family-relative-cell-v1. Raw square canvas {edge}x{edge}. "+' '.join(descriptions)+' Each window owns exactly its named part. Preserve full outline and proportion. No text, numbers, slot backgrounds or panel fragments. Uniform solid #F808F8 everywhere else.'
        asset('board-'+kind.lower(),[0,0,*canvas],'keyed_component',prompt)
    require(len(assets)<=maximum_calls,'ADAPTER_GENERATION_BUDGET')
    plan=dict(kind='ai_ui_decomposition_plan_v1',id='visual-delivery',canvas=canvas,source=dict(path=original.name,sha256=sha256(original),size=canvas),text_policy='remove_ordinary_text_preserve_graphic_symbols',granularity='important_components_only',delivery_policy='unreviewed_draft',assets=assets,nodes=placed,groups=[dict(id='intermediate',children=[n['id'] for n in placed])],document=dict(name='ui',format='png_zip'))
    write_json(output/'plan.json',plan);write_json(output/'plan-check.json',validate(plan,source_base=output))
    def walk(n):
        yield n
        for child in n.get('children',[]):yield from walk(child)
    profiles={'Container':['base','nested-children'],'Panel':['base','optional-header','nested-children'],'Text':['base','system-font'],'Image':['base','contain'],'Button':['base','runtime-feedback','per-line-text-layout']}
    caps=dict(kind='ui-decomposition-capability-request',version='1.0',planDigest=digest(plan),components=[dict(id=n['id'],type=n['type'],profiles=['base','stretch'] if n['id']=='background' else profiles[n['type']]) for n in walk(doc['root'])])
    write_json(output/'capabilities.json',caps);write_json(output/'capability-check.json',audit(caps))
    bindings=[];evidence={};scope=[];derived=[]
    for row in catalog:
        cid=row['componentId'];kind=row['componentType'];x,y,w,h=row['rect']
        b=dict(componentId=cid,componentType=kind,parts=[dict(role='image' if kind=='Image' else 'background',layerId=row['layerId'])])
        if kind=='Panel':b['states']={'panel':{'titleLayout':dict(coordinateSpace='target-component-local',x=0,y=0,width=w,height=1)}}
        if kind=='Button':
            b['states']={'button':button_text_state(nodes[cid]['text'],nodes[cid]['fontSize'],w,h)}
            evidence[cid]=dict(states={s:dict(basis='observed' if s=='default' else 'contract-derived',region=row['rect'],note='Visible base skin only; pointer state is not inferred. Hover/press use existing runtime feedback.' ) for s in ('default','hover','pressed')},relations={'background':dict(mode='shared',note='One explicitly shared base skin for runtime default/hover/pressed feedback; not three observed images.')})
            derived.append(dict(componentId=cid,basis='contract-derived',description='Enabled buttons and hover/pressed feedback are runtime test policy; real navigation/restart behavior is unknown and not implemented by this package.'))
        bindings.append(b)
    for n in walk(doc['root']):scope.append(dict(componentId=n['id'],mode='compare',reason='Reference layout target; system font policy is separately declared.'))
    for reason in draft['unknowns']:derived.append(dict(componentId='page',basis='contract-derived',description='Unresolved source observation, not a synthesized value: '+reason))
    reference_state=dict(kind='ui-reference-state',schemaVersion='1.0',components=[])
    acceptance=dict(kind='ui-acceptance-scope',schemaVersion='1.0',referenceState='reference/reference-state.json',components=scope,derivedTestStates=derived,human_visual_acceptance=False)
    mapping=dict(coordinateSpace='raw-image-pixel-edges-to-runtime-canvas',sourceSize=canvas,targetSize=canvas,crop=[0,0,*canvas],rotationDegrees=0,flipX=False,flipY=False,scale=[1,1],offset=[0,0])
    validate_mapping(mapping,canvas,doc['canvas']);validate_states(reference_state,acceptance,doc)
    for name,value in {'reference-state.json':reference_state,'acceptance-scope.json':acceptance,'reference-mapping.json':mapping,'state-evidence.json':dict(kind='ui_state_evidence_v1',components=evidence),'appearance-plan.json':dict(registration=dict(sourceCanvas=doc['canvas'],targetCanvas=doc['canvas'],transform=dict(scale=1,offset=dict(x=0,y=0))),bindings=bindings),'material-catalog.json':dict(original=original.name,parts=catalog,strategies=strategies)}.items():write_json(output/name,value)
    return dict(planDigest=digest(plan),maximumCalls=len(assets),componentCount=len(list(walk(doc['root']))),human_visual_acceptance=False)


def prepare_handoff(compiled, generation_run, output, component_root, *, material_paths=None):
    """Use authenticated processed images; boards never become runtime components."""
    from . import batch
    from .process import process
    from .component_boards import extract
    from .shared_materials import generated_rows
    compiled=Path(compiled);output=Path(output);require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    catalog=read_json(compiled/'material-catalog.json');generation_run=Path(generation_run)
    require(material_paths is None,'ADAPTER_AUTHENTICATED_MATERIALS_REQUIRED')
    frozen,plan=batch.load(generation_run)
    require(digest(plan)==digest(read_json(compiled/'plan.json')),'ADAPTER_GENERATION_PLAN_CHANGED')
    process(generation_run)
    extraction={}
    for group,strategy in catalog['strategies'].items():
        report=extract(generation_run,'board-'+group,compiled/strategy['path'],group,output/('extracted-'+group))
        for row in report['parts']:extraction[row['asset_id']]=output/('extracted-'+group)/row['path']
    paths={row['layerId']:extraction[row['layerId']] if row['board'] else generation_run/'materials'/row['generationAsset']/'material.png' for row in generated_rows(catalog['parts'])}
    return _materialized_handoff(compiled,paths,output,component_root,plan)


def _materialized_handoff(compiled,paths,output,component_root,plan):
    # Private join shared by verified single-run and multi-run producers.
    from . import batch
    from .process import process
    from .shared_materials import resolve_paths, shared_map
    catalog=read_json(compiled/'material-catalog.json')
    paths=resolve_paths(catalog['parts'],paths)
    original=_copy(compiled/catalog['original'],output/catalog['original'])
    assets=[];nodes=[];resource_args=[]
    document=read_json(compiled/'semantic-document.json')
    material_targets={}
    for row in catalog['parts']:
        key=row['layerId'];source=paths[key]
        target=_copy(source,output/'materials'/(key+'.png'));x,y,w,h=row['rect']
        material_targets[key]=target
        _,proof=load_verified_image(target,[w,h]);mode='opaque_canvas' if key=='background' else 'rgba'
        assets.append(dict(id=key,role='background' if key=='background' else 'important_component',route='imported_material',source_region=[x,y,x+w,y+h],output_size=[w,h],output_mode=mode,prompt='',source_asset=None,material_source=dict(path=target.relative_to(output).as_posix(),sha256=proof['sha256'])))
        nodes.append(dict(id=key,asset=key,xy=[x,y]))
        if row['componentType']=='Image':resource_args += ['--resource',f"layers/{row['componentId']}.png={target.resolve()}"]
    shared_record=shared_map(catalog['parts'],material_targets)
    if shared_record is not None:
        write_json(output/'shared-material-map.json',shared_record)
    imported={**plan,'id':'visual-delivery-materialized','source':dict(path=original.name,sha256=sha256(original),size=plan['canvas']),'assets':assets,'nodes':nodes,'groups':[dict(id='runtime-layers',children=[n['id'] for n in nodes])]}
    write_json(output/'materialized-plan.json',imported)
    names=['semantic-document.json','layout-spacing.json','layout-requirements.json','visual-observations.json','reference-state.json','acceptance-scope.json','reference-mapping.json','appearance-plan.json','state-evidence.json']
    for name in names:_copy(compiled/name,output/name)
    caps=read_json(compiled/'capabilities.json');caps['planDigest']=digest(imported);write_json(output/'capabilities.json',caps)
    batch.freeze(output/'materialized-plan.json',output/'workspace','materialized',capability_request=output/'capabilities.json',component_document=output/'semantic-document.json',layout_spacing=output/'layout-spacing.json')
    run=output/'workspace/runs/materialized';process(run)
    _cli(component_root,['pack',output/'semantic-document.json',*resource_args,'--provenance-kind','user-provided','--provenance-description','Reference-derived semantic layout with authenticated generated materials; no human visual acceptance.','--output',output/'bundle.json'])
    def ref(name):return dict(path=name,sha256=sha256(output/name))
    build=dict(kind='ui_handoff_build_plan_v1',run=dict(path=run.relative_to(output).as_posix(),batchSha256=sha256(run/'batch.json'),materialsSha256=sha256(run/'materials/materials.json')),componentBundle=ref('bundle.json'),appearance=read_json(output/'appearance-plan.json'),referenceOriginal=ref(original.name),referenceState=ref('reference-state.json'),acceptanceScope=ref('acceptance-scope.json'),referenceMapping=ref('reference-mapping.json'),layoutSpacing=ref('layout-spacing.json'),layoutRequirements=ref('layout-requirements.json'),visualObservations=ref('visual-observations.json'),stateEvidence=read_json(output/'state-evidence.json'))
    write_json(output/'build-plan.json',build)
    return output/'build-plan.json'
