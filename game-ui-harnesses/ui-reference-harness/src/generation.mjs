import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { canonical, digestJson, exact, isDigest, jsonBytes, local, readBytes, readJson, requireThat, seal, sha256, storeBlob, textValue, unseal, validationMemo, validationScope, withLock, writeJsonNew, writeNew } from './common.mjs';
import { assertCurrent, runtimeDigest, verifyPlan } from './compiler.mjs';
import { loadProject, saveProject } from './project.mjs';
import { decodePng, encodePng } from './png.mjs';
import { coordinateMapping, resolutionPolicy, verifyMapping } from './resolution.mjs';

const exists = (root, run, name) => fs.existsSync(local(root, `${run}/${name}`));
const checked = (root, run, name) => { const record = readJson(local(root, `${run}/${name}`)); unseal(record); return record; };
function sameOrNew(root, relative, value) {
  if (fs.existsSync(local(root, relative))) requireThat(readBytes(local(root, relative)).equals(Buffer.from(value)), 'ARTIFACT_CHANGED');
  else writeNew(root, relative, value);
}
export function authorize(root, run, planSha256, approval) {
  textValue(approval, 2000);
  return withLock(root, () => {
    const plan = verifyPlan(root, run); assertCurrent(root, plan);
    requireThat(!plan.rawSource, 'RAW_REUSE_NO_COMPUTE_AUTHORIZATION');
    requireThat(plan.sha256 === planSha256 && !exists(root, run, 'attempt.json'), 'AUTHORIZATION_PLAN_OR_STATE');
    const authorization = seal({ kind: 'ui_reference_authorization_v1', planSha256, nonce: randomUUID(), maximumCalls: 1, approval });
    writeJsonNew(root, `${run}/authorization.json`, authorization);
    return { planSha256, status: 'authorized', maximumCalls: 1 };
  });
}
function verifyAttempt(root, run, plan) {
  const attempt = checked(root, run, 'attempt.json');
  if (plan.rawSource) {
    exact(attempt, ['kind', 'planSha256', 'requestSha256', 'rawSha256', 'maximumCalls', 'state', 'sha256']);
    requireThat(attempt.kind === 'ui_reference_reprocess_attempt_v1' && attempt.maximumCalls === 0
      && attempt.state === 'reserved' && attempt.planSha256 === plan.sha256
      && attempt.requestSha256 === digestJson(plan.request) && attempt.rawSha256 === plan.rawSource.rawSha256
      && !exists(root, run, 'authorization.json')
      && canonical(readJson(local(root, `${run}/request.json`))) === canonical(plan.request), 'ATTEMPT_INTEGRITY');
    return attempt;
  }
  const authorization = checked(root, run, 'authorization.json');
  exact(attempt, ['kind', 'planSha256', 'authorizationSha256', 'requestSha256', 'state', 'sha256']);
  exact(authorization, ['kind', 'planSha256', 'nonce', 'maximumCalls', 'approval', 'sha256']);
  requireThat(attempt.kind === 'ui_reference_attempt_v1' && authorization.kind === 'ui_reference_authorization_v1'
    && attempt.state === 'reserved'
    && attempt.planSha256 === plan.sha256 && authorization.planSha256 === plan.sha256
    && attempt.authorizationSha256 === authorization.sha256 && authorization.maximumCalls === 1
    && attempt.requestSha256 === digestJson(plan.request)
    && canonical(readJson(local(root, `${run}/request.json`))) === canonical(plan.request), 'ATTEMPT_INTEGRITY');
  return attempt;
}
export function reserve(root, run) {
  return withLock(root, () => {
    const plan = verifyPlan(root, run); assertCurrent(root, plan);
    requireThat(!plan.rawSource, 'RAW_REUSE_NO_PROVIDER_DISPATCH');
    const authorization = checked(root, run, 'authorization.json');
    requireThat(authorization.planSha256 === plan.sha256 && authorization.maximumCalls === 1, 'AUTHORIZATION_MISMATCH');
    requireThat(!exists(root, run, 'attempt.json'), 'ATTEMPT_ALREADY_RESERVED_NO_RESUBMIT');
    // Commit the single-use reservation before exposing a provider request.
    const attempt = seal({ kind: 'ui_reference_attempt_v1', planSha256: plan.sha256,
      authorizationSha256: authorization.sha256, requestSha256: digestJson(plan.request), state: 'reserved' });
    writeJsonNew(root, `${run}/attempt.json`, attempt);
    writeJsonNew(root, `${run}/request.json`, plan.request);
    return { run, requestSha256: attempt.requestSha256, request: plan.request };
  });
}
function terminal(root, run, plan, outcome) {
  const value = seal({ kind: 'ui_reference_terminal_v1', planSha256: plan.sha256, outcome, resubmitAllowed: false });
  sameOrNew(root, `${run}/terminal.json`, jsonBytes(value)); return value;
}
function validateGenerated(bytes, plan) {
  const image = decodePng(bytes);
  coordinateMapping({ width: plan.request.width, height: plan.request.height }, { width: image.width, height: image.height },
    plan.request.resolution ?? resolutionPolicy('exact'));
  let first = null, varied = false;
  for (let i = 0; i < image.rgba.length; i += 4) {
    requireThat(image.rgba[i + 3] === 255, 'GENERATED_NOT_OPAQUE');
    const pixel = image.rgba.readUInt32BE(i); if (first === null) first = pixel; else if (pixel !== first) varied = true;
  }
  requireThat(varied, 'GENERATED_BLANK'); return image;
}
export function stopAttempt(root, run, requestSha256, outcome = 'indeterminate') {
  requireThat(['failed', 'indeterminate'].includes(outcome), 'OUTCOME_INVALID');
  return withLock(root, () => {
    const plan = verifyPlan(root, run), attempt = verifyAttempt(root, run, plan);
    requireThat(!plan.rawSource, 'RAW_REUSE_HAS_NO_PROVIDER_OUTCOME');
    requireThat(attempt.requestSha256 === requestSha256 && !exists(root, run, 'raw.png')
      && !exists(root, run, 'terminal.json'), 'ATTEMPT_NOT_PENDING');
    return terminal(root, run, plan, outcome);
  });
}
function finishUnlocked(root, run, rawSha256) {
  const plan = verifyPlan(root, run), attempt = verifyAttempt(root, run, plan);
  requireThat(!exists(root, run, 'terminal.json'), 'ATTEMPT_TERMINAL_NO_RESUBMIT');
  const bytes = readBytes(local(root, `${run}/raw.png`));
  requireThat(isDigest(rawSha256) && sha256(bytes) === rawSha256, 'RAW_DIGEST_MISMATCH');
  requireThat(!plan.rawSource || plan.rawSource.rawSha256 === rawSha256, 'RAW_SOURCE_DIGEST_MISMATCH');
  const receipt = seal({ kind: 'ui_reference_receipt_v1', planSha256: plan.sha256, requestSha256: attempt.requestSha256, rawSha256 });
  sameOrNew(root, `${run}/receipt.json`, jsonBytes(receipt));
  let image;
  try {
    image = validateGenerated(bytes, plan);
  } catch (error) {
    terminal(root, run, plan, 'rejected_technical'); throw error;
  }
  const normalized = encodePng(image), imageSha256 = sha256(normalized);
  sameOrNew(root, `${run}/reference.png`, normalized);
  const check = decodePng(normalized);
  requireThat(check.rgba.equals(image.rgba) && check.width === image.width && check.height === image.height, 'POST_PROCESS_CHANGED_PIXELS');
  const mapping = coordinateMapping({ width: plan.request.width, height: plan.request.height },
    { width: image.width, height: image.height }, plan.request.resolution);
  const technical = seal({ kind: 'ui_reference_technical_qa_v2', planSha256: plan.sha256, rawSha256, imageSha256,
    dimensions: { width: image.width, height: image.height }, rawValidation: 'PASS', postValidation: 'PASS',
    coordinateMapping: mapping,
    postProcess: 'png-metadata-strip-lossless-rgba-v1', humanVisualReview: 'NOT_RUN' });
  sameOrNew(root, `${run}/technical.json`, jsonBytes(technical));
  const status = exists(root, run, 'review.json') ? (verifyReview(root, run).decision === 'accept' ? 'accepted' : 'rejected_visual') : 'pending_visual_review';
  return { status, rawSha256, imageSha256, image: `${run}/reference.png`, coordinateMapping: mapping, maximumCalls: plan.request.maximumCalls };
}
export function receive(root, run, requestSha256, bytes) {
  return withLock(root, () => {
    const plan = verifyPlan(root, run), attempt = verifyAttempt(root, run, plan);
    requireThat(!plan.rawSource, 'RAW_REUSE_USE_REPROCESS');
    requireThat(attempt.requestSha256 === requestSha256 && !exists(root, run, 'terminal.json')
      && !exists(root, run, 'raw.png'), 'ATTEMPT_NOT_PENDING');
    requireThat(bytes instanceof Uint8Array && bytes.length <= 64 * 1024 * 1024, 'RESULT_BYTES_INVALID');
    writeNew(root, `${run}/raw.png`, bytes);
    return finishUnlocked(root, run, sha256(bytes));
  });
}
export const finish = (root, run, rawSha256) => withLock(root, () => finishUnlocked(root, run, rawSha256));

// A new local plan may reuse a terminal exact-size rejection. It does not change
// the old attempt, authorize another provider call, or change any decoded pixels.
export function verifyRawSource(root, source) {
  exact(source, ['run', 'planSha256', 'requestSha256', 'rawSha256']);
  requireThat([source.planSha256, source.requestSha256, source.rawSha256].every(isDigest)
    && typeof source.run === 'string' && /^runs\/[a-f0-9-]{36}$/.test(source.run), 'RAW_SOURCE_CONTRACT');
  const preliminary = readJson(local(root, `${source.run}/plan.json`)); unseal(preliminary);
  requireThat(!preliminary.rawSource, 'RAW_SOURCE_REUSE_CHAIN_FORBIDDEN');
  requireThat(!preliminary.correction, 'RAW_SOURCE_CORRECTION_FORBIDDEN');
  const plan = verifyPlan(root, source.run, { allowLegacy: true });
  const attempt = verifyAttempt(root, source.run, plan), receipt = checked(root, source.run, 'receipt.json');
  const end = checked(root, source.run, 'terminal.json');
  exact(receipt, ['kind', 'planSha256', 'requestSha256', 'rawSha256', 'sha256']);
  exact(end, ['kind', 'planSha256', 'outcome', 'resubmitAllowed', 'sha256']);
  requireThat(plan.sha256 === source.planSha256 && attempt.requestSha256 === source.requestSha256
    && receipt.kind === 'ui_reference_receipt_v1' && receipt.planSha256 === plan.sha256
    && receipt.requestSha256 === source.requestSha256 && receipt.rawSha256 === source.rawSha256
    && end.kind === 'ui_reference_terminal_v1' && end.planSha256 === plan.sha256
    && end.outcome === 'rejected_technical' && end.resubmitAllowed === false
    && (plan.request.resolution?.mode ?? 'exact') === 'exact', 'RAW_SOURCE_NOT_EXACT_SIZE_REJECTION');
  const bytes = readBytes(local(root, `${source.run}/raw.png`));
  requireThat(sha256(bytes) === source.rawSha256, 'RAW_SOURCE_DIGEST_MISMATCH');
  const image = validateGenerated(bytes, { request: { ...plan.request, resolution: resolutionPolicy('native') } });
  requireThat(image.width !== plan.request.width || image.height !== plan.request.height, 'RAW_SOURCE_NOT_SIZE_MISMATCH');
  return { plan, bytes };
}
export function reprocessRaw(root, run, planSha256) {
  return withLock(root, () => {
    const plan = verifyPlan(root, run); assertCurrent(root, plan);
    requireThat(plan.rawSource && plan.sha256 === planSha256 && plan.request.maximumCalls === 0, 'REPROCESS_PLAN_MISMATCH');
    requireThat(!exists(root, run, 'terminal.json'), 'ATTEMPT_TERMINAL_NO_RESUBMIT');
    const source = verifyRawSource(root, plan.rawSource);
    if (!exists(root, run, 'attempt.json')) {
      writeJsonNew(root, `${run}/attempt.json`, seal({ kind: 'ui_reference_reprocess_attempt_v1', planSha256: plan.sha256,
        requestSha256: digestJson(plan.request), rawSha256: plan.rawSource.rawSha256, maximumCalls: 0, state: 'reserved' }));
    }
    sameOrNew(root, `${run}/request.json`, jsonBytes(plan.request)); verifyAttempt(root, run, plan);
    sameOrNew(root, `${run}/raw.png`, source.bytes);
    return finishUnlocked(root, run, plan.rawSource.rawSha256);
  });
}

export function verifyResult(root, run) {
  return validationScope(() => validationMemo(canonical(['result', root, run]), () => verifyResultEvidence(root, run)));
}
function verifyResultEvidence(root, run) {
  const plan = verifyPlan(root, run, { allowLegacy: true }); verifyAttempt(root, run, plan);
  requireThat(!exists(root, run, 'terminal.json'), 'ATTEMPT_TERMINAL_NO_RESUBMIT');
  const receipt = checked(root, run, 'receipt.json'), technical = checked(root, run, 'technical.json');
  exact(receipt, ['kind', 'planSha256', 'requestSha256', 'rawSha256', 'sha256']);
  exact(technical, ['kind', 'planSha256', 'rawSha256', 'imageSha256', 'dimensions', 'coordinateMapping', 'rawValidation', 'postValidation', 'postProcess', 'humanVisualReview', 'sha256']);
  const raw = readBytes(local(root, `${run}/raw.png`)), reference = readBytes(local(root, `${run}/reference.png`));
  requireThat(receipt.planSha256 === plan.sha256 && receipt.requestSha256 === digestJson(plan.request)
    && receipt.rawSha256 === sha256(raw) && technical.planSha256 === plan.sha256
    && technical.rawSha256 === receipt.rawSha256 && technical.imageSha256 === sha256(reference)
    && technical.rawValidation === 'PASS' && technical.postValidation === 'PASS'
    && technical.kind === 'ui_reference_technical_qa_v2' && receipt.kind === 'ui_reference_receipt_v1'
    && technical.postProcess === 'png-metadata-strip-lossless-rgba-v1' && technical.humanVisualReview === 'NOT_RUN'
    && encodePng(validateGenerated(raw, plan)).equals(reference), 'RESULT_INTEGRITY');
  const image = decodePng(reference);
  requireThat(canonical(technical.dimensions) === canonical({ width: image.width, height: image.height }), 'RESULT_DIMENSIONS_MISMATCH');
  verifyMapping(technical.coordinateMapping, { width: plan.request.width, height: plan.request.height }, technical.dimensions, plan.request.resolution);
  requireThat(!plan.rawSource || receipt.rawSha256 === plan.rawSource.rawSha256, 'RAW_SOURCE_DIGEST_MISMATCH');
  return { plan, technical, reference };
}
export function verifyReview(root, run, result = verifyResult(root, run)) {
  const review = checked(root, run, 'review.json');
  exact(review, ['kind', 'planSha256', 'imageSha256', 'layout', 'style', 'copy', 'decision', 'note', 'useAsAnchor', 'sha256']);
  requireThat(review.kind === 'ui_reference_human_review_v1' && review.planSha256 === result.plan.sha256
    && review.imageSha256 === result.technical.imageSha256
    && ['pass', 'fail'].includes(review.layout) && ['pass', 'fail'].includes(review.style)
    && ['pass', 'fail'].includes(review.copy) && ['accept', 'reject'].includes(review.decision)
    && (review.decision !== 'accept' || [review.layout, review.style, review.copy].every(value => value === 'pass')), 'VISUAL_REVIEW_INVALID');
  return review;
}
export function reviewRun(root, run, { imageSha256, layout, style, copy, decision, note, useAsAnchor = false }) {
  textValue(note, 2000);
  requireThat(['pass', 'fail'].includes(layout) && ['pass', 'fail'].includes(style) && ['pass', 'fail'].includes(copy)
    && ['accept', 'reject'].includes(decision) && typeof useAsAnchor === 'boolean'
    && (!useAsAnchor || decision === 'accept'), 'REVIEW_FIELDS_INVALID');
  return withLock(root, () => {
    const result = verifyResult(root, run), { plan, technical, reference } = result;
    requireThat(technical.imageSha256 === imageSha256, 'REVIEW_IMAGE_MISMATCH');
    requireThat(decision !== 'accept' || [layout, style, copy].every(value => value === 'pass'), 'REVIEW_FAILED');
    const project = decision === 'accept' ? assertCurrent(root, plan) : loadProject(root);
    const review = seal({ kind: 'ui_reference_human_review_v1', planSha256: plan.sha256, imageSha256,
      layout, style, copy, decision, note, useAsAnchor });
    let baseline;
    if (useAsAnchor) {
      baseline = { image: storeBlob(root, reference, 'png'), run, planSha256: plan.sha256, reviewSha256: review.sha256 };
      requireThat(!project.baselines[plan.styleSha256] || canonical(project.baselines[plan.styleSha256]) === canonical(baseline), 'STYLE_ANCHOR_ALREADY_FIXED');
    }
    sameOrNew(root, `${run}/review.json`, jsonBytes(review)); verifyReview(root, run, result);
    if (decision === 'accept') {
      project.panels[plan.panelId].acceptedRun = run;
      if (baseline) project.baselines[plan.styleSha256] = baseline;
      saveProject(root, project);
    }
    return { status: decision === 'accept' ? 'accepted' : 'rejected_visual', imageSha256, useAsAnchor };
  });
}
export function inspectRun(root, run) {
  const plan = verifyPlan(root, run, { allowLegacy: true });
  const legacy = plan.kind === 'ui_reference_plan_v1';
  let status = legacy ? 'legacy_read_only' : plan.rawSource ? 'ready_for_reprocess' : exists(root, run, 'authorization.json') ? 'authorized' : 'awaiting_authorization';
  if (exists(root, run, 'attempt.json')) {
    verifyAttempt(root, run, plan); status = 'reserved_no_resubmit';
    if (exists(root, run, 'raw.png')) status = 'raw_received_needs_finish';
    if (exists(root, run, 'technical.json') && !legacy) {
      const result = verifyResult(root, run); status = 'pending_visual_review';
      if (exists(root, run, 'review.json')) status = verifyReview(root, run, result).decision === 'accept' ? 'accepted' : 'rejected_visual';
    }
    if (exists(root, run, 'terminal.json')) {
      const end = checked(root, run, 'terminal.json'); requireThat(end.planSha256 === plan.sha256, 'TERMINAL_INTEGRITY'); status = end.outcome;
    }
  }
  return { run, status, planSha256: plan.sha256, styleSha256: plan.styleSha256,
    requestSha256: digestJson(plan.request), maximumCalls: plan.request.maximumCalls, executable: !legacy && plan.runtimeSha256 === runtimeDigest(),
    resolution: plan.request.resolution ?? resolutionPolicy('exact'),
    ...(exists(root, run, 'raw.png') ? { rawSha256: sha256(readBytes(local(root, `${run}/raw.png`))) } : {}),
    ...(exists(root, run, 'technical.json') ? { imageSha256: checked(root, run, 'technical.json').imageSha256 } : {}) };
}
// Optional adapters receive frozen bytes and provider-neutral fields. Adapter errors are never logged verbatim.
export async function generateWithAdapter(root, run, adapter) {
  requireThat(adapter && typeof adapter.generate === 'function', 'ADAPTER_GENERATE_REQUIRED');
  const reserved = reserve(root, run);
  const request = reserved.request;
  let bytes;
  try {
    const images = request.images.map(item => ({ role: item.role, sha256: item.artifact.sha256, bytes: readBytes(local(root, item.artifact.path)) }));
    bytes = await adapter.generate({ prompt: request.prompt, images, width: request.width, height: request.height, resolution: request.resolution,
      output: request.output, requestSha256: reserved.requestSha256 });
  } catch {
    stopAttempt(root, run, reserved.requestSha256, 'indeterminate');
    throw new Error('ADAPTER_INDETERMINATE_NO_RESUBMIT');
  }
  if (!(bytes instanceof Uint8Array) || bytes.length > 64 * 1024 * 1024) {
    stopAttempt(root, run, reserved.requestSha256, 'indeterminate');
    throw new Error('ADAPTER_RESULT_INVALID_NO_RESUBMIT');
  }
  return receive(root, run, reserved.requestSha256, bytes);
}
