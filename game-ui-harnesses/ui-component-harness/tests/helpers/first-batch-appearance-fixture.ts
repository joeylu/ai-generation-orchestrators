import { appearanceDocumentSha256 } from '../../src/appearance-binding.ts';
import { createBundle } from '../../src/bundle.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import type { ControlStyle, UiDocument } from '../../src/tree-contract.ts';
import { fixtureLayeredZip } from './decomposition-fixture.ts';

const style: ControlStyle = { backgroundColor: '#F3F5F7', borderColor: '#315322', borderWidth: 1, cornerRadius: 8, textColor: '#243525', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 };
const area = (x: number, y: number, width: number, height: number) => ({ coordinateSpace: 'target-component-local' as const, x, y, width, height });

export async function firstBatchAppearanceFixture() {
  const document: UiDocument = { schemaVersion: '0.2', id: 'appearance-first-batch', canvas: { width: 600, height: 600 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 600, height: 600 }, props: { style }, children: [
      { id: 'apply-checkbox', type: 'CheckBox', layout: { x: 10, y: 10, width: 200, height: 50 }, props: { label: 'Hints', checked: true, enabled: true, style } },
      { id: 'apply-radio', type: 'RadioGroup', layout: { x: 10, y: 80, width: 240, height: 130 }, props: { selectedId: 'low', options: [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }], enabled: true, style } },
      { id: 'apply-input', type: 'Input', layout: { x: 10, y: 230, width: 240, height: 50 }, props: { value: '', placeholder: 'Player name', inputType: 'text', readOnly: false, maxLength: 30, enabled: true, style } },
      { id: 'apply-progress', type: 'ProgressBar', layout: { x: 10, y: 300, width: 240, height: 30 }, props: { value: 50, max: 100, style } },
      { id: 'apply-slider', type: 'Slider', layout: { x: 10, y: 360, width: 240, height: 50 }, props: { value: 50, min: 0, max: 100, step: 10, enabled: true, style } },
    ],
  } };
  const fixture = await fixtureLayeredZip([600, 600], [
    { id: 'scene-background', role: 'background', left: 0, top: 0, width: 600, height: 600 },
    { id: 'checkbox-box', role: 'important_component', left: 10, top: 20, width: 30, height: 30, color: [42, 102, 65, 255] },
    { id: 'checkbox-mark', role: 'important_component', left: 16, top: 26, width: 18, height: 18, color: [245, 235, 190, 255] },
    { id: 'radio-low-option', role: 'important_component', left: 10, top: 80, width: 240, height: 55, color: [223, 230, 211, 255] },
    { id: 'radio-low-indicator', role: 'important_component', left: 22, top: 96, width: 20, height: 20, color: [42, 102, 65, 255] },
    { id: 'radio-high-option', role: 'important_component', left: 10, top: 155, width: 240, height: 55, color: [239, 226, 187, 255] },
    { id: 'radio-high-indicator', role: 'important_component', left: 22, top: 171, width: 20, height: 20, color: [153, 104, 32, 255] },
    { id: 'input-background', role: 'important_component', left: 10, top: 230, width: 240, height: 50, color: [230, 238, 224, 255] },
    { id: 'progress-track', role: 'important_component', left: 10, top: 300, width: 240, height: 30, color: [189, 199, 184, 255] },
    { id: 'progress-fill', role: 'important_component', left: 20, top: 308, width: 220, height: 14, color: [42, 130, 75, 255] },
    { id: 'slider-track', role: 'important_component', left: 20, top: 380, width: 220, height: 10, color: [184, 190, 178, 255] },
    { id: 'slider-fill', role: 'important_component', left: 20, top: 380, width: 220, height: 10, color: [190, 135, 44, 255] },
    { id: 'slider-thumb', role: 'important_component', left: 120, top: 370, width: 20, height: 30, color: [246, 238, 207, 255] },
  ]);
  const imported = await importDecompositionZip(fixture.zip);
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Five-component deterministic appearance application fixture.' });
  const binding = {
    kind: 'ui-appearance-binding', version: '0.2', documentSha256: await appearanceDocumentSha256(document), deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256, archiveSha256: imported.archiveSha256,
    registration: { sourceCanvas: { width: 600, height: 600 }, targetCanvas: { width: 600, height: 600 }, transform: { scale: 1, offset: { x: 0, y: 0 } } }, bindings: [
      { componentId: 'apply-checkbox', componentType: 'CheckBox', parts: [{ role: 'box', layerId: 'checkbox-box' }, { role: 'mark', layerId: 'checkbox-mark' }], states: { checkBox: { labelLayout: area(50, 5, 140, 40) } } },
      { componentId: 'apply-radio', componentType: 'RadioGroup', parts: [
        { role: 'option', optionId: 'low', layerId: 'radio-low-option' }, { role: 'indicator', optionId: 'low', layerId: 'radio-low-indicator' },
        { role: 'option', optionId: 'high', layerId: 'radio-high-option' }, { role: 'indicator', optionId: 'high', layerId: 'radio-high-indicator' },
      ], states: { radioGroup: { options: [
        { optionId: 'low', hitArea: area(0, 0, 240, 55), labelLayout: area(45, 5, 180, 45) },
        { optionId: 'high', hitArea: area(0, 75, 240, 55), labelLayout: area(45, 80, 180, 45) },
      ] } } },
      { componentId: 'apply-input', componentType: 'Input', parts: [{ role: 'background', layerId: 'input-background' }], states: { input: { textLayout: area(12, 8, 216, 34), placeholderLayout: area(12, 8, 216, 34) } } },
      { componentId: 'apply-progress', componentType: 'ProgressBar', parts: [{ role: 'track', layerId: 'progress-track' }, { role: 'fill', layerId: 'progress-fill' }], states: { progressBar: { sourceState: 'full-range-template', fillClip: { ...area(10, 8, 220, 14), anchor: 'top-left', direction: 'left-to-right' } } } },
      { componentId: 'apply-slider', componentType: 'Slider', parts: [{ role: 'track', layerId: 'slider-track' }, { role: 'fill', layerId: 'slider-fill' }, { role: 'thumb', layerId: 'slider-thumb' }], states: { slider: { sourceState: 'full-range-template', fillClip: { ...area(10, 20, 220, 10), anchor: 'top-left', direction: 'left-to-right' }, thumbPositions: { coordinateSpace: 'target-component-local', anchor: 'top-left', min: { x: 10, y: 10 }, max: { x: 210, y: 10 } } } } },
    ],
  } as const;
  return { document, fixture, imported, target, binding };
}
