import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { listenLoopback } from '../src/loopback-listener.mjs';
import { spawnSync } from 'node:child_process';
import { harnessRoot } from '../src/io.mjs';
import { STUDIO_PORT, parseStudioArguments, checkStudioPort, launchStudio, studioFailure } from '../scripts/lib/studio-launcher.mjs';

test('daily entry fixes the origin and accepts explicit local settings', () => {
  const defaults = parseStudioArguments([]);
  assert.equal(defaults.port, 4951); assert.equal(STUDIO_PORT, 4951);
  assert.match(defaults.catalog.replaceAll('\\', '/'), /\/examples\/modern-navigation.catalog.json$/);
  assert.equal(defaults.assets, 'builtin');
  assert.equal(parseStudioArguments(['--assets', 'none']).assets, 'none');
  assert.equal(parseStudioArguments(['--assets', 'builtin']).assets, 'builtin');
  assert.match(parseStudioArguments(['--assets', 'output/library']).assets.replaceAll('\\', '/'), /\/output\/library$/);
  assert.equal(parseStudioArguments(['--port', '5123', '--assets', 'output/library']).port, 5123);
  for (const args of [['--port', '0'], ['--port', '65536'], ['--port', '1.5'], ['--port', '01'], ['--port'],
    ['--unknown', 'value'], ['--port', '5123', '--port', '5124'], ['--sharp-module', 'unused'], ['--codex', 'relative.exe'],
    ['--assets', 'builtin', '--sharp-module', 'unused'], ['--assets', 'none', '--sharp-module', 'unused']]) {
    assert.throws(() => parseStudioArguments(args));
  }
});

test('daily default and explicit asset-free startup pass distinct build modes without Sharp', async () => {
  for (const assets of ['builtin', 'none']) {
    let builds = 0;
    await launchStudio(parseStudioArguments(assets === 'builtin' ? [] : ['--assets', assets]), {
      checkPort: async () => {}, preflight: async () => {},
      build: async args => { builds++; assert.equal(args[args.indexOf('--assets') + 1], assets); assert(!args.includes('--sharp-module')); },
      serve: async () => ({ url: 'fixture' }),
    });
    assert.equal(builds, 1);
  }
});

test('occupied and browser-blocked fixed ports fail before preflight or build without fallback', async t => {
  const occupied = createServer();
  await listenLoopback(occupied, 0);
  t.after(() => new Promise(done => occupied.close(done)));
  let operations = 0;
  await assert.rejects(launchStudio({ ...parseStudioArguments([]), port: occupied.address().port }, {
    preflight: async () => { operations++; }, build: async () => { operations++; }, serve: async () => { operations++; },
  }), { code: 'STUDIO_PORT_IN_USE' });
  assert.equal(operations, 0);
  await assert.rejects(checkStudioPort(6000), { code: 'WORKBENCH_SERVER_PORT_BLOCKED' });
});

test('dependency and build failures stop before serving without installs or model fallback', async () => {
  const events = [], options = parseStudioArguments([]);
  await assert.rejects(launchStudio(options, { checkPort: async () => {},
    preflight: async () => { throw new Error('WORKSPACE_PACKAGE_MISSING'); },
    build: async () => { events.push('build'); }, serve: async () => { events.push('serve'); },
  }), /WORKSPACE_PACKAGE_MISSING/);
  assert.deepEqual(events, []);
  await assert.rejects(launchStudio(options, { checkPort: async () => {}, preflight: async () => {},
    build: async () => { events.push('build'); throw new Error('fixture-build-failure'); },
    serve: async () => { events.push('serve'); },
  }), /fixture-build-failure/);
  assert.deepEqual(events, ['build']);
});

test('restarts build fresh directories but keep the same port and model output root', async () => {
  const launches = [], builds = [], phases = [];
  const options = parseStudioArguments(['--assets', 'output/library', '--sharp-module', 'sharp']);
  const adapters = { checkPort: async port => assert.equal(port, 4951), preflight: async () => {},
    build: async args => builds.push(args), serve: async args => { launches.push(args); return { url: 'fixture' }; }, onPhase: phase => phases.push(phase) };
  await launchStudio(options, adapters); await launchStudio(options, adapters);
  assert.deepEqual(phases, ['CHECKING', 'BUILDING', 'STARTING', 'CHECKING', 'BUILDING', 'STARTING']);
  assert.notEqual(launches[0].workbench, launches[1].workbench);
  assert.equal(launches[0].outputRoot, launches[1].outputRoot);
  for (const [i, item] of launches.entries()) {
    assert.equal(item.port, 4951); assert.equal(item.planner, undefined); assert.equal(item.editor, undefined);
    assert.equal(builds[i][builds[i].indexOf('--output') + 1], item.workbench);
    assert(builds[i].includes('--assets')); assert(builds[i].includes('sharp'));
    assert.match(item.workbench.replaceAll('\\', '/'), /\/output\/studio-builds\/build-[a-f0-9-]+$/);
  }
});

test('a competing final bind is terminal and diagnostics give redacted actionable messages', async () => {
  let calls = 0;
  await assert.rejects(launchStudio(parseStudioArguments([]), { checkPort: async () => {}, preflight: async () => {}, build: async () => {},
    serve: async () => { calls++; throw Object.assign(new Error('private location'), { code: 'EADDRINUSE' }); },
  }), { code: 'STUDIO_PORT_IN_USE' });
  assert.equal(calls, 1);
  const error = studioFailure({ code: 'STUDIO_PORT_IN_USE' });
  assert.match(error.message, /停止旧启动进程/); assert.equal(error.modelCalls, 0);
  assert.equal(JSON.stringify(studioFailure(new Error('C:/private/secret?token=abc'))).includes('secret'), false);
  assert.match(studioFailure(new Error('WORKSPACE_PACKAGE_MISSING')).message, /npm run doctor/);
});

test('CLI help and invalid arguments exit without starting a listener or build', () => {
  const run = args => spawnSync(process.execPath, ['scripts/start-studio.mjs', ...args],
    { cwd: harnessRoot, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const help = run(['--help']); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /4951/);
  const invalid = run(['--port', '0']); assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stderr).code, 'STUDIO_PORT');
});

test('a missing catalog gets an actionable child-build diagnostic without exposing its path', async () => {
  const probe = createServer(); await listenLoopback(probe, 0);
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const result = spawnSync(process.execPath, ['scripts/start-studio.mjs', '--port', String(port), '--catalog', '.tmp/private-absent-catalog.json'],
    { cwd: harnessRoot, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 1, result.stderr);
  const diagnostic = JSON.parse(result.stderr);
  assert.equal(diagnostic.code, 'STUDIO_INPUT_NOT_FOUND'); assert.match(diagnostic.message, /--catalog/);
  assert.equal(result.stderr.includes('private-absent'), false); assert.equal(result.stdout.includes('LOCAL_STUDIO_READY'), false);
});
