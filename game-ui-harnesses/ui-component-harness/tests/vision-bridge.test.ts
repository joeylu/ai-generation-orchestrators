import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createVisionBridge, MAX_REQUEST_BYTES, MAX_SOURCE_BYTES, validateVisionRequest } from '../scripts/studio-vision.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlGQ7YAAAAASUVORK5CYII=', 'base64');
const source = () => ({ path: 'assets/reference.png', sha256: createHash('sha256').update(png).digest('hex'), width: 1, height: 1, mime: 'image/png', base64: png.toString('base64') });
const input = () => ({ version: '0.1', source: source() });
const ready = (value: ReturnType<typeof source>) => ({ version: '0.1', sourceSha256: value.sha256, status: 'Ready', summary: 'Reviewed by a test double.', intent: { opaque: true } });

async function bridgeServer(options: Parameters<typeof createVisionBridge>[0] = {}) {
  const bridge = createVisionBridge(options);
  const server = createServer((request, response) => bridge.middleware(request, response, () => { response.writeHead(404); response.end(); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS');
  const origin = `http://127.0.0.1:${address.port}`;
  return { server, origin };
}
async function close(server: ReturnType<typeof createServer>) { server.closeAllConnections?.(); server.close(); await once(server, 'close'); }
async function call(origin: string, body?: unknown, headers: Record<string, string> = {}, method = 'POST', includeOrigin = true, endpoint = '/api/ui-vision') {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${origin}${endpoint}`, { method, headers: { ...(includeOrigin ? { Origin: origin } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}), ...headers }, body: payload });
  return { status: response.status, body: await response.json() };
}

test('status does not disclose configuration and an absent adapter never receives a request', async () => {
  const { server, origin } = await bridgeServer({ adapterPath: '' });
  try {
    assert.deepEqual(await call(origin, undefined, {}, 'GET'), { status: 200, body: { version: '0.1', configured: false } });
    // Node fetch simulates a browser GET that omits Origin but supplies its
    // same-origin fetch metadata and page referrer.
    assert.deepEqual(await call(origin, undefined, { Referer: `${origin}/index.html`, 'Sec-Fetch-Site': 'same-origin' }, 'GET', false),
      { status: 200, body: { version: '0.1', configured: false } });
    assert.deepEqual(await call(origin, undefined, {}, 'GET', false), { status: 403, body: { version: '0.1', error: 'VISION_FORBIDDEN' } });
    assert.deepEqual(await call(origin, input()), { status: 503, body: { version: '0.1', error: 'VISION_NOT_CONFIGURED' } });
  } finally { await close(server); }
});

test('an unavailable configured adapter returns a stable 503 without exposing its module path', async () => {
  const separator = process.platform === 'win32' ? '\\' : '/';
  const missing = `${process.cwd()}${separator}missing-ui-vision-adapter-for-test.mjs`;
  const { server, origin } = await bridgeServer({ adapterPath: missing });
  try {
    assert.deepEqual(await call(origin, undefined, {}, 'GET'), { status: 200, body: { version: '0.1', configured: true } });
    assert.deepEqual(await call(origin, input()), { status: 503, body: { version: '0.1', error: 'VISION_ADAPTER_UNAVAILABLE' } });
  } finally { await close(server); }
});

test('the handler verifies raster bytes and source identity before invoking a configured adapter', async () => {
  let calls = 0, received: unknown;
  const { server, origin } = await bridgeServer({ adapter: { analyze: async (value: ReturnType<typeof input>) => { calls++; received = value; return ready(value.source); } } });
  try {
    const valid = input();
    const response = await call(origin, valid);
    assert.equal(response.status, 200); assert.deepEqual(response.body, ready(valid.source)); assert.deepEqual(received, valid); assert.equal(calls, 1);
    const mismatch = input(); mismatch.source.sha256 = '0'.repeat(64);
    assert.deepEqual(await call(origin, mismatch), { status: 400, body: { version: '0.1', error: 'VISION_SOURCE_HASH_MISMATCH' } });
    const dimensions = input(); dimensions.source.width = 2;
    assert.deepEqual(await call(origin, dimensions), { status: 400, body: { version: '0.1', error: 'VISION_SOURCE_DIMENSIONS_MISMATCH' } });
    const svg = input(); svg.source.mime = 'image/svg+xml';
    assert.deepEqual(await call(origin, svg), { status: 400, body: { version: '0.1', error: 'VISION_INVALID_REQUEST' } });
    assert.equal(calls, 1);
  } finally { await close(server); }
});

test('short submit and poll requests keep one opaque UUID while a legacy analyze adapter remains separate', async () => {
  const analysisId = '8e4f4a2a-0ae7-4a95-83d4-72d86451e38d';
  let submits = 0, polls = 0, polled: string | undefined;
  const { server, origin } = await bridgeServer({ adapter: {
    submit: async (value: ReturnType<typeof input>) => {
      submits++;
      return { version: '0.1', sourceSha256: value.source.sha256, status: 'Pending', analysisId, pollAfterSeconds: 3 };
    },
    poll: async (id: string) => {
      polls++; polled = id;
      if (polls === 1) return { version: '0.1', sourceSha256: source().sha256, status: 'Pending', analysisId, pollAfterSeconds: 5 };
      return ready(source());
    },
  } });
  try {
    const submitted = await call(origin, input());
    assert.deepEqual(submitted, { status: 202, body: { version: '0.1', sourceSha256: source().sha256, status: 'Pending', analysisId, pollAfterSeconds: 3 } });
    const endpoint = `/api/ui-vision?analysisId=${analysisId}`;
    assert.deepEqual(await call(origin, undefined, {}, 'GET', true, endpoint),
      { status: 202, body: { version: '0.1', sourceSha256: source().sha256, status: 'Pending', analysisId, pollAfterSeconds: 5 } });
    assert.equal((await call(origin, undefined, {}, 'GET', true, endpoint)).status, 200);
    assert.equal(submits, 1); assert.equal(polls, 2); assert.equal(polled, analysisId);
    assert.deepEqual(await call(origin, undefined, {}, 'GET', true, '/api/ui-vision?analysisId=private-provider-task'),
      { status: 400, body: { version: '0.1', error: 'VISION_INVALID_REQUEST' } });
    assert.deepEqual(await call(origin, undefined, {}, 'GET', true, `${endpoint}&extra=1`),
      { status: 400, body: { version: '0.1', error: 'VISION_INVALID_REQUEST' } });
    assert.equal(polls, 2);
  } finally { await close(server); }
});

test('a submit cache hit returns final semantics immediately and private task fields never reach the browser', async () => {
  let polls = 0;
  const { server, origin } = await bridgeServer({ adapter: {
    submit: async (value: ReturnType<typeof input>) => ready(value.source),
    poll: async () => { polls++; return ready(source()); },
  } });
  try {
    assert.equal((await call(origin, input())).status, 200);
    assert.equal(polls, 0);
  } finally { await close(server); }

  const blocked = await bridgeServer({ adapter: {
    submit: async (value: ReturnType<typeof input>) => ({ version: '0.1', sourceSha256: value.source.sha256, status: 'Pending',
      analysisId: '8e4f4a2a-0ae7-4a95-83d4-72d86451e38d', pollAfterSeconds: 1, taskId: 'provider-private-task' }),
    poll: async () => ready(source()),
  } });
  try {
    const response = await call(blocked.origin, input());
    assert.deepEqual(response, { status: 502, body: { version: '0.1', error: 'VISION_INVALID_RESPONSE' } });
    assert.equal(JSON.stringify(response).includes('provider-private-task'), false);
  } finally { await close(blocked.server); }
});

test('poll final results require a bound-source shaped digest before the browser compiler receives them', async () => {
  const { server, origin } = await bridgeServer({ adapter: {
    submit: async (value: ReturnType<typeof input>) => ({ version: '0.1', sourceSha256: value.source.sha256, status: 'Pending',
      analysisId: '8e4f4a2a-0ae7-4a95-83d4-72d86451e38d', pollAfterSeconds: 1 }),
    poll: async () => ({ ...ready(source()), sourceSha256: 'not-a-source-digest' }),
  } });
  try {
    assert.deepEqual(await call(origin, undefined, {}, 'GET', true, '/api/ui-vision?analysisId=8e4f4a2a-0ae7-4a95-83d4-72d86451e38d'),
      { status: 502, body: { version: '0.1', error: 'VISION_INVALID_RESPONSE' } });
  } finally { await close(server); }
});

test('the handler permits only same-origin loopback requests and caps declared request size', async () => {
  const { server, origin } = await bridgeServer({ adapter: { analyze: async (value: ReturnType<typeof input>) => ready(value.source) } });
  try {
    assert.deepEqual(await call(origin, input(), { Origin: 'http://example.test' }), { status: 403, body: { version: '0.1', error: 'VISION_FORBIDDEN' } });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS');
    const oversized = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port: address.port, path: '/api/ui-vision', method: 'POST', headers: { Host: `127.0.0.1:${address.port}`, Origin: origin, 'Content-Type': 'application/json', 'Content-Length': String(MAX_REQUEST_BYTES + 1) } }, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', part => { text += part; }); response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) }));
      });
      request.on('error', reject); request.end();
    });
    assert.deepEqual(oversized, { status: 413, body: { version: '0.1', error: 'VISION_REQUEST_LIMIT' } });
  } finally { await close(server); }
});

test('one in-flight analysis is allowed, while provider failures and oversized opaque results stay redacted', async () => {
  let release!: () => void, calls = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { server, origin } = await bridgeServer({ responseLimit: 512, adapter: { analyze: async (value: ReturnType<typeof input>) => {
    calls++;
    if (calls === 1) { await pending; return ready(value.source); }
    if (calls === 2) return { ...ready(value.source), intent: 'x'.repeat(1024) };
    throw new Error('private-token=must-not-leak');
  } } });
  try {
    const first = call(origin, input());
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await call(origin, input()), { status: 429, body: { version: '0.1', error: 'VISION_BUSY' } });
    release();
    assert.equal((await first).status, 200);
    const large = await call(origin, input());
    assert.deepEqual(large, { status: 502, body: { version: '0.1', error: 'VISION_RESPONSE_LIMIT' } });
    assert.deepEqual(await call(origin, input()), { status: 502, body: { version: '0.1', error: 'VISION_ANALYSIS_FAILED' } });
  } finally { await close(server); }
});

test('direct validation rejects unsafe paths and does not accept image MIME claims without matching bytes', () => {
  const unsafe = input(); unsafe.source.path = '../outside.png';
  assert.throws(() => validateVisionRequest(unsafe), /VISION_INVALID_REQUEST/);
  const wrongMime = input(); wrongMime.source.mime = 'image/webp';
  assert.throws(() => validateVisionRequest(wrongMime), /VISION_SOURCE_DIMENSIONS_MISMATCH/);
  const tooLarge = input(); const bytes = Buffer.alloc(MAX_SOURCE_BYTES + 1); png.copy(bytes); tooLarge.source.base64 = bytes.toString('base64');
  tooLarge.source.sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.throws(() => validateVisionRequest(tooLarge), /VISION_INVALID_REQUEST/);
  assert.deepEqual(validateVisionRequest(input()), input());
});

test('a timeout aborts the one provider call without an automatic retry', async () => {
  let calls = 0, aborted = false;
  const { server, origin } = await bridgeServer({ timeoutMs: 15, adapter: { analyze: async (_value: unknown, { signal }: { signal: AbortSignal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('provider timeout detail')); }, { once: true }));
  } } });
  try {
    assert.deepEqual(await call(origin, input()), { status: 504, body: { version: '0.1', error: 'VISION_TIMEOUT' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); assert.equal(aborted, true);
  } finally { await close(server); }
});

test('a disconnected browser aborts the adapter signal without leaking a provider failure response', async () => {
  let begin!: () => void, observedAbort = false;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const { server, origin } = await bridgeServer({ adapter: { analyze: async (_value: unknown, { signal }: { signal: AbortSignal }) => {
    begin();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { observedAbort = true; reject(new Error('private disconnect detail')); }, { once: true }));
  } } });
  const controller = new AbortController();
  const payload = JSON.stringify(input());
  try {
    const flight = fetch(`${origin}/api/ui-vision`, { method: 'POST', signal: controller.signal,
      headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }, body: payload });
    await started;
    controller.abort();
    await assert.rejects(flight);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(observedAbort, true);
  } finally { await close(server); }
});
