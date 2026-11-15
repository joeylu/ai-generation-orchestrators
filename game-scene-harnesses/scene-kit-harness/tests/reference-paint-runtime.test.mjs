import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/reference-paint-pipeline.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import { PAINT_DESIGN_FILES, assessPaintSource } from '../src/generation/reference-paint.mjs';
import { compilePaintGeometryDesign, paintGeometryGuide } from '../src/reference-paint-design.mjs';
import { inspectPng, encodeRgbaPng } from '../src/png.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { seal, unseal, hash, jsonBytes } from '../src/generation/common.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';
import { decision } from './helpers/generation.mjs';
import {fixture,generated} from './helpers/reference-paint.mjs';
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));
async function receive(f,bytes=generated()) {
  const p=flow.freezePaintSourcePlan(f.workflow,f.options);
  flow.authorizePlan(f.workflow,p.sha256,decision('paint.compute',p.sha256,'approve-compute'));
  await pipeline.runPaintSource(f.workflow,p.sha256,{preflight:async()=>{},generate:async()=>bytes});
  return p;
}
function acceptSource(f,p) {
  const raw=flow.getGenerationResult(f.workflow,p.sha256).result.rawSha256;
  return flow.reviewResult(f.workflow,p.sha256,decision('paint.art',raw));
}
test('new paint plans replay the approved prompt and exact guide/full-reference inputs without cropping or compute',t=>{
  const f=fixture(t),before=flow.inspectWorkflow(f.workflow),out=join(f.parent,'proposal');
  pipeline.buildPaintSourceProposal(f.workflow,f.options,out);pipeline.verifyPaintSourceProposal(f.workflow,f.options,out);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const p=flow.freezePaintSourcePlan(f.workflow,f.options);
  assert.equal(p.format,'ai_scene_generation_plan_v25');assert.equal(p.request.output.alpha,'opaque');assert.equal(p.request.prompt,f.design.sourcePaintDraft.prompt);
  assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,0),f.guide);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,1),f.raw);
  assert.deepEqual(readFileSync(join(out,'reference-native.png')),f.raw);assert(!existsSync(join(out,'context-native.png')));
  rejects(()=>flow.reservePlan(f.workflow,p.sha256),'AUTHORIZATION_REQUIRED');project.inspectReferenceLedProject(f.root);
});
test('geometry acceptance alone cannot approve the new opaque source/derivation design',t=>{
  const f=fixture(t,{accept:false}),before=flow.inspectWorkflow(f.workflow);
  rejects(()=>flow.freezePaintSourcePlan(f.workflow,f.options),'PAINT_DESIGN_REVIEW_REQUIRED');
  rejects(()=>flow.reviewPaintControls(f.workflow,f.c.sha256,decision('wrong.design.target',f.reviewPacket.sha256)),'PAINT_CONTROL_REVIEW_STATE');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('changed or unexpected design artifacts cannot enter the event log',t=>{
  const f=fixture(t),before=flow.inspectWorkflow(f.workflow),bad=new Map(f.artifacts),p=unseal(f.reviewPacket);
  bad.set('paint-guide.png',generated({width:128,height:100}));
  rejects(()=>flow.importPaintControls(f.workflow,{...f.importOptions,controlId:'paint.changed'},bad),'PAINT_CONTROL_ARTIFACTS');
  p.artifacts=p.artifacts.map(a=>a.path==='paint-guide.png'?{...a,sha256:hash(bad.get(a.path)),byteLength:bad.get(a.path).length}:a);
  rejects(()=>flow.importPaintControls(f.workflow,{...f.importOptions,controlId:'paint.changed',reviewPacket:seal(p)},bad),'PAINT_DESIGN_GUIDE_REPLAY');
  p.artifacts[0].path='../escape.png';rejects(()=>flow.importPaintControls(f.workflow,{...f.importOptions,reviewPacket:seal(p)},bad),'PAINT_CONTROL_ARTIFACTS');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('dispatch reserves before the single call and technical success remains paint-art pending',async t=>{
  const f=fixture(t),p=flow.freezePaintSourcePlan(f.workflow,f.options);let calls=0;
  flow.authorizePlan(f.workflow,p.sha256,decision('paint.compute',p.sha256,'approve-compute'));
  const adapter={preflight:async()=>{},generate:async input=>{calls++;assert.equal(input.request.output.alpha,'opaque');
    assert.equal(pipeline.inspectPaintSource(f.workflow,p.sha256).status,'submitted');assert.deepEqual(input.images[0].bytes,f.guide);assert.deepEqual(input.images[1].bytes,f.raw);return generated();}};
  const result=await pipeline.runPaintSource(f.workflow,p.sha256,adapter);assert.equal(calls,1);assert.equal(result.status,'pending-visual-review');
  await assert.rejects(pipeline.runPaintSource(f.workflow,p.sha256,adapter));assert.equal(calls,1);
  const out=join(f.parent,'paint-review');flow.buildPaintSourceReview(f.workflow,p.sha256,out);flow.verifyPaintSourceReview(f.workflow,p.sha256,out);
  assert.equal(JSON.parse(readFileSync(join(out,'report.json'))).alphaApplied,false);
  rejects(()=>flow.getPaintApplicationProposal(f.workflow,p.sha256),'PAINT_SOURCE_ART_REVIEW_REQUIRED');
});
test('unknown paint dispatch is terminal and a revision needs fresh compute authorization',async t=>{
  const f=fixture(t),p=flow.freezePaintSourcePlan(f.workflow,f.options);let calls=0;
  flow.authorizePlan(f.workflow,p.sha256,decision('paint.compute',p.sha256,'approve-compute'));
  const adapter={preflight:async()=>{},generate:async()=>{calls++;throw Error('unknown double');}};
  assert.equal((await pipeline.runPaintSource(f.workflow,p.sha256,adapter)).status,'indeterminate');
  await assert.rejects(pipeline.runPaintSource(f.workflow,p.sha256,adapter));assert.equal(calls,1);
  const next=flow.reviseGenerationPlan(f.workflow,p.sha256,{planId:'paint.revision',capabilitiesSha256:f.cap.sha256,intent:''});
  assert.equal(next.format,'ai_scene_generation_plan_v25');assert.equal(next.request.prompt,p.request.prompt);
  rejects(()=>flow.reservePlan(f.workflow,next.sha256),'AUTHORIZATION_REQUIRED');
});
test('opacity, blank image, aspect and minimum size are real technical gates',t=>{
  const f=fixture(t),p=flow.freezePaintSourcePlan(f.workflow,f.options);
  assert(assessPaintSource(p,f.raw).issues.includes('PAINT_REFERENCE_REUSE'));
  for(const [bytes,issue] of [[generated({transparent:true}),'OUTPUT_NOT_OPAQUE'],[generated({blank:true}),'PAINT_BLANK'],
    [generated({width:512,height:288}),'PAINT_DESIGN_ASPECT'],[generated({width:64,height:50}),'PAINT_DESIGN_UPSCALE']]){
    const q=assessPaintSource(p,bytes);assert.equal(q.status,'fail');assert(q.issues.includes(issue));assert.equal(q.sourcePngModified,false);
  }
});
test('a transparent output remains rejected and cannot be reclassified through derivation',async t=>{
  const f=fixture(t),p=await receive(f,generated({transparent:true}));assert.equal(pipeline.inspectPaintSource(f.workflow,p.sha256).status,'rejected-technical');
  rejects(()=>flow.buildPaintSourceReview(f.workflow,p.sha256,join(f.parent,'bad-review')),'PAINT_SOURCE_TECHNICAL');
  rejects(()=>flow.getPaintApplicationProposal(f.workflow,p.sha256),'PAINT_SOURCE_ART_REVIEW_REQUIRED');
});
test('source art acceptance still cannot apply geometry until the exact source/mask/mapping proposal is approved',async t=>{
  const f=fixture(t),p=await receive(f);acceptSource(f,p);const proposal=flow.getPaintApplicationProposal(f.workflow,p.sha256),out=join(f.parent,'derived');
  assert.equal(proposal.geometryAlphaSha256,hash(f.alpha));assert.equal(proposal.sourcePaintSha256,hash(generated()));
  rejects(()=>flow.buildPaintLayer(f.workflow,p.sha256,out),'PAINT_APPLICATION_REVIEW_REQUIRED');assert(!existsSync(out));
  rejects(()=>flow.reviewPaintApplication(f.workflow,p.sha256,decision('wrong.apply.target',hash(f.alpha))),'PAINT_APPLICATION_REVIEW_STATE');
  flow.reviewPaintApplication(f.workflow,p.sha256,decision('paint.apply',proposal.sha256));
  flow.buildPaintLayer(f.workflow,p.sha256,out);flow.verifyPaintLayer(f.workflow,p.sha256,out);
  assert.deepEqual(readFileSync(join(out,'source-native.png')),generated());assert.deepEqual(readFileSync(join(out,'geometry-alpha.png')),f.alpha);
  const layer=inspectPng(readFileSync(join(out,'layer-local.png')),{includePixels:true});
  for(let i=0;i<128*100;i++)assert.equal(layer.rgba[i*4+3],f.mask.rgba[i*4+3]);
  const native=inspectPng(readFileSync(join(out,'layer-native-frame.png')),{includePixels:true});
  assert.deepEqual([...native.rgba.subarray((238*512+10)*4,(238*512+10)*4+4)],[61,94,130,255]);
  assert.deepEqual([...native.rgba.subarray((213*512+1)*4,(213*512+1)*4+4)],[43,102,130,128]);
  for(const [x,y] of [[10,50],[20,230],[200,250]])assert.deepEqual([...native.rgba.subarray((y*512+x)*4,(y*512+x)*4+4)],[0,0,0,0]);
  const report=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(report.artAcceptance,'not-assessed');assert.equal(report.originalReferenceAppearancePixelsUsed,0);
  assert.equal(report.originalUncertainPixels,17);assert.equal(report.opticalAlphaMeasured,false);
  writeFileSync(join(out,'layer-local.png'),f.alpha);rejects(()=>flow.verifyPaintLayer(f.workflow,p.sha256,out),'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});
test('rejecting application or source appearance cannot silently become a derived success',async t=>{
  const f=fixture(t),p=await receive(f);acceptSource(f,p);const proposal=flow.getPaintApplicationProposal(f.workflow,p.sha256);
  flow.reviewPaintApplication(f.workflow,p.sha256,decision('paint.apply.reject',proposal.sha256,'reject'));
  rejects(()=>flow.buildPaintLayer(f.workflow,p.sha256,join(f.parent,'rejected-derived')),'PAINT_APPLICATION_REVIEW_REQUIRED');
  rejects(()=>flow.reviewPaintApplication(f.workflow,p.sha256,decision('paint.apply.reaccept',proposal.sha256)),'PAINT_APPLICATION_REVIEW_STATE');
});
test('changed active style blocks stale paint compute and application',async t=>{
  const f=fixture(t),p=await receive(f);acceptSource(f,p);
  const next=flow.createDesignDraft(f.workflow,{...unseal(f.style),styleId:'paint.changed.style',name:'Changed synthetic style'});
  flow.reviewDesign(f.workflow,'style',decision('paint.changed.style.accept',next.sha256));
  rejects(()=>flow.getPaintApplicationProposal(f.workflow,p.sha256),'PAINT_PLAN_TARGET');
});
