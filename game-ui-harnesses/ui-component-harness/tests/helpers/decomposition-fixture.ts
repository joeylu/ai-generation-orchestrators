import { deflateSync } from 'node:zlib';

/** A byte-level fixture matching the upstream ZIP_STORED + force_zip64 layout. */
export interface DecompositionFixture {
  readonly zip: Uint8Array;
  readonly scene: Readonly<Record<string, unknown>>;
  readonly delivery: Readonly<Record<string, unknown>>;
  readonly members: readonly Readonly<{ name: string; bytes: Uint8Array }>[];
}

const encoder = new TextEncoder();
const absent = [
  'automatic_component_importance_selection',
  'automatic_visual_acceptance',
  'photoshop_application_open_validation',
  'hidden_pixel_recovery',
];

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
function pretty(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[\n${value.map(item => `  ${pretty(item).replace(/\n/g, '\n  ')}`).join(',\n')}\n]`;
  const object = value as Record<string, unknown>; const keys = Object.keys(object).sort();
  return keys.length === 0 ? '{}' : `{\n${keys.map(key => `  ${JSON.stringify(key)}: ${pretty(object[key]).replace(/\n/g, '\n  ')}`).join(',\n')}\n}`;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function u16(value: number): Uint8Array { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff); }
function u32(value: number): Uint8Array { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
function be32(value: number): Uint8Array { return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff); }
function u64(value: number): Uint8Array { return Uint8Array.of(...u32(value), 0, 0, 0, 0); }
function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function adler32(bytes: Uint8Array): number {
  let a = 1; let b = 0;
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function chunk(type: string, bytes: Uint8Array): Uint8Array {
  const name = encoder.encode(type); const crc = crc32(join([name, bytes]));
  return join([be32(bytes.length), name, bytes, be32(crc)]);
}
/** A real 1x1 RGBA PNG: a zlib stream with one uncompressed scanline. */
export function fixtureRgbaPng(width = 1, height = 1, color: readonly [number, number, number, number] = [35, 99, 177, 255]): Uint8Array {
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = y * (1 + width * 4) + 1 + x * 4;
    scanlines.set(color, offset);
  }
  const zlib = new Uint8Array(deflateSync(scanlines));
  return join([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', join([be32(width), be32(height), Uint8Array.of(8, 6, 0, 0, 0)])), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())]);
}
const png = fixtureRgbaPng();

interface ZipInput { name: string; bytes: Uint8Array }
/** Write the same relevant headers that Python ZipFile.open(..., force_zip64=True) writes. */
export function forceZip64Stored(entries: readonly ZipInput[]): Uint8Array {
  const sorted = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const entry of sorted) {
    const name = encoder.encode(entry.name); const crc = crc32(entry.bytes);
    const zip64 = join([u16(1), u16(16), u64(entry.bytes.length), u64(entry.bytes.length)]);
    const header = join([u32(0x04034b50), u16(45), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(0xffffffff), u32(0xffffffff), u16(name.length), u16(zip64.length), name, zip64, entry.bytes]);
    local.push(header);
    central.push(join([u32(0x02014b50), u16(0x032d), u16(45), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(entry.bytes.length), u32(entry.bytes.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0x81a40000), u32(offset), name]));
    offset += header.length;
  }
  const directory = join(central);
  return join([...local, directory, u32(0x06054b50), u16(0), u16(0), u16(sorted.length), u16(sorted.length), u32(directory.length), u32(offset), u16(0)]);
}

/** Valid draft/reviewed delivery with an optional public automated-QA receipt. */
export async function fixtureZip(options: { includeQa?: boolean; reviewed?: boolean } = {}): Promise<DecompositionFixture> {
  const previewSha256 = await sha256(png); const planDigest = 'a'.repeat(64); const materialsDigest = 'b'.repeat(64);
  const deliveryPolicy = options.reviewed ? 'reviewed' : 'unreviewed_draft';
  const scene = {
    kind: 'ai_ui_decomposition_scene_v1', canvas: [1, 1],
    tree: [{ id: 'background', name: 'background', kind: 'group', children: [{ id: 'background', name: 'background', kind: 'pixel', role: 'background', asset: 'scene', png: 'layers/background.png', sha256: previewSha256, left: 0, top: 0, size: [1, 1], visible: true, opacity: 255, blend_mode: 'normal' }], }],
    preview: 'preview.png', preview_sha256: previewSha256, document: { name: 'sample-ui', format: 'png_zip' }, plan_digest: planDigest, materials_digest: materialsDigest, review_sha256: options.reviewed ? 'f'.repeat(64) : null, delivery_policy: deliveryPolicy,
  };
  const sceneBytes = encoder.encode(`${pretty(scene)}\n`); const sceneSha256 = await sha256(sceneBytes);
  const deliveryBody = {
    kind: options.reviewed ? 'ai_ui_decomposition_delivery_v1' : 'ai_ui_decomposition_draft_delivery_v1', status: options.reviewed ? 'assembled_visual_review_bound' : 'assembled_unreviewed_draft', delivery_policy: deliveryPolicy, human_visual_acceptance: options.reviewed === true, scene_sha256: sceneSha256, plan_digest: planDigest, batch_digest: 'c'.repeat(64), materials_digest: materialsDigest, pixel_layers: 1, groups: 1, preview_sha256: previewSha256, automatic_retries: 0, automatic_semantic_inference: false, automatic_visual_acceptance: false, not_established: absent,
  };
  const delivery = { ...deliveryBody, digest: await sha256(encoder.encode(canonical(deliveryBody))) };
  const entries: ZipInput[] = [
    { name: 'scene.json', bytes: sceneBytes }, { name: 'delivery.json', bytes: encoder.encode(`${pretty(delivery)}\n`) },
    { name: 'preview.png', bytes: png }, { name: 'layers/background.png', bytes: png },
  ];
  if (options.includeQa) {
    const qaBody = {
      kind: 'ai_ui_decomposition_automated_visual_qa_v1', plan_digest: planDigest, materials_digest: materialsDigest,
      reference_sha256: 'd'.repeat(64), preview_sha256: previewSha256, contact_sheet_sha256: 'e'.repeat(64),
      policy: { minimum_overall_score: 80, minimum_criterion_score: 70, blocker_issues_allowed: 0 }, outcome: 'passed',
      assessment: { decision: 'accept', passed: true, overall_score: 90, checks: { layout_fidelity: 90, component_coverage: 90, text_policy: 90, cutout_cleanliness: 90 }, issues: [] }, reason: null, automatic_retries: 0, human_visual_acceptance: false,
    };
    const qa = { ...qaBody, digest: await sha256(encoder.encode(canonical(qaBody))) };
    entries.push({ name: 'automated-visual-qa.json', bytes: encoder.encode(`${pretty(qa)}\n`) });
  }
  const members = Object.freeze(entries.map(entry => Object.freeze({ name: entry.name, bytes: new Uint8Array(entry.bytes) })));
  return Object.freeze({ zip: forceZip64Stored(members), scene: Object.freeze(scene), delivery: Object.freeze(delivery), members });
}

export interface LayeredFixtureInput {
  readonly id: string;
  readonly role: 'background' | 'important_component';
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly color?: readonly [number, number, number, number];
}

/** A small current-format delivery with caller-authored, explicit layer geometry. */
export async function fixtureLayeredZip(canvas: readonly [number, number], inputLayers: readonly LayeredFixtureInput[]): Promise<DecompositionFixture> {
  const preview = fixtureRgbaPng(...canvas); const previewSha256 = await sha256(preview);
  const layers = await Promise.all(inputLayers.map(async layer => {
    const bytes = fixtureRgbaPng(layer.width, layer.height, layer.color);
    return { ...layer, bytes, sha256: await sha256(bytes) };
  }));
  const sceneLayer = (layer: typeof layers[number]) => ({
    id: layer.id, name: layer.id, kind: 'pixel', role: layer.role, asset: layer.id, png: `layers/${layer.id}.png`, sha256: layer.sha256,
    left: layer.left, top: layer.top, size: [layer.width, layer.height], visible: true, opacity: 255, blend_mode: 'normal',
  });
  const scene = {
    kind: 'ai_ui_decomposition_scene_v1', canvas,
    tree: [
      { id: 'base', name: 'base', kind: 'group', children: layers.filter(layer => layer.role === 'background').map(sceneLayer) },
      { id: 'controls', name: 'controls', kind: 'group', children: layers.filter(layer => layer.role !== 'background').map(sceneLayer) },
    ],
    preview: 'preview.png', preview_sha256: previewSha256, document: { name: 'layered-fixture', format: 'png_zip' },
    plan_digest: 'a'.repeat(64), materials_digest: 'b'.repeat(64), review_sha256: null, delivery_policy: 'unreviewed_draft',
  };
  const sceneBytes = encoder.encode(`${pretty(scene)}\n`); const sceneSha256 = await sha256(sceneBytes);
  const deliveryBody = {
    kind: 'ai_ui_decomposition_draft_delivery_v1', status: 'assembled_unreviewed_draft', delivery_policy: 'unreviewed_draft', human_visual_acceptance: false,
    scene_sha256: sceneSha256, plan_digest: scene.plan_digest, batch_digest: 'c'.repeat(64), materials_digest: scene.materials_digest,
    pixel_layers: layers.length, groups: 2, preview_sha256: previewSha256, automatic_retries: 0,
    automatic_semantic_inference: false, automatic_visual_acceptance: false, not_established: absent,
  };
  const delivery = { ...deliveryBody, digest: await sha256(encoder.encode(canonical(deliveryBody))) };
  const entries: ZipInput[] = [
    { name: 'scene.json', bytes: sceneBytes }, { name: 'delivery.json', bytes: encoder.encode(`${pretty(delivery)}\n`) },
    { name: 'preview.png', bytes: preview }, ...layers.map(layer => ({ name: `layers/${layer.id}.png`, bytes: layer.bytes })),
  ];
  const members = Object.freeze(entries.map(entry => Object.freeze({ name: entry.name, bytes: new Uint8Array(entry.bytes) })));
  return Object.freeze({ zip: forceZip64Stored(members), scene: Object.freeze(scene), delivery: Object.freeze(delivery), members });
}
