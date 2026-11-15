import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,seal,unseal,jsonBytes} from '../src/generation/common.mjs';
import {assessCoherentSource} from '../src/generation/coherent-source.mjs';
import {compileCoherentBorderProposal} from '../src/generation/coherent-border.mjs';
import {compileCoherentCanvasGutterProposal,compileCoherentCanvasGutterPreparation,COHERENT_CANVAS_GUTTER_FORMAT} from '../src/generation/coherent-canvas-gutter.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));
const sha=n=>n.repeat(64);
function fixture({width=320,height=256,status='pending-visual-review',tailAlpha=1,roomy=false,maxWidth=4096,maxHeight=4096}={}){
  const rgba=Buffer.alloc(width*height*4),margin=roomy?60:6;
  for(let y=60;y<height-60;y++)for(let x=margin;x<width-margin;x++)rgba.set([40+x%37,65+y%41,110,(x+y)%5?255:129],(y*width+x)*4);
  rgba.set([13,77,231,0],0); // Preserve native hidden RGB, not a visible blue veil.
  if(tailAlpha)rgba.set([110,51,71,tailAlpha],(130*width+1)*4);
  const raw=encodeRgbaPng(width,height,rgba),spec=sha('1'),style=sha('2'),reference=sha('3'),target=sha('4'),referenceRaw=sha('5');
  const plan=seal({format:'ai_scene_generation_plan_v27',recipe:{planId:'source.far',parents:[],stage:'coherent-source',specSha256:spec,styleSha256:style,
    referencePlans:[reference],targetSha256:target,assetId:'far'},referenceEvidence:[{rawSha256:referenceRaw}],designReviews:{spec:sha('6'),style:sha('7')},
    instanceBinding:{role:'backdrop',instanceId:'far.actual'},target:{assetId:'far',alpha:'transparent',sourcePolicy:{minimumWidth:256,minimumHeight:256,maximumWidth:maxWidth,maximumHeight:maxHeight}},
    qualityPolicy:'strict',sourceScope:{profile:'isolated-layer-v4'},visualReviewChecklist:{visualAcceptance:'not-assessed'}});
  const technical=assessCoherentSource(plan,raw),result=seal({format:'ai_scene_image_result_v1',rawSha256:hash(raw),technical});
  const source={plan,status,result};
  const batch=seal({format:'ai_scene_coherent_source_batch_v1',batchId:'batch.original',referencePlanSha256:reference,targetSha256:target,planSha256s:[plan.sha256]});
  const state={activeSpec:spec,activeStyle:style,plans:new Map([[plan.sha256,source],[reference,{status:'accepted',reconstructionTarget:{sha256:target},result:{rawSha256:referenceRaw}}]]),batches:new Map([[batch.sha256,batch]])};
  const store={readBlob(digest){assert.equal(digest,hash(raw));return Buffer.from(raw);}};
  return {state,store,plan,source,batch,raw,rgba,technical};
}
const proposal=f=>compileCoherentCanvasGutterProposal(f.store,f.state,f.plan.sha256,f.batch.sha256);
const receipt=(target,decision='accept')=>({decisionId:'review.gutter',targetSha256:target,decision,notes:'Synthetic operator accepted only the exact canvas change; no source-art or compute authorization.'});
const prepare=(f,p)=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'prepared.gutter',proposal:p.proposal,receipt:receipt(p.proposal.sha256)});
function preserve(f,p){
  const original=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}),padded=inspectPng(p.bytes,{includePixels:true,allowHiddenRgb:true}),o=p.proposal.contentOffset;
  assert.equal(padded.width,original.width+2*o.x);assert.equal(padded.height,original.height+2*o.y);
  for(let y=0;y<original.height;y++)assert.deepEqual(padded.rgba.subarray(((y+o.y)*padded.width+o.x)*4,((y+o.y)*padded.width+o.x+original.width)*4),original.rgba.subarray(y*original.width*4,(y+1)*original.width*4));
  for(let y=0;y<padded.height;y++)for(let x=0;x<padded.width;x++)if(x<o.x||x>=o.x+original.width||y<o.y||y>=o.y+original.height)
    assert.deepEqual(padded.rgba.subarray((y*padded.width+x)*4,(y*padded.width+x)*4+4),Buffer.alloc(4));
  return padded;
}

test('12-percent canvas expansion preserves every original RGBA byte, hidden RGB, alpha tails and read-only state',()=>{
  const f=fixture(),before=jsonBytes({plans:[...f.state.plans],batches:[...f.state.batches]}),rawBefore=Buffer.from(f.raw);
  assert.equal(f.technical.status,'pass');const p=proposal(f),padded=preserve(f,p);
  assert.deepEqual(f.raw,rawBefore);assert.deepEqual(jsonBytes({plans:[...f.state.plans],batches:[...f.state.batches]}),before);
  assert.equal(p.proposal.maximumNewImageCalls,0);assert.equal(p.proposal.sourceArtAcceptance,'not-granted');assert.equal(p.proposal.hiddenGeometry,'not-recovered');
  assert.equal(p.proposal.technical.status,'pass');assert.equal(p.proposal.technical.hiddenRgbPixels,1);
  assert.equal(p.proposal.parentBatchSha256,f.batch.sha256);assert.equal(p.proposal.originalRawSha256,hash(f.raw));assert.equal(p.proposal.paddedRawSha256,hash(p.bytes));
  assert.deepEqual(padded.rgba.subarray((p.proposal.contentOffset.y*padded.width+p.proposal.contentOffset.x)*4,(p.proposal.contentOffset.y*padded.width+p.proposal.contentOffset.x)*4+4),Buffer.from([13,77,231,0]));
  const bounds=p.proposal.paddedContentBounds,m=p.proposal.paddedPaddingPixels;
  assert.equal(bounds.x,p.proposal.originalContentBounds.x+p.proposal.contentOffset.x);
  assert(m.left*100>=12*padded.width&&m.right*100>=12*padded.width&&m.top*100>=12*padded.height&&m.bottom*100>=12*padded.height);
  assert.deepEqual(proposal(f).proposal,p.proposal);assert.deepEqual(proposal(f).bytes,p.bytes);
});

test('padding formula is the minimum symmetric integer protecting the entire original canvas on both axes',()=>{
  for(const [width,height]of [[256,256],[257,263],[319,257],[1024,512]]){
    const f=fixture({width,height}),p=proposal(f),o=p.proposal.contentOffset;
    for(const [length,padding]of [[width,o.x],[height,o.y]]){
      assert.equal(padding,Math.ceil(length*12/76));assert(padding*100>=12*(length+2*padding));
      assert((padding-1)*100<12*(length+2*(padding-1)));
    }
    assert(p.bytes.length<=16777216);assert(p.proposal.paddedPixelSize.width<=4096&&p.proposal.paddedPixelSize.height<=4096);
  }
});

test('diagnostic checkerboards alpha-composite hidden RGB and retain native artwork as separate bytes',()=>{
  const f=fixture(),p=proposal(f),before=inspectPng(p.previews.original,{includePixels:true}),after=inspectPng(p.previews.padded,{includePixels:true});
  assert.deepEqual(before.rgba.subarray(0,4),Buffer.from([226,226,226,255]));assert.deepEqual(after.rgba.subarray(0,4),Buffer.from([226,226,226,255]));
  assert.equal(before.transparentPixels,0);assert.equal(after.transparentPixels,0);assert.equal(p.proposal.diagnosticPreviews.compositing,'straight-alpha-over-checkerboard');
  assert.equal(p.proposal.diagnosticPreviews.originalSha256,hash(p.previews.original));assert.equal(p.proposal.diagnosticPreviews.paddedSha256,hash(p.previews.padded));
  const raw=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true});assert.deepEqual(raw.rgba.subarray(0,4),Buffer.from([13,77,231,0]));
});

test('bounded diagnostic minification averages already-composited color with a common divisor',()=>{
  const f=fixture({width:1024,height:512}),p=proposal(f),before=inspectPng(p.previews.original),after=inspectPng(p.previews.padded);
  assert.equal(p.proposal.diagnosticPreviews.pixelDivisor,2);assert.equal(before.width,512);assert.equal(after.width,Math.ceil(p.proposal.paddedPixelSize.width/2));
  assert(Math.max(before.width,before.height,after.width,after.height)<=1024);assert.equal(before.transparentPixels,0);assert.equal(after.transparentPixels,0);
});

test('only exact human acceptance creates a max-zero preparation and does not propagate source art acceptance',()=>{
  for(const status of ['pending-visual-review','accepted']){
    const f=fixture({status}),p=proposal(f),{record,bytes}=prepare(f,p);
    assert.equal(record.format,COHERENT_CANVAS_GUTTER_FORMAT);assert.equal(record.originalAttemptOutcome,status);assert.equal(record.request.maximumCalls,0);
    assert.equal(record.sourceArtAcceptance,'not-granted');assert.deepEqual(record.recipe.parents,[f.plan.sha256]);assert.equal(record.rawSha256,p.proposal.paddedRawSha256);
    assert.equal(f.source.status,status);assert.deepEqual(record.instanceBinding,f.plan.instanceBinding);assert.deepEqual(record.sourceScope,f.plan.sourceScope);
    assert.deepEqual(record.referenceEvidence,f.plan.referenceEvidence);assert.deepEqual(record.target,f.plan.target);assert.deepEqual(bytes,p.bytes);
    rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'wrong',proposal:p.proposal,receipt:receipt('f'.repeat(64))}),'COHERENT_CANVAS_GUTTER_APPROVAL');
    rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'declined',proposal:p.proposal,receipt:receipt(p.proposal.sha256,'reject')}),'COHERENT_CANVAS_GUTTER_APPROVAL');
  }
});

test('sealed proposal alterations and wrong batch receipt cannot substitute another approved canvas',()=>{
  const f=fixture(),p=proposal(f),changed=seal({...unseal(p.proposal),contentOffset:{x:p.proposal.contentOffset.x+1,y:p.proposal.contentOffset.y}});
  rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'tampered',proposal:changed,receipt:receipt(changed.sha256)}),'COHERENT_CANVAS_GUTTER_PROPOSAL_CHANGED');
  const next=seal({...unseal(f.batch),batchId:'batch.second'});f.state.batches.set(next.sha256,next);
  const other=compileCoherentCanvasGutterProposal(f.store,f.state,f.plan.sha256,next.sha256);
  assert.notEqual(other.proposal.sha256,p.proposal.sha256);assert.deepEqual(other.bytes,p.bytes);
  rejects(()=>compileCoherentCanvasGutterPreparation(f.store,f.state,{preparationId:'cross.batch',proposal:other.proposal,receipt:receipt(p.proposal.sha256)}),'COHERENT_CANVAS_GUTTER_APPROVAL');
  // Historical pure reconstruction remains reproducible for exact resume.
  assert.deepEqual(proposal(f).proposal,p.proposal);
});

test('ineligible plans/outcomes, wrong batch/target and stale design fail without changes',()=>{
  for(const status of ['planned','authorized','indeterminate','rejected-technical','rejected-visual']){const f=fixture({status});rejects(()=>proposal(f),'COHERENT_CANVAS_GUTTER_SOURCE');}
  const opaque=fixture();opaque.plan.target.alpha='opaque';rejects(()=>proposal(opaque),'COHERENT_CANVAS_GUTTER_SOURCE');
  const legacy=fixture();legacy.plan.format='ai_scene_generation_plan_v26';rejects(()=>proposal(legacy),'COHERENT_CANVAS_GUTTER_SOURCE');
  const batch=fixture();batch.state.batches.get(batch.batch.sha256).planSha256s=[];rejects(()=>proposal(batch),'COHERENT_CANVAS_GUTTER_BATCH');
  const target=fixture();target.state.batches.get(target.batch.sha256).targetSha256=sha('9');rejects(()=>proposal(target),'COHERENT_CANVAS_GUTTER_BATCH');
  const stale=fixture();stale.state.activeStyle=sha('8');rejects(()=>proposal(stale),'PLAN_STALE');
});

test('source bytes, technical replay, existing sufficient gutters and dimension limits are enforced',()=>{
  const raw=fixture();raw.store.readBlob=()=>Buffer.from('changed');rejects(()=>proposal(raw),'COHERENT_CANVAS_GUTTER_RAW');
  const qa=fixture();qa.source.result.technical=seal({...unseal(qa.technical),hiddenRgbPixels:123});rejects(()=>proposal(qa),'COHERENT_CANVAS_GUTTER_SOURCE_QA');
  const roomy=fixture({tailAlpha:0,roomy:true});assert.equal(roomy.technical.status,'pass');rejects(()=>proposal(roomy),'COHERENT_CANVAS_GUTTER_ALREADY_SATISFIED');
  const size=fixture({maxWidth:384});assert.equal(size.technical.status,'pass');rejects(()=>proposal(size),'COHERENT_CANVAS_GUTTER_SIZE');
  const edge=fixture({width:3113});assert.equal(edge.technical.status,'pass');rejects(()=>proposal(edge),'COHERENT_CANVAS_GUTTER_SIZE');
  const excessive=fixture(),large=Buffer.alloc(16777217);excessive.source.result.rawSha256=hash(large);excessive.store.readBlob=()=>large;
  rejects(()=>proposal(excessive),'COHERENT_CANVAS_GUTTER_RAW');
});

test('the earlier 2px low-alpha producer keeps its eligibility and fixed pixel recipe',()=>{
  const passing=fixture();rejects(()=>compileCoherentBorderProposal(passing.store,passing.state,passing.plan.sha256),'COHERENT_BORDER_SOURCE');
  const failed=fixture({tailAlpha:3,status:'rejected-technical'});assert.equal(failed.technical.status,'fail');
  const old=compileCoherentBorderProposal(failed.store,failed.state,failed.plan.sha256);
  assert.equal(old.proposal.rule.paddingPixels,2);assert.equal(old.proposal.paddedPixelSize.width,failed.plan.target.sourcePolicy.minimumWidth+68);
  assert.equal(old.proposal.format,'ai_scene_coherent_border_proposal_v1');
  rejects(()=>proposal(failed),'COHERENT_CANVAS_GUTTER_SOURCE');
});
