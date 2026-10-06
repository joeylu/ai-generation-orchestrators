import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkCodexLoginVisibility, withCodexLoginPreflight } from '../src/codex-runtime-preflight.mjs';

const fixture = child => ({ env: {}, findExecutable: () => '/fixture/codex', runProcess: () => child });

test('credential check starts only read-only login status in the exact supplied environment', () => {
  const env = { CODEX_SANDBOX_NETWORK_DISABLED: '1', FIXTURE_SECRET: 'hidden' }, calls = [];
  const result = checkCodexLoginVisibility({ env, cwd: '/fixture/attempt', findExecutable: received => {
    assert.equal(received, env); return '/fixture/codex';
  }, runProcess: (...args) => { calls.push(args); return { status: 0, stdout: '', stderr: 'Logged in using ChatGPT\n' }; } });
  assert.equal(result.status, 'PASS'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ['login', 'status']); assert.equal(calls[0][2].env, env);
  assert.equal(calls[0][2].cwd, '/fixture/attempt'); assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].timeout, 10000); assert.equal(result.modelCalls, 0);
  assert.equal(result.network, 'NOT_CHECKED'); assert.equal(result.modelAvailability, 'NOT_CHECKED');
  assert.equal(result.settingsChanged, false); assert(!JSON.stringify(result).includes('hidden'));
});

test('both supported login status messages pass without returning account or key text', () => {
  for (const stdout of ['Logged in using ChatGPT\n', 'Logged in using an API key - sk-fixture-secret\n']) {
    const result = checkCodexLoginVisibility(fixture({ status: 0, stdout }));
    assert.equal(result.status, 'PASS'); assert(!JSON.stringify(result).includes('sk-fixture'));
  }
});

test('a proxy-bound plan denies missing route before login or dispatch, without claiming network health', async () => {
  let checks = 0, dispatches = 0;
  const runProcess = () => { checks++; return { status: 0, stderr: 'Logged in using ChatGPT' }; };
  const options = { ...fixture({}), runProcess, requireProxyEnvironment: true };
  for (const env of [{}, { HTTP_PROXY: 'http://fixture.invalid' }, { HTTP_PROXY: 'http://fixture.invalid', HTTPS_PROXY: ' ' }])
    await assert.rejects(withCodexLoginPreflight(() => { dispatches++; }, { ...options, env }),
      { code: 'CODEX_PREFLIGHT_PROXY_ENVIRONMENT_MISSING' });
  assert.equal(checks, 0); assert.equal(dispatches, 0);
  const result = await withCodexLoginPreflight(preflight => { dispatches++; return preflight; },
    { ...options, env: { HTTP_PROXY: 'http://fixture.invalid', HTTPS_PROXY: 'http://fixture.invalid' } });
  assert.equal(checks, 1); assert.equal(dispatches, 1); assert.equal(result.network, 'NOT_CHECKED');
  assert(!JSON.stringify(result).includes('fixture.invalid'));
});

test('negative, unknown, signaled or failed-exit statuses never grant dispatch', () => {
  for (const child of [{ status: 1, stderr: 'Not logged in' }, { status: 0, stdout: 'Not logged in' },
    { status: 0, stdout: 'status unknown' }, { status: 1, stdout: 'Logged in using ChatGPT' },
    { status: null, stdout: 'Logged in using ChatGPT' }])
    assert.equal(checkCodexLoginVisibility(fixture(child)).code, 'CODEX_PREFLIGHT_LOGIN_NOT_VISIBLE');
});

test('missing executable, timeout and process errors are bounded, sanitized and never retried', () => {
  let calls = 0;
  const options = { env: {}, findExecutable: () => undefined, runProcess: () => { calls++; } };
  assert.equal(checkCodexLoginVisibility(options).code, 'CODEX_PREFLIGHT_NOT_CONFIGURED'); assert.equal(calls, 0);
  for (const [error, code] of [[{ code: 'ETIMEDOUT', message: '/private/account/token' }, 'CODEX_PREFLIGHT_TIMEOUT'],
    [{ code: 'EACCES', message: '/private/account/token' }, 'CODEX_PREFLIGHT_START_FAILED']]) {
    const result = checkCodexLoginVisibility({ ...fixture({}), runProcess: () => { calls++; return { error }; } });
    assert.equal(result.code, code); assert(!JSON.stringify(result).includes('/private/'));
  }
  assert.equal(calls, 2);
  assert.equal(checkCodexLoginVisibility({ ...fixture({}), runProcess: () => { throw new Error('secret'); } }).code,
    'CODEX_PREFLIGHT_START_FAILED');
});

test('invisible login stops before writing a single-use claim or reaching inference dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'panel-preflight-')), claim = join(dir, 'dispatch-claim.json');
  let dispatched = 0, checks = 0;
  const action = async () => { await writeFile(claim, 'claim', { flag: 'wx' }); dispatched++; };
  try {
    await assert.rejects(withCodexLoginPreflight(action, { ...fixture({}), runProcess: () => {
      checks++; return { status: 1, stderr: 'Not logged in /private/account' };
    } }), { code: 'CODEX_PREFLIGHT_LOGIN_NOT_VISIBLE' });
    assert.equal(checks, 1); assert.equal(dispatched, 0);
    await assert.rejects(stat(claim), { code: 'ENOENT' });
    await withCodexLoginPreflight(action, fixture({ status: 0, stderr: 'Logged in using ChatGPT' }));
    assert.equal(dispatched, 1); assert.equal(await readFile(claim, 'utf8'), 'claim');
    await assert.rejects(withCodexLoginPreflight(action, fixture({ status: 0, stderr: 'Logged in using ChatGPT' })), { code: 'EEXIST' });
    assert.equal(dispatched, 1); assert.equal(await readFile(claim, 'utf8'), 'claim');
  } finally {
    const owned = relative(resolve(tmpdir()), resolve(dir));
    assert(/^panel-preflight-[A-Za-z0-9]+$/.test(owned));
    await rm(dir, { recursive: true, force: true });
  }
});
