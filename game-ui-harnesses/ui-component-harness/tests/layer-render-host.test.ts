import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startLayerRenderServer } from '../scripts/layer-render-host.mjs';

test('local render host serves only check assets and refuses methods, API, query and foreign hosts', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'component-render-host-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'layer-plan-check.html'), '<html>fixture</html>');
  await writeFile(join(folder, 'assets/check.js'), 'export const fixture=true;');
  await writeFile(join(folder, 'private.json'), 'private fixture');
  const host = await startLayerRenderServer({ directory: folder });
  try {
    assert.match(host.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(Number(new URL(host.origin).port) >= 16384);
    const entry = await fetch(host.origin + '/layer-plan-check.html');
    assert.equal(entry.status, 200); assert.equal(await entry.text(), '<html>fixture</html>');
    assert.equal((await fetch(host.origin + '/assets/check.js')).status, 200);
    const head = await fetch(host.origin + '/layer-plan-check.html', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    for (const path of ['/api/ui-layer-plan', '/private.json', '/assets/%2e%2e%2fprivate.json', '/layer-plan-check.html?x=1'])
      assert.equal((await fetch(host.origin + path)).status, 404, path);
    assert.equal((await fetch(host.origin + '/layer-plan-check.html', { method: 'POST' })).status, 405);
    const foreignHost = await new Promise<number>((resolve, reject) => {
      request(host.origin + '/layer-plan-check.html', { headers: { host: 'foreign.invalid' } }, response => {
        response.resume(); resolve(response.statusCode!);
      }).on('error', reject).end();
    });
    assert.equal(foreignHost, 403);
  } finally { await Promise.all([host.close(), host.close()]); }
  await assert.rejects(fetch(host.origin + '/layer-plan-check.html'));
});

test('missing installed render entry fails instead of starting an empty checker', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'component-render-missing-'));
  await assert.rejects(startLayerRenderServer({ directory: folder }), /ENOENT|ENTRY_MISSING/);
});

test('render host refuses known Chromium unsafe ports before binding', async () => {
  for (const port of [6667, 10080, -1, 65536, NaN, 1.5])
    await assert.rejects(startLayerRenderServer({ port }), /LAYER_RENDER_PORT_INVALID/);
});
