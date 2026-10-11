import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.mjs';
import { main } from '../ui-reference.mjs';
import { compileArchivedRequest, compileRequest, STYLE_CATALOG_RUNTIME_SHA256, visibleNodes } from '../src/compiler.mjs';
import { canonical, digestJson, jsonBytes, local, readJson, seal, sha256 } from '../src/common.mjs';
import { loadPrototype } from '../src/panel.mjs';
import { verifyResult } from '../src/generation.mjs';
import { setup, syntheticImage } from './helpers.mjs';

const showcase = fileURLToPath(new URL('../examples/style-showcase.panel.json', import.meta.url));
const catalog = fileURLToPath(new URL('../../ui-panel-harness/examples/modern-controls.catalog.json', import.meta.url));
const prototypeData = nodes => ({ panelId: 'settings', title: 'Settings', canvas: { width: 960, height: 800 }, nodes,
  layout: { path: `blobs/${'1'.repeat(64)}.png`, sha256: '1'.repeat(64), bytes: 10 }, screenshot: null,
  textPolicy: 'preserve-visible-copy', view: 'saved-state-selected-tab-scroll-origin' });
const select = (selectedId = 'quality-b') => ({ id: 'quality', type: 'Select', box: [348, 476, 440, 40], visibleBox: [348, 476, 440, 40],
  content: { selectedId, options: [{ id: 'quality-a', label: '流畅' }, { id: 'quality-b', label: '高清' }, { id: 'quality-c', label: '超清' }] } });

async function sourceFixture(t) {
  const context = await setup(t);
  const style = api.createStyle(context.root, { preset: 'concept-art' });
  api.activateStyle(context.root, style.sha256, 'Synthetic fixture approval.');
  await api.addPanel(context.root, { spec: showcase, catalog });
  const plan = api.createPlan(context.root, { panelId: 'style-showcase' });
  api.authorize(context.root, plan.run, plan.planSha256, 'Synthetic first call approval.');
  const request = api.reserve(context.root, plan.run);
  const result = api.receive(context.root, plan.run, request.requestSha256, syntheticImage(960, 800));
  return { ...context, style, plan, result };
}

test('closed Select exposes only its selected label, never its hidden option set; other control types retain their semantics', () => {
  const input = prototypeData([select(), { id: 'modes', type: 'RadioGroup', box: [0, 0, 10, 10], visibleBox: [0, 0, 10, 10],
    content: { selectedId: 'one', options: [{ id: 'one', label: 'Radio one' }, { id: 'two', label: 'Radio two' }] } }]);
  const original = canonical(input), projected = visibleNodes(input);
  assert.equal(projected[0].content.selectedLabel, '高清');
  assert.deepEqual(projected[0].presentation, { kind: 'dropdown', popup: 'closed', visibleOptionCount: 1, indicator: 'down-chevron' });
  assert.equal(Object.hasOwn(projected[0].content, 'options'), false);
  assert.equal(Object.hasOwn(projected[0].content, 'selectedId'), false);
  assert.deepEqual(projected[1], input.nodes[1]); assert.equal(canonical(input), original);
  const request = compileRequest(input, { rules: {}, notes: '', sha256: '2'.repeat(64), references: [] }, null,
    { kind: 'ui_reference_intent_v1', panelId: 'settings', note: '', emphasisIds: [] }, api.resolutionPolicy());
  assert.ok(request.prompt.includes('高清')); assert.ok(!request.prompt.includes('流畅')); assert.ok(!request.prompt.includes('超清'));
  assert.ok(request.prompt.includes('one CLOSED dropdown field')); assert.ok(request.prompt.includes('side-by-side choices'));
  assert.ok(request.prompt.includes('Radio two'));
  assert.equal(visibleNodes(prototypeData([select('quality-c')]))[0].content.selectedLabel, '超清');
  assert.throws(() => visibleNodes(prototypeData([select('missing')])), /SELECT_SELECTION/);
  const duplicate = select(); duplicate.content.options.push(duplicate.content.options[0]);
  assert.throws(() => visibleNodes(prototypeData([duplicate])), /SELECT_OPTIONS/);
});

test('scoped correction snapshots a verified unaccepted image, preserves old files and requires a fresh single-use compute decision', async t => {
  const { root, temp, plan: parent, result } = await sourceFixture(t);
  const directory = local(root, parent.run), before = new Map(fs.readdirSync(directory).map(name => [name, fs.readFileSync(path.join(directory, name))]));
  const plan = await main(['correct-select-plan', '--root', root, '--source-run', parent.run, '--note', 'Only repair the closed dropdown.']);
  const frozen = api.verifyPlan(root, plan.run);
  assert.equal(frozen.kind, 'ui_reference_plan_v3'); assert.equal(frozen.parentPlanSha256, parent.planSha256);
  assert.equal(frozen.correction.image.sha256, result.imageSha256); assert.equal(frozen.anchor, null);
  assert.deepEqual(plan.request.images.map(image => image.role), ['correction-source', 'layout-reference']);
  assert.equal(sha256(fs.readFileSync(local(root, plan.request.images[0].artifact.path))), result.imageSha256);
  assert.ok(plan.request.prompt.includes('Do not redesign')); assert.ok(!plan.request.prompt.includes('流畅'));
  assert.equal(api.inspectRun(root, plan.run).status, 'awaiting_authorization');
  assert.throws(() => api.reserve(root, plan.run));
  assert.throws(() => api.authorize(root, plan.run, parent.planSha256, 'Old approval cannot be reused.'), /AUTHORIZATION/);
  let calls = 0;
  api.authorize(root, plan.run, plan.planSha256, 'Synthetic new correction approval.');
  const corrected = await api.generateWithAdapter(root, plan.run, { generate: async request => {
    calls++; assert.equal(request.images[0].role, 'correction-source'); assert.equal(sha256(request.images[0].bytes), result.imageSha256);
    return syntheticImage(960, 800);
  } });
  assert.equal(calls, 1); assert.equal(corrected.status, 'pending_visual_review');
  await assert.rejects(api.generateWithAdapter(root, plan.run, { generate: async () => { calls++; } }), /NO_RESUBMIT/);
  assert.equal(calls, 1);
  for (const [name, bytes] of before) assert.ok(fs.readFileSync(path.join(directory, name)).equals(bytes));
  assert.equal(fs.readdirSync(directory).length, before.size);
  assert.throws(() => api.createSelectCorrectionPlan(root, { sourceRun: plan.run }), /CORRECTION_CHAIN/);
  api.reviewRun(root, plan.run, { imageSha256: corrected.imageSha256, layout: 'pass', style: 'pass', copy: 'pass',
    decision: 'accept', note: 'Synthetic correction acceptance only.' });
  const output = path.join(temp, 'corrected-delivery'); api.exportProject(root, output, ['style-showcase']);
  assert.equal(api.validateDelivery(output).status, 'valid');
  const provenance = readJson(path.join(output, 'panels/style-showcase/provenance.json'));
  assert.equal(provenance.correction.image.sha256, result.imageSha256);
  assert.ok(fs.readFileSync(path.join(output, provenance.correction.image.path)).equals(fs.readFileSync(local(root, `${parent.run}/reference.png`))));
  assert.equal(Object.hasOwn(provenance.correction, 'run'), false); assert.equal(provenance.anchorSha256, null);
});

test('correction rejects non-Select targets, mismatched source context, rehashed tampering and recursive sources', async t => {
  const { root, plan: parent } = await sourceFixture(t);
  const prototype = loadPrototype(root, api.verifyPlan(root, parent.run).prototype);
  const nonSelect = prototype.nodes.find(node => node.type !== 'Select').id;
  for (const targetIds of [[], ['missing'], [nonSelect], ['missing', 'missing']]) {
    assert.throws(() => api.createSelectCorrectionPlan(root, { sourceRun: parent.run, targetIds }), /CORRECTION_TARGET/);
  }
  const plan = api.createSelectCorrectionPlan(root, { sourceRun: parent.run });
  const file = local(root, `${plan.run}/plan.json`), original = readJson(file);
  for (const change of [v => { v.correction.targetIds = [nonSelect]; }, v => { v.correction.image.sha256 = '0'.repeat(64); },
    v => { v.correction.run = plan.run; }, v => { v.parentPlanSha256 = '0'.repeat(64); }]) {
    const edited = structuredClone(original); delete edited.sha256; change(edited); fs.writeFileSync(file, jsonBytes(seal(edited)));
    assert.throws(() => api.verifyPlan(root, plan.run), /CORRECTION|BLOB/);
  }
  fs.writeFileSync(file, jsonBytes(original));
  const changed = api.createStyle(root, { preset: 'chinese-fantasy' }); api.activateStyle(root, changed.sha256, 'Synthetic changed style.');
  assert.throws(() => api.createSelectCorrectionPlan(root, { sourceRun: parent.run }), /CORRECTION_SOURCE/);
  assert.throws(() => api.authorize(root, plan.run, plan.planSha256, 'Stale correction.'), /STYLE_STALE/);
});

test('known 0.3 style-pack output reconstructs its historical prompt and remains a read-only correction source', async t => {
  const { root, plan: parent, style, result } = await sourceFixture(t);
  const payload = readJson(local(root, `${parent.run}/plan.json`)); delete payload.sha256; delete payload.correction;
  payload.kind = 'ui_reference_plan_v2'; payload.runtimeSha256 = STYLE_CATALOG_RUNTIME_SHA256;
  payload.request = compileArchivedRequest(loadPrototype(root, payload.prototype), style, payload.anchor, payload.intent, payload.request.resolution);
  assert.ok(payload.request.prompt.includes('流畅')); // Reproduces the original hidden-option ambiguity.
  const archived = seal(payload), requestSha256 = digestJson(archived.request);
  fs.writeFileSync(local(root, `${parent.run}/plan.json`), jsonBytes(archived));
  fs.writeFileSync(local(root, `${parent.run}/request.json`), jsonBytes(archived.request));
  let authorizationSha256;
  for (const name of ['authorization', 'attempt', 'receipt', 'technical']) {
    const record = readJson(local(root, `${parent.run}/${name}.json`)); delete record.sha256; record.planSha256 = archived.sha256;
    if (name === 'attempt') record.authorizationSha256 = authorizationSha256;
    if (['attempt', 'receipt'].includes(name)) record.requestSha256 = requestSha256;
    const sealed = seal(record); if (name === 'authorization') authorizationSha256 = sealed.sha256;
    fs.writeFileSync(local(root, `${parent.run}/${name}.json`), jsonBytes(sealed));
  }
  assert.equal(api.inspectRun(root, parent.run).executable, false);
  assert.equal(verifyResult(root, parent.run).technical.imageSha256, result.imageSha256);
  assert.throws(() => api.authorize(root, parent.run, archived.sha256, 'No archived compute.'), /RUNTIME_CHANGED/);
  const correction = api.createSelectCorrectionPlan(root, { sourceRun: parent.run });
  assert.equal(api.verifyPlan(root, correction.run).parentPlanSha256, archived.sha256);
  assert.ok(!correction.request.prompt.includes('流畅'));
  api.reviewRun(root, parent.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass',
    decision: 'accept', note: 'Offline historical fixture review.', useAsAnchor: true });
  assert.equal(api.projectStatus(root).panels.find(p => p.panelId === 'style-showcase').status, 'accepted_current_style');
});
