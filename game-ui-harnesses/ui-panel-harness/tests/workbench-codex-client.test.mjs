import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCodexBridge, requestCodexProposal, requestCodexEditProposal } from '../src/workbench-codex-client.mjs';
import { createCodexDiagnostic, createCodexMessageDiagnostic } from '../src/codex-diagnostics.mjs';

const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const capability = { protocol: '0.1', model: 'gpt-6-luna', effort: 'xhigh', available: true };
const context = { sha256: 'a'.repeat(64), request: { text: '一段完整需求' } };
const signal = () => new AbortController().signal;

test('message diagnostics cross the client only when bound and structurally safe', async () => {
  for (const editing of [false, true]) {
    const operation = editing ? 'edit' : 'plan';
    const diagnostic = createCodexMessageDiagnostic('OUTPUT_MESSAGE_EMPTY',
      { eventCount: 3, completedAgentMessages: 1, acceptedFinalMessages: 0 }, { operation, contextSha256: context.sha256 });
    for (const change of [{}, { contextSha256: 'c'.repeat(64) }, { operation: editing ? 'plan' : 'edit' },
      { stream: { ...diagnostic.stream, rawText: 'SECRET' } }, { proposalJsonSha256: 'd'.repeat(64) }]) {
      let caught, calls = 0;
      await assert.rejects((editing ? requestCodexEditProposal : requestCodexProposal)(context, signal(), async () => {
        calls++; return response({ code: 'CODEX_OUTPUT_INVALID', diagnostic: { ...diagnostic, ...change } }, 502);
      }), error => { caught = error; return error.code === 'CODEX_OUTPUT_INVALID'; });
      assert.equal(calls, 1); assert.equal(Boolean(caught.diagnostic), Object.keys(change).length === 0);
      assert(!JSON.stringify(caught).includes('SECRET'));
    }
  }
});

test('file previews and other sites never probe a local model service', async () => {
  const forbidden = async () => { assert.fail('No fetch allowed'); };
  for (const url of ['file:///preview/index.html', 'https://example.com/', 'http://localhost:4184/', 'http://evil.example/'])
    assert.equal(await detectCodexBridge(new URL(url), forbidden), null);
});

test('bridge detection is read-only, same-origin and requires the exact configured model and effort', async () => {
  const location = new URL('http://127.0.0.1:4184/');
  const detected = await detectCodexBridge(location, async (url, options) => {
    assert.equal(url, '/api/panel/capabilities'); assert.equal(options.mode, 'same-origin');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert(!options.body);
    return response(capability);
  });
  assert.deepEqual(detected, { available: true, editingAvailable: false, model: 'gpt-6-luna', effort: 'xhigh' });
  for (const changed of [{ model: 'different' }, { effort: 'low' }, { protocol: '2' }, { available: 'true' }])
    assert.equal(await detectCodexBridge(location, async () => response({ ...capability, ...changed })), null);
  assert.equal(await detectCodexBridge(location, async () => new Response('static fallback', { status: 404 })), null);
});

test('editing capability is explicit; edit transport binds one request and never retries mismatches or failures', async () => {
  const location = new URL('http://127.0.0.1:4184/');
  assert.equal((await detectCodexBridge(location, async () => response({ ...capability, editingAvailable: true }))).editingAvailable, true);
  assert.equal(await detectCodexBridge(location, async () => response({ ...capability, editingAvailable: 'true' })), null);
  for (const behavior of ['ready', 'mismatch', 'network']) {
    let calls = 0;
    const pending = requestCodexEditProposal(context, signal(), async (url, options) => {
      calls++; assert.equal(url, '/api/panel/edit'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body); assert.deepEqual(body.context, context);
      if (behavior === 'network') throw new TypeError('private details');
      return response({ protocol: '0.1', requestId: body.requestId, contextSha256: context.sha256,
        proposal: { contextSha256: behavior === 'mismatch' ? 'b'.repeat(64) : context.sha256 } });
    });
    if (behavior === 'ready') await pending;
    else await assert.rejects(pending, { code: behavior === 'network' ? 'CODEX_BRIDGE_NETWORK_FAILED' : 'CODEX_BRIDGE_CONTEXT_MISMATCH' });
    assert.equal(calls, 1);
  }
});

test('one model request sends the untouched context and binds its returned result to a fresh request ID', async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    assert.equal(url, '/api/panel/plan'); assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body); seen.push(body.requestId);
    assert.deepEqual(Object.keys(body).sort(), ['context', 'requestId']); assert.deepEqual(body.context, context);
    return response({ protocol: '0.1', requestId: body.requestId, contextSha256: context.sha256,
      proposal: { contextSha256: context.sha256 }, report: {}, receipt: {} });
  };
  await requestCodexProposal(context, signal(), fetcher); await requestCodexProposal(context, signal(), fetcher);
  assert.equal(seen.length, 2); assert.notEqual(seen[0], seen[1]);
});

test('response mismatches cannot apply a proposal from another request or context', async () => {
  for (const change of [{ protocol: '2' }, { requestId: 'other' }, { contextSha256: 'b'.repeat(64) }, { proposal: {} }]) {
    await assert.rejects(requestCodexProposal(context, signal(), async (_url, options) => response({
      protocol: '0.1', requestId: JSON.parse(options.body).requestId, contextSha256: context.sha256,
      proposal: { contextSha256: context.sha256 }, ...change,
    })), { code: 'CODEX_BRIDGE_CONTEXT_MISMATCH' });
  }
});

test('transport failures and cancellation never retry or expose raw server error messages', async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestCodexProposal(context, controller.signal, async (_url, options) => {
    calls++; assert.equal(options.signal, controller.signal); throw new DOMException('Aborted', 'AbortError');
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(requestCodexProposal(context, signal(), async () => { calls++; throw new TypeError('private host failed'); }), { code: 'CODEX_BRIDGE_NETWORK_FAILED' });
  assert.equal(calls, 1);
  await assert.rejects(requestCodexProposal(context, signal(), async () => response({ code: 'CODEX_BUSY' }, 409)), { code: 'CODEX_BUSY' });
  await assert.rejects(requestCodexProposal(context, signal(), async () => response({ code: 'private/path?key=secret', message: 'secret' }, 500)), { code: 'CODEX_BRIDGE_FAILED' });
});

test('non-JSON and oversized bridge outputs are rejected before proposal handling', async () => {
  await assert.rejects(requestCodexProposal(context, signal(), async () => new Response('<html>not a bridge</html>')), { code: 'CODEX_BRIDGE_RESPONSE' });
  await assert.rejects(requestCodexProposal(context, signal(), async () => response({ value: 'a'.repeat(2 * 1024 * 1024) })), { code: 'CODEX_BRIDGE_RESPONSE_LIMIT' });
});

test('validation failures carry only safe diagnostics bound to this operation and context', async () => {
  const diagnostic = createCodexDiagnostic({ code: 'PLAN_COVERAGE', path: '$.decisions', message: 'SECRET_VALUE' },
    { operation: 'plan', contextSha256: context.sha256, proposalJsonSha256: 'b'.repeat(64), stage: 'proposal-validation' });
  for (const change of [{}, { operation: 'edit' }, { contextSha256: 'c'.repeat(64) }, { message: 'secret' }, { path: '$.secret' }]) {
    let caught, calls = 0;
    await assert.rejects(requestCodexProposal(context, signal(), async () => {
      calls++; return response({ code: 'CODEX_PROPOSAL_INVALID', diagnostic: { ...diagnostic, ...change } }, 502);
    }), error => { caught = error; return error.code === 'CODEX_PROPOSAL_INVALID'; });
    assert.equal(calls, 1);
    assert.equal(Boolean(caught.diagnostic), Object.keys(change).length === 0);
    assert.equal(JSON.stringify(caught).includes('SECRET_VALUE'), false);
  }
});

test('output format diagnostics survive the client only with their original binding and fixed paths', async () => {
  const diagnostic = createCodexDiagnostic({ code: 'OUTPUT_JSON', path: '$' },
    { operation: 'plan', contextSha256: context.sha256, proposalJsonSha256: 'd'.repeat(64), stage: 'output-validation' });
  for (const change of [{}, { operation: 'edit' }, { path: '$.state' }, { stage: 'proposal-check' }, { rawOutput: 'SECRET_VALUE' }]) {
    let caught, calls = 0;
    await assert.rejects(requestCodexProposal(context, signal(), async () => {
      calls++; return response({ code: 'CODEX_OUTPUT_INVALID', diagnostic: { ...diagnostic, ...change } }, 502);
    }), error => { caught = error; return error.code === 'CODEX_OUTPUT_INVALID'; });
    assert.equal(Boolean(caught.diagnostic), Object.keys(change).length === 0); assert.equal(calls, 1);
    assert.equal(JSON.stringify(caught).includes('SECRET_VALUE'), false);
  }
});

test('edit result cause crosses the client only as safe schema fields bound to the current edit', async () => {
  const diagnostic = createCodexDiagnostic({ code: 'EDIT_RESULT_SPEC', path: '$.patch', cause: {
    code: 'text', path: '$.sections[0].rows[1].validation.requiredMessage', message: 'SECRET',
  } }, { operation: 'edit', contextSha256: context.sha256, proposalJsonSha256: 'e'.repeat(64), stage: 'proposal-validation' });
  for (const change of [{}, { cause: { ...diagnostic.cause, message: 'SECRET' } }, { operation: 'plan' }]) {
    let calls = 0, caught;
    await assert.rejects(requestCodexEditProposal(context, signal(), async () => {
      calls++; return response({ code: 'CODEX_PROPOSAL_INVALID', diagnostic: { ...diagnostic, ...change } }, 502);
    }), error => { caught = error; return error.code === 'CODEX_PROPOSAL_INVALID'; });
    assert.equal(calls, 1); assert.equal(Boolean(caught.diagnostic), Object.keys(change).length === 0);
    assert(!JSON.stringify(caught).includes('SECRET'));
  }
});

test('complete response readers release their lock without cancellation; incomplete oversized bodies are cancelled', async () => {
  for (const oversized of [false, true]) {
    let reads = 0, cancelled = 0, released = 0;
    const bytes = oversized ? new Uint8Array(2 * 1024 * 1024 + 1) : new TextEncoder().encode(JSON.stringify(capability));
    const fakeResponse = { ok: true, headers: { get: () => 'application/json' }, body: { getReader: () => ({
      async read() { return reads++ ? { done: true } : { done: false, value: bytes }; },
      async cancel() { cancelled++; }, releaseLock() { released++; },
    }) } };
    const result = await detectCodexBridge(new URL('http://127.0.0.1:4184/'), async () => fakeResponse);
    assert.equal(Boolean(result), !oversized); assert.equal(cancelled, oversized ? 1 : 0); assert.equal(released, 1);
    assert.equal(reads, oversized ? 1 : 2);
  }
});
