import { appearanceDocumentSha256 } from '../../src/appearance-binding.ts';
import { createBundle } from '../../src/bundle.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import type { ControlStyle, UiDocument } from '../../src/tree-contract.ts';
import { fixtureLayeredZip } from './decomposition-fixture.ts';

const style: ControlStyle = { backgroundColor: '#F3F5F7', borderColor: '#315322', borderWidth: 1, cornerRadius: 8, textColor: '#243525', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 };
const area = (coordinateSpace: 'target-component-local' | 'target-item-local', x: number, y: number, width: number, height: number) => ({ coordinateSpace, x, y, width, height });

export async function secondBatchAppearanceFixture() {
  const document: UiDocument = { schemaVersion: '0.2', id: 'appearance-second-batch', canvas: { width: 800, height: 760 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 800, height: 760 }, props: { style }, children: [
      { id: 'apply-scroll', type: 'ScrollView', layout: { x: 10, y: 10, width: 200, height: 120 }, props: { scrollX: 0, scrollY: 60, contentWidth: 200, contentHeight: 240, style }, children: [] },
      { id: 'apply-list', type: 'List', layout: { x: 250, y: 10, width: 200, height: 100 }, props: { selectedId: 'second', items: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }], itemTemplate: 'text-row', itemHeight: 50, enabled: true, style }, children: [] },
      { id: 'apply-dialog', type: 'Dialog', layout: { x: 50, y: 180, width: 300, height: 200 }, props: { open: true, title: 'Settings', modal: true, style }, children: [] },
      { id: 'apply-tabs', type: 'Tabs', layout: { x: 50, y: 420, width: 400, height: 160 }, props: { activeId: 'tab-b', tabs: [{ id: 'tab-a', label: 'A', contentId: 'content-a' }, { id: 'tab-b', label: 'B', contentId: 'content-b' }], enabled: true, style }, children: [
        { id: 'content-a', type: 'Container', layout: { x: 0, y: 40, width: 400, height: 120 }, props: { style }, children: [] },
        { id: 'content-b', type: 'Container', layout: { x: 0, y: 40, width: 400, height: 120 }, props: { style }, children: [] },
      ] },
      { id: 'apply-image', type: 'Image', layout: { x: 500, y: 10, width: 100, height: 80 }, props: { source: 'preview.png', fit: 'contain', style } },
      { id: 'apply-text', type: 'Text', layout: { x: 500, y: 110, width: 180, height: 30 }, props: { text: 'Live semantic text', wrap: 'none', overflow: 'ellipsis', lineHeight: 22, style } },
      { id: 'apply-container', type: 'Container', layout: { x: 500, y: 160, width: 180, height: 100 }, props: { style }, children: [] },
      { id: 'apply-panel', type: 'Panel', layout: { x: 500, y: 290, width: 220, height: 120 }, props: { title: 'Profile', style }, children: [] },
    ],
  } };
  const fixture = await fixtureLayeredZip([800, 760], [
    { id: 'scene-background', role: 'background', left: 0, top: 0, width: 800, height: 760 },
    { id: 'scroll-viewport', role: 'important_component', left: 10, top: 10, width: 200, height: 120, color: [224, 235, 241, 255] },
    { id: 'scroll-track', role: 'important_component', left: 190, top: 20, width: 10, height: 100, color: [180, 192, 198, 255] },
    { id: 'scroll-thumb', role: 'important_component', left: 190, top: 55, width: 10, height: 20, color: [55, 109, 138, 255] },
    { id: 'list-background', role: 'important_component', left: 250, top: 10, width: 200, height: 100, color: [235, 238, 229, 255] },
    { id: 'list-row', role: 'important_component', left: 250, top: 10, width: 200, height: 50, color: [245, 241, 220, 255] },
    { id: 'list-selected', role: 'important_component', left: 250, top: 60, width: 200, height: 50, color: [204, 224, 191, 255] },
    { id: 'dialog-overlay', role: 'important_component', left: 0, top: 0, width: 800, height: 760, color: [25, 42, 53, 120] },
    { id: 'dialog-background', role: 'important_component', left: 50, top: 180, width: 300, height: 200, color: [244, 239, 219, 255] },
    { id: 'dialog-header', role: 'important_component', left: 50, top: 180, width: 300, height: 50, color: [174, 133, 52, 255] },
    { id: 'dialog-body', role: 'important_component', left: 50, top: 230, width: 300, height: 150, color: [237, 229, 198, 255] },
    { id: 'tab-inactive', role: 'important_component', left: 50, top: 420, width: 200, height: 40, color: [202, 207, 198, 255] },
    { id: 'tab-active', role: 'important_component', left: 250, top: 420, width: 200, height: 40, color: [75, 124, 72, 255] },
    { id: 'image-layer', role: 'important_component', left: 500, top: 10, width: 100, height: 80, color: [76, 132, 171, 255] },
    { id: 'text-layer', role: 'important_component', left: 500, top: 110, width: 180, height: 30, color: [229, 232, 218, 255] },
    { id: 'container-background', role: 'important_component', left: 500, top: 160, width: 180, height: 100, color: [209, 224, 235, 255] },
    { id: 'panel-background', role: 'important_component', left: 500, top: 290, width: 220, height: 120, color: [238, 230, 204, 255] },
    { id: 'panel-header', role: 'important_component', left: 500, top: 290, width: 220, height: 36, color: [118, 91, 47, 255] },
    { id: 'panel-body', role: 'important_component', left: 500, top: 326, width: 220, height: 84, color: [245, 239, 217, 255] },
  ]);
  const imported = await importDecompositionZip(fixture.zip);
  const target = await createBundle(document, [imported.preview], { kind: 'programmatic-fixture', description: 'Eight-component deterministic appearance fixture.' });
  const binding = { kind: 'ui-appearance-binding', version: '0.2', documentSha256: await appearanceDocumentSha256(document), deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256, archiveSha256: imported.archiveSha256,
    registration: { sourceCanvas: { width: 800, height: 760 }, targetCanvas: { width: 800, height: 760 }, transform: { scale: 1, offset: { x: 0, y: 0 } } }, bindings: [
      { componentId: 'apply-scroll', componentType: 'ScrollView', parts: [{ role: 'viewport', layerId: 'scroll-viewport' }, { role: 'scrollbar-track', layerId: 'scroll-track' }, { role: 'scrollbar-thumb', layerId: 'scroll-thumb' }], states: { scrollView: { thumbPositions: { coordinateSpace: 'target-component-local', anchor: 'top-left', min: { x: 180, y: 10 }, max: { x: 180, y: 80 } } } } },
      { componentId: 'apply-list', componentType: 'List', parts: [{ role: 'background', layerId: 'list-background' }, { role: 'row', layerId: 'list-row', itemId: 'first' }, { role: 'selected-row', layerId: 'list-selected', itemId: 'second' }], states: { list: { labelLayout: area('target-item-local', 12, 5, 176, 40), hitArea: area('target-item-local', 0, 0, 200, 50) } } },
      { componentId: 'apply-dialog', componentType: 'Dialog', parts: [{ role: 'background', layerId: 'dialog-background' }, { role: 'header', layerId: 'dialog-header' }, { role: 'body', layerId: 'dialog-body' }, { role: 'overlay', layerId: 'dialog-overlay' }], states: { dialog: { titleLayout: area('target-component-local', 12, 5, 276, 40) } } },
      { componentId: 'apply-tabs', componentType: 'Tabs', parts: [{ role: 'tab', layerId: 'tab-inactive', tabId: 'tab-a' }, { role: 'active-tab', layerId: 'tab-active', tabId: 'tab-b' }], states: { tabs: { headerHeight: 40, labelLayout: area('target-item-local', 10, 5, 180, 30), hitArea: area('target-item-local', 0, 0, 200, 40) } } },
      { componentId: 'apply-image', componentType: 'Image', parts: [{ role: 'image', layerId: 'image-layer' }] },
      { componentId: 'apply-text', componentType: 'Text', parts: [{ role: 'text', layerId: 'text-layer' }] },
      { componentId: 'apply-container', componentType: 'Container', parts: [{ role: 'background', layerId: 'container-background' }] },
      { componentId: 'apply-panel', componentType: 'Panel', parts: [{ role: 'background', layerId: 'panel-background' }, { role: 'header', layerId: 'panel-header' }, { role: 'body', layerId: 'panel-body' }], states: { panel: { titleLayout: area('target-component-local', 12, 6, 196, 24) } } },
    ] } as const;
  return { document, fixture, imported, target, binding };
}
