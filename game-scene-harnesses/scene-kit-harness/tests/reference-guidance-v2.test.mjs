import test from 'node:test';
import assert from 'node:assert/strict';
import {controlGuideRecipe,renderControlGuides} from '../src/reference-controls.mjs';
import {REFERENCE_GUIDANCE_PROFILE,controlGuideRecipeV2,renderControlGuidesV2} from '../src/reference-controls-v2.mjs';
import {coherentReferenceGuidesV2,compileCoherentReferenceV2} from '../src/generation/coherent-reference-v2.mjs';
import {compileCoherentReference} from '../src/generation/coherent-reference.mjs';
import {compileReferenceLedPlan} from '../src/generation/reference-led.mjs';
import {inspectPng} from '../src/png.mjs';
import {seal,unseal,hash,imageRef} from '../src/generation/common.mjs';
import {coherentBrief,referencePng} from './helpers/coherent.mjs';
import {capabilitiesDraft} from './helpers/generation.mjs';

const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
function fixture({description='Synthetic reference guidance compatibility',support='Use the explicitly requested support relationship.',inputs=[]}={}){
  const brief=coherentBrief(description),requirements=unseal(brief.requirements);
  if(support!=='Use the explicitly requested support relationship.')requirements.compositionNotes.push(support);
  const spec=seal({format:'ai_scene_spec_v3',specId:'guidance.spec',projection:'sideview',description:brief.description,
    inputs,viewport:brief.viewport,maxAspectErrorPermille:brief.maxAspectErrorPermille,requirements:seal(requirements)});
  const style=seal({format:'ai_scene_style_v2',styleId:'guidance.style',mode:'preset',name:'Synthetic illustrated style',
    rules:['Broad painted forms; retain local material colors.'],anchors:[]});
  const cap=seal(capabilitiesDraft()),state={designs:new Map([[spec.sha256,spec],[style.sha256,style]]),capabilities:new Map([[cap.sha256,cap]]),
    designReviews:new Map([[spec.sha256,{sha256:'a'.repeat(64),receipt:{decision:'accept'}}],[style.sha256,{sha256:'b'.repeat(64),receipt:{decision:'accept'}}]]),plans:new Map()};
  const recipe={planId:'guidance.fixture',parents:[],stage:'reference',mode:'reference-led',specSha256:spec.sha256,styleSha256:style.sha256,
    capabilitiesSha256:cap.sha256,referencePlans:[],inventoryRefs:[],assetId:'scene-reference',
    pixelPolicy:{mode:'native-reference',orientation:'landscape',minimumShortEdge:256,maximumWidth:4096,maximumHeight:4096},intent:'',referenceGuidanceProfile:REFERENCE_GUIDANCE_PROFILE};
  return {spec,style,cap,state,recipe};
}
function oldRecipe(recipe){const {referenceGuidanceProfile,...legacy}=recipe;return legacy;}

test('v2 replays the unchanged projection and the exact complete-component proposal with a clear border and open cable',()=>{
  const images=renderControlGuidesV2(),old=renderControlGuides();
  assert.deepEqual([...images.keys()],['projection-guide.png','focus-guide.png']);
  assert.deepEqual(images.get('projection-guide.png'),old.get('projection-guide.png'));
  assert.equal(hash(images.get('projection-guide.png')),'2619d46aa41b10867799487cb0547579081a5ba45d95e817d2b2a760ac396e43');
  assert.equal(hash(images.get('focus-guide.png')),'e0b82ccbce22883727c1cf55765d415a72c98395dc7faa614f97e9c099e1b162');
  assert.equal(images.get('focus-guide.png').length,3586);assert.notEqual(controlGuideRecipeV2.sha256,controlGuideRecipe.sha256);
  const png=inspectPng(images.get('focus-guide.png'),{includePixels:true}),background=[245,246,244,255],pixel=(x,y)=>[...png.rgba.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)];
  assert.equal(png.width,512);assert.equal(png.height,512);
  for(let edge=0;edge<512;edge++)for(const [x,y]of [[edge,0],[edge,511],[0,edge],[511,edge]])assert.deepEqual(pixel(x,y),background);
  assert.deepEqual(pixel(240,325),background,'cable loop interior remains open');
  for(const [x,y]of [[210,325],[240,346],[280,325],[90,190],[407,235]])assert.deepEqual(pixel(x,y),[49,55,61,255]);
  assert.deepEqual(pixel(240,470),background,'no common bottom support stripe');
  assert.deepEqual(coherentReferenceGuidesV2().map(({path,bytes})=>[path,hash(bytes)]),[...images].map(([path,bytes])=>[path,hash(bytes)]));
});

test('a re-sealed change to component geometry, color or projection identity cannot replace the versioned v2 examples',()=>{
  assert.throws(()=>{controlGuideRecipeV2.focus.operations[0].rect[0]=0;},TypeError);
  for(const mutate of [body=>{body.focus.operations[0].rect[0]=0;},body=>{body.focus.background[0]=0;},body=>{body.projection.sourceRecipeSha256='f'.repeat(64);}]){
    const body=unseal(structuredClone(controlGuideRecipeV2));mutate(body);rejects(()=>renderControlGuidesV2(seal(body)),'CONTROL_GUIDE_V2_RECIPE');
  }
});

test('v31 binds the two new guide identities, preserves accepted data, and replaces the conflicting old bottom/props prompt',()=>{
  const f=fixture(),before=structuredClone(f.state),legacy=compileReferenceLedPlan(f.state,oldRecipe(f.recipe)),plan=compileCoherentReferenceV2(f.state,f.recipe);
  assert.equal(plan.format,'ai_scene_generation_plan_v31');assert.equal(plan.request.format,'ai_scene_image_request_v31');assert.equal(plan.compiler,'scene-kit-coherent-reference-v2');
  assert.deepEqual(plan.recipe,f.recipe);assert.equal(plan.recipe.referenceGuidanceProfile,REFERENCE_GUIDANCE_PROFILE);
  assert.deepEqual(plan.target,legacy.target);assert.deepEqual(plan.referenceRequirements,f.spec.requirements);assert.deepEqual(plan.designReviews,legacy.designReviews);
  assert.equal(plan.neutralGuideEvidence.recipeSha256,controlGuideRecipeV2.sha256);assert.equal(plan.neutralGuideEvidence.effect,'requires-actual-image-review');
  assert.deepEqual(plan.request.images.map(image=>image.role),['neutral-front-elevation-example','neutral-complete-isolated-component-example']);
  assert.deepEqual(plan.request.images.map(image=>image.artifact.sha256),coherentReferenceGuidesV2().map(image=>hash(image.bytes)));
  assert.equal(plan.request.maximumCalls,1);assert.equal(plan.request.output.alpha,'opaque');
  const prompt=plan.request.prompt;
  assert.match(prompt,/FRAME COVERAGE AND COMPONENT COMPLETENESS ARE SEPARATE/);assert.match(prompt,/vertical facade masses.*lower frame/);
  assert.match(prompt,/closed ends.*short attachment points.*cable returning/);assert.match(prompt,/visible context space around/);
  assert.match(prompt,/modest side planes and small roof planes/);assert.match(prompt,/every explicitly requested independent module/);assert.match(prompt,/unrequested characters, vehicles, props/);
  assert.doesNotMatch(prompt,/No undesigned gray footer|Resolve the full frame, including the bottom|characters, independent props|SCENE_DESCRIPTION=|INTENT=/);
  for(const subject of f.spec.requirements.subjects){assert(prompt.includes(subject.subjectId));assert(prompt.includes(subject.content));}
  assert.deepEqual(f.state,before,'pure compilation cannot approve, reserve or append an attempt');
});

test('v2 support comes from accepted requirements and keeps arbitrary styles and later style inputs rather than prescribing wall mounting',()=>{
  for(const support of ['The fixture stands on its explicitly requested existing terrace.','The fixture hangs from its explicitly requested overhead beam.']){
    const input={role:'style-reference',artifact:imageRef(referencePng())},f=fixture({description:'Synthetic alternate illustrated subject',support,inputs:[input]}),plan=compileCoherentReferenceV2(f.state,f.recipe);
    assert(plan.request.prompt.includes(support));assert(plan.request.prompt.includes(f.style.rules[0]));
    assert.match(plan.request.prompt,/does not prescribe wall mounting or any other support type/);
    assert.equal(plan.request.images.length,3);assert.deepEqual(plan.request.images[2],input);
    assert.deepEqual(plan.referenceRequirements,f.spec.requirements);assert.equal(plan.inputPolicy.pregenerationPixelGeometry,'not-prescribed');
  }
});

test('v31 requires the exact guidance enum and recipe shape before producing a plan',()=>{
  const f=fixture();
  rejects(()=>compileCoherentReferenceV2(f.state,{...f.recipe,referenceGuidanceProfile:'unlisted-profile'}),'COHERENT_REFERENCE_GUIDANCE_PROFILE');
  assert.throws(()=>compileCoherentReferenceV2(f.state,oldRecipe(f.recipe)));
  assert.throws(()=>compileCoherentReferenceV2(f.state,{...f.recipe,undocumentedControl:true}));
  rejects(()=>compileCoherentReferenceV2(f.state,{...f.recipe,parents:['a'.repeat(64),'b'.repeat(64)]}),'PLAN_PARENT');
});

test('v31 can replace only one terminal v28 or v31 attempt and retains the previous plan without changing its outcome',()=>{
  for(const format of ['ai_scene_generation_plan_v28','ai_scene_generation_plan_v31'])for(const status of ['failed','indeterminate','rejected-technical','rejected-visual']){
    const f=fixture(),sha='c'.repeat(64),parent={plan:{format},status};f.state.plans.set(sha,parent);const before=structuredClone(f.state);
    const plan=compileCoherentReferenceV2(f.state,{...f.recipe,parents:[sha]});assert.deepEqual(plan.recipe.parents,[sha]);assert.deepEqual(f.state,before);
  }
  for(const [format,status]of [['ai_scene_generation_plan_v18','failed'],['ai_scene_generation_plan_v28','planned'],['ai_scene_generation_plan_v31','submitted'],['ai_scene_generation_plan_v31','accepted']]){
    const f=fixture(),sha='c'.repeat(64);f.state.plans.set(sha,{plan:{format},status});rejects(()=>compileCoherentReferenceV2(f.state,{...f.recipe,parents:[sha]}),'PLAN_PARENT');
  }
});

test('v31 retains design review and image-count capability gates while the complete legacy v28 plan stays byte-identical',()=>{
  const original=fixture(),legacy=compileCoherentReference(original.state,oldRecipe(original.recipe));
  assert.equal(legacy.sha256,'4d1d43e706792cb4615a750f676124410883fbe1e05442502d4b6d218174a131');
  assert.equal(hash(Buffer.from(legacy.request.prompt)),'f9ae58b6f80f7691612725c8689695eb521b1782c33796b2628653abe2bd8d55');
  assert.equal(hash(renderControlGuides().get('focus-guide.png')),'883199d7f74d3fa84b8322e90d1ad6434723fbb1ddc61d7dee39cf79adbd871b');
  const unreviewed=fixture();unreviewed.state.designReviews.delete(unreviewed.spec.sha256);rejects(()=>compileCoherentReferenceV2(unreviewed.state,unreviewed.recipe),'DESIGN_REVIEW_REQUIRED');
  for(const change of [{maxInputImages:1},{imageToImage:false}]){
    const f=fixture(),cap=seal({...unseal(f.cap),...change});f.state.capabilities.set(cap.sha256,cap);
    rejects(()=>compileCoherentReferenceV2(f.state,{...f.recipe,capabilitiesSha256:cap.sha256}),'COHERENT_REFERENCE_CAPABILITY');
  }
  const f=fixture({inputs:[{role:'style-reference',artifact:imageRef(referencePng())}]}),cap=seal({...unseal(f.cap),maxInputImages:2});f.state.capabilities.set(cap.sha256,cap);
  rejects(()=>compileCoherentReferenceV2(f.state,{...f.recipe,capabilitiesSha256:cap.sha256}),'COHERENT_REFERENCE_CAPABILITY');
});
