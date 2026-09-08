#!/usr/bin/env node
/** Offline file wrapper. Library modules own all contract and bundle validation. */
import { access, lstat, mkdir, open, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];
const argv = process.argv.slice(3);

async function moduleFromDistribution(name) {
  const distributed = new URL(`../lib/${name}.js`, import.meta.url);
  try {
    await access(fileURLToPath(distributed), fsConstants.R_OK);
    return import(distributed.href);
  } catch (error) {
    if (error && typeof error === 'object' && error.code !== 'ENOENT') throw error;
    return import(new URL(`../src/${name}.ts`, import.meta.url).href);
  }
}
const [bundleApi, legacyApi, treeApi, legacyCompiler, treeCompiler] = await Promise.all([
  moduleFromDistribution('bundle'), moduleFromDistribution('contract'), moduleFromDistribution('tree-contract'),
  moduleFromDistribution('intent-compiler'), moduleFromDistribution('tree-compiler'),
]);

const usage = `Usage: ai-ui-component <command> [arguments]

Local commands:
  run <run.json> --preview-url <loopback-workbench-url> --output <new-directory> [--browser chromium|msedge|chrome]
  validate <document-or-bundle.json>
  inspect <document-or-bundle.json>
  compile <intent.json> <policy.json> (--facts <facts.json> | --asset <file> | --asset <source>=<file>) [--output <document.json>]
  pack <document.json> --resource <portable-path>=<file> [--resource ...] --provenance-kind <kind> --provenance-description <text> [--motion <motion.json>] [--motion-system <system.json>] [--output <bundle.json>]
  unpack <bundle.json> <empty-output-directory>
  self-test
  doctor

--facts supplies caller-declared dimensions only. It never claims visual analysis.
--asset reads dimensions from supplied image bytes (PNG, GIF, JPEG, WebP, or BMP);
use source=file form for every v0.2 Image source. No command contacts a provider.
run connects only to an explicitly supplied loopback workbench; other commands are offline.`;

function fail(message) { throw new Error(message); }
function parseOptions(tokens) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) { positionals.push(token); continue; }
    const name = token.slice(2);
    if (!name) fail('empty option name');
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`--${name} requires a value`);
    index += 1;
    const values = options.get(name) ?? [];
    values.push(value); options.set(name, values);
  }
  return { positionals, options };
}
function one(options, name) {
  const values = options.get(name) ?? [];
  if (values.length > 1) fail(`--${name} may be used only once`);
  return values[0];
}
function onlyOptions(options, names) {
  for (const name of options.keys()) if (!names.has(name)) fail(`unsupported option --${name}`);
}
async function jsonFile(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { fail(`cannot read JSON ${filename}: ${error instanceof Error ? error.message : String(error)}`); }
}
async function freshWrite(filename, data) {
  const target = resolve(filename);
  await mkdir(dirname(target), { recursive: true });
  let handle;
  try {
    handle = await open(target, 'wx', 0o600);
    await handle.writeFile(data, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') fail(`refusing to overwrite existing path: ${filename}`);
    throw error;
  } finally { await handle?.close(); }
}
async function emit(value, output) {
  const data = `${JSON.stringify(value, null, 2)}\n`;
  if (output) await freshWrite(output, data);
  else process.stdout.write(data);
}
function positiveUInt32(bytes, offset, littleEndian) {
  if (offset + 4 > bytes.length) return undefined;
  return littleEndian
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)) >>> 0
    : ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}
function dimensions(width, height, filename) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) fail(`image dimensions are invalid: ${filename}`);
  return { width, height };
}
/** Read declared raster dimensions from a supplied local file; this is not vision analysis. */
function imageFacts(bytes, filename) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
    && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR') {
    return dimensions(positiveUInt32(bytes, 16, false), positiveUInt32(bytes, 20, false), filename);
  }
  if (bytes.length >= 10 && (String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a')) {
    return dimensions(bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8), filename);
  }
  if (bytes.length >= 26 && String.fromCharCode(...bytes.subarray(0, 2)) === 'BM') {
    const width = positiveUInt32(bytes, 18, true); const signedHeight = positiveUInt32(bytes, 22, true);
    return dimensions(width, signedHeight > 0x7fffffff ? 0x100000000 - signedHeight : signedHeight, filename);
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === 'VP8X') return dimensions(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16), filename);
    if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return dimensions((bytes[26] | (bytes[27] << 8)) & 0x3fff, (bytes[28] | (bytes[29] << 8)) & 0x3fff, filename);
    if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return dimensions(1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff), filename);
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let index = 2; index + 9 < bytes.length;) {
      if (bytes[index] !== 0xff) { index += 1; continue; }
      while (bytes[index] === 0xff) index += 1;
      const marker = bytes[index++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (index + 1 >= bytes.length) break;
      const size = (bytes[index] << 8) | bytes[index + 1];
      if (size < 2 || index + size > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return dimensions((bytes[index + 5] << 8) | bytes[index + 6], (bytes[index + 3] << 8) | bytes[index + 4], filename);
      }
      index += size;
    }
  }
  fail(`unsupported image format for ${filename}; supply explicit --facts instead`);
}
async function assetFacts(assetValues, intent) {
  const facts = {};
  for (const value of assetValues) {
    const equals = value.indexOf('=');
    let source; let filename;
    if (equals === -1) { filename = value; }
    else { source = value.slice(0, equals); filename = value.slice(equals + 1); }
    if (!filename) fail('--asset requires a file after =');
    const bytes = new Uint8Array(await readFile(filename));
    const current = imageFacts(bytes, filename);
    if (source) facts[source] = current;
    else {
      if (intent?.intentVersion !== '0.1' || typeof intent.visual?.source !== 'string') fail('v0.2 --asset must use <source>=<file>');
      if (Object.keys(facts).length) fail('legacy compile accepts one unqualified --asset');
      facts[intent.visual.source] = current;
    }
  }
  return intent?.intentVersion === '0.1' ? facts[intent.visual.source] : facts;
}
function resourceFlag(value) {
  const equals = value.indexOf('=');
  if (equals <= 0 || equals === value.length - 1) fail('--resource requires <portable-path>=<file>');
  return { path: value.slice(0, equals), filename: value.slice(equals + 1) };
}
async function checkedRoot(outputDirectory) {
  const root = resolve(outputDirectory);
  await mkdir(root, { recursive: true });
  const status = await lstat(root);
  if (!status.isDirectory() || status.isSymbolicLink()) fail('unpack output must be a real directory');
  return root;
}
function contained(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}
async function safeExtractPath(root, portablePath) {
  const parts = portablePath.split('/');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = resolve(current, part);
    if (!contained(root, current)) fail('bundle path escapes extraction root');
    await mkdir(current, { recursive: false }).catch(error => { if (error?.code !== 'EEXIST') throw error; });
    const status = await lstat(current);
    if (!status.isDirectory() || status.isSymbolicLink()) fail(`refusing symlink or non-directory in extraction path: ${portablePath}`);
  }
  const target = resolve(current, parts.at(-1));
  if (!contained(root, target)) fail('bundle path escapes extraction root');
  try { await lstat(target); fail(`refusing to overwrite existing path: ${portablePath}`); }
  catch (error) { if (error instanceof Error && error.message.startsWith('refusing to overwrite')) throw error; if (error?.code !== 'ENOENT') throw error; }
  return target;
}
async function extractNew(root, portablePath, bytes) {
  const target = await safeExtractPath(root, portablePath);
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}
function classify(input) {
  if (input && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'bundleVersion')) return 'bundle';
  return 'document';
}
function redactedReference(source) {
  if (!/^https?:\/\//i.test(source)) return source;
  try {
    const url = new URL(source);
    return `${url.protocol}//${url.host}${url.pathname}${url.search ? '?…' : ''}${url.hash ? '#…' : ''}`;
  } catch { return '[invalid HTTP(S) reference]'; }
}
function documentSummary(document) {
  if (document.schemaVersion === '0.1') return { schemaVersion: '0.1', id: document.id, nodes: 2, sources: [redactedReference(document.slots.visual.props.source)] };
  const nodes = treeApi.walkNodes(document);
  const sources = [];
  for (const node of nodes) for (const key of ['source', 'fontSource']) if (typeof node.props[key] === 'string') sources.push(node.props[key]);
  return { schemaVersion: '0.2', id: document.id, nodes: nodes.length, sources: sources.map(redactedReference) };
}

async function run() {
  if (command === 'run') {
    const { runWorkflowCommand } = await import('./workflow-run.mjs');
    await runWorkflowCommand(argv); return;
  }
  if (!command || command === '--help' || command === '-h' || command === 'help') { process.stdout.write(`${usage}\n`); return; }
  const { positionals, options } = parseOptions(argv);
  if (command === 'validate') {
    onlyOptions(options, new Set()); if (positionals.length !== 1) fail('validate requires one JSON file');
    const input = await jsonFile(positionals[0]);
    if (classify(input) === 'bundle') { const bundle = await bundleApi.validateBundle(input); await emit({ valid: true, kind: 'bundle', ...documentSummary(bundle.document), resources: bundle.resources.length, motion: Boolean(bundle.motion), motionSystem: Boolean(bundle.motionSystem) }); }
    else { const document = input?.schemaVersion === '0.1' ? legacyApi.validateButton(input) : treeApi.validateDocument(input); await emit({ valid: true, kind: 'document', ...documentSummary(document) }); }
    return;
  }
  if (command === 'inspect') {
    onlyOptions(options, new Set()); if (positionals.length !== 1) fail('inspect requires one JSON file');
    const input = await jsonFile(positionals[0]);
    if (classify(input) === 'bundle') { const bundle = await bundleApi.validateBundle(input); await emit({ kind: 'bundle', ...documentSummary(bundle.document), resources: bundle.resources.map(resource => ({ id: resource.id, path: resource.path, mime: resource.mime, sha256: resource.sha256 })), provenance: bundle.provenance, motion: bundle.motion ? { id: bundle.motion.id, duration: bundle.motion.duration } : undefined, motionSystem: bundle.motionSystem ? { id: bundle.motionSystem.id, style: bundle.motionSystem.style, bindings: bundle.motionSystem.bindings.length } : undefined }); }
    else { const document = input?.schemaVersion === '0.1' ? legacyApi.validateButton(input) : treeApi.validateDocument(input); await emit({ kind: 'document', ...documentSummary(document) }); }
    return;
  }
  if (command === 'compile') {
    onlyOptions(options, new Set(['facts', 'asset', 'output'])); if (positionals.length !== 2) fail('compile requires <intent.json> <policy.json>');
    const factsFile = one(options, 'facts'); const assets = options.get('asset') ?? [];
    if (Boolean(factsFile) === Boolean(assets.length)) fail('compile requires exactly one of --facts or --asset');
    const intent = await jsonFile(positionals[0]); const policy = await jsonFile(positionals[1]);
    const facts = factsFile ? await jsonFile(factsFile) : await assetFacts(assets, intent);
    const document = intent?.intentVersion === '0.1' ? legacyCompiler.compileButton(intent, facts, policy) : treeCompiler.compileTree(intent, facts, policy);
    await emit(document, one(options, 'output')); return;
  }
  if (command === 'pack') {
    onlyOptions(options, new Set(['resource', 'provenance-kind', 'provenance-description', 'motion', 'motion-system', 'output']));
    if (positionals.length !== 1) fail('pack requires <document.json>');
    const kind = one(options, 'provenance-kind'); const description = one(options, 'provenance-description');
    if (!kind || !description) fail('pack requires explicit --provenance-kind and --provenance-description');
    const resources = await Promise.all((options.get('resource') ?? []).map(async value => {
      const { path, filename } = resourceFlag(value);
      return { path, mime: mimeFor(filename), bytes: new Uint8Array(await readFile(filename)) };
    }));
    const motion = one(options, 'motion');
    const motionSystem = one(options, 'motion-system');
    const bundle = await bundleApi.createBundle(await jsonFile(positionals[0]), resources, { kind, description }, motion ? await jsonFile(motion) : undefined, motionSystem ? await jsonFile(motionSystem) : undefined);
    await emit(bundle, one(options, 'output')); return;
  }
  if (command === 'unpack') {
    onlyOptions(options, new Set()); if (positionals.length !== 2) fail('unpack requires <bundle.json> <empty-output-directory>');
    const bundle = await bundleApi.validateBundle(await jsonFile(positionals[0])); const root = await checkedRoot(positionals[1]);
    const resources = bundleApi.bundleResources(bundle);
    const reserved = new Set(['ui-document.json', 'ui-motion.json', 'ui-motion-system.json']);
    if (resources.some(resource => reserved.has(resource.path.toLowerCase()))) fail('bundle resource path conflicts with unpack metadata');
    for (const resource of resources) await extractNew(root, resource.path, resource.bytes);
    await extractNew(root, 'ui-document.json', new TextEncoder().encode(`${JSON.stringify(bundle.document, null, 2)}\n`));
    if (bundle.motion) await extractNew(root, 'ui-motion.json', new TextEncoder().encode(`${JSON.stringify(bundle.motion, null, 2)}\n`));
    if (bundle.motionSystem) await extractNew(root, 'ui-motion-system.json', new TextEncoder().encode(`${JSON.stringify(bundle.motionSystem, null, 2)}\n`));
    await emit({ unpacked: true, resources: resources.length, motion: Boolean(bundle.motion), motionSystem: Boolean(bundle.motionSystem) }); return;
  }
  if (command === 'self-test') {
    onlyOptions(options, new Set()); if (positionals.length) fail('self-test takes no arguments');
    const document = { schemaVersion: '0.1', id: 'self-test', type: 'Button', layout: { x: 0, y: 0, width: 1, height: 1 }, props: { enabled: true }, slots: { visual: { id: 'self-test-image', type: 'Image', props: { source: 'assets/self-test.bin' } } } };
    const bundle = await bundleApi.createBundle(document, [{ path: 'assets/self-test.bin', mime: 'application/octet-stream', bytes: new Uint8Array([1, 2, 3]) }], { kind: 'programmatic-fixture', description: 'Offline CLI self-test fixture.' });
    const checked = await bundleApi.validateBundle(JSON.parse(JSON.stringify(bundle)));
    if (bundleApi.bundleResources(checked)[0].bytes.length !== 3) fail('self-test resource round trip failed');
    await emit({ ok: true, offline: true }); return;
  }
  if (command === 'doctor') {
    onlyOptions(options, new Set()); if (positionals.length) fail('doctor takes no arguments');
    await emit({ offline: true, node: process.version, commands: ['run', 'validate', 'inspect', 'compile', 'pack', 'unpack', 'self-test', 'doctor'], providerConfigured: false }); return;
  }
  fail(`unsupported command: ${command}`);
}
function mimeFor(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png'; if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif'; if (lower.endsWith('.webp')) return 'image/webp'; if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.woff2')) return 'font/woff2'; if (lower.endsWith('.woff')) return 'font/woff';
  return 'application/octet-stream';
}

run().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
