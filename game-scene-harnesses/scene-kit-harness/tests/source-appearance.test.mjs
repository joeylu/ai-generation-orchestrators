import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {compileCoherentSource,assessCoherentSource,coherentSourceExtraInputs,verifyCoherentSourceExtraInputs} from '../src/generation/coherent-source.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {validateBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {transact} from '../src/generation/store.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {seal,unseal,digest,hash} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentBrief,coherentAnalysis,referencePng} from './helpers/coherent.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {reviewReferenceLedDesign,intakeReferenceLedImage} from '../src/reference-led-pipeline.mjs';
import {decision} from './helpers/generation.mjs';

const appearance=rules=>({format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules});
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const transformBrief=b=>({...b,style:{...b.style,rules:[
  'STYLE_LAYOUT_SENTINEL: Foreground is mandatory: two near-camera groups, one on each wall.',
  'STYLE_LEDGES_SENTINEL: Keep three playable ledges and a bright right landmark.'
]},requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,
  {subjectId:'rear',role:'valley',layerId:'landmark',content:'Natural eroded rear rock walls with attached short coral only.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',
  visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic rear layer envelope.'}]});
const band=()=>({format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),
 camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},
 parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},
 edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
function fixture(t,engineered=false){
 const f=setupCoherent(t,'Source ownership fixture',undefined,{transformBrief,transformAnalysis});
 const visual=transact(f.workflow,store=>{const s=replay(store),r=s.plans.get(f.plan.sha256);return flow.createVisualCoherence(s.designs.get(f.plan.recipe.specSha256),s.designs.get(f.plan.recipe.styleSha256),r.reconstructionTarget,
  {...(engineered?{sceneFamily:'engineered-city'}:{}),lighting:'LIGHTING_OBSERVATION_SENTINEL: two foreground groups must be deep and low.',brushwork:'BRUSH_OBSERVATION_SENTINEL: put a tree on the left.',materialScale:'MATERIAL_OBSERVATION_SENTINEL: add a complete city.',depth:'DEPTH_OBSERVATION_SENTINEL: add both near-camera fixtures and three ledges.'});});
 let scopes=flow.withVisualCoherenceScopes(f.brief.requirements,flow.createLayerSourceScopes(f.brief.requirements),visual);
 scopes=flow.withScopeOwnedGroundingScopes(f.brief.requirements,scopes,['landmark','foreground']);
 scopes=flow.withSourceVisualGuideScopes(f.brief.requirements,scopes,['foreground']);
 scopes=flow.withBackgroundBandScopes(f.brief.requirements,scopes,[{subjectId:'rear',backgroundBand:band()}]);
 return {...f,scopes,visual};
}
const selected=[{subjectId:'rear',sourceAppearance:appearance(['Quiet cool blue-grey eroded rock, soft upper-left light and broad hand-painted texture.'])},
 {subjectId:'foreground',sourceAppearance:appearance(['Deep blue-grey shadow on all broad faces; sparse narrow cool edge accents.'])}];
const options=(f,scopes,batchId)=>({...f.options,batchId,sourceScopes:scopes});
const receive=(workflow,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);};

test('appearance contract requires explicit bounded rules and never guesses rules from prose',()=>{
 assert.equal(flow.SOURCE_APPEARANCE_PROFILE,'source-owned-appearance-v1');
 const own=appearance(['Use warm wood edges.','Keep the two attached pieces in the declared asset brief.']);
 assert.deepEqual(flow.validateSourceAppearance(own),own);
 assert.match(flow.sourceAppearancePrompt(own,'Painted label'),/two attached pieces/,'the contract is explicit, not a word-list content filter');
 for(const bad of [{...own,profile:'automatic-extract'},appearance([]),appearance(['']),appearance(['same','same']),{...own,autoFilter:true},appearance(['C:/private/local-path'])])assert.throws(()=>flow.validateSourceAppearance(bad));
});

test('public coherent init brief freezes appearance in the first source plans without a revision',t=>{
 const holder=setupCoherent(t),root=join(holder.parent,'first-appearance-project'),brief=coherentBrief('First source appearance'),own=appearance(['Deep cool blue faces with restrained hand-painted edge light.']);
 brief.style.rules=['INITIAL_SCENE_SENTINEL: two foreground groups and three playable ledges are mandatory.'];
 brief.sourceScopes=[{subjectId:'foreground',parentRole:'foreground',content:'One complete compact decorative rock group only.',exclusions:['Neighboring distinct subject groups'],sourceAppearance:own}];
 const direct=flow.createLayerSourceScopes(brief.requirements,brief.sourceScopes);assert.equal(direct.format,'ai_scene_layer_source_scopes_v6');
 assert.throws(()=>flow.createLayerSourceScopes(brief.requirements,[{...brief.sourceScopes[0],sourceAppearance:{...own,profile:'guess-rules'}}]));
 const initial=pipeline.initCoherentPipeline(root,brief);
 reviewReferenceLedDesign(root,{spec:decision('first.spec',initial.design.specSha256),style:decision('first.style',initial.design.styleSha256)});
 const image=join(holder.parent,'first-reference.png'),raw=referencePng();writeFileSync(image,raw);
 intakeReferenceLedImage(root,image,{planId:'first.reference.candidate'});
 const before=pipeline.inspectCoherentPipeline(root),workflow=join(root,'workflow'),plan=flow.getGenerationPlan(workflow,before.reference.planSha256),analysis=coherentAnalysis(plan,hash(raw),brief.requirements),review=join(holder.parent,'first-review');
 pipeline.prepareCoherentReferenceReview(root,analysis,review);const packet=JSON.parse(readFileSync(join(review,'review-packet.json'),'utf8'));
 pipeline.reviewCoherentReference(root,analysis,decision('first.reference.accept',packet.sha256));
 const state=pipeline.inspectCoherentPipeline(root);assert.equal(state.stage,'awaiting-source-compute');assert.equal(state.sources.length,6);
 const foreground=state.sources.map(s=>flow.getGenerationPlan(workflow,s.planSha256)).filter(p=>p.instanceBinding.role==='foreground');
 assert.equal(foreground.length,2);
 for(const p of foreground){assert.equal(p.recipe.sourceScope.format,'ai_scene_layer_source_scope_v6');assert.deepEqual(p.recipe.sourceScope.sourceAppearance,own);assert.deepEqual(p.recipe.parents,[]);assert.doesNotMatch(p.request.prompt,/INITIAL_SCENE_SENTINEL/);assert.match(p.request.prompt,/One complete compact decorative rock group/);}
 assert(flow.inspectWorkflow(workflow).plans.filter(p=>p.stage==='coherent-source').every(p=>state.sources.some(s=>s.planSha256===p.planSha256)),'there is no earlier unprofiled source batch');
});

test('explicit v6 sources isolate both scene-rule and observation routes, preserving legacy plans and source-owned guides',t=>{
 const f=fixture(t),old=flow.previewCoherentSources(f.workflow,options(f,f.scopes,'appearance.compare')),
  scopes=flow.withSourceAppearanceScopes(f.brief.requirements,f.scopes,selected),next=flow.previewCoherentSources(f.workflow,options(f,scopes,'appearance.compare'));
 assert.equal(scopes.format,'ai_scene_layer_source_scopes_v6');
 for(const p of old.plans){assert.match(p.request.prompt,/STYLE_LAYOUT_SENTINEL/);assert.match(p.request.prompt,/DEPTH_OBSERVATION_SENTINEL/);}
 for(const [i,p]of next.plans.entries()){
  if(!['foreground','valley'].includes(p.instanceBinding.role)){assert.deepEqual(p,old.plans[i]);continue;}
  assert.equal(p.recipe.sourceScope.format,'ai_scene_layer_source_scope_v6');assert.match(p.compiler,/-source-owned-appearance-v1$/);
  assert.doesNotMatch(p.request.prompt,/STYLE_LAYOUT_SENTINEL|STYLE_LEDGES_SENTINEL|LIGHTING_OBSERVATION_SENTINEL|BRUSH_OBSERVATION_SENTINEL|MATERIAL_OBSERVATION_SENTINEL|DEPTH_OBSERVATION_SENTINEL/);
  assert.match(p.request.prompt,/SINGLE-ASSET BRIEF:/);assert.match(p.request.prompt,/SHARED VISUAL COHERENCE/);assert.match(p.request.prompt,/Source appearance:/);
  assert.equal(p.recipe.sourceScope.visualCoherence.sha256,f.visual.sha256,'original full coherence evidence remains bound');
  assert.equal(p.sourceScope.sourceAppearanceEvidence.inheritedSceneRules,false);assert.equal(p.sourceScope.sourceAppearanceEvidence.inheritedSceneObservations,false);
  assert.equal(p.sourceScope.sourceAppearanceEvidence.sceneStyleSha256,f.plan.recipe.styleSha256);
  assert.deepEqual(p.request.images,old.plans[i].request.images);assert.equal(coherentSourceExtraInputs(p).length,1);
  if(p.instanceBinding.role==='foreground'){assert.match(p.request.prompt,/majority-surfaces-deep-shadow-v1/);assert.match(p.request.prompt,/GROUNDING OWNERSHIP/);assert.equal(p.recipe.sourceScope.groundingProfile,'scope-owned-support-v1');}
  else{assert.match(p.request.prompt,/natural-top-finite|BACKGROUND BAND background-band-coverage-v3/);assert.equal(p.recipe.sourceScope.backgroundBand.profile,'background-band-coverage-v3');assert.equal(assessCoherentSource(p,sourcePng(true,9)).status,'pass');}
 }
 const front=old.plans.find(p=>p.instanceBinding.role==='foreground'),single=flow.withSourceAppearance(front.recipe.sourceScope,selected[1].sourceAppearance);
 assert.deepEqual(single,next.plans.find(p=>p.recipe.assetId===front.recipe.assetId).recipe.sourceScope);
 assert.deepEqual(flow.withSourceAppearance(single,selected[1].sourceAppearance),single);
 const plain=flow.createLayerSourceScopes(f.brief.requirements),appearanceFirst=flow.withSourceAppearanceScopes(f.brief.requirements,plain,selected),ground=s=>flow.withScopeOwnedGroundingScopes(f.brief.requirements,s,['foreground']),guide=s=>flow.withSourceVisualGuideScopes(f.brief.requirements,s,['foreground']);
 assert.deepEqual(ground(guide(appearanceFirst)),flow.withSourceAppearanceScopes(f.brief.requirements,ground(guide(plain)),selected));
 assert.deepEqual(guide(ground(appearanceFirst)),ground(guide(appearanceFirst)));
 assert.throws(()=>flow.withSourceAppearanceScopes(f.brief.requirements,f.scopes,[...selected,selected[0]]));
 assert.throws(()=>flow.withSourceAppearanceScopes(f.brief.requirements,f.scopes,[{...selected[0],subjectId:'missing'}]));
});

test('engineered sources isolate the second observation branch while preserving industrial material contracts',t=>{
 const f=fixture(t,true),scopes=flow.withSourceAppearanceScopes(f.brief.requirements,f.scopes,[{subjectId:'ground',sourceAppearance:appearance(['Graphite metal panels, small deliberate seams and soft upper-left illumination.'])}]),
  plan=flow.previewCoherentSources(f.workflow,options(f,scopes,'appearance.engineered')).plans[0];
 assert.doesNotMatch(plan.request.prompt,/STYLE_LAYOUT_SENTINEL|STYLE_LEDGES_SENTINEL|OBSERVATION_SENTINEL/);
 assert.match(plan.request.prompt,/Graphite metal panels/);assert.match(plan.request.prompt,/engineered city asset/);assert.match(plan.request.prompt,/TERRAIN STRUCTURE/);
 assert.equal(plan.recipe.sourceScope.visualCoherence.sceneFamily,'engineered-city');assert.equal(plan.recipe.sourceScope.visualCoherence.sha256,f.visual.sha256);
});

test('a shared material source rejects differing or partially assigned appearance among its ground subjects',t=>{
 const f=setupCoherent(t,'Two ground materials',undefined,{transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,
  {subjectId:'ground-extra',role:'ground',layerId:'ground',content:'Second ground sharing the same material source.',count:{min:1,max:1},placementHint:'right'}]})}),
  transformAnalysis:a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'ground.extra',subjectId:'ground-extra',layerId:'ground',visibleEnvelope:[{x:80,y:100},{x:100,y:100},{x:100,y:144},{x:80,y:144}],anchor:{x:90,y:120},visibility:'visible',anchorEvidence:'observed',notes:'Second synthetic shared-ground instance.'}],
   surfaces:[...a.surfaces,{surfaceId:'ground.extra.surface',instanceId:'ground.extra',points:[{x:80,y:100},{x:100,y:100}],evidence:'observed',notes:'Second synthetic surface.'}]})});
 const plain=flow.createLayerSourceScopes(f.brief.requirements),a=appearance(['Cool grey rock planes.']),assigned=rows=>flow.withSourceAppearanceScopes(f.brief.requirements,plain,rows);
 rejects(()=>flow.previewCoherentSources(f.workflow,options(f,assigned([{subjectId:'ground',sourceAppearance:a}]),'appearance.partial')),'SOURCE_APPEARANCE_MATERIAL_AMBIGUOUS');
 rejects(()=>flow.previewCoherentSources(f.workflow,options(f,assigned([{subjectId:'ground',sourceAppearance:a},{subjectId:'ground-extra',sourceAppearance:appearance(['Warm copper panels.'])}]),'appearance.conflict')),'SOURCE_APPEARANCE_MATERIAL_AMBIGUOUS');
 const complete=flow.previewCoherentSources(f.workflow,options(f,assigned([{subjectId:'ground',sourceAppearance:a},{subjectId:'ground-extra',sourceAppearance:a}]),'appearance.same'));
 assert.equal(complete.plans[0].recipe.sourceScope.sourceAppearance.rules[0],a.rules[0]);
});

test('v6 guide export, replay, capability and metadata integrity remain enforced',t=>{
 const f=fixture(t),scopes=flow.withSourceAppearanceScopes(f.brief.requirements,f.scopes,selected),preview=flow.previewCoherentSources(f.workflow,options(f,scopes,'appearance.freeze'));
 const batch=flow.freezeCoherentSources(f.workflow,options(f,scopes,'appearance.freeze'));
 for(const p of preview.plans.filter(p=>p.recipe.sourceScope.sourceAppearance)){
  assert.deepEqual(flow.getGenerationPlan(f.workflow,p.sha256),p);
  assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,0),f.raw);
  const extra=coherentSourceExtraInputs(p)[0];assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,1),extra);
  assert.throws(()=>verifyCoherentSourceExtraInputs(p,()=>Buffer.alloc(10)));
  if(p.instanceBinding.role==='valley'){
   const rgba=Buffer.alloc(512*256*4);for(let y=20;y<256;y++)for(let x=0;x<512;x++)rgba.set([40+x%100,70+y%90,105,255],(y*512+x)*4);
   const raw=encodeRgbaPng(512,256,rgba),qa=assessCoherentSource(p,raw);assert.equal(qa.status,'pass');assert.equal(qa.boundaryProfile,'natural-top-finite-three-cuts-v1');
   const row=flow.createBackgroundBandPlacement({plan:p,raw,target:f.target,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-128,y:0}});
   assert.deepEqual(row.nativeFrame,{x:0,y:0,width:512,height:256});
   rejects(()=>validateBackgroundBandPlacement({...row,nativeFrame:{...row.nativeFrame,width:500}},{plan:p,raw,target:f.target}),'BACKGROUND_BAND_NATIVE_FRAME');
  }
  transact(f.workflow,store=>{
   const s=replay(store),apply=changed=>applyRecord(store,{...s,plans:new Map(s.plans),ids:new Set(s.ids)},changed),{sha256,...body}=p;
   rejects(()=>apply(seal({...body,sourceScope:{...p.sourceScope,sourceAppearanceEvidence:{...p.sourceScope.sourceAppearanceEvidence,inheritedSceneRules:true}}})),'PLAN_RECOMPILE_MISMATCH');
   rejects(()=>apply(seal({...body,request:{...p.request,prompt:p.request.prompt+'\nSTYLE_LAYOUT_SENTINEL'}})),'PLAN_RECOMPILE_MISMATCH');
   const cap=s.capabilities.get(p.recipe.capabilitiesSha256);s.capabilities.set(cap.sha256,{...cap,maxInputImages:1});
   assert.throws(()=>compileCoherentSource(s,p.recipe,sha=>store.readBlob(sha)));
  });
 }
 assert.equal(batch.planSha256s.length,preview.plans.length);
});

test('appearance revision reserves no image and cannot transfer an unused old authorization',t=>{
 const f=fixture(t),styleBefore=hash(readFileSync(join(f.root,'style-draft.json'))),old=flow.freezeCoherentSources(f.workflow,options(f,f.scopes,'appearance.old'));
 flow.authorizeReferenceAssetBatch(f.workflow,old.sha256,decision('appearance.old.compute',old.sha256,'approve-compute'));
 const oldRear=old.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.instanceBinding.role==='valley');
 assert.equal(receive(f.workflow,oldRear.sha256,sourcePng(true,8)).technical.status,'pass');
 const front=old.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.instanceBinding.role==='foreground'),
  changed=flow.reviseCoherentSources(f.workflow,old.sha256,{batchId:'appearance.revised',replacements:[oldRear,front].map(p=>({assetId:p.recipe.assetId,planId:'appearance.changed.'+p.recipe.assetId,intent:'isolated-layer-v4',sourceScope:flow.withSourceAppearance(p.recipe.sourceScope,appearance(['Only this source has cool painted edges and soft upper-left light.']))}))}),
  newIds=changed.planSha256s.filter(sha=>!old.planSha256s.includes(sha));
 assert.equal(newIds.length,2);
 for(const sha of newIds)rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
 flow.authorizeReferenceAssetBatch(f.workflow,changed.sha256,decision('appearance.fresh.compute',changed.sha256,'approve-compute'));
 const ticket=flow.reservePlan(f.workflow,newIds[0]);assert.equal(ticket.planSha256,newIds[0]);
 assert.deepEqual(flow.getGenerationResult(f.workflow,oldRear.sha256).bytes,sourcePng(true,8));
 assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===front.sha256).status,'authorized');
 const material=old.planSha256s[0];assert.equal(changed.planSha256s[0],material,'unselected material source retains its exact original plan');
 assert.equal(hash(readFileSync(join(f.root,'style-draft.json'))),styleBefore,'a source appearance revision never rewrites the original scene style');
});
