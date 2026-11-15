import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isWithin,makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import {canonicalJson,clone} from './document.mjs';
import {check,digest,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import {loadSceneKit,readMap,contextFor} from './kit.mjs';
import {compileMap} from './compile.mjs';
import {exportScene,exportSceneArchive,openSceneExport} from './persistence.mjs';
import {renderCoherentFrame,coherentComparison} from './coherent-render.mjs';
import {writeProofBundle,verifyProofBundle} from './terrain-proof/bundle.mjs';
import {encodeRgbaPng,inspectPng} from './png.mjs';
import {TERRAIN_EDGE_PROFILE,NEAR_OPAQUE_JOIN_PROFILE,INBOARD_COVERAGE_PROFILE,EXPOSED_SIDE_TERMINATION_PROFILE,validateTerrainEdges,validateTerrainEdgeJoin} from './terrain-edges.mjs';
import {deriveMeasuredFieldDensity2} from './terrain-proof/measured-field-density.mjs';
import {buildTerrainEdgeJunctions} from './terrain-edge-junction.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE,validateTerrainSurfaceInterface} from './terrain-union-material.mjs';
import {buildTerrainMaterialLoop} from './terrain-material-loop.mjs';
import {buildTerrainRigidRepeat} from './terrain-rigid-repeat.mjs';
import {buildTerrainStepCornerProfile} from './terrain-step-corners.mjs';
import {prepareTerrainBottomEdgeAssets,TERRAIN_BOTTOM_DELIVERY_ROLES} from './terrain-bottom-edge-pipeline.mjs';
import {TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,terrainEdgeCanvasGutterView} from './generation/terrain-edge-canvas-gutter.mjs';
import {terrainEdgeCanvasGutterEvidence,terrainEdgeRebindEvidence} from './terrain-edge-preparation-evidence.mjs';
import {terrainEdgeRebindView} from './generation/terrain-edge-rebind.mjs';
import {prepareTerrainEdgeRecoveryComputeReview} from './terrain-edge-recovery-review.mjs';
import {isTerrainEdgeRecoveryBatch} from './generation/terrain-edge-recovery.mjs';
import {requireTerrainBrushFootprint} from './terrain-brush-footprint.mjs';
import {readTerrainUpperSelection,readTerrainSideSelection,terrainEdgeSourceOrigin} from './terrain-edge-selection.mjs';
import {buildTerrainSurfaceCycle} from './terrain-surface-cycle.mjs';
import {buildTerrainSurfaceSpanProfile} from './terrain-surface-span-envelope.mjs';
import {resolveTerrainMaterialAppearance,resolveTerrainSurfaceInterface} from './terrain-loop-material.mjs';
import {buildTerrainStepSurface,TERRAIN_STEP_SURFACE_PROFILE,TERRAIN_STEP_LINEAR_SURFACE_PROFILE} from './terrain-step-surface.mjs';
export {exportTerrainEdgeCanvasGutterReview,applyTerrainEdgeCanvasGutterReview} from './terrain-edge-canvas-gutter-review.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const roles=[['left','wall','left-wall'],['right','wall','right-wall'],['left','corner','left-top-corner'],['right','corner','right-top-corner']];
const readJson=path=>parseJson(readSelectedFile(path));
const manifest=files=>[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length}));
const put=(files,path,value)=>files.set(path,jsonBytes(value));

// Preparing or replaying this packet never authorizes or reserves compute.
export function prepareTerrainEdgeComputeReview(workflow,batchSha256,output){
  const batch=flow.getTerrainEdgeSourceBatch(workflow,batchSha256);
  if(isTerrainEdgeRecoveryBatch(batch))return prepareTerrainEdgeRecoveryComputeReview(workflow,batch,output);
  if(batch.format==='ai_scene_terrain_edge_canvas_gutter_batch_v1')return preparedContinuationComputeReview(workflow,batch,output);
  check(!['ai_scene_terrain_edge_prepared_batch_v1','ai_scene_terrain_edge_rebind_batch_v1'].includes(batch.format),'TERRAIN_EDGE_COMPUTE_NON_EXECUTABLE_PREPARATION');
  const plans=batch.planSha256s.map(sha=>flow.getGenerationPlan(workflow,sha)),files=new Map(),inputs=[];
  const manufacturedMaterialProfile=plans[0].recipe.manufacturedMaterialProfile;
  const gutterPolicy=plans[0].recipe.gutterPolicy;
  const state=flow.inspectWorkflow(workflow);
  check(plans.every(plan=>state.plans.some(entry=>entry.planSha256===plan.sha256&&entry.current)),'TERRAIN_EDGE_COMPUTE_STALE');
  for(const [index,plan]of plans.entries()){
    check(plan.request.images.length===(plan.recipe.topologyGuideProfile?3:2)&&plan.request.maximumCalls===1,'TERRAIN_EDGE_COMPUTE_REQUEST');
    put(files,`plan-${index+1}.json`,plan);files.set(`prompt-${index+1}.txt`,Buffer.from(plan.request.prompt+'\n'));
    const current=plan.request.images.map((item,inputIndex)=>{
      const bytes=flow.readGenerationInput(workflow,plan.sha256,inputIndex),path=inputIndex===2?`guide-${index+1}.png`:`input-${inputIndex+1}.png`;
      check(hash(bytes)===item.artifact.sha256&&bytes.length===item.artifact.byteLength,'TERRAIN_EDGE_COMPUTE_INPUT');
      if(files.has(path))check(files.get(path).equals(bytes),'TERRAIN_EDGE_COMPUTE_INPUT');else files.set(path,bytes);
      return {path,role:item.role,sha256:hash(bytes),byteLength:bytes.length};
    });
    inputs.push({planSha256:plan.sha256,edgeRole:plan.recipe.edgeRole,assetId:plan.recipe.assetId,
      prompt:`prompt-${index+1}.txt`,inputs:current,maximumCalls:1,transparentBackground:true});
  }
  const report=seal({format:'ai_scene_terrain_edge_compute_review_v1',targetSha256:batch.sha256,
    baseBatchSha256:batch.baseBatchSha256,referencePlanSha256:batch.referencePlanSha256,targetLayoutSha256:batch.targetSha256,
    materialPlanSha256:batch.materialPlanSha256,materialRawSha256:batch.materialRawSha256,policySha256:batch.policySha256,
    ...(batch.coverageProfile?{coverageProfile:batch.coverageProfile,coverage:batch.coverage,expectedRoles:clone(batch.expectedRoles),requestedRoles:clone(batch.requestedRoles)}:{}),
    ...(batch.naturalSurfaceProfile?{naturalSurfaceProfile:batch.naturalSurfaceProfile}:{}),
    ...(manufacturedMaterialProfile?{manufacturedMaterialProfile}:{}),
    ...(gutterPolicy?{gutterPolicy}:{}),
    plans:inputs,maximumCalls:batch.maximumCalls,automaticRetry:false,inputOrder:plans.some(p=>p.recipe.topologyGuideProfile)?'accepted-whole-reference-then-current-native-material-then-role-specific-neutral-guide':'accepted-whole-reference-then-current-native-material',
    sourceAcceptance:'separate-human-visual-review',generationCalls:0,computeAuthorizationIncluded:false,existingAuthorizationsReused:false});
  put(files,'batch.json',batch);put(files,'compute-review.json',report);
  files.set('README.md',Buffer.from([batch.coverageProfile?'# 地形整周包边与独立底缘：准确计算审阅':'# 地形侧边与转角：准确计算审阅','',
    plans.some(p=>p.recipe.topologyGuideProfile)?'本包包含全部已冻结单层计划、准确提示及两张原生PNG和各角色的中性透明方向图。准备此包不调用图片工具、不授权、不预留、不重试。':'本包包含全部已冻结单层计划、准确提示和按顺序输入的两张原生PNG。准备此包不调用图片工具、不授权、不预留、不重试。',
    manufacturedMaterialProfile
      ?'每份计划最多一次，全部透明。按审核参考、实际原生材质和逐项职责确定正面材质、接缝尺度及附属细节。左右分别绘制，保留原光照。技术失败、未知结果或明显职责混层时停止。'
      :batch.surfaceFamily==='engineered-city'
      ?'每份计划最多一次，全部透明；左右独立，保持工业接缝，不旋转表沿、不镜像光照。技术失败、未知结果或明显职责混层时停止。'
      :batch.naturalSurfaceProfile==='reference-defined-cover-v1'
      ?'每份计划最多一次，全部透明；自然覆盖物、裸露边界与附着物由接受参考、原生材质和明确设计共同定义；左右独立、不旋转边界、不镜像光照。技术失败、未知结果或明显职责混层时停止。'
      :'每份计划最多一次，全部透明；左右独立，不旋转草皮、不镜像光照。技术失败、未知结果或明显职责混层时停止。',
    '来源接收后再提交显式原生坐标和等比尺度，检查实际回拼；此包不授予来源或整景美术接受。','',
    `新批次 SHA-256：${batch.sha256}`,`本包审阅 SHA-256：${report.sha256}`,''].join('\n')));
  const bundle=seal({format:'ai_scene_terrain_edge_compute_review_bundle_v1',reviewSha256:report.sha256,artifacts:manifest(files),generationCalls:0});
  put(files,'proof-bundle.json',bundle);const prepared={files,bundle,report};
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);return report;
}

function preparedContinuationComputeReview(workflow,batch,output){
  const view=flow.readTerrainEdgeWorkflowView(workflow,{batchSha256:batch.sha256,includeCurrentInputs:true,includeResults:true}),state=view.inspection,
    files=new Map(),plans=[],preparedSources=[],completedSources=[];
  for(const [index,sha]of batch.planSha256s.entries()){
    const plan=view.plans.find(p=>p.sha256===sha),status=state.plans.find(p=>p.planSha256===sha);
    check(status?.current,'TERRAIN_EDGE_COMPUTE_STALE');put(files,`plan-${index+1}.json`,plan);
    if(plan.request.maximumCalls===0){check(plan.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT||plan.format==='ai_scene_terrain_edge_native_size_preparation_v1','TERRAIN_EDGE_COMPUTE_REQUEST');
      preparedSources.push({planSha256:sha,edgeRole:plan.recipe.edgeRole,maximumCalls:0,sourcePlanSha256:plan.sourcePlanSha256,rawSha256:plan.rawSha256});continue;}
    if(['pending-visual-review','accepted'].includes(status.status)){const result=view.results.get(sha);put(files,`result-${index+1}.json`,result.result);
      completedSources.push({planSha256:sha,edgeRole:plan.recipe.edgeRole,resultSha256:result.result.sha256,maximumCalls:0});continue;}
    check(status.status==='authorized'&&plan.request.images.length===(plan.recipe.topologyGuideProfile?3:2)&&plan.request.maximumCalls===1
      &&batch.reusedAuthorizations.some(a=>a.planSha256===sha&&a.requestSha256===digest(plan.request)), 'TERRAIN_EDGE_COMPUTE_REQUEST');
    files.set(`prompt-${index+1}.txt`,Buffer.from(plan.request.prompt+'\n'));
    const inputs=plan.request.images.map((image,inputIndex)=>{const bytes=view.inputs.get(image.artifact.sha256),path=inputIndex===2?`guide-${index+1}.png`:`input-${inputIndex+1}.png`;
      check(hash(bytes)===image.artifact.sha256&&bytes.length===image.artifact.byteLength,'TERRAIN_EDGE_COMPUTE_INPUT');
      if(files.has(path))check(files.get(path).equals(bytes),'TERRAIN_EDGE_COMPUTE_INPUT');else files.set(path,bytes);
      return {path,role:image.role,sha256:hash(bytes),byteLength:bytes.length};});
    plans.push({planSha256:sha,edgeRole:plan.recipe.edgeRole,assetId:plan.recipe.assetId,prompt:`prompt-${index+1}.txt`,inputs,maximumCalls:1,transparentBackground:true,
      authorizationSha256:batch.reusedAuthorizations.find(a=>a.planSha256===sha).authorizationSha256});
  }
  const report=seal({format:'ai_scene_terrain_edge_compute_review_v2',targetSha256:batch.sha256,parentBatchSha256:batch.parentBatchSha256,
    baseBatchSha256:batch.baseBatchSha256,referencePlanSha256:batch.referencePlanSha256,targetLayoutSha256:batch.targetSha256,
    materialPlanSha256:batch.materialPlanSha256,materialRawSha256:batch.materialRawSha256,policySha256:batch.policySha256,
    plans,preparedSources,completedSources,maximumCalls:plans.length,newImageRequests:0,automaticRetry:false,
    inputOrder:view.plans.some(p=>p.recipe?.topologyGuideProfile)?'accepted-whole-reference-then-current-native-material-then-role-specific-neutral-guide':'accepted-whole-reference-then-current-native-material',sourceAcceptance:'separate-human-visual-review',generationCalls:0,
    computeAuthorizationIncluded:false,existingAuthorizationsReused:true});
  put(files,'batch.json',batch);put(files,'compute-review.json',report);
  files.set('README.md',Buffer.from('Only the unchanged authorized requests listed in compute-review.json remain executable. Prepared and completed sources have zero calls. No compute is authorized or dispatched by this export.\n'));
  const bundle=seal({format:'ai_scene_terrain_edge_compute_review_bundle_v2',reviewSha256:report.sha256,artifacts:manifest(files),generationCalls:0});
  put(files,'proof-bundle.json',bundle);const prepared={files,bundle,report};
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);return report;
}

function baseCandidate(workflow,baseKitRoot,batch,beforeVerify){
  const handle=loadSceneKit(baseKitRoot),context=contextFor(handle),root=dirname(baseKitRoot),compositionPath=join(root,'evidence/composition-profile.json');
  beforeVerify?.(context);
  const composition=existsSync(compositionPath)?readJson(compositionPath):null;
  // Replay the base candidate against the exact completed source batch. An
  // arbitrary schema-valid kit does not supply the required source identity.
  const verification=flow.verifyCoherentCandidate(workflow,batch.baseBatchSha256,context.kit.kitId,root,composition);
  check(context.kit.format==='ai_scene_kit_v4'&&context.kit.terrainAppearance.format==='ai_scene_continuous_terrain_appearance_v5'
    &&!Object.hasOwn(context.kit,'terrainEdges')&&context.kit.terrainAppearance.sourceSha256===batch.materialRawSha256,'TERRAIN_EDGE_DELIVERY_BASE');
  return {handle,context,verification,composition};
}

function preparedCandidate({workflow,baseKitRoot,batchSha256,controls,footprintPolicy,upperReplacementBatchSha256,replacementBatchSha256s}){
  const nearOpaque=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'joinProfile');
  const dense=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'materialDensityProfile');
  const gridEnabled=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'gridProfile');
  const junctionEnabled=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'junctions');
  const unionMaterial=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'materialProfile');
  const loopEnabled=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'materialLoop');
  const stepEnabled=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'stepCorners');
  const termination=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'sideTerminationProfile');
  const nativeLip=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'surfaceInterface');
  const rigid=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'rigidBodyRepeat');
  const bottomEnabled=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'bottom');
  const surfaceCycle=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'surfaceCycle');
  const spanEnvelope=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'surfaceSpanEnvelope');
  const stepSurface=controls!==null&&typeof controls==='object'&&Object.hasOwn(controls,'stepSurfaceProfile');
  exact(controls,['left','right',...(nearOpaque?['joinProfile']:[]),...(dense?['materialDensityProfile']:[]),...(gridEnabled?['gridProfile']:[]),...(junctionEnabled?['junctions']:[]),...(unionMaterial?['materialProfile']:[]),...(loopEnabled?['materialLoop']:[]),...(stepEnabled?['stepCorners']:[]),...(termination?['sideTerminationProfile']:[]),...(nativeLip?['surfaceInterface']:[]),...(rigid?['rigidBodyRepeat']:[]),...(bottomEnabled?['bottom']:[]),...(surfaceCycle?['surfaceCycle']:[]),...(spanEnvelope?['surfaceSpanEnvelope']:[]),...(stepSurface?['stepSurfaceProfile']:[])]);
  check(!stepSurface||stepEnabled&&nativeLip&&unionMaterial&&dense&&[TERRAIN_STEP_SURFACE_PROFILE,TERRAIN_STEP_LINEAR_SURFACE_PROFILE].includes(controls.stepSurfaceProfile),'STEP_SURFACE_PIPELINE_BINDING');
  check(!spanEnvelope||nativeLip&&unionMaterial&&dense,'TERRAIN_SURFACE_SPAN_BINDING');
  if(surfaceCycle){check(unionMaterial&&dense&&nativeLip,'SURFACE_CYCLE_PIPELINE_BINDING');exact(controls.surfaceCycle,['fromColumn','usableColumns','overlapColumns']);}
  check(!bottomEnabled||unionMaterial,'TERRAIN_BOTTOM_DELIVERY_BASE');
  if(rigid){check(unionMaterial&&dense&&!loopEnabled,'RIGID_REPEAT_BINDING');exact(controls.rigidBodyRepeat,['fromRow','toRow']);}
  check(!nativeLip||unionMaterial,'TERRAIN_SURFACE_INTERFACE_PROFILE');
  check(!termination||unionMaterial&&controls.sideTerminationProfile===EXPOSED_SIDE_TERMINATION_PROFILE,'TERRAIN_EDGE_TERMINATION_PROFILE');
  if(stepEnabled){check(unionMaterial,'STEP_CORNER_PIPELINE_PROFILE');buildTerrainStepCornerProfile(controls.stepCorners);}
  if(loopEnabled){check(unionMaterial&&dense,'MATERIAL_LOOP_PIPELINE_PROFILE');exact(controls.materialLoop,['overlapRows','phaseCount']);}
  check(!unionMaterial||(junctionEnabled&&controls.materialProfile===TERRAIN_UNION_MATERIAL_PROFILE),'TERRAIN_UNION_MATERIAL_PROFILE');
  check(!nearOpaque||controls.joinProfile===NEAR_OPAQUE_JOIN_PROFILE,'TERRAIN_EDGE_JOIN_PROFILE');
  check(!dense||controls.materialDensityProfile==='reference-native-2x-v1','TERRAIN_EDGE_DENSITY_PROFILE');
  for(const side of ['left','right'])exact(controls[side],['wall','corner']);
  const blended=roles.some(([side,part])=>controls[side][part]&&Object.hasOwn(controls[side][part],'inboardBlend'));
  check(!blended||nearOpaque,'TERRAIN_EDGE_COVERAGE_PROFILE');
  check(!blended||roles.every(([side,part])=>controls[side][part]&&Object.hasOwn(controls[side][part],'inboardBlend')),'TERRAIN_EDGE_BLEND_COVERAGE');
  check(!gridEnabled||(controls.gridProfile==='grid-solid-union-native-v1'&&blended),'TERRAIN_EDGE_GRID_PROFILE');
  if(junctionEnabled)check(gridEnabled&&controls.junctions&&typeof controls.junctions==='object'&&!Array.isArray(controls.junctions)
    &&Object.keys(controls.junctions).every(key=>['firstWallNativeOriginWorld','wallStepWorld','wallRepeatProfile'].includes(key)),'TERRAIN_JUNCTION_OPTIONS');
  const inputs=replacementBatchSha256s!==undefined?readTerrainSideSelection(workflow,batchSha256,replacementBatchSha256s)
    :upperReplacementBatchSha256===undefined?flow.getTerrainEdgeInputs(workflow,batchSha256)
    :readTerrainUpperSelection(workflow,batchSha256,upperReplacementBatchSha256),{batch}=inputs;
  check(upperReplacementBatchSha256===undefined||bottomEnabled,'TERRAIN_UPPER_SELECTION_COVERAGE');
  check(replacementBatchSha256s===undefined||bottomEnabled,'TERRAIN_PERIMETER_SELECTION_COVERAGE');
  const expectedRoles=[...roles.map(([, ,role])=>role),...(bottomEnabled?TERRAIN_BOTTOM_DELIVERY_ROLES.map(([,role])=>role):[])];
  check(inputs.sources.length===expectedRoles.length&&expectedRoles.every(role=>inputs.sources.some(source=>source.plan.recipe.edgeRole===role)),'TERRAIN_EDGE_DELIVERY_COVERAGE');
  let footprint=null;
  const {handle,context,verification,composition}=baseCandidate(workflow,baseKitRoot,batch,footprintPolicy===undefined?null:base=>{
    const edgeControls={left:{},right:{}};
    for(const [side,part,role]of roles){
      const source=inputs.sources.find(s=>s.plan.recipe.edgeRole===role),frame=source.preparation?.record.nativeFrame??source.rebind?.record.nativeFrame??source.result.technical.image.pixelSize;
      edgeControls[side][part]={...clone(controls[side][part]),pixelSize:{width:frame.width,height:frame.height},sourceRawSha256:source.result.rawSha256};
    }
    const bottomControls=bottomEnabled?clone(controls.bottom):null;
    if(bottomControls)for(const [key,role]of TERRAIN_BOTTOM_DELIVERY_ROLES)bottomControls[key].sourceRawSha256=inputs.sources.find(s=>s.plan.recipe.edgeRole===role).result.rawSha256;
    footprint=requireTerrainBrushFootprint({grid:base.kit.grid,terrainEdges:edgeControls,terrainBottomEdges:bottomControls,policy:footprintPolicy});
  });
  const files=new Map([...context.files].map(([path,bytes])=>['kit/'+path,Buffer.from(bytes)])),kit=clone(context.kit);
  let density=null;
  if(dense){
    check(['ai_scene_coherent_composition_v4','ai_scene_coherent_composition_v5','ai_scene_coherent_composition_v6'].includes(composition?.format)&&composition.surfaceMapping?.sha256===kit.terrainAppearance.surfaceMappingSha256,
      'TERRAIN_EDGE_DENSITY_BINDING');
    density=deriveMeasuredFieldDensity2(inputs.material.raw,composition.surfaceMapping);
    for(const [path,bytes]of density.files)files.set('evidence/terrain-density2/'+path,bytes);
    put(files,'evidence/terrain-density2/base-appearance.json',context.kit.terrainAppearance);
    for(const kind of ['body','cap']){
      const path=kit.terrainAppearance[kind].source.path;
      files.set(`evidence/terrain-density2/base-materials/${kind}-field.png`,Buffer.from(files.get('kit/'+path)));
      files.set('kit/'+path,density.files.get(`materials/${kind}-field.png`));
    }
    const field=(kind)=>{const path=kit.terrainAppearance[kind].source.path,bytes=files.get('kit/'+path),entry=density.report.artifacts.find(item=>item.path===`materials/${kind}-field.png`);
      return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:clone(entry.pixelSize)};};
    kit.terrainAppearance={...kit.terrainAppearance,format:'ai_scene_continuous_terrain_appearance_v6',profileSha256:density.report.profileSha256,
      studySha256:density.report.sha256,body:field('body'),cap:field('cap'),surfaceOriginInBodyPixels:clone(density.report.surfaceOriginInBodyPixels),
      capDepth:clone(density.report.capDepth),capUvEnd:clone(density.report.capUvEnd)};
  }
  kit.revision='terrain-edges-'+hash(jsonBytes({batchSha256:batch.sha256,controlsSha256:hash(jsonBytes(controls)),...(inputs.selection?{selectionSha256:inputs.selection.sha256}:{})})).slice(0,16);
  if(nativeLip)validateTerrainSurfaceInterface(controls.surfaceInterface,kit.terrainAppearance);
  const kitRef={kitId:kit.kitId,revision:kit.revision},edges={format:gridEnabled?'ai_scene_terrain_edges_v4':blended?'ai_scene_terrain_edges_v3':nearOpaque?'ai_scene_terrain_edges_v2':'ai_scene_terrain_edges_v1',profile:TERRAIN_EDGE_PROFILE,
    ...(termination?{sideTerminationProfile:controls.sideTerminationProfile}:{}),
    ...(nativeLip?{surfaceInterface:clone(controls.surfaceInterface)}:{}),
    ...(nearOpaque?{joinProfile:controls.joinProfile}:{}),
    ...(gridEnabled?{gridProfile:controls.gridProfile}:{}),
    sourceBinding:{materialSourceSha256:kit.terrainAppearance.sourceSha256,surfaceMappingSha256:kit.terrainAppearance.surfaceMappingSha256},left:{},right:{}},evidence=[];
  for(const [side,part,role]of roles){
    const item=inputs.sources.find(source=>source.plan.recipe.edgeRole===role),{plan,raw,result}=item;
    check(hash(raw)===result.rawSha256&&result.technical.status==='pass','TERRAIN_EDGE_DELIVERY_SOURCE');
    const origin=terrainEdgeSourceOrigin(inputs,item),nativeCanvasGutterPreparation=terrainEdgeCanvasGutterEvidence(item,origin.batch,files,origin.parentBatch),rebindPreparation=terrainEdgeRebindEvidence(item,origin.batch,files),
      png=rebindPreparation?terrainEdgeRebindView(item,origin.batch):nativeCanvasGutterPreparation?terrainEdgeCanvasGutterView(item):inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),rgba=Buffer.from(png.rgba);let normalized=0;
    for(let p=0;p<rgba.length;p+=4)if(rgba[p+3]===0){if(rgba[p]||rgba[p+1]||rgba[p+2])normalized++;rgba[p]=0;rgba[p+1]=0;rgba[p+2]=0;}
    const bytes=encodeRgbaPng(png.width,png.height,rgba),path=`assets/terrain-edge-${role}.png`,control=controls[side][part];
    exact(control,['scale','boundaryX','innerX',...(part==='wall'?['repeatY']:['surfaceY','wallStartY']),...(blended?['inboardBlend']:[])]);
    check(!files.has('kit/'+path),'TERRAIN_EDGE_DELIVERY_SOURCE_COLLISION');
    files.set('kit/'+path,bytes);edges[side][part]={source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width:png.width,height:png.height},...clone(control)};
    files.set(`source/${role}-native.png`,Buffer.from(raw));put(files,`evidence/${role}-plan.json`,plan);put(files,`evidence/${role}-result.json`,result);
    evidence.push({edgeRole:role,planSha256:plan.sha256,rawSha256:hash(raw),technicalSha256:result.technical.sha256,derivedSha256:hash(bytes),
      ...(nativeCanvasGutterPreparation?{nativeCanvasGutterPreparation}:{}),
      ...(rebindPreparation?{rebindPreparation}:{}),
      originalPngModified:false,visibleRgbaChanged:false,...(blended?{sourcePngAlphaChanged:false,effectiveRenderAlphaChanged:true}:{alphaChanged:false}),zeroAlphaRgbNormalizedPixels:normalized,
      sourceSampling:{targetPixelsPerWorldPixel:2,pixelsPerWorldPixel:control.scale.denominator/control.scale.numerator,nativeUpscale:false,
        measurement:'base-axis-density-before-column-projection',targetReached:control.scale.denominator/control.scale.numerator>=2},
      transforms:nearOpaque||part==='corner'?'explicit-uniform-base-scale-and-surface-column-projection-no-mirroring':'explicit-uniform-native-scale-no-mirroring',
      ...(blended?{renderCoverage:{profile:INBOARD_COVERAGE_PROFILE,inboardBlend:clone(control.inboardBlend),maximumSegments:32,
        sourcePngAlphaChanged:false,effectiveRenderAlpha:'native-alpha-times-coverageOpacity'}}:{}),
      artAcceptance:'not-transferred-by-assembly'});
  }
  if(junctionEnabled){
    edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:path=>files.get('kit/'+path),...controls.junctions});
    edges.format='ai_scene_terrain_edges_v5';put(files,'evidence/edge-junctions.json',edges.junctions);
  }
  if(unionMaterial){edges.format='ai_scene_terrain_edges_v6';edges.materialProfile=controls.materialProfile;}
  if(stepEnabled)kit.terrainStepCorners=buildTerrainStepCornerProfile(controls.stepCorners);
  if(loopEnabled){
    const source=kit.terrainAppearance.body.source,loop=buildTerrainMaterialLoop(files.get('kit/'+source.path),
      {source,outputPath:'materials/body-loop.png',usableRows:density.report.bodySampleHeight,...controls.materialLoop});
    check(!files.has('kit/'+loop.record.output.source.path),'MATERIAL_LOOP_OUTPUT_PATH');
    files.set('kit/'+loop.record.output.source.path,loop.png);kit.terrainMaterialLoop=loop.record;
    put(files,'evidence/terrain-material-loop.json',loop.record);
  }
  if(rigid){
    const source=kit.terrainAppearance.body.source,repeat=buildTerrainRigidRepeat(files.get('kit/'+source.path),
      {source,outputPath:'materials/body-rigid-repeat.png',...controls.rigidBodyRepeat});
    check(!files.has('kit/'+repeat.record.output.source.path),'RIGID_REPEAT_OUTPUT_PATH');
    files.set('kit/'+repeat.record.output.source.path,repeat.png);kit.terrainRigidRepeat=repeat.record;
    put(files,'evidence/terrain-rigid-repeat.json',repeat.record);
  }
  if(surfaceCycle){
    const source=kit.terrainAppearance.cap.source,cycle=buildTerrainSurfaceCycle(files.get('kit/'+source.path),
      {source,outputPath:'materials/cap-cycle.png',...controls.surfaceCycle});
    check(!files.has('kit/'+cycle.record.output.source.path),'SURFACE_CYCLE_OUTPUT');
    files.set('kit/'+cycle.record.output.source.path,cycle.png);kit.terrainSurfaceCycle=cycle.record;
    put(files,'evidence/terrain-surface-cycle.json',cycle.record);
  }
  if(spanEnvelope){
    kit.terrainSurfaceSpanEnvelope=buildTerrainSurfaceSpanProfile(controls.surfaceSpanEnvelope,{
      appearance:resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop,kit.terrainRigidRepeat,kit.terrainSurfaceCycle),
      surfaceInterface:resolveTerrainSurfaceInterface(edges.surfaceInterface,kit.terrainSurfaceCycle)});
    put(files,'evidence/terrain-surface-span-envelope.json',kit.terrainSurfaceSpanEnvelope);
  }
  if(stepSurface){
    kit.terrainStepSurface=buildTerrainStepSurface({
      profile:controls.stepSurfaceProfile,
      appearance:resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop,kit.terrainRigidRepeat,kit.terrainSurfaceCycle),
      surfaceInterface:resolveTerrainSurfaceInterface(edges.surfaceInterface,kit.terrainSurfaceCycle),
      surfaceSpanEnvelope:kit.terrainSurfaceSpanEnvelope,stepCorners:kit.terrainStepCorners});
    put(files,'evidence/terrain-step-surface.json',kit.terrainStepSurface);
  }
  kit.terrainEdges=edges;validateTerrainEdges(edges,kit.terrainAppearance,{readAsset:path=>files.get('kit/'+path)});
  if(nearOpaque)roles.forEach(([side,part],index)=>{
    evidence[index].nativeJoin=validateTerrainEdgeJoin(edges[side][part],{side,part,joinProfile:controls.joinProfile,readAsset:path=>files.get('kit/'+path)});
  });
  const bottom=bottomEnabled?prepareTerrainBottomEdgeAssets({files,kit,inputs,controls:controls.bottom}):null;
  if(bottom)evidence.push(...bottom.evidence);
  // Only kit identity changes in authoring; all terrain and object data stays.
  for(const [kind,ref]of Object.entries(kit.files)){
    if(kind==='maps')for(const [role,mapRef]of Object.entries(ref)){
      const document=clone(context.maps[role]);document.kitRef=kitRef;const bytes=jsonBytes(document);files.set('kit/'+mapRef.path,bytes);mapRef.sha256=hash(bytes);
    }else{
      const document=parseJson(files.get('kit/'+ref.path));document.kitRef=kitRef;const bytes=jsonBytes(document);files.set('kit/'+ref.path,bytes);ref.sha256=hash(bytes);
    }
  }
  put(files,'kit/kit.json',kit);files.set('source/reference-native.png',inputs.reference.raw);files.set('source/material-native.png',inputs.material.raw);
  put(files,'evidence/edge-batch.json',batch);put(files,'evidence/edge-controls.json',controls);
  if(inputs.sideReplacementInputs){
    put(files,'evidence/side-source-selection.json',inputs.selection);
    for(const [i,view]of inputs.sideReplacementInputs.entries())put(files,`evidence/side-replacement-batch-${i+1}.json`,view.batch);
  }else if(inputs.selection){put(files,'evidence/upper-source-selection.json',inputs.selection);put(files,'evidence/upper-replacement-batch.json',inputs.replacementInputs.batch);}
  if(footprint)put(files,'evidence/terrain-brush-footprint.json',footprint);
  put(files,'evidence/base-kit.json',context.kit);put(files,'evidence/base-candidate-verification.json',verification);
  const report=seal({format:'ai_scene_terrain_edge_candidate_v1',baseKitSha256:handle.bundleSha256,baseCandidateBundleSha256:verification.bundleSha256,
    baseBatchSha256:batch.baseBatchSha256,edgeBatchSha256:batch.sha256,referenceRawSha256:inputs.reference.target.rawSha256,
    materialRawSha256:batch.materialRawSha256,surfaceMappingSha256:kit.terrainAppearance.surfaceMappingSha256,sourceEvidence:evidence,
    controlsSha256:hash(jsonBytes(controls)),kitSha256:hash(jsonBytes(kit)),...(footprint?{brushFootprintReviewSha256:footprint.sha256}:{}),collision:'original-author-terrain-and-surface-suggestions-preserved',sourceOriginalsPreserved:true,
    ...(inputs.selection?{[inputs.sideReplacementInputs?'sideSourceSelection':'upperSourceSelection']:clone(inputs.selection)}:{}),
    ...(surfaceCycle?{surfaceCycle:{sha256:kit.terrainSurfaceCycle.sha256,sourceSha256:kit.terrainSurfaceCycle.sourceInput.sha256,
      outputSha256:kit.terrainSurfaceCycle.output.source.sha256,originalPngPreserved:true,artAcceptance:'not-assessed'}}:{}),
    ...(spanEnvelope?{surfaceSpanEnvelope:{profile:kit.terrainSurfaceSpanEnvelope.profile,sha256:kit.terrainSurfaceSpanEnvelope.sha256,
      coverage:'explicit-continuous-exposed-span-reduction-only',sourcePngChanged:false,sourceUvChanged:false,artAcceptance:'not-assessed'}}:{}),
    renderingPolicy:{cornerSurfaceMapping:'per-x-column-vertical-translation-following-compiled-surface',pngPixelsChanged:false,cornerGeometryMayShear:true,
      ...(termination?{sideTerminationProfile:controls.sideTerminationProfile}:{}),
      ...(nativeLip?{surfaceInterface:clone(controls.surfaceInterface)}:{}),
      sourceDensity:'base-axis-density-before-column-projection',projectionMetrics:'see-compiled-terrain-edge-report',
      ...(nearOpaque?{joinProfile:controls.joinProfile,minimumNativeCollarAlpha:250,sourceAlphaChanged:false,
        bodyUnderlap:'one-native-pixel-at-minimum-wall-corner-scale',wallSurfaceMapping:'per-x-column-vertical-translation-following-compiled-surface',wallGeometryMayShear:true}:{}),
      ...(blended?{inboardCoverageProfile:INBOARD_COVERAGE_PROFILE,maximumCoverageSegments:32,effectiveRenderAlpha:'native-alpha-times-coverageOpacity',sourcePngAlphaChanged:false}:{})},
    ...(gridEnabled?{gridPresentation:{profile:controls.gridProfile,bodyAndCap:'current-measured-continuous-fields',edges:'exposed-union-vertical-segments',
      attachedPlatformSkins:'preserved-excluded-from-grid-mesh',collision:'original-grid-suggestions-unchanged'}}:{}),
    ...(junctionEnabled?{edgeJunctions:{profile:edges.junctions.profile,sha256:edges.junctions.sha256,originalPngsChanged:false,artAcceptance:'not-assessed'}}:{}),
    ...(unionMaterial?{unionMaterial:{profile:edges.materialProfile,sharedSourceDepth:true,
      ...(nativeLip?{surfaceInterface:clone(controls.surfaceInterface),...validateTerrainSurfaceInterface(controls.surfaceInterface,kit.terrainAppearance)}:{}),
      sourcePngChanged:false,artAcceptance:'not-assessed'}}:{}),
    ...(loopEnabled?{materialLoop:{profile:kit.terrainMaterialLoop.profile,sha256:kit.terrainMaterialLoop.sha256,
      usableRows:density.report.bodySampleHeight,sourceRowsBinding:'current-bound-density-derivation',
      originalPngChanged:false,pixelsRecolored:false,physicalSourcePixelScalePreserved:true,artAcceptance:'not-assessed'}}:{}),
    ...(rigid?{rigidBodyRepeat:{profile:kit.terrainRigidRepeat.profile,sha256:kit.terrainRigidRepeat.sha256,
      sourcePngChanged:false,pixelsRecolored:false,pixelsBlended:false,sourcePixelSelectionOnly:true,
      phaseOriginWorldY:clone(kit.terrainRigidRepeat.phaseOriginWorldY),bodyPeriod:clone(kit.terrainRigidRepeat.bodyPeriod),artAcceptance:'not-assessed'}}:{}),
    ...(stepSurface?{stepSurface:clone(kit.terrainStepSurface)}:{}),
    ...(stepEnabled?{stepCorners:{profile:kit.terrainStepCorners.profile,configuration:clone(kit.terrainStepCorners),
      authorGeometryChanged:false,visualBoundaryChanged:true,sourcePngChanged:false,artAcceptance:'not-assessed'}}:{}),
    ...(bottomEnabled?{bottomEdges:{profile:bottom.edges.profile,sourceRoles:TERRAIN_BOTTOM_DELIVERY_ROLES.map(([,role])=>role),
      ...(bottom.edges.bodySupportProfile?{bodySupportProfile:bottom.edges.bodySupportProfile}:{}),
      ...(bottom.edges.thinPlatformTopProfile?{thinPlatformTopProfile:bottom.edges.thinPlatformTopProfile}:{}),
      ...(bottom.edges.nativeSizeProfile?{nativeSizeProfile:bottom.edges.nativeSizeProfile,renderEnvelopeProfile:bottom.edges.renderEnvelopeProfile,
        sourcePreparations:bottom.evidence.filter(item=>item.nativeSizePreparation||item.nativeCanvasGutterPreparation).map(item=>clone(item.nativeSizePreparation??item.nativeCanvasGutterPreparation)),
        nativeEnvelopeValidation:clone(bottom.validation),nativeEnvelopeValidationSha256:hash(jsonBytes(bottom.validation))}:{}),
      nativeBottomSources:true,rotatedTopCap:false,sourcePngChanged:false,artAcceptance:'not-assessed'}}:{}),
    ...(dense?{materialDensity:{profile:controls.materialDensityProfile,profileSha256:density.report.profileSha256,derivationSha256:density.report.sha256,
      continuousFieldDensity:2,continuousFieldPixelsPerWorldPixel:{x:1010/512,y:506/256},sourceOriginNormalizationHeight:506,
      sourcePngModified:false,resizedLegacyField:false,nativeUpscale:false,physicalCropChanged:false,
      sourceRawSha256:batch.materialRawSha256,surfaceMappingSha256:kit.terrainAppearance.surfaceMappingSha256,
      gridTileDensity:gridEnabled?'legacy-tiles-retained-logically-rendered-through-measured-fields':'legacy-1x-phase-tiles-preserved-separately'}}:{}),
    ...(evidence.some(item=>item.nativeCanvasGutterPreparation||item.rebindPreparation)?{sourcePreparations:evidence.filter(item=>item.nativeCanvasGutterPreparation||item.rebindPreparation).map(item=>clone(item.nativeCanvasGutterPreparation??item.rebindPreparation))}:{}),
    derivedPixelPolicy:dense?'edge-zero-alpha-rgb-normalization-and-direct-native-material-density2-area-sampling':'only-zero-alpha-rgb-normalization-no-alpha-or-visible-color-changes',
    artAcceptance:'not-assessed',generationCalls:0,productionKit:false});
  put(files,'readiness.json',report);
  const bundle=seal({format:'ai_scene_terrain_edge_candidate_bundle_v1',reportSha256:report.sha256,artifacts:manifest(files),generationCalls:0,productionKit:false});
  put(files,'proof-bundle.json',bundle);return {files,bundle,report,reference:inputs.reference.raw};
}

function deliveryReport(prepared,handle,scene,zip,render,comparison,exported){
  return seal({format:'ai_scene_terrain_edge_delivery_v1',candidateBundleSha256:prepared.bundle.sha256,candidateReportSha256:prepared.report.sha256,
    edgeBatchSha256:prepared.report.edgeBatchSha256,baseKitSha256:prepared.report.baseKitSha256,kitSha256:handle.bundleSha256,
    authorSha256:scene.source.authorSha256,compiledSha256:scene.contentSha256,zip:{sha256:hash(zip),byteLength:zip.length},
    render:{sha256:hash(render),kind:'deterministic-default-scene-render-not-browser-screenshot'},
    comparison:{sha256:hash(comparison),left:'accepted-whole-reference',right:'deterministic-edge-recomposition',referencePixelsCopiedIntoAssets:0},
    export:exported,studio:{kit:'candidate/kit',document:'export/scene.document.json'},sourceOriginalsPreserved:true,
    authorGeometryChanged:false,finalHumanArtReview:'pending',productionKit:false,generationCalls:0});
}

function validateDeliveryOptions(options){
  exact(options,['workflow','baseKitRoot','batchSha256','controls','output',...(Object.hasOwn(options,'footprintPolicy')?['footprintPolicy']:[]),...(Object.hasOwn(options,'upperReplacementBatchSha256')?['upperReplacementBatchSha256']:[]),...(Object.hasOwn(options,'replacementBatchSha256s')?['replacementBatchSha256s']:[])]);
  if(Object.hasOwn(options,'upperReplacementBatchSha256'))check(/^[a-f0-9]{64}$/.test(options.upperReplacementBatchSha256),'TERRAIN_UPPER_SELECTION_BINDING');
  if(Object.hasOwn(options,'replacementBatchSha256s'))check(!Object.hasOwn(options,'upperReplacementBatchSha256')
    &&Array.isArray(options.replacementBatchSha256s)&&options.replacementBatchSha256s.length>0&&options.replacementBatchSha256s.length<=4
    &&options.replacementBatchSha256s.every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s))
    &&new Set(options.replacementBatchSha256s).size===options.replacementBatchSha256s.length
    &&!options.replacementBatchSha256s.includes(options.batchSha256),'TERRAIN_PERIMETER_SELECTION_BINDING');
  if(Object.hasOwn(options,'footprintPolicy'))check(options.footprintPolicy!==undefined,'TERRAIN_BRUSH_FOOTPRINT_POLICY');
}

export function buildTerrainEdgeDelivery(options){
  validateDeliveryOptions(options);
  check(!isWithin(resolve(dirname(options.baseKitRoot)),resolve(options.output))&&!isWithin(resolve(options.workflow),resolve(options.output)),'OUTPUT_OVERLAP');
  const prepared=preparedCandidate(options);
  const out=makeFreshDirectory(options.output,sourceRoot);writeProofBundle(join(out,'candidate'),options.workflow,prepared);
  const handle=loadSceneKit(join(out,'candidate/kit')),map=readMap(handle),scene=compileMap(handle,map),context=contextFor(handle);
  const exported=exportScene(handle,map,join(out,'export')),zip=exportSceneArchive(handle,map),render=renderCoherentFrame(scene,path=>context.files.get(path)),
    comparison=coherentComparison(prepared.reference,render);
  for(const [path,bytes]of [['scene-kit.zip',zip],['scene-preview.png',render],['reference-native.png',prepared.reference],['reference-vs-reconstruction.png',comparison]])writeFreshFile(join(out,path),bytes,sourceRoot);
  const report=deliveryReport(prepared,handle,scene,zip,render,comparison,exported);writeFreshFile(join(out,'delivery.json'),jsonBytes(report),sourceRoot);return report;
}

export function verifyTerrainEdgeDelivery(options){
  validateDeliveryOptions(options);
  const prepared=preparedCandidate(options),out=options.output;
  const report=readJson(join(out,'delivery.json'));unseal(report);verifyProofBundle(join(out,'candidate'),prepared);
  const handle=loadSceneKit(join(out,'candidate/kit')),map=readMap(handle),scene=compileMap(handle,map),context=contextFor(handle),reopened=openSceneExport(join(out,'export'));
  check(reopened.compiled.contentSha256===scene.contentSha256,'TERRAIN_EDGE_DELIVERY_EXPORT');
  const zip=exportSceneArchive(handle,map),render=renderCoherentFrame(scene,path=>context.files.get(path)),comparison=coherentComparison(prepared.reference,render);
  for(const [path,bytes]of [['scene-kit.zip',zip],['scene-preview.png',render],['reference-native.png',prepared.reference],['reference-vs-reconstruction.png',comparison]])
    check(readSelectedFile(join(out,path),268435456).equals(bytes),'TERRAIN_EDGE_DELIVERY_ARTIFACT');
  const exported={status:'export-integrity-verified',fileCount:readJson(join(out,'export/manifest.json')).files.length+1,sourceKitSha256:handle.bundleSha256,
    authorSha256:scene.source.authorSha256,contentSha256:scene.contentSha256,visualAcceptance:'not-assessed',generationCalls:0};
  check(canonicalJson(report)===canonicalJson(deliveryReport(prepared,handle,scene,zip,render,comparison,exported)),'TERRAIN_EDGE_DELIVERY_REPLAY');
  return {status:'verified',reportSha256:report.sha256,kitSha256:handle.bundleSha256,zipSha256:hash(zip),artAcceptance:'not-assessed',generationCalls:0};
}
