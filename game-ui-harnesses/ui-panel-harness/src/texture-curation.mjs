import { canonicalJson, digestBytes, digestJson } from './canonical.mjs';
import { jsonFileBytes } from './io.mjs';
import { publishTexturePackage, textureSummary, verifyTexturePackage } from './texture-library.mjs';
import { TEXTURE_CURATION_POLICY, textureUsage } from './texture-usage.mjs';

const ROLES = ['icon', 'shape', 'effect', 'layout-primitive', 'animation-part'];
const ID = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

export function textureUsageSummary(records) {
  return Object.fromEntries(ROLES.map(role => [role, records.filter(record => record.usage.role === role).length]));
}

function selection(sourceRecords) {
  const included = [], exclusions = [];
  for (const record of sourceRecords) {
    const usage = textureUsage(record.source.relativePath);
    if (usage.role === 'excluded') exclusions.push({ id: record.id, sourcePath: record.source.relativePath, reason: usage.reason });
    else included.push(record.id);
  }
  return { included, exclusions };
}

function previewGroups(records) {
  const groups = [];
  for (const role of ROLES) {
    const members = records.filter(record => record.usage.role === role);
    for (let offset = 0; offset < members.length; offset += 48) {
      groups.push({ path: `previews/${role}-${String(offset / 48 + 1).padStart(3, '0')}.png`, records: members.slice(offset, offset + 48) });
    }
  }
  return groups;
}

async function renderPreview(group, blobs, adapter) {
  return adapter.gallery(group.records.map(record => ({ bytes: blobs.get(record.file.path),
    label: record.source.relativePath.split('/').at(-1).replace(/\.png$/i, '') })));
}

/** Recomputed from the complete source index; excluded assets cannot be relabeled as icons. */
export async function verifyTextureCuration(index, sourceIndex, blobs, adapter) {
  if (!same(index.policy, TEXTURE_CURATION_POLICY) || !ID.test(index.derivedFrom?.id) || !SHA.test(index.derivedFrom?.sha256)) throw new Error('TEXTURE_CURATION_POLICY');
  const expected = selection(sourceIndex.records);
  if (!same(index.records.map(record => record.id), expected.included) || !same(index.exclusions, expected.exclusions)) throw new Error('TEXTURE_CURATION_SELECTION');
  for (const record of index.records) {
    if (!same(record.usage, textureUsage(record.source.relativePath))) throw new Error('TEXTURE_CURATION_USAGE');
  }
  if (!same(index.usageSummary, textureUsageSummary(index.records))) throw new Error('TEXTURE_CURATION_SUMMARY');
  const groups = previewGroups(index.records);
  if (!same(index.previews, groups.map(group => group.path))) throw new Error('TEXTURE_CURATION_PREVIEWS');
  const expectedPaths = new Set(['texture-library.json', 'texture-catalog.json', ...index.previews,
    ...index.records.flatMap(record => [record.file.path, record.vector.path])]);
  if (blobs.size !== expectedPaths.size || [...blobs.keys()].some(path => !expectedPaths.has(path))) throw new Error('TEXTURE_CURATION_FILES');
  for (const group of groups) {
    const bytes = blobs.get(group.path);
    if (!bytes || await digestBytes(bytes) !== await digestBytes(await renderPreview(group, blobs, adapter))) throw new Error('TEXTURE_CURATION_PREVIEW_MISMATCH');
  }
}

/** Publish a new generation catalog. Archive packages and their images remain untouched. */
export async function curateTextureLibrary(libraryDirectory, output, adapter, { id = 'modern-mint-panel-core-v1' } = {}) {
  if (!ID.test(id)) throw new Error('TEXTURE_LIBRARY_ID');
  const checked = await verifyTexturePackage(libraryDirectory, adapter);
  if (checked.manifest.kind !== 'redesign') throw new Error('TEXTURE_CURATION_REDRAW_REQUIRED');
  const original = checked.index;
  const source = JSON.parse(checked.blobs.get('texture-library.json'));
  const chosen = selection(source.records);
  const byId = new Map(original.records.map(record => [record.id, record]));
  const records = chosen.included.map(id => {
    const record = byId.get(id);
    if (!record) throw new Error('TEXTURE_CURATION_SOURCE_MAPPING');
    return { ...structuredClone(record), usage: textureUsage(record.source.relativePath) };
  });
  if (!records.length) throw new Error('TEXTURE_CURATION_EMPTY');
  const files = new Map();
  for (const record of records) for (const file of [record.file, record.vector]) files.set(file.path, checked.blobs.get(file.path));
  // Rebuild contact sheets by role: never copy the full archive's excluded imagery.
  const groups = previewGroups(records);
  for (const group of groups) files.set(group.path, await renderPreview(group, files, adapter));
  const payload = {
    textureCatalogVersion: '0.1', id, policy: TEXTURE_CURATION_POLICY,
    derivedFrom: { id: original.id, sha256: original.sha256 },
    style: original.style, sourceLibrary: original.sourceLibrary, renderer: original.renderer,
    summary: textureSummary(records), usageSummary: textureUsageSummary(records), records,
    exclusions: chosen.exclusions, previews: groups.map(group => group.path),
    verification: { png: 'DECODED_NONEMPTY_ALPHA_CLEAN', sourceMapping: 'POLICY_SUBSET',
      sliceGeometry: 'VALIDATED', semanticReview: 'NOT_RUN', visualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' },
  };
  const index = { ...payload, sha256: await digestJson(payload) };
  // Original metadata is retained solely for provenance and complete policy verification, without its image payloads.
  files.set('texture-library.json', checked.blobs.get('texture-library.json'));
  files.set('texture-catalog.json', jsonFileBytes(index));
  await publishTexturePackage(output, [...files].map(([path, bytes]) => ({ path, bytes })), { kind: 'curated', id, sha256: index.sha256 });
  return index;
}
