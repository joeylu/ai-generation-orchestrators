import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { listenLoopback } from '../src/loopback-listener.mjs';

function fixture(ports) {
  const server = new EventEmitter(), calls = []; let bound, closes = 0;
  server.listen = (port, host, ready) => {
    calls.push({ port, host }); const next = ports[calls.length - 1];
    queueMicrotask(() => {
      if (typeof next === 'string') server.emit('error', Object.assign(new Error(next), { code: next }));
      else { bound = next; ready(); }
    });
  };
  server.address = () => ({ port: bound });
  server.close = done => { closes++; bound = null; queueMicrotask(done); };
  return { server, calls, closes: () => closes };
}

test('an OS-assigned Fetch-blocked port is closed before advertising a safe loopback URL', async () => {
  const fake = fixture([6000, 52000]);
  await listenLoopback(fake.server, 0);
  assert.equal(fake.closes(), 1); assert.equal(fake.calls[0].port, 0);
  assert(fake.calls[1].port >= 49152); assert(fake.calls[1].port <= 65535);
  assert(fake.calls.every(call => call.host === '127.0.0.1'));
  assert.equal(fake.server.address().port, 52000); assert.equal(fake.server.listenerCount('error'), 0);
});

test('explicit blocked or busy ports never silently move; ephemeral collisions have a bounded allocation budget', async () => {
  for (const port of [4190, 6000, 10080]) {
    const fake = fixture([]);
    await assert.rejects(listenLoopback(fake.server, port), { code: 'WORKBENCH_SERVER_PORT_BLOCKED' });
    assert.equal(fake.calls.length, 0);
  }
  const explicit = fixture(['EADDRINUSE']);
  await assert.rejects(listenLoopback(explicit.server, 4189), { code: 'EADDRINUSE' });
  assert.equal(explicit.calls.length, 1);
  const collisions = fixture(Array(8).fill('EADDRINUSE'));
  await assert.rejects(listenLoopback(collisions.server, 0), { code: 'WORKBENCH_SERVER_PORT_UNAVAILABLE' });
  assert.equal(collisions.calls.length, 8); assert.equal(collisions.server.listenerCount('error'), 0);
});
