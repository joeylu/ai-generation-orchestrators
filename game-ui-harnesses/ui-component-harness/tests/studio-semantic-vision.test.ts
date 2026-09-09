import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSemanticVisionAdapter } from '../scripts/studio-semantic-vision.mjs';

const bytes = Buffer.from([137, 80, 78, 71]);
const source = () => ({
  path: 'assets/reference.png', sha256: createHash('sha256').update(bytes).digest('hex'), width: 32, height: 16,
  mime: 'image/png', base64: bytes.toString('base64'),
});
const input = () => ({ version: '0.1', source: source() });
const stageId = '22222222-2222-4222-8222-222222222222';

function observation(status: 'Observed' | 'Unresolved' | 'Custom-required' = 'Observed', version = '0.2') {
  if (status !== 'Observed') return { version, sourceSha256: source().sha256, status, summary: 'The required state is not visible.' };
  return {
    version, sourceSha256: source().sha256, status, summary: 'A visible sound switch.', components: [
      { id: 'root', parentId: null, componentType: 'Container', bounds: { x: 0, y: 0, width: 32, height: 16 }, evidence: 'A visible frame.', visibleProps: {} },
      { id: 'sound', parentId: 'root', componentType: 'Switch', bounds: { x: 4, y: 4, width: 24, height: 8 }, evidence: 'A track, thumb, and Sound label.', visibleProps: { label: 'Sound', checked: true } },
    ],
  };
}
function stagePending(id = stageId) {
  return { version: '0.1', sourceSha256: source().sha256, status: 'Pending', analysisId: id, pollAfterSeconds: 1 };
}
function stageRecord(id: string, instruction: string) {
  const image = source();
  return {
    version: '0.1', submissionId: id, kind: 'observation', status: 'prepared',
    source: { path: image.path, sha256: image.sha256, width: image.width, height: image.height, mime: image.mime },
    args: { submissionId: id, images: [{ mimeType: image.mime, data: image.base64 }], instruction, targetImageNumber: 1 },
  };
}
async function noProvider<T>(callback: () => Promise<T>): Promise<T> {
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('TEST_PROVIDER_CALL_FORBIDDEN'); };
  try { return await callback(); }
  finally { globalThis.fetch = before; }
}

test('semantic adapter submits one v0.2 observation, then polls only that stage and returns an exact v0.4 envelope', async () => {
  await noProvider(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui-semantic-vision-'));
    const calls: Array<{ kind: string; id: string; instruction: string }> = [];
    let polls = 0, complete = false;
    const adapter = createSemanticVisionAdapter({
      stateDirectory: () => directory,
      submitStage: async (value: ReturnType<typeof input>, instruction: string, kind: string, options: { submissionId: string }) => {
        calls.push({ kind, id: options.submissionId, instruction });
        await writeFile(join(directory, `${options.submissionId}.submission.json`), JSON.stringify(stageRecord(options.submissionId, instruction)));
        return stagePending(options.submissionId);
      },
      pollStage: async (id: string) => { polls++; assert.equal(id, calls[0]?.id); return complete ? observation() : stagePending(id); },
    });

    const submitted = await adapter.submit(input());
    assert.deepEqual(Object.keys(submitted), ['version', 'sourceSha256', 'status', 'analysisId', 'pollAfterSeconds']);
    assert.equal(submitted.version, '0.1'); assert.equal(submitted.status, 'Pending');
    if (submitted.status === 'Pending') assert.notEqual(submitted.analysisId, calls[0].id, 'the browser only receives its adapter pipeline ID');
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].kind, 'observation');
    assert.ok(calls[0].instruction.includes('Return exactly Observed {version:"0.2"'));

    const resumed = await adapter.submit(input());
    assert.deepEqual(resumed, submitted, 'a repeated POST reads the original stage instead of submitting again');
    assert.equal(calls.length, 1); assert.equal(polls, 1);

    complete = true;
    const final = await adapter.poll((submitted as { analysisId: string }).analysisId);
    assert.deepEqual(Object.keys(final), ['version', 'sourceSha256', 'status', 'summary', 'observation']);
    assert.deepEqual(final, { version: '0.4', sourceSha256: source().sha256, status: 'Observed', summary: observation().summary, observation: observation() });
    assert.equal(calls.length, 1, 'poll cannot open a second model task');
    assert.equal(polls, 2);
  });
});

test('semantic adapter refuses an incompatible persisted observation instruction before calling the poll mock', async () => {
  await noProvider(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui-semantic-vision-'));
    let polls = 0, submittedId = '';
    const adapter = createSemanticVisionAdapter({
      stateDirectory: () => directory,
      submitStage: async (_value: unknown, instruction: string, _kind: string, options: { submissionId: string }) => {
        submittedId = options.submissionId;
        await writeFile(join(directory, `${submittedId}.submission.json`), JSON.stringify(stageRecord(submittedId, instruction)));
        return stagePending(submittedId);
      },
      pollStage: async () => { polls++; return stagePending(submittedId); },
    });
    const pending = await adapter.submit(input()) as { analysisId: string };
    const filename = join(directory, `${submittedId}.submission.json`);
    const tampered = JSON.parse(await readFile(filename, 'utf8'));
    tampered.args.instruction = 'a different prompt';
    await writeFile(filename, JSON.stringify(tampered));
    await assert.rejects(adapter.poll(pending.analysisId), /MCP_SEMANTIC_STAGE_INVALID/);
    assert.equal(polls, 0);
  });
});

test('concurrent POSTs join the in-progress observation submission after its stage record is written', async () => {
  await noProvider(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui-semantic-vision-'));
    let stageWritten!: () => void, release!: () => void, submissions = 0, polls = 0;
    const written = new Promise<void>(resolve => { stageWritten = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const adapter = createSemanticVisionAdapter({
      stateDirectory: () => directory,
      submitStage: async (_value: unknown, instruction: string, _kind: string, options: { submissionId: string }) => {
        submissions++;
        await writeFile(join(directory, `${options.submissionId}.submission.json`), JSON.stringify(stageRecord(options.submissionId, instruction)));
        stageWritten(); await blocked;
        return stagePending(options.submissionId);
      },
      pollStage: async (id: string) => { polls++; return stagePending(id); },
    });
    const first = adapter.submit(input());
    await written;
    const second = adapter.submit(input());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(submissions, 1); assert.equal(polls, 0, 'the prepared stage has no receipt yet and must not be polled');
    release();
    assert.deepEqual(await first, await second);
    assert.equal(submissions, 1); assert.equal(polls, 1, 'after the submission settles, the resumed POST may read its now-pollable stage');
  });
});

test('semantic adapter rejects a v0.1 observation downgrade and never converts provider Ready into a terminal public status', async () => {
  await noProvider(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui-semantic-vision-'));
    const adapter = createSemanticVisionAdapter({
      stateDirectory: () => directory,
      submitStage: async (_value: unknown, _instruction: string, _kind: string, options: { submissionId: string }) => observation('Observed', '0.1'),
      pollStage: async () => ({ version: '0.2', sourceSha256: source().sha256, status: 'Ready', summary: 'Not an observation.' }),
    });
    await assert.rejects(adapter.submit(input()), /VISION_SEMANTIC_OBSERVATION_INVALID/);
  });
});

test('semantic adapter preserves only whitelisted non-observed outcomes in a v0.4 envelope', async () => {
  await noProvider(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui-semantic-vision-'));
    const adapter = createSemanticVisionAdapter({
      stateDirectory: () => directory,
      submitStage: async () => observation('Custom-required'),
      pollStage: async () => { throw new Error('poll should not run after a terminal observation'); },
    });
    const result = await adapter.submit(input());
    assert.deepEqual(result, {
      version: '0.4', sourceSha256: source().sha256, status: 'Custom-required',
      summary: 'The required state is not visible.', observation: observation('Custom-required'),
    });
    assert.deepEqual(Object.keys(result), ['version', 'sourceSha256', 'status', 'summary', 'observation']);
  });
});
