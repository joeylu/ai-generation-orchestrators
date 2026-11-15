import * as api from '../../src/generation/index.mjs';
import { encodeRgbaPng } from '../../src/png.mjs';
import { setup, specDraft, styleDraft, capabilitiesDraft, decision, referencePlan, complete, authorizeAndReserve, bytesFor } from './generation.mjs';

export function prepareFiniteEnvironment(t) {
  const c = setup(t);
  api.initWorkflow(c.root, { projectId: 'finite.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(c.root, specDraft()), style = api.createDesignDraft(c.root, styleDraft());
  api.reviewDesign(c.root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(c.root, 'style', decision('style', style.sha256));
  const cap = api.createDesignDraft(c.root, capabilitiesDraft()), reference = referencePlan(c.root, cap);
  complete(c.root, reference, bytesFor('terrain-000'));
  const capabilities = api.createDesignDraft(c.root, { ...capabilitiesDraft(), capabilityId: 'finite.native', exactSize: false });
  const plan = api.freezeEnvironmentSourcePlanV2(c.root, { planId: 'finite.source', parents: [], referencePlanSha256: reference.sha256,
    capabilitiesSha256: capabilities.sha256, assetId: 'finite.mountains', role: 'distant-mountains',
    sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 512, minimumHeight: 256, maximumWidth: 2048, maximumHeight: 1024 },
    derivation: { pixelSize: { width: 1536, height: 384 }, fit: api.ENVIRONMENT_SOURCE_PROFILE.derivation.strip, repeatAxis: 'x' },
    intent: 'Synthetic finite demonstration test double.' });
  const rgba = Buffer.alloc(2048 * 768 * 4);
  for (let y = 128; y < 768; y++) for (let x = 0; x < 2048; x++) rgba.set([60 + Math.floor(x / 16) % 150, 100 + y % 50, 90, 255], (y * 2048 + x) * 4);
  const raw = encodeRgbaPng(2048, 768, rgba), result = api.receiveResult(c.root, authorizeAndReserve(c.root, plan), raw);
  const options = { exampleId: 'finite.example', parallax: { numerator: 15, denominator: 100 },
    layoutStudy: { studyId: 'finite.height', pixelSize: { width: 1536, height: 576 } } };
  const accept = () => api.reviewResult(c.root, plan.sha256, decision('finite.source.review', result.rawSha256));
  return { ...c, plan, raw, result, options, accept, reference, capabilities };
}
