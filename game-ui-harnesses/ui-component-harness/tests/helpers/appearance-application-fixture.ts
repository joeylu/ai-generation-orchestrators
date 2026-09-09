import { appearanceDocumentSha256 } from '../../src/appearance-binding.ts';
import { createBundle } from '../../src/bundle.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import type { ControlStyle, UiDocument } from '../../src/tree-contract.ts';
import { fixtureLayeredZip } from './decomposition-fixture.ts';

const style: ControlStyle = { backgroundColor: '#F2E5C5', borderColor: '#315322', borderWidth: 0, cornerRadius: 8, textColor: '#344522', fontFamily: 'sans-serif', fontSize: 18, fontWeight: 'bold', opacity: 1 };

export async function appearanceApplicationFixture() {
  const document: UiDocument = { schemaVersion: '0.2', id: 'appearance-application-fixture', canvas: { width: 500, height: 400 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 500, height: 400 }, props: { style }, children: [
      { id: 'apply-button', type: 'Button', layout: { x: 10, y: 10, width: 100, height: 40 }, props: { label: 'Apply', enabled: true, style }, children: [] },
      { id: 'apply-switch', type: 'Switch', layout: { x: 10, y: 70, width: 180, height: 40 }, props: { label: 'Sound', checked: false, enabled: true, style } },
      { id: 'apply-select', type: 'Select', layout: { x: 10, y: 130, width: 120, height: 40 }, props: { selectedId: 'high', options: [{ id: 'high', label: 'High' }, { id: 'low', label: 'Low' }], enabled: true, style } },
    ],
  } };
  const fixture = await fixtureLayeredZip([500, 400], [
    { id: 'scene-background', role: 'background', left: 0, top: 0, width: 500, height: 400 },
    { id: 'button-background', role: 'important_component', left: 10, top: 10, width: 100, height: 40 },
    { id: 'switch-track', role: 'important_component', left: 10, top: 70, width: 180, height: 40, color: [48, 105, 70, 255] },
    { id: 'switch-thumb', role: 'important_component', left: 14, top: 74, width: 32, height: 32, color: [246, 243, 231, 255] },
    { id: 'select-field', role: 'important_component', left: 10, top: 130, width: 120, height: 40 },
    { id: 'select-arrow', role: 'important_component', left: 100, top: 145, width: 20, height: 10 },
    { id: 'select-popup', role: 'important_component', left: 10, top: 172, width: 120, height: 90 },
  ]);
  const imported = await importDecompositionZip(fixture.zip);
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Explicit target for deterministic appearance application browser and unit regression.' });
  const binding = {
    kind: 'ui-appearance-binding', version: '0.2', documentSha256: await appearanceDocumentSha256(document),
    deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256, archiveSha256: imported.archiveSha256,
    registration: { sourceCanvas: { width: 500, height: 400 }, targetCanvas: { width: 500, height: 400 }, transform: { scale: 1, offset: { x: 0, y: 0 } } },
    bindings: [
      { componentId: 'apply-button', componentType: 'Button', parts: [{ role: 'background', layerId: 'button-background' }], states: { button: { labelLayout: { coordinateSpace: 'target-component-local', x: 10, y: 5, width: 80, height: 30 } } } },
      { componentId: 'apply-switch', componentType: 'Switch', parts: [{ role: 'track', layerId: 'switch-track' }, { role: 'thumb', layerId: 'switch-thumb' }], states: { switch: {
        thumbPositions: { coordinateSpace: 'target-component-local', anchor: 'top-left', off: { x: 4, y: 4 }, on: { x: 144, y: 4 } },
        labelLayout: { coordinateSpace: 'target-component-local', x: 48, y: 5, width: 90, height: 30 },
      } } },
      { componentId: 'apply-select', componentType: 'Select', parts: [{ role: 'background', layerId: 'select-field' }, { role: 'indicator', layerId: 'select-arrow' }, { role: 'popup', layerId: 'select-popup' }], states: { select: {
        labelLayout: { coordinateSpace: 'target-component-local', x: 10, y: 5, width: 70, height: 30 },
        popupPlacement: { coordinateSpace: 'target-component-local', anchor: 'below-start', gap: 2 },
      } } },
    ],
  } as const;
  return { document, fixture, imported, target, binding };
}
