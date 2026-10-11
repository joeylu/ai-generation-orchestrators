import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import * as api from '../src/index.mjs';
import { main } from '../ui-reference.mjs';
import { SAMPLE_INTAKE_RUNTIME_SHA256 } from '../src/compiler.mjs';
import { canonical, digestJson, jsonBytes, local, readJson, seal, withLock } from '../src/common.mjs';
import { verifyResult } from '../src/generation.mjs';
import { setup, accepted, secondPanel, syntheticImage, panelFile, catalogFile } from './helpers.mjs';

const runNames = root => fs.existsSync(local(root, 'runs')) ? fs.readdirSync(local(root, 'runs')).sort() : [];
async function threePanels(t) {
  const context = await setup(t); await secondPanel(context.root, context.temp);
  const spec = readJson(panelFile); spec.id = 'audio-third';
  const file = path.join(context.temp, 'third.json'); fs.writeFileSync(file, jsonBytes(spec));
  await api.addPanel(context.root, { spec: file, catalog: catalogFile });
  return context;
}

test('project planning uses confirmed primary reference without a panel acceptance prerequisite', async t => {
  const { root, temp } = await setup(t);
  const batch = api.createProjectPlans(root);
  assert.equal(batch.plans.length, 1); assert.equal(batch.computeCalls, 0);
  accepted(root);
  assert.equal(api.createProjectPlans(root).status, 'nothing_to_plan');
  await secondPanel(root, temp);
  assert.equal(api.createProjectPlans(root).plans[0].panelId, 'audio-secondary');
});

test('CLI freezes two pending panels with one style and anchor, retaining per-panel intents and no compute decisions', async t => {
  const { root, temp } = await threePanels(t);
  const primary = path.join(temp, 'primary.png'); fs.writeFileSync(primary, syntheticImage(160, 100));
  const style = api.createStyle(root, { preset: 'concept-art', reference: primary });
  api.activateStyle(root, style.sha256, 'Synthetic project-style approval.');
  const anchor = accepted(root, 'audio-settings');
  const intent = { kind: 'ui_reference_intent_v1', panelId: 'audio-third', note: 'Emphasize existing hierarchy.', emphasisIds: [] };
  const file = path.join(temp, 'intents.json'); fs.writeFileSync(file, jsonBytes([intent]));
  const batch = await main(['plan-project', '--root', root, '--intents', file, '--resolution', 'exact']);
  assert.equal(batch.kind, 'ui_reference_project_plans_v2'); assert.equal(batch.selection, 'pending');
  assert.equal(batch.computeCalls, 0); assert.equal(batch.maximumCalls, 2); assert.equal(batch.styleSha256, style.sha256);
  assert.deepEqual(batch.plans.map(plan => plan.panelId), ['audio-secondary', 'audio-third']);
  const report = fs.readFileSync(local(root, batch.review), 'utf8'); assert.ok(report.includes(batch.sha256));
  for (const item of batch.plans) {
    const plan = api.verifyPlan(root, item.run);
    assert.equal(plan.styleSha256, style.sha256); assert.equal(plan.anchor, null);
    assert.deepEqual(plan.request.images.map(image => image.role), ['layout-reference', 'primary-style']);
    assert.equal(plan.request.resolution.mode, 'exact'); assert.equal(digestJson(plan.request), item.requestSha256);
    assert.equal(report.includes(item.planSha256), true);
    assert.deepEqual(fs.readdirSync(local(root, item.run)), ['plan.json']);
    assert.throws(() => api.reserve(root, item.run));
  }
  assert.deepEqual(api.verifyPlan(root, batch.plans[1].run).intent, intent);
  const inspected = await main(['inspect-project-plans', '--root', root, '--batch', batch.batch]);
  assert.equal(inspected.currentContext, true); assert.equal(inspected.runtimeCurrent, true);
  assert.ok(inspected.runs.every(run => run.status === 'awaiting_authorization'));
  const first = batch.plans[0];
  assert.throws(() => api.authorize(root, first.run, batch.sha256, 'A batch digest is not a plan decision.'), /AUTHORIZATION/);
  api.authorize(root, first.run, first.planSha256, 'Synthetic one-panel decision.');
  api.reserve(root, first.run);
  assert.throws(() => api.reserve(root, first.run), /NO_RESUBMIT/);
  assert.deepEqual(api.inspectProjectPlans(root, batch.batch).runs.map(run => run.status), ['reserved_no_resubmit', 'awaiting_authorization']);
});

test('all selections and intents are checked before publishing any run, and planning honors the project lock', async t => {
  const { root } = await threePanels(t); accepted(root, 'audio-settings');
  const before = runNames(root), good = { kind: 'ui_reference_intent_v1', panelId: 'audio-third', note: '', emphasisIds: [] };
  const invalid = [
    { panelIds: [] }, { panelIds: ['missing'] }, { panelIds: ['audio-secondary', 'audio-secondary'] },
    { panelIds: ['audio-settings'] }, { panelIds: ['audio-secondary', '../escape'] },
    { intents: [good, good] }, { panelIds: ['audio-secondary'], intents: [good] },
    { intents: [{ ...good, style: {} }] }, { intents: [{ ...good, emphasisIds: ['missing'] }] },
    { intents: null }, { resolution: 'resize' },
  ];
  for (const options of invalid) {
    assert.throws(() => api.createProjectPlans(root, options));
    assert.deepEqual(runNames(root), before);
  }
  withLock(root, () => assert.throws(() => api.createProjectPlans(root), /PROJECT_BUSY/));
  assert.equal(fs.existsSync(local(root, 'project-plans')), false);
});

test('explicit subsets are disclosed, snapshots remain immutable, and style/prototype changes are reported as stale', async t => {
  const { root, temp } = await threePanels(t); accepted(root, 'audio-settings');
  const batch = await main(['plan-project', '--root', root, '--panels', 'audio-third']);
  assert.equal(batch.selection, 'explicit-subset'); assert.equal(batch.maximumCalls, 1);
  assert.equal(batch.plans[0].panelId, 'audio-third');
  const snapshot = fs.readFileSync(local(root, batch.batch));
  const spec = readJson(panelFile); spec.id = 'audio-third'; spec.title = 'Changed prototype';
  const file = path.join(temp, 'changed.json'); fs.writeFileSync(file, jsonBytes(spec));
  await api.addPanel(root, { spec: file, catalog: catalogFile });
  assert.equal(api.inspectProjectPlans(root, batch.batch).currentContext, false);
  assert.throws(() => api.authorize(root, batch.plans[0].run, batch.plans[0].planSha256, 'Stale prototype.'), /PROTOTYPE_STALE/);
  const changed = api.createStyle(root, { preset: 'chinese-fantasy' }); api.activateStyle(root, changed.sha256, 'Synthetic new style.');
  assert.equal(api.inspectProjectPlans(root, batch.batch).currentContext, false);
  assert.throws(() => api.createProjectPlans(root), /STYLE_PRIMARY_REFERENCE_REQUIRED/);
  assert.ok(fs.readFileSync(local(root, batch.batch)).equals(snapshot));
});

test('batch inspection rejects resealed substitutions and path traversal instead of trusting its own digest', async t => {
  const { root } = await threePanels(t); accepted(root, 'audio-settings');
  const batch = api.createProjectPlans(root), file = local(root, batch.batch), original = readJson(file);
  for (const edit of [
    value => { value.primaryReference.sha256 = '0'.repeat(64); },
    value => { value.plans[1].requestSha256 = value.plans[0].requestSha256; },
    value => { value.plans[1].run = value.plans[0].run; },
    value => { value.plans[0].maximumCalls = 0; },
    value => { value.computeCalls = 1; }, value => { value.runtimeSha256 = '0'.repeat(64); },
    value => { value.styleSha256 = '0'.repeat(64); }, value => { value.provider = 'private'; },
  ]) {
    const payload = structuredClone(original); delete payload.sha256; edit(payload); fs.writeFileSync(file, jsonBytes(seal(payload)));
    assert.throws(() => api.inspectProjectPlans(root, batch.batch), /BATCH|FIELDS|JSON_READ_FAILED/);
  }
  fs.writeFileSync(file, jsonBytes(original));
  for (const relative of ['../project.json', '/project.json', 'project-plans/../project.json']) {
    assert.throws(() => api.inspectProjectPlans(root, relative), /BATCH_PATH_INVALID/);
  }
  assert.equal(api.inspectProjectPlans(root, batch.batch).currentContext, true);
});

test('fully accepted projects are a zero-write no-op rather than an implicit regeneration', async t => {
  const { root, temp } = await setup(t); await secondPanel(root, temp);
  accepted(root, 'audio-settings'); accepted(root, 'audio-secondary');
  const before = runNames(root), project = fs.readFileSync(local(root, 'project.json'));
  const result = await main(['plan-project', '--root', root]);
  assert.equal(result.status, 'nothing_to_plan'); assert.equal(result.maximumCalls, 0); assert.deepEqual(result.plans, []);
  assert.deepEqual(runNames(root), before); assert.ok(fs.readFileSync(local(root, 'project.json')).equals(project));
  assert.equal(fs.existsSync(local(root, 'project-plans')), false);
});

test('known 0.5 results stay reviewable and supply an accepted anchor without reopening archived compute', async t => {
  const { root, temp } = await setup(t); await secondPanel(root, temp);
  const plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Synthetic original decision.');
  const request = api.reserve(root, plan.run), result = api.receive(root, plan.run, request.requestSha256, syntheticImage());
  const payload = readJson(local(root, `${plan.run}/plan.json`)); delete payload.sha256;
  payload.runtimeSha256 = SAMPLE_INTAKE_RUNTIME_SHA256;
  const archived = seal(payload); fs.writeFileSync(local(root, `${plan.run}/plan.json`), jsonBytes(archived));
  let authorizationSha256;
  for (const name of ['authorization', 'attempt', 'receipt', 'technical']) {
    const record = readJson(local(root, `${plan.run}/${name}.json`)); delete record.sha256; record.planSha256 = archived.sha256;
    if (name === 'attempt') record.authorizationSha256 = authorizationSha256;
    const rewritten = seal(record); if (name === 'authorization') authorizationSha256 = rewritten.sha256;
    fs.writeFileSync(local(root, `${plan.run}/${name}.json`), jsonBytes(rewritten));
  }
  assert.equal(api.inspectRun(root, plan.run).executable, false);
  assert.equal(verifyResult(root, plan.run).technical.imageSha256, result.imageSha256);
  assert.equal(canonical(api.verifyPlan(root, plan.run, { allowLegacy: true }).request), canonical(plan.request));
  assert.throws(() => api.authorize(root, plan.run, archived.sha256, 'Cannot reopen.'), /RUNTIME_CHANGED/);
  assert.throws(() => api.reserve(root, plan.run), /RUNTIME_CHANGED/);
  assert.throws(() => api.finish(root, plan.run, result.rawSha256), /RUNTIME_CHANGED/);
  api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass',
    decision: 'accept', note: 'Synthetic historical fixture decision.', useAsAnchor: false });
  const batch = api.createProjectPlans(root);
  assert.equal(batch.primaryReference.sha256, api.verifyPlan(root, plan.run, { allowLegacy: true }).request.images.find(item => item.role === 'primary-style').artifact.sha256); assert.equal(batch.maximumCalls, 1);
  const output = path.join(temp, 'archived-export'); api.exportProject(root, output, ['audio-settings']);
  assert.equal(api.validateDelivery(output).status, 'valid');
});
