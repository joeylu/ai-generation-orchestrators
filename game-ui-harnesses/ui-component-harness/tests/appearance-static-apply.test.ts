import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { appearanceDocumentSha256 } from '../src/appearance-binding.ts';
import { bundleResources, createBundle, validateBundle } from '../src/bundle.ts';
import { importDecompositionZip } from '../src/decomposition-import.ts';
import { walkNodes, type ControlStyle, type UiDocument } from '../src/tree-contract.ts';
import { fixtureLayeredZip } from './helpers/decomposition-fixture.ts';

const style: ControlStyle = {
  backgroundColor: '#1C2637', borderColor: '#A7C7EB', borderWidth: 1, cornerRadius: 6,
  textColor: '#F5F8FF', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1,
};

async function fixture() {
  const document: UiDocument = {
    schemaVersion: '0.2', id: 'static-appearance-fixture', canvas: { width: 500, height: 400 }, root: {
      id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 500, height: 400 }, props: { style }, children: [
        { id: 'container', type: 'Container', layout: { x: 20, y: 20, width: 180, height: 110 }, props: { style }, children: [] },
        { id: 'panel', type: 'Panel', layout: { x: 240, y: 20, width: 200, height: 120 }, props: { title: 'Semantic panel title', style }, children: [] },
        { id: 'image', type: 'Image', layout: { x: 20, y: 180, width: 80, height: 60 }, props: { source: 'preview.png', fit: 'contain', style } },
        { id: 'text', type: 'Text', layout: { x: 120, y: 180, width: 150, height: 30 }, props: { text: 'Live caption', wrap: 'none', overflow: 'ellipsis', lineHeight: 20, style } },
      ],
    },
  };
  const materials = await fixtureLayeredZip([500, 400], [
    { id: 'scene-background', role: 'background', left: 0, top: 0, width: 500, height: 400 },
    { id: 'container-background', role: 'important_component', left: 20, top: 20, width: 180, height: 110 },
    { id: 'panel-background', role: 'important_component', left: 240, top: 20, width: 200, height: 120 },
    { id: 'panel-header', role: 'important_component', left: 240, top: 20, width: 200, height: 32 },
    { id: 'panel-body', role: 'important_component', left: 240, top: 52, width: 200, height: 88 },
    { id: 'image-layer', role: 'important_component', left: 20, top: 180, width: 80, height: 60 },
    { id: 'text-layer', role: 'important_component', left: 120, top: 180, width: 150, height: 30 },
    { id: 'wrong-text-layer', role: 'important_component', left: 120, top: 180, width: 149, height: 30 },
    { id: 'container-foreground', role: 'important_component', left: 20, top: 20, width: 180, height: 110 },
  ]);
  const imported = await importDecompositionZip(materials.zip);
  const target = await createBundle(document, [imported.preview], {
    kind: 'programmatic-fixture', description: 'Explicit static-component appearance fixture.',
  });
  const binding = {
    kind: 'ui-appearance-binding', version: '0.2', documentSha256: await appearanceDocumentSha256(document),
    deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256, archiveSha256: imported.archiveSha256,
    registration: { sourceCanvas: { width: 500, height: 400 }, targetCanvas: { width: 500, height: 400 }, transform: { scale: 1, offset: { x: 0, y: 0 } } },
    bindings: [
      { componentId: 'image', componentType: 'Image', parts: [{ role: 'image', layerId: 'image-layer' }] },
      { componentId: 'text', componentType: 'Text', parts: [{ role: 'text', layerId: 'text-layer' }] },
      { componentId: 'container', componentType: 'Container', parts: [{ role: 'background', layerId: 'container-background' }] },
      { componentId: 'panel', componentType: 'Panel', parts: [
        { role: 'background', layerId: 'panel-background' }, { role: 'header', layerId: 'panel-header' }, { role: 'body', layerId: 'panel-body' },
      ], states: { panel: { titleLayout: { coordinateSpace: 'target-component-local', x: 12, y: 6, width: 176, height: 20 } } } },
    ],
  } as const;
  return { document, imported, target, binding };
}

function node(document: UiDocument, id: string) {
  const result = walkNodes(document).find(candidate => candidate.id === id);
  assert.ok(result, `missing ${id}`);
  return result;
}

test('v0.2 application maps Image and static surfaces while retaining semantic Text', async () => {
  const value = await fixture(); const before = structuredClone(value.target);
  const applied = await applyAppearanceBinding(value.target, value.imported, value.binding);
  await validateBundle(JSON.parse(JSON.stringify(applied)));
  assert.deepEqual(value.target, before, 'application must not mutate the captured target bundle');
  const document = applied.document as UiDocument;
  const image = node(document, 'image');
  assert.equal(image.type, 'Image');
  assert.equal(image.props.source, `appearance/${value.imported.archiveSha256}/image-layer.png`);
  assert.equal(image.props.fit, 'stretch');
  assert.equal(image.props.drawBackground, false);

  const text = node(document, 'text');
  assert.equal(text.type, 'Text');
  assert.equal(text.props.text, 'Live caption');
  assert.equal(text.props.style.textColor, style.textColor);
  assert.equal(bundleResources(applied).some(resource => resource.path.endsWith('/text-layer.png')), false, 'static text pixels must never replace semantic text');

  const container = node(document, 'container');
  assert.equal(container.type, 'Container');
  assert.deepEqual(container.props.appearance, {
    sourceCanvas: { width: 180, height: 110 },
    background: { image: `appearance/${value.imported.archiveSha256}/container-background.png`, canvas: { width: 180, height: 110 }, layout: { x: 0, y: 0, width: 180, height: 110 } },
  });

  const panel = node(document, 'panel');
  assert.equal(panel.type, 'Panel');
  assert.equal(panel.props.title, 'Semantic panel title');
  assert.deepEqual(panel.props.appearance, {
    sourceCanvas: { width: 200, height: 120 },
    background: { image: `appearance/${value.imported.archiveSha256}/panel-background.png`, canvas: { width: 200, height: 120 }, layout: { x: 0, y: 0, width: 200, height: 120 } },
    header: { image: `appearance/${value.imported.archiveSha256}/panel-header.png`, canvas: { width: 200, height: 32 }, layout: { x: 0, y: 0, width: 200, height: 32 } },
    body: { image: `appearance/${value.imported.archiveSha256}/panel-body.png`, canvas: { width: 200, height: 88 }, layout: { x: 0, y: 32, width: 200, height: 88 } },
    titleLayout: { x: 12, y: 6, width: 176, height: 20 },
  });
  assert.equal(bundleResources(applied).filter(resource => resource.path.startsWith(`appearance/${value.imported.archiveSha256}/`)).length, 5);
});

test('static application fails closed for stale text pixels, unsupported container foregrounds, and invalid panel title geometry', async () => {
  const value = await fixture();
  const staleText = structuredClone(value.binding) as any;
  staleText.bindings.find((binding: any) => binding.componentType === 'Text').parts[0].layerId = 'wrong-text-layer';
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, staleText), (error: unknown) => error instanceof HarnessError
    && error.issues.some(issue => issue.code === 'COMPONENT_LAYER_GEOMETRY_MISMATCH'));

  const foreground = structuredClone(value.binding) as any;
  foreground.bindings.find((binding: any) => binding.componentType === 'Container').parts.push({ role: 'foreground', layerId: 'container-foreground' });
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, foreground), (error: unknown) => error instanceof HarnessError
    && error.issues.some(issue => issue.code === 'ROLE_NOT_ALLOWED'));

  const title = structuredClone(value.binding) as any;
  title.bindings.find((binding: any) => binding.componentType === 'Panel').states.panel.titleLayout.width = 201;
  await assert.rejects(applyAppearanceBinding(value.target, value.imported, title), (error: unknown) => error instanceof HarnessError
    && error.issues.some(issue => issue.code === 'LABEL_LAYOUT_OUT_OF_BOUNDS'));
});
