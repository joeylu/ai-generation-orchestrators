import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {createMeasuredCoherentComposition,createFeatureCoherentComposition} from '../src/coherent-composition.mjs';
import {createReferenceStructure} from '../src/reference-feature-layout.mjs';
import {REFERENCE_INTENT_CRITERIA} from '../src/reference-intent-review.mjs';
import {hash,digest,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,coherentSurfaceObservations,sourcePng,referencePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const json=path=>JSON.parse(readFileSync(path,'utf8'));
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
function setup(t){const parent=mkdtempSync(join(tmpdir(),'coherent-measured-pipeline-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project');pipeline.initCoherentPipeline(root,coherentBrief('Synthetic sandstone scene'),{purpose:'synthetic-simulation'});return {parent,root,workflow:join(root,'workflow')};}

test('new projects stop before unmeasured delivery; exact surface review and typed calibration are zero-generation operations',{timeout:240000},async t=>{
  const f=setup(t),calls=[],approvals=[],delivery=join(f.parent,'delivery');
  const pending=await pipeline.driveCoherentPipeline(f.root,{delivery,
    imageAdapter:{preflight:async()=>{},generate:async input=>{calls.push(input);return input.request.task==='reference'?referencePng():sourcePng(input.request.output.alpha==='transparent',17);}},
    planner:{analyze:async({request})=>coherentAnalysis({sha256:request.planSha256},request.rawSha256,request.requirements)},
    operator:{reviewDesign:async status=>({spec:decision('spec.accept',status.design.specSha256),style:decision('style.accept',status.design.styleSha256)}),
      approveCompute:async snapshot=>{approvals.push(snapshot);return decision('compute.'+approvals.length,snapshot.targetSha256,'approve-compute');},
      reviewReference:async review=>decision('reference.accept',review.packet.packetSha256)}});
  assert.equal(pending.stage,'awaiting-surface-mapping');assert.equal(pending.technicalStage,'ready-to-deliver');assert.equal(existsSync(delivery),false);
  assert.equal(calls.length,7);assert.equal(approvals.length,2);
  const project=json(join(f.root,'coherent-project.json'));assert.equal(project.format,'ai_scene_coherent_project_v4');assert.equal(project.assemblyPolicy,'reference-measured-surface-required-v1');
  const inspected=pipeline.inspectCoherentPipeline(f.root);assert.equal(inspected.stage,'ready-to-deliver');assert.equal(inspected.assemblyRequirements.surfaceMappingRequired,true);
  const before=flow.inspectWorkflow(f.workflow);rejects(()=>pipeline.deliverCoherentPipeline(f.root,delivery),'COHERENT_SURFACE_MAPPING_REQUIRED');
  assert.equal(existsSync(delivery),false);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const inputs=pipeline.coherentSurfaceInputs(f.root);assert.equal(hash(inputs.reference.raw),hash(referencePng()));assert.equal(hash(inputs.material.raw),hash(sourcePng(false,17)));
  assert.equal(inputs.target.rawSha256,inputs.reference.rawSha256);assert.equal(inputs.batch.sha256,inspected.batchSha256);
  const observations={...coherentSurfaceObservations(),sourceSurfaceTopY:0,sourceBodyStartY:70,
    rockFeaturePairs:[{featureId:'large.rational.rock',source:{fromX:100,toX:203},reference:{fromX:80,toX:229}}]},invalid=join(f.parent,'invalid-review');
  rejects(()=>pipeline.prepareCoherentSurfaceReview(f.root,{...observations,sourceBodyStartY:observations.sourceSurfaceTopY},invalid),'MEASURED_SOURCE_ORIGINS');
  assert.equal(existsSync(invalid),false);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const base=seal({format:'ai_scene_coherent_composition_v2',sourceSampling:'display-density-2x-v1',batchSha256:inputs.batch.sha256,targetSha256:inputs.target.sha256,
    transforms:[{instanceId:'front.left',x:-10,y:100,scale:{numerator:3,denominator:2},tint:0xffffff,opacity:1}],layerOrder:['sky','landmark','ground','platform','front']});
  const stale=join(f.parent,'stale-base');rejects(()=>pipeline.prepareCoherentSurfaceReview(f.root,observations,stale,{baseComposition:seal({...unseal(base),batchSha256:'f'.repeat(64)})}),'COHERENT_COMPOSITION_IDENTITY');
  assert.equal(existsSync(stale),false);
  const directory=join(f.parent,'surface-review'),review=pipeline.prepareCoherentSurfaceReview(f.root,observations,directory,{baseComposition:base});
  assert.equal(review.generationCalls,0);assert.equal(review.newComputeAuthorized,false);assert.equal(review.existingSourceAuthorizationsReused,false);
  assert.equal(review.materialRawSha256,inputs.material.rawSha256);assert.equal(review.referenceRawSha256,inputs.reference.rawSha256);
  assert.deepEqual(readFileSync(join(directory,'material-native.png')),inputs.material.raw);assert.deepEqual(readFileSync(join(directory,'reference-native.png')),inputs.reference.raw);
  const profile=json(join(directory,'composition-profile.json')),mapping=json(join(directory,'surface-mapping.json'));
  assert.equal(profile.format,'ai_scene_coherent_composition_v4');assert.equal(profile.surfaceMapping.sha256,mapping.sha256);
  assert.deepEqual(mapping.surfaceOriginInBodyPixels,{numerator:-2633575,denominator:52736});
  assert(Math.abs(mapping.surfaceOriginInBodyPixels.numerator)>1048576,'large rational components remain valid when their represented value is bounded');
  assert.deepEqual(profile.transforms,base.transforms);assert.deepEqual(profile.layerOrder,base.layerOrder);assert.equal(review.baseCompositionSha256,base.sha256);
  // A surface recalibration must retain the complete feature judgment instead
  // of silently dropping its supplemental observations or chosen fidelity.
  const instance=inputs.target.instances.find(i=>i.role==='landmark'),sourcePlan=inputs.batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.recipe.assetId===instance.instanceId),source=flow.getGenerationResult(f.workflow,sourcePlan.sha256);
  const structure=createReferenceStructure({referenceRawSha256:inputs.reference.rawSha256,viewport:inputs.target.mapping.viewport,assets:[{instanceId:instance.instanceId,subjectId:instance.subjectId,features:[{featureId:'left',description:'Left attachment',target:{x:100,y:50},toleranceWorld:1},{featureId:'right',description:'Right attachment',target:{x:150,y:50},toleranceWorld:1}],checks:[{checkId:'frame',description:'Retain independent frame.'}]}]});
  const proposal=seal({format:'ai_scene_reference_feature_supplement_v1',structureSha256:structure.sha256,evidenceSha256:'e'.repeat(64),additions:[{instanceId:instance.instanceId,features:[{featureId:'inner',description:'Internal member',target:{x:125,y:65},toleranceWorld:1}],checks:[]}]});
  const supplement={proposal,decision:decision('surface.supplement',proposal.sha256)},measurements=[{instanceId:instance.instanceId,sourcePlanSha256:sourcePlan.sha256,sourceRawSha256:source.result.rawSha256,features:[{featureId:'left',native:{x:200,y:100}},{featureId:'right',native:{x:400,y:100}},{featureId:'inner',native:{x:300,y:160}}],checks:[{checkId:'frame',verdict:'pass'}]}];
  const intent=seal({format:'ai_scene_reference_intent_review_v1',profile:'reference-inspired-v1',structureSha256:structure.sha256,measurementsSha256:digest(measurements),evidenceSha256:'f'.repeat(64),reviewer:'agent',intentReason:'Synthetic reference-inspired surface continuation.',assets:[{instanceId:instance.instanceId,sourcePlanSha256:sourcePlan.sha256,sourceRawSha256:source.result.rawSha256,acceptedFeatureIds:[],acceptedCheckIds:[],judgments:REFERENCE_INTENT_CRITERIA.map(criterion=>({criterion,verdict:'pass',notes:'Explicit synthetic observation.'}))}]});
  const featured=createFeatureCoherentComposition(inputs.batch,inputs.target,mapping,structure,measurements,{featureSupplement:supplement,referenceIntentReview:intent}),featuredDir=join(f.parent,'featured-surface-review');
  pipeline.prepareCoherentSurfaceReview(f.root,observations,featuredDir,{baseComposition:featured});
  const continued=json(join(featuredDir,'composition-profile.json'));
  assert.deepEqual(continued.referenceStructure,structure);assert.deepEqual(continued.featureMeasurements,measurements);assert.deepEqual(continued.featureSupplement,supplement);assert.deepEqual(continued.referenceIntentReview,intent);
  assert.equal(pipeline.prepareCoherentSurfaceReview(f.root,observations,directory,{baseComposition:base}).sha256,review.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const mappingFile=join(directory,'surface-mapping.json'),originalMapping=readFileSync(mappingFile);writeFileSync(mappingFile,jsonBytes({...mapping,capDepth:{numerator:32,denominator:1}}));
  rejects(()=>pipeline.prepareCoherentSurfaceReview(f.root,observations,directory,{baseComposition:base}),'PROOF_BUNDLE_RECOMPILE_MISMATCH');writeFileSync(mappingFile,originalMapping);
  const materialFile=join(directory,'material-native.png'),originalMaterial=readFileSync(materialFile);writeFileSync(materialFile,sourcePng(false,19));
  rejects(()=>pipeline.prepareCoherentSurfaceReview(f.root,observations,directory,{baseComposition:base}),'PROOF_BUNDLE_RECOMPILE_MISMATCH');writeFileSync(materialFile,originalMaterial);
  const wrongMapping=seal({...unseal(mapping),material:{...mapping.material,sha256:hash(sourcePng(false,19))}}),wrong=createMeasuredCoherentComposition(inputs.batch,inputs.target,wrongMapping);
  const wrongCandidate=join(f.parent,'wrong-material');rejects(()=>flow.buildCoherentCandidate(f.workflow,inputs.batch.sha256,'wrong.material',wrongCandidate,wrong),'COHERENT_MEASURED_MATERIAL_BINDING');
  assert.equal(existsSync(wrongCandidate),false);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  let calibrations=0;
  const completed=await pipeline.driveCoherentPipeline(f.root,{delivery,operator:{calibrateSurface:async received=>{calibrations++;
    assert.equal(received.material.rawSha256,inputs.material.rawSha256);return {observations,options:{transforms:base.transforms,layerOrder:base.layerOrder}};}}});
  assert.equal(completed.stage,'ready-to-deliver');assert(completed.delivery);assert.equal(calibrations,1);assert.equal(calls.length,7);assert.equal(approvals.length,2);
  assert.equal(json(join(delivery,'composition-profile.json')).format,'ai_scene_coherent_composition_v4');assert.equal(pipeline.verifyCoherentDelivery(f.root,delivery).status,'verified');
  await pipeline.driveCoherentPipeline(f.root,{delivery,operator:{calibrateSurface:async()=>{throw Error('a verified existing delivery must be reused');}}});
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(calls.length,7);assert.equal(approvals.length,2);
});

test('older coherent project versions retain their own assembly policy and new surface inputs require complete sources',t=>{
  const f=setup(t),path=join(f.root,'coherent-project.json'),body=unseal(json(path));
  rejects(()=>pipeline.coherentSurfaceInputs(f.root),'COHERENT_SURFACE_REVIEW_STATE');
  const {assemblyPolicy,...legacy}=body;
  for(const version of [3,2,1]){
    const record={...legacy,format:'ai_scene_coherent_project_v'+version};
    if(version<3){delete record.visualCoherencePolicySha256;delete record.visualObservationsSha256;}
    if(version<2)delete record.sourceScopesSha256;
    // This is a synthetic historical project fixture, not a migration of a live project.
    writeFileSync(path,jsonBytes(seal(record)));const inspected=pipeline.inspectCoherentPipeline(f.root);
    assert.equal(Object.hasOwn(inspected,'assemblyRequirements'),false);
    if(version===3)assert.equal(inspected.sourcePlanning.assemblyProfile,'reference-surfaces-and-joined-material-v1');
  }
});

test('surface-review CLI exposes only explicit observations and an optional checked base composition',()=>{
  const cwd=fileURLToPath(new URL('..',import.meta.url)),help=spawnSync(process.execPath,['scripts/coherent.mjs','--help'],{cwd,encoding:'utf8'});
  assert.equal(help.status,0);assert.match(help.stdout,/surface-review --root PROJECT --observations JSON --out NEW_DIRECTORY \[--base-composition JSON\]/);
  for(const args of [['surface-review','--root','missing','--out','missing'],['surface-review','--root','missing','--observations','missing','--out','missing','--yes','true']]){
    const result=spawnSync(process.execPath,['scripts/coherent.mjs',...args],{cwd,encoding:'utf8'});assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).code,'COHERENT_ARGUMENTS');
  }
});
