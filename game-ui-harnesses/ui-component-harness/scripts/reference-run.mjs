/** Local unattended reference acceptance; owns its static server and browser lifetime. */
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function bounded(operation) { let timer; try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REFERENCE_BROWSER_TIMEOUT')), 30000); })]); } finally { clearTimeout(timer); } }
async function regularPath(path, directory = false) {
  const absolute = resolve(path); let cursor = absolute;
  for (;;) {
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || (cursor === absolute ? directory ? !stat.isDirectory() : !stat.isFile() : !stat.isDirectory())) throw new Error('UNSAFE_LOCAL_PATH');
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return absolute;
}
async function boundedFile(path, maximum) {
  await regularPath(path); if ((await lstat(path)).size > maximum) throw new Error('INPUT_SIZE_LIMIT');
  const bytes = await readFile(path); if (bytes.length > maximum) throw new Error('INPUT_SIZE_LIMIT'); return bytes;
}
async function staticServer(root) {
  const base = await realpath(root);
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${server.address().port}`) throw new Error('REQUEST_REJECTED');
      const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const target = resolve(base, `.${path}`);
      if (!target.startsWith(base + sep)) throw new Error('PATH_REJECTED');
      await regularPath(target);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(target)];
      if (!mime) throw new Error('TYPE_REJECTED');
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); response.end(await readFile(target));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ok); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
export async function runReferenceCommand(command, argv, modules) {
  if (argv.length !== 3 || argv[1] !== '--output') throw new Error(`${command} <input> --output <new-output>`);
  const [input, , output] = argv;
  const [bundleApi, handoffApi, persistence] = await Promise.all([modules('bundle'), modules('component-handoff'), modules('reference-persistence')]);
  await regularPath(dirname(resolve(output)), true);
  if (command === 'reference-export') {
    const bundle = await bundleApi.validateBundle(JSON.parse(await boundedFile(input, 550 * 1024 * 1024)));
    const bytes = await persistence.exportReferenceHandoff(bundle);
    await writeFile(output, bytes, { flag: 'wx' });
    process.stdout.write(JSON.stringify({ sha256: sha(bytes), human_visual_acceptance: false }) + '\n'); return;
  }
  await mkdir(output); // Exclusive reservation. An existing path is never touched.
  const report = { kind: 'ui-reference-acceptance-report', schemaVersion: '1.1', status: 'failed', human_visual_acceptance: false, artifacts: [], checks: [], interactionAcceptance: 'not_run_reference_replay_is_not_user_input' };
  let browser, server;
  const save = async (name, data) => { await writeFile(join(output, name), data, { flag: 'wx' }); report.artifacts.push({ path: name, sha256: sha(data) }); };
  try {
    const bytes = await boundedFile(input, 324 * 1024 * 1024);
    report.inputSha256 = sha(bytes);
    const imported = await handoffApi.importComponentHandoffWithReview(bytes);
    report.checks.push({ check: 'official_handoff_import', status: 'passed' });
    const saved = JSON.stringify(imported.bundle);
    await save('saved.ui-bundle.json', saved);
    const reopened = await bundleApi.validateBundle(JSON.parse(saved));
    report.checks.push({ check: 'save_reopen', status: 'passed' });
    if (reopened.componentHandoff) {
      const exported = await persistence.exportReferenceHandoff(reopened);
      const roundtrip = await handoffApi.importComponentHandoffWithReview(exported);
      if (JSON.stringify(imported.referenceEvidence) !== JSON.stringify(roundtrip.referenceEvidence)) throw new Error('REFERENCE_ROUNDTRIP_MISMATCH');
      await save('roundtrip.ui.component-handoff.draft.zip', exported);
      report.packageStatus = 'roundtrip_validated_unreviewed_not_acceptance';
      report.checks.push({ check: 'reexport_reimport_reference_bytes', status: 'passed' });
    }
    await save('reference-evidence.json', JSON.stringify(imported.referenceEvidence, null, 2));
    for (const file of imported.referenceEvidence.files) {
      await mkdir(dirname(join(output, file.path)), { recursive: true });
      await save(file.path, Buffer.from(file.base64, 'base64'));
    }
    const doc = reopened.document;
    if (doc.schemaVersion !== '0.2' || doc.canvas.width > 8192 || doc.canvas.height > 8192 || doc.canvas.width * doc.canvas.height > 16777216) throw new Error('CAPTURE_CANVAS_LIMIT');
    const root = fileURLToPath(new URL('../dist/', import.meta.url));
    await regularPath(join(root, 'reference-acceptance.html'));
    const hosted = await staticServer(root); server = hosted.server;
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(process.platform === 'win32' ? { channel: 'msedge' } : {}), timeout: 30000 });
    const context = await browser.newContext({ viewport: { width: doc.canvas.width, height: doc.canvas.height }, deviceScaleFactor: 1 });
    await context.route('**/*', route => { const url = route.request().url(); return url.startsWith(hosted.url + '/') ? route.continue() : route.abort('blockedbyclient'); });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(hosted.url + '/reference-acceptance.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.referenceAcceptance));
    const state = await bounded(page.evaluate(bundle => window.referenceAcceptance.load(bundle), reopened));
    await save('runtime-state.json', JSON.stringify(state, null, 2));
    report.unknownFields = state.unknownFields;
    report.checks.push({ check: 'reference_state_replay', status: state.evidenceStatus === 'complete' ? 'passed_known_fields_only' : 'not_run' });
    const screenshot = await page.locator('#runtime canvas').screenshot({ omitBackground: true });
    await save('runtime.png', screenshot);
    const comparison = await bounded(page.evaluate(png => window.referenceAcceptance.compare(png), screenshot.toString('base64')));
    comparison.screenshot = { path: 'runtime.png', sha256: sha(screenshot), width: doc.canvas.width, height: doc.canvas.height };
    await save('visual-comparison.json', JSON.stringify(comparison, null, 2));
    if (state.evidenceStatus === 'complete') await save('mapped-reference.png', Buffer.from(await bounded(page.evaluate(() => window.referenceAcceptance.mapped())), 'base64'));
    if (errors.length) throw new Error('BROWSER_RUNTIME_ERROR');
    report.status = comparison.status === 'passed' ? 'technical_passed' : comparison.status === 'failed' ? 'visual_failed' : comparison.status;
    report.comparison = comparison;
  } catch (error) {
    report.status = 'failed'; report.error = { code: String(error.code ?? error.message ?? 'REFERENCE_ACCEPTANCE_FAILED').split(/[\r\n]/)[0].replace(/[A-Za-z]:[\\/][^\s]*/g, '[local-path]') };
  } finally {
    try { await browser?.close(); } catch { report.status = 'failed'; report.cleanupError = 'BROWSER_CLOSE_FAILED'; }
    try { if (server) { server.closeAllConnections(); await new Promise((ok, reject) => server.close(error => error ? reject(error) : ok())); } }
    catch { report.status = 'failed'; report.cleanupError = 'SERVER_CLOSE_FAILED'; }
    report.cleanup = report.cleanupError ? 'failed' : 'completed';
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  process.stdout.write(JSON.stringify({ status: report.status, human_visual_acceptance: false }) + '\n');
  if (report.status === 'partially_verified') process.exitCode = 3;
  else if (report.status !== 'technical_passed') process.exitCode = 2;
}
