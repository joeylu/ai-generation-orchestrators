import { randomBytes } from 'node:crypto';
import {assertLatestDependencyBatch} from './coherent-source-dependency.mjs';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseJson,readSelectedFile} from '../files.mjs';
import { contextFor } from '../kit.mjs';
import { SIGNATURES } from '../topology.mjs';
import { compareText } from '../document.mjs';
import { transact, initWorkflow } from './store.mjs';
import {TERRAIN_EDGE_TOPOLOGY_PROFILE,TERRAIN_EDGE_TOPOLOGY_V2_PROFILE,resolveTerrainEdgeTopologyGuide} from './terrain-edge-topology-guide.mjs';
export {TERRAIN_EDGE_TOPOLOGY_PROFILE,TERRAIN_EDGE_TOPOLOGY_V2_PROFILE,terrainEdgeTopologyGuide,terrainEdgeTopologyGuideV2,resolveTerrainEdgeTopologyGuide} from './terrain-edge-topology-guide.mjs';
import { applyRecord, assessResult, compileReferenceReinspection, compileEnvironmentReinspection, reassessEntry, replay } from './model.mjs';
import { assertCurrent, compilePlan } from './compiler.mjs';
import { compileNativeReference, compileNativeReferenceEdit, nativeReferenceContent } from './native-reference.mjs';
import { compileStandardReference, standardReferenceContent, standardReferenceReviewFiles } from './standard-reference.mjs';
import { compileFlexibleReference, flexibleReferenceContent, flexibleReferenceReviewFiles, acceptedReconstructionTarget } from './flexible-reference.mjs';
import { compileReferenceInputExperiment, referenceInputExperimentRecipe } from './reference-input-experiment.mjs';
import { compileReferenceLedIsolation, referenceLedIsolationRecipe } from './reference-led-isolation.mjs';
import { validateControlReviewPacket, compileReferenceControls, controlledReferenceRecipe, compileControlledReference } from './reference-controlled.mjs';
import { referenceLedContent, compileReferenceLedPlan, compileReferenceCandidate, assessReferenceLed,
  measuredReferenceReviewFiles, acceptMeasuredReferenceTarget } from './reference-led.mjs';
import { compileSceneSource, compileSceneReference, SCENE_SOURCE_SLOTS, SCENE_SOURCE_PROFILE_SHA256 } from './scene-sources.mjs';
import { compileLayeredSceneReference, compileLayeredSceneSource } from './layered-scene.mjs';
import { compileScopedSceneSource } from './scoped-scene-source.mjs';
import { compileExplicitSceneSource, compileAlternativeSceneSource } from './explicit-scene-source.mjs';
import { compileReferenceAsset, referenceAssetInputs } from './reference-asset.mjs';
import { compileReferenceAssetEdit, compileReferenceAssetSingleInput, referenceAssetEditInputs,
  REFERENCE_LAYER_EDIT_MODE, REFERENCE_LAYER_SINGLE_INPUT_MODE } from './reference-asset-edit.mjs';
import { compileRegionGuideControls, compileRegionGuidedAsset, regionGuidedAssetInputs,
  validateRegionGuidePacket, REFERENCE_LAYER_REGION_MODE } from './reference-region.mjs';
import { compilePaintControls, compilePaintSourcePlan, validatePaintDesignPacket, compilePaintApplicationProposal } from './reference-paint.mjs';
import { paintSourceReviewFiles, paintLayerFiles } from '../reference-paint-proof.mjs';
import {COHERENT_POLICY,compileCoherentSource,compileCoherentBatch,coherentInventory,coherentSourceExtraInputs} from './coherent-source.mjs';
import {LAYER_SOURCE_INTENT,validateLayerSourceScopes,scopeForCoherentItem} from './layer-source.mjs';
export {checkReferenceObservationCoverage,assertReferenceObservationCoverage} from './reference-observation-coverage.mjs';
export {LAYER_SOURCE_INTENT,LAYER_SOURCE_POLICY,SOURCE_SHADOW_LIGHTING_PROFILE,SOURCE_GUIDED_REFERENCE_ROLE,createLayerSourceScopes,validateLayerSourceScopes,withVisualCoherenceScopes,withReferenceStructure,withReferenceFeatureCorrection,withReferenceFeatureSupplement,withSourceFrameGuide,
  withSourceVisualGuideScopes,withSourceVisualGuide,SCOPE_OWNED_GROUNDING_PROFILE,withScopeOwnedGroundingScopes,withScopeOwnedGrounding,withSourceAppearance,withSourceAppearanceScopes,withSourceFraming,COMPLETE_SOURCE_FRAMING_PROFILE,
  BACKGROUND_BAND_PROFILE,GUIDED_BACKGROUND_BAND_PROFILE,COVERAGE_BACKGROUND_BAND_PROFILE,OPEN_DEPTH_BACKGROUND_BAND_PROFILE,BACKGROUND_BAND_FINITE_CUTS_PROFILE,validateBackgroundBand,backgroundBandCoverage,withBackgroundBand,withBackgroundBandScopes,withBandFeatureRelations} from './layer-source.mjs';
export {BACKGROUND_BAND_GUIDE_PROFILE,BACKGROUND_BAND_GUIDE_IMAGE_ROLE,backgroundBandGuide} from './background-band-guide.mjs';
export {previewSourceFrameGuide,SOURCE_FRAME_GUIDE_ROLE} from './source-frame-guide.mjs';
export {SOURCE_APPEARANCE_PROFILE,SOURCE_ATMOSPHERE_PROMPT_PROFILE,validateSourceAppearance,sourceAppearancePrompt} from './source-appearance.mjs';
export {MATERIAL_SAMPLING_CONTENT_PROFILE,REGISTERED_BAND_REGISTRATION_PROFILE} from './source-content.mjs';
export {BACKGROUND_BAND_COVERAGE_GUIDE_PROFILE,BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_COVERAGE_BUDGET,backgroundBandCoverageGuide} from './background-band-coverage-guide.mjs';
export {BACKGROUND_BAND_OPEN_DEPTH_GUIDE_PROFILE,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_INSTRUCTION,backgroundBandOpenDepthGuide} from './background-band-open-depth-guide.mjs';
export {BACKGROUND_BAND_OPEN_TRENCH_GUIDE_PROFILE,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_INSTRUCTION,backgroundBandOpenTrenchGuide} from './background-band-open-trench-guide.mjs';
export {BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_PROFILE,BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_INSTRUCTION,backgroundBandIrregularValleyGuide} from './background-band-irregular-valley-guide.mjs';
export {VISUAL_COHERENCE_POLICY,createVisualCoherence,validateVisualCoherence,validateVisualObservations} from './visual-coherence.mjs';
import {coherentSceneFiles} from '../coherent-scene.mjs';
import {assertCompositionStructureCoversSources,reviewReferenceFeatureLayout} from '../reference-feature-layout.mjs';
import {validateCoherentComposition} from '../coherent-composition.mjs';
import {assertCandidateBandRelationReviews,assertCandidateBandGuideReviews,assertBandReviewObservationsAgree,assertBandGuideWorldPlacement} from './band-feature-relation-gate.mjs';
import {reviewBandFeatureRelations} from './band-feature-relation-review.mjs';
import {reviewBandGuide} from './band-guide-review.mjs';
export {createBackgroundBandPlacement,validateBackgroundBandPlacement} from '../background-band-placement.mjs';
import {compileCoherentReference,coherentReferenceGuides} from './coherent-reference.mjs';
import {compileCoherentReferenceV2,coherentReferenceGuidesV2} from './coherent-reference-v2.mjs';
import {compileCoherentReferenceV3} from './coherent-reference-v3.mjs';
import {compileCompositionGuide} from './composition-guide.mjs';
import {compileCoherentBorderProposal,compileCoherentBorderPreparation} from './coherent-border.mjs';
import {compileCoherentCanvasGutterProposal,compileCoherentCanvasGutterPreparation} from './coherent-canvas-gutter.mjs';
import {COHERENT_NATIVE_FRAME_FORMAT,compileCoherentNativeFrameProposal,compileCoherentNativeFramePreparation,reviewNativeFrameBands} from './coherent-native-frame.mjs';
import {compileCoherentRebindRecord,compileCoherentRebindProposal,exportCoherentRebindEvidence,proposeCoherentRebind as proposeRebind} from './coherent-rebind-evidence.mjs';
export {exportCoherentRebindEvidence,proposeCoherentRebind} from './coherent-rebind-evidence.mjs';
export {COHERENT_CANVAS_GUTTER_FORMAT,COHERENT_CANVAS_GUTTER_V2_FORMAT,COHERENT_CANVAS_GUTTER_V2_PROFILE} from './coherent-canvas-gutter.mjs';
import {compileTerrainEdgeSource,compileTerrainEdgeBatch,TERRAIN_EDGE_POLICY,ENGINEERED_CITY_TERRAIN_EDGE_POLICY,TERRAIN_BOTTOM_EDGE_ROLES,
  TERRAIN_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY,TERRAIN_PERIMETER_COVERAGE_PROFILE,TERRAIN_EDGE_BATCH_FORMATS,
  TERRAIN_NATIVE_SIZE_PROFILE,TERRAIN_NATIVE_RENDER_ENVELOPE_PROFILE,TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,
  TERRAIN_REFERENCE_DEFINED_COVER_PROFILE,TERRAIN_REFERENCE_DEFINED_COVER_POLICY,TERRAIN_LOWER_BODY_PROFILE} from './terrain-edge-source.mjs';
export {TERRAIN_EDGE_POLICY,ENGINEERED_CITY_TERRAIN_EDGE_POLICY,TERRAIN_EDGE_ROLES,TERRAIN_BOTTOM_EDGE_ROLES,TERRAIN_PERIMETER_ROLES,
  TERRAIN_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY,TERRAIN_PERIMETER_COVERAGE_PROFILE,
  TERRAIN_NATIVE_SIZE_PROFILE,TERRAIN_NATIVE_RENDER_ENVELOPE_PROFILE,TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,
  TERRAIN_REFERENCE_DEFINED_COVER_PROFILE,TERRAIN_REFERENCE_DEFINED_COVER_POLICY,TERRAIN_LOWER_BODY_PROFILE} from './terrain-edge-source.mjs';
import {compileTerrainEdgeNativeSizeProposal,compileTerrainEdgeNativeSizePreparation,
  compileTerrainEdgePreparedBatch} from './terrain-edge-native-size.mjs';
import {compileTerrainEdgeCanvasGutterProposal,compileTerrainEdgeCanvasGutterPreparation,
  compileTerrainEdgeCanvasGutterBatch,assertTerrainEdgeCanvasGutterParent,TERRAIN_EDGE_AUTO_GUTTER_PROFILE,
  TERRAIN_EDGE_CANVAS_GUTTER_RULE,TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT} from './terrain-edge-canvas-gutter.mjs';
import {compileTerrainEdgeRecoveryPlan,compileTerrainEdgeRecoveryBatch,TERRAIN_EDGE_RECOVERY_BATCH_FORMAT,assertTerrainEdgeRecoveryConfirmation} from './terrain-edge-recovery.mjs';
export {TERRAIN_EDGE_RECOVERY_BATCH_FORMAT} from './terrain-edge-recovery.mjs';
import {exportTerrainEdgeRebindEvidence,proposeTerrainEdgeRebind as proposeEdgeRebind,compileTerrainEdgeRebindRecord,compileTerrainEdgeRebindBatch} from './terrain-edge-rebind.mjs';
export {exportTerrainEdgeRebindEvidence,proposeTerrainEdgeRebind} from './terrain-edge-rebind.mjs';
export {TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT,TERRAIN_EDGE_CANVAS_GUTTER_RULE} from './terrain-edge-canvas-gutter.mjs';
export {TERRAIN_EDGE_NATIVE_SIZE_FORMAT,TERRAIN_EDGE_PREPARED_BATCH_FORMAT,TERRAIN_EDGE_NATIVE_SIZE_RULE} from './terrain-edge-native-size.mjs';
import { materialPaintReviewFiles } from '../reference-paint-material-proof.mjs';
import { compileMaterialControls, validateMaterialDesignPacket, compileMaterialPaintPlan,
  compileMaterialCoverageProposal, validateMaterialCoverage, materialApplicationProposal } from './reference-paint-material.mjs';
import { compileSourceRecoveryProposal, compileSourceRecovery } from './source-recovery.mjs';
import { compileNativeBorderPolicy, compileNativeBorderFuturePolicy, compileNativeBorderPreparation } from './native-border.mjs';
import { assembleSceneSourceFiles } from '../source-scene.mjs';
import { sourceCompositionFiles } from '../source-composition.mjs';
import { compileTerrainMaterial } from './terrain-material.mjs';
import { compileEnvironmentSource, compileEnvironmentSourceV2, compileEnvironmentSupplement } from './environment-source.mjs';
import { compileEnvironmentPadding, compilePaddingProposal } from './environment-padding.mjs';
import { compileSupplementPadding, compileSupplementPaddingProposal } from './environment-supplement-padding.mjs';
import { environmentProofFiles } from '../environment-proof.mjs';
import { finiteEnvironmentFiles } from '../finite-environment.mjs';
import { sceneCandidateFiles } from '../candidate-kit.mjs';
import { reviewCandidateFiles, REVIEW_ROLES } from '../review-candidate.mjs';
import { referenceSceneFiles } from '../reference-scene.mjs';
import { supplementSceneFiles, SUPPLEMENT_SCENE_ROLES } from '../supplement-scene.mjs';
import { referenceFieldStudyFiles } from '../terrain-proof/bundle.mjs';
import { TERRAIN_PROOF_SHA256 } from '../terrain-proof/profile.mjs';
import { createTerrainStudyPreview } from '../terrain-proof/preview.mjs';
import { continuityStudyFiles, longFieldStudyFiles, moduleStudyFiles, proofFiles, proofRevisionFiles, verifyProofBundle, writeProofBundle } from '../terrain-proof/bundle.mjs';
import { check, clone, deepFreeze, digest, exact, hash, id, imageRef, isDigest, seal, verifyImage } from './common.mjs';

export { initWorkflow };
export { ENVIRONMENT_SOURCE_PROFILE, ENVIRONMENT_SOURCE_PROFILE_SHA256, ENVIRONMENT_SOURCE_PROFILE_V2,
  ENVIRONMENT_SOURCE_PROFILE_V2_SHA256 } from './environment-source.mjs';
const run = (root, operation) => transact(root, store => operation(store, replay(store)));
const detached = value => deepFreeze(clone(value));
function commit(store, state, record) { applyRecord(store, state, record); store.append(record); return detached(record); }
function entryFor(state, sha256) { const entry = state.plans.get(sha256); check(entry, 'PLAN_MISSING'); return entry; }
function derivedId(prefix, parts) {
  const candidate = parts.join('.');
  return candidate.length <= 100 ? candidate : `${prefix}.${digest(parts)}`;
}

export function importWorkflowImage(root, bytes) {
  return run(root, store => { const ref = imageRef(bytes); store.storeBlob(bytes); return detached(ref); });
}
export const importStandardWorkflowImage = (root, bytes) => run(root, store => {
  const ref = imageRef(bytes, { allowCabx: true }); store.storeBlob(bytes); return detached(ref);
});
export const readWorkflowImage = (root, ref) => run(root, store => verifyImage(store, ref));
export const readStandardWorkflowImage = (root, ref) => run(root, store => verifyImage(store, ref, { allowCabx: true }));
export function createDesignDraft(root, value) {
  check(['ai_scene_spec_v1', 'ai_scene_spec_v2', 'ai_scene_spec_v3', 'ai_scene_style_v1', 'ai_scene_style_v2', 'ai_scene_image_capabilities_v1'].includes(value?.format), 'DRAFT_FORMAT');
  return run(root, (store, state) => commit(store, state, seal(value)));
}
export function reviewDesign(root, kind, decision) {
  return run(root, (store, state) => commit(store, state, seal({ format: 'ai_scene_design_review_v1', kind, receipt: decision })));
}
export function reviewSceneDesigns(root, decisions) {
  exact(decisions, ['spec', 'style']);
  return run(root, (store, state) => {
    const records = ['spec', 'style'].map(kind => seal({ format: 'ai_scene_design_review_v1', kind, receipt: decisions[kind] }));
    for (const record of records) applyRecord(store, state, record);
    for (const record of records) store.append(record);
    return detached(records);
  });
}
export function freezeReferencePlan(root, options) {
  return run(root, (store, state) => {
    exact(options, ['planId', 'parents', 'capabilitiesSha256', 'pixelSize', 'intent']);
    const plan = compilePlan(state, { ...options, stage: 'reference', specSha256: state.activeSpec, styleSha256: state.activeStyle,
      referencePlans: [], inventoryRefs: [], assetId: 'scene-reference' });
    return commit(store, state, plan);
  });
}
export function previewNativeReference(root, options) {
  return run(root, (store, state) => {
    check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
    const content = nativeReferenceContent(state, options);
    const reviews = [options.specSha256, options.styleSha256].map(sha256 => state.designReviews.get(sha256)?.receipt.decision ?? 'pending');
    return detached(seal({ format: 'ai_scene_reference_proposal_v1', status: 'proposal-only', sources: options,
      designReviewStatus: { spec: reviews[0], style: reviews[1] }, executable: false, ...content,
      requestSha256: digest(content.request), coreProviderCalls: 0 }));
  });
}
export function freezeNativeReferencePlan(root, options) {
  return run(root, (store, state) => {
    check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
    exact(options, ['planId', 'parents', 'capabilitiesSha256', 'pixelPolicy', 'intent']);
    const plan = compileNativeReference(state, { ...options, stage: 'reference', specSha256: state.activeSpec, styleSha256: state.activeStyle,
      referencePlans: [], inventoryRefs: [], assetId: 'scene-reference' });
    return commit(store, state, plan);
  });
}
export const previewStandardReference = (root, options) => run(root, (store, state) => {
  check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
  const content = options.blueprint?.format === 'ai_scene_reference_blueprint_v2' ? flexibleReferenceContent(state, options) : standardReferenceContent(state, options);
  return detached(seal({ format: 'ai_scene_standard_reference_proposal_v1', status: 'proposal-only', sources: options,
    executable: false, generationCalls: 0, ...content, requestSha256: digest(content.request) }));
});
export const freezeStandardReferencePlan = (root, options) => run(root, (store, state) => {
  check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
  exact(options, ['planId', 'parents', 'capabilitiesSha256', 'pixelPolicy', 'blueprint', 'intent']);
  const compile = options.blueprint?.format === 'ai_scene_reference_blueprint_v2' ? compileFlexibleReference : compileStandardReference;
  return commit(store, state, compile(state, { ...options, stage: 'reference', specSha256: state.activeSpec,
    styleSha256: state.activeStyle, referencePlans: [], inventoryRefs: [], assetId: 'scene-reference' }));
});
function preparedStandardReference(store, state, planSha256, observation) {
  const entry = entryFor(state, planSha256); assertCurrent(state, entry.plan);
  check(entry.result, 'RESULT_REQUIRED');
  const prepare = ['ai_scene_generation_plan_v16', 'ai_scene_generation_plan_v17'].includes(entry.plan.format) ? flexibleReferenceReviewFiles : standardReferenceReviewFiles;
  return prepare({ ...entry, bytes: store.readBlob(entry.result.rawSha256) }, observation);
}
export const buildStandardReferenceReview = (root, planSha256, observation, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedStandardReference(store, state, planSha256, observation))));
export const verifyStandardReferenceReview = (root, planSha256, observation, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedStandardReference(store, state, planSha256, observation))));
export const reviewStandardReference = (root, planSha256, observation, receipt) => run(root, (store, state) => {
  const prepared = preparedStandardReference(store, state, planSha256, observation);
  const flexible = Boolean(prepared.candidate);
  return commit(store, state, seal({ format: flexible ? 'ai_scene_standard_reference_review_v2' : 'ai_scene_standard_reference_review_v1', planSha256,
    packetSha256: prepared.report.sha256, observation, receipt,
    ...(flexible ? { reconstructionTarget: receipt.decision === 'accept' ? acceptedReconstructionTarget(prepared, receipt) : null } : {}) }));
});
export const getReferenceReconstructionTarget = (root, planSha256) => run(root, (_store, state) => {
  const entry = entryFor(state, planSha256); assertCurrent(state, entry.plan);
  check(entry.status === 'accepted' && entry.reconstructionTarget, 'RECONSTRUCTION_TARGET_NOT_ACCEPTED');
  return detached(entry.reconstructionTarget);
});
function referenceAssetRecipe(state, options, asset) {
  const region = options.mode === REFERENCE_LAYER_REGION_MODE;
  const edit = [REFERENCE_LAYER_EDIT_MODE, REFERENCE_LAYER_SINGLE_INPUT_MODE, REFERENCE_LAYER_REGION_MODE].includes(options.mode);
  exact(asset, ['planId', 'parents', 'instanceId', 'subjectBrief', 'intent', ...(edit ? ['clippedEdges'] : []), ...(region ? ['regionControlsSha256'] : [])]);
  return { planId: asset.planId, parents: asset.parents, stage: 'reference-asset', specSha256: state.activeSpec,
    styleSha256: state.activeStyle, capabilitiesSha256: options.capabilitiesSha256, referencePlans: [options.referencePlanSha256],
    inventoryRefs: [], assetId: asset.instanceId, targetSha256: options.targetSha256, subjectBrief: asset.subjectBrief, intent: asset.intent,
    ...(edit ? { mode: options.mode, clippedEdges: asset.clippedEdges } : {}),
    ...(region ? { regionControlsSha256: asset.regionControlsSha256 } : {}) };
}
function assetPlans(store, state, options) {
  exact(options, ['batchId', 'referencePlanSha256', 'targetSha256', 'capabilitiesSha256', 'assets', ...(Object.hasOwn(options, 'mode') ? ['mode'] : [])]);
  check(!Object.hasOwn(options, 'mode') || [REFERENCE_LAYER_EDIT_MODE, REFERENCE_LAYER_SINGLE_INPUT_MODE, REFERENCE_LAYER_REGION_MODE].includes(options.mode), 'REFERENCE_ASSET_MODE'); id(options.batchId);
  check(Array.isArray(options.assets) && options.assets.length > 0 && options.assets.length <= 24, 'REFERENCE_ASSET_BATCH');
  const compile = options.mode === REFERENCE_LAYER_REGION_MODE ? compileRegionGuidedAsset
    : options.mode === REFERENCE_LAYER_SINGLE_INPUT_MODE ? compileReferenceAssetSingleInput
    : options.mode === REFERENCE_LAYER_EDIT_MODE ? compileReferenceAssetEdit : compileReferenceAsset;
  const plans = options.assets.map(a => compile(state, referenceAssetRecipe(state, options, a), sha => store.readBlob(sha)));
  check(new Set(plans.map(p => p.recipe.assetId)).size === plans.length, 'REFERENCE_ASSET_BATCH');
  return plans;
}
export const previewReferenceAssets = (root, options) => run(root, (store, state) => {
  const plans = assetPlans(store, state, options);
  return detached(seal({ format: options.mode === REFERENCE_LAYER_REGION_MODE ? 'ai_scene_reference_asset_proposal_v4'
    : options.mode === REFERENCE_LAYER_SINGLE_INPUT_MODE ? 'ai_scene_reference_asset_proposal_v3'
    : options.mode ? 'ai_scene_reference_asset_proposal_v2' : 'ai_scene_reference_asset_proposal_v1', batchId: options.batchId, plans,
    executable: false, generationCalls: 0, maximumNewImageCalls: plans.length }));
});
export const freezeReferenceAssets = (root, options) => run(root, (store, state) => {
  const plans = assetPlans(store, state, options);
  for (const plan of plans) {
    const inputs = (options.mode === REFERENCE_LAYER_REGION_MODE ? regionGuidedAssetInputs
      : options.mode ? referenceAssetEditInputs : referenceAssetInputs)(state, plan, sha => store.readBlob(sha));
    inputs.forEach((bytes, i) => { check(hash(bytes) === plan.request.images[i].artifact.sha256, 'REFERENCE_ASSET_INPUT'); store.storeBlob(bytes); });
  }
  const batch = seal({ format: options.mode === REFERENCE_LAYER_REGION_MODE ? 'ai_scene_reference_asset_batch_v4'
    : options.mode === REFERENCE_LAYER_SINGLE_INPUT_MODE ? 'ai_scene_reference_asset_batch_v3'
    : options.mode ? 'ai_scene_reference_asset_batch_v2' : 'ai_scene_reference_asset_batch_v1', batchId: options.batchId,
    referencePlanSha256: options.referencePlanSha256, targetSha256: options.targetSha256, planSha256s: plans.map(p => p.sha256),
    maximumCalls: plans.length, automaticRetry: false, scope: 'listed-reference-instances-only' });
  for (const record of [...plans, batch]) applyRecord(store, state, record);
  for (const record of [...plans, batch]) store.append(record);
  return detached(batch);
});
export const getReferenceAssetBatch = (root, sha) => run(root, (_store, state) => {
  const batch = state.batches.get(sha); check(['ai_scene_reference_asset_batch_v1', 'ai_scene_reference_asset_batch_v2', 'ai_scene_reference_asset_batch_v3', 'ai_scene_reference_asset_batch_v4'].includes(batch?.format), 'REFERENCE_ASSET_BATCH'); return detached(batch);
});
function coherentRecords(store,state,options){
  const scoped=Object.hasOwn(options,'sourceScopes');exact(options,['batchId','referencePlanSha256','capabilitiesSha256',...(scoped?['sourceScopes']:[])]);
  const ref=entryFor(state,options.referencePlanSha256),spec=state.designs.get(ref.plan.recipe.specSha256);
  if(scoped)validateLayerSourceScopes(spec.requirements,options.sourceScopes);
  const plans=coherentInventory(ref,spec).map((item,index)=>compileCoherentSource(state,{planId:`${options.batchId}.s${index}`,parents:[],stage:'coherent-source',
    specSha256:state.activeSpec,styleSha256:state.activeStyle,capabilitiesSha256:options.capabilitiesSha256,referencePlans:[options.referencePlanSha256],
    inventoryRefs:[],assetId:item.assetId,targetSha256:ref.reconstructionTarget.sha256,policySha256:COHERENT_POLICY.sha256,intent:scoped?LAYER_SOURCE_INTENT:'',
    ...(scoped?{sourceScope:scopeForCoherentItem(spec.requirements,options.sourceScopes,item)}:{})},sha=>store.readBlob(sha)));
  const temporary={...state,plans:new Map([...state.plans,...plans.map(plan=>[plan.sha256,{plan,status:'planned'}])])};
  const batch=compileCoherentBatch(temporary,{batchId:options.batchId,referencePlanSha256:options.referencePlanSha256,
    planSha256s:plans.map(p=>p.sha256),parentBatchSha256:null});return {plans,batch};
}
export const previewCoherentSources=(root,options)=>run(root,(store,state)=>detached(seal({format:'ai_scene_coherent_source_proposal_v1',
  ...coherentRecords(store,state,options),generationCalls:0,executable:false})));
function commitCoherentSourceRecords(store,state,plans,batch){
  const guides=new Map();
  for(const plan of plans)for(const [index,bytes]of coherentSourceExtraInputs(plan,sha=>store.readBlob(sha)).entries()){
    const ref=plan.request.images[index+1].artifact;check(hash(bytes)===ref.sha256&&bytes.length===ref.byteLength,'SOURCE_VISUAL_GUIDE_INPUT');guides.set(ref.sha256,bytes);
  }
  const dryStore=guides.size?{...store,readBlob:sha=>guides.has(sha)?Buffer.from(guides.get(sha)):store.readBlob(sha)}:store;
  for(const record of [...plans,batch])applyRecord(dryStore,state,record);
  for(const bytes of guides.values())store.storeBlob(bytes);
  for(const record of [...plans,batch])store.append(record);
}
export const freezeCoherentSources=(root,options)=>run(root,(store,state)=>{
  const {plans,batch}=coherentRecords(store,state,options);
  commitCoherentSourceRecords(store,state,plans,batch);return detached(batch);
});
export const getCoherentSourceBatch=(root,sha)=>run(root,(_store,state)=>{
  const batch=state.batches.get(sha);check(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(batch?.format),'COHERENT_BATCH_REQUIRED');return detached(batch);
});
function terrainEdgeRecords(store,state,options){
  const manufactured=Object.hasOwn(options,'manufacturedMaterialProfile');
  const gutter=Object.hasOwn(options,'gutterPolicy');
  const engineered=Object.hasOwn(options,'surfaceFamily'),perimeter=Object.hasOwn(options,'coverageProfile'),replacement=Object.hasOwn(options,'coverageIntent'),
    native=Object.hasOwn(options,'nativeSizeProfile'),render=Object.hasOwn(options,'renderEnvelopeProfile'),cover=Object.hasOwn(options,'naturalSurfaceProfile'),guided=Object.hasOwn(options,'topologyGuideProfile'),lowerBody=Object.hasOwn(options,'lowerBodyProfile');
  exact(options,['batchId','baseBatchSha256','capabilitiesSha256','items',...(engineered?['surfaceFamily']:[]),
    ...(perimeter?['coverageProfile']:[]),...(replacement?['coverageIntent']:[]),...(native?['nativeSizeProfile']:[]),...(render?['renderEnvelopeProfile']:[]),
    ...(cover?['naturalSurfaceProfile']:[]),...(guided?['topologyGuideProfile']:[]),...(lowerBody?['lowerBodyProfile']:[]),
    ...(manufactured?['manufacturedMaterialProfile']:[]),...(gutter?['gutterPolicy']:[])]);id(options.batchId);
  check(!guided||cover&&[TERRAIN_EDGE_TOPOLOGY_PROFILE,TERRAIN_EDGE_TOPOLOGY_V2_PROFILE].includes(options.topologyGuideProfile),'TERRAIN_EDGE_TOPOLOGY_PROFILE');
  check(!lowerBody||cover&&options.lowerBodyProfile===TERRAIN_LOWER_BODY_PROFILE,'TERRAIN_EDGE_LOWER_BODY_PROFILE');
  check(!engineered||options.surfaceFamily==='engineered-city','TERRAIN_EDGE_SURFACE_FAMILY');
  check(!perimeter||options.coverageProfile===TERRAIN_PERIMETER_COVERAGE_PROFILE,'TERRAIN_EDGE_COVERAGE_PROFILE');
  check(!replacement||perimeter&&options.coverageIntent==='explicit-subset-replacement','TERRAIN_EDGE_COVERAGE_INTENT');
  check(!native||perimeter&&options.nativeSizeProfile===TERRAIN_NATIVE_SIZE_PROFILE,'TERRAIN_EDGE_NATIVE_SIZE_PROFILE');
  check(native?render&&options.renderEnvelopeProfile===TERRAIN_NATIVE_RENDER_ENVELOPE_PROFILE:!render,'TERRAIN_EDGE_RENDER_ENVELOPE_PROFILE');
  check(!cover||!engineered&&perimeter&&native&&options.naturalSurfaceProfile===TERRAIN_REFERENCE_DEFINED_COVER_PROFILE,
    'TERRAIN_EDGE_NATURAL_SURFACE_PROFILE');
  check(Array.isArray(options.items)&&options.items.length>0&&options.items.length<=(perimeter?7:4),'TERRAIN_EDGE_BATCH');
  const policy=cover?TERRAIN_REFERENCE_DEFINED_COVER_POLICY:native?(engineered?ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY:TERRAIN_NATIVE_SIZE_PERIMETER_POLICY)
    :perimeter?(engineered?ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY:TERRAIN_PERIMETER_POLICY)
    :(engineered?ENGINEERED_CITY_TERRAIN_EDGE_POLICY:TERRAIN_EDGE_POLICY);
  const base=state.batches.get(options.baseBatchSha256);
  check(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(base?.format),'TERRAIN_EDGE_BASE');
  const ref=entryFor(state,base.referencePlanSha256),material=base.planSha256s.map(sha=>entryFor(state,sha)).find(entry=>entry.plan.instanceBinding?.role==='material');
  check(material?.result,'TERRAIN_EDGE_MATERIAL');
  const plans=options.items.map(item=>{
    exact(item,['assetId','role','content','exclusions',...(Object.hasOwn(item,'sourceAppearance')?['sourceAppearance']:[])]);
    return compileTerrainEdgeSource(state,{planId:derivedId('terrain.edge',[options.batchId,item.role]),parents:[],stage:'terrain-edge-source',
      specSha256:state.activeSpec,styleSha256:state.activeStyle,capabilitiesSha256:options.capabilitiesSha256,
      referencePlans:[ref.plan.sha256],inventoryRefs:[],assetId:item.assetId,targetSha256:ref.reconstructionTarget?.sha256,
      baseBatchSha256:base.sha256,materialPlanSha256:material.plan.sha256,materialRawSha256:material.result.rawSha256,
      policySha256:policy.sha256,...(perimeter?{coverageProfile:options.coverageProfile}:{}),
      ...(native?{nativeSizeProfile:options.nativeSizeProfile,renderEnvelopeProfile:options.renderEnvelopeProfile}:{}),
      ...(manufactured?{manufacturedMaterialProfile:options.manufacturedMaterialProfile}:{}),
      ...(gutter?{gutterPolicy:options.gutterPolicy}:{}),
      ...(cover?{naturalSurfaceProfile:options.naturalSurfaceProfile}:{}),
      ...(guided?{topologyGuideProfile:options.topologyGuideProfile}:{}),
      ...(lowerBody&&TERRAIN_BOTTOM_EDGE_ROLES.includes(item.role)?{lowerBodyProfile:options.lowerBodyProfile}:{}),
      ...(Object.hasOwn(item,'sourceAppearance')?{sourceAppearance:item.sourceAppearance}:{}),
      ...(engineered?{surfaceFamily:options.surfaceFamily}:{}),edgeRole:item.role,subjectBrief:{content:item.content,exclusions:item.exclusions}},sha=>store.readBlob(sha));
  });
  const temporary={...state,plans:new Map([...state.plans,...plans.map(plan=>[plan.sha256,{plan,status:'planned'}])])};
  const batch=compileTerrainEdgeBatch(temporary,{batchId:options.batchId,baseBatchSha256:base.sha256,planSha256s:plans.map(plan=>plan.sha256),
    ...(replacement?{coverageIntent:options.coverageIntent}:{})});
  return {plans,batch};
}
const terrainEdgeProposal=(store,state,options)=>seal({format:'ai_scene_terrain_edge_proposal_v1',
  ...terrainEdgeRecords(store,state,options),generationCalls:0,executable:false});
export const previewTerrainEdgeSources=(root,options)=>run(root,(store,state)=>detached(terrainEdgeProposal(store,state,options)));
export const freezeTerrainEdgeSources=(root,options,{proposalSha256}={})=>run(root,(store,state)=>{
  const {plans,batch,sha256}=terrainEdgeProposal(store,state,options);
  check(proposalSha256===undefined||proposalSha256===sha256,'TERRAIN_PERIMETER_PROPOSAL_CHANGED');
  for(const plan of plans)if(plan.recipe.topologyGuideProfile){const guide=resolveTerrainEdgeTopologyGuide(plan.recipe.topologyGuideProfile,plan.recipe.edgeRole);
    check(guide.artifact.sha256===plan.request.images[2].artifact.sha256,'TERRAIN_EDGE_TOPOLOGY_GUIDE');store.storeBlob(guide.bytes);}
  for(const record of [...plans,batch])applyRecord(store,state,record);
  for(const record of [...plans,batch])store.append(record);return detached(batch);
});
export const previewTerrainEdgeRecovery=(root,options)=>run(root,(store,state)=>{
  const plan=compileTerrainEdgeRecoveryPlan(state,options,sha=>store.readBlob(sha)),temporary={...state,plans:new Map(state.plans)};
  temporary.plans.set(plan.sha256,{plan,status:'planned'});
  const batch=compileTerrainEdgeRecoveryBatch(temporary,{parentBatchSha256:options.parentBatchSha256,failedPlanSha256:options.failedPlanSha256,
    replacementPlanSha256:plan.sha256,batchId:options.batchId,
    ...(Object.hasOwn(options,'terminalSha256')?{terminalSha256:options.terminalSha256}:{})});
  return detached(seal({format:'ai_scene_terrain_edge_recovery_proposal_v1',plan,batch,generationCalls:0,executable:false}));
});
export const freezeTerrainEdgeRecovery=(root,options)=>run(root,(store,state)=>{
  const plan=compileTerrainEdgeRecoveryPlan(state,options,sha=>store.readBlob(sha)),existing=state.plans.get(plan.sha256);
  if(existing)check(existing.status==='planned'&&digest(existing.plan)===digest(plan),'TERRAIN_EDGE_RECOVERY_PARTIAL');
  else applyRecord(store,state,plan);
  const batch=compileTerrainEdgeRecoveryBatch(state,{parentBatchSha256:options.parentBatchSha256,failedPlanSha256:options.failedPlanSha256,
    replacementPlanSha256:plan.sha256,batchId:options.batchId,
    ...(Object.hasOwn(options,'terminalSha256')?{terminalSha256:options.terminalSha256}:{})});
  applyRecord(store,state,batch);if(!existing)store.append(plan);store.append(batch);return detached(batch);
});
export const getTerrainEdgeSourceBatch=(root,sha)=>run(root,(_store,state)=>{
  const batch=state.batches.get(sha);check(TERRAIN_EDGE_BATCH_FORMATS.includes(batch?.format),'TERRAIN_EDGE_BATCH');return detached(batch);
});
function edgeRebindCommit(root,options,withBatch){
  exact(options,['sourceWorkflow','sourcePlanSha256','parentBatchSha256','targetPlanSha256','rebindId',...(withBatch?['batchId']:[]),'proposal','receipt']);
  const {evidence,originalRaw,bytes}=exportTerrainEdgeRebindEvidence(options.sourceWorkflow,options.sourcePlanSha256);
  return run(root,(store,state)=>{
    let entry=[...state.plans.values()].find(e=>e.kind==='terrain-edge-rebind'&&e.plan.parentBatchSha256===options.parentBatchSha256&&e.plan.targetPlanSha256===options.targetPlanSha256);
    let record=entry?.plan;
    if(record){
      check(record.recipe.planId===options.rebindId&&digest(record.sourceEvidence)===digest(evidence)&&record.rawSha256===hash(bytes)
        &&record.originalRawSha256===hash(originalRaw)&&digest(record.proposal)===digest(options.proposal)&&digest(record.receipt)===digest(options.receipt),'EDGE_REBIND_RECOVERY_MISMATCH');
      check(store.readBlob(record.rawSha256).equals(bytes)&&store.readBlob(record.originalRawSha256).equals(originalRaw),'EDGE_REBIND_RECOVERY_MISMATCH');
      if(!withBatch)return detached(record);
      const done=[...state.batches.values()].find(b=>b.format==='ai_scene_terrain_edge_rebind_batch_v1'&&b.rebindSha256===record.sha256);
      if(done){check(done.batchId===options.batchId&&done.parentBatchSha256===options.parentBatchSha256,'EDGE_REBIND_RECOVERY_MISMATCH');return detached({record,batch:done});}
    }else{
      record=compileTerrainEdgeRebindRecord(state,{rebindId:options.rebindId,parentBatchSha256:options.parentBatchSha256,targetPlanSha256:options.targetPlanSha256,
        evidence,originalRaw,bytes,proposal:options.proposal,receipt:options.receipt});
      const dry={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):sha===record.originalRawSha256?Buffer.from(originalRaw):store.readBlob(sha)};
      applyRecord(dry,state,record);
      // Ensure both records validate before the first append. A later write
      // failure may still leave the first event, so exact recovery is allowed.
      if(withBatch){const next=compileTerrainEdgeRebindBatch(state,{parentBatchSha256:options.parentBatchSha256,rebindSha256:record.sha256,batchId:options.batchId});applyRecord(dry,state,next);}
      store.storeBlob(originalRaw);store.storeBlob(bytes);store.append(record);
      if(!withBatch)return detached(record);
      // Dry validation advanced the in-memory state; the validated child is
      // exactly the new batch keyed by the requested id.
      const batch=[...state.batches.values()].find(b=>b.batchId===options.batchId&&b.rebindSha256===record.sha256);
      check(batch,'EDGE_REBIND_BATCH');store.append(batch);return detached({record,batch});
    }
    const batch=compileTerrainEdgeRebindBatch(state,{parentBatchSha256:options.parentBatchSha256,rebindSha256:record.sha256,batchId:options.batchId});
    applyRecord(store,state,batch);store.append(batch);return detached({record,batch});
  });
}
export const prepareTerrainEdgeRebind=(root,options)=>edgeRebindCommit(root,options,false);
export const adoptTerrainEdgeRebind=(root,options)=>edgeRebindCommit(root,options,true);
export const getTerrainEdgeInputs=(root,batchSha256)=>run(root,(store,state)=>{
  const batch=state.batches.get(batchSha256);check(TERRAIN_EDGE_BATCH_FORMATS.includes(batch?.format),'TERRAIN_EDGE_BATCH');
  const sources=batch.planSha256s.map(sha=>{
    const entry=entryFor(state,sha);assertCurrent(state,entry.plan);
    check(['pending-visual-review','accepted'].includes(entry.status)&&entry.result?.technical.status==='pass','TERRAIN_EDGE_SOURCES_INCOMPLETE');
    const preparation=['terrain-edge-native-size-preparation','terrain-edge-canvas-gutter-preparation'].includes(entry.kind)?{record:detached(entry.plan),
      originalPlan:detached(entryFor(state,entry.plan.sourcePlanSha256).plan),originalResult:detached(entryFor(state,entry.plan.sourcePlanSha256).result),
      originalRaw:store.readBlob(entry.plan.originalRawSha256)}:null;
    const rebind=entry.kind==='terrain-edge-rebind'?{record:detached(entry.plan),originalRaw:store.readBlob(entry.plan.originalRawSha256)}:null;
    return {plan:detached(entry.plan),result:detached(entry.result),raw:store.readBlob(entry.result.rawSha256),status:entry.status,...(preparation?{preparation}:{}),...(rebind?{rebind}:{}),
      ...(entry.review?{review:detached(entry.review)}:{})};
  });
  const ref=entryFor(state,batch.referencePlanSha256),material=entryFor(state,batch.materialPlanSha256);
  const parentBatch=batch.format==='ai_scene_terrain_edge_rebind_batch_v1'?state.batches.get(batch.parentBatchSha256):null;
  if(batch.format==='ai_scene_terrain_edge_rebind_batch_v1')check(parentBatch,'EDGE_REBIND_PARENT');
  return {batch:detached(batch),...(parentBatch?{parentBatch:detached(parentBatch)}:{}),reference:{plan:detached(ref.plan),raw:store.readBlob(ref.result.rawSha256),target:detached(ref.reconstructionTarget)},
    material:{plan:detached(material.plan),raw:store.readBlob(material.result.rawSha256),result:detached(material.result)},sources};
});
export const proposeTerrainEdgeCanvasGutterPreparation=(root,sourcePlanSha256,parentBatchSha256)=>run(root,(store,state)=>{
  const {proposal,bytes,previews}=compileTerrainEdgeCanvasGutterProposal(store,state,sourcePlanSha256,parentBatchSha256);
  return {proposal:detached(proposal),bytes,previews};
});
export const prepareTerrainEdgeCanvasGutterSource=(root,options)=>run(root,(store,state)=>{
  const {record,bytes}=compileTerrainEdgeCanvasGutterPreparation(store,state,options);
  const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):store.readBlob(sha)};
  applyRecord(dryStore,state,record);store.storeBlob(bytes);store.append(record);return detached(record);
});
export const adoptTerrainEdgeCanvasGutterSource=(root,parentBatchSha256,preparationSha256,batchId)=>run(root,(store,state)=>
  commit(store,state,compileTerrainEdgeCanvasGutterBatch(state,{parentBatchSha256,preparationSha256,batchId})));
export const prepareAndAdoptTerrainEdgeCanvasGutterSource=(root,options)=>run(root,(store,state)=>{
  exact(options,['preparationId','proposal','receipt','parentBatchSha256','batchId']);id(options.batchId);
  check(options.proposal?.parentBatchSha256===options.parentBatchSha256,'TERRAIN_EDGE_CANVAS_GUTTER_BATCH');
  const {record,bytes}=compileTerrainEdgeCanvasGutterPreparation(store,state,{preparationId:options.preparationId,proposal:options.proposal,receipt:options.receipt});
  return commitTerrainEdgeCanvasGutter(store,state,{record,bytes},options.parentBatchSha256,options.batchId);
});
function commitTerrainEdgeCanvasGutter(store,state,{record,bytes},parentBatchSha256,batchId){
  const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):store.readBlob(sha)};
  const pending=!state.plans.has(record.sha256);
  if(pending)applyRecord(dryStore,state,record);
  const batch=compileTerrainEdgeCanvasGutterBatch(state,{parentBatchSha256,preparationSha256:record.sha256,batchId});
  applyRecord(dryStore,state,batch);
  if(pending){store.storeBlob(bytes);store.append(record);}
  store.append(batch);return detached({record,batch});
}
export const autoPrepareTerrainEdgeCanvasGutterSource=(root,sourcePlanSha256,parentBatchSha256)=>run(root,(store,state)=>{
  const source=entryFor(state,sourcePlanSha256),parent=state.batches.get(parentBatchSha256),technical=source.result?.technical;
  const rule=TERRAIN_EDGE_CANVAS_GUTTER_RULE;
  if(parent?.coverageProfile!=='full-perimeter-v1'||parent.fullPerimeterComplete!==true
    ||!parent.planSha256s.includes(sourcePlanSha256)||!rule.eligibleOriginalPlans.includes(source.plan.format)
    ||source.status!=='rejected-technical'||technical?.status!=='fail'
    ||technical.issues.length!==1||technical.issues[0]!==rule.eligibleOriginalIssue||technical.edgeMaximumAlpha!==1)return null;
  const key=digest([sourcePlanSha256,parentBatchSha256]),batchId='auto-gutter.batch.'+key,preparationId='auto-gutter.source.'+key;
  const existing=[...state.plans.values()].find(entry=>entry.plan.recipe?.planId===preparationId)?.plan;
  const child=[...state.batches.values()].find(batch=>batch.batchId===batchId);
  if(existing)check(existing.automaticPolicy===TERRAIN_EDGE_AUTO_GUTTER_PROFILE&&existing.sourcePlanSha256===sourcePlanSha256
    &&existing.proposal.parentBatchSha256===parentBatchSha256,'TERRAIN_EDGE_AUTO_GUTTER_RESUME');
  if(child){
    check(existing&&child.format===TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT&&child.parentBatchSha256===parentBatchSha256
      &&child.preparationSha256s.at(-1)===existing.sha256,'TERRAIN_EDGE_AUTO_GUTTER_RESUME');
    assertTerrainEdgeCanvasGutterParent(state,child.sha256);
    return detached({record:existing,batch:child});
  }
  assertTerrainEdgeCanvasGutterParent(state,parentBatchSha256);
  if(parent.planSha256s.some(sha=>sha!==sourcePlanSha256&&!['authorized','pending-visual-review','accepted'].includes(entryFor(state,sha).status)))return null;
  if(existing)return commitTerrainEdgeCanvasGutter(store,state,{record:existing,bytes:store.readBlob(existing.rawSha256)},parentBatchSha256,batchId);
  let proposal;
  try{
    ({proposal}=compileTerrainEdgeCanvasGutterProposal(store,state,sourcePlanSha256,parentBatchSha256));
  }catch(error){
    const ineligible=['TERRAIN_EDGE_CANVAS_GUTTER_SIZE','TERRAIN_EDGE_CANVAS_GUTTER_BORDER','TERRAIN_EDGE_CANVAS_GUTTER_BODY_MARGIN',
      'TERRAIN_EDGE_CANVAS_GUTTER_BYTES','TERRAIN_EDGE_CANVAS_GUTTER_DERIVED_QA'];
    if(error.errors?.length===1&&ineligible.includes(error.errors[0].code))return null;
    throw error;
  }
  if(proposal.originalBorder.maximumAlpha!==1)return null;
  const prepared=compileTerrainEdgeCanvasGutterPreparation(store,state,{preparationId,proposal,automaticPolicy:TERRAIN_EDGE_AUTO_GUTTER_PROFILE});
  return commitTerrainEdgeCanvasGutter(store,state,prepared,parentBatchSha256,batchId);
});
export const proposeTerrainEdgeNativeSizePreparation=(root,sourcePlanSha256,parentBatchSha256)=>run(root,(store,state)=>{
  const {proposal,bytes,previews}=compileTerrainEdgeNativeSizeProposal(store,state,sourcePlanSha256,parentBatchSha256);
  return {proposal:detached(proposal),bytes,previews};
});
export const prepareTerrainEdgeNativeSizeSource=(root,options)=>run(root,(store,state)=>{
  const {record,bytes}=compileTerrainEdgeNativeSizePreparation(store,state,options);
  const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):store.readBlob(sha)};
  applyRecord(dryStore,state,record);store.append(record);return detached(record);
});
export const adoptTerrainEdgePreparedSource=(root,parentBatchSha256,preparationSha256,batchId)=>run(root,(store,state)=>
  commit(store,state,compileTerrainEdgePreparedBatch(state,{parentBatchSha256,preparationSha256,batchId})));
export const prepareAndAdoptTerrainEdgeNativeSizeSource=(root,options)=>run(root,(store,state)=>{
  exact(options,['preparationId','proposal','receipt','parentBatchSha256','batchId']);id(options.batchId);
  check(options.proposal?.parentBatchSha256===options.parentBatchSha256,'TERRAIN_EDGE_NATIVE_SIZE_BATCH');
  const {record,bytes}=compileTerrainEdgeNativeSizePreparation(store,state,{preparationId:options.preparationId,proposal:options.proposal,receipt:options.receipt});
  const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):store.readBlob(sha)};
  applyRecord(dryStore,state,record);
  const batch=compileTerrainEdgePreparedBatch(state,{parentBatchSha256:options.parentBatchSha256,preparationSha256:record.sha256,batchId:options.batchId});
  applyRecord(dryStore,state,batch);store.append(record);store.append(batch);return detached({record,batch});
});
export const proposeCoherentBorderPreparation=(root,sourcePlanSha256)=>run(root,(store,state)=>{
  const {proposal,bytes}=compileCoherentBorderProposal(store,state,sourcePlanSha256);return {proposal:detached(proposal),bytes};
});
export const prepareCoherentBorderSource=(root,options)=>run(root,(store,state)=>{
  const {record,bytes}=compileCoherentBorderPreparation(store,state,options);store.storeBlob(bytes);return commit(store,state,record);
});
export const proposeCoherentCanvasGutterPreparation=(root,sourcePlanSha256,parentBatchSha256,options={})=>run(root,(store,state)=>{
  const {proposal,bytes,previews}=compileCoherentCanvasGutterProposal(store,state,sourcePlanSha256,parentBatchSha256,options);
  return {proposal:detached(proposal),bytes,previews};
});
export const prepareCoherentCanvasGutterSource=(root,options)=>run(root,(store,state)=>{
  const {record,bytes}=compileCoherentCanvasGutterPreparation(store,state,options);
  const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):store.readBlob(sha)};
  applyRecord(dryStore,state,record);store.storeBlob(bytes);store.append(record);return detached(record);
});
function coherentPreparedBatch(state,parentBatchSha256,preparationSha256,batchId){
  id(batchId);const parent=state.batches.get(parentBatchSha256),prepared=entryFor(state,preparationSha256);
  check(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(parent?.format)
    &&['coherent-border-preparation','coherent-canvas-gutter-preparation','coherent-native-frame-preparation'].includes(prepared.kind)&&parent.planSha256s.includes(prepared.plan.sourcePlanSha256),'COHERENT_BORDER_BATCH');
  if(['coherent-canvas-gutter-preparation','coherent-native-frame-preparation'].includes(prepared.kind)){
    check(prepared.plan.proposal.parentBatchSha256===parentBatchSha256,'COHERENT_CANVAS_GUTTER_BATCH');
    const latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)&&b.referencePlanSha256===parent.referencePlanSha256);
    check(latest?.sha256===parentBatchSha256,'COHERENT_CANVAS_GUTTER_PARENT_STALE');
  }
  return compileCoherentBatch(state,{batchId,referencePlanSha256:parent.referencePlanSha256,parentBatchSha256,
    planSha256s:parent.planSha256s.map(sha=>sha===prepared.plan.sourcePlanSha256?preparationSha256:sha)});
}
export const adoptCoherentPreparedSource=(root,parentBatchSha256,preparationSha256,batchId)=>run(root,(store,state)=>
  commit(store,state,coherentPreparedBatch(state,parentBatchSha256,preparationSha256,batchId)));
export const prepareAndAdoptCoherentBorderSource=(root,options)=>run(root,(store,state)=>{
  exact(options,['preparationId','proposal','receipt','parentBatchSha256','batchId']);id(options.batchId);
  const {record,bytes}=compileCoherentBorderPreparation(store,state,{preparationId:options.preparationId,proposal:options.proposal,receipt:options.receipt});
  // Validate both records against a transient state before any blob or event is
  // persisted. Physical interruption after append one remains replayable.
  const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):store.readBlob(sha)};
  applyRecord(dryStore,state,record);
  const batch=coherentPreparedBatch(state,options.parentBatchSha256,record.sha256,options.batchId);
  applyRecord(dryStore,state,batch);
  store.storeBlob(bytes);store.append(record);store.append(batch);return detached({record,batch});
});
export const prepareAndAdoptCoherentCanvasGutterSource=(root,options)=>run(root,(store,state)=>{
  exact(options,['preparationId','proposal','receipt','parentBatchSha256','batchId']);id(options.batchId);
  check(options.proposal?.parentBatchSha256===options.parentBatchSha256,'COHERENT_CANVAS_GUTTER_BATCH');
  const {record,bytes}=compileCoherentCanvasGutterPreparation(store,state,{preparationId:options.preparationId,proposal:options.proposal,receipt:options.receipt});
  const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(bytes):store.readBlob(sha)};
  applyRecord(dryStore,state,record);
  const batch=coherentPreparedBatch(state,options.parentBatchSha256,record.sha256,options.batchId);
  applyRecord(dryStore,state,batch);
  store.storeBlob(bytes);store.append(record);store.append(batch);return detached({record,batch});
});
export const proposeCoherentNativeFrame=(root,options)=>run(root,(store,state)=>
  detached(compileCoherentNativeFrameProposal(store,state,options)));
export const adoptCoherentNativeFrame=(root,options)=>run(root,(store,state)=>{
  exact(options,['preparationId','proposal','receipt','batchId']);
  const {preparationId,proposal,receipt,batchId}=options;
  const record=compileCoherentNativeFramePreparation(store,state,{preparationId,proposal,receipt});
  applyRecord(store,state,record);
  const batch=coherentPreparedBatch(state,proposal.parentBatchSha256,record.sha256,batchId);
  applyRecord(store,state,batch);
  store.append(record);store.append(batch);
  return detached({record,batch});
});
export const reviseCoherentSources=(root,parentSha,options)=>run(root,(store,state)=>{
  const optIn=Object.hasOwn(options,'allowUnsubmittedDependency');
  exact(options,['batchId','replacements',...(optIn?['allowUnsubmittedDependency','expectedBatchSha256']:[])]);const parent=state.batches.get(parentSha);check(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(parent?.format),'COHERENT_BATCH_PARENT');
  check(Array.isArray(options.replacements)&&options.replacements.length>0,'COHERENT_BATCH_REPLACEMENT');const replacements=new Map();
  if(optIn){const latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)&&b.referencePlanSha256===parent.referencePlanSha256),r=options.replacements[0];
    check(options.allowUnsubmittedDependency===true&&options.expectedBatchSha256===parentSha&&latest?.sha256===parentSha&&options.replacements.length===1
      &&r?.intent===LAYER_SOURCE_INTENT&&Object.hasOwn(r,'sourceDependency'),'SOURCE_DEPENDENCY_REVISION_OPTION');
    const all=parent.planSha256s.map(sha=>entryFor(state,sha)),target=all.find(e=>e.plan.recipe.assetId===r.assetId),source=all.find(e=>e.plan.sha256===r.sourceDependency?.sourcePlanSha256);
    check(target?.status==='planned'&&['authorization','attempt','submission','result','terminal'].every(k=>!Object.hasOwn(target,k))
      &&source?.status==='accepted'&&all.every(e=>['planned','authorized','pending-visual-review','accepted'].includes(e.status)),'SOURCE_DEPENDENCY_REVISION_STATE');
  }
  for(const r of options.replacements){const keys=r.intent==='isolated-foreground-v3'?['assetId','planId','intent','subjectBrief']:Object.hasOwn(r,'sourceScope')?['assetId','planId','intent','sourceScope']:Object.hasOwn(r,'intent')?['assetId','planId','intent']:['assetId','planId'];exact(r,[...keys,...(Object.hasOwn(r,'sourceDependency')?['sourceDependency']:[])]);if(Object.hasOwn(r,'sourceScope')||Object.hasOwn(r,'sourceDependency'))check(r.intent===LAYER_SOURCE_INTENT,'LAYER_SCOPE_INTENT');
    if(Object.hasOwn(r,'sourceDependency'))check(parent.planSha256s.includes(r.sourceDependency?.sourcePlanSha256),'SOURCE_DEPENDENCY_BATCH');check(!replacements.has(r.assetId),'COHERENT_BATCH_REPLACEMENT');replacements.set(r.assetId,r);}
  const newPlans=[];const shas=parent.planSha256s.map(sha=>{const old=entryFor(state,sha),r=replacements.get(old.plan.recipe.assetId);if(!r)return sha;
    replacements.delete(r.assetId);if(Object.hasOwn(r,'sourceDependency')){check(old.status!=='indeterminate','SOURCE_DEPENDENCY_UNKNOWN_PARENT');if(old.status==='planned')check(optIn,'SOURCE_DEPENDENCY_REVISION_OPTION');}const nextIntent=Object.hasOwn(r,'intent')?r.intent:old.plan.recipe.intent;
    const {subjectBrief:oldBrief,sourceScope:oldScope,sourceDependency:oldDependency,...oldRecipe}=old.plan.recipe;
    const plan=compileCoherentSource(state,{...oldRecipe,planId:r.planId,parents:[sha],intent:nextIntent,
      ...(nextIntent==='isolated-foreground-v3'?{subjectBrief:r.subjectBrief??oldBrief}:nextIntent===LAYER_SOURCE_INTENT?{sourceScope:r.sourceScope??oldScope}:{}),...(Object.hasOwn(r,'sourceDependency')?{sourceDependency:r.sourceDependency}:{})},s=>store.readBlob(s));
    newPlans.push(plan);return plan.sha256;});check(replacements.size===0,'COHERENT_BATCH_REPLACEMENT');
  const temporary={...state,plans:new Map([...state.plans,...newPlans.map(plan=>[plan.sha256,{plan,status:'planned'}])])};
  const batch=compileCoherentBatch(temporary,{batchId:options.batchId,referencePlanSha256:parent.referencePlanSha256,planSha256s:shas,parentBatchSha256:parent.sha256});
  commitCoherentSourceRecords(store,state,newPlans,batch);return detached(batch);
});
// Only this local API chooses the old workflow. Never persist its path or its
// private journal. A fresh source replay precedes the target's independent
// transaction, proposal comparison and deterministic dry replay.
export function commitCoherentRebind(root,options){
  const historical=Object.hasOwn(options,'historicalBatchSha256');
  exact(options,['sourceWorkflow','sourcePlanSha256','targetPlanSha256','targetSha256','scopeSha256','proposal','receipt','rebindId','parentBatchSha256','batchId',...(historical?['historicalBatchSha256']:[])]);
  const {sourceWorkflow,sourcePlanSha256,targetPlanSha256,targetSha256,scopeSha256,proposal,receipt,rebindId,parentBatchSha256,batchId,historicalBatchSha256}=options;
  check(!historical||resolve(root)===resolve(sourceWorkflow),'REBIND_HISTORICAL_BATCH');
  check(isDigest(targetPlanSha256)&&isDigest(targetSha256)&&isDigest(scopeSha256),'REBIND_TARGET');
  const fresh=exportCoherentRebindEvidence(sourceWorkflow,sourcePlanSha256,{historicalBatchSha256});
  return run(root,(store,state)=>{
    const currentProposal=compileCoherentRebindProposal(state,{...fresh,targetPlanSha256,targetSha256,scopeSha256});
    check(digest(currentProposal)===digest(proposal),'REBIND_PROPOSAL_CHANGED');
    const parent=state.batches.get(parentBatchSha256);
    check(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(parent?.format)
      &&parent.planSha256s.includes(targetPlanSha256),'REBIND_PARENT_BATCH');
    const latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)
      &&b.referencePlanSha256===parent.referencePlanSha256);
    check(latest?.sha256===parent.sha256,'REBIND_PARENT_STALE');
    const record=compileCoherentRebindRecord(state,{rebindId,targetPlanSha256,parentBatchSha256,intendedBatchId:batchId,evidence:fresh.evidence,proposal,receipt,bytes:fresh.bytes});
    const dryStore={...store,readBlob:sha=>sha===record.rawSha256?Buffer.from(fresh.bytes):store.readBlob(sha)};
    applyRecord(dryStore,state,record);
    const batch=compileCoherentBatch(state,{batchId,referencePlanSha256:parent.referencePlanSha256,parentBatchSha256,
      planSha256s:parent.planSha256s.map(sha=>sha===targetPlanSha256?record.sha256:sha)});
    applyRecord(dryStore,state,batch);
    store.storeBlob(fresh.bytes);store.append(record);store.append(batch);return detached({record,batch});
  });
}
// Only when the second event was never created and the journal is intact, the
// first record already owns its receipt. Revalidate the local source and append
// its missing batch. Partial writes and crash locks still require inspection.
export function recoverCoherentRebindBatch(root,options){
  const historical=Object.hasOwn(options,'historicalBatchSha256');
  exact(options,['sourceWorkflow','sourcePlanSha256','rebindSha256','parentBatchSha256','batchId',...(historical?['historicalBatchSha256']:[])]);
  const {sourceWorkflow,sourcePlanSha256,rebindSha256,parentBatchSha256,batchId,historicalBatchSha256}=options;
  const existing=getGenerationPlan(root,rebindSha256);
  check(existing.format==='ai_scene_coherent_rebind_v1'&&existing.parentBatchSha256===parentBatchSha256&&existing.intendedBatchId===batchId,'REBIND_RECOVERY');
  const target=existing.proposal.target;
  const fresh=proposeRebind(root,{sourceWorkflow,sourcePlanSha256,targetPlanSha256:existing.targetPlanSha256,
    targetSha256:target.targetSha256,scopeSha256:target.scopeSha256,...(historical?{historicalBatchSha256}:{})});
  check(digest(fresh.proposal)===digest(existing.proposal)&&digest(fresh.evidence)===digest(existing.sourceEvidence)
    &&hash(fresh.bytes)===existing.rawSha256,'REBIND_RECOVERY_SOURCE');
  return run(root,(store,state)=>{
    const entry=entryFor(state,rebindSha256),parent=state.batches.get(parentBatchSha256);
    check(entry.kind==='coherent-rebind'&&digest(entry.plan)===digest(existing)&&['pending-visual-review','accepted'].includes(entry.status)
      &&parent&&parent.planSha256s.includes(existing.targetPlanSha256),'REBIND_RECOVERY');
    const latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)
      &&b.referencePlanSha256===parent.referencePlanSha256);
    check(latest?.sha256===parent.sha256,'REBIND_PARENT_STALE');
    check(store.readBlob(existing.rawSha256).equals(fresh.bytes),'REBIND_RECOVERY_SOURCE');
    const batch=compileCoherentBatch(state,{batchId,referencePlanSha256:parent.referencePlanSha256,parentBatchSha256,
      planSha256s:parent.planSha256s.map(sha=>sha===existing.targetPlanSha256?rebindSha256:sha)});
    return commit(store,state,batch);
  });
}
function coherentCandidateInputs(store,state,batchSha256,{historical=false}={}){
  const batch=state.batches.get(batchSha256);check(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(batch?.format),'COHERENT_BATCH_REQUIRED');
  const ref=entryFor(state,batch.referencePlanSha256);check(ref.status==='accepted'&&ref.reconstructionTarget?.sha256===batch.targetSha256,'COHERENT_REFERENCE_REQUIRED');
  const scope=historical?{...state,activeSpec:ref.plan.recipe.specSha256,activeStyle:ref.plan.recipe.styleSha256}:state;
  const sources=batch.planSha256s.map(sha=>{const entry=entryFor(state,sha);assertCurrent(scope,entry.plan);
    check(['pending-visual-review','accepted'].includes(entry.status)&&entry.result?.technical.status==='pass','COHERENT_SOURCES_INCOMPLETE');
    const preparation=['coherent-border-preparation','coherent-canvas-gutter-preparation','coherent-native-frame-preparation'].includes(entry.kind)?{
      record:entry.plan,originalPlan:entryFor(state,entry.plan.sourcePlanSha256).plan,
      originalResult:entryFor(state,entry.plan.sourcePlanSha256).result,originalRaw:store.readBlob(entry.plan.originalRawSha256)}:null;
    const reviewPlan=entry.plan.format==='ai_scene_coherent_rebind_v1'?entryFor(state,entry.plan.targetPlanSha256).plan
      :entry.plan.format===COHERENT_NATIVE_FRAME_FORMAT?preparation.originalPlan:null;
    return {...entry,raw:store.readBlob(entry.result.rawSha256),...(reviewPlan?{reviewPlan}:{}),...(preparation?{preparation}:{})};});
  return {batch,ref,sources};
}
export const checkCoherentCandidateRelations=(root,batchSha256,relationReviews=null,guideReviews=null,composition=null)=>run(root,(store,state)=>{
  const {sources,ref,batch}=coherentCandidateInputs(store,state,batchSha256);const relations=assertCandidateBandRelationReviews(sources,relationReviews),guides=assertCandidateBandGuideReviews(sources,guideReviews,store.readBlob(ref.result.rawSha256));assertBandReviewObservationsAgree(relations,guides);
  assertBandGuideWorldPlacement(sources,guides,composition,ref.reconstructionTarget);
  assertCompositionStructureCoversSources(composition,sources);
  if(composition?.format==='ai_scene_coherent_composition_v6'){validateCoherentComposition(composition,batch,ref.reconstructionTarget);
    const review=reviewReferenceFeatureLayout({structure:composition.referenceStructure,sources,measurements:composition.featureMeasurements,bandPlacements:composition.bandPlacements,correction:composition.featureCorrection,supplement:composition.featureSupplement,intentReview:composition.referenceIntentReview});check(review.status==='reviewed','REFERENCE_FEATURE_LAYOUT_BLOCKED');}
  return {status:'checked',generationCalls:0};
});
export const reviewCoherentReferenceFeatures=(root,batchSha256,composition)=>run(root,(store,state)=>{
  const {batch,ref,sources}=coherentCandidateInputs(store,state,batchSha256);
  check(composition?.format==='ai_scene_coherent_composition_v6','REFERENCE_FEATURE_COMPOSITION');validateCoherentComposition(composition,batch,ref.reconstructionTarget);
  assertCompositionStructureCoversSources(composition,sources);
  return detached(reviewReferenceFeatureLayout({structure:composition.referenceStructure,sources,measurements:composition.featureMeasurements,bandPlacements:composition.bandPlacements,correction:composition.featureCorrection,supplement:composition.featureSupplement,intentReview:composition.referenceIntentReview}));
});
export const reviewCoherentBandRelations=(root,planSha256,observations)=>run(root,(store,state)=>{
  const entry=entryFor(state,planSha256);assertCurrent(state,entry.plan);
  check(entry.result?.technical,'RESULT_REQUIRED');
  if(entry.plan.format===COHERENT_NATIVE_FRAME_FORMAT)return detached(reviewNativeFrameBands({plan:entryFor(state,entry.plan.sourcePlanSha256).plan,
    raw:store.readBlob(entry.result.rawSha256),prepared:entry.plan.proposal,observations}).relations);
  const plan=entry.plan.format==='ai_scene_coherent_rebind_v1'?entryFor(state,entry.plan.targetPlanSha256).plan:entry.plan;
  return detached(reviewBandFeatureRelations({plan,technical:entry.result.technical,rawBytes:store.readBlob(entry.result.rawSha256),observations}));
});
export const reviewCoherentBandGuide=(root,planSha256,observations)=>run(root,(store,state)=>{
  const entry=entryFor(state,planSha256);assertCurrent(state,entry.plan);check(entry.result?.technical,'RESULT_REQUIRED');
  if(entry.plan.format===COHERENT_NATIVE_FRAME_FORMAT)return detached(reviewNativeFrameBands({plan:entryFor(state,entry.plan.sourcePlanSha256).plan,
    raw:store.readBlob(entry.result.rawSha256),prepared:entry.plan.proposal,observations}).guide);
  const plan=entry.plan.format==='ai_scene_coherent_rebind_v1'?entryFor(state,entry.plan.targetPlanSha256).plan:entry.plan;
  return detached(reviewBandGuide({plan,technical:entry.result.technical,rawBytes:store.readBlob(entry.result.rawSha256),observations,referenceBytes:store.readBlob(plan.referenceEvidence[0].rawSha256)}));
});
function preparedCoherentScene(store,state,batchSha256,candidateId,composition=null,relationReviews=null,guideReviews=null,options){
  const {batch,ref,sources}=coherentCandidateInputs(store,state,batchSha256,options);
  return coherentSceneFiles({candidateId,batch,sources,reference:{plan:ref.plan,target:ref.reconstructionTarget,raw:store.readBlob(ref.result.rawSha256)},
    spec:state.designs.get(ref.plan.recipe.specSha256),style:state.designs.get(ref.plan.recipe.styleSha256),composition,relationReviews,guideReviews});
}
export const buildCoherentCandidate=(root,batchSha,candidateId,output,composition=null,relationReviews=null,guideReviews=null)=>run(root,(store,state)=>writeProofBundle(output,root,preparedCoherentScene(store,state,batchSha,candidateId,composition,relationReviews,guideReviews)));
export const verifyCoherentCandidate=(root,batchSha,candidateId,output,composition=null,{historical=false}={})=>run(root,(store,state)=>{
  const path=join(output,'evidence/band-relations-reviews.json'),reviews=existsSync(path)?parseJson(readSelectedFile(path,2097152)):null,
    guidePath=join(output,'evidence/band-guide-reviews.json'),guideReviews=existsSync(guidePath)?parseJson(readSelectedFile(guidePath,2097152)):null;
  return verifyProofBundle(output,preparedCoherentScene(store,state,batchSha,candidateId,composition,reviews,guideReviews,{historical}));
});
export function importRegionGuideControls(root, options, artifacts) {
  return run(root, (store, state) => {
    const p = validateRegionGuidePacket(options.reviewPacket);
    check(artifacts instanceof Map && artifacts.size === p.artifacts.length, 'REGION_CONTROL_ARTIFACTS');
    const blobs = new Map();
    for (const a of p.artifacts) {
      const bytes = artifacts.get(a.path); check(bytes instanceof Uint8Array && bytes.length === a.byteLength
        && hash(bytes) === a.sha256, 'REGION_CONTROL_ARTIFACTS'); blobs.set(a.sha256, bytes);
    }
    const record = compileRegionGuideControls(state, options, sha => blobs.get(sha));
    for (const bytes of blobs.values()) store.storeBlob(bytes);
    return commit(store, state, record);
  });
}
export const reviewRegionGuideControls = (root, controlsSha256, receipt) => run(root, (store, state) => {
  const c = state.regionControls.get(controlsSha256); check(c, 'REGION_CONTROL_REVIEW_REQUIRED');
  return commit(store, state, seal({ format: 'ai_scene_region_controls_review_v1', controlsSha256,
    packetSha256: c.reviewPacket.sha256, receipt }));
});
export const getRegionGuideControls = (root, controlsSha256) => run(root, (_store, state) => {
  const c = state.regionControls.get(controlsSha256); check(c, 'REGION_CONTROL_REVIEW_REQUIRED');
  return detached({ control: c, review: state.regionControlReviews.get(controlsSha256) ?? null });
});
export const readRegionGuideImage = (root, controlsSha256) => run(root, (store, state) => {
  const c = state.regionControls.get(controlsSha256); check(c, 'REGION_CONTROL_REVIEW_REQUIRED');
  return verifyImage(store, c.guide.artifact);
});
export const authorizeReferenceAssetBatch = (root, batchSha256, decision) => run(root, (store, state) =>
  commit(store, state, seal({ format: 'ai_scene_source_batch_authorization_v1', batchSha256,
    nonce: randomBytes(16).toString('hex'), receipt: decision })));
export function importPaintControls(root, options, artifacts) {
  return run(root, (store, state) => {
    const p = validatePaintDesignPacket(options.reviewPacket);
    check(artifacts instanceof Map && artifacts.size === p.artifacts.length, 'PAINT_CONTROL_ARTIFACTS');
    const blobs = new Map();
    for (const a of p.artifacts) {
      const bytes = artifacts.get(a.path); check(bytes instanceof Uint8Array && bytes.length === a.byteLength && hash(bytes) === a.sha256, 'PAINT_CONTROL_ARTIFACTS');
      blobs.set(a.sha256, bytes);
    }
    const c = compilePaintControls(state, options, sha => blobs.get(sha));
    for (const bytes of blobs.values()) store.storeBlob(bytes);
    return commit(store, state, c);
  });
}
export const reviewPaintControls = (root, controlsSha256, receipt) => run(root, (store, state) => {
  const c = state.paintControls.get(controlsSha256); check(c, 'PAINT_DESIGN_REVIEW_REQUIRED');
  return commit(store, state, seal({ format: 'ai_scene_paint_controls_review_v1', controlsSha256, proposalSha256: c.design.sha256, receipt }));
});
export const getPaintControls = (root, controlsSha256) => run(root, (_store, state) => {
  const c = state.paintControls.get(controlsSha256); check(c, 'PAINT_DESIGN_REVIEW_REQUIRED');
  return detached({ control: c, review: state.paintControlReviews.get(controlsSha256) ?? null });
});
function paintRecipe(state, options) {
  exact(options, ['planId', 'parents', 'capabilitiesSha256', 'paintControlsSha256']);
  const c = state.paintControls.get(options.paintControlsSha256); check(c, 'PAINT_DESIGN_REVIEW_REQUIRED');
  return { ...options, stage: 'reference-paint-source', specSha256: state.activeSpec, styleSha256: state.activeStyle,
    referencePlans: [c.referencePlanSha256], inventoryRefs: [], assetId: c.instanceId, targetSha256: c.targetSha256, intent: '' };
}
export const previewPaintSourcePlan = (root, options) => run(root, (store, state) =>
  detached(compilePaintSourcePlan(state, paintRecipe(state, options), sha => store.readBlob(sha))));
export const freezePaintSourcePlan = (root, options) => run(root, (store, state) =>
  commit(store, state, compilePaintSourcePlan(state, paintRecipe(state, options), sha => store.readBlob(sha))));
function paintReviewProof(store, state, planSha256) {
  const e = entryFor(state, planSha256); check(['ai_scene_generation_plan_v25','ai_scene_generation_plan_v26'].includes(e.plan.format) && e.result?.technical.status === 'pass', 'PAINT_SOURCE_TECHNICAL');
  assertCurrent(state, e.plan); const c = state.paintControls.get(e.plan.recipe.paintControlsSha256);
  if(e.plan.format==='ai_scene_generation_plan_v26') {
    const m=state.materialPaintControls.get(e.plan.recipe.materialControlsSha256);
    return materialPaintReviewFiles(e.plan,store.readBlob(e.result.rawSha256),c,m,store.readBlob(m.materialGuide.sha256),
      compileMaterialCoverageProposal(state,planSha256,b=>store.readBlob(b)));
  }
  return paintSourceReviewFiles(e.plan, store.readBlob(e.result.rawSha256), c);
}
export const buildPaintSourceReview = (root, sha, output) => run(root, (store, state) => writeProofBundle(output, root, paintReviewProof(store, state, sha)));
export const verifyPaintSourceReview = (root, sha, output) => run(root, (store, state) => verifyProofBundle(output, paintReviewProof(store, state, sha)));
export const getPaintApplicationProposal = (root, sha) => run(root, (_store, state) => detached(materialApplicationProposal(state, sha)));
export const reviewPaintApplication = (root, sha, receipt) => run(root, (store, state) => {
  const proposal = materialApplicationProposal(state, sha);
  return commit(store, state, seal({ format: 'ai_scene_paint_application_review_v1', planSha256: sha, proposalSha256: proposal.sha256, receipt }));
});
function paintDerivedProof(store, state, sha) {
  const proposal = materialApplicationProposal(state, sha), review = state.paintApplicationReviews.get(proposal.sha256);
  check(review?.receipt.decision === 'accept', 'PAINT_APPLICATION_REVIEW_REQUIRED');
  const e = entryFor(state, sha), c = state.paintControls.get(e.plan.recipe.paintControlsSha256);
  assertCurrent(state, e.plan);
  return paintLayerFiles(e.plan, store.readBlob(e.result.rawSha256), c, store.readBlob(c.geometryAlpha.sha256), proposal, review,
    state.plans.get(c.referencePlanSha256).reconstructionTarget);
}
export const buildPaintLayer = (root, sha, output) => run(root, (store, state) => writeProofBundle(output, root, paintDerivedProof(store, state, sha)));
export const verifyPaintLayer = (root, sha, output) => run(root, (store, state) => verifyProofBundle(output, paintDerivedProof(store, state, sha)));
export function importMaterialPaintControls(root, options, artifacts) {
  return run(root,(store,state)=>{
    const p=validateMaterialDesignPacket(options.reviewPacket);
    check(artifacts instanceof Map && artifacts.size===p.artifacts.length,'MATERIAL_CONTROL_ARTIFACTS');
    const blobs=new Map();
    for(const a of p.artifacts) {
      const bytes=artifacts.get(a.path); check(bytes instanceof Uint8Array && bytes.length===a.byteLength && hash(bytes)===a.sha256,'MATERIAL_CONTROL_ARTIFACTS');
      blobs.set(a.sha256,bytes);
    }
    const c=compileMaterialControls(state,options,sha=>blobs.get(sha)??store.readBlob(sha));
    for(const bytes of blobs.values()) store.storeBlob(bytes);
    return commit(store,state,c);
  });
}
export const reviewMaterialPaintControls=(root,sha,receipt)=>run(root,(store,state)=>{
  const c=state.materialPaintControls.get(sha); check(c,'MATERIAL_DESIGN_REVIEW_REQUIRED');
  return commit(store,state,seal({format:'ai_scene_material_paint_controls_review_v1',controlsSha256:sha,proposalSha256:c.proposal.sha256,receipt}));
});
export const getMaterialPaintControls=(root,sha)=>run(root,(_store,state)=>{
  const c=state.materialPaintControls.get(sha); check(c,'MATERIAL_DESIGN_REVIEW_REQUIRED');
  return detached({control:c,base:state.paintControls.get(c.basePaintControlsSha256),review:state.materialPaintControlReviews.get(sha)??null});
});
function materialRecipe(state,options) {
  exact(options,['planId','parents','capabilitiesSha256','materialControlsSha256']);
  const c=state.materialPaintControls.get(options.materialControlsSha256); check(c,'MATERIAL_DESIGN_REVIEW_REQUIRED');
  return {...paintRecipe(state,{planId:options.planId,parents:options.parents,capabilitiesSha256:options.capabilitiesSha256,
    paintControlsSha256:c.basePaintControlsSha256}),materialControlsSha256:c.sha256};
}
export const previewMaterialPaintPlan=(root,options)=>run(root,(store,state)=>detached(compileMaterialPaintPlan(state,materialRecipe(state,options),sha=>store.readBlob(sha))));
export const freezeMaterialPaintPlan=(root,options)=>run(root,(store,state)=>commit(store,state,compileMaterialPaintPlan(state,materialRecipe(state,options),sha=>store.readBlob(sha))));
export const getMaterialCoverageProposal=(root,sha)=>run(root,(store,state)=>{
  assertCurrent(state,entryFor(state,sha).plan);
  return detached(compileMaterialCoverageProposal(state,sha,b=>store.readBlob(b)));
});
export const reviewMaterialCoverage=(root,sha,observation,receipt)=>run(root,(store,state)=>{
  assertCurrent(state,entryFor(state,sha).plan);
  const p=compileMaterialCoverageProposal(state,sha,b=>store.readBlob(b)); validateMaterialCoverage(p,observation,receipt);
  return commit(store,state,seal({format:'ai_scene_material_coverage_review_v1',planSha256:sha,proposalSha256:p.sha256,rawSha256:p.rawSha256,observation,receipt}));
});
export const previewReferenceInputExperiment = (root, options) => run(root, (_store, state) =>
  detached(seal({ format: 'ai_scene_reference_input_experiment_proposal_v1', executable: false, generationCalls: 0,
    plan: compileReferenceInputExperiment(state, referenceInputExperimentRecipe(state, options)) })));
export const freezeReferenceInputExperiment = (root, options) => run(root, (store, state) =>
  commit(store, state, compileReferenceInputExperiment(state, referenceInputExperimentRecipe(state, options))));
export const previewReferenceLedPlan = (root, options) => run(root, (_store, state) => detached(seal({
  format: 'ai_scene_reference_led_proposal_v1', executable: false, generationCalls: 0, sources: options, ...referenceLedContent(state, options) })));
function referenceLedRecipe(state, options) {
  exact(options, ['planId', 'parents', 'capabilitiesSha256', 'pixelPolicy', 'intent']);
  return { ...options, stage: 'reference', mode: 'reference-led', specSha256: state.activeSpec, styleSha256: state.activeStyle,
    referencePlans: [], inventoryRefs: [], assetId: 'scene-reference' };
}
export const freezeReferenceLedPlan = (root, options) => run(root, (store, state) =>
  commit(store, state, compileReferenceLedPlan(state, referenceLedRecipe(state, options))));
export const previewCoherentReference=(root,options)=>run(root,(_store,state)=>detached(compileCoherentReference(state,referenceLedRecipe(state,options))));
export const freezeCoherentReference=(root,options)=>run(root,(store,state)=>{
  const plan=compileCoherentReference(state,referenceLedRecipe(state,options));
  for(const guide of coherentReferenceGuides())store.storeBlob(guide.bytes);
  return commit(store,state,plan);
});
function coherentReferenceV2Recipe(state,options){
  exact(options,['planId','parents','capabilitiesSha256','pixelPolicy','intent','referenceGuidanceProfile']);
  const {referenceGuidanceProfile,...legacy}=options;
  return {...referenceLedRecipe(state,legacy),referenceGuidanceProfile};
}
export const previewCoherentReferenceV2=(root,options)=>run(root,(_store,state)=>
  detached(compileCoherentReferenceV2(state,coherentReferenceV2Recipe(state,options))));
export const freezeCoherentReferenceV2=(root,options)=>run(root,(store,state)=>{
  const plan=compileCoherentReferenceV2(state,coherentReferenceV2Recipe(state,options));
  for(const guide of coherentReferenceGuidesV2())store.storeBlob(guide.bytes);
  return commit(store,state,plan);
});
export const importCoherentCompositionGuide=(root,options,bytes)=>run(root,(store,state)=>{
  const guide=compileCompositionGuide(state,options,bytes);store.storeBlob(bytes);return commit(store,state,guide);
});
export const getCoherentCompositionGuide=(root,sha256)=>run(root,(_store,state)=>{
  const guide=state.compositionGuides?.get(sha256);check(guide,'COMPOSITION_GUIDE_REQUIRED');return detached(guide);
});
function coherentReferenceV3Recipe(state,options){
  exact(options,['planId','parents','capabilitiesSha256','pixelPolicy','intent','referenceGuidanceProfile','compositionGuideSha256']);
  const {referenceGuidanceProfile,compositionGuideSha256,...legacy}=options;
  return {...referenceLedRecipe(state,legacy),referenceGuidanceProfile,compositionGuideSha256};
}
export const previewCoherentReferenceV3=(root,options)=>run(root,(store,state)=>
  detached(compileCoherentReferenceV3(state,coherentReferenceV3Recipe(state,options),sha=>store.readBlob(sha))));
export const freezeCoherentReferenceV3=(root,options)=>run(root,(store,state)=>{
  const plan=compileCoherentReferenceV3(state,coherentReferenceV3Recipe(state,options),sha=>store.readBlob(sha));
  for(const guide of coherentReferenceGuidesV2())store.storeBlob(guide.bytes);
  return commit(store,state,plan);
});
export const previewReferenceLedIsolation = (root, options) => run(root, (_store, state) =>
  detached(seal({ format: 'ai_scene_reference_led_isolation_proposal_v1', executable: false, generationCalls: 0,
    plan: compileReferenceLedIsolation(state, referenceLedIsolationRecipe(state, options)) })));
export const freezeReferenceLedIsolation = (root, options) => run(root, (store, state) =>
  commit(store, state, compileReferenceLedIsolation(state, referenceLedIsolationRecipe(state, options))));
export function importReferenceControls(root, options, artifacts) {
  return run(root, (store, state) => {
    const packet = validateControlReviewPacket(options.reviewPacket);
    check(artifacts instanceof Map && artifacts.size === packet.artifacts.length, 'CONTROL_IMPORT_ARTIFACTS');
    const blobs = new Map();
    for (const a of packet.artifacts) {
      const b = artifacts.get(a.path); check(b instanceof Uint8Array && b.length === a.byteLength
        && hash(b) === a.sha256, 'CONTROL_IMPORT_ARTIFACTS'); blobs.set(a.sha256, b);
    }
    const record = compileReferenceControls(state, options, sha => blobs.get(sha));
    for (const b of blobs.values()) store.storeBlob(b);
    return commit(store, state, record);
  });
}
export const reviewReferenceControls = (root, controlsSha256, receipt) => run(root, (store, state) => {
  const c = state.controls.get(controlsSha256); check(c, 'REFERENCE_CONTROLS_REQUIRED');
  return commit(store, state, seal({ format: 'ai_scene_reference_controls_review_v1', controlsSha256,
    packetSha256: c.reviewPacket.sha256, receipt }));
});
export const getReferenceControls = (root, controlsSha256) => run(root, (_store, state) => {
  const c = state.controls.get(controlsSha256); check(c, 'REFERENCE_CONTROLS_REQUIRED'); return detached(c);
});
export const previewReferenceControlledPlan = (root, options) => run(root, (_store, state) =>
  detached(seal({ format: 'ai_scene_reference_controlled_proposal_v1', executable: false, generationCalls: 0,
    plan: compileControlledReference(state, controlledReferenceRecipe(state, options)) })));
export const freezeReferenceControlledPlan = (root, options) => run(root, (store, state) =>
  commit(store, state, compileControlledReference(state, controlledReferenceRecipe(state, options))));
export function intakeReferenceLedCandidate(root, options, bytes) {
  return run(root, (store, state) => {
    const rawInput = imageRef(bytes, { allowCabx: true });
    const plan = compileReferenceCandidate(state, { ...referenceLedRecipe(state, options), rawInput });
    store.storeBlob(bytes);
    const result = seal({ format: 'ai_scene_reference_candidate_intake_v1', planSha256: plan.sha256,
      rawSha256: rawInput.sha256, byteLength: rawInput.byteLength, technical: assessReferenceLed(plan, bytes) });
    applyRecord(store, state, plan); applyRecord(store, state, result);
    store.append(plan); store.append(result); return detached({ plan, result });
  });
}
// A reviewed decomposition can change after seeing a generated reference. Keep
// the original attempt immutable and adopt its exact bytes under a new design,
// in the SAME journal, without a generation request or inherited authorization.
export function adoptObservedReferenceDesign(root,{sourcePlanSha256,spec,receipt,options,parentBatchSha256}){
  return run(root,(store,state)=>{
    const source=entryFor(state,sourcePlanSha256);assertCurrent(state,source.plan);
    const parent=[...state.batches.values()].findLast(b=>b.referencePlanSha256===sourcePlanSha256
      &&['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format));
    const late=parentBatchSha256!==undefined;
    const settled=late&&parent?.sha256===parentBatchSha256&&parent.targetSha256===source.reconstructionTarget?.sha256
      &&parent.planSha256s.every(sha=>{
        const entry=entryFor(state,sha);assertCurrent(state,entry.plan);
        return ['pending-visual-review','accepted'].includes(entry.status)&&entry.result?.technical.status==='pass';
      });
    check(source.result?.technical.status==='pass'&&source.plan.recipe.stage==='reference'
      &&(late?source.status==='accepted'&&settled:source.status==='pending-visual-review'&&!source.reconstructionTarget&&!parent),'OBSERVED_DESIGN_STATE');
    check(spec.format==='ai_scene_spec_v3'&&receipt.decision==='accept'&&receipt.targetSha256===spec.sha256,'OBSERVED_DESIGN_DECISION');
    const prior=state.designs.get(state.activeSpec),{specId:_old,requirements:_req,sha256:_sha,...before}=prior,
      {specId:_new,requirements:_next,sha256:_hash,...after}=spec;
    check(digest(before)===digest(after),'OBSERVED_DESIGN_SCOPE_ONLY');
    const review=seal({format:'ai_scene_design_review_v1',kind:'spec',receipt});
    applyRecord(store,state,spec);applyRecord(store,state,review);
    const bytes=store.readBlob(source.result.rawSha256),rawInput=imageRef(bytes,{allowCabx:true});
    const plan=compileReferenceCandidate(state,{...referenceLedRecipe(state,options),rawInput});
    const result=seal({format:'ai_scene_reference_candidate_intake_v1',planSha256:plan.sha256,rawSha256:rawInput.sha256,
      byteLength:bytes.length,technical:assessReferenceLed(plan,bytes)});
    check(result.technical.status==='pass','OBSERVED_DESIGN_TECHNICAL');
    applyRecord(store,state,plan);applyRecord(store,state,result);
    for(const record of [spec,review,plan,result])store.append(record);
    return detached({spec,review,plan,result});
  });
}
function preparedMeasuredReference(store, state, planSha256, analysis) {
  const entry = entryFor(state, planSha256); assertCurrent(state, entry.plan); check(entry.result, 'RESULT_REQUIRED');
  return measuredReferenceReviewFiles({ ...entry, bytes: store.readBlob(entry.result.rawSha256) }, analysis);
}
export const buildMeasuredReferenceReview = (root, planSha256, analysis, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedMeasuredReference(store, state, planSha256, analysis))));
export const verifyMeasuredReferenceReview = (root, planSha256, analysis, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedMeasuredReference(store, state, planSha256, analysis))));
export const reviewMeasuredReference = (root, planSha256, analysis, receipt) => run(root, (store, state) => {
  const prepared = preparedMeasuredReference(store, state, planSha256, analysis);
  return commit(store, state, seal({ format: 'ai_scene_measured_reference_review_v1', planSha256, packetSha256: prepared.report.sha256, analysis, receipt,
    reconstructionTarget: receipt.decision === 'accept' ? acceptMeasuredReferenceTarget(prepared, receipt) : null }));
});
export function reinspectNativeReference(root, options) {
  return run(root, (store, state) => commit(store, state, compileReferenceReinspection(store, state, options)));
}
export function freezeNativeReferenceEdit(root, options) {
  return run(root, (store, state) => {
    exact(options, ['planId', 'parents', 'editSourceSha256', 'capabilitiesSha256', 'pixelPolicy', 'intent']);
    return commit(store, state, compileNativeReferenceEdit(state, { ...options, stage: 'reference',
      specSha256: state.activeSpec, styleSha256: state.activeStyle, referencePlans: [], inventoryRefs: [], assetId: 'scene-reference' }));
  });
}
export function freezeTerrainMaterialPlan(root, options) {
  return run(root, (store, state) => {
    exact(options, ['planId', 'parents', 'referencePlanSha256', 'capabilitiesSha256', 'intent']);
    const { referencePlanSha256, ...fields } = options;
    return commit(store, state, compileTerrainMaterial(state, { ...fields, stage: 'terrain-material',
      specSha256: state.activeSpec, styleSha256: state.activeStyle, referencePlans: [referencePlanSha256], inventoryRefs: [],
      assetId: 'terrain.primary.material-source', profileSha256: TERRAIN_PROOF_SHA256 }));
  });
}
export function freezeEnvironmentSourcePlan(root, options) {
  return freezeEnvironment(root, options, compileEnvironmentSource);
}
export function freezeEnvironmentSourcePlanV2(root, options) {
  return freezeEnvironment(root, options, compileEnvironmentSourceV2);
}
export function freezeEnvironmentSupplementPlan(root, options) {
  return freezeEnvironment(root, options, compileEnvironmentSupplement);
}
function freezeEnvironment(root, options, compile) {
  return run(root, (store, state) => {
    check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
    exact(options, ['planId', 'parents', 'referencePlanSha256', 'capabilitiesSha256', 'assetId', 'role', 'sourcePolicy', 'derivation', 'intent']);
    const { referencePlanSha256, ...fields } = options;
    return commit(store, state, compile(state, { ...fields, stage: 'environment-source', specSha256: state.activeSpec,
      styleSha256: state.activeStyle, referencePlans: [referencePlanSha256], inventoryRefs: [] }));
  });
}
export const reinspectEnvironmentSource = (root, options) => run(root, (store, state) =>
  commit(store, state, compileEnvironmentReinspection(store, state, options)));
export const proposeEnvironmentPadding = (root, items) => run(root, (store, state) => detached(compilePaddingProposal(store, state, items)));
export const approveEnvironmentPadding = (root, proposal, decision) => run(root, (store, state) =>
  commit(store, state, seal({ format: 'ai_scene_environment_padding_approval_v1', proposal, receipt: decision })));
export const prepareEnvironmentPadding = (root, options) => run(root, (store, state) => {
  const { record, bytes } = compileEnvironmentPadding(store, state, options);
  store.storeBlob(bytes); return commit(store, state, record);
});
export const proposeSupplementPadding = (root, options) => run(root, (store, state) => detached(compileSupplementPaddingProposal(store, state, options)));
export const approveSupplementPadding = (root, proposal, decision) => run(root, (store, state) =>
  commit(store, state, seal({ format: 'ai_scene_supplement_padding_approval_v1', proposal, receipt: decision })));
export const prepareSupplementPadding = (root, options) => run(root, (store, state) => {
  const { record, bytes } = compileSupplementPadding(store, state, options);
  store.storeBlob(bytes); return commit(store, state, record);
});
function preparedEnvironmentProof(store, state, planSha256, layoutStudy = null) {
  const entry = entryFor(state, planSha256);
  check(['ai_scene_generation_plan_v5', 'ai_scene_generation_plan_v6', 'ai_scene_generation_plan_v7', 'ai_scene_environment_reinspection_v1', 'ai_scene_environment_preparation_v1', 'ai_scene_environment_preparation_v2'].includes(entry.plan.format)
    && ['pending-visual-review', 'accepted'].includes(entry.status)
    && entry.result?.technical.status === 'pass', 'ENVIRONMENT_SOURCE_NOT_READY');
  assertCurrent(state, entry.plan);
  return environmentProofFiles(store.readBlob(entry.result.rawSha256), { purpose: store.metadata.purpose, planSha256,
    requestSha256: digest(entry.plan.request), rawSha256: entry.result.rawSha256, technicalSha256: entry.result.technical.sha256 }, entry.plan, layoutStudy);
}
export const buildEnvironmentProofBundle = (root, planSha256, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedEnvironmentProof(store, state, planSha256))));
export const verifyEnvironmentProofBundle = (root, planSha256, outputRoot) => run(root, (store, state) => {
  const prepared = preparedEnvironmentProof(store, state, planSha256);
  return detached({ ...verifyProofBundle(outputRoot, prepared), format: 'ai_scene_environment_proof_verification_v1',
    environmentStatus: prepared.report.status, seam: prepared.report.seam });
});
export const buildEnvironmentLayoutStudy = (root, planSha256, options, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedEnvironmentProof(store, state, planSha256, options))));
export const verifyEnvironmentLayoutStudy = (root, planSha256, options, outputRoot) => run(root, (store, state) => {
  const prepared = preparedEnvironmentProof(store, state, planSha256, options);
  return detached({ ...verifyProofBundle(outputRoot, prepared), format: 'ai_scene_environment_layout_study_verification_v1',
    environmentStatus: prepared.report.status, layoutStudy: prepared.report.layoutStudy, seam: prepared.report.seam });
});
function preparedFiniteEnvironment(store, state, planSha256, baseKit, options) {
  exact(options, ['exampleId', 'parallax', 'layoutStudy']);
  const entry = entryFor(state, planSha256);
  check(entry.status === 'accepted', 'ENVIRONMENT_SOURCE_ACCEPTANCE_REQUIRED');
  return finiteEnvironmentFiles(baseKit, preparedEnvironmentProof(store, state, planSha256, options.layoutStudy), entry.review,
    { exampleId: options.exampleId, parallax: options.parallax });
}
export const buildFiniteEnvironmentDemo = (root, planSha256, baseKit, options, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedFiniteEnvironment(store, state, planSha256, baseKit, options))));
export const verifyFiniteEnvironmentDemo = (root, planSha256, baseKit, options, outputRoot) => run(root, (store, state) => {
  const prepared = preparedFiniteEnvironment(store, state, planSha256, baseKit, options);
  return detached({ ...verifyProofBundle(outputRoot, prepared), format: 'ai_scene_finite_environment_verification_v1',
    coverage: prepared.report, loopingCertified: false });
});
function terrainProofSource(store, state, planSha256) {
  const entry = entryFor(state, planSha256);
  check(entry.plan.format === 'ai_scene_generation_plan_v4' && ['pending-visual-review', 'accepted'].includes(entry.status)
    && entry.result?.technical.status === 'pass', 'MATERIAL_SOURCE_NOT_READY');
  assertCurrent(state, entry.plan);
  return { raw: store.readBlob(entry.result.rawSha256), evidence: { purpose: store.metadata.purpose,
    planSha256, requestSha256: digest(entry.plan.request), rawSha256: entry.result.rawSha256,
    technicalSha256: entry.result.technical.sha256 } };
}
function preparedTerrainProof(store, state, planSha256) {
  const { raw, evidence } = terrainProofSource(store, state, planSha256); return proofFiles(raw, evidence);
}
export const buildTerrainProofBundle = (root, planSha256, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedTerrainProof(store, state, planSha256))));
export const verifyTerrainProofBundle = (root, planSha256, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedTerrainProof(store, state, planSha256))));
function preparedProofRevision(store, state, planSha256, parentRoot) {
  const { raw, evidence } = terrainProofSource(store, state, planSha256), parent = proofFiles(raw, evidence);
  verifyProofBundle(parentRoot, parent);
  return proofRevisionFiles(raw, evidence, parent.bundle.sha256);
}
export const reviseTerrainProofBundle = (root, planSha256, parentRoot, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedProofRevision(store, state, planSha256, parentRoot))));
export const verifyTerrainProofRevision = (root, planSha256, parentRoot, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedProofRevision(store, state, planSha256, parentRoot))));
function preparedModuleStudy(store, state, planSha256, originalRoot, revisionRoot, producer = moduleStudyFiles) {
  check(entryFor(state, planSha256).status === 'accepted', 'MATERIAL_SOURCE_ACCEPTANCE_REQUIRED');
  const parent = preparedProofRevision(store, state, planSha256, originalRoot);
  verifyProofBundle(revisionRoot, parent);
  const { raw, evidence } = terrainProofSource(store, state, planSha256);
  return producer(raw, evidence, parent.bundle.sha256);
}
export const buildTerrainModuleStudy = (root, planSha256, originalRoot, revisionRoot, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedModuleStudy(store, state, planSha256, originalRoot, revisionRoot))));
export const verifyTerrainModuleStudy = (root, planSha256, originalRoot, revisionRoot, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedModuleStudy(store, state, planSha256, originalRoot, revisionRoot))));
export const buildTerrainContinuityStudy = (root, planSha256, originalRoot, revisionRoot, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedModuleStudy(store, state, planSha256, originalRoot, revisionRoot, continuityStudyFiles))));
export const verifyTerrainContinuityStudy = (root, planSha256, originalRoot, revisionRoot, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedModuleStudy(store, state, planSha256, originalRoot, revisionRoot, continuityStudyFiles))));
function preparedLongFieldStudy(store, state, planSha256, originalRoot, revisionRoot, baselineRoot) {
  const baseline = preparedModuleStudy(store, state, planSha256, originalRoot, revisionRoot, continuityStudyFiles);
  verifyProofBundle(baselineRoot, baseline);
  const { raw, evidence } = terrainProofSource(store, state, planSha256);
  return longFieldStudyFiles(raw, evidence, baseline.bundle.sha256);
}
export const buildTerrainLongFieldStudy = (root, planSha256, originalRoot, revisionRoot, baselineRoot, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedLongFieldStudy(store, state, planSha256, originalRoot, revisionRoot, baselineRoot))));
export const verifyTerrainLongFieldStudy = (root, planSha256, originalRoot, revisionRoot, baselineRoot, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedLongFieldStudy(store, state, planSha256, originalRoot, revisionRoot, baselineRoot))));
export const loadTerrainStudyPreview = (root, planSha256, originalRoot, revisionRoot, studyRoot) => run(root, (store, state) => {
  const prepared = preparedModuleStudy(store, state, planSha256, originalRoot, revisionRoot, continuityStudyFiles);
  verifyProofBundle(studyRoot, prepared);
  return createTerrainStudyPreview(prepared);
});
export { readTerrainStudyPreviewImage } from '../terrain-proof/preview.mjs';
function preparedSceneCandidate(store, state, baseKit, options, terrainRoots) {
  exact(options, ['candidateId', 'materialPlanSha256', 'environmentPlanSha256', 'environmentOptions']);
  exact(terrainRoots, ['originalRoot', 'revisionRoot', 'studyRoot']);
  const finite = preparedFiniteEnvironment(store, state, options.environmentPlanSha256, baseKit, options.environmentOptions);
  const terrain = preparedModuleStudy(store, state, options.materialPlanSha256, terrainRoots.originalRoot, terrainRoots.revisionRoot, continuityStudyFiles);
  verifyProofBundle(terrainRoots.studyRoot, terrain);
  return sceneCandidateFiles(finite, terrain, entryFor(state, options.materialPlanSha256).review, { candidateId: options.candidateId });
}
export const buildSceneCandidate = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedSceneCandidate(store, state, baseKit, options, terrainRoots))));
export const verifySceneCandidate = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) => {
  const prepared = preparedSceneCandidate(store, state, baseKit, options, terrainRoots);
  return detached({ ...verifyProofBundle(outputRoot, prepared), format: 'ai_scene_candidate_verification_v1', readiness: prepared.report });
});
function preparedReviewCandidate(store, state, baseKit, options, terrainRoots) {
  exact(options, ['reviewId', 'baseCandidate', 'environmentSources', ...(Object.hasOwn(options, 'layoutRevision') ? ['layoutRevision'] : [])]);
  exact(options.environmentSources, Object.keys(REVIEW_ROLES));
  const base = preparedSceneCandidate(store, state, baseKit, options.baseCandidate, terrainRoots), environments = {};
  for (const slot of Object.keys(REVIEW_ROLES)) {
    const binding = options.environmentSources[slot]; exact(binding, ['planSha256', 'layoutStudy']);
    const entry = entryFor(state, binding.planSha256);
    const prepared = preparedEnvironmentProof(store, state, binding.planSha256, binding.layoutStudy);
    environments[slot] = { prepared, plan: entry.plan, status: entry.status, review: entry.review,
      ...(entry.kind === 'environment-preparation' ? { approval: state.paddingApprovals.get(entry.plan.approvalSha256),
        original: store.readBlob(entry.plan.originalRawSha256) } : {}) };
  }
  return reviewCandidateFiles(base, environments, options.reviewId, options.layoutRevision);
}
export const buildSceneReviewCandidate = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedReviewCandidate(store, state, baseKit, options, terrainRoots))));
export const verifySceneReviewCandidate = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) => {
  const prepared = preparedReviewCandidate(store, state, baseKit, options, terrainRoots);
  return detached({ ...verifyProofBundle(outputRoot, prepared), format: 'ai_scene_review_candidate_verification_v1', readiness: prepared.report });
});
function preparedReferenceScene(store, state, baseKit, options, terrainRoots) {
  exact(options, ['studyId', 'reviewCandidate', ...(Object.hasOwn(options, 'layoutRevision') ? ['layoutRevision'] : [])]);
  const base = preparedReviewCandidate(store, state, baseKit, options.reviewCandidate, terrainRoots);
  const materialSha = options.reviewCandidate.baseCandidate.materialPlanSha256;
  const terrain = preparedModuleStudy(store, state, materialSha, terrainRoots.originalRoot, terrainRoots.revisionRoot, referenceFieldStudyFiles);
  return referenceSceneFiles(base, terrain, options.studyId, options.layoutRevision);
}
export const buildSceneReferenceStudy = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedReferenceScene(store, state, baseKit, options, terrainRoots))));
export const verifySceneReferenceStudy = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) => {
  const prepared = preparedReferenceScene(store, state, baseKit, options, terrainRoots);
  return detached({ ...verifyProofBundle(outputRoot, prepared), format: 'ai_scene_reference_composition_verification_v1', readiness: prepared.report });
});
function preparedSupplementScene(store, state, baseKit, options, terrainRoots) {
  exact(options, ['studyId', 'referenceStudy', 'sources']); exact(options.sources, Object.keys(SUPPLEMENT_SCENE_ROLES));
  const base = preparedReferenceScene(store, state, baseKit, options.referenceStudy, terrainRoots), sources = {};
  for (const key of Object.keys(SUPPLEMENT_SCENE_ROLES)) {
    const binding = options.sources[key]; exact(binding, ['planSha256']);
    const entry = entryFor(state, binding.planSha256); check(entry.status === 'accepted', 'SUPPLEMENT_SOURCE_ACCEPTANCE_REQUIRED');
    sources[key] = { prepared: preparedEnvironmentProof(store, state, binding.planSha256), plan: entry.plan, status: entry.status, review: entry.review,
      ...(entry.kind === 'environment-preparation' ? { approval: state.paddingApprovals.get(entry.plan.approvalSha256),
        original: store.readBlob(entry.plan.originalRawSha256), originalPlan: entryFor(state, entry.plan.sourcePlanSha256).plan } : {}) };
  }
  return supplementSceneFiles(base, sources, options.studyId);
}
export const buildSceneSupplementStudy = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedSupplementScene(store, state, baseKit, options, terrainRoots))));
export const verifySceneSupplementStudy = (root, baseKit, options, terrainRoots, outputRoot) => run(root, (store, state) => {
  const prepared = preparedSupplementScene(store, state, baseKit, options, terrainRoots);
  return detached({ ...verifyProofBundle(outputRoot, prepared), format: 'ai_scene_supplement_composition_verification_v1', readiness: prepared.report });
});
export function freezeModuleBatch(root, handle, options) {
  return run(root, (store, state) => {
    exact(options, ['batchId', 'referencePlanSha256', 'capabilitiesSha256', 'intent']);
    id(options.batchId);
    const context = contextFor(handle);
    const modules = context.catalog.modules.toSorted((a, b) => compareText(a.assetId, b.assetId)).map(module => ({
      assetId: module.assetId, kind: module.kind, pixelSize: module.pixelSize, footprint: module.footprint,
      anchorPx: module.anchorPx, visualOffset: module.visualOffset, repeatAxis: module.repeatAxis,
      signatures: context.rules.entries.filter(entry => entry.variantAssetIds.includes(module.assetId)).map(entry => entry.signature),
    }));
    const inventory = seal({ format: 'ai_scene_generation_inventory_v1', inventoryId: derivedId('inventory', [options.batchId, 'inventory']),
      sourceKitSha256: context.bundleSha256, kitRef: { kitId: context.kit.kitId, revision: context.kit.revision },
      grid: context.kit.grid, pixelsPerUnit: context.kit.pixelsPerUnit, modules });
    // Validate the entire group before appending any plan; disk failures remain fail-closed evidence.
    applyRecord(store, state, inventory);
    const plans = modules.map(module => {
      const plan = compilePlan(state, { planId: derivedId('module', [options.batchId, module.assetId]), parents: [], stage: 'module',
        specSha256: state.activeSpec, styleSha256: state.activeStyle, capabilitiesSha256: options.capabilitiesSha256,
        referencePlans: [options.referencePlanSha256], inventoryRefs: [inventory.sha256], assetId: module.assetId,
        pixelSize: module.pixelSize, intent: options.intent });
      applyRecord(store, state, plan); return plan;
    });
    const batch = seal({ format: 'ai_scene_generation_batch_v1', batchId: options.batchId, inventorySha256: inventory.sha256,
      referencePlanSha256: options.referencePlanSha256, parents: [], planSha256s: plans.map(plan => plan.sha256),
      maximumImageRequests: plans.length, newImageRequests: plans.length });
    applyRecord(store, state, batch);
    for (const record of [inventory, ...plans, batch]) store.append(record);
    return detached(batch);
  });
}
// Explicit revisions keep the failed/unknown/rejected predecessor intact. No implicit retry path.
export function reviseGenerationPlan(root, parentSha256, options) {
  exact(options, ['planId', 'capabilitiesSha256', 'intent']);
  const { planId, capabilitiesSha256, intent } = options;
  return run(root, (store, state) => {
    const parent = entryFor(state, parentSha256);
    check(parent.plan.format !== 'ai_scene_reference_candidate_v1', 'CANDIDATE_NOT_GENERATION');
    check(!parent.plan.recipe.sourceDependency,'SOURCE_DEPENDENCY_EXPLICIT_REVISION');
    check(!['reference-reinspection', 'environment-reinspection', 'environment-preparation', 'scene-source-recovery', 'scene-native-border','coherent-border-preparation','coherent-canvas-gutter-preparation','coherent-native-frame-preparation','coherent-rebind'].includes(parent.kind), 'REINSPECTION_NOT_GENERATION');
    check(['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status), 'REVISION_REQUIRES_TERMINAL_PARENT');
    const compile = parent.plan.format === 'ai_scene_generation_plan_v32' ? (s,r)=>compileCoherentReferenceV3(s,r,sha=>store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v31' ? compileCoherentReferenceV2
      : parent.plan.format === 'ai_scene_generation_plan_v28' ? compileCoherentReference
      : parent.plan.format === 'ai_scene_generation_plan_v27' ? (s,r)=>compileCoherentSource(s,r,sha=>store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v26' ? (s, r) => compileMaterialPaintPlan(s, r, sha => store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v25' ? (s, r) => compilePaintSourcePlan(s, r, sha => store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v24' ? (s, r) => compileRegionGuidedAsset(s, r, sha => store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v23' ? (s, r) => compileReferenceAssetSingleInput(s, r, sha => store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v22' ? (s, r) => compileReferenceAssetEdit(s, r, sha => store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v21' ? (s, r) => compileReferenceAsset(s, r, sha => store.readBlob(sha))
      : parent.plan.format === 'ai_scene_generation_plan_v20' ? compileControlledReference
      : parent.plan.format === 'ai_scene_generation_plan_v19' ? compileReferenceLedIsolation
      : parent.plan.format === 'ai_scene_generation_plan_v18' ? compileReferenceLedPlan
      : parent.plan.format === 'ai_scene_generation_plan_v17' ? compileReferenceInputExperiment
      : parent.plan.format === 'ai_scene_generation_plan_v16' ? compileFlexibleReference
      : parent.plan.format === 'ai_scene_generation_plan_v15' ? compileStandardReference
      : ['ai_scene_generation_plan_v13', 'ai_scene_generation_plan_v14'].includes(parent.plan.format) ? compileExplicitSceneSource
      : parent.plan.format === 'ai_scene_generation_plan_v12' ? compileScopedSceneSource
      : parent.plan.format === 'ai_scene_generation_plan_v10' ? compileLayeredSceneReference
      : parent.plan.format === 'ai_scene_generation_plan_v11' ? compileLayeredSceneSource
      : parent.plan.format === 'ai_scene_generation_plan_v9' ? compileSceneReference
      : parent.plan.format === 'ai_scene_generation_plan_v8' ? compileSceneSource
      : parent.plan.format === 'ai_scene_generation_plan_v7' ? compileEnvironmentSupplement
      : parent.plan.format === 'ai_scene_generation_plan_v6' ? compileEnvironmentSourceV2
      : parent.plan.format === 'ai_scene_generation_plan_v5' ? compileEnvironmentSource
      : parent.plan.format === 'ai_scene_generation_plan_v4' ? compileTerrainMaterial
      : parent.plan.format === 'ai_scene_generation_plan_v3' ? compileNativeReferenceEdit
      : parent.plan.format === 'ai_scene_generation_plan_v2' ? compileNativeReference : compilePlan;
    const plan = compile(state, { ...parent.plan.recipe, planId, capabilitiesSha256, intent, parents: [parentSha256],
      specSha256: state.activeSpec, styleSha256: state.activeStyle });
    return commit(store, state, plan);
  });
}
export function reviseModuleBatch(root, parentSha256, options) {
  exact(options, ['batchId', 'replacements']);
  return run(root, (store, state) => {
    const parent = state.batches.get(parentSha256); check(parent, 'BATCH_MISSING');
    check(Array.isArray(options.replacements) && options.replacements.length > 0 && options.replacements.length <= parent.planSha256s.length, 'BATCH_REPLACEMENTS');
    const replacements = new Map();
    for (const replacement of options.replacements) {
      exact(replacement, ['assetId', 'planSha256']); check(!replacements.has(replacement.assetId), 'BATCH_REPLACEMENTS');
      replacements.set(replacement.assetId, replacement.planSha256);
    }
    const plans = parent.planSha256s.map(sha256 => {
      const assetId = entryFor(state, sha256).plan.recipe.assetId;
      if (!replacements.has(assetId)) return sha256;
      const next = replacements.get(assetId); replacements.delete(assetId); return next;
    });
    check(!replacements.size, 'BATCH_REPLACEMENTS');
    const { sha256: _digest, ...prior } = parent;
    return commit(store, state, seal({ ...prior, batchId: options.batchId, parents: [parentSha256],
      planSha256s: plans, newImageRequests: options.replacements.length }));
  });
}
export function authorizePlan(root, planSha256, decision) {
  return run(root, (store, state) => commit(store, state, seal({ format: 'ai_scene_compute_authorization_v1',
    planSha256, nonce: randomBytes(16).toString('hex'), maximumCalls: 1, receipt: decision })));
}
export function reservePlan(root, planSha256) {
  return run(root, (store, state) => {
    const entry = entryFor(state, planSha256);
    check(entry.authorization, 'AUTHORIZATION_REQUIRED');
    const attempt = commit(store, state, seal({ format: 'ai_scene_attempt_reservation_v1', planSha256,
      authorizationSha256: entry.authorization.sha256, requestSha256: digest(entry.plan.request) }));
    // The reservation is fsync'ed before any executable exchange request is returned.
    return detached({ planSha256, attemptSha256: attempt.sha256, requestSha256: attempt.requestSha256, request: entry.plan.request });
  });
}
// Batch-scoped selection and reservation share one locked replay. The generic
// reservePlan API retains its historical, plan-scoped contract.
export function reserveNextTerrainEdgePlan(root,batchSha256,expectedPlanSha256){
  check(isDigest(batchSha256)&&isDigest(expectedPlanSha256),'TERRAIN_EDGE_BATCH');
  return run(root,(store,state)=>{
    const batch=state.batches.get(batchSha256);
    check(TERRAIN_EDGE_BATCH_FORMATS.includes(batch?.format),'TERRAIN_EDGE_BATCH');
    const entries=batch.planSha256s.map(sha=>entryFor(state,sha));
    const replacement=assertTerrainEdgeRecoveryConfirmation(batch,entries);
    check(!entries.some(entry=>['failed','indeterminate','rejected-technical','rejected-visual','reserved','submitted'].includes(entry.status)),
      'TERRAIN_EDGE_BATCH_STOPPED');
    const entry=replacement??entries.find(item=>item.status==='authorized');check(entry,'TERRAIN_EDGE_NOT_AUTHORIZED');
    check(entry.plan.sha256===expectedPlanSha256,'TERRAIN_EDGE_NEXT_CHANGED');
    check(entry.authorization,'AUTHORIZATION_REQUIRED');
    const attempt=commit(store,state,seal({format:'ai_scene_attempt_reservation_v1',planSha256:entry.plan.sha256,
      authorizationSha256:entry.authorization.sha256,requestSha256:digest(entry.plan.request)}));
    return detached({planSha256:entry.plan.sha256,attemptSha256:attempt.sha256,requestSha256:attempt.requestSha256,request:entry.plan.request});
  });
}
function attemptRecord(root, format, ticket, extra = {}) {
  exact(ticket, ['planSha256', 'attemptSha256', 'requestSha256']);
  return run(root, (store, state) => commit(store, state, seal({ format, ...ticket, ...extra })));
}
export const recordSubmission = (root, ticket) => attemptRecord(root, 'ai_scene_submission_v1', ticket);
export const stopAttempt = (root, ticket, outcome) => attemptRecord(root, 'ai_scene_terminal_v1', ticket, { outcome });
export function receiveResult(root, ticket, bytes) {
  exact(ticket, ['planSha256', 'attemptSha256', 'requestSha256']);
  return run(root, (store, state) => {
    const entry = entryFor(state, ticket.planSha256);
    check(['reserved', 'submitted'].includes(entry.status) && entry.attempt.sha256 === ticket.attemptSha256
      && entry.attempt.requestSha256 === ticket.requestSha256, 'ATTEMPT_NOT_PENDING');
    const raw = store.storeBlob(bytes), technical = assessResult(entry.plan, store.readBlob(raw.sha256));
    return commit(store, state, seal({ format: 'ai_scene_generation_result_v1', ...ticket,
      rawSha256: raw.sha256, byteLength: raw.byteLength, technical }));
  });
}
export function recheckResult(root, planSha256, rawSha256) {
  return run(root, (store, state) => {
    const entry = entryFor(state, planSha256);
    check(entry.result?.rawSha256 === rawSha256, 'RAW_SOURCE_MISMATCH');
    const technical = reassessEntry(state, entry, store.readBlob(rawSha256));
    check(technical.sha256 === entry.result.technical.sha256, 'RESULT_REPLAY_MISMATCH');
    return detached(technical);
  });
}
export function reviewResult(root, planSha256, decision) {
  return run(root, (store, state) => {
    const entry = entryFor(state, planSha256); check(entry.result, 'RESULT_REQUIRED');
    return commit(store, state, seal({ format: 'ai_scene_image_review_v1', planSha256,
      technicalSha256: entry.result.technical.sha256, receipt: decision }));
  });
}
export const getGenerationPlan = (root, planSha256) => run(root, (_store, state) => detached(entryFor(state, planSha256).plan));
function generationInput(store,state,planSha256,imageIndex){
  const plan=entryFor(state,planSha256).plan;if(plan.recipe.sourceDependency){assertCurrent(state,plan);assertLatestDependencyBatch(state,plan);}const images = plan.request.images;
  check(Array.isArray(images) && Number.isSafeInteger(imageIndex) && imageIndex >= 0 && imageIndex < images.length, 'INPUT_IMAGE_INDEX');
  // Replay already verifies every producer of these artifact references. The
  // store additionally verifies raw hashes; no path-selected file access.
  const ref = images[imageIndex].artifact, bytes = store.readBlob(ref.sha256);
  check(bytes.length === ref.byteLength, 'IMAGE_REFERENCE'); return bytes;
}
export const readGenerationInput = (root, planSha256, imageIndex) => run(root, (store, state) => generationInput(store,state,planSha256,imageIndex));
function workflowInspection(store,state){
  return detached({ format: 'ai_scene_workflow_status_v1', projectId: store.metadata.projectId,
    purpose: store.metadata.purpose, executionMode: 'external-exchange-only', activeSpecSha256: state.activeSpec,
    activeStyleSha256: state.activeStyle, eventCount: store.events.length,
    plans: [...state.plans.values()].map(entry => {
      let current = true; try { assertCurrent(state, entry.plan); } catch { current = false; }
      return { planId: entry.plan.recipe.planId, planSha256: entry.plan.sha256, stage: entry.plan.recipe.stage, status: entry.status,
        current, maximumCalls: entry.plan.request.maximumCalls,
        ...(entry.plan.format==='ai_scene_generation_plan_v31'?{referenceGuidanceProfile:entry.plan.recipe.referenceGuidanceProfile}:{}),
        ...(entry.plan.format==='ai_scene_generation_plan_v32'?{referenceGuidanceProfile:entry.plan.recipe.referenceGuidanceProfile,compositionGuideSha256:entry.plan.recipe.compositionGuideSha256}:{}),
        ...(entry.plan.composition ? { layerDesignSha256: entry.plan.composition.layerDesignSha256 } : {}),
        ...(entry.kind ? { kind: entry.kind, sourcePlanSha256: entry.plan.sourcePlanSha256 } : {}),
        ...(['ai_scene_coherent_canvas_gutter_preparation_v2','ai_scene_terrain_edge_canvas_gutter_preparation_v1'].includes(entry.plan.format)?{
          preparationFormat:entry.plan.format,preparationProfile:entry.plan.proposal.rule.profile,originalTechnicalStatus:'fail'}:{}),
        reserved: Boolean(entry.attempt), received: Boolean(entry.result),
        ...(entry.result ? { rawSha256: entry.result.rawSha256, technicalStatus: entry.result.technical.status } : {}),
        ...(entry.result?.technical.warnings?.length ? { warnings: entry.result.technical.warnings } : {}),
        ...(entry.reconstructionTarget ? { reconstructionTargetSha256: entry.reconstructionTarget.sha256 } : {}) };
    }), batches: [...state.batches.keys()],...(state.compositionGuides?.size?{compositionGuides:[...state.compositionGuides.values()].map(guide=>({
      sha256:guide.sha256,specSha256:guide.specSha256,requirementsSha256:guide.requirementsSha256,imageSha256:guide.image.sha256}))}:{}),
    coreProviderCalls: 0, externalProviderCalls: 'not-observed', packageVisualAcceptance: 'not-assessed' });
}
export const inspectWorkflow=root=>run(root,workflowInspection);
// One fresh locked read/hash/replay supplies detached metadata for a coherent
// read operation. This is not a cache, write context or authorization token.
export function readCoherentWorkflowView(root,{includeCurrentInputs=false}={}){
  check(typeof includeCurrentInputs==='boolean','COHERENT_READ_VIEW_OPTIONS');
  return run(root,(store,state)=>{
    const inspection=workflowInspection(store,state),batches=detached([...state.batches.values()].filter(batch=>
      ['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(batch.format)));
    const plans=detached([...state.plans.values()].map(entry=>entry.plan)),inputs=new Map();
    if(includeCurrentInputs){
      const reference=inspection.plans.findLast(plan=>plan.current&&plan.stage==='reference');
      const batch=batches.findLast(batch=>batch.referencePlanSha256===reference?.planSha256);
      const selected=reference?.status==='accepted'?(batch?.planSha256s??[]):reference?[reference.planSha256]:[];
      for(const sha of selected){const plan=entryFor(state,sha).plan;if(plan.request.maximumCalls===0)continue;
        for(let index=0;index<plan.request.images.length;index++){
          const bytes=generationInput(store,state,sha,index),ref=plan.request.images[index].artifact;
          if(inputs.has(ref.sha256))check(inputs.get(ref.sha256).equals(bytes),'IMAGE_REFERENCE');else inputs.set(ref.sha256,bytes);
        }
      }
    }
    return Object.freeze({inspection,plans,batches,inputs});
  });
}
// One locked replay for read-only edge review/export. Prepared zero-call
// records have no input-image request and are never read as executable plans.
export function readTerrainEdgeWorkflowView(root,{batchSha256,includeCurrentInputs=false,includeResults=false,reservedInputPlanSha256=null}={}){
  check(isDigest(batchSha256)&&typeof includeCurrentInputs==='boolean'&&typeof includeResults==='boolean'
    &&(reservedInputPlanSha256===null||isDigest(reservedInputPlanSha256)&&!includeCurrentInputs),'TERRAIN_EDGE_READ_VIEW_OPTIONS');
  return run(root,(store,state)=>{
    const batch=state.batches.get(batchSha256);check(TERRAIN_EDGE_BATCH_FORMATS.includes(batch?.format),'TERRAIN_EDGE_BATCH');
    if(reservedInputPlanSha256!==null){const reserved=entryFor(state,reservedInputPlanSha256);
      check(batch.planSha256s.includes(reservedInputPlanSha256)&&reserved.attempt,'TERRAIN_EDGE_READ_VIEW_OPTIONS');}
    const inputs=new Map(),results=new Map(),selected=new Set(batch.planSha256s);
    for(const sha of batch.planSha256s){const e=entryFor(state,sha);if(e.plan.sourcePlanSha256)selected.add(e.plan.sourcePlanSha256);
      if((includeCurrentInputs||reservedInputPlanSha256===sha)&&e.plan.request.maximumCalls!==0){if(includeCurrentInputs)assertCurrent(state,e.plan);
        for(let index=0;index<e.plan.request.images.length;index++){const image=e.plan.request.images[index].artifact,bytes=generationInput(store,state,sha,index);
          if(inputs.has(image.sha256))check(inputs.get(image.sha256).equals(bytes),'IMAGE_REFERENCE');else inputs.set(image.sha256,bytes);}}
    }
    if(includeResults)for(const sha of selected){const e=entryFor(state,sha);if(e.result)results.set(sha,{result:detached(e.result),bytes:store.readBlob(e.result.rawSha256),status:e.status});}
    const predecessorTerminal=batch.terminalSha256?entryFor(state,batch.failedPlanSha256).terminal:null;
    return Object.freeze({inspection:workflowInspection(store,state),batch:detached(batch),
      ...(predecessorTerminal?{predecessorTerminal:detached(predecessorTerminal)}:{}),
      batches:detached([...state.batches.values()].filter(b=>TERRAIN_EDGE_BATCH_FORMATS.includes(b.format))),
      plans:detached([...selected].map(sha=>entryFor(state,sha).plan)),inputs,results});
  });
}
export function inspectModuleBatch(root, batchSha256) {
  return run(root, (_store, state) => {
    const batch = state.batches.get(batchSha256); check(batch, 'BATCH_MISSING');
    const inventory = state.inventories.get(batch.inventorySha256), issues = [], terrainImages = new Map(), seen = new Set();
    const outputs = batch.planSha256s.map(planSha256 => {
      const entry = entryFor(state, planSha256), module = inventory.modules.find(module => module.assetId === entry.plan.recipe.assetId);
      try { assertCurrent(state, entry.plan); } catch { issues.push({ assetId: module.assetId, code: 'PLAN_STALE' }); }
      if (entry.status !== 'accepted') issues.push({ assetId: module.assetId, code: 'IMAGE_REVIEW_INCOMPLETE' });
      if (entry.status === 'accepted') for (const signature of module.signatures) {
        const previous = terrainImages.get(entry.result.rawSha256);
        if (previous !== undefined && previous !== signature) issues.push({ assetId: module.assetId, code: 'TERRAIN_ART_REUSED' });
        terrainImages.set(entry.result.rawSha256, signature); seen.add(signature);
      }
      return { assetId: module.assetId, planSha256, status: entry.status,
        ...(entry.result ? { image: entry.result.technical.image, technicalSha256: entry.result.technical.sha256 } : {}),
        ...(entry.review ? { reviewSha256: entry.review.sha256 } : {}) };
    });
    check(inventory.modules.filter(module => module.kind === 'terrain').length >= SIGNATURES.length, 'INVENTORY_COVERAGE');
    return detached({ format: 'ai_scene_module_readiness_v1', batchSha256, inventorySha256: inventory.sha256,
      purpose: _store.metadata.purpose, reviewEvidenceClass: _store.metadata.purpose === 'synthetic-simulation' ? 'fixture-decisions' : 'operator-relayed-decisions',
      referencePlanSha256: batch.referencePlanSha256, status: issues.length ? 'incomplete-or-stale' : 'individual-reviews-recorded',
      requiredTerrainRoleCount: 47, reviewedTerrainRoleCount: seen.size, maximumImageRequests: batch.maximumImageRequests,
      outputs, issues, packageAssembly: 'not-run', packageVisualAcceptance: 'not-assessed', coreProviderCalls: 0 });
  });
}

function sourceParentsFor(options) {
  const parents = new Map();
  if (!Object.hasOwn(options, 'sourceParents')) return parents;
  check(Array.isArray(options.sourceParents) && options.sourceParents.length <= SCENE_SOURCE_SLOTS.length, 'SOURCE_PLAN_PARENTS');
  for (const row of options.sourceParents) {
    exact(row, ['slot', 'planSha256']);
    check(SCENE_SOURCE_SLOTS.some(slot => slot.key === row.slot) && !parents.has(row.slot)
      && typeof row.planSha256 === 'string' && /^[a-f0-9]{64}$/.test(row.planSha256), 'SOURCE_PLAN_PARENTS');
    parents.set(row.slot, row.planSha256);
  }
  return parents;
}
export function freezeSceneSourceBatch(root, options) {
  return run(root, (store, state) => {
    check(!['ai_scene_generation_plan_v15', 'ai_scene_generation_plan_v16', 'ai_scene_generation_plan_v17', 'ai_scene_generation_plan_v18', 'ai_scene_generation_plan_v19', 'ai_scene_generation_plan_v20','ai_scene_generation_plan_v28','ai_scene_generation_plan_v31','ai_scene_generation_plan_v32', 'ai_scene_reference_candidate_v1'].includes(entryFor(state, options.referencePlanSha256).plan.format), 'STANDARD_RECONSTRUCTION_NOT_IMPLEMENTED');
    const scoped = Object.hasOwn(options, 'sourceCompiler');
    exact(options, ['batchId', 'referencePlanSha256', 'capabilitiesSha256', 'intent', ...(scoped ? ['sourceCompiler'] : []),
      ...(Object.hasOwn(options, 'sourceParents') ? ['sourceParents'] : [])]); id(options.batchId);
    check(!scoped || options.sourceCompiler === 'isolated-role-v1', 'SOURCE_COMPILER');
    check(!Object.hasOwn(options, 'sourceParents') || scoped, 'SOURCE_PLAN_PARENTS');
    const parents = sourceParentsFor(options);
    check(options.batchId.length <= 60, 'SOURCE_BATCH_ID');
    check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
    const compile = scoped ? compileScopedSceneSource : entryFor(state, options.referencePlanSha256).plan.format === 'ai_scene_generation_plan_v10'
      ? compileLayeredSceneSource : compileSceneSource;
    const plans = SCENE_SOURCE_SLOTS.map(slot => compile(state, { planId: `${options.batchId}.${slot.key}`,
      parents: parents.has(slot.key) ? [parents.get(slot.key)] : [], stage: 'environment-source', specSha256: state.activeSpec, styleSha256: state.activeStyle,
      capabilitiesSha256: options.capabilitiesSha256, referencePlans: [options.referencePlanSha256], inventoryRefs: [],
      assetId: `scene.${slot.key}`, slot: slot.key, intent: options.intent }));
    for (const plan of plans) applyRecord(store, state, plan);
    const batch = seal({ format: 'ai_scene_source_batch_v1', batchId: options.batchId, profileSha256: SCENE_SOURCE_PROFILE_SHA256,
      referencePlanSha256: options.referencePlanSha256, planSha256s: plans.map(plan => plan.sha256), maximumImageRequests: plans.length });
    applyRecord(store, state, batch);
    for (const record of [...plans, batch]) store.append(record);
    return detached(batch);
  });
}
export const freezeSceneReferencePlan = (root, options) => run(root, (store, state) => {
  const layered = Object.hasOwn(options, 'layerDesign');
  exact(options, ['planId', 'parents', 'capabilitiesSha256', 'pixelPolicy', 'intent', ...(layered ? ['layerDesign'] : [])]);
  const compile = layered ? compileLayeredSceneReference : compileSceneReference;
  return commit(store, state, compile(state, { ...options, stage: 'reference', specSha256: state.activeSpec,
    styleSha256: state.activeStyle, referencePlans: [], inventoryRefs: [], assetId: 'scene-reference' }));
});
export const previewScopedSceneSources = (root, options) => run(root, (_store, state) => {
  exact(options, ['batchId', 'referencePlanSha256', 'capabilitiesSha256', 'intent',
    ...(Object.hasOwn(options, 'sourceParents') ? ['sourceParents'] : [])]); id(options.batchId);
  check(options.batchId.length <= 60, 'SOURCE_BATCH_ID');
  const parents = sourceParentsFor(options);
  const plans = SCENE_SOURCE_SLOTS.map(slot => compileScopedSceneSource(state, { planId: `${options.batchId}.${slot.key}`,
    parents: parents.has(slot.key) ? [parents.get(slot.key)] : [], stage: 'environment-source', specSha256: state.activeSpec, styleSha256: state.activeStyle,
    capabilitiesSha256: options.capabilitiesSha256, referencePlans: [options.referencePlanSha256], inventoryRefs: [],
    assetId: `scene.${slot.key}`, slot: slot.key, intent: options.intent }));
  return detached(seal({ format: 'ai_scene_scoped_source_proposal_v1', status: 'proposal-only', sourceCompiler: 'isolated-role-v1',
    maximumImageRequests: plans.length, plans, generationCalls: 0 }));
});
// Read-only proposal: absent from the journal, so it cannot be authorized or dispatched.
export const previewLayeredSceneReference = (root, options) => run(root, (_store, state) => {
  exact(options, ['planId', 'parents', 'capabilitiesSha256', 'pixelPolicy', 'intent', 'layerDesign']);
  return detached(seal({ format: 'ai_scene_layered_reference_proposal_v1', status: 'proposal-only', generationCalls: 0,
    plan: compileLayeredSceneReference(state, { ...options, stage: 'reference', specSha256: state.activeSpec,
      styleSha256: state.activeStyle, referencePlans: [], inventoryRefs: [], assetId: 'scene-reference' }) }));
});
export const authorizeSceneSourceBatch = (root, batchSha256, decision) => run(root, (store, state) =>
  commit(store, state, seal({ format: 'ai_scene_source_batch_authorization_v1', batchSha256,
    nonce: randomBytes(16).toString('hex'), receipt: decision })));
export const getSceneSourceBatch = (root, batchSha256) => run(root, (_store, state) => {
  const batch = state.batches.get(batchSha256); check(['ai_scene_source_batch_v1', 'ai_scene_source_batch_v2', 'ai_scene_source_batch_recovery_v1', 'ai_scene_source_batch_preparation_v1'].includes(batch?.format), 'SOURCE_BATCH_REQUIRED'); return detached(batch);
});
export function reviseSceneSourceBatch(root, parentBatchSha256, options) {
  exact(options, ['batchId', 'replacements']); id(options.batchId);
  return run(root, (store, state) => {
    const parent = state.batches.get(parentBatchSha256);
    check(['ai_scene_source_batch_v1', 'ai_scene_source_batch_v2', 'ai_scene_source_batch_recovery_v1', 'ai_scene_source_batch_preparation_v1'].includes(parent?.format), 'SOURCE_BATCH_REQUIRED');
    check(Array.isArray(options.replacements) && options.replacements.length > 0 && options.replacements.length <= SCENE_SOURCE_SLOTS.length, 'SOURCE_BATCH_REPLACEMENT');
    const replacements = new Map();
    for (const replacement of options.replacements) {
      const explicit = Object.hasOwn(replacement, 'sourceCompiler');
      exact(replacement, ['slot', 'planId', 'intent', ...(explicit ? ['sourceCompiler', 'subjectBrief'] : [])]);
      check(!explicit || ['explicit-role-v1', 'alternative-role-v1'].includes(replacement.sourceCompiler), 'SOURCE_COMPILER');
      check(!replacements.has(replacement.slot), 'SOURCE_BATCH_REPLACEMENT');
      replacements.set(replacement.slot, replacement);
    }
    const newPlans = [];
    const plans = parent.planSha256s.map(sha => {
      const entry = entryFor(state, sha), replacement = replacements.get(entry.plan.recipe.slot);
      if (!replacement) return sha;
      replacements.delete(entry.plan.recipe.slot);
      const compile = replacement.sourceCompiler === 'alternative-role-v1' ? compileAlternativeSceneSource
        : replacement.sourceCompiler === 'explicit-role-v1' || ['ai_scene_generation_plan_v13', 'ai_scene_generation_plan_v14'].includes(entry.plan.format) ? compileExplicitSceneSource
        : entry.plan.format === 'ai_scene_generation_plan_v12' ? compileScopedSceneSource
        : entry.plan.format === 'ai_scene_generation_plan_v11' ? compileLayeredSceneSource : compileSceneSource;
      const plan = compile(state, { ...entry.plan.recipe, planId: replacement.planId, parents: [sha], intent: replacement.intent,
        ...(Object.hasOwn(replacement, 'sourceCompiler') ? { subjectBrief: replacement.subjectBrief } : {}) });
      applyRecord(store, state, plan); newPlans.push(plan); return plan.sha256;
    });
    check(replacements.size === 0, 'SOURCE_BATCH_REPLACEMENT');
    const batch = seal({ format: 'ai_scene_source_batch_v2', batchId: options.batchId,
      profileSha256: parent.profileSha256, referencePlanSha256: parent.referencePlanSha256, parentBatchSha256,
      planSha256s: plans, maximumImageRequests: plans.length, newImageRequests: newPlans.length });
    applyRecord(store, state, batch);
    for (const record of [...newPlans, batch]) store.append(record); return detached(batch);
  });
}
export const getGenerationResult = (root, planSha256) => run(root, (store, state) => {
  const entry = entryFor(state, planSha256); check(entry.result, 'RESULT_REQUIRED');
  return { result: detached(entry.result), bytes: store.readBlob(entry.result.rawSha256), status: entry.status };
});
export const proposeSourceRecovery = (root, sourcePlanSha256, handoff, bytes) => run(root, (_store, state) =>
  detached(compileSourceRecoveryProposal(state, sourcePlanSha256, handoff, bytes)));
export const registerRecoveredSource = (root, options, bytes) => run(root, (store, state) => {
  const record = compileSourceRecovery(state, options, bytes);
  store.storeBlob(bytes); return commit(store, state, record);
});
export const proposeNativeBorderPolicy = (root, batchSha256, sourcePlanSha256s) => run(root, (store, state) =>
  detached(compileNativeBorderPolicy(store, state, batchSha256, sourcePlanSha256s)));
export const proposeNativeBorderSubsetPolicy = (root, batchSha256, sourcePlanSha256s) => run(root, (store, state) =>
  detached(compileNativeBorderPolicy(store, state, batchSha256, sourcePlanSha256s, true)));
export const proposeNativeBorderFuturePolicy = (root, options) => run(root, (store, state) =>
  detached(compileNativeBorderFuturePolicy(store, state, options)));
export const approveNativeBorderPolicy = (root, proposal, receipt) => run(root, (store, state) =>
  commit(store, state, seal({ format: 'ai_scene_native_border_policy_approval_v1', proposal, receipt })));
export const prepareNativeBorderSource = (root, options) => run(root, (store, state) => {
  const { record, bytes } = compileNativeBorderPreparation(store, state, options);
  store.storeBlob(bytes); return commit(store, state, record);
});
export const adoptRecoveredSource = (root, parentBatchSha256, recoveryPlanSha256, batchId) => run(root, (store, state) => {
  id(batchId);
  const parent = state.batches.get(parentBatchSha256), recovered = entryFor(state, recoveryPlanSha256);
  check(['ai_scene_source_batch_v1', 'ai_scene_source_batch_v2', 'ai_scene_source_batch_recovery_v1', 'ai_scene_source_batch_preparation_v1'].includes(parent?.format)
    && ['scene-source-recovery', 'scene-native-border'].includes(recovered.kind) && parent.planSha256s.includes(recovered.plan.sourcePlanSha256), 'SOURCE_RECOVERY_BATCH');
  const plans = parent.planSha256s.map(sha => sha === recovered.plan.sourcePlanSha256 ? recoveryPlanSha256 : sha);
  return commit(store, state, seal({ format: recovered.kind === 'scene-native-border' ? 'ai_scene_source_batch_preparation_v1' : 'ai_scene_source_batch_recovery_v1', batchId, profileSha256: parent.profileSha256,
    referencePlanSha256: parent.referencePlanSha256, parentBatchSha256, planSha256s: plans,
    maximumImageRequests: plans.length, newImageRequests: 0 }));
});
export const adoptPreparedSource = adoptRecoveredSource;
export const getPendingGenerationTicket = (root, planSha256) => run(root, (_store, state) => {
  const entry = entryFor(state, planSha256); check(['reserved', 'submitted'].includes(entry.status), 'ATTEMPT_NOT_PENDING');
  return detached({ planSha256, attemptSha256: entry.attempt.sha256, requestSha256: entry.attempt.requestSha256 });
});
function preparedSceneSources(store, state, batchSha256, candidateId) {
  const batch = state.batches.get(batchSha256); check(['ai_scene_source_batch_v1', 'ai_scene_source_batch_v2', 'ai_scene_source_batch_recovery_v1', 'ai_scene_source_batch_preparation_v1'].includes(batch?.format), 'SOURCE_BATCH_REQUIRED');
  const sources = batch.planSha256s.map(sha => {
    const entry = entryFor(state, sha); assertCurrent(state, entry.plan);
    check(['pending-visual-review', 'accepted'].includes(entry.status) && entry.result?.technical.status === 'pass', 'SOURCE_BATCH_NOT_READY');
    return { plan: entry.plan, result: entry.result, raw: store.readBlob(entry.result.rawSha256), review: entry.review ?? null };
  });
  const reference = entryFor(state, batch.referencePlanSha256); assertCurrent(state, reference.plan);
  return assembleSceneSourceFiles({ candidateId, batch, sources, reference: { plan: reference.plan,
    result: reference.result, review: reference.review, raw: store.readBlob(reference.result.rawSha256) },
    spec: state.designs.get(state.activeSpec), style: state.designs.get(state.activeStyle) });
}
export const buildSceneSourceCandidate = (root, batchSha256, candidateId, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedSceneSources(store, state, batchSha256, candidateId))));
export const verifySceneSourceCandidate = (root, batchSha256, candidateId, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedSceneSources(store, state, batchSha256, candidateId))));
function preparedSourceComposition(store, state, plan) {
  return sourceCompositionFiles(preparedSceneSources(store, state, plan.sourceBatchSha256, plan.baseCandidateId), plan);
}
export const buildSceneSourceComposition = (root, plan, outputRoot) => run(root, (store, state) =>
  detached(writeProofBundle(outputRoot, root, preparedSourceComposition(store, state, plan))));
export const verifySceneSourceComposition = (root, plan, outputRoot) => run(root, (store, state) =>
  detached(verifyProofBundle(outputRoot, preparedSourceComposition(store, state, plan))));
export {TERRAIN_INTENT_POLICY,TERRAIN_INTENT_PROFILE,TERRAIN_RENDERING_PROFILE,validateTerrainIntent,validateTerrainRendering,assertTerrainIntentRendering} from '../terrain-intent.mjs';
