/** Optional CLI credential visibility check. No inference, login or configuration changes. */
import { spawnSync } from 'node:child_process';
import { findCodexExecutable } from './codex-planner.mjs';

export const CODEX_RUNTIME_PREFLIGHT_CODES = Object.freeze([
  'CODEX_PREFLIGHT_NOT_CONFIGURED', 'CODEX_PREFLIGHT_START_FAILED',
  'CODEX_PREFLIGHT_TIMEOUT', 'CODEX_PREFLIGHT_LOGIN_NOT_VISIBLE',
  'CODEX_PREFLIGHT_PROXY_ENVIRONMENT_MISSING',
]);

/** Raw CLI text, executable paths and credentials are never returned or logged. */
export function checkCodexLoginVisibility({ env = process.env, cwd,
  requireProxyEnvironment = false,
  findExecutable = findCodexExecutable, runProcess = spawnSync } = {}) {
  const result = code => ({ codexRuntimePreflightVersion: '0.1',
    status: code ? 'FAIL' : 'PASS', code, credentialVisibility: code ? 'NOT_CONFIRMED' : 'VISIBLE',
    modelCalls: 0, network: 'NOT_CHECKED', modelAvailability: 'NOT_CHECKED', settingsChanged: false });
  if (requireProxyEnvironment && !['HTTP_PROXY', 'HTTPS_PROXY'].every(key =>
    typeof env[key] === 'string' && env[key].trim().length > 0))
    return result('CODEX_PREFLIGHT_PROXY_ENVIRONMENT_MISSING');
  let command, child;
  try {
    command = findExecutable(env);
    if (!command) return result('CODEX_PREFLIGHT_NOT_CONFIGURED');
    child = runProcess(command, ['login', 'status'], { env, ...(cwd ? { cwd } : {}),
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000,
      maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { return result('CODEX_PREFLIGHT_START_FAILED'); }
  if (child?.error) return result(child.error.code === 'ETIMEDOUT'
    ? 'CODEX_PREFLIGHT_TIMEOUT' : 'CODEX_PREFLIGHT_START_FAILED');
  const text = `${child?.stdout ?? ''}\n${child?.stderr ?? ''}`;
  // Require both successful exit and a recognized positive status. Do not use the
  // inherited CODEX_SANDBOX_NETWORK_DISABLED flag: it also exists on host launches.
  const visible = child?.status === 0 && !/not logged in/i.test(text)
    && /^Logged in using (?:ChatGPT|an API key)(?:\s|$)/im.test(text);
  return result(visible ? null : 'CODEX_PREFLIGHT_LOGIN_NOT_VISIBLE');
}

/** Dispatch claims and inference must be inside this callback, after the read-only check. */
export async function withCodexLoginPreflight(action, options) {
  const preflight = checkCodexLoginVisibility(options);
  if (preflight.status !== 'PASS') {
    const error = new Error(preflight.code);
    error.code = preflight.code;
    error.preflight = preflight;
    throw error;
  }
  return action(preflight);
}
