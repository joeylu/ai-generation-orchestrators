import { switchStateImagesFixture } from './switch-state-images-fixture.ts';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { appearanceApplicationFixture } from './appearance-application-fixture.ts';
import { forceZip64Stored } from './decomposition-fixture.ts';
import { createBundle } from '../../src/bundle.ts';
import { appearanceDocumentSha256 } from '../../src/appearance-binding.ts';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const observed = (value: unknown) => ({ status: 'observed', value, evidence: 'Explicit procedural fixture; independently rasterized rectangles, not user artwork.' });
function png(stateImages = false): Uint8Array {
  const w = 500, h = 400, data = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let color = [35, 99, 177, 255];
    if (x >= 10 && x < 190 && y >= 70 && y < 110) color = stateImages ? [0, 180, 250, 255] : [48, 105, 70, 255];
    if (x >= 154 && x < 186 && y >= 74 && y < 106) color = stateImages ? [255, 60, 100, 255] : [246, 243, 231, 255];
    data.set(color, y * (w * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, bytes: Uint8Array) => {
    const payload = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff;
    for (const b of payload) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([header, payload, tail]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(data)), chunk('IEND', new Uint8Array())]);
}
export async function referenceV2Fixture(options: { stateImages?: boolean; unknown?: boolean; badOriginal?: boolean; excludeAll?: boolean; invalidImage?: boolean } = {}) {
  const f = await (options.stateImages ? switchStateImagesFixture() : appearanceApplicationFixture());
  const document: any = structuredClone(f.document); document.root.children = [document.root.children[1]];
  document.root.children[0].props.label = '';
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Independent rectangle reference fixture.' });
  const binding: any = structuredClone(f.binding); binding.documentSha256 = await appearanceDocumentSha256(document);
  binding.bindings = [{ componentId: 'root', componentType: 'Container', parts: [{ role: 'background', layerId: 'scene-background' }] }, binding.bindings[1]];
  const state = { kind: 'ui-reference-state', schemaVersion: '1.0', components: [{ componentId: 'apply-switch', componentType: 'Switch', fields: { checked: options.unknown ? { status: 'unknown', reason: 'Explicit unknown fixture' } : observed(true) } }] };
  const scope = { kind: 'ui-acceptance-scope', schemaVersion: '1.0', referenceState: 'reference/reference-state.json', human_visual_acceptance: false, derivedTestStates: [], components: ['root', 'apply-switch'].map(componentId => ({ componentId, mode: options.excludeAll ? 'exclude' : 'compare', reason: 'Procedural test scope' })) };
  const mapping = { coordinateSpace: 'raw-image-pixel-edges-to-runtime-canvas', sourceSize: [500, 400], targetSize: [500, 400], crop: [0, 0, 500, 400], rotationDegrees: 0, flipX: false, flipY: false, scale: [1, 1], offset: [0, 0] };
  const original = options.invalidImage ? png(options.stateImages).slice(0, 33) : options.badOriginal ? f.imported.preview.bytes : png(options.stateImages);
  const members = new Map<string, Uint8Array>([['component.ui-bundle.json', encode(target)], ['appearance-binding.json', encode(binding)], ['decomposition/fixture.draft.zip', f.fixture.zip], ['reference/original.png', original], ['reference/derived-1.png', original], ['reference/reference-state.json', encode(state)], ['acceptance-scope.json', encode(scope)]]);
  const entry = (path: string) => ({ path, sha256: sha(members.get(path)!) });
  const manifest = { kind: 'ai_ui_component_handoff_v2', schemaVersion: '2.0', status: 'contracts_packaged_unreviewed_draft', delivery_policy: 'unreviewed_draft', human_visual_acceptance: false, decomposition: entry('decomposition/fixture.draft.zip'), component_bundle: entry('component.ui-bundle.json'), appearance_binding: entry('appearance-binding.json'), reference: { original: { ...entry('reference/original.png'), width: 500, height: 400 }, mapping, state: entry('reference/reference-state.json'), scope: entry('acceptance-scope.json'), derivatives: [{ ...entry('reference/derived-1.png'), width: 500, height: 400, source: 'reference/original.png', mapping }] } };
  members.set('handoff.json', encode(manifest));
  return { zip: forceZip64Stored([...members].map(([name, bytes]) => ({ name, bytes }))), original, state };
}
