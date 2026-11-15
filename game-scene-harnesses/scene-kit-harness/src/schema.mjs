import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCHEMA_FILES = Object.freeze({
  ai_scene_kit_v1: 'kit.schema.json',
  ai_scene_kit_v2: 'kit-v2.schema.json',
  ai_scene_kit_v3: 'kit-v3.schema.json',
  ai_scene_kit_v4: 'kit-v4.schema.json',
  ai_scene_shared_terrain_field_v1:'shared-terrain-field.schema.json',
  ai_scene_shared_terrain_field_v2:'shared-terrain-field.schema.json',
  ai_scene_terrain_material_loop_v1:'terrain-material-loop.schema.json',
  ai_scene_terrain_surface_cycle_v1:'terrain-surface-cycle.schema.json',
  ai_scene_terrain_surface_span_envelope_v1:'terrain-surface-span-envelope.schema.json',
  ai_scene_terrain_step_surface_v1:'terrain-step-surface.schema.json',
  ai_scene_terrain_step_surface_v2:'terrain-step-surface.schema.json',
  ai_scene_terrain_rigid_repeat_v1:'terrain-rigid-repeat.schema.json',
  ai_scene_terrain_bottom_edges_v1:'terrain-bottom-edges.schema.json',
  ai_scene_terrain_bottom_edges_v2:'terrain-bottom-edges-v2.schema.json',
  ai_scene_background_band_v1:'background-band.schema.json',
  ai_scene_background_band_v2:'background-band-v2.schema.json',
  ai_scene_background_band_v3:'background-band-v3.schema.json',
  ai_scene_background_band_v4:'background-band-v4.schema.json',
  ai_scene_source_appearance_v1:'source-appearance.schema.json',
  ai_scene_background_band_placement_v1:'background-band-placement.schema.json',
  ai_scene_module_catalog_v1: 'module-catalog.schema.json',
  ai_scene_module_catalog_v2: 'module-catalog-v2.schema.json',
  ai_scene_module_catalog_v3: 'module-catalog-v3.schema.json',
  ai_scene_module_catalog_v4: 'module-catalog-v4.schema.json',
  ai_scene_terrain_rules_v1: 'terrain-rules.schema.json',
  ai_scene_assembly_presets_v1: 'presets.schema.json',
  ai_scene_document_v1: 'scene-document.schema.json',
  ai_scene_document_v2: 'scene-document-v2.schema.json',
  ai_scene_document_v3: 'scene-document-v3.schema.json',
  ai_scene_document_v4: 'scene-document-v4.schema.json',
  ai_scene_document_v5: 'scene-document-v5.schema.json',
  ai_scene_document_v6: 'scene-document-v6.schema.json',
  ai_scene_export_v1: 'scene-export.schema.json',
  ai_scene_spec_v1: 'scene-spec.schema.json',
  ai_scene_spec_v2: 'scene-spec-v2.schema.json',
  ai_scene_spec_v3: 'scene-spec-v3.schema.json',
  ai_scene_reference_requirements_v1: 'reference-requirements.schema.json',
  ai_scene_style_v1: 'scene-style.schema.json',
  ai_scene_style_v2: 'scene-style-v2.schema.json',
  ai_scene_image_capabilities_v1: 'image-capabilities.schema.json',
});

const supported = new Set([
  '$schema', 'title', 'description', '$defs', '$ref', 'type', 'properties', 'required',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minimum',
  'maximum', 'const', 'enum', 'minLength', 'maxLength', 'pattern',
]);
const schemaNames = ['common.schema.json', 'generation-common.schema.json','terrain-bottom-edges-compatible.schema.json', ...Object.values(SCHEMA_FILES)];
const schemas = new Map(schemaNames.map(name => [name, JSON.parse(readFileSync(
  fileURLToPath(new URL(`../schemas/${name}`, import.meta.url)), 'utf8',
))]));

function checkSchema(schema) {
  for (const key of Object.keys(schema)) {
    if (!supported.has(key)) throw new Error(`Unsupported schema keyword: ${key}`);
  }
  for (const child of Object.values(schema.properties ?? {})) checkSchema(child);
  for (const child of Object.values(schema.$defs ?? {})) checkSchema(child);
  if (schema.items) checkSchema(schema.items);
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new Error('This contract validator only supports closed object schemas');
  }
}
for (const schema of schemas.values()) checkSchema(schema);

const pointerPart = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const canonical = value => JSON.stringify(value, (_key, entry) => {
  if (entry && !Array.isArray(entry) && typeof entry === 'object') {
    return Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]]));
  }
  return entry;
});

function resolveRef(reference, currentFile) {
  const [file, fragment = ''] = reference.split('#');
  const schemaFile = file || currentFile;
  if (!schemas.has(schemaFile) || (fragment && !fragment.startsWith('/'))) {
    throw new Error('Schema reference is outside the bundled schema registry');
  }
  let schema = schemas.get(schemaFile);
  for (const part of fragment.split('/').slice(1)) {
    schema = schema?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (!schema) throw new Error('Unresolved bundled schema reference');
  return [schema, schemaFile];
}

export function validateDocument(format, value) {
  const filename = Object.hasOwn(SCHEMA_FILES, format) ? SCHEMA_FILES[format] : undefined;
  if (!filename) return [{ code: 'FORMAT_UNSUPPORTED', path: '/format', message: 'Unsupported document format' }];
  const errors = [];
  const fail = (code, path, message) => {
    if (errors.length < 100) errors.push({ code, path: path || '/', message });
  };
  function visit(schema, data, path, file, depth = 0) {
    if (errors.length >= 100) return;
    if (depth > 64) throw new Error('Bundled schema recursion limit exceeded');
    if (schema.$ref) {
      const [target, targetFile] = resolveRef(schema.$ref, file);
      visit(target, data, path, targetFile, depth + 1);
    }
    if (schema.type) {
      const isObject = data !== null && typeof data === 'object' && !Array.isArray(data)
        && [Object.prototype, null].includes(Object.getPrototypeOf(data));
      const valid = {
        object: isObject, array: Array.isArray(data), string: typeof data === 'string',
        integer: Number.isSafeInteger(data), number: typeof data === 'number' && Number.isFinite(data),
        boolean: typeof data === 'boolean',
      }[schema.type];
      if (!valid) { fail('SCHEMA_TYPE', path, `Expected ${schema.type}`); return; }
    }
    if (Object.hasOwn(schema, 'const') && canonical(data) !== canonical(schema.const)) {
      fail('SCHEMA_CONST', path, 'Value differs from the required constant');
    }
    if (schema.enum && !schema.enum.some(item => canonical(item) === canonical(data))) {
      fail('SCHEMA_ENUM', path, 'Value is outside the allowed choices');
    }
    if (typeof data === 'string') {
      const length = [...data].length;
      if (schema.minLength !== undefined && length < schema.minLength) fail('SCHEMA_LENGTH', path, 'String is too short');
      if (schema.maxLength !== undefined && length > schema.maxLength) fail('SCHEMA_LENGTH', path, 'String is too long');
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(data)) fail('SCHEMA_PATTERN', path, 'String does not match the declared pattern');
    }
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) fail('SCHEMA_RANGE', path, 'Number is below minimum');
      if (schema.maximum !== undefined && data > schema.maximum) fail('SCHEMA_RANGE', path, 'Number is above maximum');
    }
    if (Array.isArray(data)) {
      if (schema.minItems !== undefined && data.length < schema.minItems) fail('SCHEMA_ITEMS', path, 'Array has too few items');
      if (schema.maxItems !== undefined && data.length > schema.maxItems) fail('SCHEMA_ITEMS', path, 'Array has too many items');
      if (schema.uniqueItems && new Set(data.map(canonical)).size !== data.length) fail('SCHEMA_UNIQUE', path, 'Array items must be unique');
      if (schema.items) data.forEach((item, index) => visit(schema.items, item, `${path}/${index}`, file, depth + 1));
    }
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(data, key)) fail('SCHEMA_REQUIRED', `${path}/${pointerPart(key)}`, 'Required property is missing');
      }
      for (const [key, entry] of Object.entries(data)) {
        if (Object.hasOwn(schema.properties ?? {}, key)) visit(schema.properties[key], entry, `${path}/${pointerPart(key)}`, file, depth + 1);
        else if (schema.additionalProperties === false) fail('SCHEMA_PROPERTY', `${path}/${pointerPart(key)}`, 'Unknown property');
      }
    }
  }
  visit(schemas.get(filename), value, '', filename);
  return errors;
}
