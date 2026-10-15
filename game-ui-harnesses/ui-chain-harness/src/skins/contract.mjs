import Ajv from 'ajv';
import packSchema from '../../schemas/skin-pack.schema.json' with { type: 'json' };
import inputSchema from '../../schemas/skin-import.schema.json' with { type: 'json' };
import themeSchema from '../../schemas/runtime-theme.schema.json' with { type: 'json' };
import { skinUsage } from './usage.mjs';
import {textRoles} from './text-readability.mjs';
import {validateMaterialAsset,validateSurfaceStyles,materialFiles,surfaceStyleInfo} from './surface-styles.mjs';
const ajv = new Ajv({ allErrors: true, strict: true });
ajv.addSchema(themeSchema, 'runtime-theme');
const packCheck = ajv.compile(packSchema), inputCheck = ajv.compile(inputSchema);
export function fail(code, message) { throw Object.assign(new Error(message), { code }); }
export function safePath(value) {
  return typeof value === 'string' && value.length < 240 && value.split('/').every(p => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p) && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p));
}
export function assertSchema(value, type) {
  const check = type === 'pack' ? packCheck : inputCheck;
  if (!check(value)) {
    const e = Object.assign(new Error(`Invalid skin ${type}.`), { code: 'skin.schema', issues: structuredClone(check.errors) }); throw e;
  }
}
export function assertMetadata(meta, width, height, stretch) {
  const s = meta.nineSlice, m = meta.minSize, c = meta.contentInsets;
  try { skinUsage(meta, width, height).measure(m.width, m.height); }
  catch (error) { fail(error.code === 'slice.minimum' ? 'skin.minimum' : 'skin.slice', error.message); }
  if (m.width < Math.max(s.left+s.right, c.left+c.right+1) || m.height < Math.max(s.top+s.bottom, c.top+c.bottom+1)) fail('skin.minimum', 'Minimum dimensions cannot contain slices/content.');
  if (stretch === 'uniform' && Object.values(s).some(n => n !== 0)) fail('skin.slice', 'Uniform assets cannot declare nine-slice edges.');
}
export function validatePack(pack, expected = {}) {
  assertSchema(pack, 'pack');
  for (const [k, v] of Object.entries(expected)) if (pack.bindings[k] !== v) fail('skin.binding', `Pack ${k} differs from consumer.`);
  const ids = new Set(), roles = new Set(), files = new Set(), sheets = new Set();
  for (const file of [...pack.assets, ...pack.fonts, ...pack.licenses, ...pack.sources]) {
    if (!safePath(file.file) || files.has(file.file.toLowerCase())) fail('skin.path', 'Unsafe or duplicate package file.');
    files.add(file.file.toLowerCase());
  }
  for (const s of pack.sources) {
    if (sheets.has(s.sheetId) || s.width !== s.height || s.width % pack.scale) fail('skin.source', 'Source sheets must be unique square images at the declared scale.');
    sheets.add(s.sheetId);
  }
  for (const a of pack.assets) {
    if (ids.has(a.assetId)) fail('skin.identity', 'Duplicate asset ID.'); ids.add(a.assetId);
    assertMetadata(a, a.width/pack.scale, a.height/pack.scale, a.stretch);
    const source = pack.sources.find(s => s.sheetId === a.sheetId);
    if (!source) fail('skin.source', 'Missing source sheet.');
    if (a.width !== a.crop[2] || a.height !== a.crop[3]) fail('skin.crop', 'Crop size differs from PNG.');
    if (a.crop[0]+a.width > source.width || a.crop[1]+a.height > source.height || a.crop.some(n=>n%pack.scale)) fail('skin.crop','Crop exceeds source or is not aligned to logical pixels.');
    for (const b of pack.assets) {
      if (b === a) break;
      if (a.sheetId===b.sheetId && a.crop[0]<b.crop[0]+b.width && b.crop[0]<a.crop[0]+a.width && a.crop[1]<b.crop[1]+b.height && b.crop[1]<a.crop[1]+a.height) fail('skin.crop','Asset crops overlap.');
    }
  }
  for (const b of pack.roles) {
    if (roles.has(b.role) || !ids.has(b.assetId)) fail('skin.role', 'Duplicate role or missing asset.'); roles.add(b.role);
  }
  const materialIds=new Set(),materialPaths=new Map();
  for(const a of pack.materialAssets??[]){
    validateMaterialAsset(a);
    if(ids.has(a.assetId)||materialIds.has(a.assetId)||!a.file.startsWith('materials/')||!a.source.file.startsWith('material-sources/'))fail('skin.material','Duplicate material or invalid resource directory.');
    materialIds.add(a.assetId);
  }
  for(const f of materialFiles(pack)){
    const key=f.file?.toLowerCase();
    if(!safePath(f.file)||files.has(key))fail('skin.path','Unsafe or conflicting material file.');
    // Multiple crops can share one exact source image; crop belongs to the
    // material record, not the source file's identity.
    const identity=JSON.stringify({file:f.file,sha256:f.sha256,bytes:f.bytes,width:f.width,height:f.height});
    if(materialPaths.has(key)&&materialPaths.get(key)!==identity)fail('skin.path','Conflicting material source.');
    materialPaths.set(key,identity);
  }
  validateSurfaceStyles(pack.surfaceStyles,[...ids,...materialIds],[...roles]);
  for(const key of Object.keys(pack.surfaceStyles??{}))surfaceStyleInfo(pack,key);
  if (!pack.fonts.some(f => f.family === pack.theme.fontFamily && f.weight === 400 && f.style === 'normal')) fail('skin.font', 'The body font must be explicitly bundled.');
  if (!pack.licenses.length) fail('skin.font', 'Font license resource is required.');
  if (pack.fonts.some(f=>f.family!==pack.theme.fontFamily)) fail('skin.font','Version 0.1 supports one explicit body family, with multiple unicode subsets.');
  if(pack.theme.textColors){const expected=textRoles(pack).map(r=>r.role);if(Object.keys(pack.theme.textColors).length!==expected.length||expected.some(r=>!pack.theme.textColors[r]))fail('skin.text-colors','Text colors must cover exactly the declared text-bearing surfaces.');}
  return pack;
}
