/** Explicit loopback planning request for Node callers. One request, no transport retries. */
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { MAX_PLANNING_RUN_MS, MAX_SESSION_OUTPUT } from './studio-codex-plan.mjs';
import { MAX_LAYER_SOURCE_BYTES } from '../src/layer-component.ts';

export function requestLocalLayerPlan(origin, archive, { signal, timeoutMs = MAX_PLANNING_RUN_MS + 30000 } = {}) {
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin)
    || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_PLANNING_RUN_MS + 30000) {
    throw new Error('LAYER_CLIENT_OPTIONS_INVALID');
  }
  const source = Buffer.from(archive);
  if (!source.length || source.length > MAX_LAYER_SOURCE_BYTES) throw new Error('LAYER_CLIENT_SOURCE_INVALID');
  const body = JSON.stringify({ version: '1.0', archive: {
    sha256: createHash('sha256').update(source).digest('hex'), base64: source.toString('base64'),
  } });
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('LAYER_CLIENT_ABORTED_NO_RETRY')); return; }
    let settled = false, timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = code => {
      if (settled) return; settled = true; cleanup();
      call.destroy(); reject(new Error(code));
    };
    const abort = () => fail('LAYER_CLIENT_ABORTED_NO_RETRY');
    const call = request(origin + '/api/ui-layer-plan', { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    } }, response => {
      const parts = []; let size = 0;
      response.on('data', part => {
        size += part.length;
        if (size > MAX_SESSION_OUTPUT) { fail('LAYER_CLIENT_RESPONSE_LIMIT_NO_RETRY'); return; }
        parts.push(part);
      });
      response.once('aborted', () => fail('LAYER_CLIENT_TRANSPORT_FAILED_NO_RETRY'));
      response.once('error', () => fail('LAYER_CLIENT_TRANSPORT_FAILED_NO_RETRY'));
      response.once('end', () => {
        if (settled) return;
        let value;
        try { value = JSON.parse(Buffer.concat(parts).toString('utf8')); }
        catch { fail('LAYER_CLIENT_RESPONSE_INVALID_NO_RETRY'); return; }
        settled = true; cleanup(); resolve({ httpStatus: response.statusCode, body: value });
      });
    });
    // Node fetch has an unrelated five-minute headers limit. Use HTTP directly
    // and bound the entire request by the Harness's explicit planning deadline.
    call.setTimeout(0);
    call.once('error', () => fail('LAYER_CLIENT_TRANSPORT_FAILED_NO_RETRY'));
    timer = setTimeout(() => fail('LAYER_CLIENT_TIMEOUT_NO_RETRY'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    call.end(body);
  });
}
