import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { layerPlanningFixture } from './helpers/layer-planning-fixture.ts';
import { requestLocalLayerPlan } from '../scripts/studio-layer-client.mjs';

test('Node planning client waits for delayed headers using explicit deadline, preserves source and makes one request', async () => {
  const fixture = await layerPlanningFixture(); let calls = 0;
  const server = createServer(async (request, response) => {
    calls++; const parts = [];
    for await (const part of request) parts.push(part);
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    assert.equal(request.headers.origin, `http://127.0.0.1:${server.address()!.port}`);
    assert.equal(value.archive.sha256, fixture.plan.archiveSha256);
    assert.deepEqual(Buffer.from(value.archive.base64, 'base64'), Buffer.from(fixture.bytes));
    setTimeout(() => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ version: '2.0', proposal: fixture.proposal, execution: null })); }, 30);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address()!.port}`;
  try {
    const result = await requestLocalLayerPlan(origin, fixture.bytes, { timeoutMs: 1000 });
    assert.equal(result.httpStatus, 200); assert.deepEqual(result.body.proposal, fixture.proposal); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
});

test('Node client cancellation, deadline and invalid response are terminal with no second request', async () => {
  const fixture = await layerPlanningFixture();
  for (const mode of ['abort', 'timeout', 'invalid'] as const) {
    const controller = new AbortController(); let calls = 0;
    const server = createServer(async (request, response) => {
      calls++; for await (const _part of request) { /* consume authenticated fixture request */ }
      if (mode === 'abort') controller.abort();
      if (mode === 'invalid') response.end('not-json');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address()!.port}`;
    try {
      await assert.rejects(requestLocalLayerPlan(origin, fixture.bytes, { signal: controller.signal, timeoutMs: mode === 'timeout' ? 30 : 1000 }),
        new RegExp(`LAYER_CLIENT_${mode === 'abort' ? 'ABORTED' : mode === 'timeout' ? 'TIMEOUT' : 'RESPONSE_INVALID'}_NO_RETRY`));
      assert.equal(calls, 1);
    } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
  }
});
