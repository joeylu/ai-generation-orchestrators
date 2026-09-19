"""Caller-reviewed reference inventory; structural coverage, not image recognition."""
from copy import deepcopy
from pathlib import Path
from .common import digest, identifier, read_json, require, write_json


def check(plan, coverage):
    require(isinstance(coverage,dict) and set(coverage)=={'kind','sourceSha256','review','elements'} and
            coverage['kind']=='ui_reference_coverage_v1','COVERAGE_FIELDS')
    require(coverage['sourceSha256']==plan['source']['sha256'],'COVERAGE_REFERENCE_CHANGED')
    review=coverage['review']
    require(isinstance(review,dict) and set(review)=={'inventoryReviewed','removalsReviewed','basis'} and
            all(type(review[k]) is bool for k in ('inventoryReviewed','removalsReviewed')) and
            isinstance(review['basis'],str) and bool(review['basis'].strip()),'COVERAGE_REVIEW_FIELDS')
    rows=coverage['elements'];require(isinstance(rows,list) and 0<len(rows)<=512,'COVERAGE_ELEMENTS')
    assets={a['id'] for a in plan['assets']};seen=set();owned=set();issues=[];excluded=[]
    if not all(review[k] for k in ('inventoryReviewed','removalsReviewed')):
        issues.append('COVERAGE_REVIEW_PENDING')
    for row in rows:
        require(isinstance(row,dict) and {'id','label','region','disposition','ownerAssets','removedBy','reason'} <= set(row)
                <= {'id','label','region','disposition','ownerAssets','removedBy','reason','reuse'},'COVERAGE_ELEMENT_FIELDS')
        key=identifier(row['id']);require(key not in seen,'COVERAGE_DUPLICATE_ELEMENT');seen.add(key)
        require(isinstance(row['label'],str) and bool(row['label'].strip()) and isinstance(row['reason'],str),'COVERAGE_LABEL')
        rect=row['region'];require(isinstance(rect,list) and len(rect)==4 and all(type(v)is int for v in rect),'COVERAGE_REGION')
        x,y,w,h=rect;cw,ch=plan['canvas'];require(x>=0 and y>=0 and w>0 and h>0 and x+w<=cw and y+h<=ch,'COVERAGE_REGION')
        for field in ('ownerAssets','removedBy'):
            values=row[field];require(isinstance(values,list) and all(isinstance(v,str) for v in values) and
                len(values)==len(set(values)) and set(values)<=assets,'COVERAGE_ASSET_REFERENCE')
        owners=set(row['ownerAssets']);removed=set(row['removedBy'])
        disposition=row['disposition'];require(disposition in {'material','excluded','unresolved'},'COVERAGE_DISPOSITION')
        if disposition=='material':
            if not owners:issues.append('COVERAGE_OWNER_MISSING:'+key)
            if owners & removed:issues.append('COVERAGE_OWNER_REMOVES_ELEMENT:'+key)
            owned.update(owners)
        elif disposition=='excluded':
            require(not owners and bool(row['reason'].strip()),'COVERAGE_EXCLUSION_REASON')
            excluded.append(dict(id=key,label=row['label'],reason=row['reason']))
        else:issues.append('COVERAGE_ELEMENT_UNRESOLVED:'+key)
        if removed and not owners and disposition!='excluded':issues.append('COVERAGE_REMOVED_WITHOUT_OWNER:'+key)
    by_id={r['id']:r for r in rows}
    for row in rows:
        if 'reuse' not in row:continue
        reuse=row['reuse']
        require(isinstance(reuse,dict) and set(reuse)=={'element','reason'} and
                isinstance(reuse['element'],str) and reuse['element'] in by_id and
                isinstance(reuse['reason'],str) and bool(reuse['reason'].strip()),'COVERAGE_REUSE_FIELDS')
        canonical=by_id[reuse['element']]
        require(canonical is not row and 'reuse' not in canonical and
                row['disposition']==canonical['disposition']=='material' and
                len(row['ownerAssets'])==1 and row['ownerAssets']==canonical['ownerAssets'] and
                row['region'][2:]==canonical['region'][2:], 'COVERAGE_REUSE_MAPPING')
    issues.extend('COVERAGE_ASSET_UNACCOUNTED:'+a for a in sorted(assets-owned))
    result=dict(kind='ui_reference_coverage_check_v1',status='passed' if not issues else 'blocked',
        sourceSha256=coverage['sourceSha256'],coverageDigest=digest(coverage),issues=issues,exclusions=excluded,
        declaredElements=len(rows),automaticSemanticInference=False,humanVisualAcceptance=False,
        scope='Checks the declared inventory only; cannot detect an element omitted from that inventory.')
    result['digest']=digest(result)
    return result


def require_coverage(plan):
    require('reference_coverage' in plan,'REFERENCE_COVERAGE_REQUIRED')
    result=check(plan,plan['reference_coverage'])
    require(result['status']=='passed','REFERENCE_COVERAGE_BLOCKED:'+','.join(result['issues']))
    return result


def bind(plan_path,coverage_path,output):
    from .contract import validate
    plan_path,output=Path(plan_path).resolve(),Path(output).resolve()
    # Preserve all relative source paths by placing the new plan beside the old.
    require(output.parent==plan_path.parent,'COVERAGE_PLAN_SAME_DIRECTORY_REQUIRED')
    plan=read_json(plan_path);validate(plan,source_base=plan_path.parent)
    plan['reference_coverage']=read_json(coverage_path)
    report=require_coverage(plan);validate(plan,source_base=plan_path.parent)
    write_json(output,plan)
    return dict(status='coverage_bound_no_generation',planDigest=digest(plan),coverage=report,generationCalls=0)


def remap(coverage,mapping):
    result=deepcopy(coverage)
    for row in result['elements']:
        original_owners=set(row['ownerAssets'])
        owners={mapping.get(k,k) for k in original_owners}
        # Cross-slot exclusions do not remove artwork from the whole board.
        # Keep genuine self-removal conflicts visible at the mapped scope.
        row['removedBy']=sorted({mapping.get(k,k) for k in row['removedBy']
            if mapping.get(k,k) not in owners or k in original_owners})
        row['ownerAssets']=sorted(owners)
    return result
