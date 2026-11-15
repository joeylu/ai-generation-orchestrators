import { join } from 'node:path';
import * as api from '../../src/generation/index.mjs';
import { syntheticTerrainMaterial } from '../../scripts/terrain-fixture.mjs';
import { setup, specDraft, styleDraft, capabilitiesDraft, referencePlan, complete, bytesFor, decision, authorizeAndReserve } from './generation.mjs';

export function prepareTerrainPreview(t, { accepted = true } = {}) {
  const context = setup(t), { root, parent } = context;
  api.initWorkflow(root, { projectId: 'preview.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(root, specDraft()), style = api.createDesignDraft(root, styleDraft());
  api.reviewDesign(root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(root, 'style', decision('style', style.sha256));
  const capability = api.createDesignDraft(root, capabilitiesDraft()), reference = referencePlan(root, capability);
  complete(root, reference, bytesFor('terrain-000'));
  const plan = api.freezeTerrainMaterialPlan(root, { planId: 'preview.material', parents: [], referencePlanSha256: reference.sha256,
    capabilitiesSha256: capability.sha256, intent: 'Synthetic appearance fixture; no real generation or human acceptance.' });
  const result = api.receiveResult(root, authorizeAndReserve(root, plan), syntheticTerrainMaterial());
  const original = join(parent, 'proof'), revision = join(parent, 'proof-v2'), study = join(parent, 'proof-continuous');
  api.buildTerrainProofBundle(root, plan.sha256, original); api.reviseTerrainProofBundle(root, plan.sha256, original, revision);
  const load = () => api.loadTerrainStudyPreview(root, plan.sha256, original, revision, study);
  const accept = () => {
    api.reviewResult(root, plan.sha256, decision('material.accept', result.rawSha256));
    api.buildTerrainContinuityStudy(root, plan.sha256, original, revision, study);
    return load();
  };
  return { ...context, plan, result, original, revision, study, accept, load, preview: accepted ? accept() : null };
}
