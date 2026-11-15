import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { startStudio } from '../src/studio/host.mjs';
import { terrainEditResponse } from '../src/studio/terrain-edit-wire.mjs';
import { strokeCells, layerOffset, repeatCoverage } from '../src/studio/geometry.mjs';

const fixture = fileURLToPath(new URL('./fixtures/synthetic', import.meta.url));
test('sparse brush events rasterize a contiguous line in both directions', () => {
  for (const end of [{ x: 7, y: 2 }, { x: -4, y: 9 }, { x: 0, y: 0 }]) {
    const cells = strokeCells({ x: 0, y: 0 }, end);
    assert.deepEqual(cells[0], { x: 0, y: 0 }); assert.deepEqual(cells.at(-1), end);
    assert.equal(new Set(cells.map(cell => `${cell.x},${cell.y}`)).size, cells.length);
    cells.slice(1).forEach((cell, index) => { assert.ok(Math.abs(cell.x - cells[index].x) <= 1); assert.ok(Math.abs(cell.y - cells[index].y) <= 1); });
  }
});
test('parallax is anchored to the reference camera and repeat phase survives camera travel', () => {
  const reference = { x: 512, y: 288 }, node = { position: { x: 19, y: 0 } };
  assert.deepEqual(layerOffset(reference, reference, { x: .2, y: 1 }, true), { x: 0, y: 0 });
  for (const x of [-5000, 512, 19000]) {
    const offset = layerOffset({ x, y: 288 }, reference, { x: .2, y: 1 }, true);
    const visible = { x: x - 500, width: 1000 };
    const repeat = repeatCoverage(node, visible, offset);
    assert.equal(repeat.x + offset.x, visible.x);
    assert.equal(repeat.width, visible.width);
    assert.equal(repeat.x + repeat.tileX, node.position.x);
    assert.equal(layerOffset({ x, y: 288 }, reference, { x: 1, y: 1 }, true).x, 0);
    assert.deepEqual(layerOffset({ x, y: 288 }, reference, { x: .2, y: 1 }, false), { x: 0, y: 0 });
  }
});
test('loopback host keeps edits atomic, revision checked, source fixed and diagnostics bounded', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'scene-studio-host-'));
  for (const file of ['index.html', 'app.js', 'style.css']) writeFileSync(join(directory, file), 'fixture');
  const host = await startStudio({ root: fixture, staticRoot: directory });
  t.after(async () => { await host.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = (path, body, origin = host.url, headers) => fetch(host.url + path, {
    ...(body ? { method: 'POST', body: JSON.stringify(body), headers: { Origin: origin, 'Content-Type': 'application/json', ...headers } } : {}),
  });
  const initial = await (await request('/api/state')).json();
  assert.equal(initial.scene.counts.terrainNodes, 99);
  assert.equal(initial.scene.generationCalls, 0); assert.equal(initial.modules.length, 49);
  const paint = { revision: 0, action: 'commands', commands: [{ type: 'paint-cells', familyId: initial.familyId, cells: [{ x: 10, y: 3 }] }] };
  assert.equal((await request('/api/edit', paint, 'https://invalid.example')).status, 403);
  const wrongBase = await request('/api/edit', paint, host.url, { Accept: terrainEditResponse, 'X-Scene-Kit-Base': '0'.repeat(64) });
  assert.equal(wrongBase.status, 409);
  assert.deepEqual(await wrongBase.json(), { code: 'STALE_REVISION' });
  const edited = await (await request('/api/edit', paint)).json();
  assert.equal(edited.revision, 1); assert.equal(edited.history.undoDepth, 1); assert.equal(edited.scene.counts.terrainNodes, 100);
  assert.equal((await request('/api/edit', paint)).status, 409);
  assert.equal((await request('/api/export?revision=0')).status, 409);
  const archive = await request('/api/export?revision=1'); assert.equal(archive.status, 200);
  assert.equal(archive.headers.get('content-type'), 'application/zip');
  assert.equal(archive.headers.get('content-disposition'), null);
  assert.equal(Buffer.from(await archive.arrayBuffer()).readUInt32LE(), 0x04034b50);
  assert.equal((await request('/api/export?revision=1&path=kit.json')).status, 404);
  assert.equal((await fetch(host.url + '/api/export?revision=1', { headers: { Origin: 'https://invalid.example' } })).status, 403);
  assert.deepEqual((await (await request('/api/state')).json()).history, edited.history);
  const invalid = structuredClone(edited.document); invalid.bounds.width = 1;
  assert.equal((await request('/api/edit', { revision: 1, action: 'import', document: invalid })).status, 422);
  const afterFailure = await (await request('/api/state')).json();
  assert.deepEqual(afterFailure.document, edited.document); assert.deepEqual(afterFailure.history, edited.history);
  const undone = await (await request('/api/edit', { revision: 1, action: 'undo' })).json();
  assert.equal(undone.scene.contentSha256, initial.scene.contentSha256);
  const imported = await (await request('/api/edit', { revision: 2, action: 'import', document: edited.document })).json();
  assert.equal(imported.history.undoDepth, 0); assert.equal(imported.scene.source.authorSha256, edited.scene.source.authorSha256);
  assert.equal((await request('/api/edit', { revision: 3, action: 'undo', path: '../kit.json' })).status, 400);
  assert.equal((await request('/assets/../kit.json')).status, 404);
  assert.equal((await request('/api/state?path=kit.json')).status, 404);
  const image = await request(initial.modules[0].url);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(host.url + '/', { headers: { Host: 'invalid.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(reboundStatus, 403);
  const crossSite = await fetch(host.url + '/api/state', { headers: { Origin: 'https://invalid.example' } });
  assert.equal(crossSite.status, 403);
  assert.ok(!(await (await request('/api/state')).text()).includes(fixture));
});
