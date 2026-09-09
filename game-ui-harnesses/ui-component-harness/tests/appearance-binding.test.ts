import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { HarnessError } from '../src/contract.ts';
import { DecompositionImportError, importDecompositionZip, type ImportedDecomposition } from '../src/decomposition-import.ts';
import {
  appearanceDocumentSha256, appearanceRoleCatalog, validateAppearanceBinding,
  type AppearanceBindingDocument, type AppearanceRole,
} from '../src/appearance-binding.ts';
import { fixtureDocument } from '../src/fixtures.ts';
import type { UiDocument, UiNodeType } from '../src/tree-contract.ts';

const encoder = new TextEncoder();
const digest = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
const hex = (letter: string) => letter.repeat(64);
const componentIds: Record<UiNodeType, string> = {
  Image: 'confirm-icon', Text: 'heading', Container: 'root', Button: 'confirm', Switch: 'sound', CheckBox: 'tips',
  RadioGroup: 'quality', Input: 'name', Select: 'region', ProgressBar: 'progress', Slider: 'volume', ScrollView: 'scroll',
  List: 'inventory', Panel: 'footer-panel', Dialog: 'dialog', Tabs: 'details',
};
const typeKeys: Record<UiNodeType, string> = {
  Image: 'image', Text: 'text', Container: 'container', Button: 'button', Switch: 'switch', CheckBox: 'checkbox',
  RadioGroup: 'radiogroup', Input: 'input', Select: 'select', ProgressBar: 'progressbar', Slider: 'slider', ScrollView: 'scrollview',
  List: 'list', Panel: 'panel', Dialog: 'dialog', Tabs: 'tabs',
};
const layerId = (componentType: UiNodeType, role: AppearanceRole) => `appearance-${typeKeys[componentType]}-${role}`;
type FixtureLayer = { id: string; asset: string; role: 'background' | 'important_component'; left: number; top: number; size: readonly [number, number]; bytes: Uint8Array };

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function u16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true);
}
function u32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}
function be32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}
function join(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function storedZip(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const ordered = Object.entries(entries).sort(([left], [right]) => left.localeCompare(right, 'en-US'));
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const [name, body] of ordered) {
    const nameBytes = encoder.encode(name), header = new Uint8Array(30);
    const crc = crc32(body);
    u32(header, 0, 0x04034b50); u16(header, 4, 20); u32(header, 14, crc); u16(header, 26, nameBytes.length); u32(header, 18, body.length); u32(header, 22, body.length);
    local.push(header, nameBytes, body);
    const directory = new Uint8Array(46);
    u32(directory, 0, 0x02014b50); u16(directory, 4, 20); u16(directory, 6, 20); u32(directory, 16, crc); u32(directory, 20, body.length); u32(directory, 24, body.length);
    u16(directory, 28, nameBytes.length); u32(directory, 42, offset);
    central.push(directory, nameBytes); offset += header.length + nameBytes.length + body.length;
  }
  const centralBytes = join(central), footer = new Uint8Array(22);
  u32(footer, 0, 0x06054b50); u16(footer, 8, ordered.length); u16(footer, 10, ordered.length); u32(footer, 12, centralBytes.length); u32(footer, 16, offset);
  return join([...local, centralBytes, footer]);
}
function chunk(type: string, body: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + body.length); be32(bytes, 0, body.length); bytes.set(encoder.encode(type), 4); bytes.set(body, 8);
  be32(bytes, 8 + body.length, crc32(bytes.subarray(4, 8 + body.length))); return bytes;
}
/** A small, real RGBA PNG fixture; its compressed IDAT is decodable by standard PNG readers. */
function png(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13); new DataView(header.buffer).setUint32(0, width); new DataView(header.buffer).setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = new Uint8Array(height * (1 + width * 4));
  return join([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', new Uint8Array(deflateSync(rows))), chunk('IEND', new Uint8Array())]);
}

async function imported(): Promise<ImportedDecomposition> {
  const canvas = [920, 834] as const;
  const layers: FixtureLayer[] = appearanceRoleCatalog().components.flatMap(({ componentType, requiredRoles }, index) => requiredRoles.map((role, roleIndex) => {
    const background = componentType === 'Container' && role === 'background';
    const size = background ? canvas : [1, 1] as const;
    return { id: layerId(componentType, role), asset: layerId(componentType, role), role: background ? 'background' : 'important_component',
      left: background ? 0 : index * 8 + roleIndex, top: background ? 0 : 1, size, bytes: png(...size) };
  }));
  const preview = png(...canvas);
  const scene = {
    kind: 'ai_ui_decomposition_scene_v1', canvas, preview: 'preview.png', preview_sha256: digest(preview),
    document: { name: 'fixture', format: 'png_zip' }, plan_digest: hex('a'), materials_digest: hex('b'), review_sha256: null,
    delivery_policy: 'unreviewed_draft',
    tree: [
      { id: 'base', name: 'base', kind: 'group', children: layers.filter(layer => layer.role === 'background').map(layer => sceneLayer(layer)) },
      { id: 'controls', name: 'controls', kind: 'group', children: layers.filter(layer => layer.role !== 'background').map(layer => sceneLayer(layer)) },
    ],
  };
  const sceneBytes = encoder.encode(JSON.stringify(scene));
  const deliveryBody = {
    kind: 'ai_ui_decomposition_draft_delivery_v1', status: 'assembled_unreviewed_draft', delivery_policy: 'unreviewed_draft', human_visual_acceptance: false,
    scene_sha256: digest(sceneBytes), plan_digest: scene.plan_digest, batch_digest: hex('c'), materials_digest: scene.materials_digest,
    pixel_layers: layers.length, groups: 2, preview_sha256: scene.preview_sha256, automatic_retries: 0,
    automatic_semantic_inference: false, automatic_visual_acceptance: false,
    not_established: ['automatic_component_importance_selection', 'automatic_visual_acceptance', 'photoshop_application_open_validation', 'hidden_pixel_recovery'],
  };
  const delivery = { ...deliveryBody, digest: digest(encoder.encode(canonicalJson(deliveryBody))) };
  return importDecompositionZip(storedZip({
    'delivery.json': encoder.encode(JSON.stringify(delivery)),
    ...Object.fromEntries(layers.map(layer => [`layers/${layer.id}.png`, layer.bytes])),
    'preview.png': preview,
    'scene.json': sceneBytes,
  }));
}
function sceneLayer(layer: FixtureLayer): Record<string, unknown> {
  return {
    id: layer.id, name: layer.id, kind: 'pixel', role: layer.role, asset: layer.asset, png: `layers/${layer.id}.png`, sha256: digest(layer.bytes),
    left: layer.left, top: layer.top, size: layer.size, visible: true, opacity: 255, blend_mode: 'normal',
  };
}

async function validBinding(document: UiDocument, delivery: ImportedDecomposition): Promise<AppearanceBindingDocument> {
  return {
    kind: 'ui-appearance-binding', version: '0.1', documentSha256: await appearanceDocumentSha256(document),
    deliveryDigest: delivery.deliveryDigest, sceneSha256: delivery.sceneSha256, archiveSha256: delivery.archiveSha256,
    registration: {
      sourceCanvas: { ...delivery.scene.canvas }, targetCanvas: { ...document.canvas },
      transform: { scale: 1, offset: { x: 0, y: 0 } },
    },
    bindings: [
      { componentId: 'confirm', componentType: 'Button', parts: [{ role: 'background', layerId: layerId('Button', 'background') }] },
      {
        componentId: 'sound', componentType: 'Switch', parts: [{ role: 'track', layerId: layerId('Switch', 'track') }, { role: 'thumb', layerId: layerId('Switch', 'thumb') }],
        states: { switch: { thumbPositions: { coordinateSpace: 'target-component-local', anchor: 'top-left', off: { x: 4, y: 13 }, on: { x: 56, y: 13 } } } },
      },
    ],
  };
}
async function everyTypeBinding(document: UiDocument, delivery: ImportedDecomposition): Promise<AppearanceBindingDocument> {
  return {
    kind: 'ui-appearance-binding', version: '0.1', documentSha256: await appearanceDocumentSha256(document),
    deliveryDigest: delivery.deliveryDigest, sceneSha256: delivery.sceneSha256, archiveSha256: delivery.archiveSha256,
    registration: { sourceCanvas: { ...delivery.scene.canvas }, targetCanvas: { ...document.canvas }, transform: { scale: 1, offset: { x: 0, y: 0 } } },
    bindings: appearanceRoleCatalog().components.map(definition => ({
      componentId: componentIds[definition.componentType], componentType: definition.componentType,
      parts: definition.requiredRoles.map(role => ({ role, layerId: layerId(definition.componentType, role) })),
      ...(definition.componentType === 'Switch' ? {
        states: { switch: { thumbPositions: { coordinateSpace: 'target-component-local' as const, anchor: 'top-left' as const, off: { x: 4, y: 13 }, on: { x: 56, y: 13 } } } },
      } : {}),
    })),
  };
}
function expectIssue(run: () => Promise<unknown>, code: string, path?: string): Promise<void> {
  return assert.rejects(run, (error: unknown) => error instanceof HarnessError && error.stage === 'contract'
    && error.issues.some(issue => issue.code === code && (path === undefined || issue.path === path)));
}

test('validated binding binds exact UI, exact authenticated ZIP, explicit registration, and component-local switch states', async () => {
  const document = fixtureDocument('gallery'), delivery = await imported(), input = await validBinding(document, delivery);
  const result = await validateAppearanceBinding(input, document, delivery);
  assert.deepEqual(result, input);
  assert.notEqual(result, input);
  assert.notEqual(result.bindings, input.bindings);
});

test('document digest is canonical and role catalog covers every v0.2 component type without exposing mutable registry state', async () => {
  const document = fixtureDocument('gallery'), reordered = JSON.parse(JSON.stringify(document)) as UiDocument;
  reordered.canvas = { height: 834, width: 920 };
  assert.equal(await appearanceDocumentSha256(document), await appearanceDocumentSha256(reordered));
  const catalog = appearanceRoleCatalog();
  assert.equal(catalog.version, '0.1');
  assert.equal(catalog.components.find(component => component.componentType === 'Select')?.allowedRoles.includes('popup'), false);
  assert.deepEqual(catalog.components.map(component => component.componentType), [
    'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
    'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
  ]);
  catalog.components[0].allowedRoles[0] = 'text';
  assert.deepEqual(appearanceRoleCatalog().components[0].allowedRoles, ['image']);
  const applicationCatalog = appearanceRoleCatalog('0.2');
  assert.equal(applicationCatalog.version, '0.2');
  assert.deepEqual(applicationCatalog.components.map(component => component.componentType), [
    'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
    'Select', 'ProgressBar', 'Slider', 'Panel', 'ScrollView', 'List', 'Dialog', 'Tabs',
  ]);
  assert.deepEqual(applicationCatalog.components.find(component => component.componentType === 'Slider')?.requiredRoles, ['track', 'fill', 'thumb']);
  assert.throws(() => appearanceRoleCatalog('9.9' as any), (error: unknown) => error instanceof HarnessError && error.issues.some(issue => issue.code === 'UNSUPPORTED_VERSION'));
});

test('every role catalog declaration accepts its complete required-role binding against one authenticated imported ZIP', async () => {
  const document = fixtureDocument('gallery'), delivery = await imported(), input = await everyTypeBinding(document, delivery);
  const before = structuredClone(input);
  const result = await validateAppearanceBinding(input, document, delivery);
  assert.equal(result.bindings.length, 16);
  for (const definition of appearanceRoleCatalog().components) {
    const binding = result.bindings.find(candidate => candidate.componentType === definition.componentType);
    assert.ok(binding, `${definition.componentType} binding`);
    assert.deepEqual(binding.parts.map(part => part.role), definition.requiredRoles);
  }
  assert.deepEqual(input, before, 'validation must not repair or otherwise mutate the supplied handoff');
});

test('binding rejects stale evidence, inferred canvas registration, and unknown source layers', async () => {
  const document = fixtureDocument('gallery'), delivery = await imported();
  const cases: Array<[string, (value: any) => void, string, string]> = [
    ['document digest', value => value.documentSha256 = hex('0'), 'DOCUMENT_DIGEST_MISMATCH', '$appearanceBinding.documentSha256'],
    ['delivery digest', value => value.deliveryDigest = hex('0'), 'DELIVERY_DIGEST_MISMATCH', '$appearanceBinding.deliveryDigest'],
    ['scene digest', value => value.sceneSha256 = hex('0'), 'SCENE_DIGEST_MISMATCH', '$appearanceBinding.sceneSha256'],
    ['archive digest', value => value.archiveSha256 = hex('0'), 'ARCHIVE_DIGEST_MISMATCH', '$appearanceBinding.archiveSha256'],
    ['source canvas', value => value.registration.sourceCanvas.width += 1, 'SOURCE_CANVAS_MISMATCH', '$appearanceBinding.registration.sourceCanvas'],
    ['target canvas', value => value.registration.targetCanvas.height += 1, 'TARGET_CANVAS_MISMATCH', '$appearanceBinding.registration.targetCanvas'],
    ['cropped source registration', value => value.registration.transform.offset.x = -1, 'REGISTRATION_CROPS_SOURCE', '$appearanceBinding.registration.transform'],
    ['non-uniform transform', value => value.registration.transform.scale = { x: 1, y: 1 }, 'POSITIVE_NUMBER_REQUIRED', '$appearanceBinding.registration.transform.scale'],
    ['nonfinite transform', value => value.registration.transform.scale = Number.NaN, 'POSITIVE_NUMBER_REQUIRED', '$appearanceBinding.registration.transform.scale'],
    ['unknown layer', value => value.bindings[0].parts[0].layerId = 'not-imported', 'UNKNOWN_LAYER', '$appearanceBinding.bindings[0].parts[0].layerId'],
    ['unknown component', value => value.bindings[0].componentId = 'not-in-document', 'UNKNOWN_COMPONENT', '$appearanceBinding.bindings[0].componentId'],
  ];
  for (const [, mutate, code, path] of cases) {
    const value = await validBinding(document, delivery); mutate(value);
    await expectIssue(() => validateAppearanceBinding(value, document, delivery), code, path);
  }
});

test('validation snapshots the handoff before asynchronous ZIP authentication and rejects forged or mutated importer contexts', async () => {
  const document = fixtureDocument('gallery'), delivery = await imported(), input = await validBinding(document, delivery), expected = structuredClone(input);
  const pending = validateAppearanceBinding(input, document, delivery);
  input.bindings[0].parts[0].layerId = 'not-imported';
  assert.deepEqual(await pending, expected, 'a caller mutation after the async call begins cannot race validation');

  const forged = structuredClone(delivery) as ImportedDecomposition;
  await assert.rejects(() => validateAppearanceBinding(expected, document, forged), (error: unknown) => error instanceof DecompositionImportError
    && error.code === 'IMPORTED_DECOMPOSITION_NOT_VALIDATED');

  const tampered = await imported();
  tampered.resources[0].bytes[0] ^= 0xff;
  await assert.rejects(() => validateAppearanceBinding(expected, document, tampered), (error: unknown) => error instanceof DecompositionImportError
    && error.code === 'IMPORTED_RESOURCE_TAMPERED');
});

test('each declared binding is complete and explicit: no duplicate controls, layers, roles, wrong control types, or guessed switch coordinates', async () => {
  const document = fixtureDocument('gallery'), delivery = await imported();
  const cases: Array<[string, (value: any) => void, string, string]> = [
    ['duplicate control', value => value.bindings.push(structuredClone(value.bindings[0])), 'DUPLICATE_COMPONENT', '$appearanceBinding.bindings[2].componentId'],
    ['duplicate layer', value => value.bindings[1].parts[1].layerId = layerId('Button', 'background'), 'DUPLICATE_LAYER', '$appearanceBinding.bindings[1].parts[1].layerId'],
    ['duplicate role', value => value.bindings[1].parts[1].role = 'track', 'DUPLICATE_ROLE', '$appearanceBinding.bindings[1].parts[1].role'],
    ['wrong type', value => value.bindings[0].componentType = 'Image', 'COMPONENT_TYPE_MISMATCH', '$appearanceBinding.bindings[0].componentType'],
    ['missing required part', value => value.bindings[1].parts = [{ role: 'track', layerId: layerId('Switch', 'track') }], 'MISSING_REQUIRED_ROLE', '$appearanceBinding.bindings[1].parts'],
    ['missing state coordinates', value => delete value.bindings[1].states, 'OBJECT_REQUIRED', '$appearanceBinding.bindings[1].states'],
    ['wrong coordinate space', value => value.bindings[1].states.switch.thumbPositions.coordinateSpace = 'scene', 'UNSUPPORTED_COORDINATE_SPACE', '$appearanceBinding.bindings[1].states.switch.thumbPositions.coordinateSpace'],
    ['wrong thumb anchor', value => value.bindings[1].states.switch.thumbPositions.anchor = 'center', 'UNSUPPORTED_POSITION_ANCHOR', '$appearanceBinding.bindings[1].states.switch.thumbPositions.anchor'],
    ['out of bounds coordinate', value => value.bindings[1].states.switch.thumbPositions.on.x = 245, 'POSITION_OUT_OF_BOUNDS', '$appearanceBinding.bindings[1].states.switch.thumbPositions.on'],
    ['clipped scaled thumb', value => value.bindings[1].states.switch.thumbPositions.on.x = 244, 'THUMB_OUT_OF_BOUNDS', '$appearanceBinding.bindings[1].states.switch.thumbPositions.on'],
    ['identical state positions', value => value.bindings[1].states.switch.thumbPositions.on = { x: 4, y: 13 }, 'IDENTICAL_SWITCH_POSITIONS', '$appearanceBinding.bindings[1].states.switch.thumbPositions'],
  ];
  for (const [, mutate, code, path] of cases) {
    const value = await validBinding(document, delivery); mutate(value);
    await expectIssue(() => validateAppearanceBinding(value, document, delivery), code, path);
  }
});
