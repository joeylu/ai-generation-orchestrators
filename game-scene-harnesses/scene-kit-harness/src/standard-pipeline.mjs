import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFreshDirectory, parseJson, readSelectedFile, writeFreshFile } from './files.mjs';
import { check, digest, exact, hash, id, imageRef, jsonBytes, seal, text, unseal } from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import { referenceLayoutGuide as referenceBlueprintGuide, validateReferenceLayout as validateReferenceBlueprint } from './reference-layout.mjs';
import { composeReferenceBlueprint } from './composition-planner.mjs';
import { writeProofBundle, verifyProofBundle } from './terrain-proof/bundle.mjs';
import { STYLE_PRESETS } from './pipeline.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
// This project intentionally ends at a reviewed standard reference. It cannot
// route that reference through the legacy fixed-layout asset assembler.
export function initStandardReference(output, brief, { purpose = 'external-exchange', compositionIntent = null } = {}) {
  exact(brief, ['projectId', 'blueprint', 'inputs', 'style']); id(brief.projectId);
  check(brief.projectId.length <= 50, 'STANDARD_PROJECT_ID');
  validateReferenceBlueprint(brief.blueprint);
  const composition = compositionIntent ? composeReferenceBlueprint(compositionIntent) : null;
  check(!composition || composition.blueprint.sha256 === brief.blueprint.sha256, 'COMPOSITION_BLUEPRINT_BINDING');
  check(Array.isArray(brief.inputs) && brief.inputs.length <= 2, 'STANDARD_INPUTS');
  const inputs = brief.inputs.map(input => {
    exact(input, ['role', 'path']); check(input.role === 'style-reference', 'STANDARD_INPUT_ROLE');
    const bytes = readSelectedFile(input.path, 16777216); return { bytes, artifact: imageRef(bytes, { allowCabx: true }) };
  });
  check(new Set(inputs.map(input => input.artifact.sha256)).size === inputs.length, 'INPUT_ROLE_DUPLICATE');
  const style = brief.style; exact(style, ['mode', 'preset', 'name', 'rules', 'anchorPath']);
  const preset = STYLE_PRESETS[style.preset];
  check(['preset', 'custom'].includes(style.mode) && (style.mode === 'custom'
    ? style.preset === null && typeof style.anchorPath === 'string' : Boolean(preset) && style.anchorPath === null), 'STANDARD_STYLE');
  check(Array.isArray(style.rules), 'STANDARD_STYLE'); style.rules.forEach(rule => text(rule, { limit: 1000 }));
  if (style.mode === 'custom') text(style.name);
  const anchor = style.anchorPath === null ? null : readSelectedFile(style.anchorPath, 16777216);
  if (anchor) imageRef(anchor, { allowCabx: true });
  const guide = referenceBlueprintGuide(brief.blueprint), root = makeFreshDirectory(output, sourceRoot), workflow = join(root, 'workflow');
  flow.initWorkflow(workflow, { projectId: brief.projectId, purpose, compiler: 'scene-kit-native-reference-v2' });
  const spec = flow.createDesignDraft(workflow, { format: 'ai_scene_spec_v2', specId: `${brief.projectId}.spec`, projection: 'sideview',
    description: brief.blueprint.sceneDescription,
    inputs: inputs.map(input => ({ role: 'style-reference', artifact: flow.importStandardWorkflowImage(workflow, input.bytes) })),
    grid: { width: 64, height: 64 }, pixelsPerUnit: { numerator: 1, denominator: 1 }, viewport: brief.blueprint.viewport,
    mapSizeCells: { width: Math.ceil(brief.blueprint.viewport.width / 64), height: Math.ceil(brief.blueprint.viewport.height / 64) },
    referenceLayout: { blueprintSha256: brief.blueprint.sha256, guide: flow.importWorkflowImage(workflow, guide.bytes) } });
  const styleDraft = flow.createDesignDraft(workflow, { format: 'ai_scene_style_v2', styleId: `${brief.projectId}.style`, mode: style.mode,
    name: preset?.name ?? style.name, rules: [...(preset?.rules ?? []), ...style.rules], anchors: anchor ? [flow.importStandardWorkflowImage(workflow, anchor)] : [] });
  const capabilities = flow.createDesignDraft(workflow, { format: 'ai_scene_image_capabilities_v1', capabilityId: 'standard.image.host.v1', source: 'host-declared',
    textToImage: true, imageToImage: true, exactSize: false, transparentBackground: true, maxInputImages: 5,
    maxWidth: 4096, maxHeight: 4096, maximumCallsPerRequest: 1, outputFormat: 'png' });
  const project = seal({ format: composition ? 'ai_scene_standard_reference_project_v2' : 'ai_scene_standard_reference_project_v1', projectId: brief.projectId, purpose,
    specSha256: spec.sha256, styleSha256: styleDraft.sha256, capabilitiesSha256: capabilities.sha256, blueprintSha256: brief.blueprint.sha256,
    ...(composition ? { compositionIntentSha256: compositionIntent.sha256, compositionProposalSha256: composition.sha256 } : {}) });
  for (const [name, value] of Object.entries({ project, 'spec-draft': spec, 'style-draft': styleDraft, capabilities, blueprint: brief.blueprint }))
    writeFreshFile(join(root, `${name}.json`), jsonBytes(value), sourceRoot);
  writeFreshFile(join(root, 'layout-guide.png'), guide.bytes, sourceRoot);
  if (composition) {
    writeFreshFile(join(root, 'composition-intent.json'), jsonBytes(compositionIntent), sourceRoot);
    writeFreshFile(join(root, 'composition-proposal.json'), jsonBytes(composition), sourceRoot);
  }
  return inspectStandardReference(root);
}
export function initComposedReference(output, brief, options = {}) {
  exact(brief, ['projectId', 'intent', 'inputs', 'style']);
  const proposal = composeReferenceBlueprint(brief.intent);
  return initStandardReference(output, { projectId: brief.projectId, blueprint: proposal.blueprint, inputs: brief.inputs, style: brief.style },
    { ...options, compositionIntent: brief.intent });
}
function projectAt(root) {
  const read = name => parseJson(readSelectedFile(join(root, `${name}.json`)));
  const project = read('project'), body = unseal(project);
  const composed = body.format === 'ai_scene_standard_reference_project_v2';
  exact(body, ['format', 'projectId', 'purpose', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'blueprintSha256',
    ...(composed ? ['compositionIntentSha256', 'compositionProposalSha256'] : [])]);
  check(['ai_scene_standard_reference_project_v1', 'ai_scene_standard_reference_project_v2'].includes(body.format), 'STANDARD_PROJECT'); id(body.projectId);
  const spec = read('spec-draft'), style = read('style-draft'), capabilities = read('capabilities'), blueprint = read('blueprint');
  for (const [doc, sha] of [[spec, body.specSha256], [style, body.styleSha256], [capabilities, body.capabilitiesSha256], [blueprint, body.blueprintSha256]]) {
    unseal(doc); check(doc.sha256 === sha, 'STANDARD_PROJECT');
  }
  validateReferenceBlueprint(blueprint);
  if (composed) {
    const intent = read('composition-intent'), proposal = read('composition-proposal'); unseal(intent); unseal(proposal);
    check(intent.sha256 === body.compositionIntentSha256 && proposal.sha256 === body.compositionProposalSha256
      && digest(composeReferenceBlueprint(intent)) === digest(proposal) && proposal.blueprint.sha256 === blueprint.sha256, 'COMPOSITION_BLUEPRINT_BINDING');
  }
  const guide = referenceBlueprintGuide(blueprint);
  check(spec.format === 'ai_scene_spec_v2' && spec.referenceLayout.blueprintSha256 === blueprint.sha256
    && digest(spec.referenceLayout.guide) === digest(guide.artifact) && hash(readSelectedFile(join(root, 'layout-guide.png'))) === guide.artifact.sha256, 'STANDARD_PROJECT');
  const workflow = join(root, 'workflow'), state = flow.inspectWorkflow(workflow);
  check(state.projectId === project.projectId && state.purpose === project.purpose, 'STANDARD_PROJECT');
  const current = state.plans.filter(plan => plan.current);
  for (const item of current) {
    const plan = flow.getGenerationPlan(workflow, item.planSha256);
    check((blueprint.format === 'ai_scene_reference_blueprint_v2' ? ['ai_scene_generation_plan_v16', 'ai_scene_generation_plan_v17'].includes(plan.format) : plan.format === 'ai_scene_generation_plan_v15')
      && plan.recipe.blueprint.sha256 === blueprint.sha256, 'STANDARD_PROJECT');
  }
  return { project, spec, style, capabilities, blueprint, guide, workflow, state };
}
export function inspectStandardReference(root) {
  const { project, state, blueprint } = projectAt(root), reference = state.plans.findLast(plan => plan.current && plan.stage === 'reference');
  const flexible = blueprint.format === 'ai_scene_reference_blueprint_v2';
  let stage = 'awaiting-design-review';
  if (state.activeSpecSha256 === project.specSha256 && state.activeStyleSha256 === project.styleSha256) {
    stage = !reference ? 'reference-plan-needed' : ({ planned: 'awaiting-reference-compute', authorized: 'ready-to-generate-reference',
      'pending-visual-review': 'awaiting-reference-alignment-and-art-review', accepted: 'reference-accepted-reconstruction-pending' })[reference.status] ?? 'attention-required';
  }
  return { format: flexible ? 'ai_scene_standard_reference_status_v2' : 'ai_scene_standard_reference_status_v1', projectId: project.projectId, purpose: project.purpose, stage,
    design: { specSha256: project.specSha256, styleSha256: project.styleSha256, blueprintSha256: project.blueprintSha256 },
    reference: reference ?? null, eventCount: state.eventCount, uploads: 'style-only', automaticRetry: false,
    automaticSemanticDetection: false, faithfulAssetReconstruction: 'not-implemented', productionKit: false,
    ...(flexible ? { generationGeometry: 'hard-gameplay-and-soft-art-placement',
      reconstructionTargetSha256: reference?.reconstructionTargetSha256 ?? null } : {}) };
}
function proposalAt(root) {
  const { project, capabilities, blueprint, guide, workflow } = projectAt(root);
  const proposal = flow.previewStandardReference(workflow, { specSha256: project.specSha256, styleSha256: project.styleSha256,
    capabilitiesSha256: project.capabilitiesSha256, blueprint,
    pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: Math.max(256, blueprint.viewport.height),
      maximumWidth: capabilities.maxWidth, maximumHeight: capabilities.maxHeight }, intent: 'Create the standard scene reference; preserve the approved spatial blueprint.' });
  return { proposal, blueprint, guide, workflow };
}
function proposalFiles(root) {
  const { proposal, blueprint, guide, workflow } = proposalAt(root);
  const files = new Map([['proposal.json', jsonBytes(proposal)], ['blueprint.json', jsonBytes(blueprint)], ['layout-guide.png', guide.bytes],
    ['prompt.txt', Buffer.from(proposal.request.prompt)]]);
  const bundle = seal({ format: 'ai_scene_standard_reference_design_bundle_v1', proposalSha256: proposal.sha256, executable: false,
    generationCalls: 0, artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, bundle, report: proposal, workflow };
}
export function previewStandardReference(root, output) {
  const prepared = proposalFiles(root); return writeProofBundle(output, prepared.workflow, prepared);
}
export const verifyStandardPreview = (root, output) => verifyProofBundle(output, proposalFiles(root));
export function reviewStandardDesign(root, decisions) {
  const { project, workflow } = projectAt(root); exact(decisions, ['spec', 'style']);
  check(decisions.spec.targetSha256 === project.specSha256 && decisions.style.targetSha256 === project.styleSha256, 'STANDARD_REVIEW_TARGET');
  flow.reviewSceneDesigns(workflow, decisions); return inspectStandardReference(root);
}
export function planStandardReference(root, options = {}) {
  check(options && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).every(key => ['planId', 'parents'].includes(key)), 'STANDARD_PLAN_OPTIONS');
  const { planId, parents = [] } = options;
  const { proposal, workflow } = proposalAt(root), { project } = projectAt(root);
  const { specSha256: _spec, styleSha256: _style, ...fields } = proposal.sources;
  flow.freezeStandardReferencePlan(workflow, { ...fields, planId: planId ?? `${project.projectId}.reference`, parents });
  return inspectStandardReference(root);
}
export function authorizeStandardReference(root, decision) {
  const status = inspectStandardReference(root), { workflow } = projectAt(root);
  check(status.stage === 'awaiting-reference-compute' && decision.targetSha256 === status.reference.planSha256, 'STANDARD_COMPUTE_TARGET');
  flow.authorizePlan(workflow, status.reference.planSha256, decision); return inspectStandardReference(root);
}
export async function runStandardReference(root, adapter) {
  check(adapter && typeof adapter.preflight === 'function' && typeof adapter.generate === 'function', 'PIPELINE_ADAPTER_REQUIRED');
  const status = inspectStandardReference(root); check(status.stage === 'ready-to-generate-reference', 'PIPELINE_NOT_AUTHORIZED');
  await adapter.preflight(); const { workflow } = projectAt(root), sha = status.reference.planSha256;
  const { request, ...ticket } = flow.reservePlan(workflow, sha); flow.recordSubmission(workflow, ticket);
  let bytes;
  try {
    bytes = await adapter.generate({ ...ticket, request,
      images: request.images.map((image, index) => ({ ...image, bytes: flow.readGenerationInput(workflow, sha, index) })) });
    check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'PIPELINE_ADAPTER_OUTPUT');
  } catch { flow.stopAttempt(workflow, ticket, 'indeterminate'); return inspectStandardReference(root); }
  flow.receiveResult(workflow, ticket, bytes); return inspectStandardReference(root);
}
function currentResult(root) {
  const { workflow } = projectAt(root), status = inspectStandardReference(root);
  check(status.reference?.received, 'RESULT_REQUIRED'); return { workflow, sha: status.reference.planSha256 };
}
export function assessStandardReference(root, observation, output) {
  const { workflow, sha } = currentResult(root); return flow.buildStandardReferenceReview(workflow, sha, observation, output);
}
export function verifyStandardAssessment(root, observation, output) {
  const { workflow, sha } = currentResult(root); return flow.verifyStandardReferenceReview(workflow, sha, observation, output);
}
export function reviewStandardImage(root, observation, decision) {
  const { workflow, sha } = currentResult(root); flow.reviewStandardReference(workflow, sha, observation, decision);
  return inspectStandardReference(root);
}
export function exportReconstructionTarget(root, output) {
  const { workflow, sha } = currentResult(root), target = flow.getReferenceReconstructionTarget(workflow, sha);
  const bytes = jsonBytes(target), files = new Map([['reconstruction-target.json', bytes]]);
  const bundle = seal({ format: 'ai_scene_reconstruction_target_bundle_v1', targetSha256: target.sha256,
    artifacts: [{ path: 'reconstruction-target.json', sha256: hash(bytes), byteLength: bytes.length }], generationCalls: 0, assetPackage: false });
  files.set('proof-bundle.json', jsonBytes(bundle)); return writeProofBundle(output, workflow, { files, bundle, report: target });
}
