import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { analyze, buildInstruction, poll, submit } from '../scripts/studio-mcp-vision.mjs';

const sourceBytes = Buffer.from([137, 80, 78, 71]);
const source = () => ({
  path: 'assets/reference.png', sha256: createHash('sha256').update(sourceBytes).digest('hex'), width: 32, height: 16,
  mime: 'image/png', base64: sourceBytes.toString('base64'),
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function sseResponse(value: unknown): Response {
  return new Response(`event: message\ndata: ${JSON.stringify(value)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}

async function configured<T>(callback: (stateDirectory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'ui-studio-mcp-vision-'));
  const keyFile = join(directory, 'key.txt');
  await writeFile(keyFile, 'fixture-key\n');
  const before = {
    url: process.env.UI_VISION_MCP_URL,
    key: process.env.UI_VISION_MCP_KEY_FILE,
    state: process.env.UI_VISION_MCP_STATE_DIR,
    fetch: globalThis.fetch,
  };
  process.env.UI_VISION_MCP_URL = 'https://vision.example.test/mcp';
  process.env.UI_VISION_MCP_KEY_FILE = keyFile;
  process.env.UI_VISION_MCP_STATE_DIR = join(directory, 'private-state');
  try { return await callback(process.env.UI_VISION_MCP_STATE_DIR); }
  finally {
    if (before.url === undefined) delete process.env.UI_VISION_MCP_URL; else process.env.UI_VISION_MCP_URL = before.url;
    if (before.key === undefined) delete process.env.UI_VISION_MCP_KEY_FILE; else process.env.UI_VISION_MCP_KEY_FILE = before.key;
    if (before.state === undefined) delete process.env.UI_VISION_MCP_STATE_DIR; else process.env.UI_VISION_MCP_STATE_DIR = before.state;
    globalThis.fetch = before.fetch;
  }
}

function readyEnvelope() {
  return {
    version: '0.1', sourceSha256: source().sha256, status: 'Ready', summary: 'A single observed image.',
    intent: { intentVersion: '0.2', id: 'observed', root: {} },
    policy: { canvas: { width: 32, height: 16 }, layout: {}, layoutSource: { kind: 'measured', description: 'Observed source bounds.' } },
  };
}

test('short submit/poll keeps one task through a transport retry, running receipt, and normalized Ready result', async () => {
  await configured(async stateDirectory => {
    const calls: Array<{ request: Record<string, unknown>; headers: Headers }> = [];
    const { policy, ...prefix } = readyEnvelope();
    const wireDescription = JSON.stringify(prefix) + ',"policy":' + JSON.stringify(policy) + '}';
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ request, headers: new Headers(init?.headers) });
      if (calls.length === 1) return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (calls.length === 2) {
        const files = await readdir(stateDirectory);
        const submissionFile = files.find(file => file.endsWith('.submission.json'));
        assert.ok(submissionFile, 'submission must exist before tools/call');
        const persisted = JSON.parse(await readFile(join(stateDirectory, submissionFile!), 'utf8'));
        assert.equal(persisted.status, 'prepared');
        assert.deepEqual(persisted.args, (request.params as { arguments: unknown }).arguments);
        const args = (request.params as { arguments: { submissionId: string } }).arguments;
        return jsonResponse({ jsonrpc: '2.0', id: 2, result: { structuredContent: {
          status: 'queued', taskId: 'task-01', pollAfterSeconds: 1, submissionId: args.submissionId, service: 'fixture-vision', tool: 'vision', queuePosition: 2,
        } } });
      }
      if (calls.length === 3) throw new TypeError('fixture read connection interrupted');
      if (calls.length === 4) return jsonResponse({ jsonrpc: '2.0', id: 3, result: { structuredContent: {
        status: 'running', taskId: 'task-01', pollAfterSeconds: 1, service: 'fixture-vision', progressPercent: 60,
      } } });
      return sseResponse({ jsonrpc: '2.0', id: 3, result: { structuredContent: {
        status: 'completed', taskId: 'task-01', service: 'fixture-vision', result: {
          description: `\`\`\`json\n${wireDescription}\n\`\`\``, imageCount: 1, targetImageNumber: 1, targetImageFound: true, providerLabel: 'fixture-result',
        },
      } } });
    };

    const first = await submit({ version: '0.1', source: source() });
    assert.equal(first.status, 'Pending');
    assert.match(first.analysisId, /^[0-9a-f-]{36}$/);
    const resumed = await submit({ version: '0.1', source: source() });
    assert.deepEqual(resumed, first, 'lost browser response must resume the same submission');
    assert.equal(calls.length, 2);
    const running = await poll(first.analysisId);
    assert.deepEqual(running, { ...first, pollAfterSeconds: 1 });
    const result = await poll(first.analysisId);
    assert.equal(result.status, 'Ready');
    assert.equal(calls.length, 5);
    assert.equal(calls.filter(call => (call.request.params as any)?.name === 'vision').length, 1);
    for (const call of calls.slice(2)) assert.deepEqual(call.request.params, { name: 'get_task', arguments: { taskId: 'task-01' } });
    assert.equal(calls[1].request.method, 'tools/call');
    assert.deepEqual(calls[1].request.params, {
      name: 'vision', arguments: (calls[1].request.params as { arguments: Record<string, unknown> }).arguments,
    });
    assert.equal(calls[1].headers.get('authorization'), 'Bearer fixture-key');
    assert.equal(calls[1].headers.get('content-type'), 'application/json');
    assert.equal(calls[1].headers.get('accept'), 'application/json,text/event-stream');
    assert.equal(calls[1].headers.get('mcp-protocol-version'), '2025-11-25');
    const records = await Promise.all((await readdir(stateDirectory)).map(async file => ({ file, text: await readFile(join(stateDirectory, file), 'utf8') })));
    assert.equal(records.some(record => record.text.includes('fixture-key')), false);
    const receipt = JSON.parse(records.find(record => record.file.endsWith('.receipt.json'))!.text);
    assert.deepEqual(receipt.status, 'completed');
    assert.deepEqual(receipt.taskId, 'task-01');
    const normalized = JSON.parse(records.find(record => record.file.endsWith('.normalization.json'))!.text);
    assert.equal(normalized.kind, 'remove-premature-envelope-close');
    const rawResult = JSON.parse(records.find(record => record.file.endsWith('.raw-result.json'))!.text);
    assert.ok(rawResult.structuredContent.result.description.includes(wireDescription));
    assert.deepEqual(result, readyEnvelope());
    assert.deepEqual(await analyze({ version: '0.1', source: source() }), readyEnvelope(), 'legacy analyze reuses the completed record');
    assert.equal(calls.length, 5);
  });
});

test('adapter never resubmits after an indeterminate task poll and writes a private terminal receipt', async () => {
  await configured(async stateDirectory => {
    let visionCalls = 0; let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body)) as { id: number; params?: { name?: string } };
      if (request.id === 1) return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (request.params?.name === 'vision') {
        visionCalls++;
        return jsonResponse({ jsonrpc: '2.0', id: 2, result: { structuredContent: {
          status: 'queued', taskId: 'task-02', pollAfterSeconds: 1, submissionId: 'accepted-by-fixture', service: 'fixture-vision', queuePosition: 3,
        } } });
      }
      throw new TypeError('fixture transport outage');
    };

    const pending = await submit({ version: '0.1', source: source() });
    await assert.rejects(poll(pending.analysisId), /MCP_TASK_INDETERMINATE/);
    assert.equal(calls, 5);
    assert.equal(visionCalls, 1);
    const receiptFile = (await readdir(stateDirectory)).find(file => file.endsWith('.receipt.json'));
    assert.ok(receiptFile);
    const receipt = JSON.parse(await readFile(join(stateDirectory, receiptFile!), 'utf8'));
    assert.deepEqual(receipt, { version: '0.1', submissionId: receipt.submissionId, status: 'indeterminate', taskId: 'task-02', pollAfterSeconds: 1, reason: 'poll' });
  });
});

test('adapter returns an exact Unresolved envelope instead of inventing a renderable fallback', async () => {
  await configured(async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (call === 2) return jsonResponse({ jsonrpc: '2.0', id: 2, result: { structuredContent: {
        status: 'queued', taskId: 'task-03', pollAfterSeconds: 1, service: 'fixture-vision', tool: 'vision', queuePosition: 1,
      } } });
      return jsonResponse({ jsonrpc: '2.0', id: 3, result: { structuredContent: {
        status: 'completed', taskId: 'task-03', service: 'fixture-vision', result: {
          description: JSON.stringify({ version: '0.1', sourceSha256: source().sha256, status: 'Unresolved', summary: 'The source does not show every required value.' }),
          imageCount: 1, targetImageNumber: 1, targetImageFound: true,
        },
      } } });
    };
    const pending = await submit({ version: '0.1', source: source() });
    const result = await poll(pending.analysisId);
    assert.deepEqual(result, { version: '0.1', sourceSha256: source().sha256, status: 'Unresolved', summary: 'The source does not show every required value.' });
    assert.equal(Object.hasOwn(result, 'intent'), false);
    assert.equal(Object.hasOwn(result, 'policy'), false);
  });
});

test('submit restores a byte-for-byte matching completed raw result without a provider read', async () => {
  await configured(async stateDirectory => {
    const analysisId = '11111111-1111-4111-8111-111111111111';
    const image = source();
    const instruction = buildInstruction(image, sourceBytes.length);
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(join(stateDirectory, `${analysisId}.submission.json`), JSON.stringify({
      version: '0.1', submissionId: analysisId, status: 'prepared',
      source: { path: image.path, sha256: image.sha256, width: image.width, height: image.height, mime: image.mime },
      args: { submissionId: analysisId, images: [{ mimeType: image.mime, data: image.base64 }], instruction, targetImageNumber: 1 },
    }));
    await writeFile(join(stateDirectory, `${analysisId}.raw-result.json`), JSON.stringify({
      version: '0.1', submissionId: analysisId, sourceSha256: image.sha256, taskId: 'opaque-provider-task', status: 'completed',
      structuredContent: { status: 'completed', taskId: 'opaque-provider-task', result: {
        description: JSON.stringify(readyEnvelope()), imageCount: 1, targetImageNumber: 1, targetImageFound: true,
      } },
    }));
    globalThis.fetch = async () => { throw new Error('cached submit must not contact the provider'); };
    assert.deepEqual(await submit({ version: '0.1', source: image }), readyEnvelope());
    assert.deepEqual(await poll(analysisId), readyEnvelope(), 'a repeated poll recovers the raw completion without a provider read');
  });
  await assert.rejects(poll('../not-an-analysis'), /MCP_ANALYSIS_ID_INVALID/);
});

test('submit resumes a matching pending submission whose persisted image payload exceeds one MiB', async () => {
  await configured(async stateDirectory => {
    const analysisId = '22222222-2222-4222-8222-222222222222';
    const bytes = Buffer.alloc(800 * 1024, 7);
    const image = {
      path: 'assets/large-reference.png', sha256: createHash('sha256').update(bytes).digest('hex'), width: 800, height: 1024,
      mime: 'image/png', base64: bytes.toString('base64'),
    };
    const instruction = buildInstruction(image, bytes.length);
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(join(stateDirectory, `${analysisId}.submission.json`), JSON.stringify({
      version: '0.1', submissionId: analysisId, status: 'prepared',
      source: { path: image.path, sha256: image.sha256, width: image.width, height: image.height, mime: image.mime },
      args: { submissionId: analysisId, images: [{ mimeType: image.mime, data: image.base64 }], instruction, targetImageNumber: 1 },
    }));
    await writeFile(join(stateDirectory, `${analysisId}.receipt.json`), JSON.stringify({
      version: '0.1', submissionId: analysisId, status: 'pending', taskId: 'opaque-large-task', pollAfterSeconds: 7,
    }));
    globalThis.fetch = async () => { throw new Error('pending recovery must not contact the provider'); };
    assert.deepEqual(await submit({ version: '0.1', source: image }), {
      version: '0.1', sourceSha256: image.sha256, status: 'Pending', analysisId, pollAfterSeconds: 7,
    });
  });
});

test('adapter refuses over-limit images before contact and makes unresolved output explicit without a fallback', async () => {
  await configured(async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error('must remain offline'); };
    const oversized = { ...source(), base64: Buffer.alloc((2 * 1024 * 1024) + 1).toString('base64') };
    await assert.rejects(analyze({ version: '0.1', source: oversized }), /VISION_SOURCE_SIZE_LIMIT/);
    assert.equal(called, false);
    const instruction = buildInstruction(source(), 4);
    assert.ok(instruction.includes('Switch{label,checked,enabled,style}'));
    assert.ok(instruction.includes('fontWeight:"normal"|"bold"'));
    assert.ok(instruction.includes('tabs:[{id,label,contentId}]'));
    assert.ok(instruction.includes('Do not use Button as a fallback'));
    assert.ok(instruction.length >= 1 && instruction.length <= 4096);
  });
});
