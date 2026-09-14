import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { importAndApplyComponentHandoff } from '../src/component-handoff.ts';
import { createBundle, validateBundle } from '../src/bundle.ts';
import { appearanceDocumentSha256 } from '../src/appearance-binding.ts';
import { nativeTabsFixture, nativeTabsHandoff } from './helpers/native-tabs-fixture.ts';

test('native Tabs import all per-tab bases and preserve unequal rectangles and gaps', async () => {
  const bundle = await importAndApplyComponentHandoff(await nativeTabsHandoff());
  const node = (bundle.document as any).root.children[0], a = node.props.appearance;
  assert.deepEqual(a.items.map((q: any) => [q.tabId, q.layout.x, q.layout.width]), [['combat', 0, 368], ['audio', 377, 276], ['accessibility', 662, 275]]);
  assert.equal(new Set(a.items.flatMap((q: any) => [q.tabImage, q.activeTabImage])).size, 6);
  assert.equal(bundle.resources.length, 12);
  await validateBundle(bundle);
});

test('native Tabs reject overlap, duplicate IDs, missing bases and mismatched native layers', async () => {
  for (const mutation of ['overlap', 'duplicate', 'missing', 'layer'] as const) {
    const f = await nativeTabsFixture(), binding = structuredClone(f.binding) as any, b = binding.bindings[0];
    if (mutation === 'overlap') b.states.tabs.items[1].layout.x = 10;
    if (mutation === 'duplicate') b.states.tabs.items[1].tabId = 'combat';
    if (mutation === 'missing') b.parts = b.parts.filter((q: any) => q.role !== 'active-tab' || q.tabId !== 'audio');
    if (mutation === 'layer') b.states.tabs.items[1].layout.width += 1;
    await assert.rejects(applyAppearanceBinding(f.target, f.imported, binding), /TAB_ITEM_OVERLAP|DUPLICATE_TAB_ITEM|MISSING_TAB_BASE_ROLE|TAB_ITEM_GEOMETRY_MISMATCH/);
  }
});

test('native Tabs direct bundles reject per-item canvas mismatch and missing resources', async () => {
  const f = await nativeTabsFixture(), bundle = await applyAppearanceBinding(f.target, f.imported, f.binding);
  const bad = structuredClone(bundle) as any;
  bad.document.root.children[0].props.appearance.items[1].tabCanvas.width += 1;
  await assert.rejects(validateBundle(bad), /TAB_ITEM_CANVAS_MISMATCH/);
  const missing = structuredClone(bundle) as any;
  const path = missing.document.root.children[0].props.appearance.items[2].activeTabImage;
  missing.resources = missing.resources.filter((r: any) => r.path !== path);
  await assert.rejects(validateBundle(missing));
});

test('native Tabs registration scales geometry once and retains original source canvases', async () => {
  const f = await nativeTabsFixture(), document = structuredClone(f.document) as any, binding = JSON.parse(JSON.stringify(f.binding));
  document.canvas = { width: 2000, height: 480 };
  const scaleLayout = (r: any) => { for (const k of ['x', 'y', 'width', 'height']) r[k] *= 2; };
  const visit = (n: any) => { scaleLayout(n.layout); n.children?.forEach(visit); }; visit(document.root);
  binding.documentSha256 = await appearanceDocumentSha256(document); binding.registration.targetCanvas = document.canvas; binding.registration.transform.scale = 2;
  const state = binding.bindings[0].states.tabs; state.headerHeight *= 2; scaleLayout(state.labelLayout); scaleLayout(state.hitArea);
  for (const item of state.items) { scaleLayout(item.layout); scaleLayout(item.labelLayout); scaleLayout(item.hitArea); }
  for (const item of state.icons) { scaleLayout(item.iconLayout); scaleLayout(item.activeIconLayout); }
  const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Registered native Tabs geometry at 2x.' });
  const applied = await applyAppearanceBinding(target, f.imported, binding);
  assert.deepEqual((applied.document as any).root.children[0].props.appearance.items.map((q: any) => q.layout.width), [368, 276, 275]);
});
