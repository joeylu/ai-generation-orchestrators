import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import * as api from '../src/index.mjs';
import { canvas, crc32, decodePng, encodePng } from '../src/png.mjs';
import { deflateSync } from 'node:zlib';
import { local, readJson } from '../src/common.mjs';
import { visualStructure } from '../src/panel.mjs';
import { setup, syntheticImage, panelFile, catalogFile } from './helpers.mjs';

test('PNG decoding bounds dimensions, checks CRC, rejects truncation and normalizes zero-alpha RGB', () => {
  const image = canvas(2, 2); image.rgba.set([255, 100, 30, 0], 0);
  const bytes = encodePng(image), decoded = decodePng(bytes);
  assert.deepEqual([...decoded.rgba.subarray(0, 4)], [0, 0, 0, 0]);
  const corrupt = Buffer.from(bytes); corrupt[30] ^= 1;
  assert.throws(() => decodePng(corrupt), /CRC/);
  assert.throws(() => decodePng(bytes.subarray(0, bytes.length - 4)), /MISSING_END|TRUNCATED/);
  assert.throws(() => decodePng(Buffer.concat([bytes, Buffer.from('extra')])), /TRAILING/);
  assert.throws(() => encodePng({ width: 5000, height: 1, rgba: Buffer.alloc(20000) }), /SIZE/);
});

function pngChunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, checksum]);
}
test('independently assembled PNG fixtures exercise RGB Sub/Up, grayscale and indexed transparency', () => {
  function image(color, width, height, rows, extra = []) {
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = color;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), ...extra,
      pngChunk('IDAT', deflateSync(Buffer.from(rows))), pngChunk('IEND', Buffer.alloc(0))]);
  }
  const rgb = image(2, 2, 2, [1,10,20,30,30,30,30, 2,5,5,5,5,5,5]);
  assert.deepEqual([...decodePng(rgb).rgba], [10,20,30,255,40,50,60,255,15,25,35,255,45,55,65,255]);
  assert.deepEqual([...decodePng(image(0, 2, 1, [0,0,200])).rgba], [0,0,0,255,200,200,200,255]);
  const indexed = image(3, 2, 1, [0,0,1], [pngChunk('PLTE', Buffer.from([255,0,0,0,255,0])), pngChunk('tRNS', Buffer.from([255,0]))]);
  assert.deepEqual([...decodePng(indexed).rgba], [255,0,0,255,0,0,0,0]);
});

test('lossless PNG normalization strips ancillary metadata while preserving raw evidence', async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.'); const request = api.reserve(root, plan.run);
  const png = syntheticImage(), metadata = pngChunk('tEXt', Buffer.from('description\0synthetic-metadata-fixture'));
  const raw = Buffer.concat([png.subarray(0, 33), metadata, png.subarray(33)]);
  const result = api.receive(root, plan.run, request.requestSha256, raw);
  const normalized = fs.readFileSync(local(root, result.image));
  assert.ok(normalized.equals(png)); assert.ok(fs.readFileSync(local(root, `${plan.run}/raw.png`)).equals(raw));
});

for (const [name, make] of [
  ['wrong dimensions', () => syntheticImage(20, 20)],
  ['blank output', () => encodePng(canvas(960, 640))],
  ['nonopaque output', () => { const image = canvas(960, 640); image.rgba[3] = 100; return encodePng(image); }],
  ['invalid PNG', () => Buffer.from('not an image')],
]) test(`${name} is terminal and cannot be replaced in place`, async t => {
  const { root } = await setup(t), plan = api.createPlan(root, { panelId: 'audio-settings' });
  api.authorize(root, plan.run, plan.planSha256, 'Test approval.'); const request = api.reserve(root, plan.run);
  assert.throws(() => api.receive(root, plan.run, request.requestSha256, make()));
  assert.equal(api.inspectRun(root, plan.run).status, 'rejected_technical');
  assert.throws(() => api.receive(root, plan.run, request.requestSha256, syntheticImage()), /NOT_PENDING/);
});

test('prototype intake uses upstream semantic validation and never accepts a mismatched screenshot', async t => {
  const { root, temp } = await setup(t);
  const preview = path.join(temp, 'preview.png'); fs.writeFileSync(preview, syntheticImage(40, 40));
  await assert.rejects(api.addPanel(root, { spec: panelFile, catalog: catalogFile, preview }), /PREVIEW_SIZE/);
  const bad = readJson(panelFile); bad.sections[0].rows[0].bind = 'missing';
  const file = path.join(temp, 'bad.json'); fs.writeFileSync(file, JSON.stringify(bad));
  await assert.rejects(api.addPanel(root, { spec: file, catalog: catalogFile }));
});

test('current menu PanelBundle is recompiled on intake and altered geometry fails even with a new outer hash', async t => {
  const { root, temp } = await setup(t);
  const [{ menuFixture }, { createPanelBundle }, { loadWorkspaceCore }, { digestJson }] = await Promise.all([
    import('../../ui-panel-harness/examples/menu-defaults-v1/fixture.mjs'), import('../../ui-panel-harness/src/panel-bundle.mjs'),
    import('../../ui-panel-harness/src/component-adapter.mjs'), import('../../ui-panel-harness/src/canonical.mjs')]);
  const catalog = readJson(new URL('../../ui-panel-harness/examples/modern-menu.catalog.json', import.meta.url));
  const { spec } = await menuFixture(catalog), core = await loadWorkspaceCore(), bundle = structuredClone(await createPanelBundle(spec, catalog, core));
  const file = path.join(temp, 'menu.bundle.json'); fs.writeFileSync(file, JSON.stringify(bundle));
  const imported = await api.addPanel(root, { bundle: file });
  assert.equal(imported.panelId, 'menu-default-fixture');
  const projection = readJson(local(root, imported.prototype.path));
  assert.equal(projection.nodes.filter(node => node.type === 'Button').length, 3);
  assert.ok(projection.nodes.some(node => node.content.text === '继续游戏'));
  bundle.componentBundle.document.root.children[0].layout.x += 1;
  const { sha256, ...payload } = bundle; bundle.sha256 = await digestJson(payload); fs.writeFileSync(file, JSON.stringify(bundle));
  await assert.rejects(api.addPanel(root, { bundle: file }), /MISMATCH/);
});

test('tabs expose only the selected page; scrolling clips visible geometry and retains semantic copy', () => {
  const style = {}, node = (id, type, box, props, children = []) => ({ id, type, layout: { x: box[0], y: box[1], width: box[2], height: box[3] }, props, children });
  const text = node('visible-copy', 'Text', [0, 80, 100, 40], { text: 'Clipped copy' });
  const page = node('page-a', 'ScrollView', [0, 20, 100, 100], { style }, [text]);
  const hidden = node('page-b', 'Container', [0, 20, 100, 100], { style });
  const root = node('tabs', 'Tabs', [0, 0, 100, 140], { activeId: 'a', tabs: [{ id: 'a', label: 'A', contentId: 'page-a' }, { id: 'b', label: 'B', contentId: 'page-b' }] }, [page, hidden]);
  const nodes = visualStructure({ canvas: { width: 100, height: 140 }, root });
  assert.ok(!nodes.some(item => item.id === 'page-b'));
  const visible = nodes.find(item => item.id === 'visible-copy');
  assert.deepEqual(visible.visibleBox, [0, 100, 100, 20]); assert.equal(visible.content.text, 'Clipped copy');
});

test('internal paths reject traversal and symbolic links', async t => {
  const { root, temp } = await setup(t);
  for (const invalid of ['../escape', '/absolute', 'a/../../escape', 'C:/private', 'a\\b', 'a/con.txt', 'a./file']) assert.throws(() => local(root, invalid), /PATH/);
  const target = path.join(temp, 'outside'); fs.mkdirSync(target);
  const link = path.join(root, 'linked');
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.diagnostic('Symlink creation unavailable; traversal cases were verified.'); return; }
  assert.throws(() => local(root, 'linked/file.json'), /PATH_LINK/);
});
