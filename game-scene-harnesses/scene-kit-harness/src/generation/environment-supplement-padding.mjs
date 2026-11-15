import { paddedEnvironmentSource } from './environment-padding.mjs';
import { check, exact, hash, id, isDigest, seal } from './common.mjs';

const roles = { foliage: ['foreground-foliage', 'ai_scene_generation_plan_v6'],
  'distant-ruins': ['distant-ruins', 'ai_scene_generation_plan_v7'], platform: ['floating-platform-shell', 'ai_scene_generation_plan_v7'] };
const operation = 'copy-all-rgba-at-offset-two-add-zero-rgba-border-only';
function sourceFor(store, state, key, sha256) {
  check(Object.hasOwn(roles, key), 'SUPPLEMENT_PADDING_ROLE');
  const value = paddedEnvironmentSource(store, state, sha256, [roles[key][1]]);
  check(value.source.plan.target.role === roles[key][0], 'SUPPLEMENT_PADDING_ROLE');
  return value;
}

export function compileSupplementPaddingProposal(store, state, options) {
  exact(options, ['batchSha256', 'items']); check(isDigest(options.batchSha256), 'SUPPLEMENT_BATCH_DIGEST');
  check(Array.isArray(options.items) && options.items.length > 0 && options.items.length <= 3
    && new Set(options.items.map(item => item.key)).size === options.items.length, 'SUPPLEMENT_PADDING_ITEMS');
  const items = options.items.map(item => {
    exact(item, ['key', 'sourcePlanSha256']);
    const { source, png, bytes, width, height, technical } = sourceFor(store, state, item.key, item.sourcePlanSha256);
    let edgePixels = 0;
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++)
      if ((x < 2 || y < 2 || x >= png.width - 2 || y >= png.height - 2) && png.rgba[(y * png.width + x) * 4 + 3]) edgePixels++;
    return { key: item.key, sourcePlanSha256: source.plan.sha256, sourcePlanFormat: source.plan.format,
      priorTechnicalSha256: source.result.technical.sha256, originalRawSha256: source.result.rawSha256,
      originalRgbaSha256: hash(png.rgba), originalPixelSize: { width: png.width, height: png.height },
      paddedPixelSize: { width, height }, paddedRawSha256: hash(bytes), path: `${item.key}-padded-proposal.png`,
      counterfactualTechnicalSha256: technical.sha256, counterfactualStatus: 'pass',
      edgeMaximumAlpha: 1, edgePixels, sourceRgbaCopiedExactly: true };
  });
  return seal({ format: 'ai_scene_supplement_padding_proposal_v1', batchSha256: options.batchSha256, items,
    operation, padding: 2, actualPreparations: 0, imageCalls: 0,
    originalSourceBytesModified: false, originalAlphaAndVisibleRgbaModified: false,
    status: 'proposal-only-awaiting-exact-preparation-approval', originalSourceStates: 'remain-rejected-technical',
    sourceArtAcceptance: 'not-granted', productionKit: false });
}

export function compileSupplementPadding(store, state, options) {
  exact(options, ['preparationId', 'approvalSha256', 'sourcePlanSha256']); id(options.preparationId);
  const approval = state.paddingApprovals.get(options.approvalSha256);
  const proposed = approval?.proposal.items?.find(item => item.sourcePlanSha256 === options.sourcePlanSha256);
  check(approval?.format === 'ai_scene_supplement_padding_approval_v1' && proposed, 'ENVIRONMENT_PADDING_APPROVAL_REQUIRED');
  const { source, bytes, technical } = sourceFor(store, state, proposed.key, options.sourcePlanSha256);
  check(hash(bytes) === proposed.paddedRawSha256, 'ENVIRONMENT_PADDING_PROPOSAL_MISMATCH');
  const record = seal({ format: 'ai_scene_environment_preparation_v2', compiler: 'scene-kit-environment-supplement-padding-v1',
    sourcePlanSha256: source.plan.sha256, sourcePlanFormat: source.plan.format, approvalSha256: approval.sha256, proposalSha256: approval.proposal.sha256,
    priorTechnicalSha256: source.result.technical.sha256, originalRawSha256: source.result.rawSha256,
    rawSha256: hash(bytes), originalRgbaSha256: proposed.originalRgbaSha256, pixelOperation: operation, padding: 2,
    recipe: { ...source.plan.recipe, planId: options.preparationId, parents: [source.plan.sha256] },
    designReviews: source.plan.designReviews, profile: source.plan.profile, target: source.plan.target,
    request: { format: 'ai_scene_no_generation_request_v1', maximumCalls: 0 }, technical,
    sourceArtAcceptance: 'not-granted', originalPreserved: true });
  return { record, bytes };
}
