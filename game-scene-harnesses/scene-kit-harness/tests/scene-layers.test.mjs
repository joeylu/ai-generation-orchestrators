import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_LAYER_PROFILE, makeSceneLayerDesign, validateSceneLayerDesign } from '../src/generation/scene-layers.mjs';
import { compileLayeredSceneReference, compileLayeredSceneSource } from '../src/generation/layered-scene.mjs';
import { compileSceneReference, compileSceneSource, SCENE_SOURCE_SLOTS, SCENE_SOURCE_PROFILE_SHA256 } from '../src/generation/scene-sources.mjs';
import { applyRecord } from '../src/generation/model.mjs';
import { seal } from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import { capabilitiesDraft, decision, setup, specDraft, styleDraft } from './helpers/generation.mjs';

const rejects = (operation, code) => assert.throws(operation, error => error.errors?.some(issue => issue.code === code));
function context() {
  const spec = seal({ ...specDraft(), grid: { width: 64, height: 64 }, viewport: { width: 1024, height: 576 }, mapSizeCells: { width: 16, height: 9 } });
  const style = seal(styleDraft()), cap = seal(capabilitiesDraft());
  const state = { designs: new Map([[spec.sha256, spec], [style.sha256, style]]), capabilities: new Map([[cap.sha256, cap]]),
    designReviews: new Map([spec, style].map(doc => [doc.sha256, seal({ format: 'ai_scene_design_review_v1', kind: doc === spec ? 'spec' : 'style',
      receipt: decision(doc === spec ? 'gold.spec' : 'gold.style', doc.sha256) })])), plans: new Map(), ids: new Set(), batches: new Map(),
    activeSpec: spec.sha256, activeStyle: style.sha256 };
  const recipe = { planId: 'reference.gold', parents: [], stage: 'reference', specSha256: spec.sha256, styleSha256: style.sha256,
    capabilitiesSha256: cap.sha256, referencePlans: [], inventoryRefs: [], assetId: 'scene-reference',
    pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 576, maximumWidth: 4096, maximumHeight: 4096 }, intent: 'Legacy reference compatibility.' };
  return { state, recipe, spec, style, cap };
}
function accepted(state, plan) {
  state.plans.set(plan.sha256, { plan, status: 'accepted', result: { rawSha256: 'a'.repeat(64),
    technical: { image: { sha256: 'a'.repeat(64), byteLength: 100, pixelSize: { width: 1024, height: 576 } } } }, review: { sha256: 'b'.repeat(64) } });
}
function sourceRecipe(recipe, ref, slot = 'foreground') {
  const { pixelPolicy: _ignored, layerDesign: _layers, ...base } = recipe;
  return { ...base, planId: `source.${slot}`, stage: 'environment-source', assetId: `scene.${slot}`, slot,
    referencePlans: [ref.sha256], intent: 'Layer-bound isolated source.' };
}

test('missing foreground, reordered/duplicate roles, blank content and host paths fail layer validation', () => {
  const design = makeSceneLayerDesign(), { sha256: _ignored, ...body } = design;
  rejects(() => validateSceneLayerDesign(seal({ ...body, layers: body.layers.slice(0, -1) })), 'SCENE_LAYER_COVERAGE');
  rejects(() => validateSceneLayerDesign(seal({ ...body, layers: body.layers.toReversed() })), 'SCENE_LAYER_ORDER');
  rejects(() => validateSceneLayerDesign(seal({ ...body, layers: body.layers.map((layer, index) => index === 10 ? body.layers[0] : layer) })), 'SCENE_LAYER_ORDER');
  const contents = Object.fromEntries(design.layers.map(layer => [layer.layerId, layer.content]));
  rejects(() => makeSceneLayerDesign({ ...contents, foreground: '' }), 'WORKFLOW_TEXT');
  rejects(() => makeSceneLayerDesign({ ...contents, foreground: 'C:\\private\\image.png' }), 'PRIVATE_OPERATIONAL_TEXT');
  const { foreground: _missing, ...incomplete } = contents; rejects(() => makeSceneLayerDesign(incomplete), 'WORKFLOW_SHAPE');
});

test('reference prompt explicitly requires foreground, resolved bottom, controlled overlap and one coherent scene; edits change digest', () => {
  const { state, recipe } = context(), layerDesign = makeSceneLayerDesign();
  const ref = compileLayeredSceneReference(state, { ...recipe, layerDesign });
  assert.equal(ref.format, 'ai_scene_generation_plan_v10');
  assert.match(ref.request.prompt, /Foreground must be visibly in front/);
  assert.match(ref.request.prompt, /No undesigned blank footer, gray placeholder band/);
  assert.match(ref.request.prompt, /do not fuse unrelated layers/);
  assert.match(ref.request.prompt, /ONE coherent complete landscape/);
  assert.equal(ref.visualReviewChecklist.automatedLayerDetection, false);
  assert.ok(ref.visualReviewChecklist.requiredLayers.every(layer => layer.visualAcceptance === 'not-assessed'));
  const contents = Object.fromEntries(layerDesign.layers.map(layer => [layer.layerId, layer.content]));
  const changed = compileLayeredSceneReference(state, { ...recipe, layerDesign: makeSceneLayerDesign({ ...contents, foreground: 'Near snow-covered rocks at the lower left and right edges.' }) });
  assert.notEqual(changed.sha256, ref.sha256); assert.notEqual(changed.composition.layerDesignSha256, ref.composition.layerDesignSha256);
});

test('all eleven sources bind to the exact accepted composition; material derives terrain and excludes foreground', () => {
  const { state, recipe } = context(), ref = compileLayeredSceneReference(state, { ...recipe, layerDesign: makeSceneLayerDesign() }); accepted(state, ref);
  for (const slot of SCENE_SOURCE_SLOTS) {
    const source = compileLayeredSceneSource(state, sourceRecipe(recipe, ref, slot.key));
    assert.equal(source.layerBinding.layerDesignSha256, ref.composition.layerDesignSha256);
    assert.equal(source.layerBinding.referencePlanSha256, ref.sha256);
    assert.equal(source.layerBinding.sourceSlot, slot.key);
    assert.deepEqual(source.layerBinding.layer, ref.composition.layers.find(layer => layer.sourceSlot === slot.key));
    assert.equal(source.request.maximumCalls, 1); assert.equal(source.request.images[0].artifact.sha256, 'a'.repeat(64));
    assert.match(source.request.prompt, slot.key === 'material' ? /MATERIAL FROM THE TERRAIN LAYER ONLY/ : /Exclude every other layer/);
  }
  assert.equal(compileLayeredSceneSource(state, sourceRecipe(recipe, ref, 'material')).layerBinding.layerId, 'terrain');
  assert.equal(compileLayeredSceneSource(state, sourceRecipe(recipe, ref)).layerBinding.layerId, 'foreground');
});

test('replay rejects a fabricated layer binding and a legacy source slipped into a layered batch', () => {
  const { state, recipe } = context(), ref = compileLayeredSceneReference(state, { ...recipe, layerDesign: makeSceneLayerDesign() }); accepted(state, ref);
  const store = { metadata: { compiler: 'scene-kit-native-reference-v2' } };
  const source = compileLayeredSceneSource(state, sourceRecipe(recipe, ref)), { sha256: _old, ...body } = source;
  rejects(() => applyRecord(store, state, seal({ ...body, layerBinding: { ...body.layerBinding, layerId: 'sky' } })), 'PLAN_RECOMPILE_MISMATCH');
  const plans = SCENE_SOURCE_SLOTS.map(slot => slot.key === 'foreground'
    ? compileSceneSource(state, sourceRecipe(recipe, ref, slot.key)) : compileLayeredSceneSource(state, sourceRecipe(recipe, ref, slot.key)));
  plans.forEach(plan => applyRecord(store, state, plan));
  rejects(() => applyRecord(store, state, seal({ format: 'ai_scene_source_batch_v1', batchId: 'bad.batch', profileSha256: SCENE_SOURCE_PROFILE_SHA256,
    referencePlanSha256: ref.sha256, planSha256s: plans.map(plan => plan.sha256), maximumImageRequests: 11 })), 'SOURCE_BATCH_COVERAGE');
});

test('legacy v9/v8 plan hashes remain stable, with no silently added layers', () => {
  const { state, recipe } = context(), ref = compileSceneReference(state, recipe); accepted(state, ref);
  assert.equal(ref.sha256, '84bf8a6907163a67d8d08efdfb5fa14fb18379f7ff891fe55ef93cfa4ab917e7');
  const source = compileSceneSource(state, { ...sourceRecipe(recipe, ref), planId: 'source.gold', intent: 'Legacy source compatibility.' });
  assert.equal(source.sha256, '5d7fc99c540cd8208fb96ff85f3bea3fcaf909f8b36f2e591c7522725e3dcdf1');
  assert.equal(ref.composition, undefined); assert.equal(source.layerBinding, undefined);
});

test('read-only layered proposal never enters journal or becomes computable', t => {
  const { root } = setup(t), { spec, style, cap } = context();
  flow.initWorkflow(root, { projectId: 'proposal.test', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  for (const doc of [spec, style, cap]) { const { sha256: _ignored, ...draft } = doc; flow.createDesignDraft(root, draft); }
  flow.reviewSceneDesigns(root, { spec: decision('proposal.spec', spec.sha256), style: decision('proposal.style', style.sha256) });
  const before = flow.inspectWorkflow(root), { recipe } = context();
  const proposal = flow.previewLayeredSceneReference(root, { planId: 'proposal.ref', parents: [], capabilitiesSha256: cap.sha256,
    pixelPolicy: recipe.pixelPolicy, intent: 'Read-only composition proposal.', layerDesign: makeSceneLayerDesign() });
  assert.equal(proposal.status, 'proposal-only'); assert.equal(proposal.generationCalls, 0);
  assert.deepEqual(flow.inspectWorkflow(root), before);
  rejects(() => flow.authorizePlan(root, proposal.plan.sha256, decision('not.frozen', proposal.plan.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
});

test('explicit upgrade preserves terminal legacy reference; pending art review cannot be bypassed as a revision', () => {
  const { state, recipe } = context(), old = compileSceneReference(state, recipe);
  state.plans.set(old.sha256, { plan: old, status: 'pending-visual-review' });
  const revised = { ...recipe, planId: 'reference.upgrade', parents: [old.sha256], layerDesign: makeSceneLayerDesign() };
  rejects(() => compileLayeredSceneReference(state, revised), 'PLAN_PARENT');
  state.plans.get(old.sha256).status = 'rejected-visual';
  assert.equal(compileLayeredSceneReference(state, revised).recipe.parents[0], old.sha256);
  assert.equal(state.plans.get(old.sha256).status, 'rejected-visual');
});
