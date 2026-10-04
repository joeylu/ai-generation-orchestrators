/** Optional Codex output shape. Public runtime validation remains authoritative. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot } from './io.mjs';

// Keep references (including recursive layout nodes) local. Shape constraints
// come from the existing public schemas; conditional/range/source checks still
// run in the public validators, never in a model-produced success claim.
export async function buildCodexEditResponseSchema({ draft = false } = {}) {
  const files = [...(draft ? ['codex-edit-draft.schema.json'] : []), 'panel-edit-proposal.schema.json', 'panel-patch.schema.json',
    'panel-spec.schema.json', 'panel-spec-v0.2.schema.json',
    'panel-spec-v0.3.schema.json', 'panel-spec-v0.4.schema.json', 'panel-spec-v0.5.schema.json'];
  const documents = await Promise.all(files.map(async file => JSON.parse(await readFile(join(harnessRoot, 'schemas', file), 'utf8'))));
  const registry = new Map(documents.map(document => [document.$id, document]));
  const definitions = {}, references = new Map();
  function convert(schema, owner) {
    if (schema.$ref) {
      const [id, fragment = ''] = schema.$ref.split('#');
      const document = id ? registry.get(id) : owner;
      if (!document || (fragment && !fragment.startsWith('/'))) throw new Error('CODEX_EDIT_SCHEMA_INVALID');
      const key = `${document.$id}#${fragment}`;
      if (!references.has(key)) {
        const name = `d${references.size}`;
        references.set(key, name); // Register before following recursive refs.
        let target = document;
        for (const part of fragment.split('/').slice(1)) target = target?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
        if (!target || typeof target !== 'object') throw new Error('CODEX_EDIT_SCHEMA_INVALID');
        definitions[name] = convert(target, document);
      }
      return { $ref: `#/$defs/${references.get(key)}` };
    }
    if (schema.oneOf || schema.anyOf) {
      return { anyOf: (schema.oneOf ?? schema.anyOf).map(branch => convert(branch, owner)) };
    }
    if (Object.hasOwn(schema, 'const')) {
      return { type: schema.const === null ? 'null' : typeof schema.const, enum: [schema.const] };
    }
    if (schema.enum) {
      const types = [...new Set(schema.enum.map(value => value === null ? 'null' : typeof value))];
      return { type: types.length === 1 ? types[0] : types, enum: [...schema.enum] };
    }
    if (schema.type === 'object') {
      const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, convert(value, owner)]));
      if (schema.additionalProperties !== false || Object.keys(properties).some(key => !schema.required?.includes(key))) {
        throw new Error('CODEX_EDIT_SCHEMA_INVALID');
      }
      return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
    }
    if (schema.type === 'array') return { type: 'array', items: convert(schema.items, owner) };
    if (schema.type) return { type: schema.type };
    // TextRow composes its public text type with an additional line-separator
    // restriction. Preserve the type reference; runtime enforces the patterns.
    if (schema.allOf) {
      const shapes = schema.allOf.filter(branch => ['$ref', 'type', 'oneOf', 'anyOf', 'const', 'enum'].some(key => Object.hasOwn(branch, key)));
      if (shapes.length === 1 && schema.allOf.every(branch => branch === shapes[0] || Object.keys(branch).every(key => key === 'pattern'))) {
        return convert(shapes[0], owner);
      }
    }
    throw new Error('CODEX_EDIT_SCHEMA_INVALID');
  }
  return { ...convert(documents[0], documents[0]), $defs: definitions };
}
