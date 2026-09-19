"""Measured internal registration; no image recognition or pixel modification."""
import math
import numpy as np
from . import batch
from .common import digest, require, safe_relative, sha256, load_verified_image
from .process import read_materials


def _rect(value, size):
    require(isinstance(value,list) and len(value)==4 and
            all(type(v) in (int,float) and math.isfinite(v) for v in value), 'REGISTRATION_RECT')
    x,y,w,h=value
    require(min(x,y)>=0 and min(w,h)>0 and x+w<=size[0] and y+h<=size[1], 'REGISTRATION_BOUNDS')
    return np.array([[x,y],[x+w,y],[x,y+h],[x+w,y+h]],dtype=float)


def review(run, specification):
    run=run.resolve();frozen,plan=batch.load(run);materials=read_materials(run)
    s=specification
    require(isinstance(s,dict) and set(s)=={'kind','planDigest','materialsDigest','referenceSha256',
            'materialSha256','node','landmarks','basis'} and s['kind']=='ui_assets_registration_v1', 'REGISTRATION_FIELDS')
    require(s['planDigest']==digest(plan) and s['materialsDigest']==materials['digest'] and
            materials['plan_digest']==digest(plan) and materials['batch_digest']==frozen['digest'], 'REGISTRATION_BINDING')
    reference=run/'input/reference.png'
    require(sha256(reference)==s['referenceSha256']==frozen['source_sha256'], 'REGISTRATION_REFERENCE_CHANGED')
    require(isinstance(s['basis'],str) and s['basis'].strip(), 'REGISTRATION_BASIS')
    node=next((n for n in plan['nodes'] if n['id']==s['node']),None)
    require(node is not None,'REGISTRATION_NODE')
    material=next(m for m in materials['assets'] if m['asset']==node['asset'])
    path=safe_relative(run,material['path'])
    picture,evidence=load_verified_image(path)
    require(evidence['sha256']==material['sha256']==s['materialSha256'], 'REGISTRATION_MATERIAL_CHANGED')
    rows=s['landmarks'];require(isinstance(rows,list) and 3<=len(rows)<=128,'REGISTRATION_LANDMARK_COUNT')
    expected=[];actual=[];results=[];ids=set();unknown=[]
    for row in rows:
        require(isinstance(row,dict) and set(row)=={'id','reference','observed'},'REGISTRATION_LANDMARK_FIELDS')
        key=row['id'];require(isinstance(key,str) and key.strip() and key not in ids,'REGISTRATION_LANDMARK_ID');ids.add(key)
        target=_rect(row['reference'],plan['canvas'])
        if row['observed'] is None:
            unknown.append(key);continue
        observed=_rect(row['observed'],picture.size)+np.array(node['xy'])
        error=float(np.abs(target-observed).max())
        results.append(dict(id=key,maxEdgeErrorPixels=error,passed=error<=2.0))
        expected.extend(target);actual.extend(observed)
    result=dict(kind='ui_assets_registration_review_v1',specificationDigest=digest(s),
                planDigest=digest(plan),materialsDigest=materials['digest'],node=s['node'],
                tolerancePixels=2.0,landmarks=results,unknown=unknown,generationCalls=0,
                humanVisualAcceptance=False,automaticSemanticInference=False,
                scope='Caller-measured rectangles only; fit is diagnostic, not an authorized transform or full-image fidelity check.')
    if unknown:
        result.update(status='blocked',classification='unknown-landmarks',uniformFit=None)
    else:
        a=np.asarray(actual);b=np.asarray(expected)
        # Least-squares isotropic scale plus translation; no shear or unequal-axis stretch.
        ac=a-a.mean(axis=0);bc=b-b.mean(axis=0)
        scale=float((ac*bc).sum()/(ac*ac).sum());offset=b.mean(axis=0)-scale*a.mean(axis=0)
        residual=float(np.abs(scale*a+offset-b).max())
        aligned=all(r['passed'] for r in results)
        result.update(status='passed' if aligned else 'blocked',
                      classification='aligned' if aligned else
                      ('uniform-transform-candidate' if scale>0 and residual<=2.0 else 'internal-layout-drift'),
                      uniformFit=dict(scale=scale,translation=offset.tolist(),maxResidualPixels=residual,
                                      applied=False,requiresFullMaterialReview=True))
    result['digest']=digest(result)
    return result
