import { digestBytes, digestJson } from './canonical.mjs';
import { jsonFileBytes } from './io.mjs';
import { textureSummary, verifyTexturePackage, publishTexturePackage } from './texture-library.mjs';
import { REDESIGN_STYLE, describeTextureRedesign, redesignUnityMetadata } from './textures/redesign-contract.mjs';
export { REDESIGN_STYLE, describeTextureRedesign, redesignUnityMetadata } from './textures/redesign-contract.mjs';

/** New vector designs retain source semantic identities, not original image pixels. */
export async function redesignTextures(libraryDirectory, output, adapter, { id = 'muip-modern-mint-v1', onProgress } = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$(?![\s\S])/.test(id)) throw new Error('TEXTURE_LIBRARY_ID');
  const checked = await verifyTexturePackage(libraryDirectory, adapter);
  if (checked.manifest.kind !== 'source-library') throw new Error('REDESIGN_SOURCE_LIBRARY_REQUIRED');
  const source = checked.index, files = new Map(), records = [], previews = [];
  for (const [index, original] of source.records.entries()) {
    const { width, height } = original.image;
    const { svg, border, notes } = describeTextureRedesign(original);
    const vectorBytes = new TextEncoder().encode(svg), vectorHash = await digestBytes(vectorBytes);
    const png = await adapter.render(svg, width, height), pngHash = await digestBytes(png), image = await adapter.analyze(png);
    if (image.width !== width || image.height !== height || image.alpha.mode === 'empty' || image.alpha.hiddenRgbPixels !== 0) throw new Error('REDESIGN_PIXEL_GATE');
    const unity = redesignUnityMetadata(original.unity, border, image);
    if (!['valid', 'none'].includes(unity.nineSlice)) throw new Error('REDESIGN_SLICE_GATE');
    const file = { path: `textures/${pngHash}.png`, sha256: pngHash, bytes: png.length };
    const vector = { path: `vectors/${vectorHash}.svg`, sha256: vectorHash, bytes: vectorBytes.length };
    files.set(file.path, png); files.set(vector.path, vectorBytes);
    records.push({ id: original.id, source: original.source, sourceImage: original.image, sourceUnity: original.unity,
      classification: original.classification, file, vector, image, unity,
      redesign: { method: 'new-vector-design', notes, sourceImportSettings: 'not-a-prefab-drop-in-guarantee',
        pivot: original.unity.pivot ? 'preserved' : 'design-default-center', pixelsPerUnit: original.unity.pixelsPerUnit > 0 ? 'preserved' : 'design-default-100' } });
    previews.push({ bytes: png, label: `${String(index + 1).padStart(3, '0')} ${original.source.relativePath.split('/').at(-1).replace(/\.png$/i, '')}` });
    if (onProgress && (index % 25 === 0 || index === source.records.length - 1)) onProgress({ completed: index + 1, total: source.records.length });
  }
  // Contact sheets are inspection artifacts, not runtime textures or claims of visual acceptance.
  const galleryPaths = [];
  for (let start = 0; start < previews.length; start += 48) {
    const path = `previews/gallery-${String(start / 48 + 1).padStart(3, '0')}.png`;
    files.set(path, await adapter.gallery(previews.slice(start, start + 48)));
    galleryPaths.push(path);
  }
  const payload = { textureRedesignVersion: '0.1', id, style: REDESIGN_STYLE,
    sourceLibrary: { id: source.id, sha256: source.sha256 }, renderer: adapter.evidence,
    summary: textureSummary(records), records, previews: galleryPaths,
    verification: { png: 'DECODED_NONEMPTY_ALPHA_CLEAN', sourceMapping: 'ONE_TO_ONE',
      sliceGeometry: 'VALIDATED', semanticReview: 'NOT_RUN', visualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' } };
  const redesign = { ...payload, sha256: await digestJson(payload) };
  files.set('texture-library.json', jsonFileBytes(source));
  files.set('texture-redesign.json', jsonFileBytes(redesign));
  await publishTexturePackage(output, [...files].map(([path, bytes]) => ({ path, bytes })), { kind: 'redesign', id, sha256: redesign.sha256 });
  return redesign;
}
