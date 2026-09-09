import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildContractInstruction, buildObservationInstruction, contractTemplateDigest, observationTemplateDigest,
  pipelineInstructionVersion, pipelineTemplateDigest, poll, submit,
} from '../scripts/studio-staged-vision.mjs';

const bytes = Buffer.from([137, 80, 78, 71]);
const source = () => ({
  path: 'assets/reference.png', sha256: createHash('sha256').update(bytes).digest('hex'), width: 32, height: 16,
  mime: 'image/png', base64: bytes.toString('base64'),
});
function json(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
async function configured<T>(callback: (state: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'ui-staged-vision-'));
  const key = join(directory, 'key.txt'); await writeFile(key, 'fixture-key\n');
  const before = { url: process.env.UI_VISION_MCP_URL, key: process.env.UI_VISION_MCP_KEY_FILE, state: process.env.UI_VISION_MCP_STATE_DIR, fetch: globalThis.fetch };
  process.env.UI_VISION_MCP_URL = 'https://vision.example.test/mcp'; process.env.UI_VISION_MCP_KEY_FILE = key; process.env.UI_VISION_MCP_STATE_DIR = join(directory, 'private');
  try { return await callback(process.env.UI_VISION_MCP_STATE_DIR); }
  finally {
    if (before.url === undefined) delete process.env.UI_VISION_MCP_URL; else process.env.UI_VISION_MCP_URL = before.url;
    if (before.key === undefined) delete process.env.UI_VISION_MCP_KEY_FILE; else process.env.UI_VISION_MCP_KEY_FILE = before.key;
    if (before.state === undefined) delete process.env.UI_VISION_MCP_STATE_DIR; else process.env.UI_VISION_MCP_STATE_DIR = before.state;
    globalThis.fetch = before.fetch;
  }
}
function observation() {
  return {
    version: '0.2', sourceSha256: source().sha256, status: 'Observed', summary: 'A framed sound toggle.', components: [
      { id: 'root', parentId: null, componentType: 'Container', bounds: { x: 0, y: 0, width: 32, height: 16 }, evidence: 'A visible framed group.', visibleProps: {} },
      { id: 'sound', parentId: 'root', componentType: 'Switch', bounds: { x: 4, y: 4, width: 24, height: 8 }, evidence: 'A track, thumb, and Sound label.', visibleProps: { label: 'Sound', checked: true } },
    ],
  };
}
function contract() {
  return {
    version: '0.2', sourceSha256: source().sha256, status: 'Ready', summary: 'A framed sound toggle.', classification: 'composite',
    observedTypes: ['Container', 'Switch'], documentId: 'sound-control', canvas: { width: 32, height: 16 },
    styles: [{ id: 'surface', backgroundColor: '#FFFFFF', borderColor: '#000000', borderWidth: 1, cornerRadius: 2, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'normal', opacity: 1 }],
    nodes: [
      { id: 'root', parentId: null, componentType: 'Container', styleId: 'surface', props: {}, layout: { x: 0, y: 0, width: 32, height: 16 } },
      { id: 'sound', parentId: 'root', componentType: 'Switch', styleId: 'surface', props: { label: 'Sound', checked: true, enabled: true }, layout: { x: 4, y: 4, width: 24, height: 8 } },
    ],
  };
}
function queued(taskId: string) { return { status: 'queued', taskId, pollAfterSeconds: 1 }; }
function completed(taskId: string, description: unknown) {
  return { status: 'completed', taskId, result: { description: JSON.stringify(description), imageCount: 1, targetImageNumber: 1, targetImageFound: true } };
}

test('staged pipeline advances one observed task to one contract task and then restores its final result', async () => {
  await configured(async state => {
    const calls: Record<string, unknown>[] = [];
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push(request);
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if ((request.params as any).name === 'vision') {
        const args = (request.params as any).arguments;
        return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued(args.instruction.includes('Return exactly Observed {version:"0.2"') ? 'observation-task' : 'contract-task') } });
      }
      const taskId = (request.params as any).arguments.taskId;
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: taskId === 'observation-task' ? completed(taskId, observation()) : completed(taskId, contract()) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    assert.equal(first.status, 'Pending');
    const repeated = await submit({ version: '0.1', source: source() });
    assert.deepEqual(repeated, first, 'a repeated POST recovers the same observation task');
    assert.equal(calls.length, 2);
    const contractPending = await poll(first.analysisId);
    assert.deepEqual(contractPending, { ...first, pollAfterSeconds: 1 });
    assert.equal(calls.length, 5, 'only the validated observation starts the contract task');
    const visionCalls = calls.filter(call => (call.params as any)?.name === 'vision');
    assert.equal(visionCalls.length, 2);
    const contractInstruction = (visionCalls[1].params as any).arguments.instruction as string;
    assert.ok(contractInstruction.includes('Verified observation tuples [id,parentId,componentType,visibleProps]'));
    assert.ok(contractInstruction.includes('["root",null,"Container",{}]'));
    assert.equal((visionCalls[1].params as any).arguments.instruction.includes('A track, thumb'), false, 'evidence is never forwarded to stage two');
    const result = await poll(first.analysisId);
    assert.deepEqual(result, { version: '0.3', sourceSha256: source().sha256, status: 'Ready', summary: contract().summary, observation: observation(), contract: contract() });
    assert.equal(calls.length, 6);
    assert.deepEqual(await poll(first.analysisId), result, 'the cached staged final needs no provider read');
    assert.equal(calls.length, 6);
    const pipelines = (await readdir(state)).filter(file => file.endsWith('.staged-pipeline.json'));
    assert.equal(pipelines.length, 1);
    const stored = JSON.parse(await readFile(join(state, pipelines[0]), 'utf8'));
    assert.equal(stored.templates.pipeline, pipelineTemplateDigest);
    assert.equal(stored.templates.observation, observationTemplateDigest);
    assert.equal(stored.templates.contract, contractTemplateDigest);
  });
});

test('a non-ready observation never creates a contract submission', async () => {
  await configured(async () => {
    let calls = 0; let visionCalls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if ((request.params as any).name === 'vision') { visionCalls++; return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued('observation-unresolved') } }); }
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completed('observation-unresolved', { version: '0.2', sourceSha256: source().sha256, status: 'Unresolved', summary: 'Hidden tab content is not visible.' }) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    const result = await poll(first.analysisId);
    assert.deepEqual(result, { version: '0.3', sourceSha256: source().sha256, status: 'Unresolved', summary: 'Hidden tab content is not visible.', observation: { version: '0.2', sourceSha256: source().sha256, status: 'Unresolved', summary: 'Hidden tab content is not visible.' }, contract: null });
    assert.equal(visionCalls, 1);
    assert.equal(calls, 3);
  });
});

test('staged templates are source-bound, omit observation evidence from contract prompts, and stay bounded', () => {
  const input = { path: 'assets/64hash.png', sha256: 'a'.repeat(64), width: 320, height: 180, mime: 'image/png' };
  const observed = { ...observation(), sourceSha256: input.sha256 };
  const observationInstruction = buildObservationInstruction(input, 1024);
  const contractInstruction = buildContractInstruction(input, 1024, observed);
  assert.ok(HASH_TEST(observationTemplateDigest) && HASH_TEST(contractTemplateDigest) && HASH_TEST(pipelineTemplateDigest));
  assert.ok(observationInstruction.includes('evidence'));
  assert.ok(observationInstruction.includes('Tabs report visible labels only'));
  assert.ok(contractInstruction.includes('Verified observation tuples [id,parentId,componentType,visibleProps]'));
  assert.ok(contractInstruction.includes('["root",null,"Container",{}]'));
  assert.equal(contractInstruction.includes('A track, thumb'), false);
  assert.equal(contractInstruction.includes('"evidence"'), false);
  assert.ok(observationInstruction.length <= 4096 && contractInstruction.length <= 4096);
});

test('a current pipeline rejects an observation protocol downgrade before submitting a contract', async () => {
  await configured(async () => {
    let submissions = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (request.params.name === 'vision') {
        submissions++;
        return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued('old-observation') } });
      }
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completed('old-observation', { ...observation(), version: '0.1' }) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    await assert.rejects(poll(first.analysisId), /VISION_OBSERVATION_INVALID/);
    assert.equal(submissions, 1);
  });
});

test('cached pipeline and observation submission prompts must retain their exact digests and binding', async () => {
  await configured(async state => {
    const pipelineId = '11111111-1111-1111-1111-111111111111', stageId = '22222222-2222-2222-2222-222222222222';
    const currentSource = source();
    const instruction = buildObservationInstruction(currentSource, bytes.length);
    const pipeline = {
      version: '0.1', kind: 'staged-v0.3', pipelineId, source: { path: currentSource.path, sha256: currentSource.sha256, width: currentSource.width, height: currentSource.height, mime: currentSource.mime },
      templates: { version: pipelineInstructionVersion, pipeline: pipelineTemplateDigest, observation: observationTemplateDigest, contract: contractTemplateDigest },
      observation: { submissionId: stageId, template: observationTemplateDigest, instruction, instructionDigest: createHash('sha256').update('different prompt').digest('hex') },
    };
    await mkdir(state, { recursive: true });
    await writeFile(join(state, `${pipelineId}.staged-pipeline.json`), JSON.stringify(pipeline));
    globalThis.fetch = async () => { throw new Error('invalid pipeline must not contact a provider'); };
    await assert.rejects(poll(pipelineId), /MCP_PIPELINE_RECORD_INVALID/);

    pipeline.observation.instructionDigest = createHash('sha256').update(instruction).digest('hex');
    await writeFile(join(state, `${pipelineId}.staged-pipeline.json`), JSON.stringify(pipeline));
    await writeFile(join(state, `${stageId}.submission.json`), JSON.stringify({
      version: '0.1', submissionId: stageId, kind: 'observation', status: 'prepared', source: pipeline.source,
      args: { submissionId: stageId, images: [{ mimeType: currentSource.mime, data: currentSource.base64 }], instruction: 'mismatched persisted prompt', targetImageNumber: 1 },
    }));
    await assert.rejects(poll(pipelineId), /MCP_PIPELINE_RECORD_INVALID/);
  });
});

test('a stored contract gate cannot replace the v0.2 policy-bound instruction', async () => {
  await configured(async state => {
    let visionSubmissions = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as any;
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (request.params.name === 'vision') { visionSubmissions++; return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued('observation-forged-gate') } }); }
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completed('observation-forged-gate', observation()) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    const forgedInstruction = 'forged contract prompt';
    await writeFile(join(state, `${first.analysisId}.staged-contract.gate.json`), JSON.stringify({
      version: '0.1', kind: 'staged-contract-gate', pipelineId: first.analysisId, observationDigest: createHash('sha256').update(JSON.stringify(observation())).digest('hex'),
      template: contractTemplateDigest, instruction: forgedInstruction, instructionDigest: createHash('sha256').update(forgedInstruction).digest('hex'),
      submissionId: '33333333-3333-3333-3333-333333333333',
    }));
    await assert.rejects(poll(first.analysisId), /MCP_PIPELINE_RECORD_INVALID/);
    assert.equal(visionSubmissions, 1, 'the forged gate must not open a contract submission');
  });
});

test('semantic prompts distinguish optional image facts from explicit preview policy', () => {
  const observed = { ...observation(), version: '0.2' };
  const instruction = buildObservationInstruction(source(), bytes.length);
  assert.ok(instruction.includes('Every visibleProps field is OPTIONAL'));
  assert.ok(instruction.includes('Image{};Text{text}'));
  const compiledPrompt = buildContractInstruction(source(), bytes.length, observed);
  assert.ok(compiledPrompt.includes('Explicit preview-configuration policy v1 (not image facts)'));
  assert.ok(compiledPrompt.includes('"Switch":{"enabled":true}'));
  assert.ok(compiledPrompt.includes('documentId, node/style/option/item/tab IDs must all be distinct'));
  assert.ok(compiledPrompt.length <= 4096);
  const legacy = buildContractInstruction(source(), bytes.length, { ...observation(), version: '0.1' });
  assert.ok(legacy.includes('No preview policy applies to legacy observations'));
});

test('staged recovery accepts a submission record above one MiB without contacting a provider', async () => {
  await configured(async state => {
    const large = Buffer.alloc(800 * 1024, 7);
    const largeSource = { path: 'assets/large.png', sha256: createHash('sha256').update(large).digest('hex'), width: 800, height: 1024, mime: 'image/png', base64: large.toString('base64') };
    const observationInstruction = buildObservationInstruction(largeSource, large.length);
    const pipelineId = '44444444-4444-4444-8444-444444444444', stageId = '55555555-5555-4555-8555-555555555555';
    const pipeline = {
      version: '0.1', kind: 'staged-v0.3', pipelineId, source: { path: largeSource.path, sha256: largeSource.sha256, width: largeSource.width, height: largeSource.height, mime: largeSource.mime },
      templates: { version: 'staged-vision-v0.3.1', pipeline: pipelineTemplateDigest, observation: observationTemplateDigest, contract: contractTemplateDigest },
      observation: { submissionId: stageId, template: observationTemplateDigest, instruction: observationInstruction, instructionDigest: createHash('sha256').update(observationInstruction).digest('hex') },
    };
    await mkdir(state, { recursive: true });
    await writeFile(join(state, `${pipelineId}.staged-pipeline.json`), JSON.stringify(pipeline));
    await writeFile(join(state, `${stageId}.submission.json`), JSON.stringify({
      version: '0.1', submissionId: stageId, kind: 'observation', status: 'prepared', source: pipeline.source,
      args: { submissionId: stageId, images: [{ mimeType: largeSource.mime, data: largeSource.base64 }], instruction: observationInstruction, targetImageNumber: 1 },
    }));
    globalThis.fetch = async () => { throw new Error('large staged recovery must remain offline'); };
    await assert.rejects(poll(pipelineId), /MCP_RECEIPT_RECORD_INVALID/);
  });
});

test('two concurrent observation polls share one receipt transition and create one contract vision task', async () => {
  await configured(async state => {
    let observationReads = 0; let releaseObservation: (() => void) | undefined;
    let observationRead: (() => void) | undefined;
    const observationStarted = new Promise<void>(resolve => { observationRead = resolve; });
    let contractVisionCalls = 0; let completeContract = false;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as any;
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (request.params.name === 'vision') {
        if (request.params.arguments.instruction.includes('Return exactly Observed')) return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued('observation-concurrent') } });
        contractVisionCalls++;
        return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued('contract-concurrent') } });
      }
      const taskId = request.params.arguments.taskId;
      if (taskId === 'observation-concurrent') return new Promise(resolve => {
        observationReads++;
        observationRead!();
        releaseObservation = () => resolve(json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completed(taskId, observation()) } }));
      });
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completeContract ? completed(taskId, contract()) : queued(taskId) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    const concurrent = Promise.all([poll(first.analysisId), poll(first.analysisId)]);
    await observationStarted;
    assert.equal(observationReads, 1, 'concurrent callers share one provider task read');
    releaseObservation!();
    const both = await concurrent;
    assert.deepEqual(both, [{ ...first, pollAfterSeconds: 1 }, { ...first, pollAfterSeconds: 1 }]);
    assert.equal(contractVisionCalls, 1);
    const receipts = await Promise.all((await readdir(state)).filter(file => file.endsWith('.receipt.json')).map(async file => JSON.parse(await readFile(join(state, file), 'utf8'))));
    const observationReceipt = receipts.find(receipt => receipt.taskId === 'observation-concurrent');
    assert.equal(observationReceipt?.status, 'completed');
    assert.equal(observationReceipt?.pollAfterSeconds, 1);
    assert.equal(observationReceipt?.resultStatus, 'Observed');
    completeContract = true;
    assert.equal((await poll(first.analysisId)).status, 'Ready');
  });
});

test('an indeterminate contract submit remains terminal and never opens another contract task', async () => {
  await configured(async () => {
    let contractVisionCalls = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as any;
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (request.params.name === 'vision') {
        if (request.params.arguments.instruction.includes('Return exactly Observed')) return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued('observation-indeterminate') } });
        contractVisionCalls++; throw new TypeError('fixture submit connection lost');
      }
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completed('observation-indeterminate', observation()) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    await assert.rejects(poll(first.analysisId), /MCP_SUBMISSION_INDETERMINATE/);
    await assert.rejects(poll(first.analysisId), /MCP_TASK_INDETERMINATE/);
    assert.equal(contractVisionCalls, 1);
    assert.deepEqual(await submit({ version: '0.1', source: source() }), first);
    assert.equal(contractVisionCalls, 1);
  });
});

test('an invalid observation fails before contract submission', async () => {
  await configured(async () => {
    let visionCalls = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as any;
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (request.params.name === 'vision') { visionCalls++; return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued('observation-invalid') } }); }
      const invalid = observation(); invalid.components[1].visibleProps = { label: 'Sound', checked: 'true' };
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completed('observation-invalid', invalid) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    await assert.rejects(poll(first.analysisId), /MCP_TASK_FAILED/);
    assert.equal(visionCalls, 1);
  });
});

test('a non-ready contract produces the matching v0.3 result after a valid observation', async () => {
  await configured(async () => {
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as any;
      if (request.id === 1) return json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'vision' }, { name: 'get_task' }] } });
      if (request.params.name === 'vision') return json({ jsonrpc: '2.0', id: 2, result: { structuredContent: queued(request.params.arguments.instruction.includes('Return exactly Observed') ? 'observation-contract-nonready' : 'contract-nonready') } });
      const taskId = request.params.arguments.taskId;
      const result = taskId === 'observation-contract-nonready' ? observation() : { version: '0.2', sourceSha256: source().sha256, status: 'Unresolved', summary: 'A hidden required value is not visible.' };
      return json({ jsonrpc: '2.0', id: 3, result: { structuredContent: completed(taskId, result) } });
    };
    const first = await submit({ version: '0.1', source: source() });
    assert.equal((await poll(first.analysisId)).status, 'Pending');
    const result = await poll(first.analysisId);
    assert.deepEqual(result, { version: '0.3', sourceSha256: source().sha256, status: 'Unresolved', summary: 'A hidden required value is not visible.', observation: observation(), contract: { version: '0.2', sourceSha256: source().sha256, status: 'Unresolved', summary: 'A hidden required value is not visible.' } });
  });
});

function HASH_TEST(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
