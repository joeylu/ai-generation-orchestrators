import { inspectPng } from '../png.mjs';
import { compilePaintGeometryDesign, proposedPaintMapping } from '../reference-paint-design.mjs';
import { check, digest, exact, hash, id, imageRef, isDigest, seal, unseal, text } from './common.mjs';

export const PAINT_DESIGN_FILES = ['geometry-design-target.json', 'geometry-acceptance.json', 'geometry-alpha.png',
  'paint-guide.png', 'reference-native.png', 'paint-brief.json', 'proposal.json', 'source-prompt-draft.txt'];
export function validatePaintDesignPacket(value) {
  const p = unseal(value);
  exact(p, ['format', 'sourceReviewPacketSha256', 'proposalSha256', 'artifacts', 'computeAuthorized', 'realApplicationAuthorized']);
  check(p.format === 'ai_scene_paint_design_control_packet_v1' && isDigest(p.sourceReviewPacketSha256)
    && isDigest(p.proposalSha256) && p.computeAuthorized === false && p.realApplicationAuthorized === false
    && Array.isArray(p.artifacts) && p.artifacts.length === PAINT_DESIGN_FILES.length, 'PAINT_CONTROL_PACKET');
  const seen = new Set(); let total = 0;
  for (const a of p.artifacts) {
    exact(a, ['path', 'sha256', 'byteLength']);
    check(PAINT_DESIGN_FILES.includes(a.path) && !seen.has(a.path) && isDigest(a.sha256)
      && Number.isSafeInteger(a.byteLength) && a.byteLength > 0 && a.byteLength <= 16777216, 'PAINT_CONTROL_ARTIFACTS');
    total += a.byteLength; seen.add(a.path);
  }
  check(total <= 67108864, 'PAINT_CONTROL_ARTIFACTS'); return p;
}
export function compilePaintControls(state, options, readBlob) {
  exact(options, ['controlId', 'referencePlanSha256', 'reviewPacket']); id(options.controlId);
  const packet = validatePaintDesignPacket(options.reviewPacket), ref = state.plans.get(options.referencePlanSha256), target = ref?.reconstructionTarget;
  check(ref?.status === 'accepted' && target?.format === 'ai_scene_reference_reconstruction_target_v2'
    && ref.plan.recipe.specSha256 === state.activeSpec && ref.plan.recipe.styleSha256 === state.activeStyle, 'PAINT_CONTROL_TARGET');
  const files = new Map();
  for (const a of packet.artifacts) {
    const bytes = readBlob(a.sha256); check(bytes instanceof Uint8Array && bytes.length === a.byteLength && hash(bytes) === a.sha256, 'PAINT_CONTROL_ARTIFACTS');
    files.set(a.path, Buffer.from(bytes));
  }
  const json = name => JSON.parse(files.get(name).toString('utf8'));
  const geometry = json('geometry-design-target.json'), acceptance = json('geometry-acceptance.json'), brief = json('paint-brief.json');
  const design = compilePaintGeometryDesign(geometry, files.get('geometry-alpha.png'), acceptance,
    { geometryGuide: files.get('paint-guide.png'), appearanceReference: files.get('reference-native.png') }, brief);
  check(design.sha256 === packet.proposalSha256 && digest(json('proposal.json')) === digest(design)
    && files.get('source-prompt-draft.txt').toString('utf8') === design.sourcePaintDraft.prompt + '\n', 'PAINT_CONTROL_REPLAY');
  check(geometry.targetSha256 === target.sha256 && geometry.referenceSha256 === target.rawSha256
    && target.rawSha256 === ref.result.rawSha256 && target.instances.some(i => i.instanceId === geometry.instanceId)
    && digest(geometry.nativeFrame) === digest(ref.result.technical.image.pixelSize), 'PAINT_CONTROL_TARGET');
  return seal({ format: 'ai_scene_paint_controls_v1', ...options, compiler: 'scene-kit-paint-controls-v1',
    specSha256: state.activeSpec, styleSha256: state.activeStyle, targetSha256: target.sha256,
    instanceId: geometry.instanceId, geometry, geometryAcceptance: acceptance, brief, design,
    geometryAlpha: imageRef(files.get('geometry-alpha.png')), guide: imageRef(files.get('paint-guide.png')),
    originalReference: imageRef(files.get('reference-native.png'), { allowCabx: true }), generationCalls: 0 });
}
export function compilePaintSourcePlan(state, recipe, readBlob) {
  exact(recipe, ['planId', 'parents', 'stage', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'referencePlans',
    'inventoryRefs', 'assetId', 'targetSha256', 'paintControlsSha256', 'intent']);
  id(recipe.planId); text(recipe.intent, { empty: true });
  check(recipe.stage === 'reference-paint-source' && recipe.intent === '' && recipe.specSha256 === state.activeSpec
    && recipe.styleSha256 === state.activeStyle && Array.isArray(recipe.referencePlans) && recipe.referencePlans.length === 1
    && Array.isArray(recipe.inventoryRefs) && recipe.inventoryRefs.length === 0, 'PAINT_PLAN_RECIPE');
  const c = state.paintControls.get(recipe.paintControlsSha256), review = state.paintControlReviews.get(recipe.paintControlsSha256);
  check(c && review?.receipt.decision === 'accept' && review.proposalSha256 === c.design.sha256, 'PAINT_DESIGN_REVIEW_REQUIRED');
  const ref = state.plans.get(c.referencePlanSha256);
  check(c.referencePlanSha256 === recipe.referencePlans[0] && c.targetSha256 === recipe.targetSha256 && c.instanceId === recipe.assetId
    && c.specSha256 === recipe.specSha256 && c.styleSha256 === recipe.styleSha256 && ref?.status === 'accepted'
    && ref.reconstructionTarget?.sha256 === c.targetSha256, 'PAINT_PLAN_TARGET');
  check(Array.isArray(recipe.parents) && recipe.parents.length <= 1, 'PLAN_PARENT');
  if (recipe.parents.length) {
    const p = state.plans.get(recipe.parents[0]);
    check(p?.plan.format === 'ai_scene_generation_plan_v25' && p.plan.recipe.paintControlsSha256 === c.sha256
      && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(p.status), 'PLAN_PARENT');
  }
  const cap = state.capabilities.get(recipe.capabilitiesSha256), size = c.geometry.localCanvas;
  check(cap?.imageToImage === true && cap.maxInputImages >= 2 && cap.maxWidth >= size.width && cap.maxHeight >= size.height, 'PAINT_CAPABILITY');
  for (const artifact of [c.guide, c.originalReference, c.geometryAlpha]) check(hash(readBlob(artifact.sha256)) === artifact.sha256, 'PAINT_CONTROL_ARTIFACTS');
  const policy = { mode: 'native-environment', orientation: size.width >= size.height ? 'landscape' : 'portrait',
    minimumWidth: size.width, minimumHeight: size.height, maximumWidth: Math.min(4096, cap.maxWidth), maximumHeight: Math.min(4096, cap.maxHeight) };
  return seal({ format: 'ai_scene_generation_plan_v25', compiler: 'scene-kit-opaque-local-paint-v1', recipe,
    designReviews: { ...ref.plan.designReviews, paintSourceAndDerivation: review.sha256 },
    referenceEvidence: [{ planSha256: ref.plan.sha256, rawSha256: ref.result.rawSha256, targetSha256: c.targetSha256,
      acceptedPacketSha256: ref.reconstructionTarget.acceptedPacketSha256, humanReceiptSha256: ref.reconstructionTarget.humanReceiptSha256 }],
    paintControlEvidence: { controlsSha256: c.sha256, designSha256: c.design.sha256, reviewSha256: review.sha256,
      geometryAlphaSha256: c.geometryAlpha.sha256, geometryAcceptanceSha256: c.geometryAcceptance.sha256 },
    placement: c.design.placement,
    target: { assetId: c.instanceId, kind: 'opaque-paint-source', alpha: 'opaque', sourcePolicy: policy,
      localCanvas: size, aspectTolerance: { numerator: 1, denominator: 100 }, purpose: 'paint-only-not-transparent-layer' },
    sourceReviewMeaning: 'paint-appearance-only-not-derived-layer-acceptance',
    derivationPolicy: { ...c.design.derivationDraft, executable: false, sourcePaintSha256: null },
    request: { format: 'ai_scene_image_request_v25', task: 'reference-paint-source', prompt: c.design.sourcePaintDraft.prompt,
      images: [{ role: 'accepted-geometry-with-eight-pixel-paint-halo-soft-guide', artifact: c.guide },
        { role: 'unchanged-full-reference-for-local-appearance-only', artifact: c.originalReference }],
      output: { format: 'png', alpha: 'opaque', sourcePolicy: policy }, maximumCalls: 1 } });
}
export function assessPaintSource(plan, bytes) {
  const issues = []; let image = null, mapping = null, diagnosticHiddenRgbPixels = null;
  if (hash(bytes) === plan.referenceEvidence[0].rawSha256) issues.push('PAINT_REFERENCE_REUSE');
  try {
    const p = inspectPng(Buffer.from(bytes), { includePixels: true, pixelStats: true, allowCabx: true, allowHiddenRgb: true });
    image = { sha256: hash(bytes), byteLength: bytes.length, pixelSize: { width: p.width, height: p.height } };
    diagnosticHiddenRgbPixels = p.hiddenRgbPixels;
    if (!p.nonzeroAlphaPixels) issues.push('OUTPUT_EMPTY');
    if (p.transparentPixels) issues.push('OUTPUT_NOT_OPAQUE');
    if (!p.varied) issues.push('PAINT_BLANK');
    const policy = plan.target.sourcePolicy;
    if (p.width > policy.maximumWidth || p.height > policy.maximumHeight) issues.push('OUTPUT_SIZE');
    try { mapping = proposedPaintMapping(image.pixelSize, plan.target.localCanvas); }
    catch (e) { issues.push(e.errors?.[0]?.code ?? 'PAINT_CANVAS_UNSUPPORTED'); }
  } catch { issues.push('OUTPUT_PNG_UNSUPPORTED'); }
  return seal({ format: 'ai_scene_paint_source_qa_v1', planSha256: plan.sha256, rawSha256: hash(bytes), image, mapping,
    issues, status: issues.length ? 'fail' : 'pass', visualAcceptance: 'not-assessed', diagnosticHiddenRgbPixels,
    opacityDoesNotCertifyMaterialCorrectness: true, sourcePngModified: false, derivedLayerProduced: false });
}
export function compilePaintApplicationProposal(state, planSha256) {
  const entry = state.plans.get(planSha256), c = state.paintControls.get(entry?.plan.recipe.paintControlsSha256);
  check(entry?.plan.format === 'ai_scene_generation_plan_v25' && c && entry.status === 'accepted'
    && entry.result?.technical.status === 'pass' && entry.review?.receipt.decision === 'accept', 'PAINT_SOURCE_ART_REVIEW_REQUIRED');
  return paintApplicationGeometryProposal(state, entry, c, planSha256);
}
// Shared deterministic geometry only. Each versioned caller must enforce its own source/coverage gates.
export function paintApplicationGeometryProposal(state, entry, c, planSha256) {
  check(c && entry?.status === 'accepted' && entry.result?.technical.status === 'pass'
    && entry.review?.receipt.decision === 'accept', 'PAINT_SOURCE_ART_REVIEW_REQUIRED');
  check(state.paintControlReviews.get(c.sha256)?.receipt.decision === 'accept' && c.specSha256 === state.activeSpec
    && c.styleSha256 === state.activeStyle && state.plans.get(c.referencePlanSha256)?.reconstructionTarget?.sha256 === c.targetSha256, 'PAINT_PLAN_TARGET');
  return seal({ format: 'ai_scene_paint_application_proposal_v1', planSha256, sourcePaintSha256: entry.result.rawSha256,
    technicalSha256: entry.result.technical.sha256, sourceArtReviewSha256: entry.review.sha256,
    controlsSha256: c.sha256, designSha256: c.design.sha256, geometryAlphaSha256: c.geometryAlpha.sha256,
    mapping: entry.result.technical.mapping, placement: entry.plan.placement,
    algorithm: 'opaque-area-normalize-then-continuous-alpha-multiply-v1', maskResampling: 'none',
    zeroRgbAtZeroAlpha: true, referenceFallbackPixels: 0, existingFailedSourceReclassified: false,
    permission: 'awaiting-source-specific-application-review', artAcceptance: 'not-assessed' });
}
