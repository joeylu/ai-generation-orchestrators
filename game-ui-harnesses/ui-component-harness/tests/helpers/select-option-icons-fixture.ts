import { deflateSync } from 'node:zlib';
import { createBundle } from '../../src/bundle.ts';
import { appearanceDocumentSha256 } from '../../src/appearance-binding.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import { zip, referenceSha256 } from '../../src/reference-persistence.ts';
import { fixtureLayeredZip } from './decomposition-fixture.ts';

// Deterministic geometry with transparent padding and half-alpha edge pixels.
function iconPng(width: number, height: number, kind: number): Uint8Array {
  const pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = (x + .5 - width / 2) / (width / 2), ny = (y + .5 - height / 2) / (height / 2);
    const distance = kind === 0 ? Math.hypot(nx, ny) : kind === 1 ? Math.max(Math.abs(nx) * 1.3 - ny * .4, Math.abs(ny)) : Math.abs(nx) + Math.abs(ny);
    const alpha = distance < .65 ? 255 : distance < .8 ? 128 : 0;
    const color = [[220, 40, 60], [15, 150, 80], [40, 100, 225]][kind];
    pixels.set(alpha ? [...color, alpha] : [0, 0, 0, 0], y * (1 + width * 4) + 1 + x * 4);
  }
  const chunk = (type: string, bytes: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff;
    for (const b of body) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), tail = Buffer.alloc(4); length.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', new Uint8Array())]);
}

export async function selectOptionIconsFixture() {
  const style = { backgroundColor: '#F4F5FA', borderColor: '#8996B0', borderWidth: 1, cornerRadius: 6, textColor: '#18253F', fontFamily: 'sans-serif', fontSize: 18, fontWeight: 'normal', opacity: 1 };
  const document: any = { schemaVersion: '0.2', id: 'select-option-fixture', canvas: { width: 500, height: 400 }, root: { id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 500, height: 400 }, props: { style }, children: [
    { id: 'region', type: 'Select', layout: { x: 60, y: 60, width: 300, height: 48 }, props: { enabled: true, selectedId: 'red', options: [{ id: 'red', label: 'RED CIRCLE' }, { id: 'green', label: 'GREEN TRIANGLE' }, { id: 'blue', label: 'BLUE DIAMOND' }], style } },
    { id: 'behind', type: 'Button', layout: { x: 60, y: 165, width: 300, height: 48 }, props: { label: 'Underlying button', enabled: true, style }, children: [] },
    { id: 'caption', type: 'Text', layout: { x: 60, y: 315, width: 380, height: 50 }, props: { text: 'LOCAL PROCEDURAL FIXTURE', wrap: 'none', overflow: 'clip', lineHeight: 24, drawBackground: false, style } },
  ] } };
  const fixture = await fixtureLayeredZip([500, 400], [
    { id: 'scene', role: 'background', left: 0, top: 0, width: 500, height: 400, color: [243,245,250,255] },
    { id: 'field', role: 'important_component', left: 60, top: 60, width: 300, height: 48, color: [224,230,243,255] },
    { id: 'arrow', role: 'important_component', left: 326, top: 79, width: 18, height: 10, color: [75,95,150,255] },
    { id: 'popup', role: 'important_component', left: 60, top: 112, width: 300, height: 168, color: [252,250,236,255] },
    { id: 'button', role: 'important_component', left: 60, top: 165, width: 300, height: 48, color: [202,213,237,255] },
    ...[[24,24], [20,32], [36,18]].map(([width,height], i) => ({ id: `icon-${i}`, role: 'important_component' as const, left: 80, top: 134 + i * 48, width, height, bytes: iconPng(width,height,i) })),
  ]);
  const imported = await importDecompositionZip(fixture.zip);
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Local synthetic Select icons; not Quest Journal artwork or observed reference state.' });
  const binding: any = { kind: 'ui-appearance-binding', version: '0.2', documentSha256: await appearanceDocumentSha256(document), deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256, archiveSha256: imported.archiveSha256,
    registration: { sourceCanvas: document.canvas, targetCanvas: document.canvas, transform: { scale: 1, offset: { x: 0, y: 0 } } }, bindings: [
      { componentId: 'root', componentType: 'Container', parts: [{ role: 'background', layerId: 'scene' }] },
      { componentId: 'behind', componentType: 'Button', parts: [{ role: 'background', layerId: 'button' }], states: { button: { labelLayout: { coordinateSpace: 'target-component-local', x: 12, y: 4, width: 270, height: 40 } } } },
      { componentId: 'region', componentType: 'Select', parts: [{ role: 'background', layerId: 'field' }, { role: 'indicator', layerId: 'arrow' }, { role: 'popup', layerId: 'popup' }], states: { select: {
        labelLayout: { coordinateSpace: 'target-component-local', x: 12, y: 4, width: 240, height: 40 }, popupPlacement: { coordinateSpace: 'target-component-local', anchor: 'below-start', gap: 4 },
        popupContentLayout: { coordinateSpace: 'target-popup-local', x: 12, y: 12, width: 276, height: 144 },
        optionIcons: { version: '1.0', coordinateSpace: 'popup-row-local', items: ['blue','red','green'].map(id => ({ optionId: id, icon: { layerId: `icon-${['red','green','blue'].indexOf(id)}`, layout: { x: 6, y: 10, width: 28, height: 28 } }, labelLayout: { x: 48, y: 4, width: 220, height: 40 } })) },
      } } },
    ] };
  const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const unknown = { status: 'unknown', reason: 'Synthetic reference raster has no observed Select state. Interactions are derived procedural tests.' };
  const state = { kind: 'ui-reference-state', schemaVersion: '1.0', components: [{ componentId: 'region', componentType: 'Select', fields: { selectedId: unknown, popupOpen: unknown } }] };
  const scope = { kind: 'ui-acceptance-scope', schemaVersion: '1.0', referenceState: 'reference/reference-state.json', human_visual_acceptance: false, derivedTestStates: [], components: ['root','region','behind','caption'].map(componentId => ({ componentId, mode: 'exclude', reason: 'Procedural icon/input regression only; synthetic reference image is not visual evidence.' })) };
  const entries = new Map<string,Uint8Array>([['component.ui-bundle.json',encode(target)], ['appearance-binding.json',encode(binding)], ['decomposition/fixture.draft.zip',fixture.zip], ['reference/original.png',imported.preview.bytes], ['reference/reference-state.json',encode(state)], ['acceptance-scope.json',encode(scope)]]);
  const entry = async(path: string) => ({ path, sha256: await referenceSha256(entries.get(path)!) });
  const mapping = { coordinateSpace: 'raw-image-pixel-edges-to-runtime-canvas', sourceSize: [500,400], targetSize: [500,400], crop: [0,0,500,400], rotationDegrees: 0, flipX: false, flipY: false, scale: [1,1], offset: [0,0] };
  entries.set('handoff.json',encode({kind:'ai_ui_component_handoff_v2',schemaVersion:'2.0',status:'contracts_packaged_unreviewed_draft',delivery_policy:'unreviewed_draft',human_visual_acceptance:false,component_bundle:await entry('component.ui-bundle.json'),appearance_binding:await entry('appearance-binding.json'),decomposition:await entry('decomposition/fixture.draft.zip'),reference:{original:{...await entry('reference/original.png'),width:500,height:400},state:await entry('reference/reference-state.json'),scope:await entry('acceptance-scope.json'),mapping,derivatives:[]}}));
  return { document, target, binding, imported, fixture, entries, zip: zip(entries) };
}
