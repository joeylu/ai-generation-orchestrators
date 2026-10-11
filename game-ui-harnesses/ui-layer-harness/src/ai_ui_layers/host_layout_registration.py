"""Frozen layout declarations applied automatically after warning delivery."""
from copy import deepcopy
from pathlib import Path

import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator

from .evaluate import read, save, digest, pixel_box
from .experimental_executor import record, verified
from .freeze_visual import body_digest
from . import layout_registration_revision as revision

POLICY='declared-layout-after-diagnostic-v1'
LEGACY='preserve-diagnostic-layout-v1'
KIND='ui_host_layout_contract_v1'
PLANNING='fresh-m1-layout-contract-v1'
UNIFORM_OBSERVATION='uniform-internal-targets-observe-only-v1'
SCHEMA=dict(type='object',additionalProperties=False,
    required=['kind','referenceSha256','materials','constraints','knownDifferences'],properties=dict(
        kind=dict(const=KIND),referenceSha256=revision.SHA,
        materials=dict(type='array',minItems=1,maxItems=128,items=dict(type='object',additionalProperties=False,
            required=['materialId','mode','measurementAlphaThreshold'],properties=dict(
                materialId=dict(type='string',minLength=1),mode=dict(enum=['frame','uniform']),
                measurementAlphaThreshold=dict(type='integer',minimum=1,maximum=255),
                horizontalDividerTargets=dict(type='array',minItems=0,maxItems=32,uniqueItems=True,
                    items=dict(type='integer',minimum=1)),
                horizontalBandTargets=dict(type='array',minItems=0,maxItems=16,
                    items=dict(type='array',minItems=2,maxItems=2,
                        items=dict(type='integer',minimum=1)))))),
        constraints=revision.SCHEMA['properties']['constraints'],
        knownDifferences=revision.SCHEMA['properties']['knownDifferences']))


def validate_contract(value, reference_sha, internal_policy=None):
    if internal_policy not in (None,UNIFORM_OBSERVATION):
        raise ValueError('HOST_LAYOUT_INTERNAL_POLICY_UNKNOWN')
    Draft202012Validator(SCHEMA).validate(value)
    if value['referenceSha256']!=reference_sha:raise ValueError('HOST_LAYOUT_REFERENCE_CHANGED')
    ids=[m['materialId'] for m in value['materials']]
    if len(set(ids))!=len(ids):raise ValueError('HOST_LAYOUT_DUPLICATE_MATERIAL')
    keys=[c['id'] for c in value['constraints']]
    if len(set(keys))!=len(keys):raise ValueError('HOST_LAYOUT_DUPLICATE_CONSTRAINT')
    if any(c[end]['materialId'] not in ids for c in value['constraints'] for end in ('a','b')):
        raise ValueError('HOST_LAYOUT_CONSTRAINT_MATERIAL_REQUIRED')
    for row in value['materials']:
        targets=row.get('horizontalDividerTargets',[])
        permitted=row['mode']=='frame' or internal_policy==UNIFORM_OBSERVATION
        if targets and (not permitted or targets!=sorted(targets)):
            raise ValueError('HOST_LAYOUT_ORDERED_FRAME_DIVIDERS_REQUIRED')
        bands=row.get('horizontalBandTargets',[])
        if bands and (not permitted or any(a>=b for a,b in bands) or
                any(a[1]>=b[0] for a,b in zip(bands,bands[1:])) or
                any(a<=y<b for a,b in bands for y in targets)):
            raise ValueError('HOST_LAYOUT_ORDERED_FRAME_BANDS_REQUIRED')
    revision.assess_constraints(value['constraints'],{key:[0,0,1,1] for key in ids})
    for text in value['knownDifferences']:revision.portable_text(text)


def configure(config, *, fast):
    config.setdefault('layoutRegistrationPolicy',POLICY if fast else LEGACY)
    policy=config['layoutRegistrationPolicy']
    if policy not in (POLICY,LEGACY) or policy==POLICY and not fast:
        raise ValueError('HOST_LAYOUT_REQUIRES_NEW_FAST_WARNING_RUN')
    if fast and policy==POLICY:
        config.setdefault('layoutInternalTargetsPolicy',UNIFORM_OBSERVATION)
    if ('layoutInternalTargetsPolicy' in config and
            (config['layoutInternalTargetsPolicy']!=UNIFORM_OBSERVATION or not fast or policy!=POLICY)):
        raise ValueError('HOST_LAYOUT_INTERNAL_POLICY_REQUIRES_FAST_WARNING')
    if (fast and policy==POLICY and
            config.get('planningMode')=='fresh-host-m1-independent-review' and
            not config.get('layoutContract') and 'layoutContractSha256' not in config):
        config.setdefault('layoutPlanningPolicy',PLANNING)
    if 'layoutPlanningPolicy' in config:
        if (config['layoutPlanningPolicy']!=PLANNING or policy!=POLICY or
                config.get('planningMode')!='fresh-host-m1-independent-review' or
                config.get('layoutContract') or 'layoutContractSha256' in config):
            raise ValueError('HOST_LAYOUT_FRESH_M1_DECLARATION_REQUIRED')
    if config.get('layoutContract'):
        if policy!=POLICY:raise ValueError('HOST_LAYOUT_CONTRACT_REQUIRES_POLICY')
        path=Path(config['layoutContract'])
        before=digest(path);validate_contract(read(path),digest(Path(config['original'])),config.get('layoutInternalTargetsPolicy'))
        if digest(path)!=before:raise ValueError('HOST_LAYOUT_CONTRACT_CHANGED')
        if config.get('layoutContractSha256',before)!=before:raise ValueError('HOST_LAYOUT_CONTRACT_CHANGED')
        config['layoutContractSha256']=before
    elif 'layoutContractSha256' in config:
        raise ValueError('HOST_LAYOUT_CONTRACT_PAIR_REQUIRED')


def _contract(root, config):
    """Resolve one declared source; never infer permissions from material names."""
    if config.get('layoutPlanningPolicy')==PLANNING:
        path=root/'frozen/evidence/revised-visual-plan.json'
        if not path.exists():path=root/'frozen/evidence/m1-draft.json'
        value=read(path).get('layoutRegistration')
        if value is None:raise ValueError('HOST_LAYOUT_M1_DECLARATION_REQUIRED')
        return value,body_digest(value),'reviewed-visual-plan'
    path=Path(config['layoutContract'])
    if digest(path)!=config['layoutContractSha256']:raise ValueError('HOST_LAYOUT_CONTRACT_CHANGED')
    return read(path),config['layoutContractSha256'],'input-sidecar'


def preflight_plan(root, config):
    """Check fresh declarations before spending the independent M2 call."""
    if config.get('layoutPlanningPolicy')!=PLANNING:return
    root=Path(root);visual=read(root/'planning-m1/draft.json')
    contract=visual.get('layoutRegistration')
    if contract is None:raise ValueError('HOST_LAYOUT_M1_DECLARATION_REQUIRED')
    validate_contract(contract,digest(Path(config['original'])),config.get('layoutInternalTargetsPolicy'))
    foreground={m['id']:m for m in visual['materials'] if m['role']=='foreground'}
    if {m['materialId'] for m in contract['materials']}!=set(foreground):
        raise ValueError('HOST_LAYOUT_ALL_FOREGROUND_REQUIRED')
    with Image.open(config['original']) as image:width,height=image.size
    for row in contract['materials']:
        box=foreground[row['materialId']]['bboxNorm']
        target=pixel_box(box,width,height)
        revision._box(target,(width,height))
        if any(not target[1]+3<y<target[3]-3 for y in row.get('horizontalDividerTargets',[])):
            raise ValueError('HOST_LAYOUT_DIVIDER_OUTSIDE_TARGET')
        if any(not target[1]+3<y<target[3]-3 for band in row.get('horizontalBandTargets',[]) for y in band):
            raise ValueError('HOST_LAYOUT_BAND_OUTSIDE_TARGET')


def freeze(root, config):
    """Called after the reviewed snapshot is frozen, before image reservation."""
    if (config.get('layoutRegistrationPolicy')!=POLICY or
            not (config.get('layoutContract') or config.get('layoutPlanningPolicy')==PLANNING)):return
    root=Path(root);contract,contract_sha,origin=_contract(root,config);snapshot=root/'frozen'
    reference_sha=digest(snapshot/'reference.png');validate_contract(contract,reference_sha,config.get('layoutInternalTargetsPolicy'))
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    if not visual_path.exists():visual_path=snapshot/'evidence/m1-draft.json'
    visual=read(visual_path);owned={m['id']:m for m in visual['materials']}
    if (origin=='reviewed-visual-plan' and
            {m['materialId'] for m in contract['materials']}!={k for k,v in owned.items() if v['role']=='foreground'}):
        raise ValueError('HOST_LAYOUT_ALL_FOREGROUND_REQUIRED')
    placements={m['id']:m for m in read(snapshot/'placements.json')['materials']}
    materials=[]
    with Image.open(snapshot/'reference.png') as image:size=image.size
    for declaration in contract['materials']:
        key=declaration['materialId']
        if key not in owned or key not in placements or owned[key]['role']!='foreground':
            raise ValueError('HOST_LAYOUT_FOREGROUND_PLAN_ID_REQUIRED')
        row=dict(declaration,targetBox=placements[key]['sourceRegion'])
        revision._box(row['targetBox'],size)
        if any(not row['targetBox'][1]+3<y<row['targetBox'][3]-3 for y in row.get('horizontalDividerTargets',[])):
            raise ValueError('HOST_LAYOUT_DIVIDER_OUTSIDE_TARGET')
        if any(not row['targetBox'][1]+3<y<row['targetBox'][3]-3
               for band in row.get('horizontalBandTargets',[]) for y in band):
            raise ValueError('HOST_LAYOUT_BAND_OUTSIDE_TARGET')
        materials.append(row)
    record(root/'frozen-layout-contract.json',dict(kind=KIND,policy=POLICY,
        contractSha256=contract_sha,contractOrigin=origin,referenceSha256=reference_sha,
        **({'internalTargetsPolicy':config['layoutInternalTargetsPolicy']} if config.get('layoutInternalTargetsPolicy') else {}),
        planningBindings={name:digest(snapshot/name) for name in
            ('reference.png','placements.json',visual_path.relative_to(snapshot).as_posix())},
        materials=materials,constraints=contract['constraints'],knownDifferences=contract['knownDifferences']))


def divider_rows(image, threshold):
    """Conservative full-width dark-line candidates; ambiguous counts stay warnings."""
    if image.width*image.height>16_777_216 or max(image.size)>8192:
        raise ValueError('LAYOUT_RENDER_PIXEL_LIMIT')
    pixels=np.array(image.convert('RGBA'));alpha=pixels[:,:,3]
    box=Image.fromarray(alpha).point(lambda a:255 if a>=threshold else 0).getbbox()
    if box is None:return []
    left,top,right,bottom=box;width=right-left;height=bottom-top
    margin=max(4,round(width*.08));guard=max(8,min(40,round(height*.06)))
    if right-left<=2*margin or height<=2*guard+8:return []
    rgb=pixels[top:bottom,left+margin:right-margin,:3].astype(float)
    opaque=alpha[top:bottom,left+margin:right-margin]>=threshold
    luma=rgb @ np.array([.2126,.7152,.0722])
    hits=[]
    for y in range(guard,height-guard):
        above=np.median(luma[[y-4,y-3]],axis=0)
        below=np.median(luma[[y+3,y+4]],axis=0)
        # A divider is a narrow trough with lighter surface on BOTH sides.
        # A section-band step is darker on only one side; pooled neighbors
        # previously admitted those edges as extra divider candidates.
        delta=np.minimum(above,below)-luma[y]
        surface_above=np.median(luma[[y-8,y-6]],axis=0)
        surface_below=np.median(luma[[y+6,y+8]],axis=0)
        same_surface=np.abs(surface_above-surface_below)<=6
        rows=[y-8,y-6,y-4,y-3,y,y+3,y+4,y+6,y+8]
        if opaque[rows].mean()>=.95 and ((delta>=1.5)&same_surface).mean()>=.75:
            hits.append((top+y,float(np.median(delta))))
    groups=[]
    for y,score in hits:
        if not groups or y>groups[-1][-1][0]+1:groups.append([])
        groups[-1].append((y,score))
    return [max(group,key=lambda row:row[1])[0] for group in groups if len(group)<=6]


def rendered_divider_checks(delivery, declarations):
    """Check actual stored layer pixels in original coordinates after remapping."""
    delivery=Path(delivery);view=read(delivery/'viewport.json')
    composition=read(delivery/'package/composition.json')
    layers={row['id']:row for row in composition['layers']};checks=[]
    for declaration in declarations:
        targets=declaration.get('horizontalDividerTargets',[])
        if not targets:continue
        row=layers[declaration['materialId']]
        with Image.open(delivery/'package'/row['path']) as image:
            found=[y+row['y']-view['worldShift'][1]
                   for y in divider_rows(image,declaration['measurementAlphaThreshold'])]
        residuals=[a-b for a,b in zip(found,targets)] if len(found)==len(targets) else None
        checks.append(dict(materialId=declaration['materialId'],declaredTargetRows=targets,
            detectedRenderedRows=found,residualPixels=residuals,tolerancePixels=2,
            geometryPassed=residuals is not None and all(abs(v)<=2 for v in residuals),
            measurementBasis='post-render-dark-line-heuristic; not semantic acceptance'))
    return checks


def band_rows(image, threshold):
    """Pair full-width dark section steps; narrow lines and unpaired steps stay unresolved."""
    if image.width*image.height>16_777_216 or max(image.size)>8192:
        raise ValueError('LAYOUT_RENDER_PIXEL_LIMIT')
    pixels=np.array(image.convert('RGBA'));alpha=pixels[:,:,3]
    box=Image.fromarray(alpha).point(lambda a:255 if a>=threshold else 0).getbbox()
    if box is None:return []
    left,top,right,bottom=box;margin=max(4,round((right-left)*.08))
    if right-left<=2*margin or bottom-top<32:return []
    rgb=pixels[:,left+margin:right-margin,:3].astype(float)
    opaque=alpha[:,left+margin:right-margin]>=threshold
    luma=rgb @ np.array([.2126,.7152,.0722]);hits=[]
    for y in range(top+9,bottom-9):
        if opaque[[y-6,y-3,y+3,y+6]].mean()<.95:continue
        delta=np.median(luma[y+2:y+6],axis=0)-np.median(luma[y-6:y-2],axis=0)
        direction=-1 if (delta<=-4).mean()>=.75 else 1 if (delta>=4).mean()>=.75 else 0
        if direction:hits.append((y,direction,abs(float(np.median(delta)))))
    groups=[]
    for row in hits:
        if not groups or row[0]>groups[-1][-1][0]+1 or row[1]!=groups[-1][-1][1]:groups.append([])
        groups[-1].append(row)
    edges=[]
    for group in groups:
        if len(group)>12:continue  # Broad lighting gradients are not section edges.
        best=max(r[2] for r in group)
        plateau=[r[0] for r in group if r[2]>=best-.1]
        edges.append((round(sum(plateau)/len(plateau)),group[0][1]))
    bands=[];opening=None
    for y,direction in edges:
        if direction<0:
            if opening is not None:return []
            opening=y
        elif opening is not None:
            if y-opening>=12:bands.append([opening,y])
            opening=None
    return [] if opening is not None else bands


def rendered_band_checks(delivery, declarations):
    delivery=Path(delivery);view=read(delivery/'viewport.json')
    layers={row['id']:row for row in read(delivery/'package/composition.json')['layers']}
    checks=[]
    for declaration in declarations:
        targets=declaration.get('horizontalBandTargets',[])
        if not targets:continue
        row=layers[declaration['materialId']]
        with Image.open(delivery/'package'/row['path']) as image:
            offset=row['y']-view['worldShift'][1]
            found=[[y+offset for y in band] for band in band_rows(image,declaration['measurementAlphaThreshold'])]
        residuals=[[a-b for a,b in zip(actual,target)] for actual,target in zip(found,targets)] if len(found)==len(targets) else None
        checks.append(dict(materialId=declaration['materialId'],declaredTargetBands=targets,
            detectedRenderedBands=found,residualPixels=residuals,tolerancePixels=2,
            geometryPassed=residuals is not None and all(abs(v)<=2 for pair in residuals for v in pair),
            measurementBasis='post-render-full-width-section-step-heuristic; not semantic acceptance'))
    return checks


def finish(root, config):
    """Run the bound candidate step; never catch hash/path/package failures."""
    root=Path(root)
    if config.get('layoutRegistrationPolicy')!=POLICY:
        return dict(status='preserved',delivery='diagnostic-output/delivery',warnings=[])
    if not (config.get('layoutContract') or config.get('layoutPlanningPolicy')==PLANNING):
        return dict(status='not-declared',delivery='diagnostic-output/delivery',warnings=[dict(
            category='layout-placement',severity='warning',code='LAYOUT_CONTRACT_NOT_DECLARED',
            suggestion='Declare frame modes, divider targets and related-control constraints before image compute.')])
    frozen=verified(root/'frozen-layout-contract.json')
    _,contract_sha,origin=_contract(root,config)
    if (frozen['contractSha256']!=contract_sha or frozen.get('contractOrigin','input-sidecar')!=origin):
        raise ValueError('HOST_LAYOUT_CONTRACT_CHANGED')
    if frozen.get('internalTargetsPolicy')!=config.get('layoutInternalTargetsPolicy'):
        raise ValueError('HOST_LAYOUT_INTERNAL_POLICY_CHANGED')
    for name,sha in frozen['planningBindings'].items():
        if digest(root/'frozen'/name)!=sha:raise ValueError('HOST_LAYOUT_PLANNING_CHANGED')
    base=root/'diagnostic-output';sources=read(base/'native-material-sources.json')['materials']
    excluded=set(read(base/'result.json').get('excludedUncertainMaterialIds',[])) if (base/'result.json').exists() else set()
    if excluded:
        from .host_sheet_fallback import COMPOSITE_POLICIES
        if config.get('sheetCompositePolicy') not in COMPOSITE_POLICIES:
            raise ValueError('HOST_LAYOUT_UNBOUND_EXCLUDED_MATERIALS')
    warnings=[];materials=[]
    constraints=[c for c in frozen['constraints'] if all(c[end]['materialId'] not in excluded for end in ('a','b'))]
    missing_constraints=[c for c in frozen['constraints'] if c not in constraints]
    if excluded:
        warnings.append(dict(category='layout-placement',severity='warning',
            code='LAYOUT_EXCLUDED_UNCERTAIN_SHEET_MATERIALS',materialIds=sorted(excluded),
            unresolvedConstraintIds=[c['id'] for c in missing_constraints],layoutAccepted=False))
    for declaration in frozen['materials']:
        if declaration['materialId'] in excluded:continue
        row=deepcopy(declaration);targets=row.pop('horizontalDividerTargets',[])
        bands=row.pop('horizontalBandTargets',[]);landmarks=[]
        value=sources[row['materialId']]
        if digest(Path(value['path']))!=value['sha256']:raise ValueError('HOST_LAYOUT_SOURCE_CHANGED')
        row['sourceOverride']=dict(value)
        if row['mode']=='uniform' and (targets or bands):
            if frozen.get('internalTargetsPolicy')!=UNIFORM_OBSERVATION:
                raise ValueError('HOST_LAYOUT_UNIFORM_TARGET_POLICY_REQUIRED')
            # Targets stay in the frozen contract and post-render checks. They
            # never grant permission to deform complete illustrated artwork.
            warnings.append(dict(category='layout-placement',severity='warning',
                code='LAYOUT_UNIFORM_INTERNAL_TARGETS_OBSERVE_ONLY',materialId=row['materialId'],
                declaredTargetRows=targets,declaredTargetBands=bands,
                internalWarpPerformed=False,internalGeometryAccepted=False))
            materials.append(row);continue
        if targets:
            with Image.open(value['path']) as image:found=divider_rows(image,row['measurementAlphaThreshold'])
            if len(found)==len(targets):
                landmarks.extend([[source+delta,target+delta/2] for source,target in zip(found,targets) for delta in (-2,0,2)])
            else:
                warnings.append(dict(category='layout-placement',severity='warning',
                    code='LAYOUT_DIVIDER_CORRESPONDENCE_UNRESOLVED',materialId=row['materialId'],
                    detectedSourceRows=found,declaredTargetRows=targets,internalRowsAccepted=False))
        if bands:
            with Image.open(value['path']) as image:found_bands=band_rows(image,row['measurementAlphaThreshold'])
            if len(found_bands)==len(bands):
                landmarks.extend([source+delta,target+delta] for actual,expected in zip(found_bands,bands)
                                 for source,target in zip(actual,expected) for delta in (-2,0,2))
            else:
                warnings.append(dict(category='layout-placement',severity='warning',
                    code='LAYOUT_BAND_CORRESPONDENCE_UNRESOLVED',materialId=row['materialId'],
                    detectedSourceBands=found_bands,declaredTargetBands=bands,internalBandsAccepted=False))
        if landmarks:row['yLandmarks']=sorted(landmarks)
        materials.append(row)
    archive=base/'delivery/viewport-ui-layers.zip'
    if not materials:
        return dict(status='unresolved',delivery='diagnostic-output/delivery',warnings=warnings,
            layoutConstraintsPassed=False,generationCalls=0,modelCalls=0,humanVisualAcceptance=False)
    plan=dict(kind=revision.KIND,policy=revision.POLICY,sourceArchive=str(archive),
        sourceArchiveSha256=digest(archive),originalReferenceSha256=frozen['referenceSha256'],
        materials=materials,constraints=constraints,knownDifferences=[*frozen['knownDifferences'],
            *['Layout warning: '+row['code'] for row in warnings]])
    save(root/'layout-selection.json',plan)
    # Only geometry-unresolved outcomes may retain the verified base delivery.
    # Source, provenance, schema, bounds, output and integrity failures still stop.
    try:result=revision.revise(root/'layout-selection.json',root/'layout-output',config['viewer'])
    except ValueError as error:
        if str(error) not in ('LAYOUT_MONOTONE_ANCHORS_REQUIRED','LAYOUT_SUBPIXEL_CELL_COLLAPSED',
                             'LAYOUT_LANDMARK_OUTSIDE_BODY','LAYOUT_EMPTY_MEASURED_PROXY','LAYOUT_EMPTY_RENDERED_PROXY'):
            raise
        warnings.append(dict(category='layout-placement',severity='warning',code='LAYOUT_GEOMETRY_UNRESOLVED',
            reason=str(error),candidateSelected=False))
        return dict(status='unresolved',delivery='diagnostic-output/delivery',warnings=warnings,
            generationCalls=0,modelCalls=0,humanVisualAcceptance=False)
    warnings.extend(dict(category='layout-placement',severity='warning',code='LAYOUT_CONSTRAINT_RESIDUAL',
        constraint=row) for row in result['constraints'] if not row['passed'])
    measured=[row for row in frozen['materials'] if row['materialId'] not in excluded]
    internal=rendered_divider_checks(root/'layout-output/delivery',measured)
    band_checks=rendered_band_checks(root/'layout-output/delivery',measured)
    unresolved={w.get('materialId') for w in warnings if w['code']!='LAYOUT_UNIFORM_INTERNAL_TARGETS_OBSERVE_ONLY'}
    warnings.extend(dict(category='layout-placement',severity='warning',code='LAYOUT_RENDERED_DIVIDERS_UNRESOLVED',
        **row,internalRowsAccepted=False) for row in internal if not row['geometryPassed'] and row['materialId'] not in unresolved)
    warnings.extend(dict(category='layout-placement',severity='warning',code='LAYOUT_RENDERED_BANDS_UNRESOLVED',
        **row,internalBandsAccepted=False) for row in band_checks if not row['geometryPassed'] and row['materialId'] not in unresolved)
    summary=dict(status=result['status'],delivery='layout-output/delivery',warnings=warnings,
        frozenContractSha256=digest(root/'frozen-layout-contract.json'),
        selectionSha256=digest(root/'layout-selection.json'),
        resultSha256=digest(root/'layout-output/result.json'),
        internalDividerChecks=internal,internalDividerChecksPassed=all(row['geometryPassed'] for row in internal),
        internalBandChecks=band_checks,internalBandChecksPassed=all(row['geometryPassed'] for row in band_checks),
        internalStructureChecksPassed=all(row['geometryPassed'] for row in [*internal,*band_checks]),
        structureMeasurementScope='declared-bands-and-dividers-only',unmodeledGeometryAccepted=False,
        layoutConstraintsPassed=result['layoutConstraintsPassed'] and not excluded,
        excludedUncertainMaterialIds=sorted(excluded),unresolvedConstraintIds=[c['id'] for c in missing_constraints],
        generationCalls=0,modelCalls=0,humanVisualAcceptance=False)
    save(root/'layout-output/host-layout-summary.json',summary)
    return summary
