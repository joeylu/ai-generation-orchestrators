import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as api from '../src/index.mjs';
import { main } from '../ui-reference.mjs';
import { compileLegacyRequest, LEGACY_RUNTIME_SHA256 } from '../src/compiler.mjs';
import { loadPrototype } from '../src/panel.mjs';
import { canonical, digestJson, jsonBytes, local, readJson, seal, sha256, writeJsonNew, writeNew } from '../src/common.mjs';
import { decodePng, canvas, encodePng } from '../src/png.mjs';
import { createStoredZip } from '../../ui-panel-harness/src/zip-store.mjs';
import { setup, syntheticImage, accepted } from './helpers.mjs';

function dispatch(root, plan, raw) {
  api.authorize(root, plan.run, plan.planSha256, 'Offline test compute decision.');
  const request = api.reserve(root, plan.run);
  return api.receive(root, plan.run, request.requestSha256, raw);
}
function exactRejection(root, raw = syntheticImage(1920, 1280)) {
  const plan = api.createPlan(root, { panelId: 'audio-settings', resolution: 'exact' });
  assert.throws(() => dispatch(root, plan, raw), /GENERATED_SIZE_MISMATCH/);
  return { plan, raw, rawSha256: sha256(raw) };
}
function accept(root, plan, result) {
  api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass',
    decision: 'accept', note: 'Synthetic fixture review only.', useAsAnchor: false });
}
function rewriteDelivery(output, changes) {
  for (const [name, change] of Object.entries(changes)) {
    const value = readJson(path.join(output, name)); change(value); fs.writeFileSync(path.join(output, name), jsonBytes(value));
  }
  const manifest = readJson(path.join(output, 'manifest.json'));
  const files = new Map(manifest.files.map(record => {
    const bytes = fs.readFileSync(path.join(output, record.path)); record.bytes = bytes.length; record.sha256 = sha256(bytes);
    return [record.path, bytes];
  }));
  fs.writeFileSync(path.join(output, 'manifest.json'), jsonBytes(manifest)); files.set('manifest.json', jsonBytes(manifest));
  fs.writeFileSync(path.join(output, 'references.zip'), createStoredZip(files));
}

test('native resolution is frozen before compute, preserves actual pixels and exports distinct logical/pixel canvases', async t => {
  const { root, temp } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  assert.equal(plan.request.resolution.mode, 'native'); assert.equal(plan.request.width, 960);
  assert.ok(plan.request.prompt.includes('logical coordinates')); assert.ok(!plan.request.prompt.includes('at the exact requested dimensions'));
  const raw = syntheticImage(1920, 1280), result = dispatch(root, plan, raw);
  assert.equal(result.status, 'pending_visual_review');
  assert.deepEqual(result.coordinateMapping.scale, { x: { numerator: 1920, denominator: 960 }, y: { numerator: 1280, denominator: 640 } });
  assert.ok(decodePng(fs.readFileSync(local(root, result.image))).rgba.equals(decodePng(raw).rgba));
  assert.throws(() => api.exportProject(root, path.join(temp, 'unreviewed')), /NOT_ACCEPTED/);
  accept(root, plan, result);
  const output = path.join(temp, 'native-delivery'); api.exportProject(root, output);
  const handoff = readJson(path.join(output, 'panels/audio-settings/handoff.json'));
  assert.equal(handoff.kind, 'ui_reference_handoff_v2');
  assert.deepEqual(handoff.canvas, { width: 1920, height: 1280 });
  assert.deepEqual(handoff.logicalCanvas, { width: 960, height: 640 });
  assert.equal(api.validateDelivery(output).status, 'valid');
  rewriteDelivery(output, {
    'panels/audio-settings/handoff.json': v => { v.coordinateMapping.scale.x.numerator = 1921; },
    'panels/audio-settings/provenance.json': v => { v.coordinateMapping.scale.x.numerator = 1921; },
  });
  assert.throws(() => api.validateDelivery(output), /COORDINATE_MAPPING/);
});

test('observed 704x656 / 1299x1211 mismatch maps rationally; aspect threshold and minimum pixel size are enforced', () => {
  const policy = api.resolutionPolicy('native');
  const mapping = api.coordinateMapping({ width: 704, height: 656 }, { width: 1299, height: 1211 }, policy);
  assert.deepEqual(mapping.scale.x, { numerator: 1299, denominator: 704 });
  assert.deepEqual(mapping.scale.y, { numerator: 1211, denominator: 656 });
  assert.throws(() => api.coordinateMapping({ width: 704, height: 656 }, { width: 1299, height: 1211 }, api.resolutionPolicy('exact')), /SIZE_MISMATCH/);
  api.coordinateMapping({ width: 960, height: 640 }, { width: 2424, height: 1600 }, policy); // exactly +1%
  assert.throws(() => api.coordinateMapping({ width: 960, height: 640 }, { width: 2425, height: 1600 }, policy), /ASPECT_RATIO/);
  assert.throws(() => api.coordinateMapping({ width: 960, height: 640 }, { width: 240, height: 160 }, policy), /RESOLUTION_BOUNDS/);
  api.coordinateMapping({ width: 960, height: 640 }, { width: 480, height: 320 }, policy);
});

test('native mode rejects wrong aspect ratios and cannot be changed by rehashing a frozen plan', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  assert.throws(() => dispatch(root, plan, syntheticImage(1024, 1024)), /ASPECT_RATIO_MISMATCH/);
  assert.equal(api.inspectRun(root, plan.run).status, 'rejected_technical');
  const another = api.createPlan(root, { panelId: 'audio-settings' });
  const edited = readJson(local(root, `${another.run}/plan.json`)); delete edited.sha256;
  edited.request.resolution.maxAspectRatioErrorBps = 10000;
  fs.writeFileSync(local(root, `${another.run}/plan.json`), jsonBytes(seal(edited)));
  assert.throws(() => api.verifyPlan(root, another.run), /RESOLUTION_POLICY/);
  assert.throws(() => api.createPlan(root, { panelId: 'audio-settings', resolution: 'anything' }), /RESOLUTION_MODE/);
});

test('a new zero-call reprocess plan reuses only a verified size rejection and leaves its failed source immutable', async t => {
  const { root, temp } = await setup(t), source = exactRejection(root);
  const directory = local(root, source.plan.run), before = new Map(fs.readdirSync(directory).map(n => [n, fs.readFileSync(path.join(directory, n))]));
  const plan = await main(['reprocess-plan', '--root', root, '--source-run', source.plan.run, '--raw-sha256', source.rawSha256]);
  assert.equal(plan.maximumCalls, 0); assert.equal(api.inspectRun(root, plan.run).status, 'ready_for_reprocess');
  assert.throws(() => api.authorize(root, plan.run, plan.planSha256, 'Not a compute request.'), /NO_COMPUTE/);
  assert.throws(() => api.reserve(root, plan.run), /NO_PROVIDER/);
  let calls = 0;
  await assert.rejects(api.generateWithAdapter(root, plan.run, { generate: async () => { calls++; return source.raw; } }), /NO_PROVIDER/);
  assert.equal(calls, 0);
  assert.throws(() => api.reprocessRaw(root, plan.run, '0'.repeat(64)), /REPROCESS_PLAN/);
  const result = await main(['reprocess', '--root', root, '--run', plan.run, '--plan-sha256', plan.planSha256]);
  assert.equal(result.maximumCalls, 0); assert.equal(result.rawSha256, source.rawSha256);
  assert.equal(result.status, 'pending_visual_review');
  assert.equal(api.reprocessRaw(root, plan.run, plan.planSha256).imageSha256, result.imageSha256);
  assert.ok(fs.readFileSync(local(root, `${plan.run}/raw.png`)).equals(source.raw));
  assert.ok(!fs.existsSync(local(root, `${plan.run}/authorization.json`)));
  assert.equal(api.inspectRun(root, source.plan.run).status, 'rejected_technical');
  for (const [name, bytes] of before) assert.ok(fs.readFileSync(path.join(directory, name)).equals(bytes));
  assert.deepEqual(fs.readdirSync(directory).sort(), [...before.keys()].sort());
  accept(root, plan, result);
  assert.equal(api.reprocessRaw(root, plan.run, plan.planSha256).status, 'accepted');
  const output = path.join(temp, 'reused-delivery'); api.exportProject(root, output);
  const provenance = readJson(path.join(output, 'panels/audio-settings/provenance.json'));
  assert.deepEqual(provenance.rawSource, { planSha256: source.plan.planSha256, requestSha256: digestJson(source.plan.request), rawSha256: source.rawSha256 });
  assert.ok(!canonical(provenance).includes(source.plan.run));
  assert.equal(api.validateDelivery(output).status, 'valid');
});

test('reprocess rejects corrupt source bytes, style changes, blank/transparent output and wrong aspect ratio', async t => {
  const { root } = await setup(t), source = exactRejection(root);
  assert.throws(() => api.createReprocessPlan(root, { sourceRun: source.plan.run, rawSha256: '0'.repeat(64) }), /RAW_SOURCE/);
  const changed = api.createStyle(root, { preset: 'neon-tech' }); api.activateStyle(root, changed.sha256, 'Synthetic style decision.');
  assert.throws(() => api.createReprocessPlan(root, { sourceRun: source.plan.run, rawSha256: source.rawSha256 }), /CONTEXT_MISMATCH/);
  for (const raw of [encodePng(canvas(1920, 1280)), syntheticImage(1024, 1024), (() => {
    const image = decodePng(syntheticImage(1920, 1280)); image.rgba[3] = 128; return encodePng(image);
  })()]) {
    const failed = exactRejection(root, raw);
    assert.throws(() => api.createReprocessPlan(root, { sourceRun: failed.plan.run, rawSha256: failed.rawSha256 }));
  }
  fs.appendFileSync(local(root, `${source.plan.run}/raw.png`), 'corrupted');
  assert.throws(() => api.createReprocessPlan(root, { sourceRun: source.plan.run, rawSha256: source.rawSha256 }), /DIGEST/);
});

test('raw reuse keeps its original conditioning, even when a project anchor was accepted later', async t => {
  const { root } = await setup(t), source = exactRejection(root);
  const anchor = accepted(root, 'audio-settings');
  const reused = api.createReprocessPlan(root, { sourceRun: source.plan.run, rawSha256: source.rawSha256 });
  assert.equal(api.verifyPlan(root, reused.run).anchor, null);
  assert.ok(!reused.request.images.some(i => i.role === 'accepted-project-anchor'));
  const next = api.createPlan(root, { panelId: 'audio-settings' });
  assert.equal(api.verifyPlan(root, next.run).anchor, null);
});

test('interrupted local reuse resumes the same source; a self-referential source is rejected without recursion', async t => {
  const { root } = await setup(t), source = exactRejection(root);
  const plan = api.createReprocessPlan(root, { sourceRun: source.plan.run, rawSha256: source.rawSha256 });
  writeJsonNew(root, `${plan.run}/attempt.json`, seal({ kind: 'ui_reference_reprocess_attempt_v1', planSha256: plan.planSha256,
    requestSha256: digestJson(plan.request), rawSha256: source.rawSha256, maximumCalls: 0, state: 'reserved' }));
  assert.equal(api.reprocessRaw(root, plan.run, plan.planSha256).rawSha256, source.rawSha256);
  const another = api.createReprocessPlan(root, { sourceRun: source.plan.run, rawSha256: source.rawSha256 });
  const edited = readJson(local(root, `${another.run}/plan.json`)); delete edited.sha256; edited.rawSource.run = another.run;
  fs.writeFileSync(local(root, `${another.run}/plan.json`), jsonBytes(seal(edited)));
  assert.throws(() => api.verifyPlan(root, another.run), /REUSE_CHAIN_FORBIDDEN/);
});

test('known 0.1.0 terminal fixtures are read-only but their verified raw bytes can enter a new native reprocess plan', async t => {
  const { root } = await setup(t), template = api.createPlan(root, { panelId: 'audio-settings', resolution: 'exact' });
  const original = api.verifyPlan(root, template.run), prototype = loadPrototype(root, original.prototype), style = api.loadStyle(root, original.styleSha256);
  const { rawSource, correction, ...payload } = original; delete payload.sha256;
  payload.kind = 'ui_reference_plan_v1'; payload.runtimeSha256 = LEGACY_RUNTIME_SHA256; payload.nonce = randomUUID();
  payload.request = compileLegacyRequest(prototype, style, null, payload.intent);
  const plan = seal(payload), run = `runs/${plan.nonce}`, raw = syntheticImage(1920, 1280), rawSha256 = sha256(raw), requestSha256 = digestJson(plan.request);
  // Synthetic historical records, authored only within this offline fixture.
  const authorization = seal({ kind: 'ui_reference_authorization_v1', planSha256: plan.sha256, nonce: randomUUID(), maximumCalls: 1, approval: 'Historical test double.' });
  writeJsonNew(root, `${run}/plan.json`, plan); writeJsonNew(root, `${run}/authorization.json`, authorization);
  writeJsonNew(root, `${run}/attempt.json`, seal({ kind: 'ui_reference_attempt_v1', planSha256: plan.sha256, authorizationSha256: authorization.sha256, requestSha256, state: 'reserved' }));
  writeJsonNew(root, `${run}/request.json`, plan.request); writeNew(root, `${run}/raw.png`, raw);
  writeJsonNew(root, `${run}/receipt.json`, seal({ kind: 'ui_reference_receipt_v1', planSha256: plan.sha256, requestSha256, rawSha256 }));
  writeJsonNew(root, `${run}/terminal.json`, seal({ kind: 'ui_reference_terminal_v1', planSha256: plan.sha256, outcome: 'rejected_technical', resubmitAllowed: false }));
  assert.equal(api.inspectRun(root, run).status, 'rejected_technical');
  assert.throws(() => api.reserve(root, run), /RUNTIME_CHANGED/);
  assert.throws(() => api.finish(root, run, rawSha256), /RUNTIME_CHANGED/);
  const reused = api.createReprocessPlan(root, { sourceRun: run, rawSha256 });
  assert.equal(api.reprocessRaw(root, reused.run, reused.planSha256).rawSha256, rawSha256);
  const edited = { ...plan, runtimeSha256: '0'.repeat(64) }; delete edited.sha256;
  fs.writeFileSync(local(root, `${run}/plan.json`), jsonBytes(seal(edited)));
  assert.throws(() => api.inspectRun(root, run), /RUNTIME_CHANGED/);
});
