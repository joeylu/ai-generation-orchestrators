"""Candidate/reference-bound pair review. AABB hints never prove alpha overlap."""
import copy
from pathlib import Path
from .review_evidence import _sha

POLICY = 'ui-relation-review-v1'
NAME = 'relation-catalog.json'

def policy(root):
    from .evaluate import read
    path = Path(root)/'.dag/config.json'
    value = read(path).get('relationReviewPolicy') if path.exists() else None
    if value not in (None, POLICY):
        raise ValueError('RELATION_REVIEW_POLICY_UNKNOWN')
    return value

def catalog(plan, reference_sha):
    import re
    if not isinstance(reference_sha,str) or re.fullmatch('[0-9a-f]{64}',reference_sha) is None:
        raise ValueError('RELATION_REFERENCE_DIGEST_REQUIRED')
    from .evaluate import check_relations
    pairs = [issue for issue in check_relations(plan)
             if issue['code'] == 'SAME_LAYER_OVERLAP_REVIEW']
    rows = [dict(pairId='pair-'+_sha(issue), issue=issue) for issue in pairs]
    body = dict(kind=POLICY, candidateDigest=_sha(plan), referenceSha256=reference_sha, pairs=rows)
    return dict(body, digest=_sha(body))

def bind_schema(schema, bound):
    result = copy.deepcopy(schema)
    props = {'catalogDigest': {'type':'string','enum':[bound['digest']]},
             'candidateDigest': {'type':'string','enum':[bound['candidateDigest']]},
             'referenceSha256': {'type':'string','enum':[bound['referenceSha256']]},
             'pairs': {'type':'object','additionalProperties':False,
                'required':[r['pairId'] for r in bound['pairs']],
                'properties':{r['pairId']:{'type':'object','additionalProperties':False,
                    'required':['disposition','sourceEvidence','ownershipEvidence'],
                    'properties':{'disposition':{'type':'string','enum':[
                        'non-occluding','real-occlusion','ownership-conflict','uncertain']},
                        'sourceEvidence':{'type':'string','minLength':1},
                        'ownershipEvidence':{'type':'string','minLength':1}}}
                    for r in bound['pairs']}}}
    result['properties']['relationReview'] = {'type':'object','additionalProperties':False,
        'required':list(props),'properties':props}
    result['required'].append('relationReview')
    return result

def assess(plan, reference_sha, review):
    from jsonschema import Draft202012Validator
    from .evaluate import check_relations
    bound = catalog(plan, reference_sha)
    schema = bind_schema({'properties':{},'required':[]},bound)['properties']['relationReview']
    Draft202012Validator(schema).validate(review.get('relationReview'))
    rows = review['relationReview']['pairs']
    blockers = [i for i in check_relations(plan) if i['code']!='SAME_LAYER_OVERLAP_REVIEW']
    for pair in bound['pairs']:
        item = rows[pair['pairId']]
        if not item['sourceEvidence'].strip() or not item['ownershipEvidence'].strip():
            raise ValueError('RELATION_REVIEW_EVIDENCE_EMPTY')
        if item['disposition']!='non-occluding':
            blockers.append(dict(pair['issue'], disposition=item['disposition'],
                sourceEvidence=item['sourceEvidence'], ownershipEvidence=item['ownershipEvidence']))
    return dict(kind='ui_relation_assessment_v1',catalog=bound,review=review['relationReview'],
                blockers=blockers, alphaOverlapMeasured=False, productionReady=False)

def validate_assessment(plan, reference_sha, evidence):
    expected = assess(plan, reference_sha, {'relationReview':evidence['review']})
    if evidence!=expected:
        raise ValueError('RELATION_ASSESSMENT_CHANGED')
    return expected['blockers']

def guidance(bound):
    import json
    return ('\n逐对关系合同 ui-relation-review-v1：relationReview 必须回填本目录摘要、候选摘要与原图摘要，'
        '并按 pairId 审查每一对。AABB交叉仅是提示，不证明实体相交或遮挡。'
        'non-occluding 仅当原图可确认双方完整轮廓互不遮挡且各自唯一归属，'
        'sourceEvidence 写两侧实际轮廓、间隙和交叉框区域位置，ownershipEvidence 写独立归属依据。'
        '真实遮挡用 real-occlusion，归属冲突用 ownership-conflict，不能确认用 uncertain；均为阻断。'
        '不得缩去斜边极值、任意改变深度或以零issues替代逐对证据。生成后仍须实际alpha/归属技术验收。\n'
        +json.dumps(bound,ensure_ascii=False,separators=(',',':'))+'\n')

def verify_stage(root, folder, plan):
    from .evaluate import read, digest
    root, folder = Path(root), Path(folder)
    review=read(folder/'draft.json'); request=read(folder/'request.json')
    expected=catalog(plan,digest(root/'m1/reference.png'))
    if NAME not in request['inputs'] or read(folder/NAME)!=expected:
        raise ValueError('RELATION_CATALOG_INPUT_REQUIRED_OR_CHANGED')
    if request.get('originalReferenceSha256')!=expected['referenceSha256']:
        raise ValueError('RELATION_REFERENCE_CHANGED')
    for name, sha in request['inputs'].items():
        if digest(folder/name)!=sha:raise ValueError('RELATION_REVIEW_INPUT_CHANGED')
    config=read(root/'.dag/config.json') if (root/'.dag/config.json').exists() else {}
    if config.get('planningDriver')=='host-model-exchange-v1':
        from .host_review import verify_exchange, verify_prepared
        verify_prepared(root)
        verify_exchange(read(folder/'exchange-provenance.json'),folder/'request.json',folder/'draft.json')
    else:
        transport=read(folder/'transport.json')
        if (transport.get('failure') or transport.get('unexpectedEvents') or
                transport.get('exitCode') != 0 or transport.get('turnCompleted') is not True or
                transport.get('responseSha256')!=digest(folder/'draft.json')):
            raise ValueError('RELATION_REVIEW_RECEIPT_INVALID')
    evidence=assess(plan,expected['referenceSha256'],review)
    if read(folder/'relation-assessment.json')!=evidence:
        raise ValueError('RELATION_ASSESSMENT_CHANGED')
    return evidence

def frozen_evidence(folder, snapshot, plan):
    from .evaluate import read, digest
    folder=Path(folder)
    if snapshot.get('relationReviewPolicy') is None:return None
    if snapshot['relationReviewPolicy']!=POLICY:raise ValueError('RELATION_REVIEW_POLICY_UNKNOWN')
    evidence=read(folder/'relation-assessment.json')
    validate_assessment(plan,digest(folder/'reference.png'),evidence)
    stage=snapshot['relationReviewStage']
    if stage not in ('m2','rereview','rereview2'):raise ValueError('RELATION_REVIEW_STAGE_INVALID')
    review=read(folder/'evidence'/(stage+'-draft.json'))
    prefix=folder/'evidence'/stage
    request=read(Path(str(prefix)+'-request.json'))
    stored_catalog=Path(str(prefix)+'-'+NAME)
    if (read(stored_catalog)!=catalog(plan,digest(folder/'reference.png')) or
            request.get('originalReferenceSha256')!=digest(folder/'reference.png') or
            request['inputs'].get(NAME)!=digest(stored_catalog)):
        raise ValueError('RELATION_FROZEN_CATALOG_MISMATCH')
    if snapshot.get('planningDriver')=='host-model-exchange-v1':
        from .host_review import verify_exchange
        verify_exchange(read(Path(str(prefix)+'-exchange-provenance.json')),
                        Path(str(prefix)+'-request.json'),Path(str(prefix)+'-draft.json'),
                        Path(str(prefix)+'-host-attestation.json'),
                        Path(str(prefix)+'-host-dispatch-evidence.bin'),
                        Path(str(prefix)+'-host-return-evidence.bin'))
    else:
        transport=read(Path(str(prefix)+'-transport.json'))
        if (transport.get('exitCode')!=0 or transport.get('turnCompleted') is not True or
                transport.get('failure') or transport.get('unexpectedEvents') or
                transport.get('responseSha256')!=digest(Path(str(prefix)+'-draft.json'))):
            raise ValueError('RELATION_FROZEN_RECEIPT_INVALID')
    if evidence!=assess(plan,digest(folder/'reference.png'),review):
        raise ValueError('RELATION_FROZEN_REVIEW_MISMATCH')
    if evidence['blockers']:raise ValueError('UNRESOLVED_PLAN_RELATIONS')
    return evidence
