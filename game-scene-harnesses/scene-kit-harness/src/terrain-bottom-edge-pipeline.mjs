import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {canonicalJson,canonicalMap,clone} from './document.mjs';
import {check,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import {loadSceneKit,readMap,contextFor} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {renderCoherentFrame,coherentComparison} from './coherent-render.mjs';
import {writeProofBundle,verifyProofBundle,readManifestProofBundle} from './terrain-proof/bundle.mjs';
import {encodeRgbaPng,inspectPng} from './png.mjs';
import {deriveMeasuredFieldDensity2} from './terrain-proof/measured-field-density.mjs';
import {validateTerrainBottomEdges,TERRAIN_BOTTOM_JUNCTION_PROFILES,TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE,
  TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE,TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE} from './terrain-bottom-edges.mjs';
import {TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,terrainEdgeCanvasGutterView} from './generation/terrain-edge-canvas-gutter.mjs';
import {terrainEdgeCanvasGutterEvidence,terrainEdgePreparationBound} from './terrain-edge-preparation-evidence.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
export const TERRAIN_BOTTOM_DELIVERY_ROLES=Object.freeze([['edge','bottom-edge'],['leftCorner','left-bottom-corner'],['rightCorner','right-bottom-corner']].map(Object.freeze));
const NATIVE_SIZE_PROFILE='bounded-native-4m-v1',NATIVE_RENDER_ENVELOPE='visible-alpha8-outward16-native-rgba-v1',
  NATIVE_SIZE_PREPARATION='ai_scene_terrain_edge_native_size_preparation_v1';
const sideRoles=[['left','wall','left-wall'],['right','wall','right-wall'],['left','corner','left-top-corner'],['right','corner','right-top-corner']];
const readJson=path=>parseJson(readSelectedFile(path));
const manifest=files=>[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length}));
const put=(files,path,value)=>files.set(path,jsonBytes(value));

function nativeSource(raw,item=null){
  const png=item?.preparation?.record.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT?terrainEdgeCanvasGutterView(item):inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),rgba=Buffer.from(png.rgba);let normalized=0;
  for(let p=0;p<rgba.length;p+=4)if(rgba[p+3]===0){if(rgba[p]||rgba[p+1]||rgba[p+2])normalized++;rgba[p]=0;rgba[p+1]=0;rgba[p+2]=0;}
  return {png,bytes:encodeRgbaPng(png.width,png.height,rgba),normalized};
}

// The same deterministic asset builder serves a new seven-source kit and a
// three-source upgrade. Controls contain native coordinates, never source paths.
export function prepareTerrainBottomEdgeAssets({files,kit,inputs,controls}){
  const nativeSizeV2=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'nativeSizeProfile');
  const junction=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'junctionProfile');
  const bodySupport=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'bodySupportProfile');
  const thinPlatformTop=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'thinPlatformTopProfile');
  exact(controls,['edge','leftCorner','rightCorner',...(nativeSizeV2?['nativeSizeProfile','renderEnvelopeProfile']:[]),...(junction?['junctionProfile']:[]),
    ...(bodySupport?['bodySupportProfile']:[]),...(thinPlatformTop?['thinPlatformTopProfile']:[])]);
  check(!bodySupport||nativeSizeV2&&controls.junctionProfile===TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE
    &&controls.bodySupportProfile===TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE,'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE');
  check(!thinPlatformTop||bodySupport&&controls.thinPlatformTopProfile===TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE,
    'TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE');
  check(!junction||nativeSizeV2&&TERRAIN_BOTTOM_JUNCTION_PROFILES.includes(controls.junctionProfile),'TERRAIN_BOTTOM_JUNCTION_PROFILE');
  check(!nativeSizeV2||controls.nativeSizeProfile===NATIVE_SIZE_PROFILE&&controls.renderEnvelopeProfile===NATIVE_RENDER_ENVELOPE,
    'TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE');
  const isNativeSizePlan=plan=>['ai_scene_generation_plan_v35','ai_scene_generation_plan_v36','ai_scene_generation_plan_v37'].includes(plan.format)
    &&plan.recipe.nativeSizeProfile===NATIVE_SIZE_PROFILE&&plan.recipe.renderEnvelopeProfile===NATIVE_RENDER_ENVELOPE
    &&plan.target.sourcePolicy.nativeSizeProfile===NATIVE_SIZE_PROFILE&&plan.target.sourcePolicy.renderEnvelopeProfile===NATIVE_RENDER_ENVELOPE
    &&plan.target.sourcePolicy.maximumPixels===4194304&&plan.qualityPolicy.nativeSizeProfile===NATIVE_SIZE_PROFILE
    &&plan.qualityPolicy.requiredRenderEnvelopeProfile===NATIVE_RENDER_ENVELOPE;
  const rebindBatch=inputs.batch.format==='ai_scene_terrain_edge_rebind_batch_v1';
  const hasPreparedSource=(rebindBatch||['ai_scene_terrain_edge_prepared_batch_v1','ai_scene_terrain_edge_canvas_gutter_batch_v1'].includes(inputs.batch.format))&&inputs.sources.some(item=>
    TERRAIN_BOTTOM_DELIVERY_ROLES.some(([,role])=>role===item.plan.recipe.edgeRole)&&[NATIVE_SIZE_PREPARATION,TERRAIN_EDGE_CANVAS_GUTTER_FORMAT].includes(item.preparation?.record?.format)
      &&(!rebindBatch||terrainEdgePreparationBound(inputs.batch,inputs.parentBatch,item.preparation.record.sha256)));
  const hasFrozenNativeSource=inputs.batch.nativeSizeProfile===NATIVE_SIZE_PROFILE&&inputs.batch.renderEnvelopeProfile===NATIVE_RENDER_ENVELOPE
    &&inputs.sources.some(item=>TERRAIN_BOTTOM_DELIVERY_ROLES.some(([,role])=>role===item.plan.recipe.edgeRole)&&isNativeSizePlan(item.plan));
  check(!nativeSizeV2||hasPreparedSource||hasFrozenNativeSource,'TERRAIN_BOTTOM_NATIVE_SIZE_PREPARATION');
  check(kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'&&!Object.hasOwn(kit,'terrainBottomEdges'),'TERRAIN_BOTTOM_DELIVERY_BASE');
  const edges={format:nativeSizeV2?'ai_scene_terrain_bottom_edges_v2':'ai_scene_terrain_bottom_edges_v1',
    profile:nativeSizeV2?'native-horizontal-bottom-union-v2':'native-horizontal-bottom-union-v1',
    ...(nativeSizeV2?{nativeSizeProfile:NATIVE_SIZE_PROFILE,renderEnvelopeProfile:NATIVE_RENDER_ENVELOPE}:{}),
    ...(junction?{junctionProfile:controls.junctionProfile}:{}),
    ...(bodySupport?{bodySupportProfile:controls.bodySupportProfile}:{}),
    ...(thinPlatformTop?{thinPlatformTopProfile:controls.thinPlatformTopProfile}:{}),
    sourceBinding:{materialSourceSha256:kit.terrainAppearance.sourceSha256,surfaceMappingSha256:kit.terrainAppearance.surfaceMappingSha256}},evidence=[];
  for(const [key,role]of TERRAIN_BOTTOM_DELIVERY_ROLES){
    const item=inputs.sources.find(source=>source.plan.recipe.edgeRole===role);
    check(item,'TERRAIN_BOTTOM_DELIVERY_COVERAGE');const {plan,raw,result}=item;
    check(hash(raw)===result.rawSha256&&result.technical.status==='pass','TERRAIN_BOTTOM_DELIVERY_SOURCE');
    if(['ai_scene_generation_plan_v35','ai_scene_generation_plan_v36','ai_scene_generation_plan_v37'].includes(plan.format))
      check(nativeSizeV2&&isNativeSizePlan(plan),'TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE');
    const nativeCanvasGutterPreparation=terrainEdgeCanvasGutterEvidence(item,inputs.batch,files,inputs.parentBatch);
    if(nativeCanvasGutterPreparation)check(nativeSizeV2&&isNativeSizePlan(item.preparation.originalPlan),'TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE');
    let nativeSizePreparation=null;
    if(item.preparation&&!nativeCanvasGutterPreparation){
      check(nativeSizeV2,'TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE');
      const {record,originalPlan,originalResult,originalRaw}=item.preparation;
      unseal(record);unseal(record.proposal);
      check(record.format===NATIVE_SIZE_PREPARATION&&record.nativeSizeProfile===NATIVE_SIZE_PROFILE
        &&record.renderEnvelopeProfile===NATIVE_RENDER_ENVELOPE&&record.proposal.requiredRenderEnvelopeProfile===NATIVE_RENDER_ENVELOPE
        &&record.proposal.rule.requiredRenderEnvelopeProfile===NATIVE_RENDER_ENVELOPE&&record.sha256===plan.sha256
        &&terrainEdgePreparationBound(inputs.batch,inputs.parentBatch,record.sha256)&&record.sourcePlanSha256===originalPlan.sha256
        &&record.originalRawSha256===originalResult.rawSha256&&record.rawSha256===record.originalRawSha256
        &&record.originalTechnicalSha256===originalResult.technical.sha256&&record.technical.sha256===result.technical.sha256
        &&record.proposal.sourceResultSha256===originalResult.sha256&&record.proposal.sourcePlanSha256===originalPlan.sha256
        &&record.proposal.originalTechnicalSha256===originalResult.technical.sha256
        &&record.receipt.decision==='accept'&&record.receipt.targetSha256===record.proposal.sha256
        &&originalResult.technical.status==='fail'&&canonicalJson(originalResult.technical.issues)===canonicalJson(['OUTPUT_SIZE'])
        &&record.request.maximumCalls===0&&record.originalPreserved===true&&record.allOriginalRgbaPreserved===true
        &&Buffer.from(originalRaw).equals(raw)&&hash(originalRaw)===record.originalRawSha256,
        'TERRAIN_BOTTOM_NATIVE_SIZE_LINEAGE');
      put(files,`evidence/${role}-native-size-preparation.json`,record);put(files,`evidence/${role}-original-plan.json`,originalPlan);
      put(files,`evidence/${role}-original-result.json`,originalResult);put(files,`evidence/${role}-original-technical-qa.json`,originalResult.technical);
      files.set(`source/${role}-original-native.png`,Buffer.from(originalRaw));
      nativeSizePreparation={format:record.format,sha256:record.sha256,proposalSha256:record.proposal.sha256,
        receiptSha256:hash(jsonBytes(record.receipt)),nativeSizeProfile:record.nativeSizeProfile,renderEnvelopeProfile:record.renderEnvelopeProfile,originalPlanSha256:originalPlan.sha256,
        originalResultSha256:originalResult.sha256,originalTechnicalSha256:originalResult.technical.sha256,originalQaStatus:'fail',originalIssues:['OUTPUT_SIZE'],
        originalRawSha256:hash(originalRaw),originalPngBytesUnchanged:true,allOriginalRgbaPreserved:true,maximumNewImageCalls:0,sourceArtAcceptance:'not-granted'};
    }
    const control=controls[key];exact(control,['scale','boundaryY','innerY','inboardBlend',...(key==='edge'?['repeatX']:['boundaryX','innerX','wallStartY','stripStartX'])]);
    const {png,bytes,normalized}=nativeSource(raw,item),path=`assets/terrain-edge-${role}.png`;
    check(!files.has('kit/'+path),'TERRAIN_BOTTOM_DELIVERY_SOURCE_COLLISION');files.set('kit/'+path,bytes);
    edges[key]={source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width:png.width,height:png.height},...clone(control)};
    files.set(`source/${role}-native.png`,Buffer.from(raw));put(files,`evidence/${role}-plan.json`,plan);put(files,`evidence/${role}-result.json`,result);
    evidence.push({edgeRole:role,planSha256:plan.sha256,rawSha256:hash(raw),technicalSha256:result.technical.sha256,derivedSha256:hash(bytes),
      ...(nativeSizePreparation?{nativeSizePreparation}:{}),
      ...(nativeCanvasGutterPreparation?{nativeCanvasGutterPreparation}:{}),
      originalPngModified:false,visibleRgbaChanged:false,sourcePngAlphaChanged:false,zeroAlphaRgbNormalizedPixels:normalized,
      sourceSampling:{pixelsPerWorldPixel:control.scale.denominator/control.scale.numerator,nativeUpscale:false},
      transforms:'explicit-uniform-native-scale-no-rotation-no-mirroring',artAcceptance:'not-transferred-by-assembly'});
  }
  const validation=validateTerrainBottomEdges(edges,kit.terrainAppearance,{readAsset:path=>files.get('kit/'+path),terrainEdges:kit.terrainEdges});
  if(nativeSizeV2)put(files,'evidence/bottom-native-envelope-validation.json',validation);
  kit.terrainBottomEdges=edges;return {edges,evidence,...(nativeSizeV2?{validation}:{} )};
}

function checkedBase(workflow,baseKitRoot,inputs){
  const handle=loadSceneKit(baseKitRoot),context=contextFor(handle),root=dirname(resolve(baseKitRoot)),
    {files,bundle}=readManifestProofBundle(root),report=parseJson(files.get('readiness.json'));unseal(report);
  check(context.kit.format==='ai_scene_kit_v4'&&context.kit.terrainEdges?.format==='ai_scene_terrain_edges_v6'
    &&!Object.hasOwn(context.kit,'terrainBottomEdges')&&bundle.format==='ai_scene_terrain_edge_candidate_bundle_v1'
    &&report.format==='ai_scene_terrain_edge_candidate_v1'&&bundle.reportSha256===report.sha256&&report.kitSha256===handle.bundleSha256,
    'TERRAIN_BOTTOM_DELIVERY_BASE');
  check(report.baseBatchSha256===inputs.batch.baseBatchSha256&&report.referenceRawSha256===hash(inputs.reference.raw)
    &&report.materialRawSha256===inputs.batch.materialRawSha256&&context.kit.terrainAppearance.sourceSha256===inputs.batch.materialRawSha256
    &&report.surfaceMappingSha256===context.kit.terrainAppearance.surfaceMappingSha256
    &&files.get('source/reference-native.png')?.equals(inputs.reference.raw)&&files.get('source/material-native.png')?.equals(inputs.material.raw),
    'TERRAIN_BOTTOM_BASE_SOURCE_BINDING');
  const previous=flow.getTerrainEdgeInputs(workflow,report.edgeBatchSha256),oldControls=parseJson(files.get('evidence/edge-controls.json'));
  check(previous.sources.length===4&&previous.batch.baseBatchSha256===inputs.batch.baseBatchSha256
    &&previous.reference.raw.equals(inputs.reference.raw)&&previous.material.raw.equals(inputs.material.raw)
    &&canonicalJson(parseJson(files.get('evidence/edge-batch.json')))===canonicalJson(previous.batch)
    &&hash(jsonBytes(oldControls))===report.controlsSha256&&Array.isArray(report.sourceEvidence)&&report.sourceEvidence.length===4,
    'TERRAIN_BOTTOM_BASE_SOURCE_BINDING');
  for(const [side,part,role]of sideRoles){
    const source=previous.sources.find(item=>item.plan.recipe.edgeRole===role),item=context.kit.terrainEdges[side][part],evidence=report.sourceEvidence.find(value=>value.edgeRole===role);
    check(source&&evidence&&evidence.rawSha256===hash(source.raw)&&evidence.planSha256===source.plan.sha256
      &&evidence.technicalSha256===source.result.technical.sha256&&files.get(`source/${role}-native.png`)?.equals(source.raw)
      &&canonicalJson(parseJson(files.get(`evidence/${role}-plan.json`)))===canonicalJson(source.plan)
      &&canonicalJson(parseJson(files.get(`evidence/${role}-result.json`)))===canonicalJson(source.result),
      'TERRAIN_BOTTOM_BASE_SIDE_SOURCE');
    const native=nativeSource(source.raw,source),{source:ref,pixelSize,...control}=item;
    check(native.bytes.equals(context.files.get(ref.path))&&hash(native.bytes)===ref.sha256&&evidence.derivedSha256===ref.sha256
      &&evidence.zeroAlphaRgbNormalizedPixels===native.normalized&&canonicalJson(control)===canonicalJson(oldControls[side][part])
      &&pixelSize.width===native.png.width&&pixelSize.height===native.png.height,'TERRAIN_BOTTOM_BASE_SIDE_SOURCE');
  }
  // Replay direct dense fields when present; a valid crop record alone cannot
  // certify an unrelated replacement of the underlying native material field.
  check((context.kit.terrainAppearance.format==='ai_scene_continuous_terrain_appearance_v6')===Boolean(report.materialDensity),'TERRAIN_BOTTOM_BASE_DENSITY');
  if(report.materialDensity){
    const mapping=parseJson(files.get('evidence/terrain-density2/surface-mapping-base.json')),density=deriveMeasuredFieldDensity2(inputs.material.raw,mapping);
    check(density.report.sha256===report.materialDensity.derivationSha256&&mapping.sha256===context.kit.terrainAppearance.surfaceMappingSha256,'TERRAIN_BOTTOM_BASE_DENSITY');
    for(const kind of ['body','cap'])check(context.files.get(context.kit.terrainAppearance[kind].source.path)?.equals(density.files.get(`materials/${kind}-field.png`)),
      'TERRAIN_BOTTOM_BASE_DENSITY');
  }
  return {handle,context,files,bundle,report,previous};
}

function prepared(options){
  exact(options,['workflow','baseKitRoot','batchSha256','controls','output']);exact(options.controls,['bottom']);
  check(!isWithin(resolve(dirname(options.baseKitRoot)),resolve(options.output))&&!isWithin(resolve(options.workflow),resolve(options.output)),'OUTPUT_OVERLAP');
  const inputs=flow.getTerrainEdgeInputs(options.workflow,options.batchSha256),{batch}=inputs;
  check(inputs.sources.length===3&&TERRAIN_BOTTOM_DELIVERY_ROLES.every(([,role])=>inputs.sources.some(item=>item.plan.recipe.edgeRole===role)),'TERRAIN_BOTTOM_DELIVERY_COVERAGE');
  const base=checkedBase(options.workflow,options.baseKitRoot,inputs),kit=clone(base.context.kit),
    files=new Map([...base.context.files].map(([path,bytes])=>['kit/'+path,Buffer.from(bytes)]));
  // Preserve original source PNGs, QA, plans and the previous sealed bundle as
  // immutable evidence. Old kit PNG bytes are reused in-place rather than copied.
  const baselineArtifacts=[];
  for(const [path,bytes]of base.files){const target=path.startsWith('kit/')&&path.endsWith('.png')?path:'baseline/'+path;
    if(!files.has(target))files.set(target,Buffer.from(bytes));else check(files.get(target).equals(bytes),'TERRAIN_BOTTOM_BASE_SOURCE_BYTES');
    baselineArtifacts.push({path,storedAs:target,sha256:hash(bytes),byteLength:bytes.length});}
  kit.revision='terrain-bottom-'+hash(jsonBytes({sourceKitSha256:base.handle.bundleSha256,batchSha256:batch.sha256,controlsSha256:hash(jsonBytes(options.controls))})).slice(0,16);
  const bottom=prepareTerrainBottomEdgeAssets({files,kit,inputs,controls:options.controls.bottom}),kitRef={kitId:kit.kitId,revision:kit.revision};
  for(const [kind,ref]of Object.entries(kit.files))for(const entry of kind==='maps'?Object.values(ref):[ref]){
    const value=parseJson(files.get('kit/'+entry.path));value.kitRef=kitRef;const bytes=jsonBytes(value);files.set('kit/'+entry.path,bytes);entry.sha256=hash(bytes);}
  put(files,'kit/kit.json',kit);files.set('source/reference-native.png',Buffer.from(inputs.reference.raw));files.set('source/material-native.png',Buffer.from(inputs.material.raw));
  put(files,'evidence/bottom-batch.json',batch);put(files,'evidence/bottom-controls.json',options.controls);put(files,'evidence/baseline-artifacts.json',baselineArtifacts);
  const report=seal({format:'ai_scene_terrain_bottom_edge_candidate_v1',profile:bottom.edges.profile,baseKitSha256:base.handle.bundleSha256,
    ...(bottom.edges.bodySupportProfile?{bodySupportProfile:bottom.edges.bodySupportProfile}:{}),
    ...(bottom.edges.thinPlatformTopProfile?{thinPlatformTopProfile:bottom.edges.thinPlatformTopProfile}:{}),
    ...(bottom.edges.nativeSizeProfile?{nativeSizeProfile:bottom.edges.nativeSizeProfile,renderEnvelopeProfile:bottom.edges.renderEnvelopeProfile,
      sourcePreparations:bottom.evidence.filter(item=>item.nativeSizePreparation||item.nativeCanvasGutterPreparation).map(item=>clone(item.nativeSizePreparation??item.nativeCanvasGutterPreparation)),
      nativeEnvelopeValidation:clone(bottom.validation),nativeEnvelopeValidationSha256:hash(jsonBytes(bottom.validation))}:{}),
    baseCandidateBundleSha256:base.bundle.sha256,baseCandidateReportSha256:base.report.sha256,baseBatchSha256:batch.baseBatchSha256,
    edgeBatchSha256:batch.sha256,originalSideBatchSha256:base.report.edgeBatchSha256,referenceRawSha256:hash(inputs.reference.raw),materialRawSha256:batch.materialRawSha256,
    surfaceMappingSha256:kit.terrainAppearance.surfaceMappingSha256,controlsSha256:hash(jsonBytes(options.controls)),kitSha256:hash(jsonBytes(kit)),
    sourceEvidence:bottom.evidence,originalSideSourceEvidence:clone(base.report.sourceEvidence),baselineArtifacts,
    sourceOriginalsPreserved:true,originalSideSourcesPreserved:true,originalAppearancePreserved:true,originalProfilesPreserved:true,
    authorGeometryChanged:false,collisionChanged:false,sourcePngAlphaChanged:false,pixelsRecolored:false,rotation:false,mirroring:false,
    renderingPolicy:'checked-native-bottom-strip-and-corners-only-no-rotated-top-lip',derivedPixelPolicy:'only-zero-alpha-rgb-normalization-no-alpha-or-visible-color-changes',
    artAcceptance:'not-assessed',generationCalls:0,productionKit:false});
  put(files,'readiness.json',report);const bundle=seal({format:'ai_scene_terrain_bottom_edge_candidate_bundle_v1',reportSha256:report.sha256,
    artifacts:manifest(files),generationCalls:0,productionKit:false});put(files,'proof-bundle.json',bundle);
  return {files,bundle,report,reference:inputs.reference.raw,base};
}

function receipt(data,handle,scene,zip,render,comparison,exported){
  const before=compileMap(data.base.handle,readMap(data.base.handle));
  check(canonicalJson(before.collisionSuggestions)===canonicalJson(scene.collisionSuggestions),'TERRAIN_BOTTOM_DELIVERY_COLLISION');
  const plain=({kitRef,...document})=>document;check(canonicalJson(plain(readMap(data.base.handle)))===canonicalJson(plain(readMap(handle))),'TERRAIN_BOTTOM_DELIVERY_AUTHOR');
  return seal({format:'ai_scene_terrain_bottom_edge_delivery_v1',candidateBundleSha256:data.bundle.sha256,candidateReportSha256:data.report.sha256,
    edgeBatchSha256:data.report.edgeBatchSha256,baseKitSha256:data.report.baseKitSha256,kitSha256:handle.bundleSha256,authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,
    zip:{sha256:hash(zip),byteLength:zip.length},render:{sha256:hash(render),kind:'deterministic-default-scene-render-not-browser-screenshot'},
    comparison:{sha256:hash(comparison),left:'accepted-whole-reference',right:'deterministic-bottom-edge-recomposition',referencePixelsCopiedIntoAssets:0},
    export:exported,studio:{kit:'candidate/kit',document:'export/scene.document.json'},sourceOriginalsPreserved:true,originalSideSourcesPreserved:true,
    authorGeometryChanged:false,collisionChanged:false,finalHumanArtReview:'pending',productionKit:false,generationCalls:0});
}

export function buildTerrainBottomEdgeDelivery(options){
  const data=prepared(options),out=makeFreshDirectory(options.output,sourceRoot);writeProofBundle(join(out,'candidate'),options.workflow,data);
  const handle=loadSceneKit(join(out,'candidate/kit')),map=readMap(handle),scene=compileMap(handle,map),context=contextFor(handle),exported=exportScene(handle,map,join(out,'export')),
    zip=exportSceneArchive(handle,map),render=renderCoherentFrame(scene,path=>context.files.get(path)),comparison=coherentComparison(data.reference,render);
  for(const [path,bytes]of [['scene-kit.zip',zip],['scene-preview.png',render],['reference-native.png',data.reference],['reference-vs-reconstruction.png',comparison]])writeFreshFile(join(out,path),bytes,sourceRoot);
  const report=receipt(data,handle,scene,zip,render,comparison,exported);writeFreshFile(join(out,'delivery.json'),jsonBytes(report),sourceRoot);return report;
}

export function verifyTerrainBottomEdgeDelivery(options){
  const data=prepared(options),out=options.output,report=readJson(join(out,'delivery.json'));unseal(report);verifyProofBundle(join(out,'candidate'),data);
  const handle=loadSceneKit(join(out,'candidate/kit')),map=readMap(handle),scene=compileMap(handle,map),context=contextFor(handle),reopened=openSceneExport(join(out,'export'));
  check(reopened.compiled.contentSha256===scene.contentSha256&&canonicalJson(reopened.document)===canonicalJson(canonicalMap(map)),'TERRAIN_BOTTOM_DELIVERY_EXPORT');
  const zip=exportSceneArchive(handle,map),render=renderCoherentFrame(scene,path=>context.files.get(path)),comparison=coherentComparison(data.reference,render);
  for(const [path,bytes]of [['scene-kit.zip',zip],['scene-preview.png',render],['reference-native.png',data.reference],['reference-vs-reconstruction.png',comparison]])
    check(readSelectedFile(join(out,path),268435456).equals(bytes),'TERRAIN_BOTTOM_DELIVERY_ARTIFACT');
  const exported={status:'export-integrity-verified',fileCount:readJson(join(out,'export/manifest.json')).files.length+1,sourceKitSha256:handle.bundleSha256,
    authorSha256:scene.source.authorSha256,contentSha256:scene.contentSha256,visualAcceptance:'not-assessed',generationCalls:0};
  check(canonicalJson(report)===canonicalJson(receipt(data,handle,scene,zip,render,comparison,exported)),'TERRAIN_BOTTOM_DELIVERY_REPLAY');
  return {status:'verified',reportSha256:report.sha256,kitSha256:handle.bundleSha256,zipSha256:hash(zip),artAcceptance:'not-assessed',generationCalls:0};
}
