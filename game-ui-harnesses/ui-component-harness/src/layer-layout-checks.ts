/** Explicit, source-bound layout relations. No DOM, font guesses or automatic pairing. */
import { walkNodes, type UiDocument, type UiNode, type Layout } from './tree-contract.ts';
import { isPortableLayerPlanningNote } from './layer-planning-evidence.ts';

export interface LayerSeparation {
  id: string; firstId: string; secondId: string; firstText?: string; secondText?: string;
  axis: 'x' | 'y'; minGap: number; reason: string;
}
export interface LayerLayoutChecks {
  version: '1.0'; separations: LayerSeparation[];
  unpairedText: Array<{ componentId: string; reason: string }>;
}
export interface LayerLayoutInspection {
  nodes: Array<{ id: string; visible?: boolean; bounds?: Layout;
    renderedTextBounds?: Array<{ text?: string; bounds?: Layout }> }>;
}
export interface LayerSeparationResult extends Omit<LayerSeparation, 'reason'> {
  status: 'pass' | 'fail' | 'skipped-hidden';
  firstBounds?: Layout; secondBounds?: Layout; actualGap?: number;
}
export interface LayerLayoutRenderReport {
  version: '1.0'; status: 'pass' | 'repairable'; checks: LayerSeparationResult[];
  unpairedText: LayerLayoutChecks['unpairedText'];
}
function fail(code = 'LAYER_PLAN_LAYOUT_CHECKS_INVALID'): never { throw new Error(code); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== [...keys].sort().join('|')) fail();
  return row;
}
function ownLabels(node: UiNode): string[] {
  if (node.type === 'Button') return node.props.appearance?.labelLines
    ? node.props.appearance.labelLines.lines.map(line => line.text) : [node.props.label];
  if (node.type === 'Panel' || node.type === 'Dialog') return [node.props.title];
  if (node.type === 'Tabs') return node.props.tabs.map(tab => tab.label);
  return [];
}

/** Every nonempty explicit Text is paired or carries a portable review explanation. */
export function validateLayerLayoutChecks(value: unknown, document: UiDocument): LayerLayoutChecks {
  const row = object(value, ['version', 'separations', 'unpairedText']);
  if (row.version !== '1.0' || !Array.isArray(row.separations) || row.separations.length > 2048
    || !Array.isArray(row.unpairedText) || row.unpairedText.length > 2048) fail();
  const nodes = new Map(walkNodes(document).map(node => [node.id, node]));
  const textIds = new Set([...nodes.values()].filter(node => node.type === 'Text' && node.props.text.length > 0).map(node => node.id));
  const paired = new Set<string>(), ids = new Set<string>(), pairs = new Set<string>();
  const separations = row.separations.map(value => {
    const extra = ['firstText', 'secondText'].filter(key => !!value && typeof value === 'object' && Object.hasOwn(value, key));
    const item = object(value, ['id', 'firstId', 'secondId', 'axis', 'minGap', 'reason', ...extra]);
    if (typeof item.id !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(item.id) || ids.has(item.id)
      || typeof item.firstId !== 'string' || typeof item.secondId !== 'string' || item.firstId === item.secondId
      || !['x', 'y'].includes(String(item.axis)) || typeof item.minGap !== 'number' || !Number.isFinite(item.minGap)
      || item.minGap < 0 || item.minGap > (item.axis === 'x' ? document.canvas.width : document.canvas.height)
      || !isPortableLayerPlanningNote(item.reason, 500)) fail();
    const first = nodes.get(item.firstId), second = nodes.get(item.secondId);
    const endpoint = (node: UiNode | undefined, selector: unknown, selected: boolean): boolean => {
      if (!node) fail();
      if (node.type === 'Text' || node.type === 'Image') {
        if (selected || (node.type === 'Text' && !textIds.has(node.id))) fail();
        return node.type === 'Text';
      }
      if (typeof selector !== 'string' || !selector.length || selector.length > 4096
        || ownLabels(node).filter(label => label === selector).length !== 1) fail();
      return true;
    };
    const firstIsText = endpoint(first, item.firstText, extra.includes('firstText')),
      secondIsText = endpoint(second, item.secondText, extra.includes('secondText'));
    if (!firstIsText && !secondIsText) fail();
    const key = JSON.stringify([item.firstId, item.secondId, item.axis, item.firstText, item.secondText]);
    if (pairs.has(key)) fail();
    ids.add(item.id); pairs.add(key);
    if (textIds.has(first!.id)) paired.add(first!.id);
    if (textIds.has(second!.id)) paired.add(second!.id);
    return item as unknown as LayerSeparation;
  });
  const unpaired = new Set<string>();
  const unpairedText = row.unpairedText.map(value => {
    const item = object(value, ['componentId', 'reason']);
    if (typeof item.componentId !== 'string' || !textIds.has(item.componentId) || paired.has(item.componentId)
      || unpaired.has(item.componentId) || !isPortableLayerPlanningNote(item.reason, 500)) fail();
    unpaired.add(item.componentId); return item as unknown as LayerLayoutChecks['unpairedText'][number];
  });
  if ([...textIds].some(id => !paired.has(id) && !unpaired.has(id))) fail('LAYER_PLAN_LAYOUT_COVERAGE_REQUIRED');
  return { version: '1.0', separations, unpairedText };
}

/** A completed correction may add/strengthen relations, never erase or relax them. */
export function assertLayerLayoutChecksPreserved(previous: LayerLayoutChecks | undefined, next: LayerLayoutChecks): void {
  if (!previous) return;
  for (const prior of previous.separations) {
    const current = next.separations.find(item => item.id === prior.id);
    if (!current || current.firstId !== prior.firstId || current.secondId !== prior.secondId
      || current.firstText !== prior.firstText || current.secondText !== prior.secondText
      || current.axis !== prior.axis || current.minGap < prior.minGap) fail('LAYER_PLAN_LAYOUT_CHECKS_WEAKENED');
  }
}
export function assertLayerLayoutVisibilityPreserved(previouslyVisible: ReadonlySet<string>, report: LayerLayoutRenderReport): void {
  if (report.checks.some(item => item.status === 'skipped-hidden' && previouslyVisible.has(item.id))) fail('LAYER_PLAN_LAYOUT_CHECKS_WEAKENED');
}
function measuredBounds(value: Layout | undefined): Layout {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key as keyof Layout]))
    || value.width <= 0 || value.height <= 0 || !Number.isFinite(value.x + value.width)
    || !Number.isFinite(value.y + value.height)) fail('LAYER_RENDER_MEASUREMENT_INVALID');
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

/** Text uses actual glyph bounds; Image uses its declared target rectangle (including transparent margins). */
export function checkLayerLayoutRendering(checks: LayerLayoutChecks, document: UiDocument,
  inspection: LayerLayoutInspection): LayerLayoutRenderReport {
  const nodes = new Map(walkNodes(document).map(node => [node.id, node]));
  const inspected = new Map(inspection.nodes.map(node => [node.id, node]));
  if (inspected.size !== inspection.nodes.length) fail('LAYER_RENDER_MEASUREMENT_INVALID');
  const visible = (id: string): boolean => {
    const node = inspected.get(id);
    if (!node || typeof node.visible !== 'boolean') fail('LAYER_RENDER_MEASUREMENT_INVALID');
    return node.visible;
  };
  const bounds = (id: string, selectedText: string | undefined): Layout => {
    const node = nodes.get(id), actual = inspected.get(id);
    if (!node || !actual) fail('LAYER_RENDER_MEASUREMENT_INVALID');
    if (node.type === 'Image') return measuredBounds(actual.bounds);
    const texts = selectedText === undefined ? actual.renderedTextBounds
      : actual.renderedTextBounds?.filter(glyph => glyph.text === selectedText);
    if (!texts?.length || (selectedText !== undefined && texts.length !== 1)) fail('LAYER_RENDER_MEASUREMENT_INVALID');
    const glyphs = texts.map(glyph => measuredBounds(glyph.bounds));
    const x = Math.min(...glyphs.map(glyph => glyph.x)), y = Math.min(...glyphs.map(glyph => glyph.y));
    return measuredBounds({ x, y, width: Math.max(...glyphs.map(glyph => glyph.x + glyph.width)) - x,
      height: Math.max(...glyphs.map(glyph => glyph.y + glyph.height)) - y });
  };
  const results = checks.separations.map(item => {
    const { reason: _reason, ...relation } = item;
    const firstVisible = visible(item.firstId), secondVisible = visible(item.secondId);
    if (!firstVisible || !secondVisible) return { ...relation, status: 'skipped-hidden' as const };
    const firstBounds = bounds(item.firstId, item.firstText), secondBounds = bounds(item.secondId, item.secondText);
    const actualGap = item.axis === 'x' ? secondBounds.x - firstBounds.x - firstBounds.width
      : secondBounds.y - firstBounds.y - firstBounds.height;
    // Only absorb floating-point transform noise, not a visible pixel deficit.
    return { ...relation, firstBounds, secondBounds, actualGap, status: actualGap >= item.minGap - 0.000001 ? 'pass' as const : 'fail' as const };
  });
  return { version: '1.0', status: results.some(item => item.status === 'fail') ? 'repairable' : 'pass',
    checks: results, unpairedText: checks.unpairedText.map(item => ({ ...item })) };
}
export function layerLayoutIssues(report: LayerLayoutRenderReport) {
  return report.checks.filter(item => item.status === 'fail').map(item => ({ path: `layoutChecks.separations.${item.id}`,
    code: 'LAYER_PLAN_LAYOUT_GAP', message: `${item.firstId} -> ${item.secondId}: ${item.axis} gap ${item.actualGap}px; required ${item.minGap}px.` }));
}
export class LayerLayoutRenderError extends Error {
  readonly report: LayerLayoutRenderReport;
  constructor(report: LayerLayoutRenderReport) {
    super(`LAYER_PLAN_LAYOUT_GAP: ${report.checks.find(item => item.status === 'fail')!.id}`); this.report = report;
  }
}
