import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.mjs';
import { BUILTIN_IDS, builtinPack, resolvePack } from '../src/packs.mjs';
import { canonical, jsonBytes, local, readJson, seal, sha256 } from '../src/common.mjs';
import { PREVIOUS_RUNTIME_SHA256 } from '../src/compiler.mjs';
import { verifyResult } from '../src/generation.mjs';
import { createStoredZip } from '../../ui-panel-harness/src/zip-store.mjs';
import { accepted, setup, syntheticImage } from './helpers.mjs';
import { main } from '../ui-reference.mjs';

const example = fileURLToPath(new URL('../examples/custom-style-pack.json', import.meta.url));
const customFile = (temp, value = readJson(example)) => {
  const file = path.join(temp, 'pack.json'); fs.writeFileSync(file, jsonBytes(value)); return file;
};
test('website catalog has six ordered UI adaptations, provenance and honest absent-sample status', () => {
  const catalog = api.presetList();
  assert.deepEqual(catalog.map(p => p.id), BUILTIN_IDS);
  assert.deepEqual(catalog.map(p => p.name), ['概念图风格', '像素卡通', '日系赛璐璐', '欧美卡通', '幻想手绘', '国风幻想']);
  for (const item of catalog) {
    const pack = builtinPack(item.id); resolvePack(pack);
    assert.deepEqual(item.sample, { status: 'not_generated', image: null });
    assert.match(item.origin.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!canonical(pack).includes('character_rules'));
  }
  assert.match(builtinPack('concept-art').render_style.visual_identity, /中性/);
  assert.match(builtinPack('pixel-cartoon').ui_rules.frame, /2×2/);
});

test('new rule-only presets freeze zero style images and compile UI-specific render/negative rules', async t => {
  const { root } = await setup(t, { activate: false });
  for (const id of BUILTIN_IDS) {
    const style = api.createStyle(root, { preset: id });
    assert.equal(style.kind, 'ui_reference_style_v2'); assert.deepEqual(style.references, []);
    assert.equal(api.loadStyle(root, style.sha256).pack.metadata.id, id);
    api.activateStyle(root, style.sha256, 'Offline fixture style review.');
    assert.throws(() => api.createPlan(root, { panelId: 'audio-settings' }), /STYLE_PRIMARY_REFERENCE_REQUIRED/);
    assert.equal(fs.existsSync(local(root, 'runs')), false);
  }
});

test('custom inheritance, explicit project overrides and primary PNG are immutable snapshots', async t => {
  const { root, temp } = await setup(t);
  const image = path.join(temp, 'primary.png'); fs.writeFileSync(image, syntheticImage());
  const input = readJson(example); input.references = { primary: 'primary.png' };
  const file = customFile(temp, input), checked = await main(['pack-check', '--pack', file]);
  assert.equal(checked.computeCalls, 0); assert.equal(checked.primarySha256, sha256(fs.readFileSync(image)));
  const overrides = { ...api.presetList()[5].rules, palette: input.palette, decoration: 'No corner ornament.' };
  const style = await main(['style-create', '--root', root, '--pack', file]);
  assert.equal(style.pack.ui_rules.decoration, input.ui_rules.decoration);
  assert.equal(style.pack.render_style.line, builtinPack('chinese-fantasy').render_style.line);
  assert.equal(style.source.pack.sha256, sha256(fs.readFileSync(file)));
  assert.ok(style.source.basePack); assert.deepEqual(style.references.map(r => r.role), ['primary-style']);
  const changed = api.createStyle(root, { pack: file, rules: overrides });
  assert.notEqual(style.sha256, changed.sha256); assert.equal(changed.pack.ui_rules.decoration, 'No corner ornament.');
  fs.writeFileSync(file, '{}'); fs.writeFileSync(image, 'replaced external source');
  assert.equal(api.loadStyle(root, style.sha256).sha256, style.sha256);
  api.activateStyle(root, style.sha256, 'Offline approval.');
  const plan = api.createPlan(root, { panelId: 'audio-settings' });
  assert.deepEqual(plan.request.images.map(r => r.role), ['layout-reference', 'primary-style']);
  assert.ok(plan.request.prompt.includes('Approved resolved project pack and palette take precedence'));
  assert.equal(api.projectStatus(root).activeStyle, style.sha256);
  api.activateStyle(root, changed.sha256, 'Synthetic revision approval.');
  assert.throws(() => api.authorize(root, plan.run, plan.planSha256, 'Stale plan must not run.'), /PLAN_STYLE_STALE/);
});

test('standalone custom UI packs work without a base or image and reject character/provider/executable fields', async t => {
  const { root, temp } = await setup(t);
  const input = structuredClone(builtinPack('anime-cel')); input.metadata.id = 'my-studio-ui'; delete input.origin;
  const file = customFile(temp, input), style = api.createStyle(root, { pack: file });
  assert.equal(style.source.kind, 'custom'); assert.equal(style.source.basePack, null);
  for (const change of [p => { p.provider = { endpoint: 'private' }; }, p => { p.character_rules = {}; },
    p => { p.scripts = ['run-me']; }, p => { p.render_style.camera = 'front idle'; },
    p => { delete p.ui_rules.frame; }, p => { p.base_style = { id: 'unknown', version: '1.0.0' }; },
    p => { p.base_style = { id: 'anime-cel', version: '999.0.0' }; }, p => { p.references = null; }]) {
    const invalid = structuredClone(input); change(invalid); customFile(temp, invalid);
    assert.throws(() => api.checkPack(file)); assert.throws(() => api.createStyle(root, { pack: file }));
  }
  assert.throws(() => api.createStyle(root, { pack: file, preset: 'anime-cel' }), /CONFLICT/);
});

test('pack references reject traversal, absolute/device paths, links and competing primary inputs', async t => {
  const { root, temp } = await setup(t);
  for (const primary of ['../escape.png', 'C:/secret.png', '/absolute.png', 'a/../../b.png', 'CON.png', 'a\\b.png', 'file.js', 'a./file.png']) {
    const p = readJson(example); p.references = { primary }; const file = customFile(temp, p);
    assert.throws(() => api.checkPack(file), /PACK_REFERENCE_PATH/);
  }
  const p = readJson(example); p.references = { primary: 'primary.png' };
  const file = customFile(temp, p), image = path.join(temp, 'primary.png'); fs.writeFileSync(image, syntheticImage());
  assert.throws(() => api.createStyle(root, { pack: file, reference: image }), /REFERENCE_CONFLICT/);
  const folder = path.join(temp, 'outside'); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'style.png'), syntheticImage());
  try { fs.symlinkSync(folder, path.join(temp, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.diagnostic('Link creation unavailable.'); return; }
  p.references.primary = 'linked/style.png'; customFile(temp, p);
  assert.throws(() => api.checkPack(file), /PATH_LINK/);
});

test('pack input size, semantic versions and merged negative-rule budgets are bounded', async t => {
  const { root, temp } = await setup(t);
  const p = readJson(example); p.metadata.version = '1.0.0\n';
  let file = customFile(temp, p); assert.throws(() => api.checkPack(file), /PACK_IDENTITY/);
  const many = readJson(example); many.negative_rules = Array.from({ length: 40 }, (_, i) => `Custom negative ${i}`);
  file = customFile(temp, many); assert.throws(() => api.checkPack(file), /PACK_NEGATIVES/);
  assert.throws(() => api.createStyle(root, { pack: file }), /PACK_NEGATIVES/);
  fs.writeFileSync(file, ' '.repeat(256 * 1024 + 1));
  assert.throws(() => api.checkPack(file), /FILE_SIZE_OR_TYPE/);
  assert.throws(() => api.createStyle(root, { pack: file }), /FILE_SIZE_OR_TYPE/);
});

test('resolved pack tampering fails against the frozen raw source even after resealing the style', async t => {
  const { root } = await setup(t), style = api.createStyle(root, { preset: 'concept-art' });
  const { sha256: ignored, ...payload } = style;
  payload.pack.render_style.line = 'unapproved line'; const edited = seal(payload);
  fs.writeFileSync(local(root, `styles/${edited.sha256}.json`), jsonBytes(edited));
  assert.throws(() => api.loadStyle(root, edited.sha256), /STYLE_PACK_MISMATCH/);
});

test('custom pack identity and original bytes ship with accepted panels; source edits fail delivery validation', async t => {
  const { root, temp } = await setup(t), file = customFile(temp), original = fs.readFileSync(file);
  const reference = path.join(temp, "primary.png"); fs.writeFileSync(reference, syntheticImage(96, 64));
  const style = api.createStyle(root, { pack: file, reference }); api.activateStyle(root, style.sha256, 'Offline style review.');
  accepted(root);
  const output = path.join(temp, 'pack-delivery'); api.exportProject(root, output);
  assert.equal(api.validateDelivery(output).status, 'valid');
  assert.ok(fs.readFileSync(path.join(output, style.source.pack.path)).equals(original));
  assert.equal(readJson(path.join(output, 'style.json')).pack.metadata.id, 'jade-custom-ui');
  const manifest = readJson(path.join(output, 'manifest.json')), files = new Map();
  for (const record of manifest.files) {
    let bytes = fs.readFileSync(path.join(output, record.path));
    if (record.path === style.source.pack.path) { bytes = Buffer.from('{}'); fs.writeFileSync(path.join(output, record.path), bytes); record.sha256 = sha256(bytes); record.bytes = bytes.length; }
    files.set(record.path, bytes);
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), jsonBytes(manifest)); files.set('manifest.json', jsonBytes(manifest));
  fs.writeFileSync(path.join(output, 'references.zip'), Buffer.from(createStoredZip(files)));
  assert.throws(() => api.validateDelivery(output), /STYLE_SOURCE_MISMATCH/);
});

test('known 0.2.0 outputs remain reviewable but old runtime plans can never dispatch or finish', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Synthetic historical fixture.');
  const request = api.reserve(root, plan.run), result = api.receive(root, plan.run, request.requestSha256, syntheticImage());
  // Simulate a complete historical fixture; production records are never edited this way.
  const payload = readJson(local(root, `${plan.run}/plan.json`)); delete payload.sha256; delete payload.correction;
  payload.kind = 'ui_reference_plan_v2'; payload.runtimeSha256 = PREVIOUS_RUNTIME_SHA256;
  const archived = seal(payload); fs.writeFileSync(local(root, `${plan.run}/plan.json`), jsonBytes(archived));
  let authorizationSha256;
  for (const name of ['authorization', 'attempt', 'receipt', 'technical']) {
    const record = readJson(local(root, `${plan.run}/${name}.json`)); delete record.sha256; record.planSha256 = archived.sha256;
    if (name === 'attempt') record.authorizationSha256 = authorizationSha256;
    const sealed = seal(record); if (name === 'authorization') authorizationSha256 = sealed.sha256;
    fs.writeFileSync(local(root, `${plan.run}/${name}.json`), jsonBytes(sealed));
  }
  assert.equal(api.inspectRun(root, plan.run).executable, false); assert.equal(verifyResult(root, plan.run).technical.imageSha256, result.imageSha256);
  for (const call of [() => api.reserve(root, plan.run), () => api.finish(root, plan.run, result.rawSha256),
    () => api.authorize(root, plan.run, archived.sha256, 'No permission to run archived compute.')]) assert.throws(call, /RUNTIME_CHANGED/);
  api.reviewRun(root, plan.run, { imageSha256: result.imageSha256, layout: 'pass', style: 'pass', copy: 'pass', decision: 'accept', note: 'Historical fixture review.', useAsAnchor: false });
  assert.equal(api.projectStatus(root).panels[0].status, 'accepted_current_style');
  const next = api.createPlan(root, { panelId: 'audio-settings' });
  assert.equal(next.request.images.at(-1).role, 'primary-style');
  assert.equal(next.request.images.at(-1).artifact.sha256, api.loadStyle(root, api.projectStatus(root).activeStyle).references[0].artifact.sha256);
});

test('six sample drafts share one prototype and cannot freeze plans until all styles are reviewed', async t => {
  const { temp } = await setup(t), output = path.join(temp, 'six-samples');
  const prepared = await main(['samples-prepare', '--output', output]);
  assert.equal(prepared.preparation, 'drafts-only-no-style-approval-no-compute');
  assert.equal(new Set(prepared.samples.map(s => s.prototypeSha256)).size, 1);
  assert.throws(() => api.planSamples(output), /STYLE_REVIEW_REQUIRED/);
  for (const s of prepared.samples) {
    const root = path.join(output, s.id);
    assert.equal(api.projectStatus(root).activeStyle, null);
    assert.ok(!fs.existsSync(path.join(root, 'runs')));
    api.activateStyle(root, s.styleSha256, 'Synthetic sample style review, not real acceptance.');
  }
  assert.throws(() => api.planSamples(output), /STYLE_PRIMARY_REFERENCE_REQUIRED/);
  assert.ok(prepared.samples.every(item => !fs.existsSync(local(path.join(output, item.id), 'runs'))));
});
