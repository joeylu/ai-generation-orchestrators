import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import * as api from '../src/index.mjs';
import { main } from '../ui-reference.mjs';
import { readSampleCatalog } from '../src/sample-catalog.mjs';
import { digestJson, jsonBytes, local, readJson, seal, sha256 } from '../src/common.mjs';
import { CLOSED_SELECT_RUNTIME_SHA256 } from '../src/compiler.mjs';
import { accepted, secondPanel, setup, syntheticImage } from './helpers.mjs';
import { materializeLegacyCatalog } from './fixtures/materialize-legacy-catalog.mjs';

async function syntheticCatalog(temp) {
  // Immutable historical, synthetic 0.7.3 deliveries; no bootstrap model call.
  return materializeLegacyCatalog(path.join(temp, 'catalog'));
}

test('historical fixture ZIPs are temporary, byte-identical and still checked for tampering', async t => {
  const { temp } = await setup(t), { catalog, output } = await syntheticCatalog(temp);
  for (const entry of catalog.entries) {
    assert.equal(fs.existsSync(new URL(`./fixtures/legacy-sample-catalog/${entry.id}/references.zip`, import.meta.url)), false);
    const directory = local(output, entry.id), file = local(directory, 'references.zip');
    assert.equal(api.validateDelivery(directory).status, 'valid');
    const original = fs.readFileSync(file), changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    fs.writeFileSync(file, changed);
    assert.throws(() => api.validateDelivery(directory), /DELIVERY_ZIP_MISMATCH/);
    fs.writeFileSync(file, original);
  }
  assert.throws(() => materializeLegacyCatalog(output), /must be fresh/);
});

test('explicit external sample catalog validates deliveries and freezes style PNGs without approving or dispatching', async t => {
  const { root, temp } = await setup(t), { file, catalog, output } = await syntheticCatalog(temp);
  await t.test('CLI previews all six; no catalog retains honest rule-only status', async () => {
    const presets = await main(['presets', '--sample-catalog', file]);
    assert.equal(presets.length, 6);
    for (let i = 0; i < presets.length; i++) {
      assert.equal(presets[i].sample.status, 'accepted');
      assert.equal(presets[i].sample.catalogSha256, catalog.sha256);
      assert.deepEqual(presets[i].sample.image, catalog.entries[i].image);
      assert.equal(api.presetList()[i].sample.status, 'not_generated');
    }
  });
  await t.test('catalog image is immutable primary style, not a cross-project anchor', async () => {
    const oldActive = api.projectStatus(root).activeStyle;
    const style = await main(['style-create', '--root', root, '--preset', 'concept-art', '--sample-catalog', file]);
    assert.equal(api.projectStatus(root).activeStyle, oldActive);
    assert.equal(style.references[0].role, 'primary-style');
    assert.equal(style.references[0].artifact.sha256, catalog.entries[0].image.sha256);
    assert.ok(!style.sampleDisclosure.includes('no generated art sample'));
    api.activateStyle(root, style.sha256, 'Synthetic style activation.');
    const first = api.createPlan(root, { panelId: 'audio-settings' });
    assert.equal(api.verifyPlan(root, first.run).anchor, null);
    assert.deepEqual(first.request.images.map(i => i.role), ['layout-reference', 'primary-style']);
    assert.ok(!fs.existsSync(local(root, `${first.run}/authorization.json`)));
    assert.throws(() => api.reserve(root, first.run));
    const anchor = accepted(root, 'audio-settings');
    await secondPanel(root, temp);
    const next = api.createPlan(root, { panelId: 'audio-secondary' });
    assert.deepEqual(next.request.images.map(i => i.role), ['layout-reference', 'primary-style']);
    assert.equal(next.request.images[1].artifact.sha256, catalog.entries[0].image.sha256);
    assert.equal(api.verifyPlan(root, next.run).anchor, null);
    const imagePath = local(output, catalog.entries[0].image.path), original = fs.readFileSync(imagePath);
    fs.writeFileSync(imagePath, 'external source changed');
    try {
      assert.equal(api.loadStyle(root, style.sha256).sha256, style.sha256);
      assert.equal(api.verifyPlan(root, next.run).styleSha256, style.sha256);
      assert.throws(() => api.presetList({ sampleCatalog: file }));
    } finally { fs.writeFileSync(imagePath, original); }
    const exported = path.join(temp, 'frozen-delivery'); api.exportProject(root, exported, ['audio-settings']);
    assert.equal(api.validateDelivery(exported).status, 'valid');
  });
  await t.test('resealed catalogs cannot change acceptance, pack identity, paths, geometry or membership', () => {
    for (const change of [c => { c.sampleIsProjectAnchor = true; }, c => { c.provider = {}; },
      c => { c.entries.pop(); }, c => { c.entries.reverse(); }, c => { c.entries[0].visualReview = 'pending'; },
      c => { c.entries[0].version = '99.0.0'; }, c => { c.entries[0].styleSha256 = '0'.repeat(64); },
      c => { c.entries[0].prototypeSha256 = '0'.repeat(64); }, c => { c.entries[0].pixelCanvas.width++; },
      c => { c.entries[0].image.path = '../escape.png'; }, c => { c.entries[0].image.sha256 = '0'.repeat(64); },
      c => { c.entries[0].style.bytes++; }]) {
      const edited = structuredClone(catalog); delete edited.sha256; change(edited);
      fs.writeFileSync(file, jsonBytes(seal(edited)));
      assert.throws(() => readSampleCatalog(file));
    }
    fs.writeFileSync(file, jsonBytes(catalog));
    assert.equal(readSampleCatalog(file).catalog.sha256, catalog.sha256);
  });
  await t.test('ambiguous sources fail before writing snapshots; linked catalog roots fail', () => {
    const before = fs.readdirSync(local(root, 'blobs')).sort();
    for (const options of [{ sampleCatalog: file }, { preset: 'casual-clean', sampleCatalog: file },
      { preset: 'concept-art', sampleCatalog: file, reference: 'unused.png' },
      { pack: 'unused.json', sampleCatalog: file }]) assert.throws(() => api.createStyle(root, options), /SOURCE_CONFLICT/);
    assert.deepEqual(fs.readdirSync(local(root, 'blobs')).sort(), before);
    const linked = path.join(temp, 'linked');
    try { fs.symlinkSync(output, linked, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch { t.diagnostic('Link creation unavailable.'); return; }
    assert.throws(() => readSampleCatalog(path.join(linked, 'catalog.json')), /PATH_LINK/);
  });
});

test('known 0.4.0 plan-v3 evidence remains reviewable/exportable but never executable', async t => {
  const { root, temp } = await setup(t), original = accepted(root);
  // Historical test double only. Production records are never rewritten.
  const plan = readJson(local(root, `${original.plan.run}/plan.json`)); delete plan.sha256;
  plan.runtimeSha256 = CLOSED_SELECT_RUNTIME_SHA256;
  const archived = seal(plan); fs.writeFileSync(local(root, `${original.plan.run}/plan.json`), jsonBytes(archived));
  let authorizationSha256;
  for (const name of ['authorization', 'attempt', 'receipt', 'technical', 'review']) {
    const record = readJson(local(root, `${original.plan.run}/${name}.json`)); delete record.sha256;
    record.planSha256 = archived.sha256;
    if (name === 'attempt') record.authorizationSha256 = authorizationSha256;
    const sealed = seal(record); if (name === 'authorization') authorizationSha256 = sealed.sha256;
    fs.writeFileSync(local(root, `${original.plan.run}/${name}.json`), jsonBytes(sealed));
  }
  assert.equal(api.inspectRun(root, original.plan.run).executable, false);
  for (const call of [() => api.reserve(root, original.plan.run),
    () => api.finish(root, original.plan.run, original.result.rawSha256),
    () => api.authorize(root, original.plan.run, archived.sha256, 'No archived compute.')]) assert.throws(call, /RUNTIME_CHANGED/);
  const output = path.join(temp, 'archived-delivery'); api.exportProject(root, output);
  assert.equal(api.validateDelivery(output).status, 'valid');
});
