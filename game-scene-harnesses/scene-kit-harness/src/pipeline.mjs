import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFreshDirectory, parseJson, readSelectedFile, writeFreshFile } from './files.mjs';
import { check, exact, hash, id, jsonBytes, seal, text, unseal } from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import { SCENE_SOURCE_SLOTS, SCENE_SOURCE_PROFILE_SHA256 } from './generation/scene-sources.mjs';
import { makeSceneLayerDesign, validateSceneLayerDesign } from './generation/scene-layers.mjs';
import { loadSceneKit, readMap } from './kit.mjs';
import { exportScene, exportSceneArchive, openSceneExport } from './persistence.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
export const STYLE_PRESETS = Object.freeze({
  'clean-handpaint': { name: '清爽手绘', rules: ['Clear silhouettes, broad hand-painted color shapes, low texture noise, consistent soft lighting.'] },
  'pixel-art': { name: '像素美术', rules: ['Deliberate pixel clusters, limited coherent palette, hard silhouette edges, no painterly blur or gradients.'] },
  'flat-color': { name: '简洁色块', rules: ['Clean flat color shapes, restrained palette, clear depth separation, little surface texture.'] },
});
// Paths belong to this local authoring call only. They never enter the frozen
// public scene, prompt, plan or package; original input bytes are content-addressed.
export function initScenePipeline(output, brief, { purpose = 'external-exchange' } = {}) {
  exact(brief, ['projectId', 'description', 'inputs', 'style', ...(Object.hasOwn(brief, 'layerContents') ? ['layerContents'] : [])]);
  id(brief.projectId); text(brief.description, { empty: true });
  const layerDesign = makeSceneLayerDesign(brief.layerContents ?? null);
  check(brief.projectId.length <= 50 && Array.isArray(brief.inputs) && brief.inputs.length <= 2, 'PIPELINE_BRIEF');
  check(brief.description.trim() || brief.inputs.length, 'SCENE_INPUT_REQUIRED');
  exact(brief.style, ['mode', 'preset', 'name', 'rules', 'anchorPath']);
  check(['preset', 'custom'].includes(brief.style.mode), 'PIPELINE_STYLE');
  const selected = STYLE_PRESETS[brief.style.preset];
  check(brief.style.mode === 'custom' ? brief.style.preset === null && typeof brief.style.anchorPath === 'string'
    : Boolean(selected) && brief.style.anchorPath === null, 'PIPELINE_STYLE');
  check(Array.isArray(brief.style.rules), 'PIPELINE_STYLE'); brief.style.rules.forEach(rule => text(rule, { limit: 1000 }));
  if (brief.style.mode === 'custom') text(brief.style.name);
  const inputs = brief.inputs.map(input => {
    exact(input, ['role', 'path']); check(['scene-reference', 'layout-sketch'].includes(input.role), 'PIPELINE_INPUT_ROLE');
    return { role: input.role, bytes: readSelectedFile(input.path, 16777216) };
  });
  check(new Set(inputs.map(input => input.role)).size === inputs.length, 'INPUT_ROLE_DUPLICATE');
  const anchor = brief.style.anchorPath === null ? null : readSelectedFile(brief.style.anchorPath, 16777216);
  const root = makeFreshDirectory(output, sourceRoot), workflow = join(root, 'workflow');
  flow.initWorkflow(workflow, { projectId: brief.projectId, purpose, compiler: 'scene-kit-native-reference-v2' });
  const spec = flow.createDesignDraft(workflow, { format: 'ai_scene_spec_v1', specId: `${brief.projectId}.spec`, projection: 'sideview',
    description: brief.description, inputs: inputs.map(input => ({ role: input.role, artifact: flow.importWorkflowImage(workflow, input.bytes) })),
    grid: { width: 64, height: 64 }, pixelsPerUnit: { numerator: 1, denominator: 1 }, viewport: { width: 1024, height: 576 }, mapSizeCells: { width: 16, height: 9 } });
  const style = flow.createDesignDraft(workflow, { format: 'ai_scene_style_v1', styleId: `${brief.projectId}.style`, mode: brief.style.mode,
    name: selected?.name ?? brief.style.name, rules: [...(selected?.rules ?? []), ...brief.style.rules],
    anchors: anchor ? [flow.importWorkflowImage(workflow, anchor)] : [] });
  const capabilities = flow.createDesignDraft(workflow, { format: 'ai_scene_image_capabilities_v1', capabilityId: 'native.image.host.v1', source: 'host-declared',
    textToImage: true, imageToImage: true, exactSize: false, transparentBackground: true, maxInputImages: 5,
    maxWidth: 4096, maxHeight: 4096, maximumCallsPerRequest: 1, outputFormat: 'png' });
  const project = seal({ format: 'ai_scene_pipeline_project_v2', projectId: brief.projectId, purpose, layerDesignSha256: layerDesign.sha256,
    profileSha256: SCENE_SOURCE_PROFILE_SHA256, specSha256: spec.sha256, styleSha256: style.sha256, capabilitiesSha256: capabilities.sha256 });
  for (const [name, value] of Object.entries({ project, 'spec-draft': spec, 'style-draft': style, 'layers-draft': layerDesign, capabilities }))
    writeFreshFile(join(root, `${name}.json`), jsonBytes(value), sourceRoot);
  return inspectScenePipeline(root);
}
function projectAt(root) {
  const project = parseJson(readSelectedFile(join(root, 'project.json'))), body = unseal(project);
  const layered = body.format === 'ai_scene_pipeline_project_v2';
  exact(body, ['format', 'projectId', 'purpose', 'profileSha256', 'specSha256', 'styleSha256', 'capabilitiesSha256', ...(layered ? ['layerDesignSha256'] : [])]);
  check(['ai_scene_pipeline_project_v1', 'ai_scene_pipeline_project_v2'].includes(body.format)
    && body.profileSha256 === SCENE_SOURCE_PROFILE_SHA256, 'PIPELINE_PROJECT');
  id(body.projectId);
  let layerDesign = null;
  if (layered) {
    layerDesign = parseJson(readSelectedFile(join(root, 'layers-draft.json'))); validateSceneLayerDesign(layerDesign);
    check(layerDesign.sha256 === body.layerDesignSha256, 'PIPELINE_PROJECT');
  }
  let capabilities;
  for (const [name, sha] of [['spec-draft', body.specSha256], ['style-draft', body.styleSha256], ['capabilities', body.capabilitiesSha256]]) {
    const doc = parseJson(readSelectedFile(join(root, `${name}.json`))); unseal(doc); check(doc.sha256 === sha, 'PIPELINE_PROJECT');
    if (name === 'capabilities') capabilities = doc;
  }
  const state = flow.inspectWorkflow(join(root, 'workflow'));
  check(state.projectId === body.projectId && state.purpose === body.purpose, 'PIPELINE_PROJECT');
  if (layered) for (const reference of state.plans.filter(plan => plan.stage === 'reference' && plan.current)) {
    check(reference.layerDesignSha256 === layerDesign.sha256, 'PIPELINE_LAYER_DESIGN_CHANGED');
  }
  return { project, state, capabilities, layerDesign, workflow: join(root, 'workflow') };
}
export function reviewPipelineDesign(root, decisions) {
  exact(decisions, ['spec', 'style']); const { project, workflow } = projectAt(root);
  check(decisions.spec.targetSha256 === project.specSha256 && decisions.style.targetSha256 === project.styleSha256, 'PIPELINE_REVIEW_TARGET');
  flow.reviewSceneDesigns(workflow, decisions);
  return advanceScenePipeline(root);
}
export function inspectScenePipeline(root) {
  const { project, state, workflow } = projectAt(root), reference = state.plans.findLast(plan => plan.stage === 'reference' && plan.current);
  const batches = state.batches.map(sha => flow.getSceneSourceBatch(workflow, sha));
  const batch = batches.findLast(item => item.referencePlanSha256 === reference?.planSha256);
  const sourcePlans = batch ? batch.planSha256s.map(sha => state.plans.find(plan => plan.planSha256 === sha)) : [];
  let stage = 'awaiting-design-review';
  if (state.activeSpecSha256 === project.specSha256 && state.activeStyleSha256 === project.styleSha256) {
    stage = !reference ? 'reference-plan-needed' : reference.status === 'accepted' ? !sourcePlans.length ? 'source-batch-needed'
      : sourcePlans.every(plan => ['pending-visual-review', 'accepted'].includes(plan.status)) ? 'ready-to-assemble'
      : sourcePlans.some(plan => ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual', 'reserved', 'submitted'].includes(plan.status)) ? 'attention-required'
      : sourcePlans.some(plan => plan.status === 'planned') ? 'awaiting-source-compute' : 'ready-to-generate-sources'
      : reference.status === 'planned' ? 'awaiting-reference-compute' : reference.status === 'authorized' ? 'ready-to-generate-reference'
      : reference.status === 'pending-visual-review' ? 'awaiting-reference-review' : 'attention-required';
  }
  return { format: 'ai_scene_pipeline_status_v1', projectId: project.projectId, purpose: project.purpose, stage,
    design: { specSha256: project.specSha256, styleSha256: project.styleSha256,
      ...(project.layerDesignSha256 ? { layerDesignSha256: project.layerDesignSha256 } : {}) }, reference: reference ?? null,
    sourceBatches: state.batches, activeSourceBatchSha256: batch?.sha256 ?? null, sources: sourcePlans, requiredSourceCount: SCENE_SOURCE_SLOTS.length,
    eventCount: state.eventCount, productionKit: false, fullKitVisualAcceptance: 'not-assessed', automaticRetry: false };
}
export function advanceScenePipeline(root) {
  const status = inspectScenePipeline(root), { project, capabilities, layerDesign, workflow } = projectAt(root);
  if (status.stage === 'reference-plan-needed') flow.freezeSceneReferencePlan(workflow, {
    planId: `${project.projectId}.reference`, parents: [], capabilitiesSha256: project.capabilitiesSha256,
    pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 576, maximumWidth: capabilities.maxWidth, maximumHeight: capabilities.maxHeight },
    ...(layerDesign ? { layerDesign } : {}),
    intent: 'Complete side-view scene reference for the reviewed source pipeline and default one-screen layout.' });
  if (status.stage === 'source-batch-needed') flow.freezeSceneSourceBatch(workflow, { batchId: `sources.${status.reference.planSha256.slice(0, 24)}`,
    referencePlanSha256: status.reference.planSha256, capabilitiesSha256: project.capabilitiesSha256,
    ...(project.format === 'ai_scene_pipeline_project_v2' ? { sourceCompiler: 'isolated-role-v1' } : {}),
    intent: 'Generate every required source once, then derive the complete reusable terrain and finite scenery candidate.' });
  return inspectScenePipeline(root);
}
export function authorizePipelineStage(root, decision) {
  const status = advanceScenePipeline(root), { workflow } = projectAt(root);
  if (status.stage === 'awaiting-reference-compute') {
    check(decision.targetSha256 === status.reference.planSha256, 'PIPELINE_COMPUTE_TARGET');
    flow.authorizePlan(workflow, status.reference.planSha256, decision);
  } else {
    check(status.stage === 'awaiting-source-compute'
      && decision.targetSha256 === status.activeSourceBatchSha256, 'PIPELINE_COMPUTE_TARGET');
    flow.authorizeSceneSourceBatch(workflow, status.activeSourceBatchSha256, decision);
  }
  return inspectScenePipeline(root);
}
export function reviewPipelineImage(root, planSha256, decision) {
  const { workflow } = projectAt(root); flow.reviewResult(workflow, planSha256, decision); return advanceScenePipeline(root);
}
// A host adapter receives only the frozen prompt, exact image bytes and hashes.
// Throwing, timing out, or losing the process is conservatively indeterminate.
// A second run never spends the same reserved attempt again.
export async function runScenePipeline(root, adapter, { onProgress = () => {} } = {}) {
  check(adapter && typeof adapter.preflight === 'function' && typeof adapter.generate === 'function', 'PIPELINE_ADAPTER_REQUIRED');
  const status = advanceScenePipeline(root);
  check(['ready-to-generate-reference', 'ready-to-generate-sources'].includes(status.stage), 'PIPELINE_NOT_AUTHORIZED');
  await adapter.preflight();
  const { workflow } = projectAt(root), selected = status.stage === 'ready-to-generate-reference' ? [status.reference] : status.sources;
  for (const entry of selected) {
    if (['pending-visual-review', 'accepted'].includes(entry.status)) continue;
    check(entry.status === 'authorized', 'PIPELINE_PENDING_ATTEMPT');
    const plan = flow.getGenerationPlan(workflow, entry.planSha256);
    const { request, ...ticket } = flow.reservePlan(workflow, entry.planSha256);
    flow.recordSubmission(workflow, ticket);
    onProgress({ stage: 'dispatch', planSha256: entry.planSha256, assetId: plan.recipe.assetId });
    let bytes;
    try {
      bytes = await adapter.generate({ planSha256: entry.planSha256, attemptSha256: ticket.attemptSha256,
        requestSha256: ticket.requestSha256, request,
        images: request.images.map((image, index) => ({ ...image, bytes: flow.readGenerationInput(workflow, entry.planSha256, index) })) });
      check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'PIPELINE_ADAPTER_OUTPUT');
    } catch {
      flow.stopAttempt(workflow, ticket, 'indeterminate');
      onProgress({ stage: 'indeterminate', planSha256: entry.planSha256 }); return inspectScenePipeline(root);
    }
    // Reception failures retain any raw blob already written and the reservation.
    // They never trigger another provider call or an invented success record.
    const result = flow.receiveResult(workflow, ticket, bytes);
    onProgress({ stage: result.technical.status === 'pass' ? 'received' : 'rejected-technical', planSha256: entry.planSha256, rawSha256: result.rawSha256 });
    if (result.technical.status !== 'pass') break;
  }
  return advanceScenePipeline(root);
}
export function deliverScenePipeline(root, output) {
  const status = advanceScenePipeline(root), { project, workflow } = projectAt(root);
  check(status.stage === 'ready-to-assemble' && status.activeSourceBatchSha256, 'PIPELINE_SOURCES_INCOMPLETE');
  const out = makeFreshDirectory(output, sourceRoot), candidateId = `${project.projectId}.kit`, batch = status.activeSourceBatchSha256;
  const bundle = flow.buildSceneSourceCandidate(workflow, batch, candidateId, join(out, 'candidate'));
  const replay = flow.verifySceneSourceCandidate(workflow, batch, candidateId, join(out, 'candidate'));
  const kit = loadSceneKit(join(out, 'candidate/kit')), map = readMap(kit), runtime = exportScene(kit, map, join(out, 'export'));
  const bytes = exportSceneArchive(kit, map); writeFreshFile(join(out, 'scene-kit.zip'), bytes, sourceRoot);
  const reopened = openSceneExport(join(out, 'export'));
  const report = seal({ format: 'ai_scene_pipeline_delivery_v1', projectId: project.projectId, batchSha256: batch,
    candidateBundleSha256: bundle.sha256, verifiedCandidateFiles: replay.verifiedFiles, exportFiles: runtime.fileCount,
    compiledSha256: reopened.compiled.contentSha256, zip: { sha256: hash(bytes), byteLength: bytes.length },
    sourceReviews: status.sources.map(source => ({ planSha256: source.planSha256, status: source.status })),
    fullKitVisualAcceptance: 'not-assessed', geometryAcceptance: 'not-assessed', productionKit: false, generationCalls: 0 });
  writeFreshFile(join(out, 'delivery.json'), jsonBytes(report), sourceRoot); return report;
}
export function verifyPipelineDelivery(root, output) {
  const status = inspectScenePipeline(root), report = parseJson(readSelectedFile(join(output, 'delivery.json'))); unseal(report);
  check(report.format === 'ai_scene_pipeline_delivery_v1' && report.projectId === status.projectId
    && report.batchSha256 === status.activeSourceBatchSha256 && report.productionKit === false
    && report.fullKitVisualAcceptance === 'not-assessed', 'PIPELINE_DELIVERY_IDENTITY');
  const replay = flow.verifySceneSourceCandidate(join(root, 'workflow'), report.batchSha256, `${status.projectId}.kit`, join(output, 'candidate'));
  check(replay.bundleSha256 === report.candidateBundleSha256, 'PIPELINE_DELIVERY_IDENTITY');
  const sourceKit = loadSceneKit(join(output, 'candidate/kit'));
  const runtime = openSceneExport(join(output, 'export')), zip = readSelectedFile(join(output, 'scene-kit.zip'), 268435456);
  check(runtime.compiled.contentSha256 === report.compiledSha256 && hash(zip) === report.zip.sha256
    && zip.length === report.zip.byteLength && runtime.handle.bundleSha256 === sourceKit.bundleSha256
    && zip.equals(exportSceneArchive(sourceKit, readMap(sourceKit))), 'PIPELINE_DELIVERY_IDENTITY');
  return report;
}
export function deliverSceneComposition(root, plan, output) {
  unseal(plan);
  const { project, workflow } = projectAt(root), out = makeFreshDirectory(output, sourceRoot);
  const bundle = flow.buildSceneSourceComposition(workflow, plan, join(out, 'candidate'));
  const verified = flow.verifySceneSourceComposition(workflow, plan, join(out, 'candidate'));
  const kit = loadSceneKit(join(out, 'candidate/kit')), map = readMap(kit);
  const runtime = exportScene(kit, map, join(out, 'export')), bytes = exportSceneArchive(kit, map);
  const reopened = openSceneExport(join(out, 'export'));
  writeFreshFile(join(out, 'scene-kit.zip'), bytes, sourceRoot);
  writeFreshFile(join(out, 'composition-plan.json'), jsonBytes(plan), sourceRoot);
  const report = seal({ format: 'ai_scene_composition_delivery_v1', projectId: project.projectId,
    batchSha256: plan.sourceBatchSha256, compositionPlanSha256: plan.sha256, candidateBundleSha256: bundle.sha256,
    verifiedCandidateFiles: verified.verifiedFiles, exportFiles: runtime.fileCount, compiledSha256: reopened.compiled.contentSha256,
    zip: { sha256: hash(bytes), byteLength: bytes.length }, sourceArtAcceptance: 'unchanged-not-granted',
    fullKitVisualAcceptance: 'not-assessed', geometryAcceptance: 'not-assessed', productionKit: false, generationCalls: 0 });
  writeFreshFile(join(out, 'delivery.json'), jsonBytes(report), sourceRoot); return report;
}
export function verifySceneCompositionDelivery(root, output) {
  const { project, workflow } = projectAt(root), report = parseJson(readSelectedFile(join(output, 'delivery.json')));
  const plan = parseJson(readSelectedFile(join(output, 'composition-plan.json'))); unseal(report); unseal(plan);
  check(report.format === 'ai_scene_composition_delivery_v1' && report.projectId === project.projectId
    && report.compositionPlanSha256 === plan.sha256 && report.batchSha256 === plan.sourceBatchSha256
    && report.productionKit === false && report.fullKitVisualAcceptance === 'not-assessed', 'COMPOSITION_DELIVERY_IDENTITY');
  const verified = flow.verifySceneSourceComposition(workflow, plan, join(output, 'candidate'));
  const kit = loadSceneKit(join(output, 'candidate/kit')), reopened = openSceneExport(join(output, 'export'));
  const bytes = readSelectedFile(join(output, 'scene-kit.zip'), 268435456);
  check(verified.bundleSha256 === report.candidateBundleSha256 && reopened.compiled.contentSha256 === report.compiledSha256
    && reopened.handle.bundleSha256 === kit.bundleSha256 && hash(bytes) === report.zip.sha256
    && bytes.length === report.zip.byteLength && bytes.equals(exportSceneArchive(kit, readMap(kit))), 'COMPOSITION_DELIVERY_IDENTITY');
  return report;
}
export function pipelinePlans(root) {
  const status = advanceScenePipeline(root), workflow = join(root, 'workflow');
  return { status, plans: [status.reference, ...status.sources].filter(Boolean).map(item => flow.getGenerationPlan(workflow, item.planSha256)),
    batches: status.sourceBatches.map(sha => flow.getSceneSourceBatch(workflow, sha)) };
}
export function revisePipelineSources(root, options) {
  const status = inspectScenePipeline(root); check(status.stage === 'attention-required' && status.activeSourceBatchSha256, 'PIPELINE_REVISION_STATE');
  flow.reviseSceneSourceBatch(join(root, 'workflow'), status.activeSourceBatchSha256, options); return inspectScenePipeline(root);
}
export function revisePipelineReference(root, options) {
  exact(options, ['planId', 'intent']);
  const status = inspectScenePipeline(root), { project, workflow } = projectAt(root);
  check(status.reference && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(status.reference.status), 'PIPELINE_REVISION_STATE');
  flow.reviseGenerationPlan(workflow, status.reference.planSha256, { ...options, capabilitiesSha256: project.capabilitiesSha256 });
  return inspectScenePipeline(root);
}
