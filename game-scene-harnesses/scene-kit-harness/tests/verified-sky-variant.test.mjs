import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {buildTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {openSceneExport} from '../src/persistence.mjs';
import {createProjectWorkspace} from '../src/studio/projects.mjs';
import {seal,unseal} from '../src/generation/common.mjs';
import {previewVerifiedForegroundAddition,buildVerifiedForegroundAddition,verifyVerifiedForegroundAddition} from '../src/verified-foreground-addition.mjs';
import {previewVerifiedSkyVariant,buildVerifiedSkyVariant,verifyVerifiedSkyVariant} from '../src/verified-sky-variant.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {nativeFixtures,receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {bottomFixture,bottomSideControls} from './helpers/terrain-bottom-delivery.mjs';
import {decision} from './helpers/generation.mjs';

function coherent(f,id){const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision(id+'.compute',batch.sha256,'approve-compute'));
  batch.planSha256s.forEach((sha,i)=>receiveEdgeFixture(f.workflow,sha,sourcePng(flow.getGenerationPlan(f.workflow,sha).target.alpha==='transparent',i+10)));
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const material=flow.getGenerationResult(f.workflow,batch.planSha256s[0]).bytes,mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations});
  const composition=createMeasuredCoherentComposition(batch,f.target,mapping),root=join(f.parent,id),candidate=flow.buildCoherentCandidate(f.workflow,batch.sha256,id+'.fixture',root,composition);
  return {batch,composition,root,candidate};}
test('sky variant retains verified foreground and complete terrain with source identity and tamper checks',{timeout:1200000},t=>{
  const base=setupCoherent(t),donor=setupCoherent(t,undefined,undefined,{
    transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:b.requirements.subjects.map(s=>s.subjectId==='foreground'?{...s,count:{min:4,max:4}}:s)})}),
    transformAnalysis:a=>{const v=unseal(a),left=v.instances.find(x=>x.instanceId==='front.left'),right=v.instances.find(x=>x.instanceId==='front.right');return seal({...v,instances:[...v.instances,{...left,instanceId:'foreground.rock.left'},{...right,instanceId:'foreground.rock.right'}]});}});
  const old=coherent(base,'base'),replacement=coherent(donor,'donor'),native=nativeFixtures('snow',252),bottom=bottomFixture();base.base=old.batch;base.baseCandidateRoot=old.root;base.controls=native.controls;base.raws=native.raws;
  const edge=flow.freezeTerrainEdgeSources(base.workflow,{batchId:'foreground.full.edges',baseBatchSha256:old.batch.sha256,capabilitiesSha256:base.options.capabilitiesSha256,
    coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'fg.edge.'+i,role,content:'One synthetic native '+role,exclusions:['Independent props']}))});
  flow.authorizeReferenceAssetBatch(base.workflow,edge.sha256,decision('edges.compute',edge.sha256,'approve-compute'));const raws=new Map([...native.raws,...bottom.raws]);for(const sha of edge.planSha256s)receiveEdgeFixture(base.workflow,sha,raws.get(flow.getGenerationPlan(base.workflow,sha).recipe.edgeRole));
  const sides=bottomSideControls(base);sides.left.wall.repeatY.from=144;sides.right.wall.repeatY.from=144;
  const delivery=join(base.parent,'complete'),controls={...sides,bottom:{...bottom.controls,nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:'native-bottom-adaptive-coverage-v2'}};
  buildTerrainEdgeDelivery({workflow:base.workflow,baseKitRoot:join(old.root,'kit'),batchSha256:edge.sha256,controls,output:delivery});
  const baselineKitRoot=join(delivery,'candidate/kit'),baseline=loadSceneKit(baselineKitRoot),bc=contextFor(baseline),before=compileMap(baseline,readMap(baseline));
  const options={baselineKitRoot,expectedBaselineKitSha256:baseline.bundleSha256,baselineAncestorRoot:join(delivery,'candidate'),expectedBaselineAncestorBundleSha256:JSON.parse(readFileSync(join(delivery,'candidate/proof-bundle.json'))).sha256,
    candidate:{workflow:donor.workflow,batchSha256:replacement.batch.sha256,candidateId:'donor.fixture',root:replacement.root,composition:replacement.composition,expectedBundleSha256:replacement.candidate.sha256},
    placements:[{instanceId:'foreground.rock.left',x:0,y:90},{instanceId:'foreground.rock.right',x:190,y:90}],foregroundLayerId:'front',output:join(base.parent,'addition')};
  const proposal=previewVerifiedForegroundAddition(options),accept={proposal,receipt:decision('foreground.review',proposal.sha256)};
  const report=buildVerifiedForegroundAddition(options,accept),verified=verifyVerifiedForegroundAddition(options,accept),kit=loadSceneKit(join(options.output,'kit')),ctx=contextFor(kit),scene=compileMap(kit,readMap(kit));
  assert.equal(verified.reportSha256,report.sha256);assert.equal(report.productionKit,false);assert.equal(report.finalHumanArtReview,'pending');
  assert.deepEqual(ctx.kit.terrainEdges,bc.kit.terrainEdges);assert.deepEqual(ctx.kit.terrainBottomEdges,bc.kit.terrainBottomEdges);assert.deepEqual(ctx.kit.terrainAppearance,bc.kit.terrainAppearance);
  assert.deepEqual(scene.collisionSuggestions,before.collisionSuggestions);assert.deepEqual(scene.curveTerrains,before.curveTerrains);assert.equal(openSceneExport(join(options.output,'export')).handle.bundleSha256,kit.bundleSha256);
  for(const [path,bytes]of bc.files)if(path.endsWith('.png'))assert(ctx.files.get(path).equals(bytes));
  assert.equal(ctx.catalog.modules.length,bc.catalog.modules.length+2);for(const id of ['front.left','front.right','foreground.rock.left','foreground.rock.right'])assert(ctx.maps.default.instances.some(i=>i.instanceId===id));
  assert.throws(()=>previewVerifiedForegroundAddition({...options,expectedBaselineKitSha256:'0'.repeat(64)}));assert.throws(()=>buildVerifiedForegroundAddition(options,{proposal,receipt:decision('bad.review','0'.repeat(64))}));
  const source=join(options.output,'source/foreground.rock.left.png'),original=readFileSync(source);try{writeFileSync(source,'tampered');assert.throws(()=>verifyVerifiedForegroundAddition(options,accept));}finally{writeFileSync(source,original);}
  const oldSky=old.batch.planSha256s.find(sha=>flow.getGenerationPlan(base.workflow,sha).recipe.assetId==='sky.actual');
  const newSky=replacement.batch.planSha256s.find(sha=>flow.getGenerationPlan(donor.workflow,sha).recipe.assetId==='sky.actual');
  assert(oldSky&&newSky);
  const skyOptions={foregroundOptions:options,foregroundDecision:accept,targetWorkflow:base.workflow,oldSkyPlanSha256:oldSky,sourceWorkflow:donor.workflow,sourcePlanSha256:newSky,output:join(base.parent,'sky-variant')};
  const skyProposal=previewVerifiedSkyVariant(skyOptions),skyAccept={proposal:skyProposal,receipt:decision('sky.review',skyProposal.sha256)};
  const skyReport=buildVerifiedSkyVariant(skyOptions,skyAccept),skyVerified=verifyVerifiedSkyVariant(skyOptions,skyAccept),skyKit=loadSceneKit(join(skyOptions.output,'kit')),skyCtx=contextFor(skyKit);
  assert.equal(skyVerified.reportSha256,skyReport.sha256);assert.equal(skyReport.finalHumanArtReview,'pending');
  for(const [path,bytes] of ctx.files)if(path.endsWith('.png')&&path!=='assets/scene.sky.actual.png')assert(skyCtx.files.get(path).equals(bytes));
  assert.deepEqual(skyCtx.kit.terrainEdges,ctx.kit.terrainEdges);assert.deepEqual(skyCtx.kit.terrainBottomEdges,ctx.kit.terrainBottomEdges);
  assert.throws(()=>previewVerifiedSkyVariant({...skyOptions,oldSkyPlanSha256:'0'.repeat(64)}));
  const skyRaw=join(skyOptions.output,'source/sky-original.png'),saved=readFileSync(skyRaw);try{writeFileSync(skyRaw,'tampered');assert.throws(()=>verifyVerifiedSkyVariant(skyOptions,skyAccept));}finally{writeFileSync(skyRaw,saved);}

});
