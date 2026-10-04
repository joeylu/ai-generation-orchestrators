import { layerComponentFixture } from './layer-component-fixture.ts';
import { fixtureRgbaPng } from './decomposition-fixture.ts';
import { fixtureStyle } from '../../src/fixtures.ts';
import { zip } from '../../src/reference-persistence.ts';
import { layerSha256, type LayerComponentPlan } from '../../src/layer-component.ts';
import { fixtureFindings } from './layer-planning-fixture.ts';
import type { ImageNode, UiDocument } from '../../src/tree-contract.ts';
import type { LayerAdaptation } from '../../src/layer-adaptation.ts';
import type { LayerPlanningFinding } from '../../src/layer-planning-evidence.ts';

/** Frozen source deliberately paints the opaque card after its fish artwork. */
export async function layerAdaptationFixture() {
  const fixture = await layerComponentFixture(), encoder = new TextEncoder();
  const composition = JSON.parse(new TextDecoder().decode(fixture.entries.get('composition.json')));
  composition.layers[1].name = 'Fused header with baked control pixels';
  fixture.entries.set('layers/layer-002.png', fixtureRgbaPng(60, 30, [0, 255, 0, 255]));
  composition.layers.push(
    { id: 'fish', name: 'Procedural fish artwork', role: 'foreground', path: 'layers/layer-003.png', x: 110, y: 30, width: 40, height: 20, visible: true },
    { id: 'frame', name: 'Opaque card surface', role: 'foreground', path: 'layers/layer-004.png', x: 100, y: 20, width: 80, height: 40, visible: true });
  fixture.entries.set('composition.json', encoder.encode(JSON.stringify(composition)));
  fixture.entries.set('layers/layer-003.png', fixtureRgbaPng(40, 20, [230, 40, 40, 255]));
  fixture.entries.set('layers/layer-004.png', fixtureRgbaPng(80, 40, [240, 230, 200, 255]));
  const files: Record<string, { sha256: string; bytes: number }> = {};
  for (const [path, bytes] of fixture.entries) if (path !== 'manifest.json') files[path] = { sha256: await layerSha256(bytes), bytes: bytes.length };
  fixture.entries.set('manifest.json', encoder.encode(JSON.stringify({ kind: 'ui_layers_package_v1', version: 1, files })));
  const bytes = zip(fixture.entries);
  const image = (id: string, source: string, x: number, y: number, width: number, height: number, region?: ImageNode['props']['region']): ImageNode => ({
    id, type: 'Image', layout: { x, y, width, height }, props: { source, fit: 'stretch', drawBackground: false,
      style: { ...fixtureStyle, borderWidth: 0 }, ...(region ? { region } : {}) },
  });
  const regions = [{ x: 0, y: 0, width: 60, height: 10 }, { x: 0, y: 20, width: 60, height: 10 },
    { x: 0, y: 10, width: 10, height: 10 }, { x: 50, y: 10, width: 10, height: 10 }];
  const document: UiDocument = { schemaVersion: '0.2', id: 'frozen-source-adaptation', canvas: { width: 200, height: 100 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 200, height: 100 }, props: { style: { ...fixtureStyle, borderWidth: 0 } }, children: [
      image('background', 'layers/layer-001.png', 0, 0, 200, 100),
      ...regions.map((region, index) => image(`header-${index}`, 'layers/layer-002.png', 10 + region.x, 20 + region.y, region.width, region.height, region)),
      { id: 'progress', type: 'ProgressBar', layout: { x: 20, y: 30, width: 40, height: 10 }, props: { value: 12, max: 16,
        style: { ...fixtureStyle, backgroundColor: '#F0E6C8', borderColor: '#00FF00', borderWidth: 0, cornerRadius: 0 } } },
      image('card', 'layers/layer-004.png', 100, 20, 80, 40), image('fish', 'layers/layer-003.png', 110, 30, 40, 20),
    ],
  } };
  const adaptations: LayerAdaptation[] = [
    ...regions.map((_, index) => ({ kind: 'crop' as const, componentId: `header-${index}`, sourceLayerId: 'button', reason: '保留源图周边，排除已烘焙的旧进度区域。' })),
    { kind: 'procedural-control', componentId: 'progress', reason: '缺少独立进度素材，使用明确样式的真实动态进度控件。' },
    { kind: 'reorder', componentId: 'root', reason: '卡面先绘制，鱼画后绘制，修正源包遮挡。' },
  ];
  const bindings = document.root.children.flatMap((node, index) => node.type === 'Image'
    ? [{ layerId: composition.layers.find((layer: { path: string }) => layer.path === node.props.source).id as string, pointer: `/root/children/${index}/props/source` }] : []);
  const plan: LayerComponentPlan = { ...fixture.plan, archiveSha256: await layerSha256(bytes), document, bindings, unusedLayers: [], adaptations };
  const findings: LayerPlanningFinding[] = fixtureFindings(document);
  findings.push({ componentId: 'root', pointer: '/children', basis: 'explicit-policy', note: 'Paint the opaque card before fish artwork to restore visible reference content.' });
  findings.push(...regions.map((_, index) => ({ componentId: `header-${index}`, pointer: '/props/region', basis: 'explicit-policy' as const, note: 'Explicit source crop; retained pixels remain authenticated.' })));
  const proposal = { version: '1.1', reason: 'none', missingInputs: [], archiveSha256: plan.archiveSha256, referenceSha256: await layerSha256(fixture.entries.get('reference.png')!),
    status: 'Draft', summary: '程序夹具：冻结素材在消费侧适配。', plan: { ...plan, basis: 'model-proposed' }, findings,
    issues: ['程序进度条的美术差异需要人工复核。'] };
  return { bytes, plan, proposal, entries: fixture.entries };
}
