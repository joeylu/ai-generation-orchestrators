import { join } from 'node:path';
import * as api from '../../src/generation/index.mjs';
import { encodeRgbaPng } from '../../src/png.mjs';
import { prepareCandidate } from './candidate.mjs';
import { authorizeAndReserve, decision } from './generation.mjs';

export function prepareReviewCandidate(t) {
  const c = prepareCandidate(t), environmentSources = {}, plans = {}, results = {};
  const definitions = { sky: ['sky-background', 1024, 576], forest: ['distant-forest', 1536, 384],
    trees: ['tree-group', 768, 768], arch: ['ruins-arch-group', 1024, 768], wall: ['ruins-wall-group', 768, 384] };
  for (const [slot, [role, width, height]] of Object.entries(definitions)) {
    const plan = api.freezeEnvironmentSourcePlanV2(c.root, { planId: `review.${slot}`, parents: [], referencePlanSha256: c.reference.sha256,
      capabilitiesSha256: c.capabilities.sha256, assetId: `review.${slot}`, role,
      sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 512, minimumHeight: 256, maximumWidth: 4096, maximumHeight: 4096 },
      derivation: { pixelSize: { width, height }, repeatAxis: slot === 'forest' ? 'x' : 'none',
        fit: api.ENVIRONMENT_SOURCE_PROFILE.derivation[slot === 'sky' ? 'sky' : slot === 'forest' ? 'strip' : 'block'] }, intent: 'Synthetic review composition fixture.' });
    let raw;
    if (slot === 'forest') raw = c.raw;
    else {
      const w = slot === 'sky' ? 1024 : 512, h = slot === 'sky' ? 576 : 256, rgba = Buffer.alloc(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (slot === 'sky' || (x >= 64 && x < w - 64 && y >= 48 && y < h - 24)) rgba.set(
          slot === 'sky' ? [120 + y % 80, 210, 240, 255] : [80 + x % 80, 90 + y % 70, 60, 255], (y * w + x) * 4);
      }
      if (slot !== 'sky') rgba.set([80, 100, 60, 1], 0);
      raw = encodeRgbaPng(w, h, rgba);
    }
    const result = api.receiveResult(c.root, authorizeAndReserve(c.root, plan), raw); plans[slot] = plan; results[slot] = result;
    environmentSources[slot] = { planSha256: plan.sha256, layoutStudy: slot === 'forest'
      ? { studyId: 'review.forest.height', pixelSize: { width: 1536, height: 512 } } : null };
  }
  const items = ['trees', 'arch', 'wall'].map(role => ({ role, sourcePlanSha256: plans[role].sha256 }));
  const proposal = api.proposeEnvironmentPadding(c.root, items), approval = api.approveEnvironmentPadding(c.root, proposal, decision('review.padding.approved', proposal.sha256));
  for (const slot of ['trees', 'arch', 'wall']) {
    const prepared = api.prepareEnvironmentPadding(c.root, { preparationId: `review.${slot}.prepared`, approvalSha256: approval.sha256, sourcePlanSha256: plans[slot].sha256 });
    environmentSources[slot].planSha256 = prepared.sha256;
  }
  const reviewOptions = { reviewId: 'forest.review.fixture', layoutRevision: 'grounded-v3', baseCandidate: c.candidateOptions, environmentSources }, reviewOut = join(c.parent, 'review');
  return { ...c, reviewOptions, reviewOut, plans, results,
    buildReview: () => api.buildSceneReviewCandidate(c.root, c.kit, reviewOptions, c.terrainRoots, reviewOut) };
}
