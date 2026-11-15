import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,referencePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const profile='scope-owned-support-v1';
const override=(subjectId,parentRole,groundingProfile=profile)=>({subjectId,parentRole,content:`Distinct ${subjectId} only`,exclusions:['Unrelated scenery'],groundingProfile});
const requirements=()=>{const brief=coherentBrief();return seal({...unseal(brief.requirements),subjects:[...brief.requirements.subjects,
  {subjectId:'scenery',role:'scenery',layerId:'landmark',content:'Synthetic scenery',count:{min:1,max:1},placementHint:'center'},
  {subjectId:'valley',role:'valley',layerId:'landmark',content:'Synthetic valley',count:{min:1,max:1},placementHint:'wide'}]});};
const band=()=>({format:'ai_scene_background_band_v1',profile:'background-band-v1',camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
test('brief grounding overrides use the existing helper and preserve legacy bytes and other profiles',()=>{
  const req=requirements(),rows=[override('landmark','far'),override('scenery','middle'),override('foreground','foreground')],without=rows.map(({groundingProfile,...r})=>r);
  const legacy=flow.createLayerSourceScopes(req,without),explicit=flow.createLayerSourceScopes(req,rows);
  assert.deepEqual(explicit,flow.withScopeOwnedGroundingScopes(req,legacy,['landmark','scenery','foreground']));
  assert.deepEqual(flow.createLayerSourceScopes(req,without),legacy);
  const mixed=flow.createLayerSourceScopes(req,[{...rows[0],sourceAppearance:{format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules:['Synthetic warm paint.']}},rows[1],rows[2],{subjectId:'valley',parentRole:'far',content:'Synthetic valley only',exclusions:[],backgroundBand:band()}]);
  for(const id of ['landmark','scenery','foreground'])assert.equal(mixed.subjects.find(s=>s.subjectId===id).groundingProfile,profile);
  assert.equal(mixed.subjects.find(s=>s.subjectId==='valley').backgroundBand.profile,'background-band-v1');
  assert.equal(mixed.subjects.find(s=>s.subjectId==='landmark').sourceAppearance.profile,'source-owned-appearance-v1');
  assert.throws(()=>flow.createLayerSourceScopes(req,[override('foreground','foreground','invented')]));
  assert.throws(()=>flow.createLayerSourceScopes(req,[override('sky','background')]));
  assert.throws(()=>flow.createLayerSourceScopes(req,[override('ground','main')]));
  assert.throws(()=>flow.createLayerSourceScopes(req,[{...override('valley','far'),backgroundBand:band()}]));
  assert.throws(()=>flow.createLayerSourceScopes(req,[override('missing','foreground')]));
});

test('deferred observation coverage binds the final brief-selected grounding before source freeze',{timeout:180000},t=>{
  const parent=mkdtempSync(join(tmpdir(),'brief-grounding-')),root=join(parent,'project');t.after(()=>{const rel=relative(resolve(tmpdir()),resolve(parent));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('temp path');rmSync(parent,{recursive:true,force:true});});
  const brief=coherentBrief(),rows=[override('landmark','far'),override('foreground','foreground')];brief.sourceScopes=rows;
  const initial=pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation'}),workflow=join(root,'workflow');
  pipeline.reviewCoherentDesign(root,{spec:decision('brief.spec',initial.design.specSha256),style:decision('brief.style',initial.design.styleSha256)});
  const status=pipeline.inspectCoherentPipeline(root),plan=flow.getGenerationPlan(workflow,status.reference.planSha256);
  pipeline.authorizeCoherentStage(root,decision('brief.reference.compute',plan.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(workflow,plan.sha256);flow.recordSubmission(workflow,ticket);const bytes=referencePng();flow.receiveResult(workflow,ticket,bytes);
  const analysis=coherentAnalysis(plan,hash(bytes),brief.requirements),packet=pipeline.prepareCoherentReferenceReview(root,analysis,join(parent,'review'));
  pipeline.reviewCoherentReference(root,analysis,decision('brief.reference.accept',packet.packetSha256),{deferObservationCoverage:true});
  assert.throws(()=>pipeline.advanceCoherentPipeline(root));
  const persisted=JSON.parse(readFileSync(join(root,'source-scopes.json'))),selected=persisted.subjects.filter(s=>['landmark','foreground'].includes(s.subjectId));
  const observations=selected.map(s=>({observationId:`observed.${s.subjectId}`,description:s.content,layerId:s.layerId,parentRole:s.parentRole}));
  const data={requiredObservationIds:observations.map(o=>o.observationId),observations,assignments:selected.map(s=>({observationId:`observed.${s.subjectId}`,subjectId:s.subjectId,scopeQuote:s.content}))};
  const coverage=pipeline.checkCoherentObservationCoverage(root,data);assert.equal(coverage.status,'pass');
  const accepted=JSON.parse(readFileSync(join(root,'reference-observation-accepted.json')));assert.equal(accepted.report.sourceScopesSha256,coverage.sourceScopesSha256);
  const read=n=>JSON.parse(readFileSync(join(root,n))),spec=read('spec-draft.json'),style=read('style-draft.json'),visual=read('visual-observations.json');
  const target=flow.getReferenceReconstructionTarget(workflow,plan.sha256),finalScopes=flow.withVisualCoherenceScopes(spec.requirements,persisted,flow.createVisualCoherence(spec,style,target,visual.observations));
  assert.equal(coverage.sourceScopesSha256,finalScopes.sha256);
  const preview=pipeline.prepareCoherentSourceScopeReview(root,join(parent,'source-review'));assert.equal(preview.sourceScopesSha256,coverage.sourceScopesSha256);
  const previewScopes=JSON.parse(readFileSync(join(parent,'source-review/source-scopes.json')));assert.deepEqual(previewScopes,finalScopes);
  const next=pipeline.advanceCoherentPipeline(root),batch=flow.getCoherentSourceBatch(workflow,next.batchSha256),plans=batch.planSha256s.map(s=>flow.getGenerationPlan(workflow,s));
  for(const p of plans.filter(x=>['landmark','foreground'].includes(x.instanceBinding.role))){const row=preview.sources.find(x=>x.assetId===p.recipe.assetId);assert(row);assert.equal(row.scope.sha256,p.recipe.sourceScope.sha256);assert.equal(readFileSync(join(parent,'source-review',row.afterPrompt),'utf8'),p.request.prompt);assert.equal(p.recipe.sourceScope.groundingProfile,profile);assert.equal(p.recipe.sourceScope.visualCoherence.sha256,finalScopes.visualCoherence.sha256);assert.match(p.request.prompt,/only when explicitly declared by the SINGLE-ASSET BRIEF/);}
  assert(plans.filter(x=>['landmark','foreground'].includes(x.instanceBinding.role)).length>=2);
  assert(plans.filter(x=>['material','sky','platform'].includes(x.instanceBinding.role)).every(p=>!Object.hasOwn(p.recipe.sourceScope,'groundingProfile')));
});
