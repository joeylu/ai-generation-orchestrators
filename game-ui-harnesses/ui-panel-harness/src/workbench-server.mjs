import { createServer } from 'node:http';
import { listenLoopback } from './loopback-listener.mjs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { canonicalJson, digestBytes, digestJson } from './canonical.mjs';
import { harnessRoot } from './io.mjs';
import { createStudioBuildInfo, validateStudioBuildInfo, studioHtmlTemplate } from './studio-build-info.mjs';
import { validateCatalog } from './catalog.mjs';
import { validatePlanningContext } from './planning-context.mjs';
import { checkPanelProposal, validatePanelProposal } from './proposal.mjs';
import { validatePanelEditContext, validatePanelEditProposal, checkPanelEditProposal } from './edit-planning.mjs';
import { applyPanelPatch } from './patch.mjs';
import { validateCodexDiagnostic } from './codex-diagnostics.mjs';
import { validateWorkbenchAssetPool, verifyWorkbenchContextPool, workbenchAssetInputs } from './workbench-assets.mjs';
import { isBundledCorePool } from './bundled-core-assets.mjs';
import { CODEX_MODEL, CODEX_EFFORT, findCodexExecutable, planWithCodex, editWithCodex, validateCodexReceipt, validateCodexEditReceipt } from './codex-planner.mjs';

const MIB = 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code, status = 400) => { const error = new Error(code); error.code = code; error.status = status; throw error; };
const exact = (value, keys, code) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !same(Object.keys(value).sort(), [...keys].sort())) fail(code);
};
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};

async function rejectLinks(path, allowMissing = false) {
  for (let current = resolve(path); ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) fail('WORKBENCH_SERVER_LINK_FORBIDDEN'); }
    catch (error) { if (!allowMissing || error.code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
  }
}
async function readBounded(path, limit) {
  await rejectLinks(path);
  const before = await lstat(path);
  if (!before.isFile() || before.size > limit) fail('WORKBENCH_SERVER_FILE_LIMIT');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== before.size || info.size > limit
        || info.ino !== before.ino || info.dev !== before.dev) fail('WORKBENCH_SERVER_FILE_CHANGED');
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size !== info.size) fail('WORKBENCH_SERVER_FILE_CHANGED');
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

/** Validate and snapshot two exact build artifacts before opening a listening socket. */
async function loadBuild(workbench) {
  const directory = resolve(workbench);
  const manifest = JSON.parse(decode(await readBounded(resolve(directory, 'workbench-build.json'), 64 * 1024)));
  if (manifest.workbenchBuildVersion !== '0.1' || manifest.status !== 'COMPLETE'
      || !Array.isArray(manifest.files) || manifest.files.length !== 2) fail('WORKBENCH_SERVER_MANIFEST');
  const names = ['index.html', 'workbench.js'], artifacts = new Map();
  for (const [index, name] of names.entries()) {
    const item = manifest.files[index];
    exact(item, ['path', 'bytes', 'sha256'], 'WORKBENCH_SERVER_MANIFEST');
    if (item.path !== name || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !HASH.test(item.sha256)) fail('WORKBENCH_SERVER_MANIFEST');
    const bytes = await readBounded(resolve(directory, name), name === 'index.html' ? 28 * MIB : 8 * MIB);
    if (bytes.length !== item.bytes || await digestBytes(bytes) !== item.sha256) fail('WORKBENCH_SERVER_BUILD_DIGEST');
    artifacts.set(name, bytes);
  }
  const html = decode(artifacts.get('index.html'));
  const seeds = [...html.matchAll(/<script\b[^>]*\bid="workbench-seed"[^>]*\btype="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (seeds.length !== 1) fail('WORKBENCH_SERVER_SEED');
  const raw = JSON.parse(seeds[0][1]);
  exact(raw, ['workbenchSeedVersion', 'catalog', 'pool', 'example'], 'WORKBENCH_SERVER_SEED');
  if (raw.workbenchSeedVersion !== '0.1') fail('WORKBENCH_SERVER_SEED');
  const catalog = freeze(validateCatalog(raw.catalog));
  const pool = raw.pool === null ? null : await validateWorkbenchAssetPool(raw.pool);
  const sourceReplayValid = pool
    ? manifest.sourceReplay === 'VERIFIED_AT_BUILD' || (manifest.sourceReplay === 'PINNED_BUNDLED_ASSETS' && isBundledCorePool(pool))
    : manifest.sourceReplay === 'NOT_APPLICABLE';
  if (manifest.catalogSha256 !== await digestJson(catalog) || manifest.poolSha256 !== (pool?.sha256 ?? null)
      || !same(manifest.library, pool ? { id: pool.index.id, sha256: pool.index.sha256 } : null)
      || manifest.recordCount !== (pool?.index.records.length ?? 0) || manifest.imageCount !== (pool?.resources.length ?? 0)
      || !sourceReplayValid) fail('WORKBENCH_SERVER_SEED_MISMATCH');
  if (raw.example === null) {
    if (manifest.example !== null) fail('WORKBENCH_SERVER_EXAMPLE');
  } else {
    exact(raw.example, ['context', 'proposal'], 'WORKBENCH_SERVER_EXAMPLE');
    const context = await validatePlanningContext(raw.example.context);
    if (!same(context.catalog, catalog)) fail('WORKBENCH_SERVER_CATALOG_MISMATCH');
    if (context.assetRetrieval) {
      if (!pool) fail('WORKBENCH_SERVER_POOL_REQUIRED');
      await verifyWorkbenchContextPool(context, pool);
    }
    const proposal = await validatePanelProposal(context, raw.example.proposal), report = await checkPanelProposal(context, proposal);
    if (report.status !== 'READY_TO_COMPILE' || (proposal.spec?.assets && !context.assetRetrieval)
        || manifest.example?.contextSha256 !== context.sha256 || manifest.example?.proposalSha256 !== report.proposalSha256
        || !HASH.test(manifest.example?.panelSha256)) fail('WORKBENCH_SERVER_EXAMPLE');
    if (pool) await workbenchAssetInputs(proposal.spec, pool);
  }
  let studio = null;
  if (manifest.studio !== undefined) {
    studio = validateStudioBuildInfo(manifest.studio);
    let template;
    try { template = studioHtmlTemplate(html, studio); } catch { fail('WORKBENCH_SERVER_BUILD_IDENTITY'); }
    const expected = await createStudioBuildInfo(studio.appVersion, { shellSha256: await digestBytes(Buffer.from(template)), scriptSha256: await digestBytes(artifacts.get('workbench.js')) });
    if (!same(studio, expected)) fail('WORKBENCH_SERVER_BUILD_IDENTITY');
  }
  return { artifacts, catalog, pool, studio };
}

async function validateOutputRoot(input) {
  if (typeof input !== 'string' || !input) fail('WORKBENCH_SERVER_OUTPUT_REQUIRED');
  const target = resolve(input), rel = relative(resolve(harnessRoot), target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
      || rel.split(sep).some(part => /^(?:\.git|\.codex|\.agents)$/i.test(part))) fail('OUTPUT_OUTSIDE_HARNESS');
  await rejectLinks(target, true);
  try { if (!(await lstat(target)).isDirectory()) fail('WORKBENCH_SERVER_OUTPUT_DIRECTORY'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}

function readBody(request) {
  if (request.headers['content-type'] !== 'application/json') fail('WORKBENCH_SERVER_CONTENT_TYPE', 415);
  if (request.headers['content-encoding'] !== undefined) fail('WORKBENCH_SERVER_CONTENT_ENCODING', 415);
  if (request.headers['content-length'] !== undefined
      && (!/^\d+$/.test(request.headers['content-length']) || Number(request.headers['content-length']) > 2 * MIB)) fail('WORKBENCH_SERVER_BODY_LIMIT', 413);
  return new Promise((resolveBody, reject) => {
    const chunks = []; let length = 0;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > 2 * MIB) { const error = new Error('WORKBENCH_SERVER_BODY_LIMIT'); error.code = error.message; error.status = 413; reject(error); }
      else chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('aborted', () => reject(Object.assign(new Error('WORKBENCH_SERVER_ABORTED'), { code: 'WORKBENCH_SERVER_ABORTED' })));
    request.on('end', () => {
      try { resolveBody(JSON.parse(decode(Buffer.concat(chunks)))); }
      catch { reject(Object.assign(new Error('WORKBENCH_SERVER_JSON'), { code: 'WORKBENCH_SERVER_JSON', status: 400 })); }
    });
  });
}
function errorCode(error) {
  return /^(?:WORKBENCH_SERVER_|CODEX_|PLAN_|EDIT_|PANEL_ASSET_)[A-Z0-9_]{1,72}$/.test(error?.code ?? '')
    ? error.code : 'WORKBENCH_SERVER_FAILED';
}

/** Optional local transport. Startup performs no inference; only one admitted POST may call the planner. */
export async function createWorkbenchServer({ workbench, outputRoot, port = 0, planner, editor, executable } = {}) {
  if (typeof workbench !== 'string' || !workbench || !Number.isInteger(port) || port < 0 || port > 65535
      || (planner !== undefined && typeof planner !== 'function')
      || (editor !== undefined && typeof editor !== 'function')) fail('WORKBENCH_SERVER_ARGUMENTS');
  const build = await loadBuild(workbench), output = await validateOutputRoot(outputRoot);
  const injected = planner !== undefined || editor !== undefined;
  let resolvedExecutable = executable;
  if (!injected) {
    try {
      resolvedExecutable = await findCodexExecutable(executable === undefined ? process.env : { ...process.env, UI_PANEL_CODEX_COMMAND: executable });
    }
    catch { resolvedExecutable = undefined; }
  }
  // Test adapters never fall back to a real CLI for the other operation.
  const available = Boolean(planner) || (!injected && Boolean(resolvedExecutable));
  const editingAvailable = Boolean(editor) || (!injected && Boolean(resolvedExecutable));
  const requestIds = new Set();
  let origin, expectedHost, active = null, closing = false;
  const send = (response, status, value, mime = 'application/json; charset=utf-8') => {
    if (response.destroyed || response.writableEnded) return;
    const body = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    response.writeHead(status, { 'Content-Type': mime, 'Content-Length': body.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    response.end(body);
  };
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16 * 1024 }, async (request, response) => {
    let controller, context, editing;
    try {
      if (request.headers.host !== expectedHost) fail('WORKBENCH_SERVER_HOST', 403);
      if (closing) fail('WORKBENCH_SERVER_CLOSED', 503);
      if (request.method === 'GET') {
        if (request.url === '/api/panel/studio') {
          return send(response, 200, { protocol: '0.1', kind: 'ui-panel-studio', build: build.studio, active: Boolean(active) });
        }
        if (request.url === '/api/panel/capabilities') {
          return send(response, 200, { protocol: '0.1', model: CODEX_MODEL, effort: CODEX_EFFORT, available, editingAvailable });
        }
        const name = request.url === '/' || request.url === '/index.html' ? 'index.html' : request.url === '/workbench.js' ? 'workbench.js' : null;
        if (!name) fail('WORKBENCH_SERVER_NOT_FOUND', 404);
        return send(response, 200, build.artifacts.get(name), name === 'index.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
      }
      editing = request.url === '/api/panel/edit';
      if (request.method !== 'POST' || (!editing && request.url !== '/api/panel/plan')) fail('WORKBENCH_SERVER_METHOD', 405);
      if (request.headers.origin !== origin || (request.headers['sec-fetch-site'] !== undefined && request.headers['sec-fetch-site'] !== 'same-origin')) fail('WORKBENCH_SERVER_ORIGIN', 403);
      if (!(editing ? editingAvailable : available)) fail('WORKBENCH_SERVER_CODEX_UNAVAILABLE', 503);
      if (active) fail('WORKBENCH_SERVER_BUSY', 409);
      controller = new AbortController(); active = controller;
      const aborted = () => controller.abort();
      request.once('aborted', aborted);
      response.once('close', () => { if (!response.writableEnded) aborted(); });
      const input = await readBody(request);
      exact(input, ['requestId', 'context'], 'WORKBENCH_SERVER_REQUEST');
      if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) fail('WORKBENCH_SERVER_REQUEST_ID');
      // IDs are consumed before validating the context. Every admitted request is single use.
      const id = input.requestId.toLowerCase();
      if (requestIds.has(id)) fail('WORKBENCH_SERVER_DUPLICATE', 409);
      if (requestIds.size >= 256) fail('WORKBENCH_SERVER_REQUEST_LIMIT', 429);
      requestIds.add(id);
      try {
        context = await (editing ? validatePanelEditContext : validatePlanningContext)(input.context);
        if (!same(context.catalog, build.catalog)) fail('WORKBENCH_SERVER_CATALOG_MISMATCH');
        if (editing) {
          if (context.spec.assets) {
            if (!build.pool) fail('WORKBENCH_SERVER_POOL_REQUIRED');
            await workbenchAssetInputs(context.spec, build.pool);
          }
        } else if (build.pool) await verifyWorkbenchContextPool(context, build.pool);
        else if (context.assetRetrieval) fail('WORKBENCH_SERVER_POOL_REQUIRED');
      } catch (error) { if (!error.status) error.status = 400; throw error; }
      if (controller.signal.aborted) fail('WORKBENCH_SERVER_ABORTED', 499);
      freeze(context);
      const invoke = editing ? editor ?? editWithCodex : planner ?? planWithCodex;
      const result = await invoke(context, { outputRoot: output, signal: controller.signal, executable: resolvedExecutable });
      if (controller.signal.aborted || closing) fail('WORKBENCH_SERVER_ABORTED', 499);
      // Adapter outputs are untrusted. The portable validators produce all successful evidence.
      exact(result, ['proposal', 'report', 'receipt'], 'WORKBENCH_SERVER_RESULT');
      const proposal = await (editing ? validatePanelEditProposal : validatePanelProposal)(context, result.proposal);
      const report = await (editing ? checkPanelEditProposal : checkPanelProposal)(context, proposal);
      if (!same(result.report, report)) fail('WORKBENCH_SERVER_REPORT');
      if (editing) {
        if (report.status === 'READY_TO_APPLY') {
          const updated = await applyPanelPatch(context.spec, proposal.patch);
          if (updated.spec.assets) await workbenchAssetInputs(updated.spec, build.pool);
        }
      } else {
        if (proposal.spec?.assets && !context.assetRetrieval) fail('WORKBENCH_SERVER_POOL_REQUIRED');
        if (build.pool && proposal.spec) await workbenchAssetInputs(proposal.spec, build.pool);
      }
      const receipt = (editing ? validateCodexEditReceipt : validateCodexReceipt)(result.receipt, { contextSha256: context.sha256, proposalSha256: report.proposalSha256 });
      if (receipt.status !== report.status || receipt.failureCode !== null || receipt.invocationCount !== 1) fail('WORKBENCH_SERVER_RECEIPT');
      send(response, 200, { protocol: '0.1', requestId: input.requestId, contextSha256: context.sha256, proposal, report, receipt });
    } catch (error) {
      let diagnostic;
      if (context && ['CODEX_OUTPUT_INVALID', 'CODEX_PROPOSAL_INVALID', 'CODEX_PROVENANCE_INVALID'].includes(error.code) && error.diagnostic) {
        try { diagnostic = validateCodexDiagnostic(error.diagnostic, { operation: editing ? 'edit' : 'plan', contextSha256: context.sha256, failureCode: error.code }); } catch {}
      }
      send(response, error.status ?? 502, { code: errorCode(error), ...(diagnostic ? { diagnostic } : {}) });
    } finally {
      if (controller && active === controller) active = null;
    }
  });
  await listenLoopback(server, port);
  expectedHost = `127.0.0.1:${server.address().port}`; origin = `http://${expectedHost}`;
  let closePromise;
  return Object.freeze({ url: `${origin}/`, model: CODEX_MODEL, effort: CODEX_EFFORT, available, editingAvailable, studio: build.studio,
    close() {
      if (!closePromise) {
        closing = true; active?.abort();
        closePromise = new Promise(resolveClose => { server.close(() => resolveClose()); server.closeAllConnections(); });
      }
      return closePromise;
    },
  });
}
