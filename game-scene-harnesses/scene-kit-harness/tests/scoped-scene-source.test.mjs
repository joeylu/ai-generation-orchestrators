import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import { SCENE_SOURCE_SLOTS } from '../src/generation/scene-sources.mjs';
import { makeSceneLayerDesign } from '../src/generation/scene-layers.mjs';
import { encodeFixturePng } from '../src/png.mjs';
import { digest } from '../src/generation/common.mjs';
import { setup, specDraft, styleDraft, capabilitiesDraft, decision, complete } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(issue => issue.code === code));
let cached;
function fixture() {
  if (cached) return cached;
  const width = 1024, height = 576, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
    rgba.set([80 + x % 100, 100 + y % 100, 150, 255], (y * width + x) * 4);
  return cached = encodeFixturePng(width, height, rgba);
}
function prepare(t) {
  const { root } = setup(t); flow.initWorkflow(root, { projectId: 'scope.test', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = flow.createDesignDraft(root, { ...specDraft(), description: 'Snow-castle layout with a valley, stairs and floating platforms.',
    viewport: { width: 1024, height: 576 }, mapSizeCells: { width: 16, height: 9 } });
  const style = flow.createDesignDraft(root, styleDraft()), cap = flow.createDesignDraft(root, capabilitiesDraft());
  flow.reviewSceneDesigns(root, { spec: decision('scope.spec', spec.sha256), style: decision('scope.style', style.sha256) });
  const reference = flow.freezeSceneReferencePlan(root, { planId: 'scope.ref', parents: [], capabilitiesSha256: cap.sha256,
    pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 576, maximumWidth: 4096, maximumHeight: 4096 },
    layerDesign: makeSceneLayerDesign(), intent: 'Synthetic complete scene reference.' });
  complete(root, reference, fixture());
  return { root, reference, cap, options: { batchId: 'scope.sources', referencePlanSha256: reference.sha256,
    capabilitiesSha256: cap.sha256, intent: 'One requested asset only; preserve reference appearance.' } };
}

test('material task excludes full-scene positive instructions and geometry; v11 output remains unchanged', t => {
  const { root, options } = prepare(t);
  const legacy = flow.freezeSceneSourceBatch(root, options), old = flow.getGenerationPlan(root, legacy.planSha256s[0]);
  assert.equal(old.format, 'ai_scene_generation_plan_v11'); assert.match(old.request.prompt, /REFERENCE_LAYER_CONTEXT=/);
  const oldHash = digest(old);
  const scoped = flow.freezeSceneSourceBatch(root, { ...options, batchId: 'scope.isolated', sourceCompiler: 'isolated-role-v1' });
  const material = flow.getGenerationPlan(root, scoped.planSha256s[0]);
  assert.equal(material.format, 'ai_scene_generation_plan_v12');
  assert.match(material.request.prompt, /OUTPUT A MATERIAL FIELD, NOT A LEVEL OR TERRAIN SCENE/);
  assert.match(material.request.prompt, /broad uninterrupted soil\/rock body/);
  assert.match(material.request.prompt, /No sky-colored backing/);
  assert.doesNotMatch(material.request.prompt, /REFERENCE_LAYER_CONTEXT=|SCENE_LAYER_COMPOSITION=|APPEARANCE_THEME_CONTEXT=|SCENE_SPEC=/);
  assert.doesNotMatch(material.request.prompt, /Render ONE coherent complete landscape|Show identifiable visible evidence of every listed layer/);
  assert.doesNotMatch(material.request.prompt, /Snow-castle layout with a valley/);
  assert.equal(material.sourceScope.referenceUsage, 'material-appearance-only-ignore-scene-layout');
  assert.equal(material.sourceScope.requestedContent, undefined);
  assert.equal(digest(flow.getGenerationPlan(root, old.sha256)), oldHash, 'old frozen prompt must never gain the fix silently');
});

test('each source gets only its own content while retaining exact reference and layer evidence', t => {
  const { root, options, reference } = prepare(t);
  const batch = flow.freezeSceneSourceBatch(root, { ...options, sourceCompiler: 'isolated-role-v1' });
  for (const [index, sha] of batch.planSha256s.entries()) {
    const plan = flow.getGenerationPlan(root, sha), slot = SCENE_SOURCE_SLOTS[index];
    assert.equal(plan.sourceScope.role, slot.key);
    assert.equal(plan.sourceScope.layerDesignSha256, reference.composition.layerDesignSha256);
    assert.equal(plan.sourceScope.fullSceneCompositionRulesIncluded, false);
    assert.equal(plan.request.images.length, 1);
    assert.equal(plan.layerBinding.referencePlanSha256, reference.sha256);
    assert.equal(plan.visualReviewChecklist.automatedSemanticDetection, false);
    assert.equal(plan.visualReviewChecklist.visualAcceptance, 'not-assessed');
    for (const other of reference.composition.layers.filter(layer => layer.sourceSlot !== slot.key))
      assert.equal(plan.request.prompt.includes(other.content), false, `unrelated ${other.layerId} content must not enter ${slot.key}`);
  }
});

test('scoped unknown outcome stays terminal; explicit revision keeps other ten authorizations and needs fresh compute', t => {
  const { root, options } = prepare(t), batch = flow.freezeSceneSourceBatch(root, { ...options, sourceCompiler: 'isolated-role-v1' });
  flow.authorizeSceneSourceBatch(root, batch.sha256, decision('scope.compute', batch.sha256, 'approve-compute'));
  const oldSha = batch.planSha256s[0], { request: _request, ...ticket } = flow.reservePlan(root, oldSha);
  flow.recordSubmission(root, ticket); flow.stopAttempt(root, ticket, 'indeterminate');
  const next = flow.reviseSceneSourceBatch(root, batch.sha256, { batchId: 'scope.revised', replacements: [{ slot: 'material',
    planId: 'scope.material.r2', intent: 'Explicit new material attempt after unknown outcome.' }] });
  assert.equal(next.newImageRequests, 1); assert.deepEqual(next.planSha256s.slice(1), batch.planSha256s.slice(1));
  const status = flow.inspectWorkflow(root);
  assert.equal(status.plans.find(plan => plan.planSha256 === oldSha).status, 'indeterminate');
  assert.equal(status.plans.filter(plan => plan.status === 'authorized').length, 10);
  const replacement = flow.getGenerationPlan(root, next.planSha256s[0]);
  assert.equal(replacement.format, 'ai_scene_generation_plan_v12');
  rejects(() => flow.reservePlan(root, replacement.sha256), 'AUTHORIZATION_REQUIRED');
  flow.authorizeSceneSourceBatch(root, next.sha256, decision('scope.revised.compute', next.sha256, 'approve-compute'));
  assert.equal(flow.inspectWorkflow(root).plans.filter(plan => plan.status === 'authorized').length, 11);
});

test('read-only scoped proposal cannot dispatch; invalid compiler appends no plans', t => {
  const { root, options } = prepare(t), before = flow.inspectWorkflow(root);
  const proposal = flow.previewScopedSceneSources(root, options);
  assert.equal(proposal.status, 'proposal-only'); assert.equal(proposal.generationCalls, 0); assert.equal(proposal.plans.length, 11);
  assert.deepEqual(flow.inspectWorkflow(root), before);
  rejects(() => flow.reservePlan(root, proposal.plans[0].sha256), 'PLAN_MISSING');
  rejects(() => flow.freezeSceneSourceBatch(root, { ...options, sourceCompiler: 'guess' }), 'SOURCE_COMPILER');
  assert.deepEqual(flow.inspectWorkflow(root), before);
});

test('explicit v12 correction binds terminal v11 material/sky and never rewrites the other old authorizations', t => {
  const { root, options } = prepare(t), old = flow.freezeSceneSourceBatch(root, options);
  flow.authorizeSceneSourceBatch(root, old.sha256, decision('old.batch.compute', old.sha256, 'approve-compute'));
  const { request: _request, ...materialTicket } = flow.reservePlan(root, old.planSha256s[0]);
  const result = flow.receiveResult(root, materialTicket, fixture());
  flow.reviewResult(root, old.planSha256s[0], decision('material.reject', result.rawSha256, 'reject'));
  const { request: _skyRequest, ...skyTicket } = flow.reservePlan(root, old.planSha256s[1]);
  flow.stopAttempt(root, skyTicket, 'indeterminate');
  const before = flow.inspectWorkflow(root);
  rejects(() => flow.freezeSceneSourceBatch(root, { ...options, batchId: 'invalid.parent', sourceCompiler: 'isolated-role-v1',
    sourceParents: [{ slot: 'foreground', planSha256: old.planSha256s[8] }] }), 'PLAN_PARENT');
  assert.deepEqual(flow.inspectWorkflow(root), before);
  const next = flow.freezeSceneSourceBatch(root, { ...options, batchId: 'scope.corrected', sourceCompiler: 'isolated-role-v1',
    sourceParents: [{ slot: 'material', planSha256: old.planSha256s[0] }, { slot: 'sky', planSha256: old.planSha256s[1] }] });
  assert.deepEqual(flow.getGenerationPlan(root, next.planSha256s[0]).recipe.parents, [old.planSha256s[0]]);
  assert.deepEqual(flow.getGenerationPlan(root, next.planSha256s[1]).recipe.parents, [old.planSha256s[1]]);
  assert.equal(flow.inspectWorkflow(root).plans.filter(plan => plan.status === 'authorized').length, 9);
  assert.ok(next.planSha256s.every(sha => flow.inspectWorkflow(root).plans.find(plan => plan.planSha256 === sha).status === 'planned'));
  rejects(() => flow.reservePlan(root, next.planSha256s[0]), 'AUTHORIZATION_REQUIRED');
});
