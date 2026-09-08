/** File orchestration only. Existing neutral compilers own every contract. */
import { access, mkdir, readFile, writeFile, unlink, lstat, realpath, open } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const usage = 'run <run.json> --preview-url <loopback-workbench-url> --output <new-directory> [--browser chromium|msedge|chrome]';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const fail = message => { throw new Error(message); };
function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected a request object');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`Missing request field: ${key}`);
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) fail(`Unsupported request field: ${key}`);
  return value;
}
function string(value, name) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(`Expected nonempty ${name}`);
  return value;
}
/** Restrict the browser transport, including redirects/subresources, to this local origin. */
export function previewUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) fail('Preview URL must be literal HTTP loopback without credentials, query or fragment');
  return url;
}
function portableFile(value) {
  string(value, 'manifest-local resource file');
  if (value.includes('\\') || value.includes(':') || value.startsWith('/')
      || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)))
    fail('Resource file must be a portable relative path below the manifest directory');
  return value;
}
/** Read bounded local bytes; neither links nor traversal may leave the manifest directory. */
export async function readLocalResource(root, filename, limit) {
  portableFile(filename);
  const base = await realpath(root);
  let target = base;
  const parts = filename.split('/');
  for (let index = 0; index < parts.length; index++) {
    target = resolve(target, parts[index]);
    const info = await lstat(target);
    if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile())) fail('Resource path must contain only local directories and a regular file, without links');
  }
  const canonical = await realpath(target), offset = relative(base, canonical);
  if (!offset || isAbsolute(offset) || offset === '..' || offset.startsWith(`..${sep}`)) fail('Resource resolved outside the manifest directory');
  const handle = await open(canonical, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > limit) fail('Invalid local resource file size/type');
    const chunks = []; let total = 0;
    while (total <= limit) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (!bytesRead) break;
      total += bytesRead; if (total > limit) fail('Resource byte limit exceeded');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (total === 0) fail('Resource file is empty');
    return new Uint8Array(Buffer.concat(chunks, total));
  } finally { await handle.close(); }
}
export function validateRunManifest(value, compiled) {
  record(value, ['runVersion', 'workflow', 'resources', 'provenance', 'checks']);
  if (value.runVersion !== '0.1') fail('Unsupported runVersion');
  if (!Array.isArray(value.resources) || value.resources.length > 256) fail('Expected at most 256 local resources');
  for (const resource of value.resources) {
    record(resource, ['path', 'file', 'mime']);
    portableFile(resource.path); portableFile(resource.file); string(resource.mime, 'resource MIME');
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(resource.mime)) fail('Invalid resource MIME');
  }
  record(value.provenance, ['kind', 'description']);
  if (!['programmatic-fixture', 'user-provided', 'vision-reviewed'].includes(value.provenance.kind)
      || typeof value.provenance.description !== 'string' || !value.provenance.description.trim()
      || value.provenance.description.trim() !== value.provenance.description || value.provenance.description.length > 1000) fail('Invalid explicit provenance');
  if (!Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 128) fail('Specify 1 to 128 explicit browser checks');
  const nodes = new Map();
  const visit = node => { nodes.set(node.id, node); for (const child of node.children ?? []) visit(child); };
  visit(compiled.document.root);
  for (const check of value.checks) {
    if (check?.kind === 'motion') {
      record(check, ['kind', 'targetId', 'action', 'verifyPixels']);
      if (typeof check.verifyPixels !== 'boolean') fail('verifyPixels must be explicit boolean');
      const binding = compiled.motionSystem?.bindings.find(item => item.targetId === check.targetId);
      if (!binding?.actions.includes(check.action)) fail('Motion check requires a bound target/action');
    } else if (check?.kind === 'timeline') {
      record(check, ['kind', 'time', 'verifyPixels']);
      if (typeof check.verifyPixels !== 'boolean' || !Number.isFinite(check.time) || check.time < 0
          || !compiled.motion || check.time > compiled.motion.duration) fail('Timeline check requires an existing timeline and a valid time');
    } else if (check?.kind === 'click') {
      record(check, ['kind', 'targetId'], ['xRatio', 'yRatio', 'expectValue', 'expectActivations']);
      if (!nodes.has(check.targetId)) fail('Click check target does not exist');
      if (!Object.hasOwn(check, 'expectValue') && !Object.hasOwn(check, 'expectActivations')) fail('Click check requires an explicit outcome');
      if (Object.hasOwn(check, 'expectActivations') && (!Number.isSafeInteger(check.expectActivations) || check.expectActivations < 0)) fail('expectActivations must be a nonnegative integer');
      for (const name of ['xRatio', 'yRatio']) if (Object.hasOwn(check, name) && (!Number.isFinite(check[name]) || check[name] < 0 || check[name] > 1)) fail(`${name} must be between 0 and 1`);
    } else fail('Unsupported browser check kind');
  }
  return value;
}
async function library() {
  let source = true;
  try { await access(fileURLToPath(new URL('../src/index.ts', import.meta.url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; source = false; }
  return import(new URL(source ? '../src/index.ts' : '../lib/index.js', import.meta.url).href);
}
function redact(error, privatePaths) {
  let result = error instanceof Error ? error.message : String(error);
  for (const path of privatePaths.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(path, '<local>').replaceAll(path.replaceAll('\\', '/'), '<local>');
  }
  return result.replace(/https?:\/\/[^\s"'<>]+/g, '<url>').replace(/[A-Za-z]:[\\/][^\n"'<>]+/g, '<local-path>');
}
export async function runWorkflowCommand(args) {
  if (!args[0] || args[0].startsWith('--')) fail(usage);
  const options = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--preview-url', '--output', '--browser'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(options, key)) fail(usage);
    options[key] = value;
  }
  if (!options['--preview-url'] || !options['--output']) fail(usage);
  const url = previewUrl(options['--preview-url']);
  const browserChannel = options['--browser'] ?? (process.platform === 'win32' ? 'msedge' : 'chromium');
  if (!['chromium', 'msedge', 'chrome'].includes(browserChannel)) fail('Unsupported browser channel');
  const filename = resolve(args[0]), directory = resolve(options['--output']);
  await mkdir(dirname(directory), { recursive: true });
  // No reuse, including an empty directory: a previous success can never survive a failed rerun.
  await mkdir(directory);
  const report = { runVersion: '0.1', status: 'RUNNING', stages: [], checks: [],
    acceptanceScope: 'Declared browser checks, resource decoding, exact bundle restoration and teardown',
    humanVisualReview: 'NOT_RUN', providerCalls: 0, artifacts: {} };
  const privatePaths = [filename, dirname(filename), directory, process.env.USERPROFILE, options['--preview-url']];
  let stage = 'read-request', published = false;
  const pass = name => report.stages.push({ name, status: 'PASS' });
  try {
    const requestBytes = await readFile(filename);
    report.requestSha256 = sha(requestBytes);
    const request = JSON.parse(requestBytes.toString('utf8'));
    const api = await library();
    stage = 'component-and-motion-contracts';
    const compiled = api.compileWorkflow(request.workflow);
    validateRunManifest(request, compiled);
    report.id = compiled.id;
    pass(stage);
    stage = 'resource-and-bundle-validation';
    const resources = [];
    let totalBytes = 0;
    for (const resource of request.resources) {
      const path = resolve(dirname(filename), resource.file);
      privatePaths.push(path);
      const bytes = await readLocalResource(dirname(filename), resource.file, Math.min(api.MAX_BUNDLE_RESOURCE_BYTES, api.MAX_BUNDLE_TOTAL_BYTES - totalBytes));
      totalBytes += bytes.length;
      resources.push({ path: resource.path, mime: resource.mime, bytes });
    }
    const bundle = await api.createBundle(compiled.document, resources, request.provenance, compiled.motion, compiled.motionSystem);
    await api.validateBundle(bundle);
    pass(stage);
    stage = 'pixijs-browser-acceptance';
    const { acceptInBrowser } = await import('./workflow-browser.mjs');
    const evidence = await acceptInBrowser({ url: url.href, browserChannel, bundle, checks: request.checks, directory,
      onCheck: result => report.checks.push(result), onStage: result => report.stages.push(result) });
    report.browser = evidence.browser;
    // Browser returns only after initial and fresh-page round trips and teardown pass.
    await api.validateBundle(evidence.restored);
    pass(stage);
    stage = 'publish';
    const payload = json(bundle);
    report.artifacts['component.bundle.json'] = { sha256: sha(payload), bytes: Buffer.byteLength(payload) };
    report.screenshots = evidence.screenshots;
    for (const name of evidence.screenshots) {
      const bytes = await readFile(resolve(directory, name));
      report.artifacts[name] = { sha256: sha(bytes), bytes: bytes.length };
    }
    await writeFile(resolve(directory, 'component.bundle.json'), payload, { flag: 'wx' });
    published = true;
    pass(stage); report.status = 'PASS';
    await writeFile(resolve(directory, 'run-report.json'), json(report), { flag: 'wx' });
    process.stdout.write(json({ status: report.status, id: report.id, checks: report.checks.length,
      bundle: 'component.bundle.json', report: 'run-report.json', humanVisualReview: 'NOT_RUN' }));
  } catch (error) {
    if (published) {
      try { await unlink(resolve(directory, 'component.bundle.json')); }
      catch (rollbackError) { report.rollback = { status: 'FAIL', error: redact(rollbackError, privatePaths) }; }
    }
    report.status = 'FAIL';
    report.stages.push({ name: stage, status: 'FAIL' });
    report.error = redact(error, privatePaths);
    delete report.artifacts['component.bundle.json'];
    await writeFile(resolve(directory, 'run-report.json'), json(report));
    throw new Error(`Workflow failed at ${stage}: ${report.error}`);
  }
}
