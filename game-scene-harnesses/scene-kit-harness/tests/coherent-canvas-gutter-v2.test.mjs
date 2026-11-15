import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,seal,unseal,jsonBytes} from '../src/generation/common.mjs';
import {assessCoherentSource} from '../src/generation/coherent-source.mjs';
import {compileCoherentBorderProposal,compileCoherentBorderPreparation} from '../src/generation/coherent-border.mjs';
import {compileCoherentCanvasGutterProposal,compileCoherentCanvasGutterPreparation} from '../src/generation/coherent-canvas-gutter.mjs';

const profile={profile:'low-alpha-margin-v2'},sha=n=>n.repeat(64);
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>!code||v.code===code));
const receipt=target=>({decisionId:'review.gutter',targetSha256:target,decision:'accept',notes:'Synthetic exact-preview acceptance only; no source-art or compute approval.'});
function fixture({width=320,height=256,status='rejected-technical',tailAlpha=7,bodyMargin=2,bodyAlpha=8,minWidth=256,maxWidth=4096,maxHeight=4096,legacy=false}={}){
  const rgba=Buffer.alloc(width*height*4);
  if(legacy){
    for(let y=60;y<height-60;y++)for(let x=6;x<width-6;x++)rgba.set([40+x%37,65+y%41,110,(x+y)%5?255:129],(y*width+x)*4);
    rgba.set([13,77,231,0],0);
    if(tailAlpha)rgba.set([110,51,71,tailAlpha],(130*width+1)*4);
  }else{
    // Every Alpha >=8 sample has exactly the specified all-sided gutter.
    for(let y=bodyMargin;y<height-bodyMargin;y++)for(let x=bodyMargin;x<width-bodyMargin;x++)rgba.set([40+x%37,65+y%41,110,bodyAlpha],(y*width+x)*4);
    rgba.set([13,77,231,0],0);
    // A soft native trail reaches the canvas; nothing deletes it.
    rgba.set([110,51,71,tailAlpha],(130*width)*4);
    rgba.set([29,211,73,1],(131*width+1)*4);
  }
  const raw=encodeRgbaPng(width,height,rgba),spec=sha('1'),style=sha('2'),reference=sha('3'),target=sha('4'),referenceRaw=sha('5');
  const plan=seal({format:'ai_scene_generation_plan_v27',recipe:{planId:'source.far',parents:[],stage:'coherent-source',specSha256:spec,styleSha256:style,
    referencePlans:[reference],targetSha256:target,assetId:'far'},referenceEvidence:[{rawSha256:referenceRaw}],designReviews:{spec:sha('6'),style:sha('7')},
    instanceBinding:{role:'backdrop',instanceId:'far.actual'},target:{assetId:'far',alpha:'transparent',sourcePolicy:{minimumWidth:minWidth,minimumHeight:256,maximumWidth:maxWidth,maximumHeight:maxHeight}},
    qualityPolicy:'strict',sourceScope:{profile:'isolated-layer-v4'},visualReviewChecklist:{visualAcceptance:'not-assessed'}});
  const technical=assessCoherentSource(plan,raw),result=seal({format:'ai_scene_image_result_v1',rawSha256:hash(raw),technical}),source={plan,status,result};
  const batch=seal({format:'ai_scene_coherent_source_batch_v1',batchId:'batch.original',referencePlanSha256:reference,targetSha256:target,planSha256s:[plan.sha256]});
  const state={activeSpec:spec,activeStyle:style,plans:new Map([[plan.sha256,source],[reference,{status:'accepted',reconstructionTarget:{sha256:target},result:{rawSha256:referenceRaw}}]]),batches:new Map([[batch.sha256,batch]])};
  const store={readBlob(digest){assert.equal(digest,hash(raw));return Buffer.from(raw);}};
  return {state,store,plan,source,batch,raw,rgba,technical};
}
const proposal=(f,options=profile)=>compileCoherentCanvasGutterProposal(f.store,f.state,f.plan.sha256,f.batch.sha256,options);
const prepare=(f,p)=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'prepared.gutter',proposal:p,receipt:receipt(p.sha256)});

test('explicit v2 accepts outer Alpha7 and visible Alpha8 gutter2, preserves all native RGBA and only adds zeros',()=>{
  const f=fixture(),before=jsonBytes({plans:[...f.state.plans],batches:[...f.state.batches]}),p=proposal(f);
  assert.deepEqual(f.technical.issues,['COHERENT_CLIPPED_SILHOUETTE']);
  assert.equal(p.proposal.format,'ai_scene_coherent_canvas_gutter_proposal_v2');assert.equal(p.proposal.rule.profile,'low-alpha-margin-v2');
  assert.equal(p.proposal.originalBorder.maximumAlpha,7);assert.deepEqual(p.proposal.bodyMargins,{left:2,top:2,right:2,bottom:2});
  assert.equal(p.proposal.rule.bodyAlphaThreshold,8);assert.equal(p.proposal.rule.maximumOriginalBorderAlpha,7);
  const original=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}),padded=inspectPng(p.bytes,{includePixels:true,allowHiddenRgb:true}),o=p.proposal.contentOffset;
  assert.deepEqual(o,{x:Math.ceil(original.width*12/76),y:Math.ceil(original.height*12/76)});
  assert.equal(padded.width,original.width+2*o.x);assert.equal(padded.height,original.height+2*o.y);
  for(let y=0;y<padded.height;y++){
    const row=padded.rgba.subarray(y*padded.width*4,(y+1)*padded.width*4);
    if(y<o.y||y>=o.y+original.height)assert.deepEqual(row,Buffer.alloc(row.length));
    else{
      assert.deepEqual(row.subarray(0,o.x*4),Buffer.alloc(o.x*4));
      assert.deepEqual(row.subarray(o.x*4,(o.x+original.width)*4),original.rgba.subarray((y-o.y)*original.width*4,(y-o.y+1)*original.width*4));
      assert.deepEqual(row.subarray((o.x+original.width)*4),Buffer.alloc(o.x*4));
    }
  }
  assert.equal(p.proposal.paddedRgbaSha256,hash(padded.rgba));assert.equal(p.proposal.technical.status,'pass');
  const {record,bytes}=prepare(f,p.proposal);
  assert.equal(record.format,'ai_scene_coherent_canvas_gutter_preparation_v2');assert.deepEqual(bytes,p.bytes);
  assert.equal(record.request.maximumCalls,0);assert.equal(record.originalAttemptOutcome,'rejected-technical');
  assert.equal(record.sourceArtAcceptance,'not-granted');assert.equal(record.proposal.hiddenGeometry,'not-recovered');
  assert.deepEqual(f.raw,original?encodeRgbaPng(original.width,original.height,original.rgba):null);
  assert.deepEqual(jsonBytes({plans:[...f.state.plans],batches:[...f.state.batches]}),before);
});

test('v2 boundary rejects outer Alpha8, visible Alpha8 gutter1, empty Alpha8 body and nonfailed sources',()=>{
  for(const options of [{tailAlpha:8},{bodyMargin:1},{bodyAlpha:7},{tailAlpha:1},{status:'pending-visual-review'},{status:'accepted'},{status:'indeterminate'}]){
    const f=fixture(options);rejects(()=>proposal(f));
  }
  // Alpha8 exactly two pixels from every edge remains eligible even though old body16 is empty.
  assert.equal(proposal(fixture({tailAlpha:2})).proposal.technical.status,'pass');
  const tooSmall=fixture({maxWidth:400});rejects(()=>proposal(tooSmall),'COHERENT_CANVAS_GUTTER_SIZE');
});

test('v2 requires matching original QA with only the clipping issue and exact raw digest',()=>{
  const multiple=fixture({minWidth:321});assert.deepEqual(multiple.technical.issues,['OUTPUT_SIZE','COHERENT_CLIPPED_SILHOUETTE']);
  rejects(()=>proposal(multiple),'COHERENT_CANVAS_GUTTER_SOURCE_QA');
  const qa=fixture();qa.source.result.technical=seal({...unseal(qa.technical),hiddenRgbPixels:123});
  rejects(()=>proposal(qa),'COHERENT_CANVAS_GUTTER_SOURCE_QA');
  const raw=fixture();raw.store.readBlob=()=>Buffer.from('changed source');rejects(()=>proposal(raw),'COHERENT_CANVAS_GUTTER_RAW');
  const opaque=fixture();opaque.plan.target.alpha='opaque';rejects(()=>proposal(opaque),'COHERENT_CANVAS_GUTTER_SOURCE');
  const legacy=fixture();legacy.plan.format='ai_scene_generation_plan_v26';rejects(()=>proposal(legacy),'COHERENT_CANVAS_GUTTER_SOURCE');
  const stale=fixture();stale.state.activeStyle=sha('8');rejects(()=>proposal(stale),'PLAN_STALE');
  const missing=fixture();missing.batch.planSha256s=[];rejects(()=>proposal(missing),'COHERENT_CANVAS_GUTTER_BATCH');
});

test('v2 is opt-in and neither old border nor old canvas eligibility is relaxed',()=>{
  const lowAlpha=fixture();rejects(()=>proposal(lowAlpha,{}),'COHERENT_CANVAS_GUTTER_SOURCE');
  rejects(()=>compileCoherentBorderProposal(lowAlpha.store,lowAlpha.state,lowAlpha.plan.sha256),'COHERENT_BORDER_EDGE');
  const passing=fixture({legacy:true,tailAlpha:1,status:'pending-visual-review'});
  rejects(()=>proposal(passing),'COHERENT_CANVAS_GUTTER_SOURCE');
  const old=proposal(passing,{});
  assert.equal(old.proposal.format,'ai_scene_coherent_canvas_gutter_proposal_v1');
  // These stable synthetic snapshots bind the complete historical contracts, not only their thresholds.
  assert.equal(old.proposal.sha256,'92dd40ad669ee71cc498966717442f4f8d49bff05830b2c7de4e6c141a949050');
  assert.equal(old.proposal.paddedRawSha256,'6cd72c21f672c24cb1aa70988de73aad796fe4308c26498ef67ea83fd65c33be');
  const legacyRecord=prepare(passing,old.proposal).record;
  assert.equal(legacyRecord.sha256,'0227c5da1e4e4bb98a95b41e5048fcb53121484835fe55b75b1deed47026089f');
  // Independently freeze the original v1 record fields. A v2 discriminator or
  // relaxed eligibility must never be retroactively inserted into this contract.
  const p=passing.plan;
  assert.deepEqual(legacyRecord,seal({format:'ai_scene_coherent_canvas_gutter_preparation_v1',compiler:'scene-kit-coherent-canvas-gutter-v1',
    sourcePlanSha256:p.sha256,proposal:old.proposal,receipt:receipt(old.proposal.sha256),originalRawSha256:old.proposal.originalRawSha256,
    rawSha256:old.proposal.paddedRawSha256,originalTechnicalSha256:old.proposal.originalTechnicalSha256,technical:old.proposal.technical,
    recipe:{...p.recipe,planId:'prepared.gutter',parents:[p.sha256]},designReviews:p.designReviews,referenceEvidence:p.referenceEvidence,instanceBinding:p.instanceBinding,
    target:p.target,qualityPolicy:p.qualityPolicy,sourceScope:p.sourceScope,visualReviewChecklist:p.visualReviewChecklist,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},originalAttemptOutcome:'pending-visual-review',originalPreserved:true,
    allOriginalRgbaPreserved:true,sourceArtAcceptance:'not-granted'}));
  const oldBorder=fixture({legacy:true,tailAlpha:3});
  const border=compileCoherentBorderProposal(oldBorder.store,oldBorder.state,oldBorder.plan.sha256);
  assert.equal(border.proposal.sha256,'6c2dab4197f4a598218e2b387ebb38a2851bc54ea480584e4fdc9c8299c71a04');
  const borderRecord=compileCoherentBorderPreparation(oldBorder.store,oldBorder.state,{preparationId:'prepared.gutter',proposal:border.proposal,receipt:receipt(border.proposal.sha256)}).record;
  assert.equal(borderRecord.sha256,'8c621f448893009790ac312e0025da74e8c46b711d56ca1ffce2201c4871f1da');
  assert.equal(border.proposal.rule.maximumOriginalBorderAlpha,3);assert.equal(border.proposal.rule.bodyAlphaThreshold,16);assert.equal(border.proposal.rule.minimumBodyMargin,4);
  rejects(()=>proposal(passing,{profile:'low-alpha-margin-v1'}),'COHERENT_CANVAS_GUTTER_PROFILE');
});

test('v2 accepts only a current exact proposal and human receipt bound to that proposal',()=>{
  const f=fixture(),p=proposal(f).proposal;
  const altered=seal({...unseal(p),contentOffset:{x:p.contentOffset.x+1,y:p.contentOffset.y}});
  rejects(()=>prepare(f,altered),'COHERENT_CANVAS_GUTTER_PROPOSAL_CHANGED');
  const wrongProfile=seal({...unseal(p),rule:{...p.rule,maximumOriginalBorderAlpha:8}});
  rejects(()=>prepare(f,wrongProfile),'COHERENT_CANVAS_GUTTER_PROPOSAL_CHANGED');
  rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'wrong.receipt',proposal:p,receipt:receipt(sha('9'))}),'COHERENT_CANVAS_GUTTER_APPROVAL');
  rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'raw.not.proposal',proposal:p,receipt:receipt(p.paddedRawSha256)}),'COHERENT_CANVAS_GUTTER_APPROVAL');
  rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'rejected.preview',proposal:p,receipt:{...receipt(p.sha256),decision:'reject'}}),'COHERENT_CANVAS_GUTTER_APPROVAL');
  const next=seal({...unseal(f.batch),batchId:'batch.second'});f.state.batches.set(next.sha256,next);
  const other=compileCoherentCanvasGutterProposal(f.store,f.state,f.plan.sha256,next.sha256,profile).proposal;
  assert.notEqual(other.sha256,p.sha256);assert.equal(other.paddedRawSha256,p.paddedRawSha256);
  rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'wrong.parent.receipt',proposal:other,receipt:receipt(p.sha256)}),'COHERENT_CANVAS_GUTTER_APPROVAL');
});
