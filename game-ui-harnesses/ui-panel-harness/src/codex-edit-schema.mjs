/** Optional Codex output shape. Public runtime validation remains authoritative. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot } from './io.mjs';
import { buildCodexQuestionsResponseSchema } from './codex-questions-schema.mjs';

// Keep references (including recursive layout nodes) local. Shape constraints
// come from the existing public schemas; conditional/range/source checks still
// run in the public validators, never in a model-produced success claim.
export async function buildCodexEditResponseSchema({ draft = false, context } = {}) {
  const forms = draft && ['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(context?.spec?.panelSpecVersion);
  const files = [...(draft ? ['codex-edit-draft-v0.3.schema.json', 'codex-edit-draft-v0.2.schema.json', 'codex-edit-draft.schema.json'] : []), 'panel-edit-proposal.schema.json', 'panel-patch.schema.json',
    'panel-spec.schema.json', 'panel-spec-v0.2.schema.json',
    'panel-spec-v0.3.schema.json', 'panel-spec-v0.4.schema.json', 'panel-spec-v0.5.schema.json', 'panel-spec-v0.6.schema.json', 'panel-spec-v0.7.schema.json', 'panel-spec-v0.8.schema.json', 'panel-spec-v0.9.schema.json', 'panel-spec-v0.10.schema.json', 'panel-spec-v0.11.schema.json', 'panel-spec-v0.12.schema.json', 'panel-spec-v0.13.schema.json', 'panel-spec-v0.14.schema.json'];
  const documents = await Promise.all(files.map(async file => JSON.parse(await readFile(join(harnessRoot, 'schemas', file), 'utf8'))));
  const appearance = context?.capabilities?.operations.includes('set-appearance') === true;
  const patchDocument = documents.find(document => document.$id === 'urn:ai-game-assets:panel-patch:0.1');
  // Saved contexts retain the old text contract; only v0.8 advertises multiline text.
  const textWrap = context?.capabilities?.textWrapPolicy === 'static-text-wrap-v1';
  patchDocument.$defs.setText.properties.text = { $ref: textWrap
    ? 'urn:ai-game-assets:panel-spec:0.13#/$defs/textRow/properties/text'
    : 'urn:ai-game-assets:panel-spec:0.4#/$defs/text' };
  for (const document of [patchDocument, ...documents.filter(d => d.$id === 'urn:ai-game-assets:codex-edit-draft:0.2')]) {
    const rows = document.$defs.addRow.properties.row.oneOf;
    for (const branch of rows) if (branch.$ref?.endsWith('#/$defs/textRow')) {
      branch.$ref = textWrap ? 'urn:ai-game-assets:panel-spec:0.13#/$defs/textRow' : 'urn:ai-game-assets:panel-spec:0.4#/$defs/textRow';
    }
  }
  if (!appearance) patchDocument.properties.operations.items.oneOf = patchDocument.properties.operations.items.oneOf.filter(branch => branch.$ref !== '#/$defs/setAppearance');
  if (appearance && forms) documents.find(document => document.$id === 'urn:ai-game-assets:codex-edit-draft:0.2')
    .$defs.patch.properties.operations.items.oneOf.push({ $ref: 'urn:ai-game-assets:panel-patch:0.1#/$defs/setAppearance' });
  const actionLayout = context?.capabilities?.operations.includes('set-action-layout') === true;
  if (!actionLayout) patchDocument.properties.operations.items.oneOf = patchDocument.properties.operations.items.oneOf.filter(branch => branch.$ref !== '#/$defs/setActionLayout');
  if (actionLayout && forms) documents.find(document => document.$id === 'urn:ai-game-assets:codex-edit-draft:0.2')
    .$defs.patch.properties.operations.items.oneOf.push({ $ref: 'urn:ai-game-assets:panel-patch:0.1#/$defs/setActionLayout' });
  for (const [op, name] of [['set-row-order','setRowOrder'],['set-text','setText'],['set-button-style','setButtonStyle'],['set-button-font-size','setButtonFontSize'],['set-title-bar','setTitleBar'],['set-text-wrap','setTextWrap'],['set-panel-frame','setPanelFrame'],['set-panel-ratio','setPanelRatio'],['set-layout-details','setLayoutDetails']]) {
    const allowed = context?.capabilities?.operations.includes(op) === true;
    if (!allowed) patchDocument.properties.operations.items.oneOf = patchDocument.properties.operations.items.oneOf.filter(branch => branch.$ref !== '#/$defs/' + name);
    if (allowed && forms) documents.find(document => document.$id === 'urn:ai-game-assets:codex-edit-draft:0.2').$defs.patch.properties.operations.items.oneOf.push({$ref:'urn:ai-game-assets:panel-patch:0.1#/$defs/' + name});
  }
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
    if (schema.type === 'array') return { type: 'array', items: convert(schema.items, owner),
      ...(schema.minItems === undefined ? {} : { minItems: schema.minItems }),
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }) };
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
  if (draft && !forms) {
    documents[0].properties.patch = { $ref: 'urn:ai-game-assets:codex-edit-draft:0.1#/properties/patch' };
  }
  const result = { ...convert(documents[0], documents[0]), $defs: definitions };
  result.properties.unresolved = buildCodexQuestionsResponseSchema();
  if (context) {
    // Bind the actual invocation, including a null-patch clarification/no-change.
    // Public validators still reject stale or forged responses independently.
    result.properties.contextSha256 = { type: 'string', enum: [context.sha256] };
    const follow = shape => shape.$ref ? follow(definitions[shape.$ref.slice('#/$defs/'.length)]) : shape;
    const patch = follow(result.properties.patch);
    const nonNullPatch = follow(patch.anyOf ? patch.anyOf.find(shape => shape.type !== 'null') : patch);
    nonNullPatch.properties.baseSpecSha256 = { type: 'string', enum: [context.baseSpecSha256] };
    if (context.selection) {
      const allowed = new Set(context.capabilities.operations);
      const items = follow(nonNullPatch.properties.operations.items);
      items.anyOf = items.anyOf.filter(branch => allowed.has(follow(branch).properties.op.enum[0]));
      const row = context.spec.sections.flatMap(section => section.rows).find(row => row.id === context.selection.rowId);
      for (const branch of items.anyOf) {
        const shape = follow(branch);
        if (shape.properties.rowId) shape.properties.rowId = { type: 'string', enum: [row.id] };
        if (shape.properties.fieldId) shape.properties.fieldId = { type: 'string', enum: [row.bind] };
      }
    }
    if (context.capabilities?.themePolicy === 'explicit-change-v1') {
      const shape = Object.values(definitions).find(shape => shape.properties?.op?.enum?.[0] === 'set-theme');
      if (shape) shape.properties.theme = { anyOf: context.catalog.themes.map(theme => ({
        type: 'object', additionalProperties: false, required: ['id', 'version'], properties: {
          id: { type: 'string', enum: [theme.id] }, version: { type: 'string', enum: [theme.version] },
        },
      })) };
    }
  }
  if (forms) {
    const shape = Object.values(definitions).find(shape => shape.properties?.op?.enum?.[0] === 'add-input-row');
    const keys = context.catalog.recipes.filter(recipe => recipe.kind === 'input-row' && recipe.supports.includes('pixi'))
      .map(recipe => `${recipe.id}@${recipe.version}`);
    if (shape && keys.length) shape.properties.recipeKey = { type: 'string', enum: keys };
  }
  return result;
}

/** Describe reachable native operations using the very schema sent to the CLI. */
export function codexEditOperationContracts(schema, context) {
  const follow = shape => {
    if (!shape || typeof shape !== 'object') throw new Error('CODEX_EDIT_SCHEMA_INVALID');
    if (!shape.$ref) return shape;
    const prefix = '#/$defs/';
    if (!shape.$ref.startsWith(prefix)) throw new Error('CODEX_EDIT_SCHEMA_INVALID');
    return follow(schema.$defs[shape.$ref.slice(prefix.length)]);
  };
  const patch = follow(follow(schema.properties.patch).anyOf.find(shape => shape.type !== 'null'));
  const allowed = new Set(context.capabilities.operations);
  return follow(patch.properties.operations.items).anyOf.map(follow).flatMap(shape => {
    const operation = shape.properties.op.enum[0];
    const publicOperation = operation === 'add-input-row' ? 'add-row' : operation;
    return allowed.has(publicOperation) ? [{ operation, publicOperation, required: [...shape.required] }] : [];
  });
}
