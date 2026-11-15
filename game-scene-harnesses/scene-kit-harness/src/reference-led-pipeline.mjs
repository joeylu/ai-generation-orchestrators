import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFreshDirectory, parseJson, portableReader, readSelectedFile, writeFreshFile } from './files.mjs';
import { check, digest, exact, hash, id, imageRef, jsonBytes, seal, text, unseal } from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import { validateReferenceRequirements, validateReferenceViewport } from './reference-measurement.mjs';
import { writeProofBundle, verifyProofBundle } from './terrain-proof/bundle.mjs';
import { STYLE_PRESETS } from './pipeline.mjs';
import { REFERENCE_CONTROL_FILES, validateControlReviewPacket } from './generation/reference-controlled.mjs';
import { decompositionReviewFiles, visibleOwnershipFiles } from './reference-decomposition.mjs';
import { segmentationSeedFiles, seededSegmentationReviewFiles } from './reference-segmentation.mjs';
import { promptSegmentationFiles, promptSegmentationReviewFiles } from './reference-prompt-segmentation.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
export function initReferenceLedProject(output, brief, { purpose = 'external-exchange' } = {}) {
  exact(brief, ['projectId', 'description', 'viewport', 'maxAspectErrorPermille', 'requirements', 'inputs', 'style']);
  id(brief.projectId); text(brief.description); check(brief.projectId.length <= 50, 'REFERENCE_PROJECT_ID');
  validateReferenceViewport(brief.viewport); validateReferenceRequirements(brief.requirements);
  check(Number.isInteger(brief.maxAspectErrorPermille) && brief.maxAspectErrorPermille >= 0 && brief.maxAspectErrorPermille <= 20, 'REFERENCE_ASPECT_TOLERANCE');
  check(Array.isArray(brief.inputs) && brief.inputs.length <= 2, 'REFERENCE_INPUTS');
  const inputs = brief.inputs.map(i => {
    exact(i, ['role', 'path']); check(i.role === 'style-reference', 'REFERENCE_LED_INPUT_ROLE');
    const bytes = readSelectedFile(i.path, 16777216); return { bytes, artifact: imageRef(bytes, { allowCabx: true }) };
  });
  check(new Set(inputs.map(i => i.artifact.sha256)).size === inputs.length, 'INPUT_ROLE_DUPLICATE');
  exact(brief.style, ['mode', 'preset', 'name', 'rules', 'anchorPath']);
  const s = brief.style, preset = STYLE_PRESETS[s.preset];
  check(['preset', 'custom'].includes(s.mode) && (s.mode === 'preset' ? Boolean(preset) && s.anchorPath === null : s.preset === null && typeof s.anchorPath === 'string'), 'REFERENCE_STYLE');
  check(Array.isArray(s.rules) && s.rules.length + (preset?.rules.length ?? 0) >= 1 && s.rules.length + (preset?.rules.length ?? 0) <= 32, 'REFERENCE_STYLE');
  s.rules.forEach(rule => text(rule, { limit: 1000 })); if (s.mode === 'custom') text(s.name);
  const anchor = s.anchorPath === null ? null : readSelectedFile(s.anchorPath, 16777216); if (anchor) imageRef(anchor, { allowCabx: true });
  const root = makeFreshDirectory(output, sourceRoot), workflow = join(root, 'workflow');
  flow.initWorkflow(workflow, { projectId: brief.projectId, purpose, compiler: 'scene-kit-native-reference-v2' });
  const spec = flow.createDesignDraft(workflow, { format: 'ai_scene_spec_v3', specId: `${brief.projectId}.spec`, mode: 'reference-led', projection: 'sideview',
    description: brief.description, viewport: brief.viewport, maxAspectErrorPermille: brief.maxAspectErrorPermille, requirements: brief.requirements,
    inputs: inputs.map(i => ({ role: 'style-reference', artifact: flow.importStandardWorkflowImage(workflow, i.bytes) })) });
  const style = flow.createDesignDraft(workflow, { format: 'ai_scene_style_v2', styleId: `${brief.projectId}.style`, mode: s.mode,
    name: preset?.name ?? s.name, rules: [...(preset?.rules ?? []), ...s.rules], anchors: anchor ? [flow.importStandardWorkflowImage(workflow, anchor)] : [] });
  const capabilities = flow.createDesignDraft(workflow, { format: 'ai_scene_image_capabilities_v1', capabilityId: 'reference.led.host.v1', source: 'host-declared',
    textToImage: true, imageToImage: true, exactSize: false, transparentBackground: true, maxInputImages: 5,
    maxWidth: 4096, maxHeight: 4096, maximumCallsPerRequest: 1, outputFormat: 'png' });
  const project = seal({ format: 'ai_scene_reference_led_project_v1', mode: 'reference-led', projectId: brief.projectId, purpose,
    specSha256: spec.sha256, styleSha256: style.sha256, capabilitiesSha256: capabilities.sha256, requirementsSha256: brief.requirements.sha256 });
  for (const [name, value] of Object.entries({ project, 'spec-draft': spec, 'style-draft': style, capabilities, requirements: brief.requirements }))
    writeFreshFile(join(root, `${name}.json`), jsonBytes(value), sourceRoot);
  return inspectReferenceLedProject(root);
}
function projectAt(root) {
  const read = name => parseJson(readSelectedFile(join(root, `${name}.json`))), project = read('project'), p = unseal(project);
  exact(p, ['format', 'mode', 'projectId', 'purpose', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'requirementsSha256']);
  check(p.format === 'ai_scene_reference_led_project_v1' && p.mode === 'reference-led', 'REFERENCE_LED_PROJECT');
  const spec = read('spec-draft'), style = read('style-draft'), cap = read('capabilities'), requirements = read('requirements');
  for (const [doc, sha] of [[spec, p.specSha256], [style, p.styleSha256], [cap, p.capabilitiesSha256], [requirements, p.requirementsSha256]]) {
    unseal(doc); check(doc.sha256 === sha, 'REFERENCE_LED_PROJECT');
  }
  validateReferenceRequirements(requirements);
  check(spec.format === 'ai_scene_spec_v3' && spec.requirements.sha256 === requirements.sha256, 'REFERENCE_LED_PROJECT');
  const workflow = join(root, 'workflow'), state = flow.inspectWorkflow(workflow);
  check(state.projectId === p.projectId && state.purpose === p.purpose, 'REFERENCE_LED_PROJECT');
  for (const entry of state.plans.filter(e => e.current)) {
    const plan = flow.getGenerationPlan(workflow, entry.planSha256);
    if (['reference-asset', 'reference-paint-source','coherent-source','terrain-edge-source'].includes(entry.stage)) {
      check(['ai_scene_generation_plan_v21', 'ai_scene_generation_plan_v22', 'ai_scene_generation_plan_v23', 'ai_scene_generation_plan_v24', 'ai_scene_generation_plan_v25', 'ai_scene_generation_plan_v26','ai_scene_generation_plan_v27','ai_scene_generation_plan_v29','ai_scene_generation_plan_v30','ai_scene_generation_plan_v33','ai_scene_generation_plan_v34','ai_scene_generation_plan_v35','ai_scene_generation_plan_v36','ai_scene_generation_plan_v37','ai_scene_terrain_edge_native_size_preparation_v1','ai_scene_terrain_edge_canvas_gutter_preparation_v1','ai_scene_coherent_border_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2','ai_scene_coherent_native_frame_preparation_v1','ai_scene_coherent_rebind_v1'].includes(plan.format) && plan.recipe.specSha256 === project.specSha256
        && plan.recipe.styleSha256 === project.styleSha256, 'REFERENCE_LED_PROJECT'); continue;
    }
    check(['ai_scene_generation_plan_v18', 'ai_scene_generation_plan_v19', 'ai_scene_generation_plan_v20','ai_scene_generation_plan_v28','ai_scene_generation_plan_v31','ai_scene_generation_plan_v32', 'ai_scene_reference_candidate_v1'].includes(plan.format)
      && plan.referenceRequirements.sha256 === requirements.sha256, 'REFERENCE_LED_PROJECT');
  }
  return { project, spec, style, cap, requirements, workflow, state };
}
export function inspectReferenceLedProject(root) {
  const { project, state } = projectAt(root), reference = state.plans.findLast(e => e.current && e.stage === 'reference');
  let stage = 'awaiting-design-review';
  if (state.activeSpecSha256 === project.specSha256 && state.activeStyleSha256 === project.styleSha256) {
    stage = !reference ? 'reference-candidate-or-plan-needed' : ({ planned: 'awaiting-reference-compute', authorized: 'ready-to-generate-reference',
      'pending-visual-review': 'awaiting-standards-and-measured-layout-review', accepted: 'reference-accepted-reconstruction-pending' })[reference.status] ?? 'attention-required';
  }
  return { format: 'ai_scene_reference_led_status_v1', projectId: project.projectId, mode: 'reference-led', stage,
    design: { specSha256: project.specSha256, styleSha256: project.styleSha256, requirementsSha256: project.requirementsSha256 }, reference: reference ?? null,
    eventCount: state.eventCount, pregenerationPixelGeometry: 'not-prescribed', reconstructionTargetSha256: reference?.reconstructionTargetSha256 ?? null,
    automaticSemanticDetection: false, faithfulAssetReconstruction: 'not-implemented', productionKit: false, automaticRetry: false };
}
function optionsAt(root) {
  const { project, spec, cap, workflow } = projectAt(root);
  return { workflow, options: { specSha256: project.specSha256, styleSha256: project.styleSha256, capabilitiesSha256: cap.sha256,
    pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: Math.max(256, spec.viewport.height), maximumWidth: cap.maxWidth, maximumHeight: cap.maxHeight },
    intent: 'Create a new complete scene from the accepted content and standards. Measure and freeze the actual layout only after image review.' } };
}
function proposalFiles(root) {
  const { workflow, options } = optionsAt(root), proposal = flow.previewReferenceLedPlan(workflow, options);
  const files = new Map([['proposal.json', jsonBytes(proposal)], ['requirements.json', jsonBytes(proposal.referenceRequirements)], ['prompt.txt', Buffer.from(proposal.request.prompt)]]);
  const bundle = seal({ format: 'ai_scene_reference_led_design_bundle_v1', proposalSha256: proposal.sha256, executable: false, generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report: proposal, bundle, workflow };
}
export const previewReferenceLedProject = (root, output) => { const p = proposalFiles(root); return writeProofBundle(output, p.workflow, p); };
export const verifyReferenceLedPreview = (root, output) => verifyProofBundle(output, proposalFiles(root));
export function reviewReferenceLedDesign(root, receipts) {
  const { project, workflow } = projectAt(root); exact(receipts, ['spec', 'style']);
  check(receipts.spec.targetSha256 === project.specSha256 && receipts.style.targetSha256 === project.styleSha256, 'REFERENCE_LED_REVIEW_TARGET');
  flow.reviewSceneDesigns(workflow, receipts); return inspectReferenceLedProject(root);
}
export function planReferenceLedProject(root, options = {}) {
  check(options && typeof options === 'object' && !Array.isArray(options), 'REFERENCE_LED_OPTIONS');
  exact(options, Object.keys(options)); check(Object.keys(options).every(k => ['planId', 'parents'].includes(k)), 'REFERENCE_LED_OPTIONS');
  const { project } = projectAt(root), { workflow, options: defaults } = optionsAt(root);
  const { specSha256: _spec, styleSha256: _style, ...fields } = defaults;
  flow.freezeReferenceLedPlan(workflow, { ...fields, planId: options.planId ?? `${project.projectId}.reference`, parents: options.parents ?? [] });
  return inspectReferenceLedProject(root);
}
export function intakeReferenceLedImage(root, imagePath, intakeOptions) {
  exact(intakeOptions, ['planId']); const { planId } = intakeOptions;
  const { workflow, options } = optionsAt(root), { specSha256: _spec, styleSha256: _style, ...fields } = options;
  flow.intakeReferenceLedCandidate(workflow, { ...fields, planId, parents: [] }, readSelectedFile(imagePath, 16777216));
  return inspectReferenceLedProject(root);
}
export function previewReferenceLedIsolationProject(root, options) {
  const { workflow } = projectAt(root); return flow.previewReferenceLedIsolation(workflow, options);
}
export function planReferenceLedIsolationProject(root, options) {
  const { workflow } = projectAt(root); flow.freezeReferenceLedIsolation(workflow, options); return inspectReferenceLedProject(root);
}
export function importReferenceControlProject(root, reviewDirectory, options) {
  exact(options, ['controlId', 'sourcePlanSha256']); const { workflow } = projectAt(root);
  const reviewPacket = parseJson(readSelectedFile(join(reviewDirectory, 'review-packet.json'))); validateControlReviewPacket(reviewPacket);
  const artifacts = new Map(REFERENCE_CONTROL_FILES.map(name => [name, readSelectedFile(join(reviewDirectory, name), 4194304)]));
  return flow.importReferenceControls(workflow, { ...options, reviewPacket }, artifacts);
}
export function reviewReferenceControlProject(root, controlsSha256, receipt) {
  const { workflow } = projectAt(root); return flow.reviewReferenceControls(workflow, controlsSha256, receipt);
}
export function previewReferenceControlledProject(root, options) {
  const { workflow } = projectAt(root); return flow.previewReferenceControlledPlan(workflow, options);
}
export function planReferenceControlledProject(root, options) {
  const { workflow } = projectAt(root); flow.freezeReferenceControlledPlan(workflow, options); return inspectReferenceLedProject(root);
}
export function authorizeReferenceLedProject(root, receipt) {
  const status = inspectReferenceLedProject(root), { workflow } = projectAt(root);
  check(status.stage === 'awaiting-reference-compute' && receipt.targetSha256 === status.reference.planSha256, 'REFERENCE_LED_COMPUTE_TARGET');
  flow.authorizePlan(workflow, status.reference.planSha256, receipt); return inspectReferenceLedProject(root);
}
export async function runReferenceLedProject(root, adapter) {
  check(adapter && typeof adapter.preflight === 'function' && typeof adapter.generate === 'function', 'PIPELINE_ADAPTER_REQUIRED');
  const status = inspectReferenceLedProject(root); check(status.stage === 'ready-to-generate-reference', 'PIPELINE_NOT_AUTHORIZED');
  await adapter.preflight(); const { workflow } = projectAt(root), sha = status.reference.planSha256;
  const { request, ...ticket } = flow.reservePlan(workflow, sha); flow.recordSubmission(workflow, ticket);
  let bytes;
  try {
    bytes = await adapter.generate({ ...ticket, request, images: request.images.map((i, index) => ({ ...i, bytes: flow.readGenerationInput(workflow, sha, index) })) });
    check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'PIPELINE_ADAPTER_OUTPUT');
  } catch { flow.stopAttempt(workflow, ticket, 'indeterminate'); return inspectReferenceLedProject(root); }
  flow.receiveResult(workflow, ticket, bytes); return inspectReferenceLedProject(root);
}
function current(root) {
  const { workflow } = projectAt(root), status = inspectReferenceLedProject(root); check(status.reference?.received, 'RESULT_REQUIRED');
  return { workflow, sha: status.reference.planSha256 };
}
export function assessReferenceLedImage(root, analysis, output) { const { workflow, sha } = current(root); return flow.buildMeasuredReferenceReview(workflow, sha, analysis, output); }
export function verifyReferenceLedImageReview(root, analysis, output) { const { workflow, sha } = current(root); return flow.verifyMeasuredReferenceReview(workflow, sha, analysis, output); }
export function reviewReferenceLedImage(root, analysis, receipt) {
  const { workflow, sha } = current(root); flow.reviewMeasuredReference(workflow, sha, analysis, receipt); return inspectReferenceLedProject(root);
}
export function exportReferenceLedTarget(root, output) {
  const { workflow, sha } = current(root), target = flow.getReferenceReconstructionTarget(workflow, sha), bytes = jsonBytes(target);
  const files = new Map([['reconstruction-target.json', bytes]]), bundle = seal({ format: 'ai_scene_measured_target_bundle_v1', targetSha256: target.sha256,
    artifacts: [{ path: 'reconstruction-target.json', sha256: hash(bytes), byteLength: bytes.length }], assetPackage: false, generationCalls: 0 });
  files.set('proof-bundle.json', jsonBytes(bundle)); return writeProofBundle(output, workflow, { files, bundle, report: target });
}
function decompositionSource(root) {
  const { workflow, state } = projectAt(root), reference = state.plans.findLast(e => e.current && e.stage === 'reference');
  check(reference?.status === 'accepted', 'DECOMPOSITION_ACCEPTED_TARGET');
  const target = flow.getReferenceReconstructionTarget(workflow, reference.planSha256);
  const { bytes } = flow.getGenerationResult(workflow, reference.planSha256);
  return { workflow, target, bytes };
}
export function buildReferenceDecomposition(root, output) {
  const { workflow, target, bytes } = decompositionSource(root);
  return writeProofBundle(output, workflow, decompositionReviewFiles(target, bytes));
}
export function verifyReferenceDecomposition(root, output) {
  const { target, bytes } = decompositionSource(root);
  return verifyProofBundle(output, decompositionReviewFiles(target, bytes));
}
export function buildVisibleOwnershipReview(root, ownerMapPath, output) {
  const { workflow, target, bytes } = decompositionSource(root), map = readSelectedFile(ownerMapPath, 16777216);
  return writeProofBundle(output, workflow, visibleOwnershipFiles(target, bytes, map));
}
export function verifyVisibleOwnershipReview(root, ownerMapPath, output) {
  const { target, bytes } = decompositionSource(root), map = readSelectedFile(ownerMapPath, 16777216);
  return verifyProofBundle(output, visibleOwnershipFiles(target, bytes, map));
}
export function buildReferenceSegmentationSeeds(root, specification, output) {
  const { workflow, target, bytes } = decompositionSource(root);
  return writeProofBundle(output, workflow, segmentationSeedFiles(target, bytes, specification));
}
export function verifyReferenceSegmentationSeeds(root, specification, output) {
  const { target, bytes } = decompositionSource(root);
  return verifyProofBundle(output, segmentationSeedFiles(target, bytes, specification));
}
function segmentationReview(root, specification, cpuDirectory) {
  const { workflow, target, bytes } = decompositionSource(root), reader = portableReader(cpuDirectory);
  const report = parseJson(reader.read('cpu-result.json', 2097152));
  return { workflow, prepared: seededSegmentationReviewFiles(target, bytes, specification, report, path => reader.read(path, 16777216)) };
}
export function buildReferenceSegmentationReview(root, specification, cpuDirectory, output) {
  const { workflow, prepared } = segmentationReview(root, specification, cpuDirectory);
  return writeProofBundle(output, workflow, prepared);
}
export function verifyReferenceSegmentationReview(root, specification, cpuDirectory, output) {
  const { prepared } = segmentationReview(root, specification, cpuDirectory);
  return verifyProofBundle(output, prepared);
}
export function buildReferencePromptInput(root, specification, output) {
  const { workflow, target, bytes } = decompositionSource(root);
  return writeProofBundle(output, workflow, promptSegmentationFiles(target, bytes, specification));
}
export function verifyReferencePromptInput(root, specification, output) {
  const { target, bytes } = decompositionSource(root);
  return verifyProofBundle(output, promptSegmentationFiles(target, bytes, specification));
}
function promptReview(root, specification, cpuDirectory) {
  const { workflow, target, bytes } = decompositionSource(root), reader = portableReader(cpuDirectory);
  const report = parseJson(reader.read('prompt-result.json', 2097152));
  return { workflow, prepared: promptSegmentationReviewFiles(target, bytes, specification, report, path => reader.read(path, 16777216)) };
}
export function buildReferencePromptReview(root, specification, cpuDirectory, output) {
  const { workflow, prepared } = promptReview(root, specification, cpuDirectory);
  return writeProofBundle(output, workflow, prepared);
}
export function verifyReferencePromptReview(root, specification, cpuDirectory, output) {
  const { prepared } = promptReview(root, specification, cpuDirectory);
  return verifyProofBundle(output, prepared);
}
