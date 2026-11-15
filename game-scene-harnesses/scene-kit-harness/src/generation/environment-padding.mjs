import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { assertCurrent } from './compiler.mjs';
import { assessEnvironmentSourceV2 } from './environment-source.mjs';
import { check, digest, exact, hash, id, seal } from './common.mjs';

const roles = { trees: 'tree-group', arch: 'ruins-arch-group', wall: 'ruins-wall-group' };
const operation = 'copy-all-rgba-at-offset-two-add-zero-rgba-border-only';

export function paddedEnvironmentSource(store, state, sourcePlanSha256, formats = ['ai_scene_generation_plan_v6']) {
  const source = state.plans.get(sourcePlanSha256);
  check(formats.includes(source?.plan.format) && source.plan.target.kind === 'environment'
    && source.status === 'rejected-technical' && source.result?.technical.issues.length === 1
    && source.result.technical.issues[0] === 'ENVIRONMENT_ALPHA_MARGIN', 'ENVIRONMENT_PADDING_SOURCE');
  assertCurrent(state, source.plan);
  const raw = store.readBlob(source.result.rawSha256), png = inspectPng(raw, { allowCabx: true, allowHiddenRgb: true, includePixels: true });
  let maximum = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (x < 2 || y < 2 || x >= png.width - 2 || y >= png.height - 2) maximum = Math.max(maximum, png.rgba[(y * png.width + x) * 4 + 3]);
  }
  check(maximum === 1, 'ENVIRONMENT_PADDING_VISIBLE_EDGE');
  const width = png.width + 4, height = png.height + 4;
  check(width <= source.plan.target.sourcePolicy.maximumWidth && height <= source.plan.target.sourcePolicy.maximumHeight, 'ENVIRONMENT_PADDING_SIZE');
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < png.height; y++) rgba.set(png.rgba.subarray(y * png.width * 4, (y + 1) * png.width * 4), ((y + 2) * width + 2) * 4);
  const bytes = encodeRgbaPng(width, height, rgba), technical = assessEnvironmentSourceV2(source.plan, bytes);
  check(technical.status === 'pass', 'ENVIRONMENT_PADDING_NOT_READY');
  return { source, bytes, technical, png, width, height };
}
const paddedSource = (store, state, sha256) => paddedEnvironmentSource(store, state, sha256);

// A proposal is reviewable evidence only. It does not alter a workflow entry.
export function compilePaddingProposal(store, state, items) {
  check(Array.isArray(items) && items.length > 0 && items.length <= 3
    && new Set(items.map(item => item.role)).size === items.length, 'ENVIRONMENT_PADDING_ITEMS');
  const plans = items.map(item => {
    exact(item, ['role', 'sourcePlanSha256']);
    const { source, bytes, technical, png, width, height } = paddedSource(store, state, item.sourcePlanSha256);
    check(Object.hasOwn(roles, item.role) && roles[item.role] === source.plan.target.role, 'ENVIRONMENT_PADDING_ROLE');
    return { role: item.role, sourcePlanSha256: source.plan.sha256, priorTechnicalSha256: source.result.technical.sha256,
      originalRawSha256: source.result.rawSha256, originalRgbaSha256: hash(png.rgba),
      originalPixelSize: { width: png.width, height: png.height }, paddedPixelSize: { width, height },
      paddedRawSha256: hash(bytes), padding: 2, pixelOperation: operation, sourceBytesModified: false,
      alphaValuesModified: false, counterfactualTechnicalStatus: technical.status, counterfactualIssues: technical.issues,
      workflowState: 'original-remains-rejected-technical' };
  });
  return seal({ format: 'ai_scene_environment_padding_proposal_set_v1', plans,
    excludedRoles: ['foliage'], newImageCalls: 0, sourceMarginMaximumAlpha: 1,
    productionKit: false, sourceArtAcceptance: 'not-granted', status: 'awaiting-exact-pixel-preparation-approval' });
}

export function compileEnvironmentPadding(store, state, options) {
  exact(options, ['preparationId', 'approvalSha256', 'sourcePlanSha256']); id(options.preparationId);
  const approval = state.paddingApprovals.get(options.approvalSha256);
  check(approval?.format === 'ai_scene_environment_padding_approval_v1'
    && approval.proposal.plans.some(item => item.sourcePlanSha256 === options.sourcePlanSha256), 'ENVIRONMENT_PADDING_APPROVAL_REQUIRED');
  const { source, bytes, technical } = paddedSource(store, state, options.sourcePlanSha256);
  const proposed = approval.proposal.plans.find(item => item.sourcePlanSha256 === options.sourcePlanSha256);
  check(hash(bytes) === proposed.paddedRawSha256, 'ENVIRONMENT_PADDING_PROPOSAL_MISMATCH');
  const record = seal({ format: 'ai_scene_environment_preparation_v1', compiler: 'scene-kit-environment-padding-v1',
    sourcePlanSha256: source.plan.sha256, approvalSha256: approval.sha256, proposalSha256: approval.proposal.sha256,
    priorTechnicalSha256: source.result.technical.sha256, originalRawSha256: source.result.rawSha256,
    rawSha256: hash(bytes), originalRgbaSha256: proposed.originalRgbaSha256, pixelOperation: operation, padding: 2,
    recipe: { ...source.plan.recipe, planId: options.preparationId, parents: [source.plan.sha256] },
    designReviews: source.plan.designReviews, profile: source.plan.profile, target: source.plan.target,
    request: { format: 'ai_scene_no_generation_request_v1', maximumCalls: 0 }, technical,
    sourceArtAcceptance: 'not-granted', originalPreserved: true });
  return { record, bytes };
}
