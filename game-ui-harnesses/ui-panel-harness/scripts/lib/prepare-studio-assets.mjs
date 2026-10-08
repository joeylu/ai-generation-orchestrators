import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAssetLibrary, importAssetBatch } from '../../src/asset-library.mjs';
import { createCoreAssetBatch } from '../../src/core-asset-profile.mjs';
import { canonicalJson } from '../../src/canonical.mjs';

/** Verify the whole input, then publish only the explicit core selection through the normal importer. */
export async function prepareStudioAssets(source, output, adapter) {
  const verified = await verifyAssetLibrary(source, adapter), profile = createCoreAssetBatch(verified.index);
  const temporary = await mkdtemp(join(tmpdir(), 'ui-panel-core-assets-'));
  const created=[];
  try {
  for (const selection of profile.selections) {
    const record = verified.index.records.find(record=>record.key===selection.sourceKey);
    const file=join(temporary,selection.asset.file);
    await writeFile(file,verified.blobs.get(record.source.file.path),{flag:'wx'});created.push(file);
  }
  const batchFile = join(temporary,'assets.json');
  await writeFile(batchFile,canonicalJson(profile.batch),{flag:'wx'});created.push(batchFile);
  await importAssetBatch(batchFile, output, adapter, {id:'panel-core-assets'});
  const result = await verifyAssetLibrary(output,adapter);
  // The selection changes names/tags, never source pixels or source bytes.
  for (const selection of profile.selections) {
    const record=result.index.records.find(record=>record.metadata.id===selection.asset.id);
    if (record.source.file.sha256!==selection.sourceSha256 || record.file.sha256!==selection.pngSha256) throw new Error('CORE_ASSET_PIXEL_MISMATCH');
  }
  return {profileVersion:profile.profileVersion,source:{id:verified.index.id,sha256:verified.index.sha256},
    library:{id:result.index.id,sha256:result.index.sha256},
    selections:profile.selections.map(s=>({sourceKey:s.sourceKey,key:`panel-core/${s.asset.id}@1.0.0`,sourceSha256:s.sourceSha256,pngSha256:s.pngSha256})),
    policy:{surfaces:'PROGRAMMATIC_THEME',icons:'EXPLICIT_CORE_SELECTION',pixelChanges:false},modelCalls:0};
  } finally {
    // Only known files in this newly created temporary directory; no recursive removal.
    for(const file of created)await unlink(file);
    await rmdir(temporary);
  }
}
