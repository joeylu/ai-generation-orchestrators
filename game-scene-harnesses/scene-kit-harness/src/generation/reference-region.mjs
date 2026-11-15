import { regionGuideProposalFiles } from '../reference-region-guide.mjs';
import { compileReferenceAssetSingleInput, REFERENCE_LAYER_SINGLE_INPUT_MODE } from './reference-asset-edit.mjs';
import { check, digest, exact, hash, id, imageRef, isDigest, seal, unseal } from './common.mjs';

export const REFERENCE_LAYER_REGION_MODE = 'original-canvas-region-guided-edit-v1';
const FILES = ['reference-native.png', 'reconstruction-target.json', 'baseline-plan.json', 'guide-recipe.json',
  'region-guide.png', 'review-comparison.png', 'prompt-draft.txt', 'proposal.json', 'README.md'];
export function validateRegionGuidePacket(packet) {
  const p = unseal(packet);
  exact(p, ['format', 'proposalSha256', 'targetSha256', 'baselinePlanSha256', 'guideRecipeSha256', 'artifacts',
    'scope', 'visualAcceptance', 'generationRuntimeSupport', 'generationCalls', 'modelCalls']);
  check(p.format === 'ai_scene_region_guide_review_packet_v1' && p.scope === 'region-guide-design-only-no-compute-no-art-decision'
    && p.visualAcceptance === 'pending' && p.generationRuntimeSupport === 'not-implemented-for-region-guides'
    && p.generationCalls === 0 && p.modelCalls === 0, 'REGION_CONTROL_PACKET');
  check([p.proposalSha256, p.targetSha256, p.baselinePlanSha256, p.guideRecipeSha256].every(isDigest)
    && Array.isArray(p.artifacts) && p.artifacts.length === FILES.length, 'REGION_CONTROL_ARTIFACTS');
  const seen = new Set(); let total = 0;
  for (const a of p.artifacts) {
    exact(a, ['path', 'sha256', 'byteLength']);
    check(FILES.includes(a.path) && !seen.has(a.path) && isDigest(a.sha256)
      && Number.isSafeInteger(a.byteLength) && a.byteLength > 0 && a.byteLength <= 16777216, 'REGION_CONTROL_ARTIFACTS');
    total += a.byteLength; seen.add(a.path);
  }
  check(total <= 67108864, 'REGION_CONTROL_ARTIFACTS'); return p;
}
export function compileRegionGuideControls(state, options, readBlob) {
  exact(options, ['controlId', 'baselinePlanSha256', 'reviewPacket']); id(options.controlId);
  const packet = validateRegionGuidePacket(options.reviewPacket), baseline = state.plans.get(options.baselinePlanSha256);
  check(baseline?.plan.format === 'ai_scene_generation_plan_v23' && baseline.status === 'rejected-visual'
    && baseline.result?.technical.status === 'pass' && baseline.review?.receipt.decision === 'reject'
    && packet.baselinePlanSha256 === baseline.plan.sha256, 'REGION_CONTROL_REJECTED_BASELINE');
  const reference = state.plans.get(baseline.plan.recipe.referencePlans[0]), target = reference?.reconstructionTarget;
  check(reference?.status === 'accepted' && target?.sha256 === packet.targetSha256
    && baseline.plan.recipe.specSha256 === state.activeSpec && baseline.plan.recipe.styleSha256 === state.activeStyle, 'REGION_CONTROL_TARGET');
  const payload = new Map();
  for (const a of packet.artifacts) {
    const bytes = readBlob(a.sha256);
    check(bytes instanceof Uint8Array && bytes.length === a.byteLength && hash(bytes) === a.sha256, 'REGION_CONTROL_ARTIFACTS');
    payload.set(a.path, Buffer.from(bytes));
  }
  const recipe = JSON.parse(payload.get('guide-recipe.json').toString('utf8'));
  const raw = readBlob(reference.result.rawSha256), replay = regionGuideProposalFiles(target, raw, baseline.plan, recipe);
  check(replay.packet.sha256 === options.reviewPacket.sha256 && recipe.sha256 === packet.guideRecipeSha256, 'REGION_CONTROL_PACKAGE_REPLAY');
  for (const path of FILES) check(replay.files.get(path).equals(payload.get(path)), 'REGION_CONTROL_PACKAGE_REPLAY');
  return seal({ format: 'ai_scene_region_controls_v1', ...options, compiler: 'scene-kit-region-controls-v1',
    targetSha256: target.sha256, referencePlanSha256: reference.plan.sha256, instanceId: recipe.instanceId,
    specSha256: state.activeSpec, styleSha256: state.activeStyle, guideRecipeSha256: recipe.sha256,
    baselineRawSha256: baseline.result.rawSha256, baselineRejectionSha256: baseline.review.sha256,
    originalRawSha256: target.rawSha256, guide: { role: 'same-frame-region-selection-guide-not-edit-target', artifact: imageRef(payload.get('region-guide.png')) },
    promptArtifact: { sha256: hash(payload.get('prompt-draft.txt')), byteLength: payload.get('prompt-draft.txt').length },
    hardMask: false, generationCalls: 0 });
}
export function compileRegionGuidedAsset(state, recipe, readBlob) {
  exact(recipe, ['planId', 'parents', 'stage', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'referencePlans',
    'inventoryRefs', 'assetId', 'targetSha256', 'subjectBrief', 'intent', 'mode', 'clippedEdges', 'regionControlsSha256']);
  check(recipe.mode === REFERENCE_LAYER_REGION_MODE, 'REFERENCE_ASSET_MODE');
  const c = state.regionControls.get(recipe.regionControlsSha256), review = state.regionControlReviews.get(recipe.regionControlsSha256);
  check(c && review?.receipt.decision === 'accept' && review.packetSha256 === c.reviewPacket.sha256, 'REGION_CONTROL_REVIEW_REQUIRED');
  const baseline = state.plans.get(c.baselinePlanSha256);
  check(baseline?.status === 'rejected-visual' && c.targetSha256 === recipe.targetSha256 && c.instanceId === recipe.assetId
    && c.specSha256 === recipe.specSha256 && c.styleSha256 === recipe.styleSha256
    && ['subjectBrief', 'intent', 'clippedEdges'].every(k => digest(recipe[k]) === digest(baseline.plan.recipe[k])), 'REGION_PLAN_BASELINE');
  check(Array.isArray(recipe.parents) && recipe.parents.length === 1, 'PLAN_PARENT');
  const parent = state.plans.get(recipe.parents[0]);
  check(parent && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status)
    && (parent.plan.sha256 === c.baselinePlanSha256 || parent.plan.format === 'ai_scene_generation_plan_v24'
      && parent.plan.recipe.regionControlsSha256 === c.sha256), 'PLAN_PARENT');
  const { regionControlsSha256: _c, ...core } = recipe;
  const base = compileReferenceAssetSingleInput(state, { ...core, mode: REFERENCE_LAYER_SINGLE_INPUT_MODE, parents: [] }, readBlob);
  const cap = state.capabilities.get(recipe.capabilitiesSha256); check(cap.maxInputImages >= 2, 'REFERENCE_ASSET_CAPABILITY');
  const promptBytes = readBlob(c.promptArtifact.sha256);
  check(promptBytes.length === c.promptArtifact.byteLength && hash(promptBytes) === c.promptArtifact.sha256, 'REGION_CONTROL_PROMPT');
  const { sha256: _sha, ...body } = base;
  return seal({ ...body, format: 'ai_scene_generation_plan_v24', compiler: 'scene-kit-region-guided-asset-v1', recipe,
    designReviews: { ...base.designReviews, regionGuide: review.sha256 },
    regionControlEvidence: { controlsSha256: c.sha256, packetSha256: c.reviewPacket.sha256, reviewSha256: review.sha256,
      guideRecipeSha256: c.guideRecipeSha256, meaning: 'coarse-selection-not-alpha-or-hard-position-lock' },
    placement: { ...base.placement, profile: REFERENCE_LAYER_REGION_MODE },
    request: { ...base.request, format: 'ai_scene_image_request_v24', prompt: promptBytes.toString('utf8'),
      images: [base.request.images[0], c.guide] } });
}
export function regionGuidedAssetInputs(state, plan, readBlob) {
  const reference = state.plans.get(plan.recipe.referencePlans[0]), c = state.regionControls.get(plan.recipe.regionControlsSha256);
  return [readBlob(reference.result.rawSha256), readBlob(c.guide.artifact.sha256)];
}
