/**
 * Local UI vision bridge.
 *
 * A provider is optional and stays outside this package. Set UI_VISION_ADAPTER
 * to an absolute ESM module path. That module must export:
 *
 *   export async function analyze(input, { signal }) { ... }
 *
 * Or an adapter may expose short-request operations:
 *
 *   export async function submit(input, { signal }) { ... }
 *   export async function poll(analysisId, { signal }) { ... }
 *
 * `submit` may return a final semantic envelope or exactly
 * `{ version, sourceSha256, status: 'Pending', analysisId, pollAfterSeconds }`.
 * `analysisId` is an opaque UUID chosen by the adapter; it must never be a
 * provider task identifier. `poll` returns that same Pending form or a final
 * semantic envelope. The bridge creates neither background jobs nor queues.
 *
 * `input` is the validated POST body below. The return value is provider-owned
 * semantic JSON with `{ version: '0.1', sourceSha256, status, summary, ... }`.
 * `intent` and `policy`, when present, remain opaque here and are validated by
 * the browser's provider-neutral compiler. Adapters own any credentials and
 * must never expose them through their result or thrown errors.
 */
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VISION_ENDPOINT = '/api/ui-vision';
// The 2 MiB cap is on decoded source bytes. The POST cap accounts for base64
// and the small JSON envelope while still bounding the local transport.
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_VISION_CONCURRENCY = 1;
export const VISION_TIMEOUT_MS = 90_000;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const mimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const statuses = new Set(['Ready', 'Unresolved', 'Custom-required']);
// Canonical UUID text is the only browser-visible analysis handle. The bridge
// does not interpret its version or map it to a provider-side task identifier.
const analysisIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class VisionBridgeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function bridgeError(code, status) { return new VisionBridgeError(code, status); }
function record(value, code = 'VISION_INVALID_REQUEST') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bridgeError(code);
  return value;
}
function exactKeys(value, keys, code = 'VISION_INVALID_REQUEST') {
  const valueKeys = Object.keys(value);
  if (valueKeys.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw bridgeError(code);
}
function readU16BE(bytes, offset) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function readU16LE(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function readU32BE(bytes, offset) { return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0; }
function readU32LE(bytes, offset) { return (bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + (bytes[offset + 3] * 0x1000000)) >>> 0; }
function ascii(bytes, offset, value) {
  if (offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index++) if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  return true;
}
function readU24LE(bytes, offset) { return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16); }

function pngDimensions(bytes) {
  if (bytes.length < 24 || !ascii(bytes, 0, '\u0089PNG\r\n\u001a\n') || !ascii(bytes, 12, 'IHDR')) return undefined;
  return { mime: 'image/png', width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const startsOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset++];
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return undefined;
    if (offset + 2 > bytes.length) return undefined;
    const length = readU16BE(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (startsOfFrame.has(marker)) {
      if (length < 7) return undefined;
      return { mime: 'image/jpeg', width: readU16BE(bytes, offset + 5), height: readU16BE(bytes, offset + 3) };
    }
    offset += length;
  }
  return undefined;
}
function webpDimensions(bytes) {
  if (bytes.length < 20 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP') || readU32LE(bytes, 4) + 8 > bytes.length) return undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = readU32LE(bytes, offset + 4), data = offset + 8;
    if (data + size > bytes.length) return undefined;
    if (kind === 'VP8X' && size >= 10) return { mime: 'image/webp', width: readU24LE(bytes, data + 4) + 1, height: readU24LE(bytes, data + 7) + 1 };
    if (kind === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return { mime: 'image/webp', width: readU16LE(bytes, data + 6) & 0x3fff, height: readU16LE(bytes, data + 8) & 0x3fff };
    }
    if (kind === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      return { mime: 'image/webp', width: (((bytes[data + 2] & 0x3f) << 8) | bytes[data + 1]) + 1,
        height: (((bytes[data + 4] & 0x0f) << 10) | (bytes[data + 3] << 2) | (bytes[data + 2] >> 6)) + 1 };
    }
    offset = data + size + (size % 2);
  }
  return undefined;
}
function imageDimensions(bytes) { return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes); }
function isPortableResourcePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[A-Za-z0-9._/-]+$/.test(value)
    && !value.startsWith('/') && !value.endsWith('/') && value.split('/').every(part => part !== '.' && part !== '..' && part.length > 0);
}
function decodeBase64(value) {
  const maximum = Math.ceil(MAX_SOURCE_BYTES / 3) * 4;
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw bridgeError('VISION_INVALID_REQUEST');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_BYTES || bytes.toString('base64') !== value) throw bridgeError('VISION_INVALID_REQUEST');
  return bytes;
}

/** Validate image identity before its bytes reach an optional adapter. */
export function validateVisionRequest(value) {
  const request = record(value);
  exactKeys(request, ['version', 'source']);
  if (request.version !== '0.1') throw bridgeError('VISION_INVALID_REQUEST');
  const source = record(request.source);
  exactKeys(source, ['path', 'sha256', 'width', 'height', 'mime', 'base64']);
  if (!isPortableResourcePath(source.path) || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
    || source.width > MAX_IMAGE_DIMENSION || source.height > MAX_IMAGE_DIMENSION || source.width * source.height > MAX_IMAGE_PIXELS
    || !mimeTypes.has(source.mime)) throw bridgeError('VISION_INVALID_REQUEST');
  const bytes = decodeBase64(source.base64);
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw bridgeError('VISION_SOURCE_HASH_MISMATCH');
  const dimensions = imageDimensions(bytes);
  if (!dimensions || dimensions.mime !== source.mime || dimensions.width !== source.width || dimensions.height !== source.height
    || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION
    || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) throw bridgeError('VISION_SOURCE_DIMENSIONS_MISMATCH');
  return { version: '0.1', source: { path: source.path, sha256: source.sha256, width: source.width, height: source.height, mime: source.mime, base64: source.base64 } };
}

function encodeProviderResult(value, responseLimit) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw bridgeError('VISION_INVALID_RESPONSE', 502); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > responseLimit) throw bridgeError('VISION_RESPONSE_LIMIT', 502);
  let result;
  try { result = JSON.parse(encoded); } catch { throw bridgeError('VISION_INVALID_RESPONSE', 502); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw bridgeError('VISION_INVALID_RESPONSE', 502);
  return { result, encoded };
}
function parseEncodedSemanticResult({ result, encoded }, expectedSourceSha256) {
  if (result.version !== '0.1' || typeof result.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.sourceSha256)
    || (expectedSourceSha256 !== undefined && result.sourceSha256 !== expectedSourceSha256)
    || !statuses.has(result.status) || typeof result.summary !== 'string' || !result.summary.trim() || result.summary.length > 2000) {
    throw bridgeError('VISION_INVALID_RESPONSE', 502);
  }
  return { status: 200, body: encoded };
}
function parseSemanticResult(value, expectedSourceSha256, responseLimit) {
  return parseEncodedSemanticResult(encodeProviderResult(value, responseLimit), expectedSourceSha256);
}
function parseEncodedPendingResult({ result, encoded }, expectedSourceSha256) {
  const keys = ['version', 'sourceSha256', 'status', 'analysisId', 'pollAfterSeconds'];
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)) || result.version !== '0.1'
    || typeof result.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.sourceSha256)
    || (expectedSourceSha256 !== undefined && result.sourceSha256 !== expectedSourceSha256) || result.status !== 'Pending' || typeof result.analysisId !== 'string'
    || !analysisIdPattern.test(result.analysisId) || !Number.isSafeInteger(result.pollAfterSeconds)
    || result.pollAfterSeconds < 1 || result.pollAfterSeconds > 3600) throw bridgeError('VISION_INVALID_RESPONSE', 502);
  return { status: 202, body: encoded };
}
function parsePendingResult(value, expectedSourceSha256, responseLimit) {
  return parseEncodedPendingResult(encodeProviderResult(value, responseLimit), expectedSourceSha256);
}
function parseSubmitResult(value, sourceSha256, responseLimit) {
  const encoded = encodeProviderResult(value, responseLimit);
  return encoded.result.status === 'Pending' ? parseEncodedPendingResult(encoded, sourceSha256) : parseEncodedSemanticResult(encoded, sourceSha256);
}
function parsePollResult(value, responseLimit) {
  const encoded = encodeProviderResult(value, responseLimit);
  return encoded.result.status === 'Pending' ? parseEncodedPendingResult(encoded, undefined) : parseEncodedSemanticResult(encoded, undefined);
}
function header(request, name) {
  const value = request.headers?.[name];
  return typeof value === 'string' ? value : undefined;
}
function loopbackHost(host) {
  try {
    const parsed = new URL(`http://${host}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash
      || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== '[::1]')) return undefined;
    return parsed;
  } catch { return undefined; }
}
function loopbackAddress(address) { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
function isSameOrigin(value, host, requireOriginForm) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && !parsed.username && !parsed.password && parsed.host === host
      && (!requireOriginForm || (parsed.pathname === '/' && !parsed.search && !parsed.hash));
  } catch { return false; }
}

/** The endpoint accepts only browser fetches from the same loopback origin. */
export function isTrustedVisionRequest(request) {
  const host = header(request, 'host');
  const origin = header(request, 'origin');
  const parsedHost = host && loopbackHost(host);
  if (!parsedHost || !loopbackAddress(request.socket?.remoteAddress)) return false;
  if (origin) return isSameOrigin(origin, parsedHost.host, true);
  // Browsers may omit Origin on a same-origin GET. POST always needs Origin;
  // this fallback is only enough for the local health/status read.
  return request.method === 'GET' && header(request, 'sec-fetch-site') === 'same-origin'
    && isSameOrigin(header(request, 'referer') ?? '', parsedHost.host, false);
}
function sendJson(response, status, value) {
  if (response.writableEnded || response.destroyed) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}
function sendSerializedJson(response, status, body) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}
function sendError(response, status, code) { sendJson(response, status, { version: '0.1', error: code }); }
function contentLength(request) {
  const value = header(request, 'content-length');
  if (value === undefined) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw bridgeError('VISION_INVALID_REQUEST');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw bridgeError('VISION_INVALID_REQUEST');
  return length;
}
function readJsonBody(request, maximum) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      request.removeListener('data', onData); request.removeListener('end', onEnd); request.removeListener('error', onError); request.removeListener('aborted', onAborted);
      if (error) reject(error); else resolve(value);
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > maximum) { request.destroy(); finish(bridgeError('VISION_REQUEST_LIMIT', 413)); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish(undefined, JSON.parse(Buffer.concat(chunks, size).toString('utf8'))); }
      catch { finish(bridgeError('VISION_INVALID_REQUEST')); }
    };
    const onError = () => finish(bridgeError('VISION_INVALID_REQUEST'));
    const onAborted = () => finish(bridgeError('VISION_REQUEST_ABORTED', 400));
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onAborted);
  });
}
function configuredPath(value) { return typeof value === 'string' && isAbsolute(value) ? value : undefined; }
function hasAnalyze(adapter) { return adapter && typeof adapter.analyze === 'function'; }
function hasAsyncProtocol(adapter) { return adapter && typeof adapter.submit === 'function' && typeof adapter.poll === 'function'; }
function validAdapter(adapter) { return Boolean(hasAnalyze(adapter) || hasAsyncProtocol(adapter)); }
function route(request) {
  let value;
  try { value = new URL(request.url, 'http://loopback.invalid'); } catch { return undefined; }
  if (value.pathname !== VISION_ENDPOINT) return undefined;
  if (!value.search) return { kind: 'health' };
  if (request.method !== 'GET' || value.searchParams.size !== 1 || !value.searchParams.has('analysisId')) return { kind: 'invalid' };
  const analysisId = value.searchParams.get('analysisId');
  return typeof analysisId === 'string' && analysisIdPattern.test(analysisId) ? { kind: 'poll', analysisId } : { kind: 'invalid' };
}

/**
 * Creates Vite-compatible middleware. Options exist for test doubles; product
 * configuration uses only UI_VISION_ADAPTER and never serializes its path.
 */
export function createVisionBridge(options = {}) {
  const adapterPath = options.adapterPath === undefined ? configuredPath(process.env.UI_VISION_ADAPTER) : configuredPath(options.adapterPath);
  const suppliedAdapter = options.adapter;
  const configured = Boolean(adapterPath || validAdapter(suppliedAdapter));
  const maxConcurrent = Number.isSafeInteger(options.maxConcurrent) && options.maxConcurrent > 0 ? options.maxConcurrent : MAX_VISION_CONCURRENCY;
  const requestLimit = Number.isSafeInteger(options.requestLimit) && options.requestLimit > 0 ? options.requestLimit : MAX_REQUEST_BYTES;
  const responseLimit = Number.isSafeInteger(options.responseLimit) && options.responseLimit > 0 ? options.responseLimit : MAX_RESPONSE_BYTES;
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : VISION_TIMEOUT_MS;
  let adapterPromise, active = 0;
  async function adapter() {
    if (validAdapter(suppliedAdapter)) return suppliedAdapter;
    if (!adapterPath) return undefined;
    adapterPromise ??= import(pathToFileURL(adapterPath).href)
      .then(module => validAdapter(module) ? module : Promise.reject(bridgeError('VISION_ADAPTER_INVALID', 503)))
      .catch(() => Promise.reject(bridgeError('VISION_ADAPTER_UNAVAILABLE', 503)));
    return adapterPromise;
  }
  async function invokeProvider(request, response, provider, invoke, parseResult) {
    let slotReserved = false, providerWork = false, timer, onResponseClose;
    try {
      if (active >= maxConcurrent) throw bridgeError('VISION_BUSY', 429);
      active++;
      slotReserved = true;
      const controller = new AbortController();
      onResponseClose = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', onResponseClose);
      const work = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('VISION_CLIENT_DISCONNECTED');
        return invoke(controller.signal);
      });
      providerWork = true;
      void work.then(() => { if (slotReserved) { slotReserved = false; active--; } }, () => { if (slotReserved) { slotReserved = false; active--; } });
      let output;
      try {
        output = await Promise.race([
          work,
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(bridgeError('VISION_TIMEOUT', 504)); }, timeoutMs); }),
        ]);
      } catch (error) {
        if (error instanceof VisionBridgeError && error.code === 'VISION_TIMEOUT') throw error;
        // Provider details may contain credentials, endpoints, or internal state.
        throw bridgeError('VISION_ANALYSIS_FAILED', 502);
      }
      const result = parseResult(output);
      sendSerializedJson(response, result.status, result.body);
    } catch (error) {
      // A timed-out provider retains its slot until its own promise settles. An
      // adapter that honors AbortSignal normally settles immediately; neither
      // path retries a request or lets a second analysis start in its place.
      if (slotReserved && !providerWork) { slotReserved = false; active--; }
      if (!response.writableEnded && !response.destroyed) {
        if (error instanceof VisionBridgeError) sendError(response, error.status, error.code);
        else sendError(response, 502, 'VISION_ANALYSIS_FAILED');
      }
    } finally {
      clearTimeout(timer);
      if (onResponseClose) response.removeListener('close', onResponseClose);
    }
  }
  async function middleware(request, response, next) {
    const target = route(request);
    if (!target) return next();
    if (!isTrustedVisionRequest(request)) { sendError(response, 403, 'VISION_FORBIDDEN'); return; }
    if (target.kind === 'invalid') { sendError(response, 400, 'VISION_INVALID_REQUEST'); return; }
    if (request.method === 'GET') {
      if (target.kind === 'health') { sendJson(response, 200, { version: '0.1', configured }); return; }
      try {
        if (!configured) throw bridgeError('VISION_NOT_CONFIGURED', 503);
        const provider = await adapter();
        if (!hasAsyncProtocol(provider)) throw bridgeError('VISION_POLL_NOT_SUPPORTED', 503);
        await invokeProvider(request, response, provider, signal => provider.poll(target.analysisId, { signal }),
          value => parsePollResult(value, responseLimit));
      } catch (error) {
        if (response.writableEnded || response.destroyed) return;
        if (error instanceof VisionBridgeError) sendError(response, error.status, error.code);
        else sendError(response, 502, 'VISION_ANALYSIS_FAILED');
      }
      return;
    }
    if (request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); sendError(response, 405, 'VISION_METHOD_NOT_ALLOWED'); return; }
    if (!/^application\/json(?:\s*;.*)?$/i.test(header(request, 'content-type') ?? '')) { sendError(response, 415, 'VISION_CONTENT_TYPE'); return; }
    try {
      const length = contentLength(request);
      if (length !== undefined && length > requestLimit) throw bridgeError('VISION_REQUEST_LIMIT', 413);
      if (!configured) throw bridgeError('VISION_NOT_CONFIGURED', 503);
      const input = validateVisionRequest(await readJsonBody(request, requestLimit));
      const provider = await adapter();
      if (!provider) throw bridgeError('VISION_NOT_CONFIGURED', 503);
      if (hasAsyncProtocol(provider)) {
        await invokeProvider(request, response, provider, signal => provider.submit(input, { signal }),
          value => parseSubmitResult(value, input.source.sha256, responseLimit));
      } else if (hasAnalyze(provider)) {
        await invokeProvider(request, response, provider, signal => provider.analyze(input, { signal }),
          value => parseSemanticResult(value, input.source.sha256, responseLimit));
      } else throw bridgeError('VISION_ADAPTER_INVALID', 503);
    } catch (error) {
      if (response.writableEnded || response.destroyed) return;
      if (error instanceof VisionBridgeError) sendError(response, error.status, error.code);
      else sendError(response, 502, 'VISION_ANALYSIS_FAILED');
    }
  }
  return { configured, middleware };
}

/** Install the same bridge for `vite` development and `vite preview`. */
export function createVisionBridgePlugin(options) {
  const bridge = createVisionBridge(options);
  const install = server => { server.middlewares.use(bridge.middleware); };
  return { name: 'local-ui-vision-bridge', configureServer: install, configurePreviewServer: install };
}
