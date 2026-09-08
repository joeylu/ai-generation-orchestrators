import type { ControlStyle, UiDocument, UiNode } from './tree-contract.ts';
import type { TreeIntent, TreePolicy } from './tree-compiler.ts';
import type { MotionDocument } from './motion.ts';

export const fixtureStyle: ControlStyle = {
  backgroundColor: '#FFFFFF', borderColor: '#C8D5E5', borderWidth: 1,
  cornerRadius: 8, textColor: '#223653', fontFamily: 'sans-serif', fontSize: 16,
  fontWeight: 'normal', opacity: 1,
};
const style = (overrides: Partial<ControlStyle> = {}) => ({ ...fixtureStyle, ...overrides });
const layout = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const text = (id: string, value: string, x: number, y: number, width: number, height = 30, overrides: Partial<ControlStyle> = {}): UiNode => ({
  id, type: 'Text', layout: layout(x, y, width, height),
  props: { text: value, style: style({ borderWidth: 0, ...overrides }), wrap: 'none', overflow: 'error', lineHeight: (overrides.fontSize ?? fixtureStyle.fontSize) * 1.25 },
});
function composite(x: number, y: number): UiNode {
  return { id: 'balance', type: 'Container', layout: layout(x, y, 380, 84), props: { style: style({ borderWidth: 0 }) }, children: [
    { id: 'balance-plate', type: 'Image', layout: layout(0, 0, 380, 84), props: { source: 'fixtures/plate.svg', fit: 'stretch', style: style({ borderWidth: 0 }) } },
    { id: 'balance-gem', type: 'Image', layout: layout(18, 18, 48, 48), props: { source: 'fixtures/gem.svg', fit: 'contain', style: style({ borderWidth: 0 }) } },
    text('balance-label', '1,580', 91, 21, 252, 40, { fontSize: 28, fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: '#172B4D' }),
  ] };
}
export function fixtureDocument(kind: 'composite' | 'gallery'): UiDocument {
  const nodes: UiNode[] = [
    text('heading', kind === 'gallery' ? 'COMPONENT LAB' : 'A COMPOSABLE COMPONENT', 28, 22, 620, 36, { fontSize: 22, fontWeight: 'bold' }),
    composite(28, 78),
    { id: 'confirm', type: 'Button', layout: layout(450, 90, 175, 56), props: { label: '', enabled: true, style: style({ backgroundColor: '#DBF6ED', borderColor: '#85CCB6' }) }, children: [
      { id: 'confirm-icon', type: 'Image', layout: layout(12, 12, 32, 32), props: { source: 'fixtures/gem.svg', fit: 'contain', style: style({ borderWidth: 0 }) } },
      text('confirm-label', 'Confirm', 57, 17, 108, 26, { fontWeight: 'bold', backgroundColor: '#DBF6ED' }),
    ] },
  ];
  if (kind === 'gallery') nodes.push(
    text('group-toggle', 'STATE & SELECTION', 28, 188, 470, 28, { fontSize: 12, fontWeight: 'bold' }),
    { id: 'sound', type: 'Switch', layout: layout(28, 229, 244, 46), props: { label: 'Sound', checked: true, enabled: true, style: style() } },
    { id: 'tips', type: 'CheckBox', layout: layout(316, 229, 260, 46), props: { label: 'Show hints', checked: false, enabled: true, style: style() } },
    { id: 'quality', type: 'RadioGroup', layout: layout(610, 207, 270, 124), props: { selectedId: 'quality-high', options: [{ id: 'quality-low', label: 'Balanced' }, { id: 'quality-high', label: 'High quality' }], enabled: true, style: style() } },
    text('group-value', 'VALUE & INPUT', 28, 314, 470, 28, { fontSize: 12, fontWeight: 'bold' }),
    { id: 'progress', type: 'ProgressBar', layout: layout(28, 356, 244, 22), props: { value: 65, max: 100, style: style() } },
    { id: 'volume', type: 'Slider', layout: layout(28, 396, 244, 42), props: { value: 40, min: 0, max: 100, step: 5, enabled: true, style: style() } },
    { id: 'name', type: 'Input', layout: layout(316, 357, 260, 46), props: { value: 'Hello UI', placeholder: 'Your name', inputType: 'text', enabled: true, readOnly: false, maxLength: 32, style: style() } },
    { id: 'region', type: 'Select', layout: layout(610, 357, 270, 46), props: { selectedId: 'region-east', options: [{ id: 'region-east', label: 'East coast' }, { id: 'region-west', label: 'West coast' }], enabled: true, style: style() } },
    text('group-structure', 'CONTENT & COMPOSITION', 28, 469, 560, 28, { fontSize: 12, fontWeight: 'bold' }),
    { id: 'scroll', type: 'ScrollView', layout: layout(28, 510, 244, 177), props: { scrollX: 0, scrollY: 0, contentWidth: 244, contentHeight: 370, style: style() }, children: Array.from({ length: 6 }, (_, i) => ({ id: `scroll-row-${i}`, type: 'Panel' as const, layout: layout(10, 10 + i * 59, 221, 48), props: { title: `Resource ${i + 1}`, style: style({ backgroundColor: i % 2 ? '#E8F3EE' : '#EEF3F9', fontSize: 14 }) }, children: [] })) },
    { id: 'inventory', type: 'List', layout: layout(316, 510, 260, 177), props: { selectedId: 'item-coin', items: [{ id: 'item-coin', label: 'Coin bundle' }, { id: 'item-gem', label: 'Gem bundle' }, { id: 'item-key', label: 'Silver key' }], enabled: true, itemTemplate: 'text-row', itemHeight: 48, style: style() }, children: [] },
    { id: 'details', type: 'Tabs', layout: layout(610, 510, 270, 177), props: { activeId: 'tab-info', tabs: [{ id: 'tab-info', label: 'Info', contentId: 'page-info' }, { id: 'tab-stats', label: 'Stats', contentId: 'page-stats' }], enabled: true, style: style() }, children: [text('page-info', 'A reusable component.', 14, 61, 242, 50, { fontSize: 15 }), text('page-stats', 'Instances: 16 types', 14, 61, 242, 50, { fontSize: 15 })] },
    { id: 'footer-panel', type: 'Panel', layout: layout(28, 717, 852, 88), props: { title: 'PROCEDURAL ENGINEERING FIXTURE', style: style({ fontSize: 12 }) }, children: [text('footer-text', 'Explicit resources, styles and layout. No screenshot was decomposed.', 16, 41, 810, 27, { fontSize: 14 })] },
    { id: 'dialog', type: 'Dialog', layout: layout(260, 230, 390, 235), props: { open: false, title: 'Modal dialog', modal: true, style: style({ borderColor: '#85CCB6', borderWidth: 2 }) }, children: [text('dialog-copy', 'Background input is blocked.', 24, 65, 345, 36), { id: 'dialog-close', type: 'Button', layout: layout(24, 145, 342, 54), props: { label: 'Close dialog', enabled: true, style: style({ backgroundColor: '#DBF6ED' }) }, children: [] }] },
  );
  return { schemaVersion: '0.2', id: `fixture-${kind}`, canvas: { width: 920, height: kind === 'gallery' ? 834 : 250 }, root: { id: 'root', type: 'Container', layout: layout(0, 0, 920, kind === 'gallery' ? 834 : 250), props: { style: style({ borderWidth: 0 }) }, children: nodes } };
}
/** Known procedural layout is explicit input, never an alleged vision measurement. */
export function fixtureInputs(kind: 'composite' | 'gallery'): { intent: TreeIntent; policy: TreePolicy; motion: MotionDocument } {
  const document = fixtureDocument(kind);
  const positions: Record<string, UiNode['layout']> = {};
  const convert = (node: UiNode): unknown => {
    positions[node.id] = structuredClone(node.layout);
    const result: Record<string, unknown> = { id: node.id, componentType: node.type, props: structuredClone(node.props) };
    if ('children' in node) result.children = node.children.map(convert);
    return result;
  };
  return {
    intent: { intentVersion: '0.2', id: document.id, root: convert(document.root) } as TreeIntent,
    policy: { canvas: document.canvas, layout: positions, layoutSource: { kind: 'explicit', description: 'Programmatic engineering fixture with independent SVG plate/icon and editable text. Not vision analysis.' } },
    motion: { motionVersion: '0.1', id: 'fixture-entrance', scope: 'canvas', duration: 1100, trigger: { type: 'manual' }, tracks: [
      { targetId: 'balance', property: 'x', start: 0, duration: 600, from: -16, to: 0, easing: 'ease-out' },
      { targetId: 'balance', property: 'alpha', start: 0, duration: 600, from: 0.2, to: 1, easing: 'linear' },
      { targetId: 'confirm', property: 'scaleX', start: 250, duration: 600, from: 0.92, to: 1, easing: 'ease-out' },
      { targetId: 'confirm', property: 'scaleY', start: 250, duration: 600, from: 0.92, to: 1, easing: 'ease-out' },
    ] },
  };
}
