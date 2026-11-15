import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPOSITION_GUIDANCE_PROFILE,COMPOSITION_GUIDE_PURPOSE,compileCompositionGuide,validateCompositionGuide} from '../src/generation/composition-guide.mjs';
import {compileCoherentReferenceV3} from '../src/generation/coherent-reference-v3.mjs';
import {compileCoherentReferenceV2,coherentReferenceGuidesV2,coherentReferencePromptV2} from '../src/generation/coherent-reference-v2.mjs';
import {compileCoherentReference} from '../src/generation/coherent-reference.mjs';
import {seal,unseal,hash,digest,imageRef} from '../src/generation/common.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {coherentBrief,referencePng} from './helpers/coherent.mjs';
import {capabilitiesDraft,decision} from './helpers/generation.mjs';

const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
function guidePng(seed=0){
  const width=64,height=36,rgba=Buffer.alloc(width*height*4,255);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([30+(x+seed)%80,40+y%60,80+(x+y+seed)%90,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}
function fixture({description='Synthetic reference guidance compatibility',inputs=[]}={}){
  const brief=coherentBrief(description),spec=seal({format:'ai_scene_spec_v3',specId:'guidance.spec',projection:'sideview',description:brief.description,
    inputs,viewport:brief.viewport,maxAspectErrorPermille:brief.maxAspectErrorPermille,requirements:brief.requirements});
  const style=seal({format:'ai_scene_style_v2',styleId:'guidance.style',mode:'preset',name:'Synthetic illustrated style',
    rules:['Broad painted forms; retain local material colors.'],anchors:[]}),cap=seal(capabilitiesDraft());
  const state={activeSpec:spec.sha256,activeStyle:style.sha256,designs:new Map([[spec.sha256,spec],[style.sha256,style]]),capabilities:new Map([[cap.sha256,cap]]),
    designReviews:new Map([[spec.sha256,{sha256:'a'.repeat(64),receipt:{decision:'accept'}}],[style.sha256,{sha256:'b'.repeat(64),receipt:{decision:'accept'}}]]),plans:new Map()};
  const recipe={planId:'guidance.fixture',parents:[],stage:'reference',mode:'reference-led',specSha256:spec.sha256,styleSha256:style.sha256,
    capabilitiesSha256:cap.sha256,referencePlans:[],inventoryRefs:[],assetId:'scene-reference',
    pixelPolicy:{mode:'native-reference',orientation:'landscape',minimumShortEdge:256,maximumWidth:4096,maximumHeight:4096},intent:'',referenceGuidanceProfile:COMPOSITION_GUIDANCE_PROFILE};
  return {spec,style,cap,state,recipe};
}
function imported(f){
  const raw=guidePng(),options={guideId:'guide.fixture',specSha256:f.spec.sha256,receipt:decision('guide.accept',hash(raw))},record=compileCompositionGuide(f.state,options,raw);
  f.state.compositionGuides=new Map([[record.sha256,record]]);
  return {raw,record,options,recipe:{...f.recipe,compositionGuideSha256:record.sha256},readBlob:sha=>{assert.equal(sha,hash(raw));return raw;}};
}

test('an accepted composition PNG can bind an existing unreviewed inactive spec draft without computing or altering it',()=>{
  const f=fixture(),raw=guidePng(),original=Buffer.from(raw);f.state.activeSpec=null;f.state.designReviews.clear();
  const importState=structuredClone(f.state),record=compileCompositionGuide(f.state,{guideId:'draft.guide',specSha256:f.spec.sha256,receipt:decision('draft.accept',hash(raw))},raw);
  assert.equal(record.format,'ai_scene_coherent_composition_guide_v1');assert.equal(record.specSha256,f.spec.sha256);assert.equal(record.requirementsSha256,f.spec.requirements.sha256);
  assert.equal(record.purpose,COMPOSITION_GUIDE_PURPOSE);assert.deepEqual(record.image,imageRef(raw));assert.equal(record.generationCalls,0);assert.equal(record.sourcePngModified,false);
  assert.deepEqual(validateCompositionGuide(f.state,record),unseal(record));assert.deepEqual(validateCompositionGuide(f.state,record,()=>raw),unseal(record));
  assert.deepEqual(f.state,importState);assert.deepEqual(raw,original);
});

test('composition guide import requires an exact accept receipt for its PNG and rejects unknown drafts or request-selected extras',()=>{
  const f=fixture(),raw=guidePng(),options={guideId:'guide.fixture',specSha256:f.spec.sha256,receipt:decision('guide.accept',hash(raw))};
  rejects(()=>compileCompositionGuide(f.state,{...options,receipt:decision('guide.reject',hash(raw),'reject')},raw),'COMPOSITION_GUIDE_ACCEPTANCE');
  rejects(()=>compileCompositionGuide(f.state,{...options,receipt:decision('guide.wrong','f'.repeat(64))},raw),'COMPOSITION_GUIDE_ACCEPTANCE');
  rejects(()=>compileCompositionGuide(f.state,{...options,receipt:decision('guide.compute',hash(raw),'approve-compute')},raw),'DECISION_INVALID');
  rejects(()=>compileCompositionGuide(f.state,{...options,specSha256:'f'.repeat(64)},raw),'COMPOSITION_GUIDE_SPEC');
  assert.throws(()=>compileCompositionGuide(f.state,{...options,path:'outside.png'},raw));
  assert.throws(()=>compileCompositionGuide(f.state,options,Buffer.from('not a PNG')));
  assert.equal(Object.hasOwn(f.state,'compositionGuides'),false);assert.equal(f.state.plans.size,0);
});

test('sealed guide replay binds purpose, requirements, original bytes, dimensions and the exact visual receipt',()=>{
  const f=fixture(),g=imported(f),before=structuredClone(f.state);
  for(const mutate of [body=>{body.requirementsSha256='f'.repeat(64);},body=>{body.purpose='style-only';},body=>{body.sourcePngModified=true;},body=>{body.generationCalls=1;},body=>{body.receipt.targetSha256='f'.repeat(64);},body=>{body.image.pixelSize.width++;},body=>{body.image.byteLength++;}]){
    const body=unseal(structuredClone(g.record));mutate(body);assert.throws(()=>validateCompositionGuide(f.state,seal(body),g.readBlob));
  }
  assert.throws(()=>validateCompositionGuide(f.state,g.record,()=>guidePng(1)));
  const body=unseal(structuredClone(g.record));body.image.sha256='../outside';let read=false;
  rejects(()=>validateCompositionGuide(f.state,seal(body),()=>{read=true;return g.raw;}),'COMPOSITION_GUIDE_IMAGE');assert.equal(read,false);
  assert.deepEqual(f.state,before);assert.deepEqual(g.raw,guidePng());
});

test('v32 assigns technical guides, the accepted soft layout and style inputs separate immutable roles in that order',()=>{
  const styleInput={role:'style-reference',artifact:imageRef(referencePng())},f=fixture({inputs:[styleInput]}),g=imported(f),before=structuredClone(f.state),plan=compileCoherentReferenceV3(f.state,g.recipe,g.readBlob);
  assert.equal(plan.format,'ai_scene_generation_plan_v32');assert.equal(plan.request.format,'ai_scene_image_request_v32');assert.equal(plan.compiler,'scene-kit-coherent-reference-v3');assert.deepEqual(plan.recipe,g.recipe);
  assert.deepEqual(plan.request.images.map(image=>image.role),['neutral-front-elevation-example','neutral-complete-isolated-component-example','accepted-soft-composition-guide','style-reference']);
  assert.deepEqual(plan.request.images.slice(0,2).map(image=>image.artifact.sha256),coherentReferenceGuidesV2().map(image=>hash(image.bytes)));
  assert.deepEqual(plan.request.images[2].artifact,g.record.image);assert.deepEqual(plan.request.images[3],styleInput);
  assert.deepEqual(plan.compositionGuideEvidence,{compositionGuideSha256:g.record.sha256,specSha256:f.spec.sha256,requirementsSha256:f.spec.requirements.sha256,
    imageSha256:hash(g.raw),receiptSha256:digest(g.record.receipt),purpose:COMPOSITION_GUIDE_PURPOSE,pixelLocking:false});
  assert.equal(plan.inputPolicy.compositionPixelLocking,false);assert.equal(plan.inputPolicy.compositionGuideUsage,'relative-position-and-occlusion-only');
  assert.match(plan.request.prompt,/image 3 is the user-accepted composition guide/);assert.match(plan.request.prompt,/not a style, palette, material or subject-identity reference/);
  assert.match(plan.request.prompt,/does not impose exact coordinates, pixel silhouettes, dimensions or camera locks/);assert.match(plan.request.prompt,/Only input images from image 4 onward/);
  assert.doesNotMatch(plan.request.prompt,/All later input images provide/);assert.equal(plan.request.maximumCalls,1);assert.equal(plan.request.output.alpha,'opaque');
  for(const subject of f.spec.requirements.subjects)assert(plan.request.prompt.includes(subject.content));
  assert.deepEqual(plan.referenceRequirements,f.spec.requirements);assert.deepEqual(f.state,before);
});

test('v32 enforces active-spec and guide identities, design acceptance and capacity for three guides plus every style image',()=>{
  const f=fixture(),g=imported(f);
  rejects(()=>compileCoherentReferenceV3(f.state,g.recipe),'COMPOSITION_GUIDE_BLOB_REQUIRED');
  rejects(()=>compileCoherentReferenceV3(f.state,{...g.recipe,compositionGuideSha256:'f'.repeat(64)},g.readBlob),'COMPOSITION_GUIDE_REQUIRED');
  rejects(()=>compileCoherentReferenceV3(f.state,{...g.recipe,referenceGuidanceProfile:'isolated-component-v2'},g.readBlob),'COHERENT_REFERENCE_GUIDANCE_PROFILE');
  assert.throws(()=>compileCoherentReferenceV3(f.state,{...g.recipe,unlistedOption:true},g.readBlob));
  f.state.activeSpec=null;rejects(()=>compileCoherentReferenceV3(f.state,g.recipe,g.readBlob),'COMPOSITION_GUIDE_ACTIVE_SPEC');f.state.activeSpec=f.spec.sha256;
  f.state.designReviews.delete(f.spec.sha256);rejects(()=>compileCoherentReferenceV3(f.state,g.recipe,g.readBlob),'DESIGN_REVIEW_REQUIRED');
  const changed=fixture(),oldGuide=imported(changed),next=seal({...unseal(changed.spec),specId:'next.spec',description:'Another accepted scene.'});
  changed.state.designs.set(next.sha256,next);changed.state.activeSpec=next.sha256;
  rejects(()=>compileCoherentReferenceV3(changed.state,{...oldGuide.recipe,specSha256:next.sha256},oldGuide.readBlob),'COMPOSITION_GUIDE_BINDING');
  for(const [inputs,maxInputImages]of [[[],2],[[{role:'style-reference',artifact:imageRef(referencePng())}],3]]){
    const c=fixture({inputs}),cg=imported(c),cap=seal({...unseal(c.cap),maxInputImages});c.state.capabilities.set(cap.sha256,cap);
    rejects(()=>compileCoherentReferenceV3(c.state,{...cg.recipe,capabilitiesSha256:cap.sha256},cg.readBlob),'COHERENT_COMPOSITION_CAPABILITY');
  }
});

test('v32 permits a single terminal v28, v31 or v32 parent without modifying or retrying it',()=>{
  for(const format of ['ai_scene_generation_plan_v28','ai_scene_generation_plan_v31','ai_scene_generation_plan_v32'])for(const status of ['failed','indeterminate','rejected-technical','rejected-visual']){
    const f=fixture(),g=imported(f),sha='c'.repeat(64);f.state.plans.set(sha,{plan:{format},status});const before=structuredClone(f.state);
    const plan=compileCoherentReferenceV3(f.state,{...g.recipe,parents:[sha]},g.readBlob);assert.deepEqual(plan.recipe.parents,[sha]);assert.deepEqual(f.state,before);
  }
  for(const [format,status]of [['ai_scene_generation_plan_v18','failed'],['ai_scene_generation_plan_v28','accepted'],['ai_scene_generation_plan_v31','planned'],['ai_scene_generation_plan_v32','submitted']]){
    const f=fixture(),g=imported(f),sha='c'.repeat(64);f.state.plans.set(sha,{plan:{format},status});rejects(()=>compileCoherentReferenceV3(f.state,{...g.recipe,parents:[sha]},g.readBlob),'PLAN_PARENT');
  }
  const f=fixture(),g=imported(f);rejects(()=>compileCoherentReferenceV3(f.state,{...g.recipe,parents:['a'.repeat(64),'b'.repeat(64)]},g.readBlob),'PLAN_PARENT');
});

test('a changed guide requires a new record and plan identity even when accepted scene data and guide roles are unchanged',()=>{
  const f=fixture(),first=imported(f),oldPlan=compileCoherentReferenceV3(f.state,first.recipe,first.readBlob),nextRaw=guidePng(2);
  const next=compileCompositionGuide(f.state,{guideId:'guide.next',specSha256:f.spec.sha256,receipt:decision('guide.next.accept',hash(nextRaw))},nextRaw);f.state.compositionGuides.set(next.sha256,next);
  const nextPlan=compileCoherentReferenceV3(f.state,{...first.recipe,planId:'guidance.next',compositionGuideSha256:next.sha256},()=>nextRaw);
  assert.notEqual(next.sha256,first.record.sha256);assert.notEqual(nextPlan.sha256,oldPlan.sha256);assert.notEqual(nextPlan.request.images[2].artifact.sha256,oldPlan.request.images[2].artifact.sha256);
  assert.deepEqual(nextPlan.referenceRequirements,oldPlan.referenceRequirements);assert.equal(nextPlan.request.prompt,oldPlan.request.prompt);
  assert.deepEqual(validateCompositionGuide(f.state,first.record,first.readBlob),unseal(first.record));
});

test('the shared pure prompt helper retains every legacy v31 and v28 plan byte by default',()=>{
  const f=fixture(),{referenceGuidanceProfile,...legacyRecipe}=f.recipe,old=compileCoherentReference(f.state,legacyRecipe),v2=compileCoherentReferenceV2(f.state,{...f.recipe,referenceGuidanceProfile:'isolated-component-v2'});
  assert.equal(old.sha256,'4d1d43e706792cb4615a750f676124410883fbe1e05442502d4b6d218174a131');
  assert.equal(v2.sha256,'fae18e723dbb59cc6b2424143e627e994657fa89373edee559f6133332705888');
  assert.equal(hash(Buffer.from(v2.request.prompt)),'eceb9507d2ba6431883cab1251f8b47711b9d4402e1ecde11f6817f267b1774f');
  assert.equal(coherentReferencePromptV2(f.spec,f.style,v2.target,''),v2.request.prompt);
  assert.equal(coherentReferencePromptV2(f.spec,f.style,v2.target,'',{compositionGuide:false}),v2.request.prompt);
  assert.match(v2.request.prompt,/All later input images provide/);assert.doesNotMatch(v2.request.prompt,/SOFT COMPOSITION INPUT/);
});
