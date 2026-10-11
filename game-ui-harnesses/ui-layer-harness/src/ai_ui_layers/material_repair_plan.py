"""Compile actionable ownership findings without retrying or modifying artwork."""
from pathlib import Path

from .evaluate import read, save, digest

POLICY='record-owned-material-repair-plan-v1'


def compile_plan(warnings, sources, reference_sha):
    actions={};evidence={};observed_actions={}
    for warning in warnings:
        if warning.get('code')!='OWNERSHIP_OBSERVATION_BLOCKED':continue
        mid=warning['materialId']
        if mid not in sources:raise ValueError('REPAIR_MATERIAL_SOURCE_REQUIRED')
        if warning['scope']=='foreign' and warning['state']=='present':
            action='remove-foreign-object'
        elif warning['scope']=='owned' and warning['state']=='missing':
            action='restore-owned-object'
        else:action='resolve-uncertain-ownership'
        key=(mid,warning.get('ownerMaterialId',mid),warning['objectId'])
        entry=dict(materialId=mid,objectId=warning['objectId'],
            ownerMaterialId=warning.get('ownerMaterialId',mid),action=action,
            evidence=warning['evidence'],sourceSha256=sources[mid]['sha256'])
        actions[key]=entry
        evidence.setdefault(key,set()).add(warning['evidence'])
        observed_actions.setdefault(key,set()).add(action)
    for key,entry in actions.items():
        entry['evidence']='\n'.join(sorted(evidence[key]))
        if len(observed_actions[key])>1:
            entry['action']='resolve-uncertain-ownership'
            entry['conflictingObservations']=True
    entries=[actions[key] for key in sorted(actions)]
    return dict(kind='ui_material_repair_plan_v1',policy=POLICY,
        status='repair-required' if entries else 'no-recorded-ownership-repair',
        referenceSha256=reference_sha,actions=entries,
        affectedMaterialIds=sorted({r['materialId'] for r in entries}),
        preservesOtherMaterials=True,automaticRetries=0,generationCalls=0,modelCalls=0,
        newBoundComputeAuthorizationRequired=bool(entries),
        visualAcceptanceAsserted=False,artworkModified=False)


def finish(root, config, warnings):
    if config.get('materialRepairPolicy')!=POLICY:return None
    root=Path(root)
    sources=read(root/'diagnostic-output/native-material-sources.json')['materials']
    for entry in sources.values():
        if digest(Path(entry['path']))!=entry['sha256']:raise ValueError('REPAIR_MATERIAL_SOURCE_CHANGED')
    result=compile_plan(warnings,sources,digest(root/'frozen/reference.png'))
    save(root/'material-repair-plan.json',result)
    return dict(path='material-repair-plan.json',sha256=digest(root/'material-repair-plan.json'),
        status=result['status'],affectedMaterialIds=result['affectedMaterialIds'],
        actionCount=len(result['actions']),artworkModified=False,automaticRetries=0)
