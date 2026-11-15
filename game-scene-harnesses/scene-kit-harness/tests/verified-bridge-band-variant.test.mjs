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
import {previewVerifiedBridgeBandVariant,buildVerifiedBridgeBandVariant,verifyVerifiedBridgeBandVariant} from '../src/verified-bridge-band-variant.mjs';
import {previewVerifiedSceneryAddition,buildVerifiedSceneryAddition,verifyVerifiedSceneryAddition} from '../src/verified-scenery-addition.mjs';
import {previewVerifiedDeepBridgeVariant,buildVerifiedDeepBridgeVariant,verifyVerifiedDeepBridgeVariant} from '../src/verified-deep-bridge-variant.mjs';
import {createBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {nativeFixtures,receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {bottomFixture,bottomSideControls} from './helpers/terrain-bottom-delivery.mjs';
import {decision} from './helpers/generation.mjs';

function coherent(f,id,acceptedId=null){const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision(id+'.compute',batch.sha256,'approve-compute'));
  batch.planSha256s.forEach((sha,i)=>receiveEdgeFixture(f.workflow,sha,sourcePng(flow.getGenerationPlan(f.workflow,sha).target.alpha==='transparent',i+10)));
  if(acceptedId){const sha=batch.planSha256s.find(s=>flow.getGenerationPlan(f.workflow,s).recipe.assetId===acceptedId);flow.reviewResult(f.workflow,sha,decision(id+'.accept',flow.getGenerationResult(f.workflow,sha).result.rawSha256));}
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const material=flow.getGenerationResult(f.workflow,batch.planSha256s[0]).bytes,mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations});
  const composition=createMeasuredCoherentComposition(batch,f.target,mapping),root=join(f.parent,id),candidate=flow.buildCoherentCandidate(f.workflow,batch.sha256,id+'.fixture',root,composition);
  return {batch,composition,root,candidate};}
const band=()=>({format:'ai_scene_background_band_v1',profile:'background-band-v1',camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
function bandPng(seed=0){const w=512,h=256,rgba=Buffer.alloc(w*h*4);for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)if(y>24+x%11)rgba.set([40+x%80,70+y%90,110+seed,252],(y*w+x)*4);return encodeRgbaPng(w,h,rgba);}
function transforms(foreground=false,pair=false){return {transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),layers:b.requirements.layers.map(l=>l.layerId==='landmark'?{...l,layerId:'rear'}:l).concat(pair?[{layerId:'far',kind:'environment',zIndex:5,parallaxX:.3}]:[]).sort((a,b)=>a.zIndex-b.zIndex),subjects:[...b.requirements.subjects.map(s=>({...s,...(s.layerId==='landmark'?{layerId:'rear'}:{}),...(foreground&&s.subjectId==='foreground'?{count:{min:4,max:4}}:{})})),{subjectId:'valley',role:'valley',layerId:'rear',content:'Synthetic valley with facilities',count:{min:1,max:1},placementHint:'wide'},...(pair?[{subjectId:'far',role:'backdrop',layerId:'far',content:'Synthetic distant peaks',count:{min:1,max:1},placementHint:'wide'}]:[])]})}),
  transformAnalysis:a=>{const v=unseal(a),left=v.instances.find(x=>x.instanceId==='front.left'),right=v.instances.find(x=>x.instanceId==='front.right'),landmark=v.instances.find(x=>x.instanceId==='landmark.actual');landmark.instanceId=pair?'bridge.upper':'rear.facilities.actual';landmark.layerId='rear';return seal({...v,instances:[...v.instances,{instanceId:pair?'valley.wall':'rear.actual',subjectId:'valley',layerId:'rear',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:140},{x:0,y:140}],anchor:{x:128,y:80},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic valley.'},...(pair?[{instanceId:'far.actual',subjectId:'far',layerId:'far',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:140},{x:0,y:140}],anchor:{x:128,y:80},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic peak.'}]:[]),...(foreground?[{...left,instanceId:'foreground.rock.left'},{...right,instanceId:'foreground.rock.right'}]:[])]});}};}
test('checked independent bridge, band and scenery preserve terrain and replay export',{timeout:3600000},t=>{
  const bandFixture=setupCoherent(t,undefined,undefined,transforms(false,true)),base=setupCoherent(t,undefined,undefined,transforms()),donor=setupCoherent(t,undefined,undefined,transforms(true));
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

  const scopes=flow.withBackgroundBandScopes(bandFixture.brief.requirements,flow.createLayerSourceScopes(bandFixture.brief.requirements),[{subjectId:'valley',backgroundBand:band()},{subjectId:'far',backgroundBand:band()}]),batch=flow.freezeCoherentSources(bandFixture.workflow,{...bandFixture.options,sourceScopes:scopes});
  flow.authorizeReferenceAssetBatch(bandFixture.workflow,batch.sha256,decision('band.compute',batch.sha256,'approve-compute'));
  for(const [i,sha]of batch.planSha256s.entries()){const plan=flow.getGenerationPlan(bandFixture.workflow,sha);receiveEdgeFixture(bandFixture.workflow,sha,['valley.wall','far.actual'].includes(plan.recipe.assetId)?bandPng(plan.recipe.assetId==='far.actual'?1:0):sourcePng(plan.target.alpha==='transparent',i+10));}
  const planFor=id=>batch.planSha256s.find(s=>flow.getGenerationPlan(bandFixture.workflow,s).recipe.assetId===id),midSha=planFor('valley.wall'),bridgeSha=planFor('bridge.upper'),farSha=planFor('far.actual');
  flow.reviewResult(bandFixture.workflow,bridgeSha,decision('bridge.synthetic.accept',flow.getGenerationResult(bandFixture.workflow,bridgeSha).result.rawSha256));
  flow.reviewResult(bandFixture.workflow,midSha,decision('band.synthetic.accept',flow.getGenerationResult(bandFixture.workflow,midSha).result.rawSha256));
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const material=flow.getGenerationResult(bandFixture.workflow,batch.planSha256s[0]).bytes,mapping=compileMeasuredSurfaceMapping({reference:bandFixture.raw,target:bandFixture.target,material,observations});
  const placements=[farSha,midSha].map(sha=>createBackgroundBandPlacement({plan:flow.getGenerationPlan(bandFixture.workflow,sha),raw:flow.getGenerationResult(bandFixture.workflow,sha).bytes,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}})),composition=createMeasuredCoherentComposition(batch,bandFixture.target,mapping,{bandPlacements:placements}),root=join(bandFixture.parent,'band'),bandCandidate=flow.buildCoherentCandidate(bandFixture.workflow,batch.sha256,'band.fixture',root,composition);
  const opts={skyOptions,skyDecision:skyAccept,candidate:{workflow:bandFixture.workflow,batchSha256:batch.sha256,candidateId:'band.fixture',root,composition,expectedBundleSha256:bandCandidate.sha256},sourcePlans:{bridge:bridgeSha,band:midSha},output:join(base.parent,'bridge-band')};
  const bridgeProposal=previewVerifiedBridgeBandVariant(opts),acceptance={proposal:bridgeProposal,receipt:decision('bridge.band.review',bridgeProposal.sha256)},bridgeReport=buildVerifiedBridgeBandVariant(opts,acceptance),bridgeVerified=verifyVerifiedBridgeBandVariant(opts,acceptance),bridgeKit=loadSceneKit(join(opts.output,'kit')),bridgeCtx=contextFor(bridgeKit),bridgeScene=compileMap(bridgeKit,readMap(bridgeKit));
  assert.equal(bridgeVerified.reportSha256,bridgeReport.sha256);assert.equal(bridgeReport.productionKit,false);assert.equal(bridgeReport.finalHumanArtReview,'pending');
  assert(bridgeCtx.maps.default.instances.some(i=>i.instanceId==='bridge.upper'));assert(bridgeCtx.maps.default.instances.some(i=>i.instanceId==='valley.wall'));
  assert(bridgeCtx.maps.default.instances.some(i=>i.instanceId==='rear.actual'));assert(!bridgeCtx.maps.default.instances.some(i=>i.instanceId==='rear.facilities.actual'));
  assert.deepEqual(bridgeScene.collisionSuggestions,compileMap(skyKit,readMap(skyKit)).collisionSuggestions);assert.deepEqual(bridgeCtx.kit.terrainEdges,skyCtx.kit.terrainEdges);assert.deepEqual(bridgeCtx.kit.terrainBottomEdges,skyCtx.kit.terrainBottomEdges);
  const bandSource=join(opts.output,'source/band-original.png'),bandSaved=readFileSync(bandSource);try{writeFileSync(bandSource,'tampered');assert.throws(()=>verifyVerifiedBridgeBandVariant(opts,acceptance));}finally{writeFileSync(bandSource,bandSaved);}
  const ft=transforms(),facility=setupCoherent(t,undefined,undefined,{...ft,transformAnalysis:a=>{const b=unseal(ft.transformAnalysis(a));return seal({...b,instances:b.instances.map(i=>i.instanceId==='rear.facilities.actual'?{...i,instanceId:'facility.lower'}:i)});}}),fd=coherent(facility,'facility','facility.lower');
  const facilitySha=fd.batch.planSha256s.find(s=>flow.getGenerationPlan(facility.workflow,s).recipe.assetId==='facility.lower');
  const fo={baseOptions:opts,baseDecision:acceptance,candidate:{workflow:facility.workflow,batchSha256:fd.batch.sha256,candidateId:'facility.fixture',root:fd.root,composition:fd.composition,expectedBundleSha256:fd.candidate.sha256},sourcePlanSha256:facilitySha,layerId:'rear.facility',newLayer:{copyFromLayerId:'rear.bridge-band',zIndex:bridgeCtx.maps.default.layers.find(l=>l.layerId==='rear.bridge-band').zIndex+1},position:{x:40,y:60},behind:['rear.actual','bridge.upper','valley.wall'],ahead:[],output:join(base.parent,'facility-addition')};
  const fp=previewVerifiedSceneryAddition(fo),fa={proposal:fp,receipt:decision('facility.review',fp.sha256)},fr=buildVerifiedSceneryAddition(fo,fa),fv=verifyVerifiedSceneryAddition(fo,fa),fk=loadSceneKit(join(fo.output,'kit')),fc=contextFor(fk);
  assert.equal(fv.reportSha256,fr.sha256);assert.equal(fr.finalHumanArtReview,'pending');assert(fc.maps.default.instances.some(i=>i.instanceId==='facility.lower'));assert.deepEqual(compileMap(fk,readMap(fk)).collisionSuggestions,bridgeScene.collisionSuggestions);
  const dt=transforms(),deep=setupCoherent(t,undefined,undefined,{...dt,transformAnalysis:a=>{const b=unseal(dt.transformAnalysis(a));return seal({...b,instances:b.instances.map(i=>i.instanceId==='rear.facilities.actual'?{...i,instanceId:'bridge.upper'}:i)});}}),dd=coherent(deep,'deepbridge','bridge.upper');
  const deepSha=dd.batch.planSha256s.find(s=>flow.getGenerationPlan(deep.workflow,s).recipe.assetId==='bridge.upper'),dk=loadSceneKit(join(dd.root,'kit')),dn=compileMap(dk,readMap(dk)).layers.flatMap(l=>l.nodes).find(n=>n.nodeId==='visual/bridge.upper'),pe=JSON.parse(readFileSync(join(dd.root,'evidence/bridge.upper-placement.json'))),k=dn.sourceToLogical.numerator/dn.sourceToLogical.denominator,c=pe.sourceCrop,m=pe.transparentMarginPx;
  const sx=(pe.outputSize.width-2*m)*k/c.width,sy=(pe.outputSize.height-2*m)*k/c.height,scale={numerator:Math.round((sx+sy)*500000),denominator:1000000},q=scale.numerator/scale.denominator;
  const optDeep={baseOptions:fo,baseDecision:fa,candidate:{workflow:deep.workflow,batchSha256:dd.batch.sha256,candidateId:'deepbridge.fixture',root:dd.root,composition:dd.composition,expectedBundleSha256:dd.candidate.sha256},sourcePlanSha256:deepSha,layerId:'rear.bridge-band',nativePlacement:{x:dn.position.x+m*k-c.x*q,y:dn.position.y+m*k-c.y*q,scale,maximumWorldError:2},output:join(base.parent,'deepbridge')};
  const dp=previewVerifiedDeepBridgeVariant(optDeep),da={proposal:dp,receipt:decision('deepbridge.review',dp.sha256)},dr=buildVerifiedDeepBridgeVariant(optDeep,da),dv=verifyVerifiedDeepBridgeVariant(optDeep,da),dkit=loadSceneKit(join(optDeep.output,'kit')),dctx=contextFor(dkit);
  assert.equal(dv.reportSha256,dr.sha256);assert.equal(dr.finalHumanArtReview,'pending');assert(dctx.maps.default.instances.some(i=>i.instanceId==='bridge.upper'));assert(dctx.maps.default.instances.some(i=>i.instanceId==='facility.lower'));assert(dctx.maps.default.instances.some(i=>i.instanceId==='rear.actual'));assert(!dctx.maps.default.instances.some(i=>i.instanceId==='valley.wall'));
  assert.deepEqual(compileMap(dkit,readMap(dkit)).collisionSuggestions,compileMap(fk,readMap(fk)).collisionSuggestions);
});
