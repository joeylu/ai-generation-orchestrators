import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { fixturePassedRender, fixtureFindings, layerPlanningFixture } from './helpers/layer-planning-fixture.ts';
import { layerSha256 } from '../src/layer-component.ts';
import { createCodexLayerPlanner, codexPlanArguments, inspectSessionEvents, LayerSessionError, checkCodexAuthentication, collectCodexLayerPlan, invokeCodexPlan } from '../scripts/studio-codex-plan.mjs';
import { createLayerPlanBridge } from '../scripts/studio-layer-plan.mjs';

const events = [
  { type: 'thread.started', thread_id: '019aaaaa-1234-7000-8000-000000000001' }, { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: 'Structured fixture response.' } },
  { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 10 } },
];

test('offline same-session correction receives an exact path diagnostic for a layer ID image reference', async () => {
  const fixture = await layerPlanningFixture();
  const directory = await mkdtemp(join(tmpdir(), 'layer-resource-path-test-'));
  const invalid = structuredClone(fixture.proposal);
  (invalid.plan.document.root.children[1] as any).props.appearance.backgroundImage = 'button';
  let calls = 0; const prompts: string[] = [];
  const spawnProcess = (_exe: string, args: string[]) => {
    const round = calls++; assert.ok(round < 2);
    assert.equal(args.includes('resume'), round === 1);
    if (round === 1) assert.ok(args.includes(events[0].thread_id!));
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.emit('close', null); } });
    prompts[round] = ''; child.stdin.on('data', part => prompts[round] += part.toString());
    child.stdin.once('finish', () => {
      const { plan, ...envelope } = round === 0 ? invalid : fixture.proposal;
      const text = JSON.stringify({ ...envelope, planJson: JSON.stringify(plan) });
      const trace = events.map(event => event.type === 'item.completed' ? { ...event, item: { type: 'agent_message', text } } : event);
      void writeFile(args[args.indexOf('--output-last-message') + 1], text)
        .then(() => { child.stdout.write(trace.map(event => JSON.stringify(event)).join('\n')); child.emit('close', 0); });
    });
    return child;
  };
  try {
    const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
      spawnProcess, checkAuthentication: async () => true, checkRender: async () => fixturePassedRender(fixture.proposal.plan.document) });
    const result = await planner.planRun(fixture.bytes);
    assert.equal(calls, 2); assert.equal(result.execution.corrections, 1);
    assert.ok(prompts[1].includes('LAYER_PLAN_RESOURCE_PATH_REQUIRED'));
    assert.ok(prompts[1].includes('/document/root/children/1/props/appearance/backgroundImage'));
    assert.ok(prompts[1].includes('layers/layer-002.png'));
    assert.ok(prompts[1].includes('bindings[].layerId and adaptations[].sourceLayerId'));
    const run = join(directory, (await readdir(directory))[0]);
    const check = JSON.parse(await readFile(join(run, 'turn-0/check.json'), 'utf8'));
    assert.equal(check.feedback.code, 'LAYER_PLAN_EXTERNAL_IMAGE');
    assert.equal(check.status, 'repairable');
    const collected = await collectCodexLayerPlan(fixture.bytes, run);
    assert.deepEqual(collected.proposal, fixture.proposal);
    assert.equal(collected.receipt.modelDispatches, 0);
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
test('Codex command is one persistent read-only session with image attachments, no MCP or tools', () => {
  const args = codexPlanArguments('fixture run', ['reference.png', 'layers/layer-001.png'], {});
  assert.deepEqual(args.slice(0, 2), ['--no-daemon', 'exec']); assert.equal(args.at(-1), '-');
  assert.equal(args.includes('--ephemeral'), false); assert.equal(args.includes('resume'), false);
  for (const flag of ['--ignore-user-config', '--strict-config', '--output-schema', '--output-last-message', 'read-only',
    'approval_policy="never"', 'features.multi_agent=false', 'features.apps=false', 'features.plugins=false',
    'features.image_generation=false', 'features.shell_tool=false', 'features.view_image=false']) assert.ok(args.includes(flag), flag);
  assert.equal(args.filter(item => item === '--image').length, 2);
  assert.equal(args.includes('--model'), false);
});
test('session event receipt rejects MCP execution, multiple sessions, failed/incomplete turns', () => {
  assert.equal(inspectSessionEvents(events.map(item => JSON.stringify(item)).join('\n')).turnCompleted, true);
  for (const trace of [events.slice(0, 3), [...events, events[0]], [...events, events[0], { ...events[0], thread_id: '019aaaaa-1234-7000-8000-000000000002' }],
    [...events, { type: 'item.completed', item: { type: 'mcp_tool_call' } }], [...events, { type: 'turn.failed' }]]) {
    assert.throws(() => inspectSessionEvents(trace.map(item => JSON.stringify(item)).join('\n')), LayerSessionError);
  }
});
test('historical completed receipts retain bounded transport notices without authorizing new invocations', () => {
  const transport = [2, 3, 4, 5].map(index => ({ type: 'error', message: `Reconnecting... ${index}/5 (request timed out)` }));
  const fallback = { type: 'item.completed', item: { type: 'error', message: 'Falling back from WebSockets to HTTPS transport. request timed out' } };
  const encode = (trace: unknown[]) => trace.map(item => JSON.stringify(item)).join('\n');
  const result = inspectSessionEvents(encode([...transport, fallback, ...events]));
  assert.equal(result.transportNotices, 5); assert.equal(result.transportFallback, true);
  for (const trace of [[...transport, fallback], [...transport, fallback, fallback, ...events],
    [...transport, transport[0], ...events], [{ type: 'error', message: 'Unknown configuration' }, ...events],
    [{ type: 'error', message: 'Reconnecting... 6/5 (request timed out)' }, ...events],
    [...transport, fallback, ...events, { type: 'turn.failed' }],
    [...transport, fallback, ...events, { type: 'item.completed', item: { type: 'mcp_tool_call' } }]]) {
    assert.throws(() => inspectSessionEvents(encode(trace)), LayerSessionError);
  }
});
test('offline process double verifies full input, portable plan and local session receipt', async () => {
  const fixture = await layerPlanningFixture(); const directory = await mkdtemp(join(tmpdir(), 'layer-session-test-'));
  let calls = 0, capturedPrompt = '', capturedArgs: string[] = [];
  const spawnProcess = (_exe: string, args: string[], options: { shell: boolean; windowsHide: boolean }) => {
    calls++; capturedArgs = args; assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.emit('close', null); } });
    child.stdin.on('data', part => { capturedPrompt += part.toString(); });
    child.stdin.once('finish', () => {
      const { plan, ...envelope } = fixture.proposal;
      const text = JSON.stringify({ ...envelope, planJson: JSON.stringify(plan) });
      const trace = events.map(event => event.type === 'item.completed' ? { ...event, item: { ...event.item, text } } : event);
      void writeFile(args[args.indexOf('--output-last-message') + 1], text)
        .then(() => { child.stdout.write(trace.map(item => JSON.stringify(item)).join('\n')); child.emit('close', 0); });
    });
    return child;
  };
  try {
    const planner = createCodexLayerPlanner({ executable: process.execPath, env: {}, stateRoot: directory, spawnProcess, checkAuthentication: async () => true,
      checkRender: async () => fixturePassedRender(fixture.proposal.plan.document) });
    const proposal = await planner.plan(fixture.bytes);
    assert.deepEqual(proposal, fixture.proposal); assert.equal(calls, 1);
    assert.ok(capturedPrompt.includes(fixture.plan.archiveSha256));
    assert.ok(capturedPrompt.includes('Consumer adaptation policy'));
    assert.ok(capturedPrompt.includes('ProgressBar.appearance is OPTIONAL'));
    assert.ok(capturedPrompt.includes('layoutChecks is EXACTLY'));
    assert.ok(capturedPrompt.includes('signed gaps in canvas pixels'));
    assert.ok(capturedPrompt.includes("use the exact authenticated layers[].path, e.g. 'layers/layer-003.png'"));
    assert.ok(capturedPrompt.includes('declaring a binding does not convert or resolve an ID'));
    assert.ok(capturedPrompt.includes('RadioGroup')); assert.ok(capturedPrompt.includes('Do not guess semantics from filenames'));
    assert.equal(capturedArgs.filter(item => item === '--image').length, 4);
    const runs = await readdir(directory); assert.equal(runs.length, 1);
    const session = JSON.parse(await readFile(join(directory, runs[0], 'turn-0/session.json'), 'utf8'));
    assert.equal(session.sessionId, events[0].thread_id);
    assert.equal(JSON.stringify(proposal).includes(session.sessionId), false);
    const result = JSON.parse(await readFile(join(directory, runs[0], 'result.json'), 'utf8'));
    assert.equal(result.status, 'draft_pending_visual_review');
    const collected = await collectCodexLayerPlan(fixture.bytes, join(directory, runs[0]));
    assert.deepEqual(collected.proposal, fixture.proposal); assert.equal(collected.receipt.modelDispatches, 0);
    await writeFile(join(directory, runs[0], 'turn-0/draft.json'), JSON.stringify({ invalid: true }));
    await assert.rejects(collectCodexLayerPlan(fixture.bytes, join(directory, runs[0])), /SESSION_COLLECTION_(?:RESPONSE|SOURCE)_STALE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unresolved semantic reasons reach the loopback response without private notes or an automatic retry', async () => {
  const fixture = await layerPlanningFixture(); let calls = 0, privateNote = false;
  const bridge = createLayerPlanBridge({ planner: { configured: true, driver: 'offline-double', async plan() {
    calls++; return { ...fixture.proposal, status: 'Unresolved', plan: null, summary: '按钮文字无法确认。',
      reason: 'required-semantics-missing', missingInputs: [{ subject: '按钮', kind: 'unreadable-text', detail: '参考文字无法辨认。' }],
      issues: [privateNote ? 'file:///private/transport' : '请提供可读的标签文字。'] };
  } } });
  const server = createServer((request, response) => { void bridge.middleware(request, response, () => { response.writeHead(404); response.end(); }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw Error('address');
  const origin = `http://127.0.0.1:${address.port}`;
  const payload = { version: '1.0', archive: { sha256: fixture.plan.archiveSha256, base64: Buffer.from(fixture.bytes).toString('base64') } };
  const call = () => fetch(origin + '/api/ui-layer-plan', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  try {
    const blocked = await call(); assert.equal(blocked.status, 502);
    assert.deepEqual(await blocked.json(), { error: 'LAYER_PLANNING_UNRESOLVED', diagnostic: { summary: '按钮文字无法确认。', issues: ['请提供可读的标签文字。'],
      reason: 'required-semantics-missing', missingInputs: [{ subject: '按钮', kind: 'unreadable-text', detail: '参考文字无法辨认。' }] } });
    assert.equal(calls, 1);
    privateNote = true; const redacted = await call(); assert.equal(redacted.status, 502);
    assert.equal((await redacted.text()).includes('private/transport'), false); assert.equal(calls, 2);
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
});
test('timeout kills exactly one process and leaves a blocked receipt', async () => {
  const fixture = await layerPlanningFixture(), directory = await mkdtemp(join(tmpdir(), 'layer-session-timeout-'));
  let calls = 0, kills = 0;
  const spawnProcess = () => {
    calls++;
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { kills++; child.emit('close', null); } });
    return child;
  };
  try {
    await assert.rejects(createCodexLayerPlanner({ executable: process.execPath, env: {}, stateRoot: directory, spawnProcess, timeoutMs: 10, checkAuthentication: async () => true }).plan(fixture.bytes),
      /SESSION_TIMEOUT_NO_RETRY/);
    assert.equal(calls, 1); assert.equal(kills, 1);
    const runs = await readdir(directory), result = JSON.parse(await readFile(join(directory, runs[0], 'result.json'), 'utf8'));
    assert.equal(result.status, 'blocked'); assert.equal(result.transportRetries, 0); assert.equal(result.modelTurns, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('live session guard stops forbidden transport/tool events promptly and preserves split UTF-8 evidence', async () => {
  for (const mode of ['disconnect', 'duplicate', 'tool', 'fallback', 'clean'] as const) {
    let starts = 0, kills = 0;
    const spawnProcess = () => {
      starts++;
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill() { kills++; child.emit('close', null); } });
      child.stdin.resume(); child.stdin.once('finish', () => {
        const notice = { type: 'error', message: 'Reconnecting... 2/5 (request timed out)' };
        const trace = mode === 'disconnect' ? [{ type: 'error', message: 'Reconnecting... 1/5 (stream disconnected before completion)' }]
          : mode === 'duplicate' ? [notice, notice]
            : mode === 'tool' ? [{ type: 'item.started', item: { type: 'mcp_tool_call' } }]
              : mode === 'fallback' ? [{ type: 'item.completed', item: { type: 'error', message: 'Falling back from WebSockets to HTTPS transport. request timed out' } }]
                : events.map(event => event.type === 'item.completed' ? { ...event, item: { ...event.item, text: '完整方案中文' } } : event);
        const bytes = Buffer.from(trace.map(item => JSON.stringify(item)).join('\n') + '\n');
        for (const byte of bytes) { if (kills) break; child.stdout.write(Buffer.from([byte])); }
        if (mode === 'clean') child.emit('close', 0);
      }); return child;
    };
    const result = await invokeCodexPlan('offline-double', ['--cd', '.'], 'Fixture request', { spawnProcess, timeoutMs: 1000 });
    assert.equal(starts, 1); assert.equal(kills, mode === 'clean' ? 0 : 1);
    assert.equal(result.failure, mode === 'clean' ? undefined : mode === 'tool' ? 'SESSION_ISOLATION_FAILED_NO_RETRY' : 'SESSION_TRANSPORT_FAILED_NO_RETRY');
    assert.equal(result.timing.scope, 'local-cli-pipes-not-network'); assert.ok(result.timing.closedMs >= 0);
    if (mode === 'clean') { assert.ok(result.events.includes('完整方案中文')); assert.equal(inspectSessionEvents(result.events).turnCompleted, true); }
    else assert.ok(result.events.includes(mode === 'tool' ? 'mcp_tool_call' : mode === 'fallback' ? 'Falling back' : 'Reconnecting'));
  }
});

test('native stderr sampling failures terminate before JSONL notices and cannot launch correction 2', async () => {
  const fixture = await layerPlanningFixture(), directory = await mkdtemp(join(tmpdir(), 'layer-stderr-transport-'));
  const incomplete = structuredClone(fixture.proposal);
  (incomplete.plan as any).document.root.children[1].props.appearance.backgroundImage = 'button';
  let calls = 0, kills = 0;
  const spawnProcess = (_exe: string, args: string[]) => {
    const round = calls++;
    assert.ok(round < 2, 'No subsequent invocation after terminal stderr');
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { kills++; child.emit('close', null); } });
    child.stdin.resume(); child.stdin.once('finish', () => {
      if (round === 0) {
        const { plan, ...envelope } = incomplete, text = JSON.stringify({ ...envelope, planJson: JSON.stringify(plan) });
        void writeFile(args[args.indexOf('--output-last-message') + 1], text).then(() => {
          child.stdout.write(events.map(event => JSON.stringify(event.type === 'item.completed' ? { ...event, item: { type: 'agent_message', text } } : event)).join('\n') + '\n');
          child.emit('close', 0);
        });
      } else {
        child.stdout.write(events.slice(0, 2).map(event => JSON.stringify(event)).join('\n') + '\n');
        for (const part of ['WARN codex_core: retrying sam', 'pling request (1/5 in 198ms)']) {
          if (!kills) child.stderr.write(part);
        }
      }
    }); return child;
  };
  try {
    const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
      spawnProcess, timeoutMs: 1000, checkAuthentication: async () => true, checkRender: async () => fixturePassedRender(fixture.proposal.plan.document) });
    await assert.rejects(planner.plan(fixture.bytes), /SESSION_TRANSPORT_FAILED_NO_RETRY/);
    assert.equal(calls, 2); assert.equal(kills, 1);
    const run = join(directory, (await readdir(directory))[0]), result = JSON.parse(await readFile(join(run, 'result.json'), 'utf8'));
    assert.equal(result.status, 'blocked'); assert.equal(result.modelTurns, 2); assert.equal(result.rounds.length, 1);
    const timing = JSON.parse(await readFile(join(run, 'turn-1/io-timing.json'), 'utf8'));
    assert.equal(timing.scope, 'local-cli-pipes-not-network'); assert.equal(timing.turnCompletedMs, null);
    assert.ok(timing.firstStderrMs >= 0); assert.ok(timing.stoppedMs >= timing.firstStderrMs);
    assert.ok((await readFile(join(run, 'turn-1/stderr.log'), 'utf8')).includes('retrying sampling request'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unrelated local skill/catalog warnings do not abort a completed turn', async () => {
  let kills = 0;
  const spawnProcess = () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      kill() { kills++; child.emit('close', null); } });
    child.stdin.resume(); child.stdin.once('finish', () => {
      child.stderr.write('ERROR failed to load skill\nERROR failed to refresh available models: request timed out\n');
      child.stdout.write(events.map(event => JSON.stringify(event)).join('\n') + '\n'); child.emit('close', 0);
    }); return child;
  };
  const result = await invokeCodexPlan('offline-double', ['--cd', '.'], 'Fixture request', { spawnProcess, timeoutMs: 1000 });
  assert.equal(kills, 0); assert.equal(result.failure, undefined); assert.ok(result.timing.turnCompletedMs >= 0);
});
test('missing local login blocks before creating a planning session or dispatching a model', async () => {
  const fixture = await layerPlanningFixture(); let calls = 0;
  const planner = createCodexLayerPlanner({ executable: process.execPath, env: {}, checkAuthentication: async () => false,
    spawnProcess: () => { calls++; throw new Error('must not dispatch'); } });
  await assert.rejects(planner.plan(fixture.bytes), /SESSION_NOT_AUTHENTICATED/); assert.equal(calls, 0);
  const authenticated = await checkCodexAuthentication('offline-double', { spawnProcess: (_exe: string, args: string[], options: { stdio: string }) => {
    assert.deepEqual(args, ['login', 'status']); assert.equal(options.stdio, 'ignore');
    const child = Object.assign(new EventEmitter(), { kill() { child.emit('close', null); } });
    setImmediate(() => child.emit('close', 1)); return child;
  } });
  assert.equal(authenticated, false);
});
test('loopback bridge authenticates source before dispatch and rejects cross-origin/private response', async () => {
  const fixture = await layerPlanningFixture(); let calls = 0, leak = false;
  const bridge = createLayerPlanBridge({ planner: { configured: true, driver: 'offline-double', async plan(bytes: Uint8Array) {
    calls++; assert.equal(await layerSha256(bytes), fixture.plan.archiveSha256);
    return leak ? { ...fixture.proposal, privateTransport: 'private-host-details' } : fixture.proposal;
  } } });
  const server = createServer((request, response) => { void bridge.middleware(request, response, () => { response.writeHead(404); response.end(); }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
  const origin = `http://127.0.0.1:${address.port}`;
  const payload = { version: '1.0', archive: { sha256: fixture.plan.archiveSha256, base64: Buffer.from(fixture.bytes).toString('base64') } };
  const call = (body: unknown, requestOrigin = origin) => fetch(origin + '/api/ui-layer-plan', { method: 'POST',
    headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await call(payload, 'http://external.invalid')).status, 403); assert.equal(calls, 0);
    assert.equal((await call({ ...payload, archive: { ...payload.archive, sha256: '0'.repeat(64) } })).status, 400); assert.equal(calls, 0);
    const good = await call(payload); assert.equal(good.status, 200); assert.deepEqual(await good.json(), { version: '2.0', proposal: fixture.proposal, execution: null }); assert.equal(calls, 1);
    leak = true; const invalid = await call(payload); assert.equal(invalid.status, 502);
    assert.equal((await invalid.text()).includes('private-host-details'), false); assert.equal(calls, 2);
  } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
});

function correctionProcess(proposals: unknown[], traces?: (round: number) => unknown[]) {
  const calls: Array<{ args: string[]; prompt: string }> = [];
  const spawnProcess = (_exe: string, args: string[]) => {
    const round = calls.length, call = { args, prompt: '' }; calls.push(call);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.emit('close', null); } });
    child.stdin.on('data', part => { call.prompt += part.toString(); });
    child.stdin.once('finish', () => {
      const proposal = proposals[Math.min(round, proposals.length - 1)] as { plan: unknown };
      const { plan, ...envelope } = proposal;
      const text = JSON.stringify({ ...envelope, planJson: JSON.stringify(plan) });
      const trace = (traces?.(round) ?? events).map((raw: any) => raw.type === 'item.completed' && raw.item?.type === 'agent_message'
        ? { ...raw, item: { ...raw.item, text } } : raw);
      void writeFile(args[args.indexOf('--output-last-message') + 1], text)
        .then(() => { child.stdout.write(trace.map(item => JSON.stringify(item)).join('\n')); child.emit('close', 0); });
    });
    return child;
  };
  return { calls, spawnProcess };
}

test('missing Button declarations and actual UI failures share the same bounded correction session', async () => {
  const fixture = await layerPlanningFixture(), directory = await mkdtemp(join(tmpdir(), 'layer-ui-corrections-'));
  const incomplete = structuredClone(fixture.proposal);
  const button = incomplete.plan.document.root.children.find(node => node.type === 'Button')!;
  if (button.type !== 'Button') throw Error('fixture'); delete button.props.interaction;
  incomplete.findings = fixtureFindings(incomplete.plan.document);
  const process = correctionProcess([incomplete, fixture.proposal]); let renders = 0;
  try {
    const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
      spawnProcess: process.spawnProcess, checkAuthentication: async () => true,
      checkRender: async () => ++renders === 1 ? { status: 'repairable', code: 'LAYER_PLAN_UI_INTERACTION_FAILED',
        issues: [{ path: 'interaction', code: 'UI_INTERACTION_MODAL_EXIT_MISSING', message: 'UI_INTERACTION_MODAL_EXIT_MISSING: detail' }] }
        : fixturePassedRender(fixture.proposal.plan.document) });
    const result = await planner.planRun(fixture.bytes);
    assert.equal(result.execution.corrections, 2); assert.equal(process.calls.length, 3); assert.equal(renders, 2);
    assert.ok(process.calls[0].prompt.includes('Declarative Button interaction contract'));
    assert.ok(process.calls[1].prompt.includes('BUTTON_INTERACTION_DECLARATION_REQUIRED'));
    assert.ok(process.calls[2].prompt.includes('UI_INTERACTION_MODAL_EXIT_MISSING'));
    const root = join(directory, (await readdir(directory))[0]);
    assert.equal((await collectCodexLayerPlan(fixture.bytes, root)).receipt.modelDispatches, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('renderer missing UI acceptance evidence terminates without a model correction', async () => {
  const fixture = await layerPlanningFixture(), directory = await mkdtemp(join(tmpdir(), 'layer-ui-report-'));
  const process = correctionProcess([fixture.proposal]);
  try {
    const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
      spawnProcess: process.spawnProcess, checkAuthentication: async () => true,
      checkRender: async () => ({ status: 'pass', code: 'LAYER_RENDER_PASS' }) });
    await assert.rejects(planner.planRun(fixture.bytes), /LAYER_RENDER_FAILED/);
    assert.equal(process.calls.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('three render corrections use the same session and preserve every completed draft/check', async () => {
  const fixture = await layerPlanningFixture(), directory = await mkdtemp(join(tmpdir(), 'layer-corrections-'));
  const process = correctionProcess([fixture.proposal]); let renders = 0;
  try {
    const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
      checkAuthentication: async () => true, spawnProcess: process.spawnProcess,
      checkRender: async () => ++renders <= 3 ? { status: 'repairable', code: 'LAYER_PLAN_TEXT_OVERFLOW: action.label' }
        : fixturePassedRender(fixture.proposal.plan.document) });
    const result = await planner.planRun(fixture.bytes);
    assert.equal(result.execution.corrections, 3); assert.equal(result.execution.modelTurns, 4); assert.equal(result.execution.humanVisualAcceptance, false);
    assert.equal(process.calls.length, 4);
    for (const [round, call] of process.calls.entries()) {
      assert.equal(call.args.includes('resume'), round > 0);
      assert.equal(call.args.includes('--last'), false);
      if (round > 0) {
        assert.ok(call.args.includes(events[0].thread_id!)); assert.ok(call.prompt.includes(`correction ${round} of at most 3`));
        assert.ok(call.prompt.includes('LAYER_PLAN_TEXT_OVERFLOW: action.label'));
      }
    }
    const runs = await readdir(directory), root = join(directory, runs[0]);
    for (let round = 0; round < 4; round++) {
      const check = JSON.parse(await readFile(join(root, `turn-${round}/check.json`), 'utf8'));
      assert.equal(check.status, round === 3 ? 'pass' : 'repairable');
    }
    const collected = await collectCodexLayerPlan(fixture.bytes, root);
    assert.deepEqual(collected.proposal, fixture.proposal); assert.equal(collected.receipt.corrections, 3); assert.equal(collected.receipt.modelDispatches, 0);
    await writeFile(join(root, 'turn-1/feedback.json'), '{}');
    await assert.rejects(collectCodexLayerPlan(fixture.bytes, root), /SESSION_COLLECTION_SOURCE_STALE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('correction budget exhaustion dispatches exactly four turns and has no fifth call', async () => {
  const fixture = await layerPlanningFixture();
  for (const mode of ['render', 'construction'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'layer-exhausted-'));
    const incomplete = { ...fixture.proposal, status: 'Unresolved', reason: 'construction-incomplete', plan: null,
      findings: [], summary: '业务文字可读，但完整方案尚未写完。', issues: ['绑定与证据未完成。'] };
    const process = correctionProcess([mode === 'construction' ? incomplete : fixture.proposal]); let renders = 0;
    try {
    const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
      checkAuthentication: async () => true, spawnProcess: process.spawnProcess,
      checkRender: async () => { renders++; return { status: 'repairable', code: 'LAYER_PLAN_TEXT_OVERFLOW: action.label' }; } });
    await assert.rejects(planner.planRun(fixture.bytes), /SESSION_CORRECTIONS_EXHAUSTED/);
    assert.equal(process.calls.length, 4);
    const runs = await readdir(directory), result = JSON.parse(await readFile(join(directory, runs[0], 'result.json'), 'utf8'));
    assert.equal(result.corrections, 3); assert.equal(result.status, 'blocked'); assert.equal(result.rounds.length, 4);
    if (mode === 'construction') { assert.equal(renders, 0); assert.equal(result.diagnostic.reason, 'construction-incomplete'); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('completed unfinished draft or invalid contract can be corrected once; terminal failures never retry', async () => {
  const fixture = await layerPlanningFixture();
  const { reason: _reason, missingInputs: _missingInputs, ...legacy } = fixture.proposal;
  const invalid: any = structuredClone(fixture.proposal); invalid.plan.document.root.props.unknown = true;
  for (const mode of ['classified-incomplete', 'unfinished', 'contract', 'resource', 'layout-declaration', 'transport', 'source', 'unresolved', 'legacy-unresolved', 'session', 'cancel'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'layer-terminal-'));
    const proposal = mode === 'source' ? { ...fixture.proposal, archiveSha256: '0'.repeat(64) }
      : mode === 'unresolved' ? { ...fixture.proposal, status: 'Unresolved', plan: null, reason: 'required-semantics-missing',
        missingInputs: [{ subject: '按钮', kind: 'unreadable-text', detail: '标签不可辨认。' }] }
        : mode === 'legacy-unresolved' ? { ...legacy, version: '1.0', status: 'Unresolved', plan: null }
        : mode === 'classified-incomplete' ? { ...fixture.proposal, status: 'Unresolved', plan: null, reason: 'construction-incomplete', findings: [], issues: ['Required semantics are readable; construction remains unfinished.'] }
        : mode === 'unfinished' ? { ...fixture.proposal, status: 'Draft', plan: null, findings: [], issues: ['Required semantics are readable; construction remains unfinished.'] }
        : mode === 'resource' ? { ...fixture.proposal, plan: { ...fixture.proposal.plan, bindings: fixture.proposal.plan.bindings.slice(0, 1) } }
          : mode === 'contract' ? invalid : fixture.proposal;
    const missingLayout: any = structuredClone(proposal);
    if (mode === 'layout-declaration') delete missingLayout.plan.layoutChecks;
    const process = correctionProcess([missingLayout, fixture.proposal], round => mode === 'transport'
      ? events.slice(0, 3) : mode === 'session' && round === 1
        ? [{ ...events[0], thread_id: '019aaaaa-1234-7000-8000-000000000002' }, ...events.slice(1)] : events);
    let renders = 0;
    const controller = new AbortController();
    try {
      const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
        checkAuthentication: async () => true, spawnProcess: process.spawnProcess,
        checkRender: async () => {
          if (mode === 'cancel') controller.abort();
          return mode === 'session' && renders++ === 0
            ? { status: 'repairable', code: 'LAYER_PLAN_TEXT_OVERFLOW: action.label' } : fixturePassedRender(fixture.proposal.plan.document);
        } });
      if (mode === 'classified-incomplete' || mode === 'unfinished' || mode === 'contract' || mode === 'resource' || mode === 'layout-declaration') {
        const result = await planner.planRun(fixture.bytes); assert.equal(result.execution.corrections, 1);
        assert.ok(process.calls[1].prompt.includes(mode === 'classified-incomplete' ? 'LAYER_PLANNING_CONSTRUCTION_INCOMPLETE'
          : mode === 'unfinished' ? 'LAYER_PLANNING_RESPONSE_INVALID'
          : mode === 'contract' ? 'UNSUPPORTED_FIELD' : mode === 'layout-declaration' ? 'LAYER_PLAN_LAYOUT_CHECKS_REQUIRED' : 'LAYER_PLAN_UNBOUND_RESOURCE'));
        assert.ok(process.calls[1].args.includes(events[0].thread_id!));
      } else await assert.rejects(planner.planRun(fixture.bytes, { signal: controller.signal }), /SESSION_|LAYER_PLANNING_UNRESOLVED/);
      assert.equal(process.calls.length, ['classified-incomplete', 'unfinished', 'contract', 'resource', 'layout-declaration', 'session'].includes(mode) ? 2 : 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
