import { check, digest, exact, hash, id, imageRef, isDigest, seal, unseal } from './common.mjs';
import { controlGuideRecipe, renderControlGuides, compileProjectionFocusPrompt } from '../reference-controls.mjs';

export const REFERENCE_CONTROL_FILES = Object.freeze(['projection-guide.png', 'focus-guide.png', 'review-overview.png',
  'guide-recipe.json', 'proposal.json', 'checklist.json', 'prompt-draft.txt', 'README.md']);
const roles = ['internal-projection-example', 'internal-focus-example'];
export function validateControlReviewPacket(packet) {
  const p = unseal(packet);
  exact(p, ['format', 'proposalSha256', 'specSha256', 'styleSha256', 'requirementsSha256', 'artifacts', 'technicalGuideChecks',
    'humanDesignAcceptance', 'scope', 'generationRuntimeSupport', 'generationCalls', 'frozenGenerationPlansAdded']);
  check(p.format === 'ai_scene_projection_focus_control_review_packet_v1' && p.scope === 'control-design-only-no-compute'
    && p.humanDesignAcceptance === 'pending' && p.generationRuntimeSupport === 'not-implemented'
    && p.generationCalls === 0 && p.frozenGenerationPlansAdded === 0, 'CONTROL_REVIEW_PACKET');
  check([p.proposalSha256, p.specSha256, p.styleSha256, p.requirementsSha256].every(isDigest)
    && Array.isArray(p.artifacts) && p.artifacts.length === REFERENCE_CONTROL_FILES.length, 'CONTROL_REVIEW_ARTIFACTS');
  const seen = new Set(); let total = 0;
  for (const a of p.artifacts) {
    exact(a, ['path', 'sha256', 'byteLength']);
    check(REFERENCE_CONTROL_FILES.includes(a.path) && !seen.has(a.path) && isDigest(a.sha256)
      && Number.isSafeInteger(a.byteLength) && a.byteLength > 0 && a.byteLength <= 4194304, 'CONTROL_REVIEW_ARTIFACTS');
    seen.add(a.path); total += a.byteLength;
  }
  check(total <= 16777216, 'CONTROL_REVIEW_ARTIFACTS'); return p;
}
function sourceFor(state, sha) {
  const e = state.plans.get(sha);
  check(['ai_scene_generation_plan_v18', 'ai_scene_generation_plan_v19'].includes(e?.plan.format)
    && e.status === 'rejected-visual' && e.result?.technical.status === 'pass'
    && e.review?.receipt.decision === 'reject', 'CONTROL_REJECTED_SOURCE_REQUIRED');
  check(e.plan.recipe.specSha256 === state.activeSpec && e.plan.recipe.styleSha256 === state.activeStyle, 'CONTROL_SOURCE_STALE');
  const spec = state.designs.get(state.activeSpec), style = state.designs.get(state.activeStyle);
  check(spec?.format === 'ai_scene_spec_v3' && style?.format === 'ai_scene_style_v2' && style.mode === 'preset'
    && style.anchors.length === 0 && style.name === '清爽手绘', 'CONTROL_STYLE_PROFILE');
  return { e, spec, style };
}
export function compileReferenceControls(state, options, readBlob) {
  exact(options, ['controlId', 'sourcePlanSha256', 'reviewPacket']); id(options.controlId);
  const p = validateControlReviewPacket(options.reviewPacket), { e, spec, style } = sourceFor(state, options.sourcePlanSha256);
  check(p.specSha256 === spec.sha256 && p.styleSha256 === style.sha256 && p.requirementsSha256 === spec.requirements.sha256, 'CONTROL_REVIEW_DESIGN');
  const payload = new Map();
  for (const a of p.artifacts) {
    const b = readBlob(a.sha256); check(b instanceof Uint8Array && b.length === a.byteLength && hash(b) === a.sha256, 'CONTROL_ARTIFACT_CHANGED');
    payload.set(a.path, Buffer.from(b));
  }
  const parsed = name => { const v = JSON.parse(payload.get(name).toString('utf8')); unseal(v); return v; };
  const recipe = parsed('guide-recipe.json'), proposal = parsed('proposal.json'), checklist = parsed('checklist.json');
  check(digest(recipe) === digest(controlGuideRecipe), 'CONTROL_GUIDE_RECIPE');
  const images = renderControlGuides(recipe);
  for (const [name, b] of images) check(b.equals(payload.get(name)), 'CONTROL_GUIDE_REPLAY');
  const prompt = compileProjectionFocusPrompt(spec, style);
  check(payload.get('prompt-draft.txt').equals(Buffer.from(prompt)), 'CONTROL_PROMPT_MISMATCH');
  check(proposal.format === 'ai_scene_projection_focus_control_proposal_v1' && proposal.sha256 === p.proposalSha256
    && proposal.specSha256 === spec.sha256 && proposal.styleSha256 === style.sha256 && proposal.requirementsSha256 === spec.requirements.sha256
    && proposal.rejectedPlanSha256 === e.plan.sha256 && proposal.rejectedRawSha256 === e.result.rawSha256
    && proposal.rejectionSha256 === e.review.sha256 && proposal.guideRecipeSha256 === recipe.sha256
    && proposal.promptDraftSha256 === hash(Buffer.from(prompt)) && proposal.pixelLocking === false
    && checklist.format === 'ai_scene_projection_focus_review_checklist_v1' && checklist.requirementsSha256 === spec.requirements.sha256, 'CONTROL_PROPOSAL_BINDING');
  const guideChecks = ['projection-guide.png', 'focus-guide.png'].map(path => ({ path, sha256: hash(images.get(path)),
    byteLength: images.get(path).length, width: 512, height: 512, opaque: true, discretePaletteColors: 4,
    replayIdentical: true, humanSemanticReview: 'pending' }));
  check(digest(p.technicalGuideChecks) === digest(guideChecks)
    && digest(proposal.proposedModelInputs) === digest(guideChecks.map((g, i) => ({ ...g, role: roles[i] }))), 'CONTROL_GUIDE_BINDING');
  return seal({ format: 'ai_scene_reference_controls_v1', ...options, compiler: 'scene-kit-projection-focus-controls-v1',
    specSha256: spec.sha256, styleSha256: style.sha256, requirementsSha256: spec.requirements.sha256,
    sourceRawSha256: e.result.rawSha256, sourceRejectionSha256: e.review.sha256,
    promptPolicy: 'projection-focus-clean-handpaint-v1', promptSha256: hash(Buffer.from(prompt)),
    guides: guideChecks.map((g, i) => ({ role: roles[i], artifact: imageRef(images.get(g.path)) })),
    guideMeaning: 'viewing-grammar-and-focus-not-layout-not-art-style', pixelLocking: false, generationCalls: 0 });
}
export function controlledReferenceRecipe(state, options) {
  exact(options, ['planId', 'controlsSha256']); id(options.planId);
  const c = state.controls.get(options.controlsSha256); check(c, 'REFERENCE_CONTROLS_REQUIRED');
  const { e } = sourceFor(state, c.sourcePlanSha256);
  return { ...options, parents: [], stage: 'reference', mode: 'reference-led', specSha256: c.specSha256, styleSha256: c.styleSha256,
    capabilitiesSha256: e.plan.recipe.capabilitiesSha256, referencePlans: [], inventoryRefs: [], assetId: 'scene-reference',
    pixelPolicy: e.plan.recipe.pixelPolicy, intent: '' };
}
export function compileControlledReference(state, recipe) {
  exact(recipe, ['planId', 'controlsSha256', 'parents', 'stage', 'mode', 'specSha256', 'styleSha256', 'capabilitiesSha256',
    'referencePlans', 'inventoryRefs', 'assetId', 'pixelPolicy', 'intent']); id(recipe.planId);
  const c = state.controls.get(recipe.controlsSha256), review = state.controlReviews.get(recipe.controlsSha256);
  check(c && review?.receipt.decision === 'accept' && review.receipt.targetSha256 === c.reviewPacket.sha256, 'CONTROL_REVIEW_REQUIRED');
  const { e, spec, style } = sourceFor(state, c.sourcePlanSha256), source = e.plan;
  check(recipe.stage === 'reference' && recipe.mode === 'reference-led' && recipe.assetId === 'scene-reference'
    && recipe.specSha256 === c.specSha256 && recipe.styleSha256 === c.styleSha256
    && recipe.capabilitiesSha256 === source.recipe.capabilitiesSha256 && digest(recipe.pixelPolicy) === digest(source.recipe.pixelPolicy)
    && Array.isArray(recipe.referencePlans) && !recipe.referencePlans.length && Array.isArray(recipe.inventoryRefs)
    && !recipe.inventoryRefs.length && Array.isArray(recipe.parents) && recipe.parents.length <= 1, 'CONTROL_PLAN_SHAPE');
  check(recipe.intent === '', 'CONTROL_PROMPT_FIXED');
  if (recipe.parents.length) {
    const parent = state.plans.get(recipe.parents[0]);
    check(parent?.plan.format === 'ai_scene_generation_plan_v20' && parent.plan.recipe.controlsSha256 === c.sha256
      && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status), 'PLAN_PARENT');
  }
  const cap = state.capabilities.get(recipe.capabilitiesSha256);
  check(cap?.imageToImage === true && cap.maxInputImages >= 2, 'CAPABILITY_INPUT_UNSUPPORTED');
  const prompt = compileProjectionFocusPrompt(spec, style); check(hash(Buffer.from(prompt)) === c.promptSha256, 'CONTROL_PROMPT_MISMATCH');
  return seal({ format: 'ai_scene_generation_plan_v20', compiler: 'scene-kit-projection-focus-reference-v1', recipe,
    designReviews: source.designReviews, referenceEvidence: [], target: source.target, referenceRequirements: spec.requirements,
    controlEvidence: { controlsSha256: c.sha256, controlReviewSha256: review.sha256, acceptedPacketSha256: c.reviewPacket.sha256,
      sourcePlanSha256: source.sha256, sourceRawSha256: c.sourceRawSha256, sourceRejectionSha256: c.sourceRejectionSha256,
      promptPolicy: c.promptPolicy, pixelLocking: false, actualEffect: 'not-tested' },
    inputPolicy: { uploads: 'style-only', styleSource: 'accepted-preset-text-only', omittedStyleImages: spec.inputs.map(i => i.artifact),
      controlMeaning: c.guideMeaning, layoutAuthority: 'actual-image-after-review', pregenerationPixelGeometry: 'not-prescribed',
      automaticSemanticDetection: false },
    request: { format: 'ai_scene_image_request_v20', task: 'reference', prompt, images: c.guides,
      output: { format: 'png', alpha: 'opaque', pixelPolicy: recipe.pixelPolicy }, maximumCalls: 1 } });
}
