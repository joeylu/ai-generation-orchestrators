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
import {previewVerifiedMidgroundVariant,buildVerifiedMidgroundVariant,verifyVerifiedMidgroundVariant} from '../src/verified-midground-variant.mjs';
import {createBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
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
const band=()=>({format:'ai_scene_background_band_v1',profile:'background-band-v1',camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
function bandPng(){const w=512,h=256,rgba=Buffer.alloc(w*h*4);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)if(y>24+x%11)rgba.set([40+x%80,70+y%90,110,252],(y*w+x)*4);return encodeRgbaPng(w,h,rgba);}
function transforms(foreground=false){return {transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects.map(s=>foreground&&s.subjectId==='foreground'?{...s,count:{min:4,max:4}}:s),{subjectId:'valley',role:'valley',layerId:'landmark',content:'Synthetic valley with facilities',count:{min:1,max:1},placementHint:'wide'}]})}),
  transformAnalysis:a=>{const v=unseal(a),left=v.instances.find(x=>x.instanceId==='front.left'),right=v.instances.find(x=>x.instanceId==='front.right'),landmark=v.instances.find(x=>x.instanceId==='landmark.actual');landmark.instanceId='rear.facilities.actual';return seal({...v,instances:[...v.instances,{instanceId:'rear.actual',subjectId:'valley',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:140},{x:0,y:140}],anchor:{x:128,y:80},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic valley.'},...(foreground?[{...left,instanceId:'foreground.rock.left'},{...right,instanceId:'foreground.rock.right'}]:[])]});}};}
test('checked merged band preserves terrain and independently replays export',{timeout:1200000},t=>{
  const base=setupCoherent(t,undefined,undefined,transforms()),donor=setupCoherent(t,undefined,undefined,transforms(true));
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

  const bandFixture=setupCoherent(t,undefined,undefined,transforms()),scopes=flow.withBackgroundBandScopes(bandFixture.brief.requirements,flow.createLayerSourceScopes(bandFixture.brief.requirements),[{subjectId:'valley',backgroundBand:band()}]),batch=flow.freezeCoherentSources(bandFixture.workflow,{...bandFixture.options,sourceScopes:scopes});
  flow.authorizeReferenceAssetBatch(bandFixture.workflow,batch.sha256,decision('band.compute',batch.sha256,'approve-compute'));
  for(const [i,sha]of batch.planSha256s.entries()){const plan=flow.getGenerationPlan(bandFixture.workflow,sha);receiveEdgeFixture(bandFixture.workflow,sha,plan.recipe.assetId==='rear.actual'?bandPng():sourcePng(plan.target.alpha==='transparent',i+10));}
  const planSha=batch.planSha256s.find(s=>flow.getGenerationPlan(bandFixture.workflow,s).recipe.assetId==='rear.actual'),plan=flow.getGenerationPlan(bandFixture.workflow,planSha),raw=flow.getGenerationResult(bandFixture.workflow,planSha).bytes;
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const material=flow.getGenerationResult(bandFixture.workflow,batch.planSha256s[0]).bytes,mapping=compileMeasuredSurfaceMapping({reference:bandFixture.raw,target:bandFixture.target,material,observations});
  const placement=createBackgroundBandPlacement({plan,raw,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}}),composition=createMeasuredCoherentComposition(batch,bandFixture.target,mapping,{bandPlacements:[placement]}),root=join(bandFixture.parent,'band'),bandCandidate=flow.buildCoherentCandidate(bandFixture.workflow,batch.sha256,'band.fixture',root,composition);
  const midOptions={skyOptions,skyDecision:skyAccept,candidate:{workflow:bandFixture.workflow,batchSha256:batch.sha256,candidateId:'band.fixture',root,composition,expectedBundleSha256:bandCandidate.sha256},sourcePlanSha256:planSha,output:join(base.parent,'midground')};
  const midProposal=previewVerifiedMidgroundVariant(midOptions),midDecision={proposal:midProposal,receipt:decision('mid.review',midProposal.sha256)},midReport=buildVerifiedMidgroundVariant(midOptions,midDecision),midVerified=verifyVerifiedMidgroundVariant(midOptions,midDecision),midKit=loadSceneKit(join(midOptions.output,'kit')),midCtx=contextFor(midKit);
  assert.equal(midVerified.reportSha256,midReport.sha256);assert.equal(midReport.finalHumanArtReview,'pending');assert.equal(midReport.productionKit,false);
  assert(midCtx.maps.default.instances.some(i=>i.instanceId==='rear.actual'));assert(!midCtx.maps.default.instances.some(i=>i.instanceId==='rear.facilities.actual'));assert(midCtx.modules.has('scene.rear.facilities.actual'));
  assert.deepEqual(midCtx.kit.terrainEdges,skyCtx.kit.terrainEdges);assert.deepEqual(midCtx.kit.terrainBottomEdges,skyCtx.kit.terrainBottomEdges);
  for(const [path,bytes]of skyCtx.files)if(path.endsWith('.png')&&path!=='assets/scene.rear.actual.png')assert(midCtx.files.get(path).equals(bytes));
  assert.throws(()=>previewVerifiedMidgroundVariant({...midOptions,sourcePlanSha256:'0'.repeat(64)}));
  const midRaw=join(midOptions.output,'source/midground-original.png'),midSaved=readFileSync(midRaw);try{writeFileSync(midRaw,'tampered');assert.throws(()=>verifyVerifiedMidgroundVariant(midOptions,midDecision));}finally{writeFileSync(midRaw,midSaved);}

});
