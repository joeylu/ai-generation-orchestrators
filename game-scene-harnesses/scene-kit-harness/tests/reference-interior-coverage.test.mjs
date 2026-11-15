import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceStructure,reviewReferenceFeatureLayout} from '../src/reference-feature-layout.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {hash,seal} from '../src/generation/common.mjs';

test('matching frame corners do not certify an omitted internal crossbar or opening partition',()=>{
  // Synthetic industrial rack: the four fixed outer corners are unchanged,
  // but the internal crossbar moves from the upper to the lower opening.
  const corners=[{x:80,y:100},{x:400,y:100},{x:80,y:300},{x:400,y:300}],rgba=Buffer.alloc(512*512*4);
  for(let y=100;y<=300;y++)for(let x=80;x<=400;x++)
    if(x<=90||x>=390||y<=110||y>=290||y>=245&&y<=255)rgba.set([90,110,140,255],(y*512+x)*4);
  const raw=encodeRgbaPng(512,512,rgba),ref='a'.repeat(64);
  const plan=seal({recipe:{assetId:'rack.actual'},referenceEvidence:[{rawSha256:ref}],instanceBinding:{subjectId:'rack'}});
  const asset={instanceId:'rack.actual',subjectId:'rack',features:corners.map((p,i)=>({featureId:'corner.'+i,
    description:'Fixed outer rack corner '+i,target:{x:50+p.x/4,y:20+p.y/4},toleranceWorld:1})),
    checks:[{checkId:'opening.partition',description:'Retain the internal crossbar in the upper portion of the opening.'}]};
  const structure=createReferenceStructure({referenceRawSha256:ref,viewport:{width:256,height:144},assets:[asset]});
  const measurement={instanceId:'rack.actual',sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),
    features:corners.map((native,i)=>({featureId:'corner.'+i,native})),checks:[{checkId:'opening.partition',verdict:'pass'}]};
  const run=(s,m)=>reviewReferenceFeatureLayout({structure:s,sources:[{plan,raw}],measurements:[m]});
  // Deliberately incomplete observations expose the checker limitation: it does
  // not recognize the image or correct an inaccurate Agent check verdict.
  const incomplete=run(structure,measurement);
  assert.equal(incomplete.status,'reviewed');assert.equal(incomplete.automaticImageUnderstanding,false);
  assert(incomplete.rows[0].points.every(p=>p.error<1e-9));
  const observed={...measurement,checks:[{checkId:'opening.partition',verdict:'fail'}]};
  const blocked=run(structure,observed);
  assert.equal(blocked.status,'blocked');assert(blocked.rows[0].issues.includes('REFERENCE_STRUCTURE_UNCONFIRMED'));
  assert.deepEqual(blocked.rows[0].points,incomplete.rows[0].points);

  // A separate, more complete design contract records the interior landmark
  // before a future freeze; it never mutates the old structure or tolerance.
  const complete=createReferenceStructure({referenceRawSha256:ref,viewport:{width:256,height:144},assets:[{
    ...asset,features:[...asset.features,{featureId:'crossbar.center',description:'Visible internal crossbar center; function need not be inferred.',target:{x:110,y:57.5},toleranceWorld:1}]
  }]});
  const measured={...measurement,features:[...measurement.features,{featureId:'crossbar.center',native:{x:240,y:250}}]};
  const explicit=run(complete,measured);
  assert.equal(explicit.status,'blocked');assert(explicit.rows[0].issues.includes('REFERENCE_FEATURE_SHAPE_MISMATCH'));
  assert.equal(structure.assets[0].features.length,4);assert.notEqual(complete.sha256,structure.sha256);
  assert.equal(explicit.sourcePngModified,false);assert.equal(explicit.generationCalls,0);
});
