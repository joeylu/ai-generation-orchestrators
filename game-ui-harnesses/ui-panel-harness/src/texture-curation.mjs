import { digestJson } from './canonical.mjs';
import { jsonFileBytes } from './io.mjs';
import { publishTexturePackage, textureSummary, verifyTexturePackage } from './texture-library.mjs';
import { TEXTURE_CURATION_POLICY, textureUsage } from './texture-usage.mjs';
import { selectTextures, previewGroups, renderPreview, textureUsageSummary } from './textures/curation-contract.mjs';
export { textureUsageSummary, verifyTextureCuration } from './textures/curation-contract.mjs';

const ID = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;

/** Publish a new generation catalog. Archive packages and their images remain untouched. */
export async function curateTextureLibrary(libraryDirectory, output, adapter, { id = 'modern-mint-panel-core-v1' } = {}) {
  if (!ID.test(id)) throw new Error('TEXTURE_LIBRARY_ID');
  const checked = await verifyTexturePackage(libraryDirectory, adapter);
  if (checked.manifest.kind !== 'redesign') throw new Error('TEXTURE_CURATION_REDRAW_REQUIRED');
  const original = checked.index;
  const source = JSON.parse(checked.blobs.get('texture-library.json'));
  const chosen = selectTextures(source.records);
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
