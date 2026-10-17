import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { verifySkinPackage, hash, json } from '../src/skins/package.mjs';
import { decodePng } from '../src/skins/png.mjs';
import { skinUsage } from '../src/skins/usage.mjs';
import { suggestSlices } from '../src/slicing/suggestion.mjs';

const { values } = parseArgs({ options: { package: { type: 'string' } } });
if (!values.package) throw Error('Use --package <pack-directory>. Read-only suggestions; no changes applied.');
const { pack, resources, manifestSha256 } = await verifySkinPackage(values.package);
const analysisFiles = ['scripts/skin-slices.mjs','src/slicing/suggestion.mjs','tools/panel-slicer/src/suggestion.mjs','tools/panel-slicer/src/analyze.mjs','tools/panel-slicer/src/structure.mjs','src/slicing/geometry.mjs','tools/panel-slicer/src/geometry.mjs','schemas/slice-document.schema.json','src/skins/usage.mjs'];
const tools = await Promise.all(analysisFiles.map(async file => ({ file, sha256: hash(await readFile(new URL('../' + file, import.meta.url))) })));
const assets = pack.assets.map(a => {
  const usage = skinUsage(a, a.width, a.height, pack.scale);
  const suggestion = a.stretch === 'uniform' ? { status: 'skipped', reason: 'Uniform asset; no slice suggestion.' }
    : suggestSlices(decodePng(resources.get(a.file)), usage.resolution);
  let minimumSizeCompatible = null;
  if (suggestion.status === 'supported') {
    try { skinUsage({ ...a, nineSlice: suggestion.nineSlice }, a.width, a.height, pack.scale).measure(a.minSize.width, a.minSize.height); minimumSizeCompatible = true; }
    catch { minimumSizeCompatible = false; }
  }
  return { assetId: a.assetId, sourceSha256: a.sha256, resolution: usage.resolution, current: a.nineSlice, suggestion, minimumSizeCompatible };
});
console.log(json({ kind: 'ui_skin_slice_suggestions', version: '1.0', manifestSha256, tools, applied: false,
  note: 'Review corners, state alignment, safe areas and minimum sizes before editing the skin authoring input; never edit the package.', assets }));
