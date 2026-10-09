/** Optional same-origin local bridge. File previews never probe a service. */
import { validateCodexDiagnostic } from './codex-diagnostics.mjs';
const MODEL = 'gpt-6-luna', EFFORT = 'xhigh';
function failure(code) { const error = new Error(code); error.code = code; return error; }
async function readResponse(response, binding) {
  if (!response.headers.get('content-type')?.startsWith('application/json')) throw failure('CODEX_BRIDGE_RESPONSE');
  const reader = response.body.getReader(), chunks = []; let size = 0, complete = false;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw failure('CODEX_BRIDGE_RESPONSE_LIMIT');
      chunks.push(value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('CODEX_BRIDGE_RESPONSE'); }
  if (!response.ok) {
    const error = failure(/^[A-Z][A-Z0-9_]{0,79}$/.test(result?.code) ? result.code : 'CODEX_BRIDGE_FAILED');
    if (binding && ['CODEX_OUTPUT_INVALID', 'CODEX_PROPOSAL_INVALID', 'CODEX_PROVENANCE_INVALID'].includes(error.code) && result.diagnostic) {
      try { error.diagnostic = validateCodexDiagnostic(result.diagnostic, { ...binding, failureCode: error.code }); } catch {}
    }
    throw error;
  }
  return result;
}
export async function detectCodexBridge(location, fetcher = fetch) {
  if (location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return null;
  try {
    const result = await readResponse(await fetcher('/api/panel/capabilities', {
      mode: 'same-origin', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3000),
    }));
    if (result.protocol !== '0.1' || result.model !== MODEL || result.effort !== EFFORT || typeof result.available !== 'boolean'
      || (result.editingAvailable !== undefined && typeof result.editingAvailable !== 'boolean')) return null;
    return { available: result.available, editingAvailable: result.editingAvailable === true, model: MODEL, effort: EFFORT };
  } catch { return null; }
}
async function requestProposal(path, context, signal, fetcher) {
  const requestId = crypto.randomUUID(), contextSha256 = context.sha256;
  let result;
  try {
    const response = await fetcher(path, { method: 'POST', mode: 'same-origin', credentials: 'omit',
      redirect: 'error', cache: 'no-store', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, context }),
    });
    // The connection can also fail after headers or a partial body arrived.
    result = await readResponse(response, { operation: path.endsWith('/edit') ? 'edit' : 'plan', contextSha256 });
  } catch (error) {
    if (error instanceof TypeError) throw failure('CODEX_BRIDGE_NETWORK_FAILED');
    throw error;
  }
  if (result.protocol !== '0.1' || result.requestId !== requestId || result.contextSha256 !== contextSha256
    || result.proposal?.contextSha256 !== contextSha256) throw failure('CODEX_BRIDGE_CONTEXT_MISMATCH');
  return result;
}

export const requestCodexProposal = (context, signal, fetcher = fetch) => requestProposal('/api/panel/plan', context, signal, fetcher);
export const requestCodexEditProposal = (context, signal, fetcher = fetch) => requestProposal('/api/panel/edit', context, signal, fetcher);
