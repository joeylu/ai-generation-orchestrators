import { compileTree, type TreeIntent, type TreeIntentNode, type TreePolicy } from './tree-compiler.ts';
import type { ControlStyle, Layout, UiDocument, UiNodeType } from './tree-contract.ts';
import { validateObservation, type ObservationBounds, type ObservationComponent, type ObservationSource, type VisionObservation } from './vision-observation.ts';

const COMPOSITE_TYPES = new Set<UiNodeType>(['Container', 'Button', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs']);
const POLICY_ERROR = 'SEMANTIC_PREVIEW_POLICY_INVALID';

export interface MissingSemanticField {
  componentId: string;
  field: string;
  reason: string;
}

/**
 * Deliberately plain rendering choices for a local reconstruction preview.
 * None of these values is claimed to come from the source image.
 */
export interface NeutralSemanticPreviewPolicy {
  readonly version: '1';
  readonly kind: 'neutral-procedural-preview';
  readonly disclosure: string;
  readonly style: Readonly<ControlStyle>;
  readonly interactive: Readonly<{
    enabled: true;
    input: Readonly<{ readOnly: false; maxLength: 1024 }>;
    dialog: Readonly<{ modal: false }>;
  }>;
  readonly text: Readonly<{ wrap: 'word'; overflow: 'clip'; lineHeight: 'layout-height' }>;
  readonly image: Readonly<{ fit: 'stretch' }>;
  readonly slider: Readonly<{ step: 'decimal-precision-derived' }>;
  readonly scrollView: Readonly<{
    scrollX: 0;
    scrollY: 0;
    contentExtent: 'visible-children-at-zero-scroll';
  }>;
  readonly list: Readonly<{
    itemTemplate: 'text-row';
    itemHeight: 'viewport-height-divided-by-observed-item-count';
  }>;
  readonly identifiers: Readonly<{ documentPrefix: 'semantic-preview'; wrapperPrefix: 'semantic-preview-root' }>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The public default local-preview policy. Its disclosure is intentionally
 * machine-readable by callers that need to warn before rendering the preview.
 */
export const NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1: NeutralSemanticPreviewPolicy = deepFreeze({
  version: '1',
  kind: 'neutral-procedural-preview',
  disclosure: 'Neutral procedural preview only: it preserves observed semantics and measured bounds, but cannot recover the source artwork or visual style.',
  style: {
    backgroundColor: '#F2F2F2',
    borderColor: '#666666',
    borderWidth: 1,
    cornerRadius: 0,
    textColor: '#111111',
    fontFamily: 'sans-serif',
    fontSize: 16,
    fontWeight: 'normal',
    opacity: 1,
  },
  interactive: { enabled: true, input: { readOnly: false, maxLength: 1024 }, dialog: { modal: false } },
  text: { wrap: 'word', overflow: 'clip', lineHeight: 'layout-height' },
  image: { fit: 'stretch' },
  slider: { step: 'decimal-precision-derived' },
  scrollView: { scrollX: 0, scrollY: 0, contentExtent: 'visible-children-at-zero-scroll' },
  list: { itemTemplate: 'text-row', itemHeight: 'viewport-height-divided-by-observed-item-count' },
  identifiers: { documentPrefix: 'semantic-preview', wrapperPrefix: 'semantic-preview-root' },
});

export type SemanticCompileResult =
  | { status: 'Ready'; summary: string; document: UiDocument; previewPolicy: NeutralSemanticPreviewPolicy }
  | { status: 'Unresolved' | 'Custom-required'; summary: string; missing: MissingSemanticField[] };

type RenderNode = {
  component: ObservationComponent;
  parentId: string | null;
  children: RenderNode[];
  layout: Layout;
};

function failPolicy(): never { throw new Error(POLICY_ERROR); }
function equal(value: unknown, expected: unknown): boolean {
  if (Object.is(value, expected)) return true;
  if (typeof value !== 'object' || value === null || typeof expected !== 'object' || expected === null) return false;
  if (Array.isArray(value) || Array.isArray(expected)) return false;
  const actual = value as Record<string, unknown>, wanted = expected as Record<string, unknown>;
  const actualKeys = Object.keys(actual), expectedKeys = Object.keys(wanted);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every(key => Object.hasOwn(actual, key) && equal(actual[key], wanted[key]));
}

/**
 * The compiler accepts an explicit policy argument so no nonvisual preview
 * value is hidden in the transformation. At present it accepts precisely the
 * published neutral policy, including an equivalent structured clone.
 */
export function validateNeutralSemanticPreviewPolicy(input: unknown): NeutralSemanticPreviewPolicy {
  if (!equal(input, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1)) failPolicy();
  return NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1;
}

function has(props: Record<string, unknown>, field: string): boolean { return Object.hasOwn(props, field); }
function missing(componentId: string, field: string, reason: string): MissingSemanticField {
  return { componentId, field, reason };
}
function requiredFields(component: ObservationComponent): MissingSemanticField[] {
  const props = component.visibleProps;
  const require = (fields: readonly string[], reason = 'Required semantic value is not visible in the validated observation.') =>
    fields.filter(field => !has(props, field)).map(field => missing(component.id, field, reason));
  switch (component.componentType) {
    case 'Text': return require(['text']);
    case 'Button': return require(['label']);
    case 'Switch': case 'CheckBox': return require(['label', 'checked']);
    case 'RadioGroup': case 'Select': return require(['selectedId', 'options']);
    case 'Input': return require(['value', 'placeholder', 'inputType']);
    case 'ProgressBar': return require(['value', 'max']);
    case 'Slider': return require(['value', 'min', 'max']);
    case 'List': return require(['selectedId', 'items']);
    case 'Panel': return require(['title']);
    case 'Dialog': return require(['open', 'title']);
    case 'Tabs': return [
      ...require(['activeId', 'tabs']),
      missing(component.id, 'tabs.contentId', 'Visible tab labels do not establish tab content; hidden content cannot be represented by a placeholder.'),
    ];
    case 'Image': case 'Container': case 'ScrollView': return [];
  }
}

function safeId(prefix: string, occupied: Set<string>): string {
  let candidate = prefix, suffix = 2;
  while (occupied.has(candidate)) candidate = `${prefix}-${suffix++}`;
  occupied.add(candidate);
  return candidate;
}

function sourceBounds(source: ObservationSource): ObservationBounds {
  return { x: 0, y: 0, width: source.width, height: source.height };
}
function relativeLayout(bounds: ObservationBounds, parent: ObservationBounds): Layout {
  return { x: bounds.x - parent.x, y: bounds.y - parent.y, width: bounds.width, height: bounds.height };
}
function crop(bounds: ObservationBounds, source: ObservationSource): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(source.width - 1, Math.floor(bounds.x)));
  const y = Math.max(0, Math.min(source.height - 1, Math.floor(bounds.y)));
  const right = Math.max(x + 1, Math.min(source.width, Math.ceil(bounds.x + bounds.width)));
  const bottom = Math.max(y + 1, Math.min(source.height, Math.ceil(bounds.y + bounds.height)));
  return { x, y, width: right - x, height: bottom - y };
}
function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  const exponentIndex = text.indexOf('e');
  if (exponentIndex === -1) {
    const dotIndex = text.indexOf('.');
    return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
  }
  const coefficient = text.slice(0, exponentIndex), exponent = Number(text.slice(exponentIndex + 1));
  const fraction = coefficient.includes('.') ? coefficient.length - coefficient.indexOf('.') - 1 : 0;
  return Math.max(0, fraction - exponent);
}
function sliderStep(props: Record<string, unknown>): number {
  const values = [props.min, props.max, props.value];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('SEMANTIC_COMPILER_INVALID_SLIDER');
  const precision = Math.max(...(values as number[]).map(decimalPlaces));
  return 10 ** -precision;
}
function childContentExtent(component: ObservationComponent, components: readonly ObservationComponent[]): { width: number; height: number } {
  const descendants = components.filter(candidate => {
    let parentId = candidate.parentId;
    while (parentId !== null) {
      if (parentId === component.id) return true;
      parentId = components.find(item => item.id === parentId)?.parentId ?? null;
    }
    return false;
  });
  const right = Math.max(component.bounds.width, ...descendants.map(child => child.bounds.x + child.bounds.width - component.bounds.x));
  const bottom = Math.max(component.bounds.height, ...descendants.map(child => child.bounds.y + child.bounds.height - component.bounds.y));
  return { width: right, height: bottom };
}
function propsFor(
  component: ObservationComponent,
  components: readonly ObservationComponent[],
  source: ObservationSource,
  policy: NeutralSemanticPreviewPolicy,
): Record<string, unknown> {
  const visible = component.visibleProps, style = structuredClone(policy.style);
  switch (component.componentType) {
    case 'Image': return { source: source.path, region: crop(component.bounds, source), fit: policy.image.fit, style };
    case 'Text': return { text: visible.text, wrap: policy.text.wrap, overflow: policy.text.overflow, lineHeight: component.bounds.height, style };
    case 'Container': return { style };
    case 'Button': return { label: visible.label, enabled: policy.interactive.enabled, style };
    case 'Switch': case 'CheckBox': return { label: visible.label, checked: visible.checked, enabled: policy.interactive.enabled, style };
    case 'RadioGroup': case 'Select': return { selectedId: visible.selectedId, options: structuredClone(visible.options), enabled: policy.interactive.enabled, style };
    case 'Input': return {
      value: visible.value, placeholder: visible.placeholder, inputType: visible.inputType,
      readOnly: policy.interactive.input.readOnly, maxLength: policy.interactive.input.maxLength, enabled: policy.interactive.enabled, style,
    };
    case 'ProgressBar': return { value: visible.value, max: visible.max, style };
    case 'Slider': return { value: visible.value, min: visible.min, max: visible.max, step: sliderStep(visible), enabled: policy.interactive.enabled, style };
    case 'ScrollView': {
      const extent = childContentExtent(component, components);
      return { scrollX: policy.scrollView.scrollX, scrollY: policy.scrollView.scrollY, contentWidth: extent.width, contentHeight: extent.height, style };
    }
    case 'List': {
      const items = structuredClone(visible.items) as unknown[];
      return {
        selectedId: visible.selectedId, items, itemTemplate: policy.list.itemTemplate,
        itemHeight: component.bounds.height / Math.max(1, items.length), enabled: policy.interactive.enabled, style,
      };
    }
    case 'Panel': return { title: visible.title, style };
    case 'Dialog': return { open: visible.open, title: visible.title, modal: policy.interactive.dialog.modal, style };
    case 'Tabs': throw new Error('SEMANTIC_COMPILER_TABS_REQUIRE_CONTENT');
  }
}

function renderParentId(component: ObservationComponent, byId: ReadonlyMap<string, ObservationComponent>, wrapperId: string | null): string | null {
  let parentId = component.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent) throw new Error('SEMANTIC_COMPILER_GRAPH_INVALID');
    if (COMPOSITE_TYPES.has(parent.componentType)) return parent.id;
    parentId = parent.parentId;
  }
  return wrapperId;
}
function buildRenderTree(
  components: readonly ObservationComponent[],
  source: ObservationSource,
  policy: NeutralSemanticPreviewPolicy,
): { root: RenderNode; documentId: string } {
  const byId = new Map(components.map(component => [component.id, component]));
  const occupied = new Set<string>(components.map(component => component.id));
  for (const component of components) {
    for (const key of ['options', 'items', 'tabs'] as const) {
      const entries = component.visibleProps[key];
      if (Array.isArray(entries)) for (const entry of entries) {
        if (typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).id === 'string') occupied.add((entry as Record<string, unknown>).id as string);
      }
    }
  }
  const semanticRoots = components.filter(component => component.parentId === null);
  const needsWrapper = semanticRoots.length !== 1 || !COMPOSITE_TYPES.has(semanticRoots[0]?.componentType ?? 'Image')
    || components.some(component => component.parentId !== null && !COMPOSITE_TYPES.has(byId.get(component.parentId)?.componentType ?? 'Image') && renderParentId(component, byId, null) === null);
  const wrapperId = needsWrapper ? safeId(policy.identifiers.wrapperPrefix, occupied) : null;
  const nodes = new Map<string, RenderNode>();
  for (const component of components) nodes.set(component.id, { component, parentId: renderParentId(component, byId, wrapperId), children: [], layout: { x: 0, y: 0, width: 1, height: 1 } });
  let wrapper: RenderNode | undefined;
  if (wrapperId) {
    wrapper = {
      component: { id: wrapperId, parentId: null, componentType: 'Container', bounds: sourceBounds(source), evidence: 'Deterministic wrapper for a valid render tree.', visibleProps: {} },
      parentId: null,
      children: [],
      layout: sourceBounds(source),
    };
  }
  for (const component of components) {
    const node = nodes.get(component.id)!;
    const parent = wrapper && node.parentId === wrapper.component.id
      ? wrapper
      : node.parentId === null ? undefined : nodes.get(node.parentId);
    if (!parent && node.parentId !== null) throw new Error('SEMANTIC_COMPILER_GRAPH_INVALID');
    parent?.children.push(node);
  }
  const root = wrapper ?? nodes.get(semanticRoots[0]?.id ?? '')!;
  if (!root) throw new Error('SEMANTIC_COMPILER_GRAPH_INVALID');
  const assignLayouts = (node: RenderNode, parentBounds: ObservationBounds | null): void => {
    node.layout = parentBounds === null ? { ...node.component.bounds } : relativeLayout(node.component.bounds, parentBounds);
    for (const child of node.children) assignLayouts(child, node.component.bounds);
  };
  assignLayouts(root, null);
  return { root, documentId: safeId(policy.identifiers.documentPrefix, occupied) };
}

function materialize(node: RenderNode, components: readonly ObservationComponent[], source: ObservationSource, policy: NeutralSemanticPreviewPolicy): TreeIntentNode {
  const base = { id: node.component.id, componentType: node.component.componentType, props: propsFor(node.component, components, source, policy) };
  if (COMPOSITE_TYPES.has(node.component.componentType)) return { ...base, children: node.children.map(child => materialize(child, components, source, policy)) } as TreeIntentNode;
  return base as TreeIntentNode;
}
function layouts(node: RenderNode, result: Record<string, Layout> = {}): Record<string, Layout> {
  result[node.component.id] = { ...node.layout };
  node.children.forEach(child => layouts(child, result));
  return result;
}
function imageFacts(components: readonly ObservationComponent[], source: ObservationSource): Record<string, { width: number; height: number }> {
  return components.some(component => component.componentType === 'Image') ? { [source.path]: { width: source.width, height: source.height } } : {};
}

/**
 * Purely compiles a validated v0.2 observation plus an explicit neutral
 * preview policy. It never calls a provider, fills unobserved semantics, or
 * edits the caller's observation.
 */
export function compileSemanticObservation(
  input: unknown,
  source: ObservationSource,
  previewPolicy: NeutralSemanticPreviewPolicy,
): SemanticCompileResult {
  const policy = validateNeutralSemanticPreviewPolicy(previewPolicy);
  const observation: VisionObservation = validateObservation(input, source);
  if (source.width > 4096 || source.height > 4096) throw new Error('SEMANTIC_COMPILER_CANVAS_LIMIT');
  if (observation.version !== '0.2') throw new Error('SEMANTIC_COMPILER_REQUIRES_OBSERVATION_V0_2');
  if (observation.status !== 'Observed') {
    return {
      status: observation.status,
      summary: observation.summary,
      missing: [missing('$observation', 'components', 'The observation did not establish a component graph to compile.')],
    };
  }
  const missingFields = observation.components.flatMap(requiredFields);
  if (missingFields.length) return { status: 'Unresolved', summary: observation.summary, missing: missingFields };

  const tree = buildRenderTree(observation.components, source, policy);
  const intent: TreeIntent = { intentVersion: '0.2', id: tree.documentId, root: materialize(tree.root, observation.components, source, policy) };
  const settings: TreePolicy = {
    canvas: { width: source.width, height: source.height },
    layout: layouts(tree.root),
    layoutSource: { kind: 'measured', description: 'Parent-relative layouts measured from validated observation source bounds.' },
  };
  return { status: 'Ready', summary: observation.summary, document: compileTree(intent, imageFacts(observation.components, source), settings), previewPolicy: policy };
}
