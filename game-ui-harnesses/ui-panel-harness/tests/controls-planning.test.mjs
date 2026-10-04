import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog, resolveRecipe, searchCatalog } from '../src/catalog.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { createAssetRetrieval } from '../src/asset-retrieval.mjs';
import { proposalTargets, validatePanelProposal, checkPanelProposal, requireReadyProposal } from '../src/proposal.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { digestJson } from '../src/canonical.mjs';

const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const catalog = readJson('../examples/modern-mint-controls.catalog.json');
const legacyCatalog = readJson('../examples/modern-mint-light.catalog.json');
const fixture = readJson('../examples/settings-controls.panel.json');
const requestText = readFileSync(new URL('../examples/controls-planning/request.txt', import.meta.url), 'utf8');
const request = { requestVersion: '0.1', id: 'controls-request', text: requestText, target: 'pixi' };
const copy = value => structuredClone(value);
const emptyRetrieval = { assetRetrievalVersion: '0.1', library: { id: 'controls-test', sha256: 'a'.repeat(64) },
  policy: { algorithm: 'lexical-v1', latestOnly: true, limitPerSlot: 16, style: null }, candidates: [] };
const iconKey = 'controls-test/volume@1.0.0';
// This index is an explicit metadata fixture for the pure retriever; it has no filesystem verification claim.
const index = { assetLibraryVersion: '0.1', id: 'controls-test', sha256: 'a'.repeat(64), records: [{
  key: iconKey, namespace: 'controls-test',
  metadata: { id: 'volume', version: '1.0.0', name: '音量', role: 'icon', family: 'audio', style: 'mint', variant: 'default',
    tags: ['音量'], size: { width: 64, height: 64 }, slice: null },
  file: { sha256: 'b'.repeat(64), bytes: 128 },
}] };
function proposalFor(context, spec = copy(fixture)) {
  return { proposalVersion: context.planningContextVersion, contextSha256: context.sha256, spec, unresolved: [],
    decisions: proposalTargets(spec, context.planningContextVersion).map(target => ({ target,
      basis: target.startsWith('row:') || target.startsWith('state:')
        ? { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text }
        : { kind: 'design-choice', reason: 'Use the explicit fixed-canvas fixture layout and matching visual configuration.' },
    })) };
}
function legacySpec() {
  const spec = readJson('../examples/audio-settings-assets.panel.json');
  spec.panelSpecVersion = '0.1'; delete spec.assets;
  return spec;
}
async function rehash(context) {
  const { sha256, ...payload } = context;
  return { ...payload, sha256: await digestJson(payload) };
}
async function patch(spec, operations) {
  return applyPanelPatch(spec, { patchVersion: '0.1', baseSpecSha256: await digestJson(spec), reason: 'Explicit controls regression fixture edit.', operations });
}
function emitRow(id) {
  return { id, kind: 'button', recipe: { id: 'settings.button', version: '0.1.0' }, label: '宿主操作',
    buttonLabel: '应用', enabled: true, event: `settings.${id}`, action: { kind: 'emit' } };
}

test('control catalog adds exact select/button recipes while preserving the old theme and recipes', () => {
  const checked = validateCatalog(catalog);
  assert.equal(checked.id, legacyCatalog.id); assert.equal(checked.version, '0.2.0');
  assert.deepEqual(checked.themes, legacyCatalog.themes);
  assert.deepEqual(checked.recipes.slice(0, 4), legacyCatalog.recipes);
  for (const kind of ['select', 'button']) {
    assert.equal(resolveRecipe(checked, { id: `settings.${kind}`, version: '0.1.0' }, `${kind}-row`).kind, `${kind}-row`);
    assert.throws(() => resolveRecipe(legacyCatalog, { id: `settings.${kind}`, version: '0.1.0' }));
  }
  assert.equal(searchCatalog(checked, { query: '画质下拉', kind: 'select-row', target: 'pixi' })[0].recipe.id, 'settings.select');
  assert.equal(searchCatalog(checked, { query: '恢复默认按钮', kind: 'button-row', target: 'pixi' })[0].recipe.id, 'settings.button');
});

test('legacy context 0.1 and 0.2 keep their exact pre-controls canonical hashes', async () => {
  const input = { requestVersion: '0.1', id: 'controls-regression', text: '音量 slider 设置面板', target: 'pixi' };
  const plain = await createPlanningContext(input, legacyCatalog);
  const assets = await createPlanningContext(input, legacyCatalog, emptyRetrieval);
  assert.equal(plain.sha256, 'a414a0b003ad2b584926f437c9515b402913488ff5dd4c86431ca9e1c73254c9');
  assert.equal(assets.sha256, '0ca5b98e96fb8f08c7e44e2cea1a280db02f498f1f25bb4ff8d71dd58fccb0fe');
  assert.equal(plain.planningContextVersion, '0.1'); assert.equal(assets.planningContextVersion, '0.2');
  assert.equal(Object.hasOwn(plain, 'assetRetrieval'), false);
  assert.deepEqual(await validatePlanningContext(plain), plain);
  assert.deepEqual(await validatePlanningContext(assets), assets);
});

test('control catalogs produce explicit context 0.3 capabilities and a required nullable asset retrieval field', async () => {
  const context = await createPlanningContext(request, catalog);
  assert.equal(context.planningContextVersion, '0.3'); assert.equal(context.assetRetrieval, null);
  assert.deepEqual(context.capabilities.rowKinds, ['slider', 'switch', 'select', 'button']);
  assert.deepEqual(context.capabilities.panelSpecVersions, ['0.1', '0.2', '0.3']);
  assert.deepEqual(context.capabilities.actions, ['emit', 'reset-initial']);
  assert.deepEqual(context.request, request);
  assert.deepEqual(await createPlanningContext(request, catalog, null), context);
  assert.deepEqual(await validatePlanningContext(context), context);
  for (const kind of ['slider-row', 'switch-row', 'select-row', 'button-row']) assert.ok(context.candidates.some(c => c.kind === kind));
  const missing = copy(context); delete missing.assetRetrieval;
  await assert.rejects(validatePlanningContext(await rehash(missing)), { code: 'required' });
  const altered = copy(context); altered.capabilities.actions.push('run-script');
  await assert.rejects(validatePlanningContext(await rehash(altered)), { code: 'context-mismatch' });
});

test('context version derives from recipe capabilities rather than caller-selected version numbers', async () => {
  const context = await createPlanningContext(request, catalog);
  const downgraded = copy(context); downgraded.planningContextVersion = '0.2';
  await assert.rejects(validatePlanningContext(await rehash(downgraded)), { code: 'context-mismatch' });
  const forged = copy(context); forged.catalog = copy(legacyCatalog);
  await assert.rejects(validatePlanningContext(await rehash(forged)));
  const partial = copy(legacyCatalog); partial.recipes.push(copy(catalog.recipes.find(r => r.kind === 'button-row')));
  assert.equal((await createPlanningContext(request, partial)).planningContextVersion, '0.3');
});

test('proposal 0.3 explains select state and button semantics, and reports the matching planning version', async () => {
  const context = await createPlanningContext(request, catalog), proposal = proposalFor(context);
  assert.deepEqual(await validatePanelProposal(context, proposal), proposal);
  const report = await checkPanelProposal(context, proposal);
  assert.equal(report.planningReportVersion, '0.3'); assert.equal(report.status, 'READY_TO_COMPILE');
  assert.equal(report.semanticReview, 'NOT_RUN'); assert.equal(report.assetEvidence, undefined);
  const targets = proposalTargets(fixture, '0.3');
  assert.ok(targets.includes('row:quality-row')); assert.ok(targets.includes('state:quality'));
  assert.ok(targets.includes('row:reset-row')); assert.ok(!targets.includes('state:reset-row'));
  const choice = copy(proposal);
  choice.decisions.find(d => d.target === 'row:reset-row').basis = { kind: 'design-choice', reason: 'Assume the button resets all settings.' };
  await assert.rejects(validatePanelProposal(context, choice), { code: 'PLAN_BUSINESS_ORIGIN' });
  const wrongRecipe = copy(proposal); wrongRecipe.spec.sections[0].rows[2].recipe = { id: 'settings.slider', version: '0.1.0' };
  await assert.rejects(validatePanelProposal(context, wrongRecipe), /expected select-row/);
});

test('old contexts cannot propose PanelSpec 0.3 and all proposal/context versions must pair exactly', async () => {
  const context = await createPlanningContext(request, catalog);
  for (const version of ['0.1', '0.2']) {
    const proposal = proposalFor(context); proposal.proposalVersion = version;
    await assert.rejects(validatePanelProposal(context, proposal), { code: 'PLAN_ASSET_CONTEXT_VERSION' });
  }
  for (const retrieval of [undefined, emptyRetrieval]) {
    const oldContext = await createPlanningContext(request, legacyCatalog, retrieval);
    await assert.rejects(validatePanelProposal(oldContext, proposalFor(oldContext)), { code: 'PLAN_SPEC_CONTEXT_VERSION' });
  }
  assert.deepEqual((await validatePanelProposal(context, proposalFor(context, legacySpec()))).spec, legacySpec());
});

test('context and proposal 0.3 preserve bounded asset selection and per-row decisions', async () => {
  const retrieval = createAssetRetrieval(request.text, index);
  const context = await createPlanningContext(request, catalog, retrieval);
  assert.equal(context.planningContextVersion, '0.3'); assert.deepEqual(context.assetRetrieval, retrieval);
  assert.deepEqual(await validatePlanningContext(context), context);
  const spec = copy(fixture);
  spec.assets = { library: copy(retrieval.library), panelSurface: null, rowIcons: [{ rowId: 'volume-row', asset: iconKey }] };
  const proposal = proposalFor(context, spec);
  assert.deepEqual(await validatePanelProposal(context, proposal), proposal);
  const report = await checkPanelProposal(context, proposal);
  assert.equal(report.assetEvidence.libraryVerification, 'REQUIRES_BUILD_VERIFICATION');
  assert.deepEqual(report.assetEvidence.selectedKeys, [iconKey]);
  const missing = copy(proposal); missing.decisions = missing.decisions.filter(d => d.target !== 'asset:row:volume-row');
  await assert.rejects(validatePanelProposal(context, missing), { code: 'PLAN_COVERAGE' });
  const unknown = copy(proposal); unknown.spec.assets.rowIcons[0].asset = 'controls-test/missing@1.0.0';
  await assert.rejects(validatePanelProposal(context, unknown), { code: 'PLAN_ASSET_CANDIDATE' });
});

test('unresolved button behavior blocks proposal 0.3 compilation without fabricating defaults', async () => {
  const context = await createPlanningContext(request, catalog);
  const proposal = { proposalVersion: '0.3', contextSha256: context.sha256, spec: null, decisions: [],
    unresolved: [{ id: 'reset_scope', question: '恢复默认应该包含哪些设置？' }] };
  assert.equal((await checkPanelProposal(context, proposal)).status, 'NEEDS_INPUT');
  await assert.rejects(requireReadyProposal(context, proposal), { code: 'PLAN_NEEDS_INPUT' });
});

test('button add/remove patches use state:null and preserve every declared data field', async () => {
  const first = emitRow('apply-one'), second = emitRow('apply-two');
  const added = await patch(fixture, [
    { op: 'add-row', sectionId: 'preferences', afterRowId: 'reset-row', row: first, state: null },
    { op: 'add-row', sectionId: 'preferences', afterRowId: 'apply-one', row: second, state: null },
  ]);
  assert.deepEqual(added.spec.state, fixture.state);
  assert.deepEqual(added.receipt.changedRowIds, ['apply-one', 'apply-two']);
  const removed = await patch(added.spec, [{ op: 'remove-row', rowId: 'apply-one' }, { op: 'remove-row', rowId: 'apply-two' }]);
  assert.deepEqual(removed.spec, fixture);
  const relabeled = await patch(fixture, [{ op: 'set-row-label', rowId: 'reset-row', label: '初始设置' }]);
  assert.deepEqual(relabeled.receipt.changedRowIds, ['reset-row']);
});

test('button patches reject fake paired states and ordinary control additions still require a state object', async () => {
  await assert.rejects(patch(fixture, [{ op: 'add-row', sectionId: 'preferences', afterRowId: null,
    row: emitRow('apply'), state: { id: 'action', type: 'boolean', initial: false } }]), { code: 'button-state' });
  const row = copy(fixture.sections[0].rows[2]); row.id = 'another-quality'; row.bind = 'otherQuality'; row.event = 'graphics.otherQuality';
  await assert.rejects(patch(fixture, [{ op: 'add-row', sectionId: 'preferences', afterRowId: null, row, state: null }]), { code: 'object' });
  const state = copy(fixture.state[2]); state.id = 'otherQuality';
  const result = await patch(fixture, [{ op: 'add-row', sectionId: 'preferences', afterRowId: null, row, state }]);
  assert.deepEqual(result.spec.state.at(-1), state);
  assert.deepEqual(result.receipt.changedRowIds, ['another-quality']);
});

test('removing a reset target is rejected unless its dependent reset row is also explicitly removed', async () => {
  const before = copy(fixture);
  await assert.rejects(patch(fixture, [{ op: 'remove-row', rowId: 'quality-row' }]));
  assert.deepEqual(fixture, before);
  const removed = await patch(fixture, [{ op: 'remove-row', rowId: 'quality-row' }, { op: 'remove-row', rowId: 'reset-row' }]);
  assert.deepEqual(removed.spec.state.map(s => s.id), ['volume', 'muted']);
  assert.deepEqual(removed.receipt.changedRowIds, ['quality-row', 'reset-row']);
  const updated = await patch(fixture, [{ op: 'set-state-initial', fieldId: 'quality', value: 'medium' }]);
  assert.equal(updated.spec.state.find(s => s.id === 'quality').initial, 'medium');
  assert.deepEqual(updated.receipt.changedRowIds, ['quality-row']);
  await assert.rejects(patch(fixture, [{ op: 'set-state-initial', fieldId: 'quality', value: 'ultra' }]));
});
