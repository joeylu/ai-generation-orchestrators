import { createHash } from 'node:crypto';
import { appearanceDocumentSha256, type AppearanceBindingDocument, type AppearancePartBinding } from '../../src/appearance-binding.ts';
import { createBundle } from '../../src/bundle.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import type { ControlStyle, UiDocument } from '../../src/tree-contract.ts';
import { fixtureLayeredZip, forceZip64Stored, type LayeredFixtureInput } from './decomposition-fixture.ts';

const style: ControlStyle = { backgroundColor: '#101820', borderColor: '#101820', borderWidth: 0, cornerRadius: 0, textColor: '#E4F2FC', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 };
export const nativeTabCells = [{ id: 'combat', x: 0, width: 368 }, { id: 'audio', x: 377, width: 276 }, { id: 'accessibility', x: 662, width: 275 }];
const local = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const itemLocal = (x: number, y: number, width: number, height: number) => ({ coordinateSpace: 'target-item-local' as const, ...local(x, y, width, height) });

export async function nativeTabsFixture() {
  const document: UiDocument = { schemaVersion: '0.2', id: 'native-tabs-fixture', canvas: { width: 1000, height: 240 }, root: {
    id: 'root', type: 'Container', layout: local(0, 0, 1000, 240), props: { style }, children: [{
      id: 'native-tabs', type: 'Tabs', layout: local(20, 20, 937, 160), props: {
        activeId: 'combat', tabs: nativeTabCells.map(q => ({ id: q.id, label: q.id.toUpperCase(), contentId: q.id + '-content' })), enabled: true, style,
      }, children: nativeTabCells.map(q => ({ id: q.id + '-content', type: 'Container', layout: local(0, 94, 937, 66), props: { style }, children: [] })),
    }],
  } };
  const layers: LayeredFixtureInput[] = [{ id: 'scene-background', role: 'background', left: 0, top: 0, width: 1000, height: 240 }];
  const parts: AppearancePartBinding[] = [];
  for (const [index, q] of nativeTabCells.entries()) {
    for (const [role, color] of [['tab', [30 + index * 30, 50, 70, 255]], ['active-tab', [20, 150 + index * 30, 210, 255]]] as const) {
      const id = q.id + '-' + role;
      layers.push({ id, role: 'important_component', left: 20 + q.x, top: 20, width: q.width, height: 94, color });
      parts.push({ role, layerId: id, tabId: q.id });
    }
    for (const [role, color] of [['icon', [180, 90, 60, 255]], ['active-icon', [250, 240, 210, 255]]] as const) {
      const id = q.id + '-' + role;
      layers.push({ id, role: 'important_component', left: 20 + q.x + 15, top: 50, width: 32, height: 32, color });
      parts.push({ role, layerId: id, tabId: q.id });
    }
  }
  const fixture = await fixtureLayeredZip([1000, 240], layers), imported = await importDecompositionZip(fixture.zip);
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Unequal native Tabs rectangles with gaps, per-tab bases and icons. No generated artwork.' });
  const items = nativeTabCells.map(q => ({ tabId: q.id, layout: { coordinateSpace: 'target-component-local' as const, ...local(q.x, 0, q.width, 94) }, labelLayout: itemLocal(60, 26, q.width - 80, 42), hitArea: itemLocal(0, 0, q.width, 94) }));
  const binding: AppearanceBindingDocument = { kind: 'ui-appearance-binding', version: '0.2', documentSha256: await appearanceDocumentSha256(document), deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256, archiveSha256: imported.archiveSha256,
    registration: { sourceCanvas: document.canvas, targetCanvas: document.canvas, transform: { scale: 1, offset: { x: 0, y: 0 } } }, bindings: [{ componentId: 'native-tabs', componentType: 'Tabs', parts, states: { tabs: {
      headerHeight: 94, labelLayout: items[0].labelLayout, hitArea: items[0].hitArea, items,
      icons: nativeTabCells.map(q => ({ tabId: q.id, iconLayout: itemLocal(15, 30, 32, 32), activeIconLayout: itemLocal(15, 30, 32, 32) })),
    } } }],
  };
  return { document, fixture, imported, target, binding };
}

export async function nativeTabsHandoff() {
  const f = await nativeTabsFixture();
  const bytes = (v: unknown) => Buffer.from(JSON.stringify(v)), hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
  const bundle = bytes(f.target), binding = bytes(f.binding);
  const manifest = { kind: 'ai_ui_component_handoff_v1', status: 'contracts_packaged_unreviewed_draft', decomposition: { path: 'decomposition/ui.draft.zip', sha256: hash(f.fixture.zip) }, component_bundle: { path: 'component.ui-bundle.json', sha256: hash(bundle) }, appearance_binding: { path: 'appearance-binding.json', sha256: hash(binding) }, delivery_policy: 'unreviewed_draft', human_visual_acceptance: false };
  return forceZip64Stored([{ name: 'handoff.json', bytes: bytes(manifest) }, { name: 'decomposition/ui.draft.zip', bytes: f.fixture.zip }, { name: 'component.ui-bundle.json', bytes: bundle }, { name: 'appearance-binding.json', bytes: binding }]);
}
