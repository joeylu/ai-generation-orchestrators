import { inspectPng } from '../png.mjs';
import { assertCurrent, compilePlan, validateDraft, verifyInventory } from './compiler.mjs';
import { compileNativeReference, compileNativeReferenceEdit } from './native-reference.mjs';
import { compileStandardReference, assessStandardReference, standardReferenceReviewFiles } from './standard-reference.mjs';
import { compileFlexibleReference, flexibleReferenceReviewFiles, acceptedReconstructionTarget } from './flexible-reference.mjs';
import { compileReferenceInputExperiment } from './reference-input-experiment.mjs';
import { compileReferenceLedIsolation } from './reference-led-isolation.mjs';
import { compileReferenceControls, compileControlledReference } from './reference-controlled.mjs';
import { compileReferenceLedPlan, compileReferenceCandidate, assessReferenceLed, measuredReferenceReviewFiles, acceptMeasuredReferenceTarget } from './reference-led.mjs';
import { assessSceneSource, compileSceneSource, compileSceneReference, SCENE_SOURCE_SLOTS, SCENE_SOURCE_PROFILE_SHA256 } from './scene-sources.mjs';
import { compileLayeredSceneReference, compileLayeredSceneSource } from './layered-scene.mjs';
import { compileScopedSceneSource } from './scoped-scene-source.mjs';
import { compileExplicitSceneSource, compileAlternativeSceneSource } from './explicit-scene-source.mjs';
import { compileReferenceAsset, assessReferenceAsset } from './reference-asset.mjs';
import { compileReferenceAssetEdit, compileReferenceAssetSingleInput, assessReferenceAssetEdit } from './reference-asset-edit.mjs';
import { compileRegionGuideControls, compileRegionGuidedAsset } from './reference-region.mjs';
import { compilePaintControls, compilePaintSourcePlan, assessPaintSource, compilePaintApplicationProposal } from './reference-paint.mjs';
import { compileMaterialControls, compileMaterialPaintPlan, compileMaterialCoverageProposal, validateMaterialCoverage,
  requireMaterialCoverage, materialApplicationProposal } from './reference-paint-material.mjs';
import {compileCoherentSource,assessCoherentSource,compileCoherentBatch,verifyCoherentSourceExtraInputs} from './coherent-source.mjs';
import {isRegisteredLocalEdit,REGISTERED_LOCAL_EDIT_ROLE} from './registered-layout-master.mjs';
import {assertLatestDependencyBatch} from './coherent-source-dependency.mjs';
import {compileCoherentReference} from './coherent-reference.mjs';
import {compileCoherentReferenceV2} from './coherent-reference-v2.mjs';
import {compileCoherentReferenceV3} from './coherent-reference-v3.mjs';
import {validateCompositionGuide} from './composition-guide.mjs';
import {compileCoherentBorderPreparation} from './coherent-border.mjs';
import {compileCoherentCanvasGutterPreparation} from './coherent-canvas-gutter.mjs';
import {COHERENT_NATIVE_FRAME_FORMAT,compileCoherentNativeFramePreparation} from './coherent-native-frame.mjs';
import {compileTerrainEdgeSource,compileTerrainEdgeBatch,assessTerrainEdgeSource,TERRAIN_EDGE_PLAN_FORMATS,TERRAIN_EDGE_BATCH_FORMATS} from './terrain-edge-source.mjs';
import {compileTerrainEdgeRecoveryBatch,isTerrainEdgeRecoveryBatch} from './terrain-edge-recovery.mjs';
import {TERRAIN_EDGE_NATIVE_SIZE_FORMAT,TERRAIN_EDGE_PREPARED_BATCH_FORMAT,compileTerrainEdgeNativeSizePreparation,
  compileTerrainEdgePreparedBatch,assertTerrainEdgeNativeSizeParent,assessTerrainEdgeNativeSizePreparation} from './terrain-edge-native-size.mjs';
import {TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT,compileTerrainEdgeCanvasGutterPreparation,
  compileTerrainEdgeCanvasGutterBatch,assertTerrainEdgeCanvasGutterParent,assessTerrainEdgeCanvasGutterPreparation} from './terrain-edge-canvas-gutter.mjs';
import { compileSourceRecovery } from './source-recovery.mjs';
import {compileCoherentRebindRecord} from './coherent-rebind-evidence.mjs';
import {compileTerrainEdgeRebindRecord,compileTerrainEdgeRebindBatch} from './terrain-edge-rebind.mjs';
import { compileNativeBorderPolicy, compileNativeBorderFuturePolicy, compileNativeBorderPreparation } from './native-border.mjs';
import { compileEnvironmentPadding, compilePaddingProposal } from './environment-padding.mjs';
import { compileSupplementPadding, compileSupplementPaddingProposal } from './environment-supplement-padding.mjs';
import { assessTerrainMaterial, compileTerrainMaterial } from './terrain-material.mjs';
import { assessEnvironmentSource, assessEnvironmentSourceV2, compileEnvironmentSource, compileEnvironmentSourceV2, compileEnvironmentSupplement,
  ENVIRONMENT_SOURCE_PROFILE_V2, ENVIRONMENT_SOURCE_PROFILE_V2_SHA256 } from './environment-source.mjs';
import { check, digest, exact, hash, id, isDigest, receipt, seal, unseal, verifyImage } from './common.mjs';

export const assessResult = (plan, bytes) => plan.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT?assessTerrainEdgeCanvasGutterPreparation(plan,bytes)
  : plan.format===TERRAIN_EDGE_NATIVE_SIZE_FORMAT?assessTerrainEdgeNativeSizePreparation(plan,bytes)
  : TERRAIN_EDGE_PLAN_FORMATS.includes(plan.format)?assessTerrainEdgeSource(plan,bytes)
  : plan.format==='ai_scene_generation_plan_v27'?assessCoherentSource(plan,bytes)
  : ['ai_scene_generation_plan_v25','ai_scene_generation_plan_v26'].includes(plan.format) ? assessPaintSource(plan, bytes)
  : ['ai_scene_generation_plan_v22', 'ai_scene_generation_plan_v23', 'ai_scene_generation_plan_v24'].includes(plan.format) ? assessReferenceAssetEdit(plan, bytes)
  : plan.format === 'ai_scene_generation_plan_v21' ? assessReferenceAsset(plan, bytes)
    : ['ai_scene_generation_plan_v18', 'ai_scene_generation_plan_v19', 'ai_scene_generation_plan_v20','ai_scene_generation_plan_v28','ai_scene_generation_plan_v31','ai_scene_generation_plan_v32', 'ai_scene_reference_candidate_v1'].includes(plan.format) ? assessReferenceLed(plan, bytes)
  : ['ai_scene_generation_plan_v15', 'ai_scene_generation_plan_v16', 'ai_scene_generation_plan_v17'].includes(plan.format) ? assessStandardReference(plan, bytes)
  : ['ai_scene_generation_plan_v8', 'ai_scene_generation_plan_v11', 'ai_scene_generation_plan_v12', 'ai_scene_generation_plan_v13', 'ai_scene_generation_plan_v14'].includes(plan.format) ? assessSceneSource(plan, bytes)
  : ['ai_scene_generation_plan_v6', 'ai_scene_generation_plan_v7'].includes(plan.format) ? assessEnvironmentSourceV2(plan, bytes)
  : plan.format === 'ai_scene_generation_plan_v5' ? assessEnvironmentSource(plan, bytes)
  : plan.format === 'ai_scene_generation_plan_v4' ? assessTerrainMaterial(plan, bytes) : assess(plan, bytes, ['ai_scene_generation_plan_v3', 'ai_scene_generation_plan_v9', 'ai_scene_generation_plan_v10'].includes(plan.format));
function assess(plan, bytes, allowCabx) {
  const issues = []; let image = null;
  try {
    const png = inspectPng(bytes, { pixelStats: true, allowCabx });
    image = { sha256: hash(bytes), byteLength: bytes.length, pixelSize: { width: png.width, height: png.height } };
    if (['ai_scene_generation_plan_v2', 'ai_scene_generation_plan_v3', 'ai_scene_generation_plan_v9', 'ai_scene_generation_plan_v10'].includes(plan.format)) {
      const policy = plan.target.pixelPolicy;
      if (png.width <= png.height) issues.push('REFERENCE_ORIENTATION');
      if (Math.min(png.width, png.height) < policy.minimumShortEdge
        || png.width > policy.maximumWidth || png.height > policy.maximumHeight) issues.push('OUTPUT_SIZE');
    } else if (png.width !== plan.target.pixelSize.width || png.height !== plan.target.pixelSize.height) issues.push('OUTPUT_SIZE');
    if (!png.nonzeroAlphaPixels) issues.push('OUTPUT_EMPTY');
    if (plan.target.alpha === 'opaque' && png.transparentPixels) issues.push('OUTPUT_NOT_OPAQUE');
    if (plan.target.alpha === 'transparent' && !png.transparentPixels) issues.push('OUTPUT_ALPHA_REQUIRED');
    if (plan.recipe.stage === 'reference' && !png.varied) issues.push('REFERENCE_BLANK');
  } catch { issues.push('OUTPUT_PNG_UNSUPPORTED'); }
  return seal({ ...(allowCabx
    ? { format: 'ai_scene_technical_qa_v3', policy: 'native-reference-png-cabx-v1', geometryEvidence: 'visual-reference-only-no-map-transform', metadataTrust: 'not-verified' }
    : plan.format === 'ai_scene_generation_plan_v2'
    ? { format: 'ai_scene_technical_qa_v2', policy: 'native-reference-png-v1', geometryEvidence: 'visual-reference-only-no-map-transform' }
    : { format: 'ai_scene_technical_qa_v1', policy: 'exact-png-v1' }), planSha256: plan.sha256,
    rawSha256: hash(bytes), image, issues, status: issues.length ? 'fail' : 'pass', visualAcceptance: 'not-assessed' });
}

// An explicit new assessment of existing bytes, never a replacement attempt or
// a rewrite of the immutable original QA. Its request cannot spend compute.
export function compileReferenceReinspection(store, state, options) {
  exact(options, ['inspectionId', 'sourcePlanSha256']); id(options.inspectionId);
  const source = state.plans.get(options.sourcePlanSha256);
  check(source?.plan.format === 'ai_scene_generation_plan_v2' && source.status === 'rejected-technical'
    && source.result?.technical.issues.length === 1 && source.result.technical.issues[0] === 'OUTPUT_PNG_UNSUPPORTED', 'REINSPECTION_SOURCE');
  assertCurrent(state, source.plan);
  const technical = assess(source.plan, store.readBlob(source.result.rawSha256), true);
  return seal({ format: 'ai_scene_reference_reinspection_v1', compiler: 'scene-kit-reference-png-cabx-v1',
    sourcePlanSha256: source.plan.sha256, priorTechnicalSha256: source.result.technical.sha256, rawSha256: source.result.rawSha256,
    recipe: { ...source.plan.recipe, planId: options.inspectionId, parents: [source.plan.sha256] },
    designReviews: source.plan.designReviews, target: source.plan.target,
    request: { format: 'ai_scene_no_generation_request_v1', maximumCalls: 0 }, technical });
}

export function compileEnvironmentReinspection(store, state, options) {
  exact(options, ['inspectionId', 'sourcePlanSha256']); id(options.inspectionId);
  const source = state.plans.get(options.sourcePlanSha256);
  check(source?.plan.format === 'ai_scene_generation_plan_v5' && source.status === 'rejected-technical'
    && source.result?.technical.issues.length === 1 && source.result.technical.issues[0] === 'OUTPUT_PNG_UNSUPPORTED', 'ENVIRONMENT_REINSPECTION_SOURCE');
  assertCurrent(state, source.plan);
  const raw = store.readBlob(source.result.rawSha256); let hiddenRgbFailure = false;
  try { inspectPng(raw, { allowCabx: true }); } catch (error) { hiddenRgbFailure = error.message === 'Zero-alpha RGB must be zero'; }
  check(hiddenRgbFailure, 'ENVIRONMENT_REINSPECTION_SOURCE');
  const subject = { format: 'ai_scene_environment_reinspection_v1', sourcePlanSha256: source.plan.sha256,
    target: { ...source.plan.target, profileSha256: ENVIRONMENT_SOURCE_PROFILE_V2_SHA256 } };
  const technical = assessEnvironmentSourceV2(subject, raw);
  return seal({ ...subject, compiler: 'scene-kit-environment-reception-v2',
    priorTechnicalSha256: source.result.technical.sha256, rawSha256: source.result.rawSha256,
    recipe: { ...source.plan.recipe, planId: options.inspectionId, parents: [source.plan.sha256] },
    designReviews: source.plan.designReviews, profile: ENVIRONMENT_SOURCE_PROFILE_V2,
    request: { format: 'ai_scene_no_generation_request_v1', maximumCalls: 0 }, technical });
}

export function reassessEntry(state, entry, bytes) {
  if(entry.kind==='terrain-edge-rebind'){
    const target=state.plans.get(entry.plan.targetPlanSha256)?.plan;
    const original=target?.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT?state.plans.get(target.sourcePlanSha256)?.plan:target;
    check(original,'EDGE_REBIND_TARGET');return assessTerrainEdgeSource(original,bytes);
  }
  return entry.kind==='coherent-rebind'?assessCoherentSource(state.plans.get(entry.plan.targetPlanSha256).plan,bytes)
    : entry.kind==='coherent-native-frame-preparation'?assessCoherentSource(state.plans.get(entry.plan.sourcePlanSha256).plan,bytes,{recalibrateNativeFrame:true})
    : ['coherent-border-preparation','coherent-canvas-gutter-preparation'].includes(entry.kind)?assessCoherentSource(state.plans.get(entry.plan.sourcePlanSha256).plan,bytes)
    : ['scene-source-recovery', 'scene-native-border'].includes(entry.kind) ? assessSceneSource(state.plans.get(entry.plan.sourcePlanSha256).plan, bytes)
    : entry.kind === 'reference-reinspection'
    ? assess(state.plans.get(entry.plan.sourcePlanSha256).plan, bytes, true)
    : ['environment-reinspection', 'environment-preparation'].includes(entry.kind) ? assessEnvironmentSourceV2(entry.plan, bytes) : assessResult(entry.plan, bytes);
}

export function replay(store) {
  const state = { designs: new Map(), designReviews: new Map(), capabilities: new Map(), inventories: new Map(),
    plans: new Map(), batches: new Map(), paddingApprovals: new Map(), preparations: new Set(), controls: new Map(), controlReviews: new Map(),
    regionControls: new Map(), regionControlReviews: new Map(), paintControls: new Map(), paintControlReviews: new Map(), paintApplicationReviews: new Map(),
    materialPaintControls: new Map(), materialPaintControlReviews: new Map(), materialCoverageReviews: new Map(),
    ids: new Set(), decisions: new Set(), nonces: new Set(), activeSpec: '', activeStyle: '' };
  for (const event of store.events) applyRecord(store, state, event.record);
  return state;
}
function newId(state, namespace, value) {
  id(value); const key = `${namespace}/${value}`; check(!state.ids.has(key), 'REVISION_ID_EXISTS'); state.ids.add(key);
}
function humanDecision(state, value, kind) {
  receipt(value, kind); check(!state.decisions.has(value.decisionId), 'DECISION_REUSED'); state.decisions.add(value.decisionId);
}

export function applyRecord(store, state, record) {
  const body = unseal(record);
  switch (body.format) {
    case 'ai_scene_spec_v1':
    case 'ai_scene_spec_v2':
    case 'ai_scene_spec_v3':
    case 'ai_scene_style_v1':
    case 'ai_scene_style_v2':
      validateDraft(store, record);
      newId(state, body.format, body.specId ?? body.styleId); state.designs.set(record.sha256, record); break;
    case 'ai_scene_image_capabilities_v1':
      validateDraft(store, record); newId(state, body.format, body.capabilityId); state.capabilities.set(record.sha256, record); break;
    case 'ai_scene_design_review_v1': {
      exact(body, ['format', 'kind', 'receipt']);
      check(['spec', 'style'].includes(body.kind), 'DESIGN_KIND'); humanDecision(state, body.receipt, 'review');
      const target = state.designs.get(body.receipt.targetSha256);
      check((target?.format === `ai_scene_${body.kind}_v1` || target?.format === `ai_scene_${body.kind}_v2`
        || body.kind === 'spec' && target?.format === 'ai_scene_spec_v3')
        && !state.designReviews.has(target.sha256), 'DESIGN_REVIEW_STATE');
      state.designReviews.set(target.sha256, record);
      if (body.receipt.decision === 'accept') state[body.kind === 'spec' ? 'activeSpec' : 'activeStyle'] = target.sha256;
      break;
    }
    case 'ai_scene_generation_inventory_v1':
      verifyInventory(record); newId(state, body.format, body.inventoryId); state.inventories.set(record.sha256, record); break;
    case 'ai_scene_generation_plan_v1': {
      check(digest(compilePlan(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_reference_controls_v1': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compiled = compileReferenceControls(state, { controlId: body.controlId, sourcePlanSha256: body.sourcePlanSha256,
        reviewPacket: body.reviewPacket }, sha => store.readBlob(sha));
      check(digest(compiled) === digest(record), 'CONTROL_PACKAGE_REPLAY'); newId(state, 'reference-controls', body.controlId);
      state.controls.set(record.sha256, record); break;
    }
    case 'ai_scene_reference_controls_review_v1': {
      exact(body, ['format', 'controlsSha256', 'packetSha256', 'receipt']);
      const c = state.controls.get(body.controlsSha256);
      check(c && !state.controlReviews.has(c.sha256) && body.packetSha256 === c.reviewPacket.sha256
        && body.receipt.targetSha256 === body.packetSha256 && state.activeSpec === c.specSha256
        && state.activeStyle === c.styleSha256, 'CONTROL_REVIEW_STATE');
      humanDecision(state, body.receipt, 'review'); state.controlReviews.set(c.sha256, record); break;
    }
    case 'ai_scene_region_controls_v1': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compiled = compileRegionGuideControls(state, { controlId: body.controlId,
        baselinePlanSha256: body.baselinePlanSha256, reviewPacket: body.reviewPacket }, sha => store.readBlob(sha));
      check(digest(compiled) === digest(record), 'REGION_CONTROL_PACKAGE_REPLAY');
      newId(state, 'region-controls', body.controlId); state.regionControls.set(record.sha256, record); break;
    }
    case 'ai_scene_region_controls_review_v1': {
      exact(body, ['format', 'controlsSha256', 'packetSha256', 'receipt']);
      const c = state.regionControls.get(body.controlsSha256);
      check(c && !state.regionControlReviews.has(c.sha256) && c.reviewPacket.sha256 === body.packetSha256
        && body.receipt.targetSha256 === body.packetSha256 && c.specSha256 === state.activeSpec
        && c.styleSha256 === state.activeStyle, 'REGION_CONTROL_REVIEW_STATE');
      humanDecision(state, body.receipt, 'review'); state.regionControlReviews.set(c.sha256, record); break;
    }
    case 'ai_scene_paint_controls_v1': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compiled = compilePaintControls(state, { controlId: body.controlId, referencePlanSha256: body.referencePlanSha256,
        reviewPacket: body.reviewPacket }, sha => store.readBlob(sha));
      check(digest(compiled) === digest(record), 'PAINT_CONTROL_REPLAY'); newId(state, 'paint-controls', body.controlId);
      state.paintControls.set(record.sha256, record); break;
    }
    case 'ai_scene_paint_controls_review_v1': {
      exact(body, ['format', 'controlsSha256', 'proposalSha256', 'receipt']);
      const c = state.paintControls.get(body.controlsSha256);
      check(c && !state.paintControlReviews.has(c.sha256) && body.proposalSha256 === c.design.sha256
        && body.receipt.targetSha256 === c.design.sha256 && c.specSha256 === state.activeSpec && c.styleSha256 === state.activeStyle, 'PAINT_CONTROL_REVIEW_STATE');
      humanDecision(state, body.receipt, 'review'); state.paintControlReviews.set(c.sha256, record); break;
    }
    case 'ai_scene_paint_application_review_v1': {
      exact(body, ['format', 'planSha256', 'proposalSha256', 'receipt']);
      const proposal = materialApplicationProposal(state, body.planSha256);
      check(body.proposalSha256 === proposal.sha256 && body.receipt.targetSha256 === proposal.sha256
        && !state.paintApplicationReviews.has(proposal.sha256), 'PAINT_APPLICATION_REVIEW_STATE');
      humanDecision(state, body.receipt, 'review'); state.paintApplicationReviews.set(proposal.sha256, record); break;
    }
    case 'ai_scene_material_paint_controls_v1': {
      check(store.metadata.compiler==='scene-kit-native-reference-v2','WORKFLOW_COMPILER');
      const compiled=compileMaterialControls(state,{controlId:body.controlId,basePaintControlsSha256:body.basePaintControlsSha256,
        reviewPacket:body.reviewPacket},sha=>store.readBlob(sha));
      check(digest(compiled)===digest(record),'MATERIAL_CONTROL_REPLAY'); newId(state,'material-controls',body.controlId);
      state.materialPaintControls.set(record.sha256,record); break;
    }
    case 'ai_scene_material_paint_controls_review_v1': {
      exact(body,['format','controlsSha256','proposalSha256','receipt']); const c=state.materialPaintControls.get(body.controlsSha256);
      check(c && !state.materialPaintControlReviews.has(c.sha256) && body.proposalSha256===c.proposal.sha256
        && body.receipt.targetSha256===c.proposal.sha256 && c.specSha256===state.activeSpec && c.styleSha256===state.activeStyle,'MATERIAL_CONTROL_REVIEW_STATE');
      humanDecision(state,body.receipt,'review'); state.materialPaintControlReviews.set(c.sha256,record); break;
    }
    case 'ai_scene_material_coverage_review_v1': {
      exact(body,['format','planSha256','proposalSha256','rawSha256','observation','receipt']);
      const p=compileMaterialCoverageProposal(state,body.planSha256,sha=>store.readBlob(sha));
      check(!state.materialCoverageReviews.has(body.planSha256) && body.proposalSha256===p.sha256 && body.rawSha256===p.rawSha256,'MATERIAL_COVERAGE_REVIEW_STATE');
      check(state.plans.get(body.planSha256).status==='pending-visual-review','MATERIAL_COVERAGE_REVIEW_STATE');
      assertCurrent(state,state.plans.get(body.planSha256).plan); validateMaterialCoverage(p,body.observation,body.receipt);
      humanDecision(state,body.receipt,'review'); state.materialCoverageReviews.set(body.planSha256,record); break;
    }
    case 'ai_scene_generation_plan_v37':
    case 'ai_scene_generation_plan_v36':
    case 'ai_scene_generation_plan_v35':
    case 'ai_scene_generation_plan_v34':
    case 'ai_scene_generation_plan_v33':
    case 'ai_scene_generation_plan_v30':
    case 'ai_scene_generation_plan_v29':
    case 'ai_scene_generation_plan_v27':
    case 'ai_scene_generation_plan_v26':
    case 'ai_scene_generation_plan_v25':
    case 'ai_scene_generation_plan_v24':
    case 'ai_scene_generation_plan_v23':
    case 'ai_scene_generation_plan_v22':
    case 'ai_scene_generation_plan_v21': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compile = TERRAIN_EDGE_PLAN_FORMATS.includes(body.format) ? compileTerrainEdgeSource
        : body.format === 'ai_scene_generation_plan_v27' ? compileCoherentSource
        : body.format === 'ai_scene_generation_plan_v26' ? compileMaterialPaintPlan
        : body.format === 'ai_scene_generation_plan_v25' ? compilePaintSourcePlan
        : body.format === 'ai_scene_generation_plan_v24' ? compileRegionGuidedAsset
        : body.format === 'ai_scene_generation_plan_v23' ? compileReferenceAssetSingleInput
        : body.format === 'ai_scene_generation_plan_v22' ? compileReferenceAssetEdit : compileReferenceAsset;
      const compiled = compile(state, body.recipe, sha => store.readBlob(sha));
      check(digest(compiled) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      if(body.format==='ai_scene_generation_plan_v27')verifyCoherentSourceExtraInputs(compiled,sha=>store.readBlob(sha));
      for (const [index,image] of compiled.request.images.entries()) {
        const nativeDependency=body.format==='ai_scene_generation_plan_v27'&&Boolean(compiled.recipe.sourceDependency)&&index===1
          &&image.role===(['ai_scene_source_appearance_dependency_v1','ai_scene_source_appearance_dependency_v2'].includes(compiled.recipe.sourceDependency.format)?'verified-independent-source-appearance-reference':'verified-independent-source-spatial-reference');
        const nativeLocalEdit=body.format==='ai_scene_generation_plan_v27'&&index===0&&image.role===REGISTERED_LOCAL_EDIT_ROLE
          &&isRegisteredLocalEdit(compiled.recipe.sourceScope?.bandCompositionGuide?.spec);
        verifyImage(store,image.artifact,{allowCabx:true,...(nativeDependency||nativeLocalEdit?{allowHiddenRgb:true}:{})});
      }
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_terrain_edge_rebind_v1': {
      const compiled=compileTerrainEdgeRebindRecord(state,{rebindId:body.recipe.planId,parentBatchSha256:body.parentBatchSha256,targetPlanSha256:body.targetPlanSha256,
        evidence:body.sourceEvidence,originalRaw:store.readBlob(body.originalRawSha256),bytes:store.readBlob(body.rawSha256),proposal:body.proposal,receipt:body.receipt});
      check(digest(compiled)===digest(record),'EDGE_REBIND_REPLAY');humanDecision(state,body.receipt,'review');
      const key='terrain-edge-rebind/'+body.parentBatchSha256+'/'+body.targetPlanSha256;check(!state.preparations.has(key),'EDGE_REBIND_EXISTS');state.preparations.add(key);
      newId(state,'plan',body.recipe.planId);assertCurrent(state,record);
      state.plans.set(record.sha256,{plan:record,kind:'terrain-edge-rebind',result:seal({format:'ai_scene_terrain_edge_rebind_result_v1',rebindSha256:record.sha256,
        rawSha256:body.rawSha256,technical:body.technical,maximumCalls:0}),status:'pending-visual-review'});break;
    }
    case 'ai_scene_terrain_edge_rebind_batch_v1': {
      const compiled=compileTerrainEdgeRebindBatch(state,{batchId:body.batchId,parentBatchSha256:body.parentBatchSha256,rebindSha256:body.rebindSha256});
      check(digest(compiled)===digest(record),'EDGE_REBIND_BATCH_REPLAY');for(const sha of body.planSha256s)assertCurrent(state,state.plans.get(sha).plan);
      newId(state,'terrain-edge-batch',body.batchId);state.batches.set(record.sha256,record);break;
    }
    case 'ai_scene_terrain_edge_canvas_gutter_preparation_v1': {
      check(store.metadata.compiler==='scene-kit-native-reference-v2','WORKFLOW_COMPILER');
      assertTerrainEdgeCanvasGutterParent(state,body.proposal?.parentBatchSha256);
      const automatic=Object.hasOwn(body,'automaticPolicy');
      const {record:compiled,bytes}=compileTerrainEdgeCanvasGutterPreparation(store,state,{preparationId:body.recipe?.planId,proposal:body.proposal,
        ...(automatic?{automaticPolicy:body.automaticPolicy}:{receipt:body.receipt})});
      check(digest(compiled)===digest(record)&&store.readBlob(body.rawSha256).equals(bytes),'TERRAIN_EDGE_CANVAS_GUTTER_REPLAY');
      if(!automatic)humanDecision(state,body.receipt,'review');
      const key='terrain-edge-canvas-gutter/'+body.sourcePlanSha256+'/'+body.proposal.parentBatchSha256;
      check(!state.preparations.has(key),'TERRAIN_EDGE_CANVAS_GUTTER_EXISTS');state.preparations.add(key);
      newId(state,'plan',body.recipe.planId);assertCurrent(state,record);
      state.plans.set(record.sha256,{plan:record,kind:'terrain-edge-canvas-gutter-preparation',result:seal({
        format:'ai_scene_terrain_edge_canvas_gutter_result_v1',preparationSha256:record.sha256,sourcePlanSha256:body.sourcePlanSha256,
        originalRawSha256:body.originalRawSha256,rawSha256:body.rawSha256,technical:body.technical,maximumCalls:0}),status:'pending-visual-review'});break;
    }
    case 'ai_scene_terrain_edge_canvas_gutter_batch_v1': {
      const compiled=compileTerrainEdgeCanvasGutterBatch(state,{batchId:body.batchId,parentBatchSha256:body.parentBatchSha256,
        preparationSha256:body.preparationSha256s?.at(-1)});
      check(digest(compiled)===digest(record),'TERRAIN_EDGE_CANVAS_GUTTER_BATCH_REPLAY');
      for(const sha of body.planSha256s)assertCurrent(state,state.plans.get(sha).plan);
      newId(state,'terrain-edge-batch',body.batchId);state.batches.set(record.sha256,record);break;
    }
    case 'ai_scene_terrain_edge_native_size_preparation_v1': {
      check(store.metadata.compiler==='scene-kit-native-reference-v2','WORKFLOW_COMPILER');
      assertTerrainEdgeNativeSizeParent(state,body.proposal?.parentBatchSha256);
      const {record:compiled,bytes}=compileTerrainEdgeNativeSizePreparation(store,state,{preparationId:body.recipe?.planId,proposal:body.proposal,receipt:body.receipt});
      check(digest(compiled)===digest(record)&&store.readBlob(body.rawSha256).equals(bytes),'TERRAIN_EDGE_NATIVE_SIZE_REPLAY');
      humanDecision(state,body.receipt,'review');
      const key='terrain-edge-native-size/'+body.sourcePlanSha256+'/'+body.proposal.parentBatchSha256;
      check(!state.preparations.has(key),'TERRAIN_EDGE_NATIVE_SIZE_EXISTS');state.preparations.add(key);
      newId(state,'plan',body.recipe.planId);assertCurrent(state,record);
      state.plans.set(record.sha256,{plan:record,kind:'terrain-edge-native-size-preparation',result:seal({
        format:'ai_scene_terrain_edge_native_size_result_v1',preparationSha256:record.sha256,sourcePlanSha256:body.sourcePlanSha256,
        originalRawSha256:body.originalRawSha256,rawSha256:body.rawSha256,technical:body.technical,maximumCalls:0}),status:'pending-visual-review'});break;
    }
    case 'ai_scene_terrain_edge_prepared_batch_v1': {
      const compiled=compileTerrainEdgePreparedBatch(state,{batchId:body.batchId,parentBatchSha256:body.parentBatchSha256,
        preparationSha256:body.preparationSha256s?.at(-1)});
      check(digest(compiled)===digest(record),'TERRAIN_EDGE_NATIVE_SIZE_BATCH_REPLAY');
      for(const sha of body.planSha256s)assertCurrent(state,state.plans.get(sha).plan);
      newId(state,'terrain-edge-batch',body.batchId);state.batches.set(record.sha256,record);break;
    }
    case 'ai_scene_terrain_edge_recovery_batch_v1':
    case 'ai_scene_terrain_edge_recovery_batch_v2': {
      const compiled=compileTerrainEdgeRecoveryBatch(state,{parentBatchSha256:body.parentBatchSha256,failedPlanSha256:body.failedPlanSha256,
        replacementPlanSha256:body.replacementPlanSha256,batchId:body.batchId,
        ...(body.format==='ai_scene_terrain_edge_recovery_batch_v2'?{terminalSha256:body.terminalSha256}:{})});
      check(digest(compiled)===digest(record),'TERRAIN_EDGE_RECOVERY_BATCH_REPLAY');
      newId(state,'terrain-edge-batch',body.batchId);state.batches.set(record.sha256,record);break;
    }
    case 'ai_scene_terrain_edge_batch_v7':
    case 'ai_scene_terrain_edge_batch_v6':
    case 'ai_scene_terrain_edge_batch_v5':
    case 'ai_scene_terrain_edge_batch_v4':
    case 'ai_scene_terrain_edge_batch_v3':
    case 'ai_scene_terrain_edge_batch_v2':
    case 'ai_scene_terrain_edge_batch_v1': {
      const compiled=compileTerrainEdgeBatch(state,{batchId:body.batchId,baseBatchSha256:body.baseBatchSha256,planSha256s:body.planSha256s,
        ...(Object.hasOwn(body,'coverageIntent')?{coverageIntent:body.coverageIntent}:{})});
      check(digest(compiled)===digest(record),'TERRAIN_EDGE_BATCH_REPLAY');
      for(const sha of body.planSha256s)assertCurrent(state,state.plans.get(sha).plan);
      newId(state,'terrain-edge-batch',body.batchId);state.batches.set(record.sha256,record);break;
    }
    case 'ai_scene_coherent_rebind_v1': {
      check(store.metadata.compiler==='scene-kit-native-reference-v2','WORKFLOW_COMPILER');
      const bytes=store.readBlob(body.rawSha256),compiled=compileCoherentRebindRecord(state,{rebindId:body.recipe?.planId,
        targetPlanSha256:body.targetPlanSha256,parentBatchSha256:body.parentBatchSha256,intendedBatchId:body.intendedBatchId,evidence:body.sourceEvidence,proposal:body.proposal,receipt:body.receipt,bytes});
      check(digest(compiled)===digest(record),'REBIND_REPLAY');humanDecision(state,body.receipt,'review');
      const key='coherent-rebind/'+body.targetPlanSha256;check(!state.preparations.has(key),'REBIND_EXISTS');state.preparations.add(key);
      newId(state,'plan',body.recipe.planId);
      state.plans.set(record.sha256,{plan:record,kind:'coherent-rebind',result:seal({format:'ai_scene_coherent_rebind_result_v1',
        rebindSha256:record.sha256,targetPlanSha256:body.targetPlanSha256,rawSha256:body.rawSha256,technical:body.technical,maximumCalls:0}),status:'pending-visual-review'});break;
    }
    case 'ai_scene_coherent_source_batch_v3':
    case 'ai_scene_coherent_source_batch_v2':
    case 'ai_scene_coherent_source_batch_v1': {
      const compiled=compileCoherentBatch(state,{batchId:body.batchId,referencePlanSha256:body.referencePlanSha256,
        planSha256s:body.planSha256s,parentBatchSha256:body.parentBatchSha256});
      check(digest(compiled)===digest(record),'COHERENT_BATCH_REPLAY');
      for(const sha of body.planSha256s)assertCurrent(state,state.plans.get(sha).plan);
      newId(state,'coherent-batch',body.batchId);state.batches.set(record.sha256,record);break;
    }
    case COHERENT_NATIVE_FRAME_FORMAT: {
      check(store.metadata.compiler==='scene-kit-native-reference-v2','WORKFLOW_COMPILER');
      const parent=state.batches.get(body.proposal?.parentBatchSha256),latest=[...state.batches.values()].findLast(b=>
        ['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)&&b.referencePlanSha256===parent?.referencePlanSha256);
      check(parent&&latest?.sha256===parent.sha256,'COHERENT_NATIVE_FRAME_PARENT_STALE');
      const compiled=compileCoherentNativeFramePreparation(store,state,{preparationId:body.recipe?.planId,proposal:body.proposal,receipt:body.receipt});
      check(compiled.sha256===record.sha256,'COHERENT_NATIVE_FRAME_REPLAY');
      humanDecision(state,body.receipt,'review');
      newId(state,'plan',body.recipe.planId);assertCurrent(state,record);
      state.plans.set(record.sha256,{plan:record,kind:'coherent-native-frame-preparation',status:'pending-visual-review',
        result:seal({format:'ai_scene_coherent_native_frame_result_v1',preparationSha256:record.sha256,sourcePlanSha256:body.sourcePlanSha256,
          rawSha256:body.rawSha256,technical:body.technical,maximumCalls:0})});break;
    }
    case 'ai_scene_coherent_canvas_gutter_preparation_v2':
    case 'ai_scene_coherent_canvas_gutter_preparation_v1': {
      check(store.metadata.compiler==='scene-kit-native-reference-v2','WORKFLOW_COMPILER');
      const parent=state.batches.get(body.proposal?.parentBatchSha256),latest=[...state.batches.values()].findLast(b=>
        ['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)&&b.referencePlanSha256===parent?.referencePlanSha256);
      check(parent&&latest?.sha256===parent.sha256,'COHERENT_CANVAS_GUTTER_PARENT_STALE');
      const {record:compiled,bytes}=compileCoherentCanvasGutterPreparation(store,state,{preparationId:body.recipe?.planId,proposal:body.proposal,receipt:body.receipt});
      check(digest(compiled)===digest(record)&&store.readBlob(body.rawSha256).equals(bytes),'COHERENT_CANVAS_GUTTER_REPLAY');
      humanDecision(state,body.receipt,'review');
      const key='coherent-canvas-gutter/'+body.sourcePlanSha256+'/'+body.proposal.parentBatchSha256;
      check(!state.preparations.has(key),'COHERENT_CANVAS_GUTTER_EXISTS');state.preparations.add(key);
      newId(state,'plan',body.recipe.planId);assertCurrent(state,record);
      state.plans.set(record.sha256,{plan:record,kind:'coherent-canvas-gutter-preparation',
        result:seal({format:body.format==='ai_scene_coherent_canvas_gutter_preparation_v2'?'ai_scene_coherent_canvas_gutter_result_v2':'ai_scene_coherent_canvas_gutter_result_v1',preparationSha256:record.sha256,sourcePlanSha256:body.sourcePlanSha256,
          originalRawSha256:body.originalRawSha256,rawSha256:body.rawSha256,technical:body.technical,maximumCalls:0}),status:'pending-visual-review'});break;
    }
    case 'ai_scene_coherent_border_preparation_v1': {
      check(store.metadata.compiler==='scene-kit-native-reference-v2','WORKFLOW_COMPILER');
      const {record:compiled,bytes}=compileCoherentBorderPreparation(store,state,{preparationId:body.recipe?.planId,proposal:body.proposal,receipt:body.receipt});
      check(digest(compiled)===digest(record)&&store.readBlob(body.rawSha256).equals(bytes),'COHERENT_BORDER_REPLAY');
      humanDecision(state,body.receipt,'review');
      const key='coherent-border/'+body.sourcePlanSha256;
      check(!state.preparations.has(key),'COHERENT_BORDER_EXISTS');state.preparations.add(key);
      newId(state,'plan',body.recipe.planId);assertCurrent(state,record);
      state.plans.set(record.sha256,{plan:record,kind:'coherent-border-preparation',
        result:seal({format:'ai_scene_coherent_border_result_v1',preparationSha256:record.sha256,sourcePlanSha256:body.sourcePlanSha256,
          originalRawSha256:body.originalRawSha256,rawSha256:body.rawSha256,technical:body.technical,maximumCalls:0}),status:'pending-visual-review'});break;
    }
    case 'ai_scene_reference_asset_batch_v4':
    case 'ai_scene_reference_asset_batch_v3':
    case 'ai_scene_reference_asset_batch_v2':
    case 'ai_scene_reference_asset_batch_v1': {
      exact(body, ['format', 'batchId', 'referencePlanSha256', 'targetSha256', 'planSha256s', 'maximumCalls', 'automaticRetry', 'scope']);
      id(body.batchId); const ref = state.plans.get(body.referencePlanSha256);
      check(ref?.status === 'accepted' && ref.reconstructionTarget?.sha256 === body.targetSha256
        && body.scope === 'listed-reference-instances-only' && body.automaticRetry === false
        && Array.isArray(body.planSha256s) && body.planSha256s.length > 0 && body.planSha256s.length <= 24
        && new Set(body.planSha256s).size === body.planSha256s.length && body.maximumCalls === body.planSha256s.length, 'REFERENCE_ASSET_BATCH');
      const instances = new Set();
      for (const sha of body.planSha256s) {
        const expected = body.format === 'ai_scene_reference_asset_batch_v4' ? 'ai_scene_generation_plan_v24'
          : body.format === 'ai_scene_reference_asset_batch_v3' ? 'ai_scene_generation_plan_v23'
          : body.format === 'ai_scene_reference_asset_batch_v2' ? 'ai_scene_generation_plan_v22' : 'ai_scene_generation_plan_v21';
        const e = state.plans.get(sha); check(e?.plan.format === expected && e.status === 'planned'
          && e.plan.recipe.referencePlans[0] === body.referencePlanSha256 && e.plan.recipe.targetSha256 === body.targetSha256
          && !instances.has(e.plan.recipe.assetId), 'REFERENCE_ASSET_BATCH');
        instances.add(e.plan.recipe.assetId); assertCurrent(state, e.plan);
      }
      newId(state, 'reference-asset-batch', body.batchId); state.batches.set(record.sha256, record); break;
    }
    case 'ai_scene_coherent_composition_guide_v1': {
      validateCompositionGuide(state,record,sha=>store.readBlob(sha));humanDecision(state,body.receipt,'review');
      newId(state,'composition-guide',body.guideId);state.compositionGuides??=new Map();state.compositionGuides.set(record.sha256,record);break;
    }
    case 'ai_scene_generation_plan_v32':
    case 'ai_scene_generation_plan_v31':
    case 'ai_scene_generation_plan_v28':
    case 'ai_scene_generation_plan_v20':
    case 'ai_scene_generation_plan_v19':
    case 'ai_scene_generation_plan_v18': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compile = body.format === 'ai_scene_generation_plan_v32' ? (s,r)=>compileCoherentReferenceV3(s,r,sha=>store.readBlob(sha))
        : body.format === 'ai_scene_generation_plan_v31' ? compileCoherentReferenceV2
        : body.format === 'ai_scene_generation_plan_v28' ? compileCoherentReference
        : body.format === 'ai_scene_generation_plan_v20' ? compileControlledReference
        : body.format === 'ai_scene_generation_plan_v19' ? compileReferenceLedIsolation : compileReferenceLedPlan;
      const compiled=compile(state,body.recipe);
      check(digest(compiled) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      if(['ai_scene_generation_plan_v31','ai_scene_generation_plan_v32'].includes(body.format))for(const image of compiled.request.images)
        verifyImage(store,image.artifact,{allowCabx:true,...(body.format==='ai_scene_generation_plan_v32'&&image.role==='accepted-soft-composition-guide'?{allowHiddenRgb:true}:{})});
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_reference_candidate_v1': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      verifyImage(store, body.recipe.rawInput, { allowCabx: true });
      check(digest(compileReferenceCandidate(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'awaiting-existing-image-intake' }); break;
    }
    case 'ai_scene_reference_candidate_intake_v1': {
      exact(body, ['format', 'planSha256', 'rawSha256', 'byteLength', 'technical']);
      const entry = state.plans.get(body.planSha256);
      check(entry?.status === 'awaiting-existing-image-intake' && entry.plan.recipe.rawInput.sha256 === body.rawSha256, 'REFERENCE_CANDIDATE_INTAKE');
      const bytes = verifyImage(store, entry.plan.recipe.rawInput, { allowCabx: true });
      check(bytes.length === body.byteLength && digest(assessReferenceLed(entry.plan, bytes)) === digest(body.technical), 'RESULT_REPLAY_MISMATCH');
      entry.result = record; entry.status = body.technical.status === 'pass' ? 'pending-visual-review' : 'rejected-technical'; break;
    }
    case 'ai_scene_generation_plan_v17':
    case 'ai_scene_generation_plan_v16':
    case 'ai_scene_generation_plan_v15': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compile = body.format === 'ai_scene_generation_plan_v17' ? compileReferenceInputExperiment
        : body.format === 'ai_scene_generation_plan_v16' ? compileFlexibleReference : compileStandardReference;
      check(digest(compile(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v2': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      check(digest(compileNativeReference(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v3': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      check(digest(compileNativeReferenceEdit(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v4': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      check(digest(compileTerrainMaterial(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v5': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      check(digest(compileEnvironmentSource(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v6': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      check(digest(compileEnvironmentSourceV2(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v10':
    case 'ai_scene_generation_plan_v9': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compile = body.format === 'ai_scene_generation_plan_v10' ? compileLayeredSceneReference : compileSceneReference;
      check(digest(compile(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v14':
    case 'ai_scene_generation_plan_v13':
    case 'ai_scene_generation_plan_v12':
    case 'ai_scene_generation_plan_v11':
    case 'ai_scene_generation_plan_v8': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compile = body.format === 'ai_scene_generation_plan_v14' ? compileAlternativeSceneSource
        : body.format === 'ai_scene_generation_plan_v13' ? compileExplicitSceneSource
        : body.format === 'ai_scene_generation_plan_v12' ? compileScopedSceneSource
        : body.format === 'ai_scene_generation_plan_v11' ? compileLayeredSceneSource : compileSceneSource;
      check(digest(compile(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_generation_plan_v7': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      check(digest(compileEnvironmentSupplement(state, body.recipe)) === digest(record), 'PLAN_RECOMPILE_MISMATCH');
      assertCurrent(state, record); newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, status: 'planned' }); break;
    }
    case 'ai_scene_native_border_policy_approval_v1': {
      exact(body, ['format', 'proposal', 'receipt']); unseal(body.proposal);
      check(['ai_scene_native_border_policy_proposal_v1', 'ai_scene_native_border_policy_proposal_v2', 'ai_scene_native_border_policy_proposal_v3'].includes(body.proposal.format), 'NATIVE_BORDER_POLICY_REPLAY');
      const proposal = body.proposal.format === 'ai_scene_native_border_policy_proposal_v3'
        ? compileNativeBorderFuturePolicy(store, state, { batchSha256: body.proposal.batchSha256,
          sourcePlanSha256s: body.proposal.sourcePlanSha256s, examplePreparationSha256: body.proposal.examplePreparationSha256 })
        : compileNativeBorderPolicy(store, state, body.proposal.batchSha256, body.proposal.sourcePlanSha256s,
          body.proposal.format === 'ai_scene_native_border_policy_proposal_v2');
      check(digest(proposal) === digest(body.proposal), 'NATIVE_BORDER_POLICY_REPLAY');
      humanDecision(state, body.receipt, 'review');
      check(body.receipt.decision === 'accept' && body.receipt.targetSha256 === proposal.sha256
        && ![...state.paddingApprovals.values()].some(row => row.proposal.sha256 === proposal.sha256), 'NATIVE_BORDER_APPROVAL_STATE');
      state.paddingApprovals.set(record.sha256, record); break;
    }
    case 'ai_scene_native_border_preparation_v1': {
      const { record: compiled, bytes } = compileNativeBorderPreparation(store, state, { preparationId: body.recipe?.planId,
        approvalSha256: body.approvalSha256, sourcePlanSha256: body.sourcePlanSha256 });
      check(digest(compiled) === digest(record) && store.readBlob(body.rawSha256).equals(bytes), 'NATIVE_BORDER_REPLAY');
      const key = `scene-native-border/${body.sourcePlanSha256}`;
      check(!state.preparations.has(key), 'NATIVE_BORDER_EXISTS'); state.preparations.add(key);
      newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, kind: 'scene-native-border',
        result: { rawSha256: body.rawSha256, technical: record.technical }, status: 'pending-visual-review' }); break;
    }
    case 'ai_scene_source_recovery_v1': {
      const compiled = compileSourceRecovery(state, { recoveryId: body.recipe?.planId, proposal: body.proposal, receipt: body.receipt }, store.readBlob(body.rawSha256));
      check(digest(compiled) === digest(record), 'SOURCE_RECOVERY_REPLAY');
      humanDecision(state, body.receipt, 'review');
      const key = `scene-source-recovery/${body.sourcePlanSha256}`;
      check(!state.preparations.has(key), 'SOURCE_RECOVERY_EXISTS'); state.preparations.add(key);
      newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, kind: 'scene-source-recovery',
        result: { rawSha256: body.rawSha256, technical: record.technical }, status: 'pending-visual-review' }); break;
    }
    case 'ai_scene_environment_padding_approval_v1':
    case 'ai_scene_supplement_padding_approval_v1': {
      exact(body, ['format', 'proposal', 'receipt']);
      unseal(body.proposal);
      const compiled = body.format === 'ai_scene_supplement_padding_approval_v1'
        ? compileSupplementPaddingProposal(store, state, { batchSha256: body.proposal.batchSha256,
          items: body.proposal.items?.map(item => ({ key: item.key, sourcePlanSha256: item.sourcePlanSha256 })) })
        : compilePaddingProposal(store, state, body.proposal.plans?.map(item => ({ role: item.role, sourcePlanSha256: item.sourcePlanSha256 })));
      check(digest(compiled) === digest(body.proposal), 'ENVIRONMENT_PADDING_PROPOSAL_MISMATCH');
      humanDecision(state, body.receipt, 'review');
      check(body.receipt.decision === 'accept' && body.receipt.targetSha256 === body.proposal.sha256
        && ![...state.paddingApprovals.values()].some(item => item.proposal.sha256 === body.proposal.sha256), 'ENVIRONMENT_PADDING_APPROVAL_STATE');
      state.paddingApprovals.set(record.sha256, record); break;
    }
    case 'ai_scene_environment_preparation_v1':
    case 'ai_scene_environment_preparation_v2': {
      const compile = body.format === 'ai_scene_environment_preparation_v2' ? compileSupplementPadding : compileEnvironmentPadding;
      const { record: compiled, bytes } = compile(store, state, {
        preparationId: body.recipe?.planId, approvalSha256: body.approvalSha256, sourcePlanSha256: body.sourcePlanSha256 });
      check(digest(compiled) === digest(record) && store.readBlob(body.rawSha256).equals(bytes), 'ENVIRONMENT_PREPARATION_REPLAY_MISMATCH');
      const key = `${body.approvalSha256}/${body.sourcePlanSha256}`;
      check(!state.preparations.has(key), 'ENVIRONMENT_PREPARATION_EXISTS'); state.preparations.add(key);
      newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, kind: 'environment-preparation',
        result: { rawSha256: body.rawSha256, technical: record.technical }, status: 'pending-visual-review' }); break;
    }
    case 'ai_scene_environment_reinspection_v1': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compiled = compileEnvironmentReinspection(store, state, { inspectionId: body.recipe?.planId, sourcePlanSha256: body.sourcePlanSha256 });
      check(digest(compiled) === digest(record), 'REINSPECTION_RECOMPILE_MISMATCH');
      newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, kind: 'environment-reinspection',
        result: { rawSha256: body.rawSha256, technical: record.technical },
        status: record.technical.status === 'pass' ? 'pending-visual-review' : 'rejected-technical' }); break;
    }
    case 'ai_scene_reference_reinspection_v1': {
      check(store.metadata.compiler === 'scene-kit-native-reference-v2', 'WORKFLOW_COMPILER');
      const compiled = compileReferenceReinspection(store, state, { inspectionId: body.recipe?.planId, sourcePlanSha256: body.sourcePlanSha256 });
      check(digest(compiled) === digest(record), 'REINSPECTION_RECOMPILE_MISMATCH');
      newId(state, 'plan', body.recipe.planId);
      state.plans.set(record.sha256, { plan: record, kind: 'reference-reinspection',
        result: { rawSha256: body.rawSha256, technical: record.technical },
        status: record.technical.status === 'pass' ? 'pending-visual-review' : 'rejected-technical' }); break;
    }
    case 'ai_scene_generation_batch_v1': {
      exact(body, ['format', 'batchId', 'inventorySha256', 'referencePlanSha256', 'parents', 'planSha256s', 'maximumImageRequests', 'newImageRequests']);
      newId(state, body.format, body.batchId);
      const inventory = state.inventories.get(body.inventorySha256), reference = state.plans.get(body.referencePlanSha256);
      check(inventory && reference?.status === 'accepted' && Array.isArray(body.planSha256s) && body.planSha256s.length === inventory.modules.length
        && new Set(body.planSha256s).size === body.planSha256s.length && body.maximumImageRequests === body.planSha256s.length, 'BATCH_COVERAGE');
      check(Array.isArray(body.parents) && body.parents.length <= 1, 'BATCH_PARENT');
      const parent = body.parents.length ? state.batches.get(body.parents[0]) : null;
      check(!body.parents.length || (parent && parent.inventorySha256 === body.inventorySha256
        && parent.referencePlanSha256 === body.referencePlanSha256), 'BATCH_PARENT');
      let newRequests = 0;
      const assetIds = [];
      for (const sha256 of body.planSha256s) {
        const entry = state.plans.get(sha256);
        check(entry && entry.plan.recipe.inventoryRefs[0] === inventory.sha256
          && entry.plan.recipe.referencePlans[0] === body.referencePlanSha256, 'BATCH_PLAN');
        const prior = parent?.planSha256s.find(value => state.plans.get(value).plan.recipe.assetId === entry.plan.recipe.assetId);
        if (!parent || prior !== sha256) {
          check(entry.status === 'planned' && (!parent || entry.plan.recipe.parents[0] === prior), 'BATCH_REPLACEMENT_LINEAGE'); newRequests++;
        }
        assetIds.push(entry.plan.recipe.assetId);
      }
      check(digest(assetIds.toSorted()) === digest(inventory.modules.map(module => module.assetId).toSorted()), 'BATCH_COVERAGE');
      check(newRequests > 0 && body.newImageRequests === newRequests, 'BATCH_REQUEST_COUNT');
      state.batches.set(record.sha256, record); break;
    }
    case 'ai_scene_source_batch_preparation_v1':
    case 'ai_scene_source_batch_recovery_v1':
    case 'ai_scene_source_batch_v1':
    case 'ai_scene_source_batch_v2': {
      const border = body.format === 'ai_scene_source_batch_preparation_v1';
      const recovery = border || body.format === 'ai_scene_source_batch_recovery_v1';
      const revision = recovery || body.format === 'ai_scene_source_batch_v2';
      exact(body, ['format', 'batchId', 'profileSha256', 'referencePlanSha256', 'planSha256s', 'maximumImageRequests', ...(revision ? ['parentBatchSha256', 'newImageRequests'] : [])]);
      newId(state, body.format, body.batchId);
      check(body.profileSha256 === SCENE_SOURCE_PROFILE_SHA256 && Array.isArray(body.planSha256s)
        && body.planSha256s.length === SCENE_SOURCE_SLOTS.length && new Set(body.planSha256s).size === body.planSha256s.length
        && body.maximumImageRequests === body.planSha256s.length, 'SOURCE_BATCH_COVERAGE');
      const parent = revision ? state.batches.get(body.parentBatchSha256) : null;
      check(!revision || (['ai_scene_source_batch_v1', 'ai_scene_source_batch_v2', 'ai_scene_source_batch_recovery_v1', 'ai_scene_source_batch_preparation_v1'].includes(parent?.format)
        && parent.referencePlanSha256 === body.referencePlanSha256), 'SOURCE_BATCH_PARENT');
      let newRequests = 0;
      body.planSha256s.forEach((sha, index) => {
        const entry = state.plans.get(sha);
        const reference = state.plans.get(body.referencePlanSha256);
        const sourceFormats = reference?.plan.format === 'ai_scene_generation_plan_v10'
          ? ['ai_scene_generation_plan_v11', 'ai_scene_generation_plan_v12', 'ai_scene_generation_plan_v13', 'ai_scene_generation_plan_v14'] : ['ai_scene_generation_plan_v8'];
        if (recovery || (revision && parent?.planSha256s[index] === sha)) sourceFormats.push('ai_scene_source_recovery_v1', 'ai_scene_native_border_preparation_v1');
        check(sourceFormats.includes(entry?.plan.format)
          && entry.plan.recipe.slot === SCENE_SOURCE_SLOTS[index].key
          && entry.plan.recipe.referencePlans[0] === body.referencePlanSha256, 'SOURCE_BATCH_COVERAGE');
        const changed = !parent || parent.planSha256s[index] !== sha;
        check(changed ? recovery ? entry.kind === (border ? 'scene-native-border' : 'scene-source-recovery') && ['pending-visual-review', 'accepted'].includes(entry.status)
          && entry.plan.sourcePlanSha256 === parent.planSha256s[index]
          : entry.status === 'planned' && (!parent || entry.plan.recipe.parents[0] === parent.planSha256s[index])
          : ['planned', 'authorized', 'pending-visual-review', 'accepted'].includes(entry.status), 'SOURCE_BATCH_REPLACEMENT');
        if (changed) newRequests++;
        assertCurrent(state, entry.plan);
      });
      check(!revision || (recovery ? newRequests === 1 && body.newImageRequests === 0
        : newRequests > 0 && newRequests === body.newImageRequests), 'SOURCE_BATCH_REQUEST_COUNT');
      state.batches.set(record.sha256, record); break;
    }
    case 'ai_scene_source_batch_authorization_v1': {
      exact(body, ['format', 'batchSha256', 'nonce', 'receipt']); humanDecision(state, body.receipt, 'compute');
      const batch = state.batches.get(body.batchSha256);
      check([...TERRAIN_EDGE_BATCH_FORMATS,'ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3','ai_scene_source_batch_v1', 'ai_scene_source_batch_v2', 'ai_scene_reference_asset_batch_v1', 'ai_scene_reference_asset_batch_v2', 'ai_scene_reference_asset_batch_v3', 'ai_scene_reference_asset_batch_v4'].includes(batch?.format)
        &&batch.format!==TERRAIN_EDGE_PREPARED_BATCH_FORMAT&&batch.format!==TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT&&body.receipt.targetSha256 === batch.sha256
        && typeof body.nonce === 'string' && /^[a-f0-9]{32}$/.test(body.nonce) && !state.nonces.has(body.nonce), 'AUTHORIZATION_STATE');
      const all = batch.planSha256s.map(sha => state.plans.get(sha));
      all.forEach(entry => { check(entry.status === 'planned' || ((isTerrainEdgeRecoveryBatch(batch)||batch.format === 'ai_scene_source_batch_v2'||batch.format==='ai_scene_coherent_source_batch_v2'||batch.format==='ai_scene_coherent_source_batch_v3'||(batch.format==='ai_scene_coherent_source_batch_v1'&&batch.parentBatchSha256))
        && ['authorized', 'pending-visual-review', 'accepted'].includes(entry.status)), 'AUTHORIZATION_STATE'); assertCurrent(state, entry.plan);assertLatestDependencyBatch(state,entry.plan); });
      const entries = all.filter(entry => entry.status === 'planned'); check(entries.length > 0, 'AUTHORIZATION_STATE');
      if(batch.format==='ai_scene_coherent_source_batch_v3')check(entries.every(entry=>entry.plan.format==='ai_scene_generation_plan_v27'&&entry.plan.request.maximumCalls===1),'AUTHORIZATION_STATE');
      state.nonces.add(body.nonce);
      entries.forEach(entry => { entry.authorization = record; entry.status = 'authorized'; }); break;
    }
    case 'ai_scene_compute_authorization_v1': {
      exact(body, ['format', 'planSha256', 'nonce', 'maximumCalls', 'receipt']); humanDecision(state, body.receipt, 'compute');
      const entry = state.plans.get(body.planSha256);
      check(entry?.status === 'planned' && body.receipt.targetSha256 === body.planSha256 && body.maximumCalls === 1
        && typeof body.nonce === 'string' && body.nonce.length === 32 && /^[a-f0-9]{32}$/.test(body.nonce) && !state.nonces.has(body.nonce), 'AUTHORIZATION_STATE');
      if(TERRAIN_EDGE_PLAN_FORMATS.includes(entry.plan.format)&&state.plans.get(entry.plan.recipe.parents[0])?.status==='indeterminate'){
        check([...state.batches.values()].some(batch=>batch.format==='ai_scene_terrain_edge_recovery_batch_v2'
          &&batch.replacementPlanSha256===body.planSha256),'TERRAIN_EDGE_RECOVERY_UNKNOWN_TERMINAL');
      }
      assertCurrent(state, entry.plan);assertLatestDependencyBatch(state,entry.plan); state.nonces.add(body.nonce);
      entry.authorization = record; entry.status = 'authorized'; break;
    }
    case 'ai_scene_attempt_reservation_v1': {
      exact(body, ['format', 'planSha256', 'authorizationSha256', 'requestSha256']);
      const entry = state.plans.get(body.planSha256);
      check(entry?.status === 'authorized' && entry.authorization.sha256 === body.authorizationSha256
        && digest(entry.plan.request) === body.requestSha256, 'RESERVATION_STATE');
      if(TERRAIN_EDGE_PLAN_FORMATS.includes(entry.plan.format)){
        const batch=[...state.batches.values()].findLast(batch=>TERRAIN_EDGE_BATCH_FORMATS.includes(batch.format)
          &&batch.planSha256s.includes(body.planSha256));
        if(batch?.format==='ai_scene_terrain_edge_recovery_batch_v2'&&batch.replacementPlanSha256!==body.planSha256){
          const replacement=state.plans.get(batch.replacementPlanSha256);
          check(['pending-visual-review','accepted'].includes(replacement?.status)&&replacement.result?.technical.status==='pass',
            'TERRAIN_EDGE_RECOVERY_CONFIRMATION_REQUIRED');
        }
      }
      assertCurrent(state, entry.plan);assertLatestDependencyBatch(state,entry.plan); entry.attempt = record; entry.status = 'reserved'; break;
    }
    case 'ai_scene_submission_v1':
    case 'ai_scene_terminal_v1':
    case 'ai_scene_generation_result_v1': {
      const result = body.format === 'ai_scene_generation_result_v1', terminal = body.format === 'ai_scene_terminal_v1';
      exact(body, ['format', 'planSha256', 'attemptSha256', 'requestSha256', ...(result ? ['rawSha256', 'byteLength', 'technical'] : terminal ? ['outcome'] : [])]);
      const entry = state.plans.get(body.planSha256);
      check(entry && ['reserved', 'submitted'].includes(entry.status) && entry.attempt.sha256 === body.attemptSha256
        && entry.attempt.requestSha256 === body.requestSha256, 'ATTEMPT_NOT_PENDING');
      if (terminal) {
        check(['failed', 'indeterminate'].includes(body.outcome), 'OUTCOME_INVALID'); entry.terminal = record; entry.status = body.outcome;
      } else if (result) {
        check(isDigest(body.rawSha256), 'RAW_INTEGRITY');
        const bytes = store.readBlob(body.rawSha256);
        check(bytes.length === body.byteLength && digest(assessResult(entry.plan, bytes)) === digest(body.technical), 'RESULT_REPLAY_MISMATCH');
        entry.result = record; entry.status = body.technical.status === 'pass' ? 'pending-visual-review' : 'rejected-technical';
      } else { check(entry.status === 'reserved', 'SUBMISSION_ALREADY_RECORDED'); entry.submission = record; entry.status = 'submitted'; }
      break;
    }
    case 'ai_scene_image_review_v1': {
      exact(body, ['format', 'planSha256', 'technicalSha256', 'receipt']); humanDecision(state, body.receipt, 'review');
      const entry = state.plans.get(body.planSha256);
      check(entry?.status === 'pending-visual-review' && body.technicalSha256 === entry.result.technical.sha256
        && body.receipt.targetSha256 === entry.result.rawSha256, 'IMAGE_REVIEW_STATE');
        check(!['ai_scene_generation_plan_v15', 'ai_scene_generation_plan_v16', 'ai_scene_generation_plan_v17', 'ai_scene_generation_plan_v18', 'ai_scene_generation_plan_v19', 'ai_scene_generation_plan_v20','ai_scene_generation_plan_v28','ai_scene_generation_plan_v31','ai_scene_generation_plan_v32', 'ai_scene_reference_candidate_v1'].includes(entry.plan.format) || body.receipt.decision === 'reject', 'STANDARD_REFERENCE_REVIEW_REQUIRED');
        if(entry.plan.format==='ai_scene_generation_plan_v26' && body.receipt.decision==='accept') {
          assertCurrent(state,entry.plan); requireMaterialCoverage(state,body.planSha256);
        }
      entry.review = record; entry.status = body.receipt.decision === 'accept' ? 'accepted' : 'rejected-visual'; break;
    }
    case 'ai_scene_standard_reference_review_v1': {
      exact(body, ['format', 'planSha256', 'packetSha256', 'observation', 'receipt']); humanDecision(state, body.receipt, 'review');
      const entry = state.plans.get(body.planSha256);
      check(entry?.status === 'pending-visual-review' && entry.plan.format === 'ai_scene_generation_plan_v15', 'IMAGE_REVIEW_STATE');
      assertCurrent(state, entry.plan);
      const prepared = standardReferenceReviewFiles({ ...entry, bytes: store.readBlob(entry.result.rawSha256) }, body.observation);
      check(prepared.report.sha256 === body.packetSha256 && body.receipt.targetSha256 === body.packetSha256, 'STANDARD_REVIEW_TARGET');
      check(body.receipt.decision === 'reject' || prepared.report.metrics.status === 'pass', 'STANDARD_LAYOUT_REJECTED');
      entry.review = record; entry.status = body.receipt.decision === 'accept' ? 'accepted' : 'rejected-visual'; break;
    }
    case 'ai_scene_standard_reference_review_v2': {
      exact(body, ['format', 'planSha256', 'packetSha256', 'observation', 'receipt', 'reconstructionTarget']); humanDecision(state, body.receipt, 'review');
      const entry = state.plans.get(body.planSha256);
      check(entry?.status === 'pending-visual-review' && ['ai_scene_generation_plan_v16', 'ai_scene_generation_plan_v17'].includes(entry.plan.format), 'IMAGE_REVIEW_STATE');
      assertCurrent(state, entry.plan);
      const prepared = flexibleReferenceReviewFiles({ ...entry, bytes: store.readBlob(entry.result.rawSha256) }, body.observation);
      check(prepared.report.sha256 === body.packetSha256 && body.receipt.targetSha256 === body.packetSha256, 'STANDARD_REVIEW_TARGET');
      const target = body.receipt.decision === 'accept' ? acceptedReconstructionTarget(prepared, body.receipt) : null;
      check(digest(target) === digest(body.reconstructionTarget), 'RECONSTRUCTION_TARGET_REPLAY');
      entry.review = record; entry.reconstructionTarget = target;
      entry.status = body.receipt.decision === 'accept' ? 'accepted' : 'rejected-visual'; break;
    }
    case 'ai_scene_measured_reference_review_v1': {
      exact(body, ['format', 'planSha256', 'packetSha256', 'analysis', 'receipt', 'reconstructionTarget']); humanDecision(state, body.receipt, 'review');
      const entry = state.plans.get(body.planSha256);
      check(entry?.status === 'pending-visual-review' && ['ai_scene_generation_plan_v18', 'ai_scene_generation_plan_v19', 'ai_scene_generation_plan_v20','ai_scene_generation_plan_v28','ai_scene_generation_plan_v31','ai_scene_generation_plan_v32', 'ai_scene_reference_candidate_v1'].includes(entry.plan.format), 'IMAGE_REVIEW_STATE');
      assertCurrent(state, entry.plan);
      const prepared = measuredReferenceReviewFiles({ ...entry, bytes: store.readBlob(entry.result.rawSha256) }, body.analysis);
      check(body.packetSha256 === prepared.report.sha256 && body.receipt.targetSha256 === body.packetSha256, 'REFERENCE_LED_REVIEW_TARGET');
      const target = body.receipt.decision === 'accept' ? acceptMeasuredReferenceTarget(prepared, body.receipt) : null;
      check(digest(target) === digest(body.reconstructionTarget), 'RECONSTRUCTION_TARGET_REPLAY');
      entry.review = record; entry.reconstructionTarget = target; entry.status = target ? 'accepted' : 'rejected-visual'; break;
    }
    default: check(false, 'JOURNAL_RECORD_FORMAT');
  }
}
