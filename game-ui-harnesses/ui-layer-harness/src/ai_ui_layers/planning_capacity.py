"""Read-only request accounting before independent M2; never changes a plan."""
from PIL import Image
from pathlib import Path

from .evaluate import read, digest, pixel_box
from .experimental_executor import record, verified
from .generation_groups import build_groups, configured_policy

POLICY = 'source-geometry-request-capacity-v1'
NAME = 'planning-capacity.json'


def configure(config, fresh):
    if fresh:
        config.setdefault('planningCapacityPolicy',POLICY)
        if config['generationMode']=='sheets':
            from .generation_groups import COMPACT_CONTROL_V5
            config.setdefault('generationGroupingPolicy',COMPACT_CONTROL_V5)
    if 'planningCapacityPolicy' in config and (not fresh or config['planningCapacityPolicy']!=POLICY):
        raise ValueError('FRESH_PLANNING_CAPACITY_POLICY_REQUIRED')


def estimate(visual, size, config):
    """Use exactly the compiler's pixel sizes/order, without requiring M2 evidence.

    This checks capacity only. It cannot certify ownership, relations or fidelity.
    In particular it never merges material identities, edits labels or scales down
    an asset in order to meet an authorization ceiling.
    """
    assets=[]
    for material in sorted(visual['materials'],key=lambda m:(m['zOrder'],m['id'])):
        l,t,r,b=pixel_box(material['bboxNorm'],*size)
        assets.append(dict(id=material['id'],
            role='background' if material['role']=='background' else 'important_component',
            output_size=[r-l,b-t]))
    mode=config.get('generationMode','sheets')
    policy=configured_policy(config,mode,'context-crops')
    groups=(build_groups(visual,dict(assets=assets),policy) if mode=='sheets' else
        dict(materialCount=len(assets),plannedCalls=len(assets),groups=[dict(
            id=a['id'],mode='single',materialIds=[a['id']]) for a in assets]))
    from .host_sheet_fallback import final_composite_first
    bodies=0 if final_composite_first(config) else sum(m['role']=='foreground' for m in visual['materials'])
    from .composite_review import required_calls
    required=dict(images=groups['plannedCalls'],materialReviews=required_calls(config,groups['plannedCalls']),bodyObservations=bodies)
    limits=dict(images=config['maximumImageCalls'],materialReviews=config['maximumMaterialReviews'],
        bodyObservations=config['maximumBodyCalls'])
    exceeded=[key for key,value in required.items() if value>limits[key]]
    return dict(materialCount=len(assets),generationMode=mode,
        **(dict(groupingPolicy=policy) if mode=='sheets' else {}),
        plannedCalls=groups['plannedCalls'],sheetCalls=sum(g['mode']=='sheet' for g in groups['groups']),
        standaloneCalls=sum(g['mode']=='single' for g in groups['groups']),groups=groups['groups'],
        requiredCalls=required,maximumCalls=limits,exceeded=exceeded,
        status='capacity_exceeded' if exceeded else 'within_capacity')


def _expected(root,config):
    from .host_planning import candidate
    source=candidate(root);reference=root/'planning-m1/reference.png'
    with Image.open(reference) as image:size=image.size
    return dict(kind='ui_planning_capacity_v1',policy=POLICY,configDigest=config['digest'],
        sourcePlanSha256=digest(source),referenceSha256=digest(reference),canvas=list(size),
        **estimate(read(source),size,config),generationCalls=0,modelCalls=0,
        planningReviewExecuted=False,visualAcceptanceAsserted=False)


def prepare(root,config):
    if config.get('planningCapacityPolicy')!=POLICY:return
    result=record(report_path(root),_expected(root,config))
    if result['exceeded']:
        raise ValueError('FINITE_DOWNSTREAM_CAPACITY_EXCEEDED_BEFORE_M2')


def verify_frozen(root,config):
    if config.get('planningCapacityPolicy')!=POLICY:return
    report=verified(report_path(root))
    if {k:v for k,v in report.items() if k!='digest'}!=_expected(root,config):
        raise ValueError('PLANNING_CAPACITY_REPORT_CHANGED')
    frozen=root/'frozen'
    rows=read(frozen/'requests.json')['requests']
    if len(rows)!=report['plannedCalls'] or report['exceeded']:
        raise ValueError('FROZEN_PLANNING_CAPACITY_CHANGED')
    if report['generationMode']=='sheets':
        groups=read(frozen/'generation-groups.json')
        if groups['policy']!=report['groupingPolicy'] or groups['groups']!=report['groups']:
            raise ValueError('FROZEN_PLANNING_GROUPS_CHANGED')
    elif [r['asset'] for r in rows]!=[g['id'] for g in report['groups']]:
        raise ValueError('FROZEN_PLANNING_GROUPS_CHANGED')


def report_path(root):
    root=Path(root)
    return root/'planning-repaired-capacity.json' if (root/'planning-candidates/repaired').exists() else root/NAME
