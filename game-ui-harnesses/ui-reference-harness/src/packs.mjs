import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonical, exact, isDigest, isId, jsonBytes, local, readBytes, readJson, requireThat, sha256, textValue } from './common.mjs';
import { decodePng } from './png.mjs';

export const BUILTIN_IDS = ['concept-art', 'pixel-cartoon', 'anime-cel', 'western-cartoon', 'fantasy-handpainted', 'chinese-fantasy'];
export const RENDER_FIELDS = ['visual_identity', 'line', 'shape_language', 'color', 'material', 'lighting', 'texture', 'render_finish'];
export const UI_FIELDS = ['frame', 'controls', 'icons', 'typography', 'decoration', 'background'];
export const PALETTE_FIELDS = ['background', 'surface', 'primary', 'secondary', 'text'];
export function validatePalette(palette) {
  if (palette === null) return;
  exact(palette, PALETTE_FIELDS);
  requireThat(Object.values(palette).every(v => typeof v === 'string' && /^#[a-fA-F0-9]{6}$/.test(v)), 'PALETTE_INVALID');
}
function identity(value) {
  exact(value, ['id', 'version']);
  requireThat(isId(value.id) && typeof value.version === 'string' && !/\s/.test(value.version)
    && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.version), 'PACK_IDENTITY');
}
export function validatePack(pack) {
  exact(pack, ['kind', 'metadata'], ['base_style', 'render_style', 'ui_rules', 'palette', 'negative_rules', 'references', 'origin']);
  requireThat(pack.kind === 'ui_reference_style_pack_v1', 'PACK_KIND');
  exact(pack.metadata, ['id', 'name', 'version']); identity({ id: pack.metadata.id, version: pack.metadata.version });
  textValue(pack.metadata.name, 120);
  if (pack.base_style !== undefined) { identity(pack.base_style); requireThat(BUILTIN_IDS.includes(pack.base_style.id), 'PACK_BASE_UNKNOWN'); }
  const partial = !!pack.base_style;
  for (const [key, fields] of [['render_style', RENDER_FIELDS], ['ui_rules', UI_FIELDS]]) {
    if (!partial || pack[key] !== undefined) {
      exact(pack[key], partial ? [] : fields, partial ? fields : []);
      for (const value of Object.values(pack[key])) textValue(value, 2000);
    }
  }
  if (pack.palette !== undefined) validatePalette(pack.palette);
  if (pack.negative_rules !== undefined) {
    requireThat(Array.isArray(pack.negative_rules) && pack.negative_rules.length <= 40, 'PACK_NEGATIVES');
    pack.negative_rules.forEach(v => textValue(v, 1000));
  }
  if (pack.references !== undefined) {
    exact(pack.references, ['primary']); textValue(pack.references.primary, 200);
    const name = pack.references.primary;
    requireThat(!/[^\x21-\x7e]/.test(name) && /^[A-Za-z0-9._/-]+\.png$/.test(name) && name.split('/').every(p => p && p !== '.' && p !== '..'
      && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)), 'PACK_REFERENCE_PATH');
  }
  if (pack.origin !== undefined) {
    exact(pack.origin, ['id', 'version', 'sha256']); identity({ id: pack.origin.id, version: pack.origin.version });
    requireThat(isDigest(pack.origin.sha256), 'PACK_ORIGIN');
  }
  return pack;
}
export function builtinPack(id) {
  requireThat(BUILTIN_IDS.includes(id), 'PRESET_UNKNOWN');
  return validatePack(readJson(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url))));
}
export function resolvePack(pack, base = null) {
  validatePack(pack);
  requireThat(!!pack.base_style === !!base, 'PACK_BASE_REQUIRED');
  if (base) {
    validatePack(base);
    requireThat(!base.base_style && !base.references && base.metadata.id === pack.base_style.id
      && base.metadata.version === pack.base_style.version, 'PACK_BASE_MISMATCH');
    // A custom base is a byte-snapshotted built-in document, never another file to execute.
    requireThat(canonical(base) === canonical(builtinPack(base.metadata.id)), 'PACK_BASE_MISMATCH');
  }
  const negatives = [...new Set([...(base?.negative_rules ?? []), ...(pack.negative_rules ?? [])])];
  requireThat(negatives.length <= 40, 'PACK_NEGATIVES');
  return { kind: 'ui_reference_resolved_pack_v1', metadata: pack.metadata, base_style: pack.base_style ?? null,
    origin: pack.origin ?? base?.origin ?? null,
    render_style: { ...base?.render_style, ...pack.render_style }, ui_rules: { ...base?.ui_rules, ...pack.ui_rules },
    palette: pack.palette !== undefined ? pack.palette : base?.palette ?? null,
    negative_rules: negatives };
}
export function applyProjectRules(resolved, rules) {
  const pack = structuredClone(resolved);
  if (!rules) return pack;
  pack.palette = rules.palette;
  Object.assign(pack.render_style, { material: rules.material, shape_language: rules.shape, lighting: rules.lighting });
  Object.assign(pack.ui_rules, { typography: rules.typography, icons: rules.icons, decoration: rules.decoration });
  return pack;
}
export const packRules = pack => ({ palette: pack.palette, material: pack.render_style.material,
  shape: pack.render_style.shape_language, typography: pack.ui_rules.typography, icons: pack.ui_rules.icons,
  decoration: pack.ui_rules.decoration, lighting: pack.render_style.lighting });
export const catalogList = () => BUILTIN_IDS.map(id => {
  const pack = builtinPack(id);
  return { id, name: pack.metadata.name, version: pack.metadata.version, rules: packRules(resolvePack(pack)),
    sample: { status: 'not_generated', image: null }, origin: pack.origin };
});
export function checkPack(file) {
  const bytes = readBytes(file, 256 * 1024);
  let input; try { input = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('PACK_JSON_INVALID'); }
  validatePack(input);
  const base = input.base_style ? builtinPack(input.base_style.id) : null, resolved = resolvePack(input, base);
  let primarySha256 = null;
  if (input.references) {
    const image = readBytes(local(path.dirname(path.resolve(file)), input.references.primary));
    decodePng(image); primarySha256 = sha256(image);
  }
  return { status: 'valid', packSha256: sha256(bytes), baseSha256: base ? sha256(jsonBytes(base)) : null,
    primarySha256, resolved, computeCalls: 0 };
}
