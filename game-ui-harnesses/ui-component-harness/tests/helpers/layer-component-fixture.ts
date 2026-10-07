import { fixtureRgbaPng } from './decomposition-fixture.ts';
import { fixtureStyle } from '../../src/fixtures.ts';
import { zip } from '../../src/reference-persistence.ts';
import { layerSha256, type LayerComponentPlan } from '../../src/layer-component.ts';
import type { UiDocument } from '../../src/tree-contract.ts';

export async function layerComponentFixture() {
  const canvas = { width: 200, height: 100 };
  const layers = [
    { id: 'back', name: 'Fixture background', role: 'background' as const, path: 'layers/layer-001.png', x: 0, y: 0, width: 200, height: 100, visible: true as const },
    { id: 'button', name: 'Fixture button art', role: 'foreground' as const, path: 'layers/layer-002.png', x: 10, y: 20, width: 60, height: 30, visible: true as const },
  ];
  const composition = { kind: 'ui_layer_composition_v1', canvas, coordinates: 'top-left-pixels', order: 'array-back-to-front', textPolicy: 'remove-business-text', backgroundMode: 'scene-only', reference: 'reference.png', preview: 'preview.png', layers };
  const encoder = new TextEncoder();
  const full = fixtureRgbaPng(200, 100);
  const entries = new Map<string, Uint8Array>([
    ['composition.json', encoder.encode(JSON.stringify(composition))], ['reference.png', full], ['preview.png', full],
    ['review.json', encoder.encode(JSON.stringify({ status: 'review-required', humanVisualAcceptance: false, textPolicy: 'remove-business-text', issues: ['fixture only'] }))],
    ['README.txt', encoder.encode('Programmatic fixture')], ['viewer.html', encoder.encode('<html></html>')], ['viewer.js', encoder.encode('')],
    [layers[0].path, full], [layers[1].path, fixtureRgbaPng(60, 30, [90, 140, 220, 255])],
  ]);
  const files: Record<string, { sha256: string; bytes: number }> = {};
  for (const [path, bytes] of entries) files[path] = { sha256: await layerSha256(bytes), bytes: bytes.length };
  entries.set('manifest.json', encoder.encode(JSON.stringify({ kind: 'ui_layers_package_v1', version: 1, files })));
  const bytes = zip(entries);
  const document: UiDocument = { schemaVersion: '0.2', id: 'layer-fixture', canvas, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, ...canvas }, props: { style: { ...fixtureStyle, borderWidth: 0 } }, children: [
      { id: 'background', type: 'Image', layout: { x: 0, y: 0, ...canvas }, props: { source: layers[0].path, fit: 'stretch', style: { ...fixtureStyle, borderWidth: 0 } } },
      { id: 'action', type: 'Button', layout: { x: 10, y: 20, width: 60, height: 30 }, props: {
        label: 'PLAY', enabled: true, appearance: { backgroundImage: layers[1].path, sourceCanvas: { width: 60, height: 30 }, labelLayout: { x: 2, y: 2, width: 56, height: 26 } },
        style: { ...fixtureStyle, fontSize: 12, textColor: '#FFFFFF', borderWidth: 0 },
      }, children: [] },
    ],
  } };
  const plan: LayerComponentPlan = { kind: 'ui-layer-component-plan', version: '1.0', archiveSha256: await layerSha256(bytes), basis: 'programmatic-fixture',
    requirements: 'Two-layer procedural UI, explicit button text and bounds; no visual acceptance.', document,
    bindings: [{ layerId: 'back', pointer: '/root/children/0/props/source' }, { layerId: 'button', pointer: '/root/children/1/props/appearance/backgroundImage' }], unusedLayers: [] };
  return { bytes, plan, entries };
}
