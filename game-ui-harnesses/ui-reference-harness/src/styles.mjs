import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, digestJson, exact, isDigest, local, readBytes, readJson, requireThat, seal, sha256, storeBlob, textValue, unseal, verifyBlob, writeJsonNew, jsonBytes } from './common.mjs';
import { canvas, decodePng, encodePng, rectangle } from './png.mjs';
import { BUILTIN_IDS, applyProjectRules, builtinPack, catalogList, packRules, resolvePack } from './packs.mjs';
import { readSampleCatalog } from './sample-catalog.mjs';

const PRESETS = ['casual-clean', 'painted-fantasy', 'neon-tech'];
export function presetList({ sampleCatalog = null } = {}) {
  const presets = catalogList();
  if (!sampleCatalog) return presets;
  const { catalog } = readSampleCatalog(sampleCatalog);
  return presets.map((preset, index) => ({ ...preset, sample: { status: 'accepted', image: catalog.entries[index].image,
    catalogSha256: catalog.sha256, sourceStyleSha256: catalog.entries[index].styleSha256 } }));
}
const legacyPreset = id => PRESETS.includes(id) ? readJson(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url))) : null;
export function validateRules(rules) {
  exact(rules, ['palette', 'material', 'shape', 'typography', 'icons', 'decoration', 'lighting']);
  if (rules.palette !== null) {
    exact(rules.palette, ['background', 'surface', 'primary', 'secondary', 'text']);
    requireThat(Object.values(rules.palette).every(value => typeof value === 'string' && value.length === 7 && /^#[A-Fa-f0-9]{6}$/.test(value)), 'PALETTE_INVALID');
  }
  for (const field of ['material', 'shape', 'typography', 'icons', 'decoration', 'lighting']) textValue(rules[field], 2000);
  return rules;
}
const referenceRules = () => ({ palette: null, ...Object.fromEntries(
  ['material', 'shape', 'typography', 'icons', 'decoration', 'lighting'].map(key => [key, `Follow the approved primary style reference for ${key}.`])) });
export function presetBoard(rules) {
  const p = rules.palette, image = canvas(640, 400, p.background);
  rectangle(image, [32, 24, 576, 352], p.surface, p.secondary);
  rectangle(image, [60, 50, 520, 34], p.primary, p.primary);
  for (let i = 0; i < 3; i++) rectangle(image, [60 + i * 178, 108, 164, 118], p.background, p.secondary);
  rectangle(image, [60, 252, 320, 18], p.background, p.secondary);
  rectangle(image, [60, 252, 210, 18], p.primary, p.primary);
  rectangle(image, [60, 300, 240, 46], p.primary, p.primary);
  rectangle(image, [324, 300, 256, 46], p.surface, p.secondary);
  return encodePng(image);
}
export function createStyle(root, { preset = null, pack = null, reference = null, sampleCatalog = null, rules = null, notes = '' } = {}) {
  requireThat(!(preset && pack), 'STYLE_PACK_PRESET_CONFLICT');
  requireThat(!sampleCatalog || (BUILTIN_IDS.includes(preset) && !pack && !reference), 'STYLE_SAMPLE_SOURCE_CONFLICT');
  const referenceBytes = sampleCatalog ? readSampleCatalog(sampleCatalog).images.get(preset) : null;
  if (pack || BUILTIN_IDS.includes(preset)) return createPackStyle(root, { preset, pack, reference, referenceBytes, rules, notes });
  requireThat(preset || reference, 'STYLE_SOURCE_REQUIRED'); textValue(notes, 8000, true);
  const selected = preset ? legacyPreset(preset) : null;
  requireThat(!preset || selected, 'PRESET_UNKNOWN');
  const resolved = validateRules(rules ?? selected?.rules ?? referenceRules());
  const references = [];
  if (reference) { const bytes = readBytes(reference); decodePng(bytes); references.push({ role: 'primary-style', artifact: storeBlob(root, bytes, 'png') }); }
  if (selected) references.push({ role: reference ? 'preset-palette-guide' : 'primary-style', artifact: storeBlob(root, presetBoard(selected.rules), 'png') });
  const style = seal({ kind: 'ui_reference_style_v1',
    source: { kind: preset && reference ? 'preset-reference' : preset ? 'preset' : 'reference', preset: selected ? { id: selected.id, version: selected.version } : null },
    rules: resolved, notes, references,
    precedence: 'approved-rules-then-primary-style-then-preset-guide',
    sampleDisclosure: selected ? 'Preset board is a deterministic palette/layout guide, not a generated art sample.' : null });
  const relative = `styles/${style.sha256}.json`;
  if (fs.existsSync(local(root, relative))) requireThat(canonical(readJson(local(root, relative))) === canonical(style), 'STYLE_TAMPERED');
  else writeJsonNew(root, relative, style);
  return style;
}
export function validateStyleDocument(style) {
  if (style.kind === 'ui_reference_style_v2') return validatePackStyle(style);
  unseal(style);
  exact(style, ['kind', 'source', 'rules', 'notes', 'references', 'precedence', 'sampleDisclosure', 'sha256']);
  exact(style.source, ['kind', 'preset']);
  requireThat(style.kind === 'ui_reference_style_v1' && ['preset', 'reference', 'preset-reference'].includes(style.source.kind)
    && Array.isArray(style.references) && style.references.length >= 1 && style.references.length <= 2
    && style.precedence === 'approved-rules-then-primary-style-then-preset-guide', 'STYLE_CONTRACT');
  if (style.source.preset) { exact(style.source.preset, ['id', 'version']); requireThat(PRESETS.includes(style.source.preset.id) && style.source.preset.version === '1.0.0', 'STYLE_PRESET'); }
  requireThat((style.source.kind === 'reference') === (style.source.preset === null), 'STYLE_SOURCE');
  textValue(style.notes, 8000, true); validateRules(style.rules);
  requireThat(style.sampleDisclosure === null || typeof style.sampleDisclosure === 'string', 'STYLE_DISCLOSURE');
  requireThat(style.references[0].role === 'primary-style'
    && (style.references.length === 1 || style.references[1].role === 'preset-palette-guide'), 'STYLE_REFERENCE_ROLES');
  for (const item of style.references) {
    exact(item, ['role', 'artifact']); exact(item.artifact, ['path', 'sha256', 'bytes']);
    requireThat(isDigest(item.artifact.sha256) && item.artifact.path === `blobs/${item.artifact.sha256}.png`
      && Number.isSafeInteger(item.artifact.bytes) && item.artifact.bytes > 0, 'STYLE_REFERENCE_ARTIFACT');
  }
  return style;
}
// New compute requires the exact primary PNG of the confirmed style revision.
// Historical rule-only styles remain readable; never manufacture a replacement.
export function primaryStyleReference(root, styleSha256) {
  const style = loadStyle(root, styleSha256);
  const references = style.references.filter(item => item.role === 'primary-style');
  requireThat(references.length === 1, 'STYLE_PRIMARY_REFERENCE_REQUIRED');
  decodePng(verifyBlob(root, references[0].artifact));
  return references[0].artifact;
}
export function loadStyle(root, digest) {
  requireThat(isDigest(digest), 'STYLE_DIGEST');
  const style = validateStyleDocument(readJson(local(root, `styles/${digest}.json`)));
  requireThat(style.sha256 === digest, 'STYLE_DIGEST');
  for (const item of style.references) { exact(item, ['role', 'artifact']); decodePng(verifyBlob(root, item.artifact)); }
  verifyStyleSources(style, artifact => verifyBlob(root, artifact));
  return style;
}
export function styleArtifact(root, style) { return storeBlob(root, jsonBytes(style), 'json'); }

function createPackStyle(root, { preset, pack: file, reference, referenceBytes, rules, notes }) {
  textValue(notes, 8000, true);
  if (rules) validateRules(rules);
  const bytes = file ? readBytes(file, 256 * 1024) : jsonBytes(builtinPack(preset));
  let input; try { input = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('PACK_JSON_INVALID'); }
  const base = input.base_style ? builtinPack(input.base_style.id) : null;
  const resolved = applyProjectRules(resolvePack(input, base), rules);
  requireThat(!preset || canonical(input) === canonical(builtinPack(preset)), 'STYLE_BUILTIN_MISMATCH');
  requireThat(!(reference && input.references), 'STYLE_REFERENCE_CONFLICT');
  const imagePath = reference ?? (input.references ? local(path.dirname(path.resolve(file)), input.references.primary) : null);
  const references = [];
  if (imagePath || referenceBytes) {
    const image = referenceBytes ?? readBytes(imagePath); decodePng(image);
    references.push({ role: 'primary-style', artifact: storeBlob(root, image, 'png') });
  }
  const style = seal({ kind: 'ui_reference_style_v2', source: { kind: preset ? 'builtin' : 'custom',
    pack: storeBlob(root, bytes, 'json'), basePack: base ? storeBlob(root, jsonBytes(base), 'json') : null },
    pack: resolved, overrides: rules, rules: packRules(resolved), notes, references,
    precedence: 'approved-project-rules-then-pack-then-primary-reference',
    sampleDisclosure: references.length ? 'Primary style PNG is frozen with these UI rules; visual conformity requires human review.'
      : 'Rules are UI adaptations; no generated art sample is attached. Visual conformity requires human review.' });
  validateStyleDocument(style); verifyStyleSources(style, artifact => verifyBlob(root, artifact));
  const relative = `styles/${style.sha256}.json`;
  if (fs.existsSync(local(root, relative))) requireThat(canonical(readJson(local(root, relative))) === canonical(style), 'STYLE_TAMPERED');
  else writeJsonNew(root, relative, style);
  return style;
}
function validatePackStyle(style) {
  unseal(style);
  exact(style, ['kind', 'source', 'pack', 'overrides', 'rules', 'notes', 'references', 'precedence', 'sampleDisclosure', 'sha256']);
  exact(style.source, ['kind', 'pack', 'basePack']);
  requireThat(['builtin', 'custom'].includes(style.source.kind) && style.precedence === 'approved-project-rules-then-pack-then-primary-reference', 'STYLE_CONTRACT');
  textValue(style.notes, 8000, true); textValue(style.sampleDisclosure, 1000);
  validateRules(style.rules); if (style.overrides !== null) validateRules(style.overrides);
  exact(style.pack, ['kind', 'metadata', 'base_style', 'origin', 'render_style', 'ui_rules', 'palette', 'negative_rules']);
  requireThat(style.pack.kind === 'ui_reference_resolved_pack_v1' && canonical(style.rules) === canonical(packRules(style.pack)), 'STYLE_PACK_MISMATCH');
  const { kind, base_style, origin, ...resolved } = style.pack;
  // Validate resolved field sets independently of the source file.
  resolvePack({ ...resolved, kind: 'ui_reference_style_pack_v1', ...(origin ? { origin } : {}) });
  requireThat(Array.isArray(style.references) && style.references.length <= 1, 'STYLE_REFERENCE_ROLES');
  for (const item of style.references) {
    exact(item, ['role', 'artifact']); requireThat(item.role === 'primary-style', 'STYLE_REFERENCE_ROLES');
    validateArtifact(item.artifact, 'png');
  }
  validateArtifact(style.source.pack, 'json');
  if (style.source.basePack !== null) validateArtifact(style.source.basePack, 'json');
  return style;
}
function validateArtifact(artifact, extension) {
  exact(artifact, ['path', 'sha256', 'bytes']);
  requireThat(isDigest(artifact.sha256) && artifact.path === `blobs/${artifact.sha256}.${extension}`
    && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, 'STYLE_ARTIFACT');
}
export function styleArtifacts(style) {
  return [...style.references.map(item => item.artifact), ...(style.kind === 'ui_reference_style_v2'
    ? [style.source.pack, ...(style.source.basePack ? [style.source.basePack] : [])] : [])];
}
export function verifyStyleSources(style, readArtifact) {
  if (style.kind !== 'ui_reference_style_v2') return;
  const readPack = artifact => {
    const bytes = readArtifact(artifact);
    requireThat(bytes && bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256 && bytes.length <= 256 * 1024, 'STYLE_SOURCE_MISMATCH');
    try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error('PACK_JSON_INVALID'); }
  };
  const input = readPack(style.source.pack), base = style.source.basePack ? readPack(style.source.basePack) : null;
  if (style.source.kind === 'builtin') requireThat(!base && canonical(input) === canonical(builtinPack(input.metadata?.id)), 'STYLE_BUILTIN_MISMATCH');
  requireThat(canonical(applyProjectRules(resolvePack(input, base), style.overrides)) === canonical(style.pack), 'STYLE_PACK_MISMATCH');
  requireThat(!input.references || style.references.length === 1, 'STYLE_REFERENCE_MISSING');
}
