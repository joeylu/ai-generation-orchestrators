/** Shared selection and replay rules. Filesystem publication belongs to the workflow. */
import { canonicalJson, digestBytes } from '../canonical.mjs';
import { TEXTURE_CURATION_POLICY, textureUsage } from '../texture-usage.mjs';

const ROLES = ['icon', 'shape', 'effect', 'layout-primitive', 'animation-part'];
const ID = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

export function textureUsageSummary(records) {
  return Object.fromEntries(ROLES.map(role => [role, records.filter(record => record.usage.role === role).length]));
}

export function selectTextures(sourceRecords) {
  const included = [], exclusions = [];
  for (const record of sourceRecords) {
    const usage = textureUsage(record.source.relativePath);
    if (usage.role === 'excluded') exclusions.push({ id: record.id, sourcePath: record.source.relativePath, reason: usage.reason });
    else included.push(record.id);
  }
  return { included, exclusions };
}

export function previewGroups(records) {
  const groups = [];
  for (const role of ROLES) {
    const members = records.filter(record => record.usage.role === role);
    for (let offset = 0; offset < members.length; offset += 48) {
      groups.push({ path: `previews/${role}-${String(offset / 48 + 1).padStart(3, '0')}.png`, records: members.slice(offset, offset + 48) });
    }
  }
  return groups;
}

export async function renderPreview(group, blobs, adapter) {
  return adapter.gallery(group.records.map(record => ({ bytes: blobs.get(record.file.path),
    label: record.source.relativePath.split('/').at(-1).replace(/\.png$/i, '') })));
}

/** Recomputed from the complete source index; excluded assets cannot be relabeled as icons. */
export async function verifyTextureCuration(index, sourceIndex, blobs, adapter) {
  if (!same(index.policy, TEXTURE_CURATION_POLICY) || !ID.test(index.derivedFrom?.id) || !SHA.test(index.derivedFrom?.sha256)) throw new Error('TEXTURE_CURATION_POLICY');
  const expected = selectTextures(sourceIndex.records);
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

