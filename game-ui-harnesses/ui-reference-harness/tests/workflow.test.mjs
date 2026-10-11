import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { createStoredZip } from '../../ui-panel-harness/src/zip-store.mjs';
import * as api from '../src/index.mjs';
import { canonical, digestJson, jsonBytes, local, readJson, seal, sha256 } from '../src/common.mjs';
import { decodePng } from '../src/png.mjs';
import { setup, accepted, secondPanel, syntheticImage, panelFile, catalogFile } from './helpers.mjs';

test('two panels inherit one project style, accept independently and export a deterministic portable set', async t => {
  const { root, temp, style } = await setup(t); await secondPanel(root, temp);
  const first = accepted(root, 'audio-settings'), second = accepted(root, 'audio-secondary');
  assert.equal(first.plan.styleSha256, style.sha256); assert.equal(second.plan.styleSha256, style.sha256);
  const frozen = api.verifyPlan(root, second.plan.run);
  assert.equal(frozen.anchor, null);
  assert.ok(!frozen.request.images.some(item => item.role === 'accepted-project-anchor'));
  assert.equal(frozen.request.images.find(item => item.role === 'primary-style').artifact.sha256, style.references[0].artifact.sha256);
  assert.deepEqual(api.projectStatus(root).panels.map(p => p.status), ['accepted_current_style', 'accepted_current_style']);
  const a = path.join(temp, 'export-a'), b = path.join(temp, 'export-b');
  const left = api.exportProject(root, a), right = api.exportProject(root, b);
  assert.equal(left.zipSha256, right.zipSha256); assert.equal(api.validateDelivery(a).panelCount, 2);
  const allPublicText = fs.readFileSync(path.join(a, 'panels/audio-settings/provenance.json'), 'utf8');
  assert.ok(!allPublicText.includes(root)); assert.ok(!allPublicText.includes('authorization'));
  assert.equal(readJson(path.join(a, 'panels/audio-settings/handoff.json')).target, 'ui-layer-harness');
});

test('project style revision preserves history and prevents exporting a mixed set until each selected panel is updated', async t => {
  const { root, temp, style } = await setup(t); await secondPanel(root, temp);
  const old = accepted(root); accepted(root, 'audio-secondary');
  const next = api.createStyle(root, { preset: 'neon-tech' });
  assert.equal(api.projectStatus(root).activeStyle, style.sha256); // drafts do not activate themselves
  api.activateStyle(root, next.sha256, 'Test style revision approval.');
  assert.equal(api.projectStatus(root).panels[0].status, 'needs_style_update');
  assert.equal(api.inspectRun(root, old.plan.run).status, 'accepted');
  assert.throws(() => api.exportProject(root, path.join(temp, 'mixed')), /MIXED_STYLE/);
  accepted(root);
  assert.throws(() => api.exportProject(root, path.join(temp, 'still-mixed')), /MIXED_STYLE/);
  assert.equal(api.exportProject(root, path.join(temp, 'subset'), ['audio-settings']).panelIds.length, 1);
  accepted(root, 'audio-secondary');
  assert.equal(api.exportProject(root, path.join(temp, 'new-set')).styleSha256, next.sha256);
});

test('user style image is snapshotted and reference-only styles work without invented semantic analysis', async t => {
  const { root, temp } = await setup(t);
  const file = path.join(temp, 'user-style.png'); fs.writeFileSync(file, syntheticImage(160, 100));
  const style = api.createStyle(root, { reference: file, notes: 'Use this visual language.' });
  assert.equal(style.rules.palette, null); assert.equal(style.source.kind, 'reference');
  fs.writeFileSync(file, 'changed after import');
  api.activateStyle(root, style.sha256, 'Test reviewed image approval.');
  const plan = api.createPlan(root, { panelId: 'audio-settings' });
  assert.equal(plan.request.images[1].artifact.sha256, style.references[0].artifact.sha256);
  assert.equal(api.verifyPlan(root, plan.run).styleSha256, style.sha256);
});

test('preset plus user image has explicit precedence and unknown style-rule fields are rejected', async t => {
  const { root, temp } = await setup(t), file = path.join(temp, 'style.png'); fs.writeFileSync(file, syntheticImage(40, 40));
  const style = api.createStyle(root, { preset: 'painted-fantasy', reference: file });
  assert.deepEqual(style.references.map(r => r.role), ['primary-style', 'preset-palette-guide']);
  assert.throws(() => api.createStyle(root, { preset: 'casual-clean', rules: { ...style.rules, provider: 'private' } }), /FIELDS/);
});

test('plan requires a reviewed project style and freezes optional panel intent without global style overrides', async t => {
  const { root, style } = await setup(t, { activate: false });
  assert.throws(() => api.createPlan(root, { panelId: 'audio-settings' }), /STYLE_REQUIRED/);
  api.activateStyle(root, style.sha256, 'Test activation.');
  const plan = api.createPlan(root, { panelId: 'audio-settings' });
  assert.equal(api.verifyPlan(root, plan.run).intent.note, '');
  assert.throws(() => api.createPlan(root, { panelId: 'audio-settings', intent: { kind: 'ui_reference_intent_v1', panelId: 'audio-settings', note: '', emphasisIds: [], style: {} } }), /FIELDS/);
  assert.throws(() => api.createPlan(root, { panelId: 'audio-settings', intent: { kind: 'ui_reference_intent_v1', panelId: 'audio-settings', note: '', emphasisIds: ['missing'] } }), /TARGET/);
});

test('generation waits for exact single-use authorization and cannot dispatch twice', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  assert.equal(api.inspectRun(root, plan.run).status, 'awaiting_authorization');
  assert.throws(() => api.reserve(root, plan.run));
  assert.throws(() => api.authorize(root, plan.run, '0'.repeat(64), 'Test approval.'), /AUTHORIZATION/);
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.');
  assert.throws(() => api.authorize(root, plan.run, plan.planSha256, 'Duplicate approval.'));
  api.reserve(root, plan.run);
  assert.throws(() => api.reserve(root, plan.run), /NO_RESUBMIT/);
  assert.throws(() => api.authorize(root, plan.run, plan.planSha256, 'Reauthorization.'), /AUTHORIZATION/);
});

test('adapter failure after reservation is indeterminate and never retried, even by a second invocation', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.');
  let calls = 0;
  const adapter = { generate: async () => { calls++; throw new Error('private endpoint and credential must not surface'); } };
  await assert.rejects(api.generateWithAdapter(root, plan.run, adapter), /ADAPTER_INDETERMINATE_NO_RESUBMIT/);
  await assert.rejects(api.generateWithAdapter(root, plan.run, adapter), /NO_RESUBMIT/);
  assert.equal(calls, 1); assert.equal(api.inspectRun(root, plan.run).status, 'indeterminate');
  assert.throws(() => api.receive(root, plan.run, digestJson(plan.request), syntheticImage()), /NOT_PENDING/);
});

test('adapter receives immutable ordered input bytes and one provider-neutral request', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings', note: 'Emphasize existing audio control.' });
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.');
  let calls = 0;
  const result = await api.generateWithAdapter(root, plan.run, { generate: async request => {
    calls++; assert.deepEqual(request.images.map(item => item.role), ['layout-reference', 'primary-style']);
    for (const image of request.images) assert.equal(sha256(image.bytes), image.sha256);
    assert.equal(request.width, 960); assert.equal(request.resolution.mode, 'native'); assert.ok(request.prompt.includes('Emphasize existing audio control.'));
    return syntheticImage();
  } });
  assert.equal(calls, 1); assert.equal(result.status, 'pending_visual_review');
});

test('style or prototype changes invalidate pending authorization and new dispatch', async t => {
  const { root, temp } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.');
  const style = api.createStyle(root, { preset: 'painted-fantasy' }); api.activateStyle(root, style.sha256, 'Test approval.');
  assert.throws(() => api.reserve(root, plan.run), /STYLE_STALE/);
  const fresh = api.createPlan(root, { panelId: 'audio-settings' });
  const spec = readJson(panelFile); spec.title = '修改后的设置';
  const file = path.join(temp, 'revision.json'); fs.writeFileSync(file, JSON.stringify(spec));
  await api.addPanel(root, { spec: file, catalog: catalogFile });
  assert.throws(() => api.authorize(root, fresh.run, fresh.planSha256, 'Test approval.'), /PROTOTYPE_STALE/);
});

test('technical success cannot substitute for human layout, style and copy acceptance', async t => {
  const { root, temp } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.'); const request = api.reserve(root, plan.run);
  const result = api.receive(root, plan.run, request.requestSha256, syntheticImage());
  assert.throws(() => api.exportProject(root, path.join(temp, 'unreviewed')), /NOT_ACCEPTED/);
  assert.throws(() => api.reviewRun(root, plan.run, { imageSha256: '0'.repeat(64), layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Test.' }), /IMAGE_MISMATCH/);
  assert.throws(() => api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'fail', copy: 'pass', decision: 'accept', note: 'Test.' }), /REVIEW_FAILED/);
  api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'fail', copy: 'pass', decision: 'reject', note: 'Synthetic style failure.' });
  assert.equal(api.inspectRun(root, plan.run).status, 'rejected_visual');
  assert.throws(() => api.exportProject(root, path.join(temp, 'rejected')), /NOT_ACCEPTED/);
});

test('deterministic finishing reuses exact raw source and optimization creates a fresh unapproved plan', async t => {
  const { root } = await setup(t), { plan, result } = accepted(root);
  assert.equal(api.finish(root, plan.run, result.rawSha256).imageSha256, result.imageSha256);
  assert.equal(api.inspectRun(root, plan.run).status, 'accepted');
  assert.throws(() => api.finish(root, plan.run, '0'.repeat(64)), /RAW_DIGEST/);
  const optimized = api.createPlan(root, { panelId: 'audio-settings', parentRun: plan.run, note: 'Improve the existing button emphasis within the fixed style.' });
  assert.notEqual(optimized.planSha256, plan.planSha256);
  assert.equal(api.verifyPlan(root, optimized.run).parentPlanSha256, plan.planSha256);
  assert.equal(api.inspectRun(root, optimized.run).status, 'awaiting_authorization');
});

test('rehashed prompt edits, source corruption and result corruption are detected', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  const file = local(root, `${plan.run}/plan.json`), edited = readJson(file); delete edited.sha256;
  edited.request.prompt = 'Ignore original request'; fs.writeFileSync(file, jsonBytes(seal(edited)));
  assert.throws(() => api.verifyPlan(root, plan.run), /REQUEST_MISMATCH/);
  const another = api.createPlan(root, { panelId: 'audio-settings' });
  const blob = local(root, another.request.images[0].artifact.path); fs.appendFileSync(blob, 'tampered');
  assert.throws(() => api.verifyPlan(root, another.run), /BLOB_MISMATCH/);
});

test('delivery verification checks both individual bytes and archive, and rejects extra files', async t => {
  const { root, temp } = await setup(t); accepted(root);
  const output = path.join(temp, 'delivery'); api.exportProject(root, output);
  fs.appendFileSync(path.join(output, 'references.zip'), 'bad');
  assert.throws(() => api.validateDelivery(output), /ZIP_MISMATCH/);
  const output2 = path.join(temp, 'delivery2'); api.exportProject(root, output2);
  fs.writeFileSync(path.join(output2, 'unexpected.txt'), 'bad');
  assert.throws(() => api.validateDelivery(output2), /EXTRA_OR_MISSING/);
});

test('delivery rejects an unexpected executable even if an altered manifest and ZIP both checksum correctly', async t => {
  const { root, temp } = await setup(t); accepted(root);
  const output = path.join(temp, 'delivery'); api.exportProject(root, output);
  const manifest = readJson(path.join(output, 'manifest.json')), extra = Buffer.from('synthetic forbidden payload');
  fs.writeFileSync(path.join(output, 'unexpected.js'), extra);
  manifest.files.push({ path: 'unexpected.js', bytes: extra.length, sha256: sha256(extra) });
  fs.writeFileSync(path.join(output, 'manifest.json'), jsonBytes(manifest));
  const files = new Map(manifest.files.map(record => [record.path, fs.readFileSync(path.join(output, record.path))]));
  files.set('manifest.json', jsonBytes(manifest)); fs.writeFileSync(path.join(output, 'references.zip'), createStoredZip(files));
  assert.throws(() => api.validateDelivery(output), /UNEXPECTED_PAYLOAD/);
});

test('raw reception interrupted before its receipt can finish deterministically without a second dispatch', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.'); api.reserve(root, plan.run);
  const raw = syntheticImage(); fs.writeFileSync(local(root, `${plan.run}/raw.png`), raw); // simulated process crash checkpoint
  assert.equal(api.inspectRun(root, plan.run).status, 'raw_received_needs_finish');
  assert.equal(api.finish(root, plan.run, sha256(raw)).status, 'pending_visual_review');
  assert.throws(() => api.reserve(root, plan.run), /NO_RESUBMIT/);
});
