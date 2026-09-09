import { compileTree, validateTreeIntent, type ImageFactsMap, type TreeIntent, type TreePolicy } from './tree-compiler.ts';
import { MAX_TREE_DEPTH, MAX_TREE_NODES, type ControlStyle, type Layout, type UiNodeType } from './tree-contract.ts';

/** The v0.2 service supplied layout boxes are explicit data, not inferred by this decoder. */
export const FLAT_LAYOUT_DESCRIPTION = 'Flat vision v0.2 supplied layout boxes.';

export type FlatVisionSource = Pick<{
  path: string;
  sha256: string;
  width: number;
  height: number;
}, 'path' | 'sha256' | 'width' | 'height'>;

export type NormalizedFlatVisionResult =
  | { version: '0.1'; sourceSha256: string; status: 'Ready'; summary: string; intent: TreeIntent; policy: TreePolicy }
  | { version: '0.1'; sourceSha256: string; status: 'Unresolved' | 'Custom-required'; summary: string };

type Classification = 'artwork' | 'text' | 'control' | 'composite';
type FlatStyle = { id: string } & ControlStyle;
type FlatNode = {
  id: string;
  parentId: string | null;
  componentType: UiNodeType;
  styleId: string;
  props: Record<string, unknown>;
  layout: Layout;
};
type NestedNode = { id: string; componentType: UiNodeType; props: Record<string, unknown>; children?: NestedNode[] };

const NODE_TYPES = new Set<UiNodeType>([
  'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
  'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
]);
const COMPOSITE_TYPES = new Set<UiNodeType>(['Container', 'Button', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs']);
const CONTROL_TYPES = new Set<UiNodeType>([
  'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select', 'ProgressBar', 'Slider',
  'ScrollView', 'List', 'Tabs',
]);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._-]*$/;
const READY_KEYS = ['version', 'sourceSha256', 'status', 'summary', 'classification', 'observedTypes', 'documentId', 'canvas', 'styles', 'nodes'] as const;
const NON_READY_KEYS = ['version', 'sourceSha256', 'status', 'summary'] as const;
const STYLE_KEYS = ['id', 'backgroundColor', 'borderColor', 'borderWidth', 'cornerRadius', 'textColor', 'fontFamily', 'fontSize', 'fontWeight', 'opacity'] as const;
const NODE_KEYS = ['id', 'parentId', 'componentType', 'styleId', 'props', 'layout'] as const;
const LAYOUT_KEYS = ['x', 'y', 'width', 'height'] as const;
const CANVAS_KEYS = ['width', 'height'] as const;

/** Stable decoder failures that callers may preserve without exposing provider detail. */
export const FLAT_VISION_ERROR_CODES = [
  'VISION_INVALID_RESPONSE',
  'VISION_SEMANTIC_COVERAGE_MISMATCH',
  'VISION_HIDDEN_SEMANTIC_NODE',
  'VISION_IMAGE_FALLBACK',
  'VISION_UNUSED_STYLE',
  'VISION_UNKNOWN_STYLE',
  'VISION_DUPLICATE_STYLE_ID',
  'VISION_UNKNOWN_PARENT',
  'VISION_PARENT_NOT_COMPOSITE',
  'VISION_DUPLICATE_NODE_ID',
  'VISION_TREE_CYCLE',
  'VISION_ROOT_REQUIRED',
  'VISION_MULTIPLE_ROOTS',
  'VISION_TREE_DEPTH_LIMIT',
  'VISION_TREE_NODE_LIMIT',
  'VISION_UNAVAILABLE_RESOURCE',
  'VISION_CANVAS_LIMIT',
] as const;
export type FlatVisionErrorCode = typeof FLAT_VISION_ERROR_CODES[number];

function fail(code: FlatVisionErrorCode): never { throw new Error(code); }
function invalid(): never { return fail('VISION_INVALID_RESPONSE'); }

function strictRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (keys.some(key => !Object.hasOwn(record, key)) || Object.keys(record).some(key => !keys.includes(key))) invalid();
  return record;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function clone<T>(value: T): T {
  try { return structuredClone(value); }
  catch { return invalid(); }
}

function validSummary(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 2_000;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function parseStyle(value: unknown): FlatStyle {
  const style = strictRecord(value, STYLE_KEYS);
  if (!validIdentifier(style.id)) invalid();
  return style as unknown as FlatStyle;
}

function parseNode(value: unknown): FlatNode {
  const node = strictRecord(value, NODE_KEYS);
  if (!validIdentifier(node.id) || !validIdentifier(node.styleId)
    || (node.parentId !== null && !validIdentifier(node.parentId))
    || typeof node.componentType !== 'string' || !NODE_TYPES.has(node.componentType as UiNodeType)) invalid();
  const props = objectRecord(node.props);
  // Styles travel only through the referenced style table; never accept a hidden override.
  if (Object.hasOwn(props, 'style')) invalid();
  strictRecord(node.layout, LAYOUT_KEYS);
  return {
    id: node.id,
    parentId: node.parentId as string | null,
    componentType: node.componentType as UiNodeType,
    styleId: node.styleId,
    props,
    layout: node.layout as Layout,
  };
}

function parseObservedTypes(value: unknown): UiNodeType[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > NODE_TYPES.size) invalid();
  const observed: UiNodeType[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !NODE_TYPES.has(entry as UiNodeType) || observed.includes(entry as UiNodeType)) invalid();
    observed.push(entry as UiNodeType);
  }
  return observed;
}

function hasVisibleStyleChain(node: FlatNode, byId: ReadonlyMap<string, FlatNode>, styles: ReadonlyMap<string, FlatStyle>): boolean {
  let current: FlatNode | undefined = node;
  while (current) {
    const opacity = styles.get(current.styleId)!.opacity;
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity <= 0) return false;
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return true;
}

function validateClassification(classification: Classification, observed: readonly UiNodeType[], nodes: readonly FlatNode[], styles: ReadonlyMap<string, FlatStyle>): void {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const nodeTypes = new Set(nodes.map(node => node.componentType));
  if (observed.length !== nodeTypes.size || observed.some(type => !nodeTypes.has(type)) || [...nodeTypes].some(type => !observed.includes(type))) {
    fail('VISION_SEMANTIC_COVERAGE_MISMATCH');
  }
  for (const type of observed) {
    const matchingNodes = nodes.filter(node => node.componentType === type);
    if (!matchingNodes.some(node => hasVisibleStyleChain(node, byId, styles))) fail('VISION_HIDDEN_SEMANTIC_NODE');
  }
  if (classification === 'artwork') {
    if (observed.length !== 1 || observed[0] !== 'Image' || nodes.some(node => node.componentType !== 'Image')) invalid();
    return;
  }
  if (nodes.every(node => node.componentType === 'Image')) fail('VISION_IMAGE_FALLBACK');
  if (classification === 'text') {
    if (!observed.includes('Text')) invalid();
    return;
  }
  if (classification === 'control') {
    if (!observed.some(type => CONTROL_TYPES.has(type))) invalid();
    return;
  }
  if (classification === 'composite') {
    if (!nodes.some(node => COMPOSITE_TYPES.has(node.componentType))
      || !nodes.some(node => node.componentType !== 'Image') || !observed.some(type => type !== 'Image')) invalid();
    return;
  }
  invalid();
}

function validateHierarchy(nodes: readonly FlatNode[], styles: ReadonlyMap<string, FlatStyle>): void {
  if (nodes.length === 0) fail('VISION_ROOT_REQUIRED');
  if (nodes.length > MAX_TREE_NODES) fail('VISION_TREE_NODE_LIMIT');
  const byId = new Map<string, FlatNode>();
  const usedStyleIds = new Set<string>();
  for (const node of nodes) {
    if (byId.has(node.id)) fail('VISION_DUPLICATE_NODE_ID');
    if (!styles.has(node.styleId)) fail('VISION_UNKNOWN_STYLE');
    byId.set(node.id, node); usedStyleIds.add(node.styleId);
  }
  for (const styleId of styles.keys()) if (!usedStyleIds.has(styleId)) fail('VISION_UNUSED_STYLE');
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const parent = byId.get(node.parentId);
    if (!parent) fail('VISION_UNKNOWN_PARENT');
    if (!COMPOSITE_TYPES.has(parent.componentType)) fail('VISION_PARENT_NOT_COMPOSITE');
  }
  for (const node of nodes) {
    const visited = new Set<string>();
    let current: FlatNode | undefined = node;
    let depth = 0;
    while (current) {
      if (visited.has(current.id)) fail('VISION_TREE_CYCLE');
      visited.add(current.id);
      depth += 1;
      if (depth > MAX_TREE_DEPTH) fail('VISION_TREE_DEPTH_LIMIT');
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  const roots = nodes.filter(node => node.parentId === null);
  if (roots.length === 0) fail('VISION_ROOT_REQUIRED');
  if (roots.length > 1) fail('VISION_MULTIPLE_ROOTS');
}

function requireImageFacts(nodes: readonly FlatNode[], source: FlatVisionSource): ImageFactsMap {
  let hasImage = false;
  for (const node of nodes) {
    if (node.componentType === 'Image') {
      hasImage = true;
      if (node.props.source !== source.path) fail('VISION_UNAVAILABLE_RESOURCE');
    }
    if (node.componentType === 'Text' && Object.hasOwn(node.props, 'fontSource')) fail('VISION_UNAVAILABLE_RESOURCE');
  }
  return hasImage ? { [source.path]: { width: source.width, height: source.height } } : {};
}

function assembleIntent(documentId: string, nodes: readonly FlatNode[], styles: ReadonlyMap<string, FlatStyle>): TreeIntent {
  const nestedById = new Map<string, NestedNode>();
  for (const flat of nodes) {
    const rawStyle = clone(styles.get(flat.styleId)!);
    const { id: _styleId, ...style } = rawStyle;
    const nested: NestedNode = {
      id: flat.id,
      componentType: flat.componentType,
      props: { ...clone(flat.props), style },
    };
    if (COMPOSITE_TYPES.has(flat.componentType)) nested.children = [];
    nestedById.set(flat.id, nested);
  }
  let root: NestedNode | undefined;
  // Iterating in wire order preserves the required sibling order exactly.
  for (const flat of nodes) {
    const nested = nestedById.get(flat.id)!;
    if (flat.parentId === null) root = nested;
    else nestedById.get(flat.parentId)!.children!.push(nested);
  }
  if (!root) invalid();
  return validateTreeIntent({ intentVersion: '0.2', id: documentId, root });
}

/**
 * Decodes a provider-neutral flat v0.2 response into the existing strict v0.1
 * vision envelope. The provider supplies every property, style, and layout box;
 * this function only expands style references and parent links.
 */
export function normalizeFlatVisionResult(value: unknown, source: FlatVisionSource): NormalizedFlatVisionResult {
  const envelope = objectRecord(value);
  if (envelope.status === 'Unresolved' || envelope.status === 'Custom-required') {
    strictRecord(envelope, NON_READY_KEYS);
    if (envelope.version !== '0.2' || envelope.sourceSha256 !== source.sha256 || !validSummary(envelope.summary)) invalid();
    return { version: '0.1', sourceSha256: source.sha256, status: envelope.status, summary: envelope.summary };
  }

  strictRecord(envelope, READY_KEYS);
  if (envelope.version !== '0.2' || envelope.sourceSha256 !== source.sha256 || envelope.status !== 'Ready'
    || !validSummary(envelope.summary) || !validIdentifier(envelope.documentId)
    || typeof envelope.classification !== 'string'
    || !(['artwork', 'text', 'control', 'composite'] as const).includes(envelope.classification as Classification)
    || !Array.isArray(envelope.styles) || envelope.styles.length === 0 || envelope.styles.length > MAX_TREE_NODES
    || !Array.isArray(envelope.nodes)) invalid();
  if (envelope.nodes.length === 0) fail('VISION_ROOT_REQUIRED');
  if (envelope.nodes.length > MAX_TREE_NODES) fail('VISION_TREE_NODE_LIMIT');

  strictRecord(envelope.canvas, CANVAS_KEYS);
  const observed = parseObservedTypes(envelope.observedTypes);
  const styles = new Map<string, FlatStyle>();
  for (const rawStyle of envelope.styles) {
    const style = parseStyle(rawStyle);
    if (styles.has(style.id)) fail('VISION_DUPLICATE_STYLE_ID');
    styles.set(style.id, style);
  }
  const nodes = envelope.nodes.map(parseNode);
  validateHierarchy(nodes, styles);
  validateClassification(envelope.classification as Classification, observed, nodes, styles);
  const facts = requireImageFacts(nodes, source);
  const intent = assembleIntent(envelope.documentId, nodes, styles);
  const layout: Record<string, Layout> = {};
  for (const node of nodes) layout[node.id] = clone(node.layout);
  const policy: TreePolicy = {
    canvas: clone(envelope.canvas) as TreePolicy['canvas'],
    layout,
    layoutSource: { kind: 'measured', description: FLAT_LAYOUT_DESCRIPTION },
  };
  const document = compileTree(intent, facts, policy);
  if (document.canvas.width > 4096 || document.canvas.height > 4096) fail('VISION_CANVAS_LIMIT');
  return { version: '0.1', sourceSha256: source.sha256, status: 'Ready', summary: envelope.summary, intent, policy };
}
