import { mkdirSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compileMap } from './compile.mjs';
import { contextFor, loadSceneKit } from './kit.mjs';
import { canonicalJson, canonicalMap } from './document.mjs';
import { demand, InvalidKit, reject } from './errors.mjs';
import { makeFreshDirectory, parseJson, portableReader, readSelectedFile, writeFreshFile } from './files.mjs';
import { sha256 } from './validate.mjs';
import { validateDocument } from './schema.mjs';
import { storeArchive } from './archive.mjs';

const jsonBytes = value => Buffer.from(`${canonicalJson(value, true)}\n`);
function normalized(handle, map) {
  contextFor(handle).model.analyzeMap(map);
  const document = canonicalMap(map);
  demand(jsonBytes(document).length <= 2097152, 'RESOURCE_LIMIT', 'scene.document.json', '/', 'Serialized author document exceeds 2 MiB');
  return document;
}

export function saveMap(handle, map, path) {
  const document = normalized(handle, map), bytes = jsonBytes(document);
  writeFreshFile(path, bytes, contextFor(handle).sourceRoot);
  return { status: 'map-saved', sha256: sha256(bytes), byteLength: bytes.length, generationCalls: 0 };
}

export function loadMap(handle, path) {
  return normalized(handle, parseJson(readSelectedFile(path)));
}

export function saveCompiledMap(handle, map, path) {
  const compiled = compileMap(handle, map), bytes = jsonBytes(compiled);
  demand(bytes.length <= 67108864, 'RESOURCE_LIMIT', 'scene.compiled.json', '/', 'Compiled scene exceeds 64 MiB');
  writeFreshFile(path, bytes, contextFor(handle).sourceRoot);
  return { status: 'scene-compiled', sha256: sha256(bytes), contentSha256: compiled.contentSha256, counts: compiled.counts, generationCalls: 0 };
}

function exportFiles(handle, map) {
  const context = contextFor(handle);
  const document = normalized(handle, map), compiled = compileMap(handle, document);
  const files = new Map([...context.files].map(([name, bytes]) => [`kit/${name}`, bytes]));
  files.set('scene.document.json', jsonBytes(document));
  files.set('scene.compiled.json', jsonBytes(compiled));
  demand(files.get('scene.compiled.json').length <= 67108864, 'RESOURCE_LIMIT', 'scene.compiled.json', '/', 'Compiled scene exceeds 64 MiB');
  const manifest = {
    format: 'ai_scene_export_v1', purpose: 'editable-map-export',
    kitEntry: 'kit/kit.json', document: 'scene.document.json', compiled: 'scene.compiled.json',
    sourceKitSha256: context.bundleSha256, authorSha256: compiled.source.authorSha256,
    compiledSha256: sha256(files.get('scene.compiled.json')),
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, sha256: sha256(bytes), byteLength: bytes.length })),
    visualAcceptance: 'not-assessed', generationCalls: 0,
  };
  return { context, compiled, files, manifest };
}

export function exportSceneArchive(handle, map) {
  const { files, manifest } = exportFiles(handle, map);
  files.set('manifest.json', jsonBytes(manifest)); return storeArchive(files);
}

export function exportScene(handle, map, output) {
  const { context, compiled, files, manifest } = exportFiles(handle, map);
  const root = makeFreshDirectory(output, context.sourceRoot);
  try {
    for (const [name, bytes] of files) {
      const target = join(root, ...name.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx' });
    }
    // Written last: an interrupted directory without this record is not an importable export.
    writeFileSync(join(root, 'manifest.json'), jsonBytes(manifest), { flag: 'wx' });
  } catch { reject('EXPORT_WRITE_FAILED', 'manifest.json', '/', 'Export write failed; partial output is retained and never overwritten automatically'); }
  openSceneExport(root);
  return { status: 'export-integrity-verified', fileCount: files.size + 1, sourceKitSha256: context.bundleSha256,
    authorSha256: compiled.source.authorSha256, contentSha256: compiled.contentSha256,
    visualAcceptance: 'not-assessed', generationCalls: 0 };
}

export function openSceneExport(inputRoot) {
  const reader = portableReader(inputRoot);
  const manifest = parseJson(reader.read('manifest.json', 2097152), 'manifest.json');
  const errors = validateDocument('ai_scene_export_v1', manifest);
  if (errors.length) throw new InvalidKit(errors.map(error => ({ artifact: 'manifest.json', ...error })));
  const inventory = new Set();
  let totalBytes = 0;
  for (const [index, entry] of manifest.files.entries()) {
    demand(!inventory.has(entry.path) && entry.path !== 'manifest.json', 'EXPORT_INVENTORY', 'manifest.json', `/files/${index}/path`, 'Duplicate or self-referential export entry');
    demand(entry.path.startsWith('kit/') || ['scene.document.json', 'scene.compiled.json'].includes(entry.path),
      'EXPORT_INVENTORY', 'manifest.json', `/files/${index}/path`, 'Unexpected export entry');
    inventory.add(entry.path);
    totalBytes += entry.byteLength;
    demand(totalBytes <= 268435456, 'RESOURCE_LIMIT', 'manifest.json', '/files', 'Export exceeds the total byte budget');
    const bytes = reader.read(entry.path);
    demand(bytes.length === entry.byteLength && sha256(bytes) === entry.sha256, 'EXPORT_CHECKSUM', 'manifest.json', `/files/${index}`, 'Export entry byte count or SHA-256 differs');
  }
  for (const name of ['kit/kit.json', manifest.document, manifest.compiled]) {
    demand(inventory.has(name), 'EXPORT_INVENTORY', 'manifest.json', '/files', 'Required export entry is missing');
  }
  let walked = 0;
  function inspect(folder, prefix = '') {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      walked++;
      demand(walked <= 16384, 'RESOURCE_LIMIT', 'manifest.json', '/files', 'Export inventory walk exceeds its limit');
      const path = `${prefix}${entry.name}`;
      demand(!lstatSync(join(folder, entry.name)).isSymbolicLink(), 'PATH_UNSAFE', 'manifest.json', '/files', 'Export may not contain links');
      if (entry.isDirectory()) {
        demand([...inventory].some(name => name.startsWith(`${path}/`)), 'EXPORT_INVENTORY', 'manifest.json', '/files', 'Unlisted directory in export');
        inspect(join(folder, entry.name), `${path}/`);
      } else demand(path === 'manifest.json' || inventory.has(path), 'EXPORT_INVENTORY', 'manifest.json', '/files', 'Unlisted file in export');
    }
  }
  try { inspect(reader.root); }
  catch (error) {
    if (error instanceof InvalidKit) throw error;
    reject('INPUT_UNAVAILABLE', 'manifest.json', '/files', 'Cannot inspect export inventory');
  }
  const handle = loadSceneKit(join(reader.root, 'kit'));
  demand(handle.bundleSha256 === manifest.sourceKitSha256, 'EXPORT_SOURCE', 'manifest.json', '/sourceKitSha256', 'Source kit fingerprint differs');
  const context = contextFor(handle);
  const expectedInventory = new Set([...context.files.keys()].map(name => `kit/${name}`).concat(['scene.document.json', 'scene.compiled.json']));
  demand(expectedInventory.size === inventory.size && [...inventory].every(name => expectedInventory.has(name)),
    'EXPORT_INVENTORY', 'manifest.json', '/files', 'Export inventory is not the exact source/map dependency closure');
  const document = normalized(handle, parseJson(reader.read(manifest.document, 2097152)));
  const compiled = compileMap(handle, document), savedBytes = reader.read(manifest.compiled);
  const savedCompiled = parseJson(savedBytes, 'scene.compiled.json');
  demand(sha256(savedBytes) === manifest.compiledSha256 && compiled.source.authorSha256 === manifest.authorSha256,
    'EXPORT_SOURCE', 'manifest.json', '/', 'Export document/compiled fingerprints differ');
  demand(canonicalJson(compiled) === canonicalJson(savedCompiled), 'COMPILED_REPLAY', manifest.compiled, '/', 'Compiled scene does not reproduce from the author document and source kit');
  return { handle, document, compiled };
}
