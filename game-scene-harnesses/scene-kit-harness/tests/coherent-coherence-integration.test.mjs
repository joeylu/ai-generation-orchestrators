import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {openSceneExport} from '../src/persistence.mjs';
import {createCoherentComposition} from '../src/coherent-composition.mjs';
import {COHERENT_POLICY} from '../src/generation/coherent-source.mjs';
import {coherentSurfaceY} from '../src/coherent-layout.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,sourcePng,referencePng,setupCoherent,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const json=path=>JSON.parse(readFileSync(path,'utf8'));
const rectangle=(x,y,width,height)=>[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));

function briefFor(theme){
  const brief=coherentBrief(theme==='autumn'?'Autumn timber watermill':'Dry sandstone citadel'),requirements=unseal(brief.requirements);
  if(theme==='desert'){
    requirements.layers=requirements.layers.filter(layer=>layer.layerId!=='platform');
    requirements.subjects.find(subject=>subject.role==='platform').layerId='ground';
  }
  requirements.subjects.push({subjectId:'scenery',role:'scenery',layerId:'landmark',content:theme==='autumn'?'One compact copper maple tree with attached roots':'One compact dry date palm with attached roots',count:{min:1,max:1},placementHint:'left'});
  brief.requirements=seal(requirements);return brief;
}

function analysisFor(request,theme){
  const analysis=unseal(coherentAnalysis({sha256:request.planSha256},request.rawSha256,request.requirements));
  const desert=theme==='desert',tree=desert?{x:8,y:20,width:50,height:60}:{x:5,y:32,width:35,height:58};
  analysis.instances.push({instanceId:'tree.actual',subjectId:'scenery',layerId:'landmark',visibleEnvelope:rectangle(tree.x,tree.y,tree.width,tree.height),
    anchor:{x:tree.x+tree.width/2,y:tree.y+tree.height},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic observed root region; no segmentation.'});
  if(desert){
    const ground=analysis.instances.find(instance=>instance.instanceId==='ground.actual');ground.visibleEnvelope=rectangle(0,82,80,62);ground.anchor={x:40,y:110};
    const platform=analysis.instances.find(instance=>instance.instanceId==='platform.actual');
    platform.layerId='ground';platform.visibleEnvelope=rectangle(154,49,62,28);platform.anchor={x:185,y:63};
    analysis.surfaces=[{...analysis.surfaces[0],points:[{x:0,y:88},{x:40,y:84},{x:80,y:88}]},
      {...analysis.surfaces[1],points:[{x:154,y:52},{x:216,y:52}]}];
  }
  return seal(analysis);
}

for(const theme of ['autumn','desert'])test(`shared visual sources and joined assembly close the synthetic ${theme} chain with two compute decisions`,{timeout:240000},async t=>{
  const parent=mkdtempSync(join(tmpdir(),'coherent-unified-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project'),workflow=join(root,'workflow'),delivery=join(parent,'delivery'),calls=[],approvals=[];
  const initialized=pipeline.initCoherentPipeline(root,briefFor(theme),{purpose:'synthetic-simulation'});
  assert.equal(json(join(root,'coherent-project.json')).format,'ai_scene_coherent_project_v4');
  assert.equal(initialized.sourcePlanning.assemblyProfile,'reference-surfaces-and-measured-material-v1');
  const result=await pipeline.driveCoherentPipeline(root,{
    imageAdapter:{preflight:async()=>{},generate:async input=>{calls.push(input);return input.request.task==='reference'?referencePng():sourcePng(input.request.output.alpha==='transparent',calls.length+17);}},
    planner:{analyze:async({request})=>analysisFor(request,theme)},
    operator:{reviewDesign:async status=>({spec:decision('spec.accept',status.design.specSha256),style:decision('style.accept',status.design.styleSha256)}),
      approveCompute:async snapshot=>{approvals.push(snapshot);return decision('compute.'+approvals.length,snapshot.targetSha256,'approve-compute');},
      reviewReference:async review=>decision('reference.accept',review.packet.packetSha256),calibrateSurface:async()=>({observations:coherentSurfaceObservations()})},delivery,
  });
  assert.equal(result.stage,'ready-to-deliver');assert.equal(approvals.length,2);assert.equal(calls.length,8);
  assert.equal(approvals[0].plans.length,1);assert.equal(approvals[1].plans.length,7);
  const plans=approvals[1].plans,shared=new Set(plans.map(plan=>plan.sourceScope.definition.visualCoherence.sha256));
  assert.equal(shared.size,1);
  for(const plan of plans){
    assert.equal(plan.recipe.intent,'isolated-layer-v4');assert.equal(plan.sourceScope.sceneCoordinatesInPrompt,false);
    assert.equal(plan.sourceScope.definition.visualCoherence.visualAcceptance,'not-assessed');
    assert.match(plan.request.prompt,/SHARED VISUAL COHERENCE/);
    assert.doesNotMatch(plan.request.prompt,/observed reference envelope|canonical-reference-frame|observedAnchorWithinEnvelope|layoutMetrics/);
    assert.equal(plan.request.maximumCalls,1);
  }
  assert.match(plans.find(plan=>plan.instanceBinding.role==='material').request.prompt,/TERRAIN CONTINUITY/);
  const composition=json(join(delivery,'composition-profile.json'));
  assert.equal(composition.format,'ai_scene_coherent_composition_v4');assert.equal(composition.contacts.length,1);
  const handle=loadSceneKit(join(delivery,'candidate/kit')),map=readMap(handle),scene=compileMap(handle,map);
  const target=json(join(delivery,'candidate/evidence/reference-target.json')),surface=target.surfaces.find(surface=>surface.surfaceId==='ground.surface');
  assert.equal(map.curveTerrains.length,1);assert.equal(map.curveTerrains[0].points.at(-1).x,theme==='autumn'?70:80);
  assert.deepEqual(map.curveTerrains[0].points.map(({x,y})=>({x,y})),surface.points);
  assert.equal(map.curveTerrains[0].baseY,144);
  assert.equal(scene.terrainMaterial.format,'ai_scene_continuous_terrain_appearance_v5');assert.equal(scene.terrainMaterial.cap.pixelSize.height,composition.surfaceMapping.field.capHeight);
  assert.deepEqual(scene.terrainMaterial.capDepth,composition.surfaceMapping.capDepth);
  const origin=scene.terrainMaterial.surfaceOriginInBodyPixels;
  assert(Number.isSafeInteger(origin.numerator)&&Number.isSafeInteger(origin.denominator)&&origin.denominator>0);
  const contact=json(join(delivery,'candidate/evidence/tree.actual-contact.json')),tree=scene.layers.flatMap(layer=>layer.nodes).find(node=>node.nodeId==='visual/tree.actual');
  assert.equal(contact.worldContact.y,coherentSurfaceY(surface,contact.worldContact.x));
  const density=tree.sourceToLogical.numerator/tree.sourceToLogical.denominator;
  assert.ok(Math.abs(tree.position.y+tree.size.height-COHERENT_POLICY.derivedTransparentMarginPx*density-contact.worldContact.y)<.00001);
  assert.equal(contact.semanticAnchorDetected,false);
  const readiness=json(join(delivery,'candidate/readiness.json'));
  assert.equal(readiness.contactCount,1);assert.equal(readiness.wholeSceneReview,'pending');assert.equal(readiness.artAcceptance,'not-assessed');
  assert.equal(map.assemblyInstances.length,1);assert.equal(readiness.platformAdjustments.length,1);
  const adjustment=readiness.platformAdjustments[0],platformSurface=target.surfaces.find(row=>row.surfaceId==='platform.surface');
  const platformAssembly=map.assemblyInstances[0],platformLayer=map.layers.find(layer=>layer.layerId===platformAssembly.layerId);
  assert.equal(platformLayer.layerId,theme==='desert'?'platform.skin':'platform');
  assert.equal(platformLayer.kind,'environment');
  assert.deepEqual(platformLayer.parallax,{x:1,y:1});
  assert.deepEqual({column:platformAssembly.column,row:platformAssembly.row},adjustment.placed);
  assert.deepEqual(adjustment.worldDelta,{x:adjustment.placed.column*64-platformSurface.points[0].x,y:adjustment.placed.row*64-platformSurface.points[0].y});
  assert.equal(adjustment.physics,'grid-preserved');
  assert.equal(pipeline.verifyCoherentDelivery(root,delivery).status,'verified');
  const report=json(join(delivery,'delivery.json'));
  assert.equal(openSceneExport(join(delivery,'export')).compiled.contentSha256,scene.contentSha256);
  assert.equal(report.finalHumanArtReview,'pending');
  const before=flow.inspectWorkflow(workflow),reviewDirectory=join(parent,'coherence-review');
  const preview=pipeline.prepareCoherentVisualReview(root,reviewDirectory);
  assert.equal(preview.generationCalls,0);assert.equal(preview.frozen,false);assert.equal(preview.executable,false);assert.equal(preview.existingAuthorizationsReusable,false);
  assert.deepEqual(flow.inspectWorkflow(workflow),before);
  assert.equal(pipeline.prepareCoherentVisualReview(root,reviewDirectory).sha256,preview.sha256);
  assert.deepEqual(flow.inspectWorkflow(workflow),before);assert.equal(calls.length,8);assert.equal(approvals.length,2);
  rejects(()=>flow.reservePlan(workflow,plans[0].sha256),'RESERVATION_STATE');
  await assert.rejects(pipeline.runCoherentStage(root,{generate:async()=>{throw Error('must not dispatch');}}));
  assert.deepEqual(flow.inspectWorkflow(workflow),before);
});

test('legacy frozen sources may opt into v3 assembly without rewriting their v2 candidate or authorizations',{timeout:240000},t=>{
  const f=setupCoherent(t,'Synthetic legacy basalt landscape'),batch=flow.freezeCoherentSources(f.workflow,f.options);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('batch.compute',batch.sha256,'approve-compute'));
  for(const sha of batch.planSha256s){const plan=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
    flow.receiveResult(f.workflow,ticket,sourcePng(plan.target.alpha==='transparent',plan.target.alpha==='opaque'?17:27));}
  const target=flow.getReferenceReconstructionTarget(f.workflow,f.plan.sha256),before=flow.inspectWorkflow(f.workflow),plans=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha));
  const v2=seal({format:'ai_scene_coherent_composition_v2',batchSha256:batch.sha256,targetSha256:target.sha256,transforms:[],sourceSampling:'display-density-2x-v1'}),v2dir=join(f.parent,'v2');
  flow.buildCoherentCandidate(f.workflow,batch.sha256,'legacy.v2',v2dir,v2);
  const v2bytes=readFileSync(join(v2dir,'kit/maps/default.scene.json')),v2sha=hash(v2bytes);
  const v3=createCoherentComposition(batch,target),v3dir=join(f.parent,'v3');flow.buildCoherentCandidate(f.workflow,batch.sha256,'legacy.v3',v3dir,v3);
  flow.verifyCoherentCandidate(f.workflow,batch.sha256,'legacy.v3',v3dir,v3);flow.verifyCoherentCandidate(f.workflow,batch.sha256,'legacy.v2',v2dir,v2);
  const oldMap=json(join(v2dir,'kit/maps/default.scene.json')),newMap=json(join(v3dir,'kit/maps/default.scene.json'));
  assert.equal(oldMap.curveTerrains.length,0);assert(oldMap.terrainRuns.length>0);assert.equal(newMap.curveTerrains.length,1);
  assert.equal(newMap.curveTerrains[0].points.at(-1).x,70);assert.equal(hash(readFileSync(join(v2dir,'kit/maps/default.scene.json'))),v2sha);
  assert.deepEqual(batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)),plans);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.equal(v2.format,'ai_scene_coherent_composition_v2');assert.equal(v3.format,'ai_scene_coherent_composition_v3');
});
