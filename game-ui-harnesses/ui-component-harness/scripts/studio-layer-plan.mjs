/** Same-origin loopback bridge for one explicit Codex planning request. No queue or polling. */
import { createHash } from 'node:crypto';
import { MAX_LAYER_SOURCE_BYTES } from '../src/layer-component.ts';
import { layerPlanningInput, validateLayerProposal } from '../src/layer-auto-dag.ts';
import { isTrustedLocalRequest } from './studio-local-origin.mjs';
import { validateLayerPlanExecution } from '../src/studio-layer-plan.ts';
import { LayerPlanningUnresolvedError, validateLayerPlanningDiagnostic } from '../src/layer-planning-evidence.ts';
import { createCodexLayerPlanner, LayerSessionError, MAX_PLANNING_RUN_MS, MAX_PLAN_CORRECTIONS, MAX_SESSION_OUTPUT } from './studio-codex-plan.mjs';

export const LAYER_PLAN_ENDPOINT = '/api/ui-layer-plan';
export const MAX_LAYER_PLAN_REQUEST = Math.ceil(MAX_LAYER_SOURCE_BYTES / 3) * 4 + 4096;
function send(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body), 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}
function failure(code) { throw new LayerSessionError(code); }
export function decodeLayerPlanRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== 'archive|version' || value.version !== '1.0') failure('LAYER_PLANNER_REQUEST_INVALID');
  const source = value.archive;
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).sort().join('|') !== 'base64|sha256' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || typeof source.base64 !== 'string' || !source.base64.length || source.base64.length > Math.ceil(MAX_LAYER_SOURCE_BYTES / 3) * 4
    || source.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.base64)) failure('LAYER_PLANNER_REQUEST_INVALID');
  const archive = Buffer.from(source.base64, 'base64');
  if (archive.length > MAX_LAYER_SOURCE_BYTES || archive.toString('base64') !== source.base64) failure('LAYER_PLANNER_REQUEST_INVALID');
  if (createHash('sha256').update(archive).digest('hex') !== source.sha256) failure('LAYER_PLANNER_SOURCE_STALE');
  return new Uint8Array(archive);
}
async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_LAYER_PLAN_REQUEST) failure('LAYER_PLANNER_REQUEST_LIMIT');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return failure('LAYER_PLANNER_REQUEST_INVALID'); }
}
export function createLayerPlanBridge(options = {}) {
  const planner = options.planner ?? createCodexLayerPlanner(); let active = false;
  async function middleware(request, response, next) {
    let url;
    try { url = new URL(request.url, 'http://loopback.invalid'); } catch { next(); return; }
    if (url.pathname !== LAYER_PLAN_ENDPOINT) { next(); return; }
    if (!isTrustedLocalRequest(request)) { send(response, 403, { error: 'LAYER_PLANNER_ORIGIN_REJECTED' }); return; }
    if (url.search || !['GET', 'POST'].includes(request.method)) { send(response, 405, { error: 'LAYER_PLANNER_METHOD_REJECTED' }); return; }
    if (request.method === 'GET') { send(response, 200, { version: '2.0', configured: planner.configured, driver: planner.driver, busy: active, maxCorrections: MAX_PLAN_CORRECTIONS }); return; }
    if (active) { send(response, 429, { error: 'LAYER_PLANNER_BUSY' }); return; }
    if (!planner.configured) { send(response, 503, { error: 'SESSION_NOT_CONFIGURED' }); return; }
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) { send(response, 415, { error: 'LAYER_PLANNER_CONTENT_TYPE' }); return; }
    const length = request.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_LAYER_PLAN_REQUEST)) {
      send(response, 413, { error: 'LAYER_PLANNER_REQUEST_LIMIT' }); return;
    }
    active = true;
    const controller = new AbortController();
    const abort = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', abort);
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? MAX_PLANNING_RUN_MS + 10000);
    try {
      const archive = decodeLayerPlanRequest(await readBody(request));
      const input = await layerPlanningInput(archive);
      const result = planner.planRun ? await planner.planRun(archive, { signal: controller.signal, origin: `http://${request.headers.host}` })
        : { proposal: await planner.plan(archive, { signal: controller.signal }), execution: null };
      const { proposal } = result;
      if (Object.keys(result).sort().join('|') !== 'execution|proposal') failure('LAYER_PLANNER_RESPONSE_INVALID');
      if (result.execution !== null) validateLayerPlanExecution(result.execution);
      const body = JSON.stringify({ version: '2.0', ...result });
      if (!body || Buffer.byteLength(body) > MAX_SESSION_OUTPUT) failure('SESSION_OUTPUT_LIMIT_NO_RETRY');
      await validateLayerProposal(archive, input, proposal);
      send(response, 200, { version: '2.0', ...result });
    } catch (error) {
      const code = error instanceof LayerPlanningUnresolvedError ? 'LAYER_PLANNING_UNRESOLVED'
        : error instanceof LayerSessionError ? error.code : 'LAYER_PLANNER_FAILED_NO_RETRY';
      let diagnostic;
      if (['LAYER_PLANNING_UNRESOLVED', 'SESSION_CORRECTIONS_EXHAUSTED'].includes(code) && error.diagnostic) {
        try { diagnostic = validateLayerPlanningDiagnostic(error.diagnostic); } catch { /* Never expose unvalidated model notes. */ }
      }
      const status = /REQUEST_LIMIT/.test(code) ? 413 : /REQUEST_INVALID|SOURCE_STALE/.test(code) ? 400 : /NOT_CONFIGURED/.test(code) ? 503 : 502;
      send(response, status, { error: code, ...(diagnostic ? { diagnostic } : {}) });
    } finally { clearTimeout(timer); response.removeListener('close', abort); active = false; }
  }
  return { configured: planner.configured, middleware };
}
export function createLayerPlanBridgePlugin(options) {
  const bridge = createLayerPlanBridge(options);
  const install = server => { server.middlewares.use(bridge.middleware); };
  return { name: 'local-ui-layer-plan-bridge', configureServer: install, configurePreviewServer: install };
}
