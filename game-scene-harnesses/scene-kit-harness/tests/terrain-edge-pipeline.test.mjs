import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {prepareTerrainEdgeComputeReview,buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {inspectPng} from '../src/png.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {MEASURED_FIELD_DENSITY2_SHA256} from '../src/terrain-proof/measured-field-density.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

const json=path=>JSON.parse(readFileSync(path,'utf8'));
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));

test('frozen edge compute review contains exact prompts and ordered original inputs without workflow writes',{timeout:240000},t=>{
  const f=setupTerrainEdgeDelivery(t,{receiveEdges:false}),before=flow.inspectWorkflow(f.workflow),output=join(f.parent,'compute-review'),
    report=prepareTerrainEdgeComputeReview(f.workflow,f.batch.sha256,output);
  assert.equal(report.targetSha256,f.batch.sha256);assert.equal(report.maximumCalls,4);assert.equal(report.generationCalls,0);
  assert.equal(report.computeAuthorizationIncluded,false);assert.equal(report.existingAuthorizationsReused,false);
  assert.deepEqual(readFileSync(join(output,'input-1.png')),f.raw);
  assert.deepEqual(readFileSync(join(output,'input-2.png')),flow.getGenerationResult(f.workflow,f.base.planSha256s[0]).bytes);
  report.plans.forEach((item,index)=>{
    const plan=flow.getGenerationPlan(f.workflow,item.planSha256);
    assert.deepEqual(json(join(output,`plan-${index+1}.json`)),plan);assert.equal(readFileSync(join(output,item.prompt),'utf8'),plan.request.prompt+'\n');
    assert.equal(item.maximumCalls,1);assert.equal(item.transparentBackground,true);assert.equal(item.inputs.length,2);
    assert.deepEqual(item.inputs.map(input=>input.sha256),plan.request.images.map(input=>input.artifact.sha256));
  });
  assert.equal(prepareTerrainEdgeComputeReview(f.workflow,f.batch.sha256,output).sha256,report.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const prompt=join(output,'prompt-1.txt'),original=readFileSync(prompt);writeFileSync(prompt,Buffer.from('changed prompt'));
  rejects(()=>prepareTerrainEdgeComputeReview(f.workflow,f.batch.sha256,output),'PROOF_BUNDLE_RECOMPILE_MISMATCH');writeFileSync(prompt,original);
  rejects(()=>buildTerrainEdgeDelivery(f.deliveryOptions),'TERRAIN_EDGE_SOURCES_INCOMPLETE');assert.equal(existsSync(f.deliveryOptions.output),false);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('checked native edge delivery preserves originals and physics, exports/replays exactly and rejects tampering',{timeout:360000},t=>{
  const f=setupTerrainEdgeDelivery(t),before=flow.inspectWorkflow(f.workflow),baseHandle=loadSceneKit(f.baseKitRoot),baseMap=readMap(baseHandle),
    baseCompiled=compileMap(baseHandle,baseMap),invalid=structuredClone(f.deliveryOptions);
  invalid.controls.left.wall.innerX=0;invalid.output=join(f.parent,'invalid-anchors');
  rejects(()=>buildTerrainEdgeDelivery(invalid),'TERRAIN_EDGE_JOIN');assert.equal(existsSync(invalid.output),false);
  rejects(()=>buildTerrainEdgeDelivery({...f.deliveryOptions,output:join(f.baseCandidateRoot,'forbidden-write')}),'OUTPUT_OVERLAP');
  const report=buildTerrainEdgeDelivery(f.deliveryOptions),out=f.deliveryOptions.output,handle=loadSceneKit(join(out,'candidate/kit')),map=readMap(handle),compiled=compileMap(handle,map);
  assert.equal(report.format,'ai_scene_terrain_edge_delivery_v1');assert.equal(report.finalHumanArtReview,'pending');assert.equal(report.generationCalls,0);
  assert.equal(report.authorGeometryChanged,false);assert.notEqual(handle.bundleSha256,baseHandle.bundleSha256);
  const candidateReport=json(join(out,'candidate/readiness.json'));
  assert(candidateReport.sourceEvidence.every(source=>source.sourceSampling.targetPixelsPerWorldPixel===2
    &&source.sourceSampling.pixelsPerWorldPixel===12&&source.sourceSampling.nativeUpscale===false&&source.sourceSampling.targetReached===true));
  const {kitRef:oldRef,...oldAuthor}=baseMap,{kitRef:newRef,...newAuthor}=map;assert.deepEqual(newAuthor,oldAuthor);assert.notDeepEqual(newRef,oldRef);
  assert.deepEqual(compiled.collisionSuggestions,baseCompiled.collisionSuggestions);assert(compiled.curveTerrains.some(curve=>curve.edgeMeshes?.length));
  for(const [path,bytes]of contextFor(baseHandle).files)if(path.endsWith('.png'))assert.deepEqual(contextFor(handle).files.get(path),bytes);
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const role=side+'-'+(part==='wall'?'wall':'top-corner'),raw=f.raws.get(role),source=inspectPng(raw,{includePixels:true,allowHiddenRgb:true}),
      derived=inspectPng(contextFor(handle).files.get(`assets/terrain-edge-${role}.png`),{includePixels:true,allowHiddenRgb:true});
    assert.deepEqual(readFileSync(join(out,`candidate/source/${role}-native.png`)),raw);assert.equal(source.hiddenRgbPixels,1);assert.equal(derived.hiddenRgbPixels,0);
    for(let p=0;p<source.rgba.length;p+=4){assert.equal(derived.rgba[p+3],source.rgba[p+3]);if(source.rgba[p+3])assert.deepEqual(derived.rgba.subarray(p,p+4),source.rgba.subarray(p,p+4));}
  }
  const verified=verifyTerrainEdgeDelivery(f.deliveryOptions);assert.equal(verified.status,'verified');assert.equal(verified.reportSha256,report.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(flow.verifyCoherentCandidate(f.workflow,f.base.sha256,'base.fixture',f.baseCandidateRoot,
    json(join(f.baseCandidateRoot,'evidence/composition-profile.json'))).status,'deterministic-proof-valid');
  const zipFile=join(out,'scene-kit.zip'),zip=readFileSync(zipFile);writeFileSync(zipFile,Buffer.from('changed'));
  rejects(()=>verifyTerrainEdgeDelivery(f.deliveryOptions),'TERRAIN_EDGE_DELIVERY_ARTIFACT');writeFileSync(zipFile,zip);
  const deliveryFile=join(out,'delivery.json'),receipt=readFileSync(deliveryFile);
  writeFileSync(deliveryFile,jsonBytes(seal({...unseal(report),finalHumanArtReview:'accepted'})));
  rejects(()=>verifyTerrainEdgeDelivery(f.deliveryOptions),'TERRAIN_EDGE_DELIVERY_REPLAY');writeFileSync(deliveryFile,receipt);
  const nativeFile=join(out,'candidate/source/left-wall-native.png'),native=readFileSync(nativeFile);writeFileSync(nativeFile,Buffer.from('changed raw'));
  rejects(()=>verifyTerrainEdgeDelivery(f.deliveryOptions),'PROOF_BUNDLE_RECOMPILE_MISMATCH');writeFileSync(nativeFile,native);
  assert.equal(verifyTerrainEdgeDelivery(f.deliveryOptions).zipSha256,hash(zip));
  // A later source decision remains separate and cannot silently rewrite a
  // previously produced technical candidate or transfer acceptance to it.
  const sourceSha=f.batch.planSha256s[0],rawSha=flow.getGenerationResult(f.workflow,sourceSha).result.rawSha256;
  flow.reviewResult(f.workflow,sourceSha,decision('source.later.accept',rawSha));
  assert.equal(verifyTerrainEdgeDelivery(f.deliveryOptions).reportSha256,report.sha256);
  assert.equal(json(deliveryFile).finalHumanArtReview,'pending');
});

test('explicit v2 underlap preserves near-opaque native alpha and never silently falls back from strict v1',{timeout:240000},t=>{
  const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252}),before=flow.inspectWorkflow(f.workflow),invalid={...f.deliveryOptions,
    controls:{...f.controls,joinProfile:'unversioned-alpha-waiver'},output:join(f.parent,'invalid-profile')};
  rejects(()=>buildTerrainEdgeDelivery(invalid),'TERRAIN_EDGE_JOIN_PROFILE');assert.equal(existsSync(invalid.output),false);
  rejects(()=>buildTerrainEdgeDelivery(f.deliveryOptions),'TERRAIN_EDGE_OPAQUE_JOIN');assert.equal(existsSync(f.deliveryOptions.output),false);
  const options={...f.deliveryOptions,controls:{...f.controls,joinProfile:NEAR_OPAQUE_JOIN_PROFILE},output:join(f.parent,'near-opaque-delivery')},
    report=buildTerrainEdgeDelivery(options),handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),
    compiled=compileMap(handle,readMap(handle)),candidate=json(join(options.output,'candidate/readiness.json'));
  assert.equal(context.kit.terrainEdges.format,'ai_scene_terrain_edges_v2');assert.equal(context.kit.terrainEdges.joinProfile,NEAR_OPAQUE_JOIN_PROFILE);
  assert.equal(candidate.renderingPolicy.minimumNativeCollarAlpha,250);assert.equal(candidate.renderingPolicy.sourceAlphaChanged,false);
  assert(candidate.sourceEvidence.every(source=>source.nativeJoin.collar.minimumAlpha===252&&source.nativeJoin.collar.requiredMinimumAlpha===250
    &&source.nativeJoin.nativeAlphaUnchanged&&source.nativeJoin.alphaRaised===false&&source.visibleRgbaChanged===false&&source.alphaChanged===false));
  assert(compiled.terrainEdgePlacement.placed.length>0);
  assert(compiled.terrainEdgePlacement.placed.every(edge=>edge.joinProfile===NEAR_OPAQUE_JOIN_PROFILE&&edge.underlapWorld>0&&edge.nativeAlphaUnchanged));
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const role=side+'-'+(part==='wall'?'wall':'top-corner'),raw=f.raws.get(role),source=inspectPng(raw,{includePixels:true,allowHiddenRgb:true}),
      derived=inspectPng(context.files.get(`assets/terrain-edge-${role}.png`),{includePixels:true,allowHiddenRgb:true});
    assert.deepEqual(readFileSync(join(options.output,`candidate/source/${role}-native.png`)),raw);
    const expected=Buffer.from(source.rgba);for(let p=0;p<expected.length;p+=4)if(!expected[p+3])expected.fill(0,p,p+3);
    assert.deepEqual(derived.rgba,expected);assert.equal(source.hiddenRgbPixels,1);assert.equal(derived.hiddenRgbPixels,0);
    assert.equal(source.rgba.reduce((n,value,index)=>index%4===3?Math.max(n,value):n,0),252);
  }
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.equal(report.finalHumanArtReview,'pending');assert.equal(report.generationCalls,0);
});

test('explicit v3 coverage and direct native material density2 retain source identity, physical mapping and legacy grid tiles',{timeout:240000},t=>{
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),before=flow.inspectWorkflow(f.workflow),baseHandle=loadSceneKit(f.baseKitRoot),
    base=contextFor(baseHandle),controls={...structuredClone(f.controls),joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1'};
  for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={fromX:controls[side][part].innerX,toX:side==='left'?264:24};
  const incomplete={...f.deliveryOptions,controls:structuredClone(controls),output:join(f.parent,'partial-blend')};delete incomplete.controls.right.corner.inboardBlend;
  rejects(()=>buildTerrainEdgeDelivery(incomplete),'TERRAIN_EDGE_BLEND_COVERAGE');assert.equal(existsSync(incomplete.output),false);
  const invalid={...f.deliveryOptions,controls:{...controls,materialDensityProfile:'resize-old-field'},output:join(f.parent,'invalid-density')};
  rejects(()=>buildTerrainEdgeDelivery(invalid),'TERRAIN_EDGE_DENSITY_PROFILE');assert.equal(existsSync(invalid.output),false);
  const options={...f.deliveryOptions,controls,output:join(f.parent,'coverage-density2-delivery')},report=buildTerrainEdgeDelivery(options),
    handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),appearance=context.kit.terrainAppearance,
    compiled=compileMap(handle,readMap(handle)),candidate=json(join(options.output,'candidate/readiness.json')),
    density=json(join(options.output,'candidate/evidence/terrain-density2/density-derivation.json'));
  assert.equal(context.kit.terrainEdges.format,'ai_scene_terrain_edges_v3');assert.equal(appearance.format,'ai_scene_continuous_terrain_appearance_v6');
  assert.equal(appearance.profileSha256,MEASURED_FIELD_DENSITY2_SHA256);assert.equal(appearance.studySha256,density.sha256);
  assert.deepEqual(appearance.body.pixelSize,{width:1010,height:506});
  assert.deepEqual(appearance.cap.pixelSize,{width:1010,height:base.kit.terrainAppearance.cap.pixelSize.height*2});
  assert.deepEqual(appearance.capDepth,base.kit.terrainAppearance.capDepth);assert.deepEqual(appearance.capUvEnd,base.kit.terrainAppearance.capUvEnd);
  assert.equal(appearance.sourceSha256,base.kit.terrainAppearance.sourceSha256);assert.equal(appearance.surfaceMappingSha256,base.kit.terrainAppearance.surfaceMappingSha256);
  assert.equal(appearance.surfaceOriginInBodyPixels.numerator/appearance.surfaceOriginInBodyPixels.denominator,
    2*base.kit.terrainAppearance.surfaceOriginInBodyPixels.numerator/base.kit.terrainAppearance.surfaceOriginInBodyPixels.denominator);
  assert.equal(candidate.materialDensity.resizedLegacyField,false);assert.equal(candidate.materialDensity.nativeUpscale,false);
  assert.equal(candidate.materialDensity.gridTileDensity,'legacy-1x-phase-tiles-preserved-separately');assert.equal(candidate.materialDensity.sourceOriginNormalizationHeight,506);
  assert.equal(density.sourceTransition.physicalMaterialScaleChanged,false);assert.equal(density.sourceTransition.sourceCropChanged,false);assert.equal(density.directNativeSampling,true);
  for(const [path,bytes]of base.files)if(path.startsWith('assets/'))assert.deepEqual(context.files.get(path),bytes);
  for(const kind of ['body','cap']){
    assert.deepEqual(readFileSync(join(options.output,`candidate/evidence/terrain-density2/base-materials/${kind}-field.png`)),base.files.get(base.kit.terrainAppearance[kind].source.path));
    assert.deepEqual(readFileSync(join(options.output,`candidate/evidence/terrain-density2/materials/${kind}-field.png`)),context.files.get(appearance[kind].source.path));
  }
  assert(candidate.sourceEvidence.every(source=>source.sourcePngAlphaChanged===false&&source.effectiveRenderAlphaChanged===true
    &&source.renderCoverage.effectiveRenderAlpha==='native-alpha-times-coverageOpacity'));
  assert(compiled.curveTerrains.some(curve=>curve.edgeMeshes?.some(mesh=>mesh.coverageOpacity>0&&mesh.coverageOpacity<1)));
  assert.deepEqual(compiled.collisionSuggestions,compileMap(baseHandle,readMap(baseHandle)).collisionSuggestions);
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.equal(report.finalHumanArtReview,'pending');assert.equal(report.generationCalls,0);
});
