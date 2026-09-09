import { compileTree, type ImageFactsMap, type TreeIntent, type TreeIntentNode } from './tree-compiler.ts';
import { walkNodes, type UiDocument, type UiNodeType } from './tree-contract.ts';
import { normalizeFlatVisionResult } from './vision-flat.ts';
import { validateVisionPreviewPolicyV1 } from './vision-preview-policy.ts';

const COMPONENT_TYPES = new Set<UiNodeType>([
  'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
  'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
]);
const COMPOSITE_TYPES = new Set<UiNodeType>(['Container', 'Button', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs']);
const EXTRA_CONTRACT_TYPES = new Set<UiNodeType>(['Image', 'Text', 'Container']);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._-]*$/;
const MAX_OBSERVATION_COMPONENTS = 32;
const OBSERVED_KEYS = ['version', 'sourceSha256', 'status', 'summary', 'components'] as const;
const NON_OBSERVED_KEYS = ['version', 'sourceSha256', 'status', 'summary'] as const;
const COMPONENT_KEYS = ['id', 'parentId', 'componentType', 'bounds', 'evidence', 'visibleProps'] as const;
const BOUNDS_KEYS = ['x', 'y', 'width', 'height'] as const;
const STAGED_KEYS = ['version', 'sourceSha256', 'status', 'summary', 'observation', 'contract'] as const;

/** Stable observation and observation-to-contract binding failures. */
export const OBSERVATION_ERROR_CODES = [
  'VISION_INVALID_OBSERVATION',
  'VISION_INVALID_STAGED_RESULT',
  'VISION_OBSERVATION_COMPONENT_LIMIT',
  'VISION_OBSERVATION_DUPLICATE_ID',
  'VISION_OBSERVATION_UNKNOWN_PARENT',
  'VISION_OBSERVATION_PARENT_NOT_COMPOSITE',
  'VISION_OBSERVATION_CYCLE',
  'VISION_OBSERVATION_BOUNDS_INVALID',
  'VISION_OBSERVATION_TYPE_MISMATCH',
  'VISION_OBSERVATION_PROPS_MISMATCH',
  'VISION_OBSERVATION_MISSING_NODE',
  'VISION_OBSERVATION_PARENT_MISMATCH',
  'VISION_OBSERVATION_EXTRA_NODE',
  'VISION_PREVIEW_POLICY_VIOLATION',
  'VISION_UNAVAILABLE_RESOURCE',
  'VISION_CANVAS_LIMIT',
] as const;
export type ObservationErrorCode = typeof OBSERVATION_ERROR_CODES[number];

export type ObservationSource = { path: string; sha256: string; width: number; height: number };
export type ObservationBounds = { x: number; y: number; width: number; height: number };
export type ObservationComponent = {
  id: string;
  parentId: string | null;
  componentType: UiNodeType;
  bounds: ObservationBounds;
  evidence: string;
  visibleProps: Record<string, unknown>;
};
/**
 * v0.1 records render-adjacent observations. v0.2 narrows those records to
 * source-visible semantic facts, so it can be paired with an explicit preview
 * policy without treating policy values as image evidence.
 */
export type ObservationVersion = '0.1' | '0.2';
export type VisionObservation = {
  version: ObservationVersion; sourceSha256: string; status: 'Observed'; summary: string; components: ObservationComponent[];
} | {
  version: ObservationVersion; sourceSha256: string; status: 'Unresolved' | 'Custom-required'; summary: string;
};
export type StagedVisionResult = { status: 'Ready'; summary: string; document: UiDocument }
  | { status: 'Unresolved' | 'Custom-required'; summary: string };

function fail(code: ObservationErrorCode): never { throw new Error(code); }
function invalidObservation(): never { return fail('VISION_INVALID_OBSERVATION'); }
function invalidStaged(): never { return fail('VISION_INVALID_STAGED_RESULT'); }

function record(value: unknown, failure: () => never = invalidObservation): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) failure();
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[], failure: () => never = invalidObservation): Record<string, unknown> {
  const data = record(value, failure);
  if (keys.some(key => !Object.hasOwn(data, key)) || Object.keys(data).some(key => !keys.includes(key))) failure();
  return data;
}
function clone<T>(value: T): T {
  try { return structuredClone(value); }
  catch { return invalidObservation(); }
}
function validId(value: unknown): value is string { return typeof value === 'string' && IDENTIFIER.test(value); }
function validSummary(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()) && value.length <= 2_000; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function validSource(source: ObservationSource): void {
  if (!source || typeof source.path !== 'string' || !source.path || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !Number.isSafeInteger(source.width) || source.width < 1 || !Number.isSafeInteger(source.height) || source.height < 1) invalidObservation();
}

const V0_1_VISIBLE_FIELDS: Record<UiNodeType, readonly string[]> = {
  Image: ['fit', 'region'], Text: ['text', 'wrap', 'overflow', 'lineHeight'], Container: [], Button: ['label'],
  Switch: ['label', 'checked'], CheckBox: ['label', 'checked'], RadioGroup: ['selectedId', 'options'],
  Input: ['value', 'placeholder', 'inputType'], Select: ['selectedId', 'options'], ProgressBar: ['value', 'max'],
  Slider: ['value', 'min', 'max', 'step'], ScrollView: ['scrollX', 'scrollY', 'contentWidth', 'contentHeight'],
  List: ['selectedId', 'items'], Panel: ['title'], Dialog: ['open', 'title'], Tabs: ['activeId', 'tabs'],
};
const V0_2_VISIBLE_FIELDS: Record<UiNodeType, readonly string[]> = {
  Image: [], Text: ['text'], Container: [], Button: ['label'],
  Switch: ['label', 'checked'], CheckBox: ['label', 'checked'], RadioGroup: ['selectedId', 'options'],
  Input: ['value', 'placeholder', 'inputType'], Select: ['selectedId', 'options'], ProgressBar: ['value', 'max'],
  Slider: ['value', 'min', 'max'], ScrollView: [],
  List: ['selectedId', 'items'], Panel: ['title'], Dialog: ['open', 'title'], Tabs: ['activeId', 'tabs'],
};
function visibleFields(version: ObservationVersion, type: UiNodeType): readonly string[] {
  return version === '0.1' ? V0_1_VISIBLE_FIELDS[type] : V0_2_VISIBLE_FIELDS[type];
}

function stringValue(value: unknown): void { if (typeof value !== 'string') invalidObservation(); }
function booleanValue(value: unknown): void { if (typeof value !== 'boolean') invalidObservation(); }
function nonNegative(value: unknown): void { if (!finite(value) || value < 0) invalidObservation(); }
function positive(value: unknown): void { if (!finite(value) || value <= 0) invalidObservation(); }
function observedEntries(value: unknown, nodeIds: ReadonlySet<string>, entryIds: Set<string>): Set<string> {
  if (!Array.isArray(value)) invalidObservation();
  const ids = new Set<string>();
  for (const entry of value) {
    const item = exact(entry, ['id', 'label']);
    if (!validId(item.id) || ids.has(item.id) || nodeIds.has(item.id) || entryIds.has(item.id)) invalidObservation();
    ids.add(item.id); entryIds.add(item.id); stringValue(item.label);
  }
  return ids;
}
function visibleRegion(value: unknown, source: ObservationSource): void {
  // Regions are independently observed source-image coordinates, not contract layout.
  const region = exact(value, BOUNDS_KEYS);
  if (typeof region.x !== 'number' || !Number.isSafeInteger(region.x) || region.x < 0 || typeof region.y !== 'number' || !Number.isSafeInteger(region.y) || region.y < 0
    || typeof region.width !== 'number' || !Number.isSafeInteger(region.width) || region.width < 1 || typeof region.height !== 'number' || !Number.isSafeInteger(region.height) || region.height < 1) invalidObservation();
  if (region.x + region.width > source.width || region.y + region.height > source.height) fail('VISION_OBSERVATION_BOUNDS_INVALID');
}
function observedNumber(props: Record<string, unknown>, key: string): number | undefined {
  if (!Object.hasOwn(props, key)) return undefined;
  const value = props[key];
  if (!finite(value)) invalidObservation();
  return value;
}
function validateNumericRelations(type: UiNodeType, props: Record<string, unknown>): void {
  if (type === 'ProgressBar') {
    const value = observedNumber(props, 'value');
    const max = observedNumber(props, 'max');
    if (value !== undefined && value < 0) invalidObservation();
    if (max !== undefined && max <= 0) invalidObservation();
    if (value !== undefined && max !== undefined && value > max) invalidObservation();
    return;
  }
  if (type !== 'Slider') return;
  const value = observedNumber(props, 'value');
  const min = observedNumber(props, 'min');
  const max = observedNumber(props, 'max');
  const step = observedNumber(props, 'step');
  if (step !== undefined && step <= 0) invalidObservation();
  if (min !== undefined && max !== undefined && max <= min) invalidObservation();
  if (value !== undefined && min !== undefined && value < min) invalidObservation();
  if (value !== undefined && max !== undefined && value > max) invalidObservation();
  if (value !== undefined && min !== undefined && step !== undefined) {
    const quotient = (value - min) / step;
    if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8) invalidObservation();
  }
}
function validateVisibleProps(
  version: ObservationVersion,
  type: UiNodeType,
  value: unknown,
  source: ObservationSource,
  nodeIds: ReadonlySet<string>,
  entryIds: Set<string>,
): Record<string, unknown> {
  const props = record(value);
  const allowed = visibleFields(version, type);
  if (Object.keys(props).some(key => !allowed.includes(key))) invalidObservation();
  let selectedIds: Set<string> | undefined;
  let tabIds: Set<string> | undefined;
  for (const [key, field] of Object.entries(props)) {
    switch (key) {
      case 'label': case 'title': case 'text': case 'placeholder': stringValue(field); break;
      case 'value': if (type === 'Input') stringValue(field); else if (!finite(field)) invalidObservation(); break;
      case 'checked': case 'open': booleanValue(field); break;
      case 'selectedId': if (field !== null && !validId(field)) invalidObservation(); break;
      case 'activeId': if (!validId(field)) invalidObservation(); break;
      case 'options': case 'items': selectedIds = observedEntries(field, nodeIds, entryIds); break;
      case 'tabs': tabIds = observedEntries(field, nodeIds, entryIds); break;
      case 'fit': if (field !== 'stretch' && field !== 'contain' && field !== 'cover') invalidObservation(); break;
      case 'region': visibleRegion(field, source); break;
      case 'wrap': if (field !== 'none' && field !== 'word') invalidObservation(); break;
      case 'overflow': if (field !== 'clip' && field !== 'ellipsis' && field !== 'error') invalidObservation(); break;
      case 'inputType': if (field !== 'text' && field !== 'password' && field !== 'email' && field !== 'number') invalidObservation(); break;
      case 'lineHeight': case 'contentWidth': case 'contentHeight': positive(field); break;
      case 'max': if (type === 'ProgressBar') positive(field); else if (!finite(field)) invalidObservation(); break;
      case 'step': positive(field); break;
      case 'min': if (!finite(field)) invalidObservation(); break;
      case 'scrollX': case 'scrollY': nonNegative(field); break;
      default: invalidObservation();
    }
  }
  if (selectedIds && props.selectedId !== null && props.selectedId !== undefined && !selectedIds.has(props.selectedId as string)) invalidObservation();
  if (tabIds && Object.hasOwn(props, 'activeId') && !tabIds.has(props.activeId as string)) invalidObservation();
  validateNumericRelations(type, props);
  return props;
}

function parseComponent(value: unknown, source: ObservationSource): ObservationComponent {
  const component = exact(value, COMPONENT_KEYS);
  if (!validId(component.id) || (component.parentId !== null && !validId(component.parentId))
    || typeof component.componentType !== 'string' || !COMPONENT_TYPES.has(component.componentType as UiNodeType)
    || typeof component.evidence !== 'string' || !component.evidence.trim() || component.evidence.length > 2_000) invalidObservation();
  const bounds = exact(component.bounds, BOUNDS_KEYS);
  // Observation bounds are source-image evidence only; they do not bind contract layout.
  if (!finite(bounds.x) || bounds.x < 0 || !finite(bounds.y) || bounds.y < 0 || !finite(bounds.width) || bounds.width <= 0 || !finite(bounds.height) || bounds.height <= 0
    || bounds.x + bounds.width > source.width || bounds.y + bounds.height > source.height) fail('VISION_OBSERVATION_BOUNDS_INVALID');
  return {
    id: component.id,
    parentId: component.parentId as string | null,
    componentType: component.componentType as UiNodeType,
    bounds: bounds as ObservationBounds,
    evidence: component.evidence,
    visibleProps: record(component.visibleProps),
  };
}

function validateObservationGraph(components: readonly ObservationComponent[], version: ObservationVersion): void {
  if (components.length === 0 || components.length > MAX_OBSERVATION_COMPONENTS) fail('VISION_OBSERVATION_COMPONENT_LIMIT');
  const byId = new Map<string, ObservationComponent>();
  for (const component of components) {
    if (byId.has(component.id)) fail('VISION_OBSERVATION_DUPLICATE_ID');
    byId.set(component.id, component);
  }
  for (const component of components) {
    if (component.parentId === null) continue;
    const parent = byId.get(component.parentId);
    if (!parent) fail('VISION_OBSERVATION_UNKNOWN_PARENT');
    // v0.2 preserves source-visible semantic grouping. That grouping may put a
    // label beneath a leaf control even though the deterministic render tree
    // must flatten it to that control's composite render ancestor.
    if (version === '0.1' && !COMPOSITE_TYPES.has(parent.componentType)) fail('VISION_OBSERVATION_PARENT_NOT_COMPOSITE');
  }
  for (const component of components) {
    const visited = new Set<string>();
    let current: ObservationComponent | undefined = component;
    while (current) {
      if (visited.has(current.id)) fail('VISION_OBSERVATION_CYCLE');
      visited.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
}

function validateObservationVisibleProps(components: ObservationComponent[], source: ObservationSource, version: ObservationVersion): void {
  const nodeIds = new Set(components.map(component => component.id));
  const entryIds = new Set<string>();
  for (const component of components) {
    component.visibleProps = validateVisibleProps(version, component.componentType, component.visibleProps, source, nodeIds, entryIds);
  }
}

/** Validates only observed facts. It never supplies missing component properties. */
export function validateObservation(value: unknown, source: ObservationSource): VisionObservation {
  validSource(source);
  const observation = record(value);
  const version = observation.version;
  if (version !== '0.1' && version !== '0.2') invalidObservation();
  if (observation.status === 'Unresolved' || observation.status === 'Custom-required') {
    exact(observation, NON_OBSERVED_KEYS);
    if (observation.sourceSha256 !== source.sha256 || !validSummary(observation.summary)) invalidObservation();
    return clone(observation) as VisionObservation;
  }
  exact(observation, OBSERVED_KEYS);
  if (observation.sourceSha256 !== source.sha256 || observation.status !== 'Observed'
    || !validSummary(observation.summary) || !Array.isArray(observation.components)) invalidObservation();
  if (observation.components.length > MAX_OBSERVATION_COMPONENTS) fail('VISION_OBSERVATION_COMPONENT_LIMIT');
  const components = observation.components.map(component => parseComponent(component, source));
  validateObservationGraph(components, version);
  validateObservationVisibleProps(components, source, version);
  return { version, sourceSha256: source.sha256, status: 'Observed', summary: observation.summary, components: clone(components) };
}

type ContractNode = { id: string; parentId: string | null; componentType: UiNodeType; props: Record<string, unknown> };
function contractNodes(intent: TreeIntent): Map<string, ContractNode> {
  const nodes = new Map<string, ContractNode>();
  const visit = (node: TreeIntentNode, parentId: string | null) => {
    nodes.set(node.id, { id: node.id, parentId, componentType: node.componentType, props: node.props as Record<string, unknown> });
    if ('children' in node) node.children.forEach(child => visit(child, node.id));
  };
  visit(intent.root, null);
  return nodes;
}
function visibleEquals(expected: unknown, actual: unknown): boolean {
  if (Object.is(expected, actual)) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => visibleEquals(item, actual[index]));
  if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
    const expectedRecord = expected as Record<string, unknown>, actualRecord = actual as Record<string, unknown>;
    return Object.keys(expectedRecord).every(key => Object.hasOwn(actualRecord, key) && visibleEquals(expectedRecord[key], actualRecord[key]));
  }
  return false;
}
/** v0.1: an observed parent must remain an ancestor; only helper Containers may intervene. */
function parentCorrespondsV0_1(observed: ObservationComponent, actual: ContractNode, observationIds: ReadonlySet<string>, nodes: ReadonlyMap<string, ContractNode>): boolean {
  let parentId = actual.parentId;
  while (parentId !== null) {
    if (parentId === observed.parentId) return true;
    const parent = nodes.get(parentId);
    if (!parent || observationIds.has(parent.id) || parent.componentType !== 'Container') return false;
    parentId = parent.parentId;
  }
  return observed.parentId === null;
}
/**
 * v0.2 may describe a source-visible child beneath a leaf control. The render
 * contract cannot represent that leaf as a parent, so the child may be a
 * sibling under the leaf's actual render parent, with helper Containers below
 * that parent. A composite observed parent remains a strict ancestor.
 */
function parentCorrespondsV0_2(
  observed: ObservationComponent,
  actual: ContractNode,
  observedById: ReadonlyMap<string, ObservationComponent>,
  observationIds: ReadonlySet<string>,
  nodes: ReadonlyMap<string, ContractNode>,
): boolean {
  if (observed.parentId === null) return parentCorrespondsV0_1(observed, actual, observationIds, nodes);
  const observedParent = observedById.get(observed.parentId);
  if (!observedParent) return false;
  if (COMPOSITE_TYPES.has(observedParent.componentType)) return parentCorrespondsV0_1(observed, actual, observationIds, nodes);

  const actualSemanticParent = nodes.get(observedParent.id);
  if (!actualSemanticParent) return false;
  // Flat contract validation guarantees a non-null immediate parent is
  // composite. Reaching that exact render parent rules out relocation to an
  // unrelated observed panel/container while allowing nested helper Containers.
  const renderParentId = actualSemanticParent.parentId;
  let parentId = actual.parentId;
  while (parentId !== null) {
    if (parentId === renderParentId) return true;
    const parent = nodes.get(parentId);
    if (!parent || observationIds.has(parent.id) || parent.componentType !== 'Container') return false;
    parentId = parent.parentId;
  }
  return renderParentId === null;
}
function bindObservation(observation: Extract<VisionObservation, { status: 'Observed' }>, intent: TreeIntent): void {
  const nodes = contractNodes(intent);
  const observationIds = new Set(observation.components.map(component => component.id));
  const observedById = new Map(observation.components.map(component => [component.id, component]));
  for (const component of observation.components) {
    const actual = nodes.get(component.id);
    if (!actual) fail('VISION_OBSERVATION_MISSING_NODE');
    if (actual.componentType !== component.componentType) fail('VISION_OBSERVATION_TYPE_MISMATCH');
    const parentMatches = observation.version === '0.1'
      ? parentCorrespondsV0_1(component, actual, observationIds, nodes)
      : parentCorrespondsV0_2(component, actual, observedById, observationIds, nodes);
    if (!parentMatches) fail('VISION_OBSERVATION_PARENT_MISMATCH');
    for (const [key, expected] of Object.entries(component.visibleProps)) {
      if (!Object.hasOwn(actual.props, key) || !visibleEquals(expected, actual.props[key])) fail('VISION_OBSERVATION_PROPS_MISMATCH');
    }
  }
  for (const node of nodes.values()) if (!observationIds.has(node.id) && !EXTRA_CONTRACT_TYPES.has(node.componentType)) fail('VISION_OBSERVATION_EXTRA_NODE');
}
function compileNormalizedContract(intent: TreeIntent, policy: unknown, source: ObservationSource): UiDocument {
  const facts: ImageFactsMap = {};
  const visit = (node: TreeIntentNode) => {
    if (node.componentType === 'Image') {
      if (node.props.source !== source.path) fail('VISION_UNAVAILABLE_RESOURCE');
      facts[source.path] = { width: source.width, height: source.height };
    }
    if (node.componentType === 'Text' && Object.hasOwn(node.props, 'fontSource')) fail('VISION_UNAVAILABLE_RESOURCE');
    if ('children' in node) node.children.forEach(visit);
  };
  visit(intent.root);
  const document = compileTree(intent, facts, policy);
  if (document.canvas.width > 4096 || document.canvas.height > 4096) fail('VISION_CANVAS_LIMIT');
  if (!walkNodes(document).length) invalidStaged();
  return document;
}

/**
 * Binds an observed v0.1 component graph to an independently supplied v0.2
 * contract. The compiler is invoked only after all observed identity, hierarchy,
 * and visible-property evidence is preserved.
 */
export function compileStagedVisionResult(value: unknown, source: ObservationSource): StagedVisionResult {
  validSource(source);
  const staged = exact(value, STAGED_KEYS, invalidStaged);
  if (staged.version !== '0.3' || staged.sourceSha256 !== source.sha256 || !validSummary(staged.summary)
    || (staged.status !== 'Ready' && staged.status !== 'Unresolved' && staged.status !== 'Custom-required')) invalidStaged();
  const observation = validateObservation(staged.observation, source);
  if (staged.status === 'Ready') {
    if (observation.status !== 'Observed' || !staged.contract || typeof staged.contract !== 'object' || Array.isArray(staged.contract)) invalidStaged();
    const contract = staged.contract as Record<string, unknown>;
    if (contract.version !== '0.2' || contract.status !== 'Ready') invalidStaged();
    const normalized = normalizeFlatVisionResult(contract, source);
    if (normalized.status !== 'Ready') invalidStaged();
    // v0.2 keeps facts pure. The contract must state every local-preview
    // setting mandated by the separately versioned immutable policy; neither
    // the observation validator nor this binder supplies any missing value.
    if (observation.version === '0.2') validateVisionPreviewPolicyV1(contractNodes(normalized.intent).values());
    bindObservation(observation, normalized.intent);
    return { status: 'Ready', summary: staged.summary, document: compileNormalizedContract(normalized.intent, normalized.policy, source) };
  }
  if (observation.status !== 'Observed') {
    if (staged.contract !== null || observation.status !== staged.status) invalidStaged();
    return { status: staged.status, summary: staged.summary };
  }
  if (!staged.contract || typeof staged.contract !== 'object' || Array.isArray(staged.contract)) invalidStaged();
  const contract = staged.contract as Record<string, unknown>;
  if (contract.version !== '0.2' || (contract.status !== 'Unresolved' && contract.status !== 'Custom-required')) invalidStaged();
  const normalized = normalizeFlatVisionResult(contract, source);
  if (normalized.status === 'Ready' || normalized.status !== staged.status) invalidStaged();
  return { status: staged.status, summary: staged.summary };
}
