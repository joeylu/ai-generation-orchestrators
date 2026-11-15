import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as workflow from '../../src/generation/index.mjs';
import { loadSceneKit } from '../../src/kit.mjs';

export const fixtureRoot = fileURLToPath(new URL('../fixtures/synthetic', import.meta.url));
export const bytesFor = assetId => readFileSync(join(fixtureRoot, 'assets', `${assetId}.png`));
export const decision = (decisionId, targetSha256, choice = 'accept') => ({
  decisionId, decision: choice, targetSha256, notes: 'Synthetic test-double decision; not a human artwork acceptance.',
});
export const specDraft = () => ({ format: 'ai_scene_spec_v1', specId: 'scene.r1', projection: 'sideview',
  description: 'Synthetic horizontal terrain with a gap and reusable platforms.', inputs: [], grid: { width: 64, height: 64 },
  pixelsPerUnit: { numerator: 1, denominator: 1 }, viewport: { width: 64, height: 64 }, mapSizeCells: { width: 64, height: 9 } });
export const styleDraft = () => ({ format: 'ai_scene_style_v1', styleId: 'style.r1', mode: 'preset', name: 'Synthetic engineering palette',
  rules: ['Use the synthetic blue terrain palette; no characters or props.'], anchors: [] });
export const capabilitiesDraft = () => ({ format: 'ai_scene_image_capabilities_v1', capabilityId: 'double.r1', source: 'host-declared',
  textToImage: true, imageToImage: true, exactSize: true, transparentBackground: true, maxInputImages: 8,
  maxWidth: 4096, maxHeight: 4096, maximumCallsPerRequest: 1, outputFormat: 'png' });

export function setup(t) {
  const parent = mkdtempSync(join(tmpdir(), 'scene-generation-'));
  const root = join(parent, 'workspace');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root, kit: loadSceneKit(fixtureRoot) };
}
export function prepare(root) {
  workflow.initWorkflow(root, { projectId: 'synthetic.project', purpose: 'synthetic-simulation' });
  const spec = workflow.createDesignDraft(root, specDraft()), style = workflow.createDesignDraft(root, styleDraft());
  const capabilities = workflow.createDesignDraft(root, capabilitiesDraft());
  workflow.reviewDesign(root, 'spec', decision('fixture.spec', spec.sha256));
  workflow.reviewDesign(root, 'style', decision('fixture.style', style.sha256));
  return { spec, style, capabilities };
}
export function referencePlan(root, capabilities, planId = 'reference.r1', parents = []) {
  return workflow.freezeReferencePlan(root, { planId, parents, capabilitiesSha256: capabilities.sha256, pixelSize: { width: 64, height: 64 }, intent: 'Synthetic reference exchange test.' });
}
export function authorizeAndReserve(root, plan, tag = plan.recipe.planId) {
  workflow.authorizePlan(root, plan.sha256, decision(`compute.${tag}`, plan.sha256, 'approve-compute'));
  const { request: _request, ...ticket } = workflow.reservePlan(root, plan.sha256);
  return ticket;
}
export function complete(root, plan, bytes, tag = plan.recipe.planId) {
  const ticket = authorizeAndReserve(root, plan, tag);
  workflow.recordSubmission(root, ticket);
  const result = workflow.receiveResult(root, ticket, bytes);
  if (result.technical.status !== 'pass') throw new Error('Synthetic fixture did not pass technical reception');
  workflow.reviewResult(root, plan.sha256, decision(`review.${tag}`, result.rawSha256));
  return { ticket, result };
}
