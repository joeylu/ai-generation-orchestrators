import path from 'node:path';
import { canonical, exact, isDigest, local, readBytes, readJson, requireThat, sha256, unseal } from './common.mjs';
import { BUILTIN_IDS, builtinPack, resolvePack } from './packs.mjs';
import { validateDelivery } from './output.mjs';

function artifactBytes(root, artifact, expectedPath) {
  exact(artifact, ['path', 'sha256', 'bytes']);
  requireThat(artifact.path === expectedPath && isDigest(artifact.sha256)
    && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, 'SAMPLE_ARTIFACT');
  const bytes = readBytes(local(root, artifact.path));
  requireThat(bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256, 'SAMPLE_CHECKSUM');
  return bytes;
}
function validateCanvas(value) {
  exact(value, ['width', 'height']);
  requireThat(Object.values(value).every(n => Number.isSafeInteger(n) && n > 0 && n <= 4096), 'SAMPLE_CANVAS');
}

// Read-only intake of an explicit local package. The digest proves integrity, not
// authorship: the caller still selects a trusted catalog and reviews the style.
export function readSampleCatalog(file) {
  const root = path.dirname(path.resolve(file));
  const catalog = readJson(local(root, path.basename(file))); unseal(catalog);
  exact(catalog, ['kind', 'usage', 'sampleSetSha256', 'sampleIsProjectAnchor', 'projectStylePolicy', 'palettePolicy', 'entries', 'sha256']);
  requireThat(catalog.kind === 'ui_reference_local_sample_catalog_v1' && catalog.usage === 'style-selection-preview'
    && isDigest(catalog.sampleSetSha256) && catalog.sampleIsProjectAnchor === false
    && catalog.projectStylePolicy === 'one-reviewed-style-revision-per-project'
    && catalog.palettePolicy === 'sample-recommendation-project-may-create-reviewed-overrides'
    && Array.isArray(catalog.entries) && canonical(catalog.entries.map(e => e.id)) === canonical(BUILTIN_IDS), 'SAMPLE_CATALOG_CONTRACT');
  const images = new Map();
  for (const entry of catalog.entries) {
    exact(entry, ['id', 'name', 'version', 'styleSha256', 'prototypeSha256', 'visualReview', 'image', 'logicalCanvas', 'pixelCanvas', 'style', 'manifest']);
    const pack = builtinPack(entry.id);
    requireThat(entry.name === pack.metadata.name && entry.version === pack.metadata.version
      && entry.visualReview === 'accepted' && isDigest(entry.styleSha256) && isDigest(entry.prototypeSha256), 'SAMPLE_IDENTITY');
    validateCanvas(entry.logicalCanvas); validateCanvas(entry.pixelCanvas);
    artifactBytes(root, entry.manifest, `${entry.id}/manifest.json`);
    artifactBytes(root, entry.style, `${entry.id}/style.json`);
    const delivery = local(root, entry.id);
    validateDelivery(delivery);
    const manifest = readJson(local(delivery, 'manifest.json')), style = readJson(local(delivery, 'style.json'));
    requireThat(manifest.panelIds.length === 1 && manifest.styleSha256 === entry.styleSha256
      && style.sha256 === entry.styleSha256 && style.kind === 'ui_reference_style_v2'
      && style.source.kind === 'builtin' && style.overrides === null && style.notes === ''
      && style.references.length === 0 && canonical(style.pack) === canonical(resolvePack(pack)), 'SAMPLE_STYLE_MISMATCH');
    const prefix = `panels/${manifest.panelIds[0]}`;
    const image = artifactBytes(root, entry.image, `${entry.id}/${prefix}/reference.png`);
    const handoff = readJson(local(delivery, `${prefix}/handoff.json`));
    const provenance = readJson(local(delivery, `${prefix}/provenance.json`));
    requireThat(handoff.reference.sha256 === entry.image.sha256 && handoff.reference.bytes === entry.image.bytes
      && provenance.prototypeSha256 === entry.prototypeSha256 && provenance.anchorSha256 === null
      && canonical(handoff.logicalCanvas) === canonical(entry.logicalCanvas)
      && canonical(handoff.canvas) === canonical(entry.pixelCanvas), 'SAMPLE_PANEL_MISMATCH');
    images.set(entry.id, image);
  }
  requireThat(new Set(catalog.entries.map(e => e.prototypeSha256)).size === 1
    && new Set(catalog.entries.map(e => canonical(e.logicalCanvas))).size === 1, 'SAMPLE_PROTOTYPE_MISMATCH');
  return { catalog, images };
}
