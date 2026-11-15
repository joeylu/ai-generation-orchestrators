import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {createBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {buildVerifiedBackgroundBandVariant,verifyVerifiedBackgroundBandVariant} from '../src/verified-background-band-variant.mjs';
import {buildTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {openSceneExport} from '../src/persistence.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {nativeFixtures,receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {bottomFixture,bottomSideControls} from './helpers/terrain-bottom-delivery.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code),code);
const band=()=>({format:'ai_scene_background_band_v1',profile:'background-band-v1',
  camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},
  parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},
  edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
function bandPng(seed){const w=512,h=256,rgba=Buffer.alloc(w*h*4);
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++)if(y>24+x%11)rgba.set([40+x%80,70+y%90,110+seed,252],(y*w+x)*4);
  rgba.set([12,23,34,0],0);rgba.set([41,52,63,1],(10*w+1)*4);return encodeRgbaPng(w,h,rgba);}

test('checked two-band variant retains a complete native terrain snapshot and independently replays its export',{timeout:900000},t=>{
  const f=setupCoherent(t,'Synthetic background revision',undefined,{
    transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects.map(s=>s.subjectId==='landmark'?{...s,role:'backdrop',content:'Distant bare mountains only'}:s),
      {subjectId:'valley',role:'valley',layerId:'landmark',content:'Rear forest valley only',count:{min:1,max:1},placementHint:'wide'}]})}),
    transformAnalysis:a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'valley.actual',subjectId:'valley',layerId:'landmark',
      visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:140},{x:0,y:140}],anchor:{x:128,y:80},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic valley.'}]})});
  f.base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,f.base.sha256,decision('base.compute',f.base.sha256,'approve-compute'));
  f.base.planSha256s.forEach((s,i)=>receiveEdgeFixture(f.workflow,s,sourcePng(flow.getGenerationPlan(f.workflow,s).target.alpha==='transparent',i+10)));
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const material=flow.getGenerationResult(f.workflow,f.base.planSha256s[0]).bytes,
    mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations}),
    oldComposition=createMeasuredCoherentComposition(f.base,f.target,mapping),native=nativeFixtures('snow',252),bottom=bottomFixture();
  f.baseCandidateRoot=join(f.parent,'old-coherent');flow.buildCoherentCandidate(f.workflow,f.base.sha256,'old.fixture',f.baseCandidateRoot,oldComposition);
  f.controls=native.controls;f.raws=native.raws;
  const edges=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'variant.full.edges',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
    items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'variant.edge.'+i,role,content:'One synthetic native '+role,exclusions:['Independent props']}))});
  flow.authorizeReferenceAssetBatch(f.workflow,edges.sha256,decision('edges.compute',edges.sha256,'approve-compute'));
  const raws=new Map([...native.raws,...bottom.raws]);for(const sha of edges.planSha256s)receiveEdgeFixture(f.workflow,sha,raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));
  const side=bottomSideControls(f);side.left.wall.repeatY.from=144;side.right.wall.repeatY.from=144;
  const delivery=join(f.parent,'complete'),controls={...side,bottom:{...bottom.controls,nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:'native-bottom-adaptive-coverage-v2'}};
  buildTerrainEdgeDelivery({workflow:f.workflow,baseKitRoot:join(f.baseCandidateRoot,'kit'),batchSha256:edges.sha256,controls,output:delivery});
  const baselineKitRoot=join(delivery,'candidate/kit'),baseline=loadSceneKit(baselineKitRoot),base=contextFor(baseline),oldScene=compileMap(baseline,readMap(baseline));
  const parents=f.base.planSha256s.map(s=>flow.getGenerationPlan(f.workflow,s)).filter(p=>['backdrop','valley'].includes(p.instanceBinding.role)),
    revised=flow.reviseCoherentSources(f.workflow,f.base.sha256,{batchId:'new.bands',replacements:parents.map((p,i)=>({assetId:p.recipe.assetId,planId:'new.band.'+i,intent:'isolated-layer-v4',sourceScope:flow.withBackgroundBand(p.recipe.sourceScope,band())}))});
  flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('new.compute',revised.sha256,'approve-compute'));
  const changed=revised.planSha256s.filter(s=>!f.base.planSha256s.includes(s));changed.forEach((s,i)=>receiveEdgeFixture(f.workflow,s,bandPng(i)));
  const placements=changed.map(s=>createBackgroundBandPlacement({plan:flow.getGenerationPlan(f.workflow,s),raw:flow.getGenerationResult(f.workflow,s).bytes,
    sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}})),composition=createMeasuredCoherentComposition(revised,f.target,mapping,{bandPlacements:placements}),
    root=join(f.parent,'new-coherent'),bundle=flow.buildCoherentCandidate(f.workflow,revised.sha256,'new.fixture',root,composition),
    options={baselineKitRoot,expectedBaselineKitSha256:baseline.bundleSha256,baselineAncestorRoot:join(delivery,'candidate'),
      expectedBaselineAncestorBundleSha256:JSON.parse(readFileSync(join(delivery,'candidate/proof-bundle.json'))).sha256,
      candidate:{workflow:f.workflow,batchSha256:revised.sha256,candidateId:'new.fixture',root,composition,expectedBundleSha256:bundle.sha256},
      assetIds:parents.map(p=>'scene.'+p.recipe.assetId),output:join(f.parent,'variant')},before=flow.inspectWorkflow(f.workflow);
  const receipt=buildVerifiedBackgroundBandVariant(options),verification=verifyVerifiedBackgroundBandVariant(options),
    actual=loadSceneKit(join(options.output,'kit')),ctx=contextFor(actual),scene=compileMap(actual,readMap(actual));
  assert.equal(verification.reportSha256,receipt.sha256);assert.equal(receipt.generationCalls,0);assert.equal(receipt.finalHumanArtReview,'pending');
  assert.equal(receipt.scope,'retained-validated-terrain-snapshot-with-checked-band-replacements');assert.equal(receipt.terrainSnapshotRebound,false);
  assert.deepEqual(ctx.kit.terrainEdges,base.kit.terrainEdges);assert.deepEqual(ctx.kit.terrainBottomEdges,base.kit.terrainBottomEdges);
  assert.deepEqual(ctx.kit.terrainAppearance,base.kit.terrainAppearance);assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);
  assert.deepEqual(scene.curveTerrains,oldScene.curveTerrains);assert.equal(openSceneExport(join(options.output,'export')).handle.bundleSha256,actual.bundleSha256);
  for(const r of receipt.retainedPngs)assert.equal(hash(ctx.files.get(r.path)),r.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(loadSceneKit(baselineKitRoot).bundleSha256,baseline.bundleSha256);
  rejects(()=>buildVerifiedBackgroundBandVariant({...options,expectedBaselineKitSha256:'0'.repeat(64),output:join(f.parent,'bad-baseline')}),'BAND_VARIANT_BASELINE_SHA');
  assert(!existsSync(join(f.parent,'bad-baseline')));
  rejects(()=>buildVerifiedBackgroundBandVariant({...options,expectedBaselineAncestorBundleSha256:'0'.repeat(64),output:join(f.parent,'bad-ancestor-pin')}),'BAND_VARIANT_ANCESTOR_SHA');
  assert(!existsSync(join(f.parent,'bad-ancestor-pin')));
  const ancestorPath=join(options.baselineAncestorRoot,'proof-bundle.json'),ancestorBytes=readFileSync(ancestorPath),
    resealed=seal({...unseal(JSON.parse(ancestorBytes)),productionKit:true});
  try{
    writeFileSync(ancestorPath,JSON.stringify(resealed));
    rejects(()=>buildVerifiedBackgroundBandVariant({...options,output:join(f.parent,'resealed-ancestor')}),'BAND_VARIANT_ANCESTOR_SHA');
    assert(!existsSync(join(f.parent,'resealed-ancestor')));
  }finally{writeFileSync(ancestorPath,ancestorBytes);}
  rejects(()=>buildVerifiedBackgroundBandVariant({...options,candidate:{...options.candidate,expectedBundleSha256:'0'.repeat(64)},output:join(f.parent,'bad-donor')}),'BAND_VARIANT_CANDIDATE_SHA');
  rejects(()=>buildVerifiedBackgroundBandVariant({...options,assetIds:[options.assetIds[0],'scene.front.left'],output:join(f.parent,'bad-prop')}),'BAND_VARIANT_SOURCE_LINEAGE');
  const transformed=createMeasuredCoherentComposition(revised,f.target,mapping,{bandPlacements:placements,
    transforms:[{instanceId:'front.left',x:2,y:2,scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1}]}),
    otherRoot=join(f.parent,'other-prop'),otherBundle=flow.buildCoherentCandidate(f.workflow,revised.sha256,'other.fixture',otherRoot,transformed);
  assert.throws(()=>buildVerifiedBackgroundBandVariant({...options,candidate:{...options.candidate,candidateId:'other.fixture',root:otherRoot,composition:transformed,expectedBundleSha256:otherBundle.sha256},output:join(f.parent,'bad-prop-transform')}),e=>e.errors?.some(i=>['BAND_VARIANT_UNRELATED_MODULE','BAND_VARIANT_UNRELATED_AUTHOR'].includes(i.code)));
  const unexpected=join(options.output,'unexpected.txt');writeFileSync(unexpected,'not part of the checked package');
  rejects(()=>verifyVerifiedBackgroundBandVariant(options),'BAND_VARIANT_OUTPUT_INVENTORY');unlinkSync(unexpected);
  const path=join(options.output,'kit',options.assetIds[0]+'.missing');writeFileSync(path,'not an asset');
  assert.throws(()=>verifyVerifiedBackgroundBandVariant(options));unlinkSync(path);
  assert.equal(verifyVerifiedBackgroundBandVariant(options).status,'verified');
});
