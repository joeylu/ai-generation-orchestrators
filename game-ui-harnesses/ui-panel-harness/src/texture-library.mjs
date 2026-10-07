import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { canonicalJson, digestBytes, digestJson } from './canonical.mjs';
import { createOutputDirectory, jsonFileBytes } from './io.mjs';
import { classifyTexture, parseUnityTextureMeta } from './texture-semantics.mjs';
import { textureUsage } from './texture-usage.mjs';
import { REDESIGN_STYLE, describeTextureRedesign, redesignUnityMetadata } from './textures/redesign-contract.mjs';
import { verifyTextureCuration } from './textures/curation-contract.mjs';

const PNG_LIMIT = 16 * 1024 * 1024;
const ID = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const textureId = async path => `texture-${(await digestBytes(new TextEncoder().encode(path))).slice(0, 24)}`;

async function noLinks(path) {
  for (let item = resolve(path); ; item = dirname(item)) {
    if ((await lstat(item)).isSymbolicLink()) throw new Error('TEXTURE_LINK_FORBIDDEN');
    if (dirname(item) === item) break;
  }
}
async function boundedFile(path, limit) {
  await noLinks(path);
  const info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error('TEXTURE_FILE_LIMIT');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('TEXTURE_FILE_LIMIT');
  return bytes;
}
function imageCheck(image) {
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width * image.height > 16 * 1024 * 1024
    || image.channels !== 4 || !['empty', 'opaque', 'mixed'].includes(image.alpha?.mode)) throw new Error('TEXTURE_IMAGE_EVIDENCE');
  const alpha = image.alpha, pixels = image.width * image.height;
  for (const key of ['transparentPixels', 'opaquePixels', 'softPixels', 'hiddenRgbPixels']) {
    if (!Number.isSafeInteger(alpha[key]) || alpha[key] < 0 || alpha[key] > pixels) throw new Error('TEXTURE_ALPHA_EVIDENCE');
  }
  if (alpha.transparentPixels + alpha.opaquePixels + alpha.softPixels !== pixels || alpha.hiddenRgbPixels > alpha.transparentPixels) throw new Error('TEXTURE_ALPHA_EVIDENCE');
  const mode = alpha.transparentPixels === pixels ? 'empty' : alpha.opaquePixels === pixels ? 'opaque' : 'mixed';
  if (alpha.mode !== mode) throw new Error('TEXTURE_ALPHA_EVIDENCE');
  const bounds = alpha.visibleBounds;
  if (mode === 'empty' ? bounds !== null : !bounds) throw new Error('TEXTURE_BOUNDS_EVIDENCE');
  if (bounds && (Object.keys(bounds).sort().join('|') !== 'height|width|x|y' || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(bounds[key])) || bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1
    || bounds.x + bounds.width > image.width || bounds.y + bounds.height > image.height)) throw new Error('TEXTURE_BOUNDS_EVIDENCE');
}
function unityCheck(unity, image) {
  if (!unity || Object.keys(unity).sort().join('|') !== 'alphaIsTransparency|border|guid|issues|nineSlice|pivot|pixelsPerUnit|spriteMode'
    || (unity.guid !== null && !/^[a-f0-9]{32}$/i.test(unity.guid))
    || (unity.spriteMode !== null && !Number.isSafeInteger(unity.spriteMode))
    || (unity.pixelsPerUnit !== null && !Number.isFinite(unity.pixelsPerUnit))
    || ![null, true, false].includes(unity.alphaIsTransparency)
    || !Array.isArray(unity.issues) || !unity.issues.every(code => typeof code === 'string' && /^[a-z-]+:[A-Za-z-]+$/.test(code))) throw new Error('TEXTURE_UNITY_EVIDENCE');
  if (unity.pivot !== null && (!unity.pivot || Object.keys(unity.pivot).sort().join('|') !== 'x|y' || !Number.isFinite(unity.pivot.x) || !Number.isFinite(unity.pivot.y))) throw new Error('TEXTURE_UNITY_EVIDENCE');
  const b = unity.border;
  if (b !== null && (!b || Object.keys(b).sort().join('|') !== 'bottom|left|right|top' || !['left', 'bottom', 'right', 'top'].every(key => Number.isFinite(b[key])))) throw new Error('TEXTURE_UNITY_EVIDENCE');
  let expected = 'unknown';
  if (unity.spriteMode === 1 && b) {
    const invalid = Object.values(b).some(value => value < 0) || b.left + b.right >= image.width || b.top + b.bottom >= image.height;
    expected = invalid ? 'invalid' : Object.values(b).every(value => value === 0) ? 'none' : 'valid';
  } else if (unity.spriteMode === 1 && unity.issues.includes('invalid:spriteBorder')) expected = 'invalid';
  if (unity.nineSlice !== expected) throw new Error('TEXTURE_SLICE_EVIDENCE');
}
function safeSourcePath(value) {
  if (typeof value !== 'string' || value.length > 512 || value.startsWith('/') || /[\\:\p{Cc}\p{Cs}]/u.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..') || !value.toLowerCase().endsWith('.png')) throw new Error('TEXTURE_SOURCE_PATH');
  return value;
}
const sum = (items, key) => Object.fromEntries([...new Set(items.map(key))].sort(compare).map(value => [value, items.filter(item => key(item) === value).length]));
export function textureSummary(records) {
  return { assets: records.length, uniquePngFiles: new Set(records.map(item => item.file.path)).size,
    families: new Set(records.map(item => item.classification.family)).size, categories: sum(records, item => item.classification.category),
    nineSlice: sum(records, item => item.unity.nineSlice), emptyImages: records.filter(item => item.image.alpha.mode === 'empty').length };
}

/** Read-only source inventory. Original image bytes, dimensions and alpha are never altered. */
export async function collectTextureSources(sourceInput, adapter) {
  const source = resolve(sourceInput);
  await noLinks(source);
  if (!(await lstat(source)).isDirectory()) throw new Error('TEXTURE_SOURCE_DIRECTORY');
  const paths = [];
  async function visit(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('TEXTURE_LINK_FORBIDDEN');
      const full = resolve(directory, item.name);
      if (item.isDirectory()) await visit(full);
      else if (item.isFile() && extname(item.name).toLowerCase() === '.png') paths.push(full);
      else if (/\.(?:jpe?g|webp|gif|tga|psd|svg|bmp)$/i.test(item.name)) throw new Error('TEXTURE_SOURCE_FORMAT_UNSUPPORTED');
      if (paths.length > 4096) throw new Error('TEXTURE_COUNT_LIMIT');
    }
  }
  await visit(source);
  if (!paths.length) throw new Error('TEXTURE_SOURCE_EMPTY');
  const inputs = [];
  let totalBytes = 0;
  for (const full of paths.sort(compare)) {
    const sourcePath = safeSourcePath(relative(source, full).split(sep).join('/'));
    const bytes = await boundedFile(full, PNG_LIMIT);
    totalBytes += bytes.length;
    if (totalBytes > 256 * 1024 * 1024) throw new Error('TEXTURE_TOTAL_BYTES_LIMIT');
    const image = await adapter.analyze(bytes); imageCheck(image);
    let metaBytes = null;
    try { metaBytes = await boundedFile(`${full}.meta`, 1024 * 1024); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const metaText = metaBytes ? new TextDecoder('utf-8', { fatal: true }).decode(metaBytes) : '';
    inputs.push({ bytes, record: {
      id: await textureId(sourcePath),
      source: { relativePath: sourcePath, sha256: await digestBytes(bytes), metaSha256: metaBytes ? await digestBytes(metaBytes) : null },
      image, unity: parseUnityTextureMeta(metaText, image), classification: classifyTexture(sourcePath),
    } });
  }
  const seen = new Set();
  for (const item of inputs) { if (seen.has(item.record.id)) throw new Error('TEXTURE_ID_COLLISION'); seen.add(item.record.id); }
  return inputs.sort((a, b) => compare(a.record.source.relativePath, b.record.source.relativePath));
}

export async function makeTextureLibrary(inputs, id, adapterEvidence) {
  if (!ID.test(id)) throw new Error('TEXTURE_LIBRARY_ID');
  const records = inputs.map(({ record, bytes }) => ({ ...record, file: { path: `textures/${record.source.sha256}.png`, sha256: record.source.sha256, bytes: bytes.length } }));
  const payload = {
    textureLibraryVersion: '0.1', id,
    provenance: { kind: 'user-supplied-source', operation: 'byte-preserving-intake', semantics: 'path-rules-not-image-understanding' },
    analysis: adapterEvidence,
    summary: textureSummary(records),
    records, verification: { sourceImages: 'HASHED_AND_DECODED', originalPixels: 'PRESERVED', semanticReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' },
  };
  return { ...payload, sha256: await digestJson(payload) };
}

/** Only allow our generated relative artifact names; never trust a caller-supplied output path. */
function packagePath(path) {
  if (typeof path !== 'string' || !/^(?:(?:textures|vectors)\/[a-f0-9]{64}\.(?:png|svg)|previews\/[a-z0-9-]+\.png|(?:texture-library|texture-redesign|texture-catalog)\.json)$(?![\s\S])/.test(path)) throw new Error('TEXTURE_PACKAGE_PATH');
  return path;
}

export async function publishTexturePackage(output, files, { kind, id, sha256 }) {
  const names = new Set();
  const manifestFiles = [];
  for (const file of files) {
    packagePath(file.path);
    if (names.has(file.path)) throw new Error('TEXTURE_DUPLICATE_FILE');
    names.add(file.path);
    manifestFiles.push({ path: file.path, bytes: file.bytes.length, sha256: await digestBytes(file.bytes) });
  }
  const directory = await createOutputDirectory(output);
  for (const file of files) {
    const target = resolve(directory, ...file.path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: 'wx' });
  }
  const delivery = { textureDeliveryVersion: '0.1', status: 'COMPLETE', kind, id, sha256,
    files: manifestFiles, visualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
  await writeFile(resolve(directory, 'delivery.json'), jsonFileBytes(delivery), { flag: 'wx' });
  return { directory, delivery };
}

export async function importTextureLibrary(source, output, adapter, { id = 'muip-source' } = {}) {
  const inputs = await collectTextureSources(source, adapter), library = await makeTextureLibrary(inputs, id, adapter.evidence);
  const blobs = new Map(inputs.map(item => [`textures/${item.record.source.sha256}.png`, item.bytes]));
  const files = [...blobs].map(([path, bytes]) => ({ path, bytes }));
  files.push({ path: 'texture-library.json', bytes: jsonFileBytes(library) });
  await publishTexturePackage(output, files, { kind: 'source-library', id, sha256: library.sha256 });
  return library;
}

/** File and decoded-image consistency, not a digital signature or proof of original author identity. */
export async function verifyTexturePackage(directoryInput, adapter) {
  const directory = resolve(directoryInput); await noLinks(directory);
  const manifest = JSON.parse(await boundedFile(resolve(directory, 'delivery.json'), 4 * 1024 * 1024));
  if (manifest.textureDeliveryVersion !== '0.1' || manifest.status !== 'COMPLETE'
    || !['source-library', 'redesign', 'curated'].includes(manifest.kind) || !ID.test(manifest.id)
    || !SHA.test(manifest.sha256) || manifest.visualReview !== 'NOT_RUN' || manifest.nativeEngines !== 'NOT_RUN'
    || !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 10000) throw new Error('TEXTURE_DELIVERY_CONTRACT');
  const blobs = new Map();
  for (const file of manifest.files) {
    packagePath(file.path);
    if (blobs.has(file.path) || !SHA.test(file.sha256)) throw new Error('TEXTURE_DELIVERY_FILE');
    const bytes = await boundedFile(resolve(directory, ...file.path.split('/')), 32 * 1024 * 1024);
    if (bytes.length !== file.bytes || await digestBytes(bytes) !== file.sha256) throw new Error('TEXTURE_FILE_MISMATCH');
    blobs.set(file.path, bytes);
  }
  const curated = manifest.kind === 'curated', redesigned = manifest.kind !== 'source-library';
  const name = curated ? 'texture-catalog.json' : redesigned ? 'texture-redesign.json' : 'texture-library.json';
  if (!blobs.has(name)) throw new Error('TEXTURE_INDEX_MISSING');
  const index = JSON.parse(blobs.get(name)), { sha256, ...payload } = index;
  if (await digestJson(payload) !== sha256 || sha256 !== manifest.sha256 || index.id !== manifest.id
    || !Array.isArray(index.records) || index.records.length > 4096 || !index.records.length) throw new Error('TEXTURE_INDEX_MISMATCH');
  const expectedVerification = manifest.kind === 'source-library'
    ? { sourceImages: 'HASHED_AND_DECODED', originalPixels: 'PRESERVED', semanticReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' }
    : { png: 'DECODED_NONEMPTY_ALPHA_CLEAN', sourceMapping: curated ? 'POLICY_SUBSET' : 'ONE_TO_ONE', sliceGeometry: 'VALIDATED', semanticReview: 'NOT_RUN', visualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
  if ((curated ? index.textureCatalogVersion : redesigned ? index.textureRedesignVersion : index.textureLibraryVersion) !== '0.1'
    || canonicalJson(index.verification) !== canonicalJson(expectedVerification)) throw new Error('TEXTURE_INDEX_CONTRACT');
  const ids = new Set();
  const decoded = new Map();
  let sourceIndex, sourceRecords;
  if (redesigned) {
    if (!blobs.has('texture-library.json')) throw new Error('REDESIGN_SOURCE_INDEX_MISSING');
    sourceIndex = JSON.parse(blobs.get('texture-library.json'));
    const { sha256: sourceHash, ...sourcePayload } = sourceIndex;
    if (sourceHash !== index.sourceLibrary?.sha256 || sourceIndex.id !== index.sourceLibrary?.id || await digestJson(sourcePayload) !== sourceHash
      || sourceIndex.textureLibraryVersion !== '0.1' || !Array.isArray(sourceIndex.records) || sourceIndex.records.length > 4096
      || (!curated && sourceIndex.records.length !== index.records.length)) throw new Error('REDESIGN_SOURCE_INDEX_MISMATCH');
    sourceRecords = new Map(sourceIndex.records.map(record => [record.id, record]));
    if (sourceRecords.size !== sourceIndex.records.length) throw new Error('REDESIGN_SOURCE_INDEX_MISMATCH');
    if (curated) {
      for (const record of sourceIndex.records) {
        safeSourcePath(record.source.relativePath);
        if (record.id !== await textureId(record.source.relativePath)
          || !SHA.test(record.source.sha256) || (record.source.metaSha256 !== null && !SHA.test(record.source.metaSha256))
          || canonicalJson(record.classification) !== canonicalJson(classifyTexture(record.source.relativePath))) throw new Error('REDESIGN_SOURCE_INDEX_MISMATCH');
        imageCheck(record.image); unityCheck(record.unity, record.image);
      }
    }
    if (canonicalJson(index.style) !== canonicalJson(REDESIGN_STYLE)) throw new Error('REDESIGN_STYLE_MISMATCH');
  }
  for (const record of index.records) {
    safeSourcePath(record.source.relativePath);
    if (record.id !== await textureId(record.source.relativePath) || ids.has(record.id)) throw new Error('TEXTURE_RECORD_ID');
    ids.add(record.id);
    if (canonicalJson(record.classification) !== canonicalJson(classifyTexture(record.source.relativePath))) throw new Error('TEXTURE_CLASSIFICATION_MISMATCH');
    if (!SHA.test(record.source.sha256) || (record.source.metaSha256 !== null && !SHA.test(record.source.metaSha256))) throw new Error('TEXTURE_SOURCE_DIGEST');
    imageCheck(record.image); unityCheck(record.unity, record.image);
    const file = record.file; packagePath(file.path);
    if (!blobs.has(file.path) || file.path !== `textures/${file.sha256}.png`
      || file.bytes !== blobs.get(file.path).length || await digestBytes(blobs.get(file.path)) !== file.sha256) throw new Error('TEXTURE_RECORD_FILE');
    if (!decoded.has(file.sha256)) { const evidence = await adapter.analyze(blobs.get(file.path)); imageCheck(evidence); decoded.set(file.sha256, evidence); }
    if (canonicalJson(decoded.get(file.sha256)) !== canonicalJson(record.image)) throw new Error('TEXTURE_IMAGE_MISMATCH');
    if (manifest.kind === 'source-library' && file.sha256 !== record.source.sha256) throw new Error('TEXTURE_SOURCE_MISMATCH');
    if (redesigned) {
      const vector = record.vector; packagePath(vector.path);
      if (!blobs.has(vector.path) || vector.path !== `vectors/${vector.sha256}.svg` || vector.bytes !== blobs.get(vector.path).length || await digestBytes(blobs.get(vector.path)) !== vector.sha256) throw new Error('TEXTURE_VECTOR_MISMATCH');
      const original = sourceRecords.get(record.id);
      if (!original || canonicalJson(record.source) !== canonicalJson(original.source) || canonicalJson(record.sourceImage) !== canonicalJson(original.image)
        || canonicalJson(record.sourceUnity) !== canonicalJson(original.unity) || record.image.width !== original.image.width || record.image.height !== original.image.height) throw new Error('REDESIGN_SOURCE_MAPPING');
      const expected = describeTextureRedesign(original), expectedBytes = new TextEncoder().encode(expected.svg);
      if (await digestBytes(expectedBytes) !== vector.sha256) throw new Error('REDESIGN_VECTOR_MISMATCH');
      if (canonicalJson(record.unity) !== canonicalJson(redesignUnityMetadata(original.unity, expected.border, record.image))) throw new Error('REDESIGN_IMPORT_METADATA_MISMATCH');
      const regenerated = await adapter.render(expected.svg, record.image.width, record.image.height);
      if (await digestBytes(regenerated) !== file.sha256) throw new Error('REDESIGN_RASTER_MISMATCH');
      if (record.image.alpha.mode === 'empty' || record.image.alpha.hiddenRgbPixels !== 0 || !['valid', 'none'].includes(record.unity.nineSlice)) throw new Error('REDESIGN_PIXEL_GATE');
    }
  }
  if (canonicalJson(index.summary) !== canonicalJson(textureSummary(index.records))) throw new Error('TEXTURE_SUMMARY_MISMATCH');
  if (curated) {
    await verifyTextureCuration(index, sourceIndex, blobs, adapter);
  }
  return { index, manifest, blobs };
}

export function searchTextures(library, query, { category, role } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 512 || /[\p{Cc}\p{Cs}]/u.test(query)) throw new Error('TEXTURE_QUERY');
  if (category && !['border', 'icon', 'shadow', 'demo', 'other'].includes(category)) throw new Error('TEXTURE_CATEGORY');
  if (role !== undefined && !['icon', 'shape', 'effect', 'layout-primitive', 'animation-part'].includes(role)) throw new Error('TEXTURE_ROLE');
  const wantedRole = role ?? (library.textureCatalogVersion ? 'icon' : undefined);
  const normalized = query.normalize('NFKC').toLowerCase(), families = new Map();
  for (const record of library.records) {
    const item = record.classification;
    if (wantedRole && textureUsage(record.source.relativePath).role !== wantedRole) continue;
    if (category ? item.category !== category : item.category === 'demo') continue;
    const tags = [...new Set(item.tags.map(tag => tag.normalize('NFKC').toLowerCase()))];
    const score = tags.reduce((value, tag) => value + (tag === normalized ? 10 : normalized.includes(tag) ? 3 : tag.includes(normalized) ? 1 : 0), 0);
    if (!score) continue;
    if (!families.has(item.family)) families.set(item.family, { family: item.family, category: item.category, score, variants: [] });
    const family = families.get(item.family); family.score = Math.max(family.score, score);
    family.variants.push({ id: record.id, sourcePath: record.source.relativePath, file: record.file.path, width: record.image.width, height: record.image.height, ...item.variant });
  }
  return [...families.values()].sort((a, b) => b.score - a.score || compare(a.family, b.family));
}
