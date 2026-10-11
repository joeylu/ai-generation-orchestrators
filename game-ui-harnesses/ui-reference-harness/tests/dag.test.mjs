import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.mjs';
import { main } from '../ui-reference.mjs';
import { digestJson, jsonBytes, local, readJson, seal, sha256 } from '../src/common.mjs';
import { setup, secondPanel, syntheticImage, accepted, panelFile, catalogFile } from './helpers.mjs';

const operation = () => ({ operationId: randomUUID() });
const prepare = (root, dag, id) => api.prepareProjectDagPanel(root, dag, id, operation()).panels.find(p => p.panelId === id).latest;
const authorize = (root, dag, id, turn) => api.authorizeProjectDagPanel(root, dag, id,
  { ...operation(), run: turn.run, planSha256: turn.planSha256, approval: 'Synthetic single-image approval; no real provider.' });
const review = (root, dag, id, turn, anchor = false) => api.actProjectDagPanel(root, dag, id, {
  ...operation(), run: turn.run, action: 'review', payload: { imageSha256: turn.imageSha256,
    layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Synthetic acceptance, not real art evidence.', useAsAnchor: anchor },
});
async function generated(root, dag, id, turn) {
  authorize(root, dag, id, turn);
  return (await api.generateProjectDagPanel(root, dag, id, { ...operation(), run: turn.run },
    { generate: async () => syntheticImage(384, 256) })).panels.find(p => p.panelId === id).latest;
}

test('project DAG freezes an acyclic anchor dependency, unlocks later panels and delivers actual accepted evidence', async t => {
  const { root, temp } = await setup(t); await secondPanel(root, temp);
  assert.equal(api.createProjectDag(root).primaryReference.sha256.length, 64);
  const created = await main(['dag-create', '--root', root, '--anchor-panel', 'audio-settings']);
  const { dag } = created;
  assert.equal(created.computeCalls, 0);
  assert.equal(fs.existsSync(local(root, 'runs')), false);
  assert.equal(created.nodes.find(n => n.id === 'panel/audio-settings/plan').status, 'ready');
  assert.equal(created.nodes.find(n => n.id === 'panel/audio-secondary/plan').status, 'ready');
  const snapshot = fs.readFileSync(local(root, dag));
  assert.throws(() => api.exportProjectDag(root, dag, operation()), /DELIVERY_NOT_READY/);
  let first = prepare(root, dag, 'audio-settings');
  assert.throws(() => api.authorizeProjectDagPanel(root, dag, 'audio-settings', { ...operation(), run: first.run,
    planSha256: created.dagSha256, approval: 'A DAG digest is not compute approval.' }), /AUTHORIZATION/);
  first = await generated(root, dag, 'audio-settings', first);
  assert.throws(() => review(root, dag, 'audio-settings', first, true), /PROJECT_ANCHOR_REMOVED/);
  const anchored = review(root, dag, 'audio-settings', first);
  assert.equal(anchored.anchor, null);
  const advanced = await main(['dag-advance', '--root', root, '--dag', dag, '--operation-id', randomUUID()]);
  const second = advanced.panels.find(p => p.panelId === 'audio-secondary').latest;
  assert.equal(api.verifyPlan(root, second.run).anchor, null);
  assert.equal(api.verifyPlan(root, second.run).request.images.find(image => image.role === 'primary-style').artifact.sha256, created.primaryReference.sha256);
  assert.equal(advanced.computeCalls, 1);
  const result = await generated(root, dag, 'audio-secondary', second);
  review(root, dag, 'audio-secondary', result);
  const exportOp = operation(), delivered = api.exportProjectDag(root, dag, exportOp);
  assert.equal(delivered.status, 'delivered'); assert.equal(delivered.output.status, 'valid');
  assert.deepEqual(delivered.output.panelIds, ['audio-secondary', 'audio-settings']);
  assert.equal(api.exportProjectDag(root, dag, exportOp).output.delivery, delivered.output.delivery);
  assert.equal(api.inspectProjectDag(root, dag).computeCalls, 2);
  assert.ok(fs.readFileSync(local(root, dag)).equals(snapshot));
  assert.equal(fs.existsSync(local(root, `${delivered.output.delivery}/references.zip`)), true);
});

test('same operation replay does not dispatch, including while generation is pending; a different operation cannot reserve it again', async t => {
  const { root } = await setup(t), { dag } = api.createProjectDag(root, { anchorPanelId: 'audio-settings' });
  const prepareOp = operation();
  const first = api.prepareProjectDagPanel(root, dag, 'audio-settings', prepareOp).panels[0].latest;
  assert.equal(api.prepareProjectDagPanel(root, dag, 'audio-settings', prepareOp).panels[0].latest.run, first.run);
  assert.throws(() => api.requestProjectDagPanel(root, dag, 'audio-settings', { ...prepareOp, run: first.run }), /OPERATION_CONFLICT/);
  authorize(root, dag, 'audio-settings', first);
  let release, calls = 0;
  const hold = new Promise(resolve => { release = resolve; });
  const adapter = { generate: async () => { calls++; await hold; return syntheticImage(384, 256); } };
  const generateOp = { ...operation(), run: first.run };
  const pending = api.generateProjectDagPanel(root, dag, 'audio-settings', generateOp, adapter);
  assert.equal(calls, 1);
  const replay = await api.generateProjectDagPanel(root, dag, 'audio-settings', generateOp, adapter);
  assert.equal(replay.panels[0].latest.status, 'reserved_no_resubmit');
  await assert.rejects(api.generateProjectDagPanel(root, dag, 'audio-settings', { ...operation(), run: first.run }, adapter), /NOT_AUTHORIZED/);
  assert.equal(calls, 1); release(); await pending;
  const done = await api.generateProjectDagPanel(root, dag, 'audio-settings', generateOp, adapter);
  assert.equal(done.computeCalls, 1); assert.equal(calls, 1);
  assert.equal(done.panels[0].latest.status, 'pending_visual_review');
});

test('host exchange and recovery retain a reservation; an unknown attempt needs an explicit new decision and fresh approval', async t => {
  const { root } = await setup(t), { dag } = api.createProjectDag(root, { anchorPanelId: 'audio-settings' });
  let turn = prepare(root, dag, 'audio-settings'); authorize(root, dag, 'audio-settings', turn);
  const requestOp = { ...operation(), run: turn.run }, request = api.requestProjectDagPanel(root, dag, 'audio-settings', requestOp);
  assert.ok(request.exchange);
  assert.equal(api.requestProjectDagPanel(root, dag, 'audio-settings', requestOp).exchange, null);
  assert.throws(() => api.requestProjectDagPanel(root, dag, 'audio-settings', { ...operation(), run: turn.run }), /NO_RESUBMIT/);
  const before = fs.readdirSync(local(root, 'runs'));
  const restarted = spawnSync(process.execPath, [fileURLToPath(new URL('../ui-reference.mjs', import.meta.url)),
    'dag-inspect', '--root', root, '--dag', dag], { encoding: 'utf8' });
  assert.equal(restarted.status, 0); assert.equal(JSON.parse(restarted.stdout).panels[0].latest.status, 'reserved_no_resubmit');
  await main(['dag-advance', '--root', root, '--dag', dag, '--operation-id', randomUUID()]);
  assert.deepEqual(fs.readdirSync(local(root, 'runs')), before);
  assert.throws(() => api.retryProjectDagPanel(root, dag, 'audio-settings', { ...operation(), sourceRun: turn.run, decision: 'Explicit retry.' }), /NOT_INITIAL_TERMINAL/);
  api.actProjectDagPanel(root, dag, 'audio-settings', { ...operation(), run: turn.run, action: 'stop',
    payload: { requestSha256: request.exchange.requestSha256, outcome: 'indeterminate' } });
  const old = turn.run;
  const retry = api.retryProjectDagPanel(root, dag, 'audio-settings', { ...operation(), sourceRun: old, decision: 'Synthetic explicit new attempt decision.' });
  turn = retry.panels[0].latest;
  assert.notEqual(turn.run, old); assert.equal(turn.status, 'awaiting_authorization');
  authorize(root, dag, 'audio-settings', turn);
  const req = api.requestProjectDagPanel(root, dag, 'audio-settings', { ...operation(), run: turn.run });
  const bytes = syntheticImage(384, 256), receiveOp = { ...operation(), run: turn.run, action: 'receive',
    payload: { requestSha256: req.exchange.requestSha256, rawSha256: sha256(bytes) } };
  assert.throws(() => api.actProjectDagPanel(root, dag, 'audio-settings', receiveOp, syntheticImage()), /BYTES_MISMATCH/);
  api.actProjectDagPanel(root, dag, 'audio-settings', receiveOp, bytes);
  assert.equal(api.actProjectDagPanel(root, dag, 'audio-settings', receiveOp, bytes).panels[0].latest.status, 'pending_visual_review');
  assert.equal(api.inspectRun(root, old).status, 'indeterminate');
  assert.equal(api.inspectProjectDag(root, dag).computeCalls, 2);
});

test('three persistent revisions count failed submissions and retain the last accepted image for Studio-compatible export', async t => {
  const { root } = await setup(t), { dag } = api.createProjectDag(root, { anchorPanelId: 'audio-settings' });
  const initial = await generated(root, dag, 'audio-settings', prepare(root, dag, 'audio-settings'));
  review(root, dag, 'audio-settings', initial);
  const originalOutput = api.exportProjectDag(root, dag, operation()).output.delivery;
  let source = initial, last;
  for (let round = 1; round <= 3; round++) {
    const revisionOp = { ...operation(), sourceRun: source.run, note: `Synthetic feedback ${round}.` };
    let state = api.reviseProjectDagPanel(root, dag, 'audio-settings', revisionOp);
    last = state.panels[0].latest;
    assert.equal(api.reviseProjectDagPanel(root, dag, 'audio-settings', revisionOp).panels[0].latest.run, last.run);
    assert.equal(last.round, round); assert.equal(state.panels[0].deliveryUsesOlderAccepted, true);
    assert.equal(api.exportProjectDag(root, dag, operation()).output.delivery, originalOutput);
    authorize(root, dag, 'audio-settings', last);
    if (round === 1) {
      await assert.rejects(api.generateProjectDagPanel(root, dag, 'audio-settings', { ...operation(), run: last.run },
        { generate: async () => { throw new Error('private endpoint and credential must never be logged'); } }), /INDETERMINATE/);
    } else {
      state = await api.generateProjectDagPanel(root, dag, 'audio-settings', { ...operation(), run: last.run },
        { generate: async () => syntheticImage(480, 320) });
      source = state.panels[0].latest;
    }
  }
  const final = api.inspectProjectDag(root, dag);
  assert.equal(final.panels[0].revisionsUsed, 3); assert.equal(final.panels[0].revisionsRemaining, 0);
  const recreated = api.createProjectDag(root);
  assert.equal(recreated.panels[0].latest.run, initial.run);
  assert.equal(recreated.panels[0].sessionKey, final.panels[0].sessionKey);
  assert.equal(recreated.panels[0].revisionsRemaining, 0);
  assert.throws(() => api.reviseProjectDagPanel(root, recreated.dag, 'audio-settings',
    { ...operation(), sourceRun: initial.run, note: 'Recreating a graph cannot reset the budget.' }), /REVISION_LIMIT/);
  assert.throws(() => api.reviseProjectDagPanel(root, dag, 'audio-settings', { ...operation(), sourceRun: source.run, note: 'Fourth' }), /REVISION_LIMIT/);
  const reviewed = review(root, dag, 'audio-settings', source);
  assert.equal(reviewed.anchor, null);
  const exported = api.exportProjectDag(root, dag, operation());
  assert.notEqual(exported.output.delivery, originalOutput);
  assert.equal(exported.output.status, 'valid'); assert.equal(exported.computeCalls, 4);
  const receipts = fs.readdirSync(local(root, dag.replace('/dag.json', '/operations'))).map(name => fs.readFileSync(local(root, dag.replace('/dag.json', `/operations/${name}`)), 'utf8')).join('');
  assert.equal(receipts.includes('private endpoint'), false);
});

test('after a verified anchor, independent panel branches can be dispatched concurrently without a project-wide provider lock', async t => {
  const { root, temp } = await setup(t); await secondPanel(root, temp);
  const third = readJson(panelFile); third.id = 'audio-third';
  fs.writeFileSync(`${temp}/third.json`, jsonBytes(third));
  await api.addPanel(root, { spec: `${temp}/third.json`, catalog: catalogFile });
  accepted(root, 'audio-settings');
  const { dag } = api.createProjectDag(root);
  const ready = api.advanceProjectDag(root, dag, operation());
  const turns = ready.panels.filter(panel => panel.panelId !== 'audio-settings');
  let release, calls = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const adapter = { generate: async () => { calls++; await barrier; return syntheticImage(384, 256); } };
  for (const panel of turns) authorize(root, dag, panel.panelId, panel.latest);
  const running = turns.map(panel => api.generateProjectDagPanel(root, dag, panel.panelId,
    { ...operation(), run: panel.latest.run }, adapter));
  assert.equal(calls, 2);
  const progress = api.inspectProjectDag(root, dag);
  assert.equal(progress.panels.filter(panel => panel.latest.status === 'reserved_no_resubmit').length, 2);
  release(); await Promise.all(running);
  assert.equal(api.inspectProjectDag(root, dag).panels.filter(panel => panel.latest.status === 'pending_visual_review').length, 2);
});

test('accepted CLI projects adopt verified results without generation; explicit subsets are disclosed and input changes block mutation', async t => {
  const { root, temp } = await setup(t); await secondPanel(root, temp);
  accepted(root, 'audio-settings'); accepted(root, 'audio-secondary');
  const { dag } = api.createProjectDag(root, { panelIds: ['audio-secondary'] });
  const before = fs.readdirSync(local(root, 'runs'));
  const advanced = api.advanceProjectDag(root, dag, operation());
  assert.equal(advanced.selection, 'explicit-subset'); assert.equal(advanced.computeCalls, 0);
  assert.equal(advanced.status, 'ready_for_delivery');
  const exported = api.exportProjectDag(root, dag, operation()); assert.deepEqual(exported.output.panelIds, ['audio-secondary']);
  assert.deepEqual(fs.readdirSync(local(root, 'runs')), before);
  const style = api.createStyle(root, { preset: 'concept-art' }); api.activateStyle(root, style.sha256, 'Synthetic new style decision.');
  assert.equal(api.inspectProjectDag(root, dag).currentContext, false);
  assert.throws(() => api.advanceProjectDag(root, dag, operation()), /CONTEXT_STALE/);
  assert.throws(() => api.exportProjectDag(root, dag, operation()), /CONTEXT_STALE/);
});

test('DAG snapshots reject resealed topology substitution, source substitution and unsafe paths', async t => {
  const { root, temp } = await setup(t); await secondPanel(root, temp);
  const { dag } = api.createProjectDag(root, { anchorPanelId: 'audio-settings' });
  const file = local(root, dag), original = readJson(file);
  for (const change of [v => { v.nodes[0].dependsOn = ['output']; }, v => { v.maximumRevisions = 99; },
    v => { v.panels[0].intent.panelId = 'missing'; }, v => { v.panels[0].prototype = v.panels[1].prototype; }]) {
    const value = structuredClone(original); delete value.sha256; change(value); fs.writeFileSync(file, jsonBytes(seal(value)));
    assert.throws(() => api.inspectProjectDag(root, dag));
  }
  fs.writeFileSync(file, jsonBytes(original));
  for (const bad of ['../project.json', '/project.json', 'dags/../dag.json']) assert.throws(() => api.inspectProjectDag(root, bad), /PATH_INVALID/);
  const spec = readJson(panelFile); spec.title = 'Changed prototype';
  const changed = `${temp}/changed.json`; fs.writeFileSync(changed, jsonBytes(spec));
  await api.addPanel(root, { spec: changed, catalog: catalogFile });
  assert.equal(api.inspectProjectDag(root, dag).status, 'stale');
  assert.throws(() => prepare(root, dag, 'audio-settings'), /CONTEXT_STALE/);
});
