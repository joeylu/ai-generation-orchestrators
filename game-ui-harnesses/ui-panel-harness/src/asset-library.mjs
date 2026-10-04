import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { canonicalJson, digestBytes, digestJson } from './canonical.mjs';
import { createOutputDirectory, jsonFileBytes } from './io.mjs';
import { validateAssetBatch, assetKey } from './asset-descriptor.mjs';
import { validateAssetSvg } from './asset-svg.mjs';

const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const ID = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;
const ROLES = ['icon', 'shape', 'effect', 'layout-primitive', 'animation-part'];
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const CHECKS = Object.freeze({ files: 'HASHED', images: 'DECODED_NONEMPTY_ALPHA_CLEAN',
  semanticReview: 'NOT_RUN', visualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' });

async function boundedFile(path, limit = 16 * 1024 * 1024) {
  for (let item = resolve(path); ; item = dirname(item)) {
    if ((await lstat(item)).isSymbolicLink()) throw new Error('ASSET_LINK_FORBIDDEN');
    if (dirname(item) === item) break;
  }
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error('ASSET_FILE_LIMIT');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('ASSET_FILE_LIMIT');
  return bytes;
}
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
function artifactPath(path) {
  if (typeof path !== 'string' || !/^(?:asset-library\.json|sources\/[a-f0-9]{64}\.(?:png|svg)|textures\/[a-f0-9]{64}\.png|previews\/[a-f0-9]{64}\.png)$(?![\s\S])/.test(path)) throw new Error('ASSET_ARTIFACT_PATH');
}
function exact(value, keys, code) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || !same(Object.keys(value).sort(), [...keys].sort())) throw new Error(code);
}
function imageGate(image, size) {
  const a = image?.alpha, pixels = size.width * size.height;
  if (image?.width !== size.width || image.height !== size.height || image.channels !== 4 || !a
    || !['opaque', 'mixed'].includes(a.mode) || a.hiddenRgbPixels !== 0) throw new Error('ASSET_IMAGE_GATE');
  if (![a.transparentPixels, a.opaquePixels, a.softPixels].every(n => Number.isSafeInteger(n) && n >= 0 && n <= pixels)
    || a.transparentPixels + a.opaquePixels + a.softPixels !== pixels
    || a.transparentPixels === pixels
    || a.mode !== (a.opaquePixels === pixels ? 'opaque' : 'mixed')) throw new Error('ASSET_IMAGE_GATE');
  const b = a.visibleBounds;
  exact(b, ['x', 'y', 'width', 'height'], 'ASSET_IMAGE_GATE');
  if (!Object.values(b).every(Number.isSafeInteger) || b.x < 0 || b.y < 0 || b.width < 1 || b.height < 1
    || b.x + b.width > size.width || b.y + b.height > size.height) throw new Error('ASSET_IMAGE_GATE');
}
function metadataFromEntry(entry) { const { file, ...metadata } = entry; return metadata; }
function validateMetadata(namespace, metadata, format) {
  const normalized = validateAssetBatch({ assetBatchVersion: '0.1', namespace, assets: [{ ...metadata, file: `asset.${format}` }] }).assets[0];
  if (!same(metadataFromEntry(normalized), metadata)) throw new Error('ASSET_METADATA_CONTRACT');
}
function summary(records) {
  return { versions: records.length, assets: new Set(records.map(r => `${r.namespace}/${r.metadata.id}`)).size,
    pngFiles: new Set(records.map(r => r.file.path)).size, sourceFiles: new Set(records.map(r => r.source.file.path)).size,
    roles: Object.fromEntries(ROLES.map(role => [role, records.filter(r => r.metadata.role === role).length])) };
}
async function ref(path, bytes) { return { path, sha256: await digestBytes(bytes), bytes: bytes.length }; }
async function raster(source, format, size, adapter) {
  if (format === 'svg') {
    const text = utf8(source); validateAssetSvg(text, size);
    return adapter.render(text, size.width, size.height);
  }
  const image = await adapter.analyze(source);
  if (image.width !== size.width || image.height !== size.height || image.alpha.mode === 'empty') throw new Error('ASSET_SOURCE_DIMENSIONS');
  return adapter.normalizePng(source);
}
async function recordPreview(record, bytes, adapter) {
  return adapter.gallery([{ bytes, label: '' }], { columns: 1, cellHeight: 148, labels: false });
}
async function makeRecord(namespace, metadata, sourceBytes, format, png, files, adapter) {
  validateMetadata(namespace, metadata, format);
  const image = await adapter.analyze(png); imageGate(image, metadata.size);
  const sourceHash = await digestBytes(sourceBytes), pngHash = await digestBytes(png);
  const source = { format, file: await ref(`sources/${sourceHash}.${format}`, sourceBytes) };
  const file = await ref(`textures/${pngHash}.png`, png);
  const payload = { key: assetKey(namespace, metadata.id, metadata.version), namespace, metadata, source, file, image };
  const revision = await digestJson(payload);
  const previewBytes = await recordPreview(payload, png, adapter);
  const preview = await ref(`previews/${revision}.png`, previewBytes);
  files.set(source.file.path, sourceBytes); files.set(file.path, png); files.set(preview.path, previewBytes);
  return { ...payload, revision, preview };
}
async function publish(output, index, files) {
  files.set('asset-library.json', jsonFileBytes(index));
  const manifestFiles = [];
  for (const [path, bytes] of [...files].sort(([a], [b]) => compare(a, b))) {
    if (bytes.length > 16 * 1024 * 1024) throw new Error('ASSET_FILE_LIMIT');
    artifactPath(path); manifestFiles.push(await ref(path, bytes));
  }
  const directory = await createOutputDirectory(output);
  for (const file of manifestFiles) {
    const path = resolve(directory, ...file.path.split('/')); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, files.get(file.path), { flag: 'wx' });
  }
  const manifest = { assetDeliveryVersion: '0.1', status: 'COMPLETE', id: index.id, sha256: index.sha256,
    files: manifestFiles, verification: CHECKS };
  await writeFile(resolve(directory, 'delivery.json'), jsonFileBytes(manifest), { flag: 'wx' });
}

/** Read-only verification. Replay source processing to check source/PNG and preview correspondence. */
export async function verifyAssetLibrary(directoryInput, adapter) {
  const directory = resolve(directoryInput), manifest = JSON.parse(await boundedFile(resolve(directory, 'delivery.json'), 4 * 1024 * 1024));
  exact(manifest, ['assetDeliveryVersion', 'status', 'id', 'sha256', 'files', 'verification'], 'ASSET_DELIVERY_CONTRACT');
  if (manifest.assetDeliveryVersion !== '0.1' || manifest.status !== 'COMPLETE' || !ID.test(manifest.id) || !SHA.test(manifest.sha256)
    || !same(manifest.verification, CHECKS) || !Array.isArray(manifest.files) || manifest.files.length > 12289) throw new Error('ASSET_DELIVERY_CONTRACT');
  const blobs = new Map(); let total = 0;
  for (const file of manifest.files) {
    exact(file, ['path', 'sha256', 'bytes'], 'ASSET_FILE_CONTRACT'); artifactPath(file.path);
    if (!SHA.test(file.sha256) || blobs.has(file.path)) throw new Error('ASSET_FILE_CONTRACT');
    const bytes = await boundedFile(resolve(directory, ...file.path.split('/')));
    total += bytes.length; if (total > 512 * 1024 * 1024) throw new Error('ASSET_TOTAL_LIMIT');
    if (file.bytes !== bytes.length || file.sha256 !== await digestBytes(bytes)) throw new Error('ASSET_FILE_MISMATCH');
    blobs.set(file.path, bytes);
  }
  if (!blobs.has('asset-library.json')) throw new Error('ASSET_INDEX_MISSING');
  const index = JSON.parse(blobs.get('asset-library.json'));
  exact(index, ['assetLibraryVersion', 'id', 'parent', 'renderer', 'records', 'summary', 'changes', 'verification', 'sha256'], 'ASSET_INDEX_CONTRACT');
  const { sha256, ...payload } = index;
  if (index.assetLibraryVersion !== '0.1' || index.id !== manifest.id || sha256 !== manifest.sha256 || await digestJson(payload) !== sha256
    || !same(index.verification, CHECKS) || !Array.isArray(index.records) || !index.records.length || index.records.length > 4096) throw new Error('ASSET_INDEX_CONTRACT');
  if (!same(index.renderer, adapter.evidence)) throw new Error('ASSET_RENDERER_MISMATCH');
  if (index.parent !== null) {
    exact(index.parent, ['kind', 'id', 'sha256'], 'ASSET_PARENT');
    if (!['curated', 'asset-library'].includes(index.parent.kind) || !ID.test(index.parent.id) || !SHA.test(index.parent.sha256)) throw new Error('ASSET_PARENT');
  }
  const expectedPaths = new Set(['asset-library.json']), seen = new Set(), sourceCache = new Map(), decoded = new Map();
  let last = '';
  for (const record of index.records) {
    exact(record, ['key', 'namespace', 'metadata', 'source', 'file', 'image', 'revision', 'preview'], 'ASSET_RECORD_CONTRACT');
    exact(record.source, ['format', 'file'], 'ASSET_SOURCE_CONTRACT');
    if (!['png', 'svg'].includes(record.source.format)) throw new Error('ASSET_SOURCE_FORMAT');
    validateMetadata(record.namespace, record.metadata, record.source.format);
    if (record.key !== assetKey(record.namespace, record.metadata.id, record.metadata.version) || seen.has(record.key) || record.key <= last) throw new Error('ASSET_RECORD_KEY');
    seen.add(record.key); last = record.key;
    for (const [file, expected] of [[record.file, `textures/${record.file.sha256}.png`],
      [record.source.file, `sources/${record.source.file.sha256}.${record.source.format}`], [record.preview, `previews/${record.revision}.png`]]) {
      exact(file, ['path', 'sha256', 'bytes'], 'ASSET_FILE_CONTRACT'); artifactPath(file.path);
      const bytes = blobs.get(file.path);
      if (file.path !== expected || !SHA.test(file.sha256) || !bytes || bytes.length !== file.bytes || await digestBytes(bytes) !== file.sha256) throw new Error('ASSET_RECORD_FILE');
      expectedPaths.add(file.path);
    }
    const { revision, preview, ...data } = record;
    if (!SHA.test(revision) || await digestJson(data) !== revision) throw new Error('ASSET_REVISION_MISMATCH');
    const cacheKey = `${record.source.format}:${record.source.file.sha256}:${record.metadata.size.width}:${record.metadata.size.height}`;
    if (!sourceCache.has(cacheKey)) sourceCache.set(cacheKey, await raster(blobs.get(record.source.file.path), record.source.format, record.metadata.size, adapter));
    if (await digestBytes(sourceCache.get(cacheKey)) !== record.file.sha256) throw new Error('ASSET_RASTER_MISMATCH');
    if (!decoded.has(record.file.sha256)) decoded.set(record.file.sha256, await adapter.analyze(blobs.get(record.file.path)));
    const image = decoded.get(record.file.sha256); imageGate(image, record.metadata.size);
    if (!same(record.image, image)) throw new Error('ASSET_IMAGE_MISMATCH');
    if (await digestBytes(await recordPreview(record, blobs.get(record.file.path), adapter)) !== preview.sha256) throw new Error('ASSET_PREVIEW_MISMATCH');
  }
  if (blobs.size !== expectedPaths.size || [...blobs.keys()].some(path => !expectedPaths.has(path))) throw new Error('ASSET_EXTRA_FILE');
  if (!same(index.summary, summary(index.records))) throw new Error('ASSET_SUMMARY_MISMATCH');
  exact(index.changes, ['added', 'reused', 'retained'], 'ASSET_CHANGES');
  const union = [];
  for (const items of Object.values(index.changes)) {
    if (!Array.isArray(items) || !same(items, [...new Set(items)].sort(compare)) || items.some(key => !seen.has(key))) throw new Error('ASSET_CHANGES');
    union.push(...items);
  }
  if (union.length !== seen.size || new Set(union).size !== union.length || (index.parent === null && (index.changes.retained.length || index.changes.reused.length))) throw new Error('ASSET_CHANGES');
  return { index, manifest, blobs };
}

async function loadBase(directory, adapter) {
  const manifest = JSON.parse(await boundedFile(resolve(directory, 'delivery.json'), 4 * 1024 * 1024));
  if (manifest.assetDeliveryVersion) {
    const checked = await verifyAssetLibrary(directory, adapter);
    const files = new Map(checked.blobs); files.delete('asset-library.json');
    return { records: structuredClone(checked.index.records), files,
      parent: { kind: 'asset-library', id: checked.index.id, sha256: checked.index.sha256 } };
  }
  if (manifest.kind !== 'curated') throw new Error('ASSET_BASE_UNSUPPORTED');
  const { verifyTexturePackage } = await import('./texture-library.mjs');
  const checked = await verifyTexturePackage(directory, adapter), records = [], files = new Map();
  for (const item of checked.index.records) {
    const sourceBytes = checked.blobs.get(item.vector.path), size = { width: item.image.width, height: item.image.height };
    validateAssetSvg(utf8(sourceBytes), size);
    const entry = { id: item.id, version: checked.index.style.version, file: 'asset.svg',
      name: item.source.relativePath.split('/').at(-1).replace(/\.png$/i, ''), role: item.usage.role,
      family: item.classification.family, style: checked.index.style.id, variant: item.classification.variant.style,
      tags: item.classification.tags, size, slice: item.unity.nineSlice === 'valid' ? item.unity.border : null };
    const batch = validateAssetBatch({ assetBatchVersion: '0.1', namespace: 'modern-mint', assets: [entry] });
    records.push(await makeRecord(batch.namespace, metadataFromEntry(batch.assets[0]), sourceBytes, 'svg', checked.blobs.get(item.file.path), files, adapter));
  }
  return { records, files, parent: { kind: 'curated', id: checked.index.id, sha256: checked.index.sha256 } };
}

/** Add immutable resource versions. Absence from the incoming batch never deletes existing versions. */
export async function importAssetBatch(batchFile, output, adapter, { base, id = 'custom-ui' } = {}) {
  if (!ID.test(id)) throw new Error('ASSET_LIBRARY_ID');
  const batch = validateAssetBatch(JSON.parse(utf8(await boundedFile(batchFile, 1024 * 1024)).replace(/^\uFEFF/, '')));
  const batchRoot = dirname(resolve(batchFile)), inputs = []; let total = 0;
  // Read and validate every external source before processing the base or publishing a directory.
  for (const entry of batch.assets) {
    const path = resolve(batchRoot, ...entry.file.split('/')), rel = relative(batchRoot, path);
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('ASSET_SOURCE_PATH');
    const format = entry.file.toLowerCase().endsWith('.svg') ? 'svg' : 'png';
    const bytes = await boundedFile(path, format === 'svg' ? 1024 * 1024 : 16 * 1024 * 1024);
    total += bytes.length; if (total > 128 * 1024 * 1024) throw new Error('ASSET_TOTAL_LIMIT');
    if (format === 'svg') validateAssetSvg(utf8(bytes), entry.size);
    else {
      const image = await adapter.analyze(bytes);
      if (image.width !== entry.size.width || image.height !== entry.size.height || image.alpha.mode === 'empty') throw new Error('ASSET_SOURCE_DIMENSIONS');
    }
    inputs.push({ metadata: metadataFromEntry(entry), bytes, format, hash: await digestBytes(bytes) });
  }
  const loaded = base ? await loadBase(base, adapter) : { records: [], files: new Map(), parent: null };
  const records = new Map(loaded.records.map(record => [record.key, record])), files = loaded.files;
  const added = [], reused = [], cachedRasters = new Map();
  for (const input of inputs) {
    const key = assetKey(batch.namespace, input.metadata.id, input.metadata.version), old = records.get(key);
    if (old) {
      if (!same(old.metadata, input.metadata) || old.source.format !== input.format || old.source.file.sha256 !== input.hash) throw new Error('ASSET_VERSION_CONFLICT');
      reused.push(key); continue;
    }
    const cacheKey = `${input.format}:${input.hash}:${input.metadata.size.width}:${input.metadata.size.height}`;
    if (!cachedRasters.has(cacheKey)) cachedRasters.set(cacheKey, await raster(input.bytes, input.format, input.metadata.size, adapter));
    const record = await makeRecord(batch.namespace, input.metadata, input.bytes, input.format, cachedRasters.get(cacheKey), files, adapter);
    records.set(key, record); added.push(key);
  }
  if (records.size > 4096) throw new Error('ASSET_COUNT_LIMIT');
  const incoming = new Set([...added, ...reused]);
  const list = [...records.values()].sort((a, b) => compare(a.key, b.key));
  const payload = { assetLibraryVersion: '0.1', id, parent: loaded.parent, renderer: adapter.evidence,
    records: list, summary: summary(list), changes: { added: added.sort(compare), reused: reused.sort(compare),
      retained: list.filter(record => !incoming.has(record.key)).map(record => record.key) }, verification: CHECKS };
  const index = { ...payload, sha256: await digestJson(payload) };
  let outputBytes = 0; for (const bytes of files.values()) outputBytes += bytes.length;
  if (outputBytes > 496 * 1024 * 1024 || jsonFileBytes(index).length > 16 * 1024 * 1024) throw new Error('ASSET_TOTAL_LIMIT');
  await publish(output, index, files); return index;
}

export function resolveAsset(index, key) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}@[0-9]+\.[0-9]+\.[0-9]+$(?![\s\S])/.test(key)) throw new Error('ASSET_EXACT_KEY_REQUIRED');
  const record = index.records.find(record => record.key === key);
  if (!record) throw new Error('ASSET_NOT_FOUND');
  return structuredClone(record);
}
const versionCompare = (a, b) => {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
};
export function searchAssets(index, query, { role = 'icon', style, allVersions = false } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 512 || /[\p{Cc}\p{Cs}]/u.test(query)) throw new Error('ASSET_QUERY');
  if (!ROLES.includes(role) || typeof allVersions !== 'boolean' || (style !== undefined && (typeof style !== 'string' || !style.length || style.length > 96))) throw new Error('ASSET_SEARCH_FILTER');
  const latest = new Map();
  for (const record of index.records) {
    const identity = `${record.namespace}/${record.metadata.id}`, old = latest.get(identity);
    if (!old || versionCompare(record.metadata.version, old.metadata.version) > 0) latest.set(identity, record);
  }
  const normalized = query.normalize('NFKC').trim().toLowerCase(), families = new Map();
  for (const record of allVersions ? index.records : latest.values()) {
    const m = record.metadata;
    if (m.role !== role || (style !== undefined && m.style !== style)) continue;
    const tags = [...new Set([...m.tags, m.name, m.family].map(tag => tag.normalize('NFKC').toLowerCase()))];
    const score = tags.reduce((sum, tag) => sum + (tag === normalized ? 10 : normalized.includes(tag) ? 3 : tag.includes(normalized) ? 1 : 0), 0);
    if (!score) continue;
    const key = `${m.style}/${m.family}`;
    if (!families.has(key)) families.set(key, { family: m.family, style: m.style, role, score, variants: [] });
    const group = families.get(key); group.score = Math.max(score, group.score);
    group.variants.push({ key: record.key, name: m.name, version: m.version, file: record.file.path,
      width: m.size.width, height: m.size.height });
  }
  return [...families.values()].sort((a, b) => b.score - a.score || compare(`${a.style}/${a.family}`, `${b.style}/${b.family}`));
}
