import { HarnessError, type Issue } from './contract.ts';
import {
  MAX_TREE_DEPTH, MAX_TREE_NODES, UI_SCHEMA_VERSION, validateDocument,
  type CanvasSize, type ChoiceProps, type ContainerProps, type DialogProps, type ImageProps,
  type InputProps, type Layout, type ListProps, type PanelProps, type ProgressBarProps,
  type ScrollViewProps, type SliderProps, type TabsProps, type TextProps, type ToggleProps,
  type UiDocument, type UiNode, type UiNodeType,
} from './tree-contract.ts';
import { validateResourceReference } from './resource-reference.ts';

interface IntentBase<T extends UiNodeType, P> { id: string; componentType: T; props: P }
export type TreeIntentNode =
  | IntentBase<'Image', ImageProps>
  | IntentBase<'Text', TextProps>
  | (IntentBase<'Container', ContainerProps> & { children: TreeIntentNode[] })
  | (IntentBase<'Button', { label: string; enabled: boolean; style: ImageProps['style'] }> & { children: TreeIntentNode[] })
  | IntentBase<'Switch', ToggleProps>
  | IntentBase<'CheckBox', ToggleProps>
  | IntentBase<'RadioGroup', ChoiceProps>
  | IntentBase<'Input', InputProps>
  | IntentBase<'Select', ChoiceProps>
  | IntentBase<'ProgressBar', ProgressBarProps>
  | IntentBase<'Slider', SliderProps>
  | (IntentBase<'ScrollView', ScrollViewProps> & { children: TreeIntentNode[] })
  | (IntentBase<'List', ListProps> & { children: TreeIntentNode[] })
  | (IntentBase<'Panel', PanelProps> & { children: TreeIntentNode[] })
  | (IntentBase<'Dialog', DialogProps> & { children: TreeIntentNode[] })
  | (IntentBase<'Tabs', TabsProps> & { children: TreeIntentNode[] });

export interface TreeIntent { intentVersion: '0.2'; id: string; root: TreeIntentNode }
export interface ImageFacts { width: number; height: number }
export type ImageFactsMap = Record<string, ImageFacts>;
export interface TreePolicy {
  canvas: CanvasSize;
  layout: Record<string, Layout>;
  layoutSource: { kind: 'explicit' | 'measured'; description: string };
}

const nodeTypes = new Set<UiNodeType>([
  'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
  'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
]);
const compositeTypes = new Set<UiNodeType>(['Container', 'Button', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs']);
const identifierPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;

class IntentStructureValidator {
  readonly issues: Issue[] = [];
  private nodes = 0;
  private readonly ancestors = new WeakSet<object>();

  add(path: string, code: string, message: string): void { this.issues.push({ path, code, message }); }
  object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { this.add(path, 'OBJECT_REQUIRED', 'must be an object'); return null; }
    const data = value as Record<string, unknown>;
    for (const key of keys) if (!Object.hasOwn(data, key)) this.add(`${path}.${key}`, 'REQUIRED', 'required field is missing');
    for (const key of Object.keys(data)) if (!keys.includes(key)) this.add(`${path}.${key}`, 'UNSUPPORTED_FIELD', 'unknown fields are not accepted');
    return data;
  }
  node(value: unknown, path: string, depth: number): Record<string, unknown> | undefined {
    if (depth > MAX_TREE_DEPTH) { this.add(path, 'TREE_DEPTH_LIMIT', `tree depth must not exceed ${MAX_TREE_DEPTH}`); return undefined; }
    if (typeof value === 'object' && value !== null) {
      if (this.ancestors.has(value)) { this.add(path, 'TREE_CYCLE', 'tree must not contain a cycle'); return undefined; }
      this.ancestors.add(value);
    }
    this.nodes += 1;
    if (this.nodes > MAX_TREE_NODES) this.add(path, 'TREE_NODE_LIMIT', `tree must not exceed ${MAX_TREE_NODES} nodes`);
    const raw = value as Record<string, unknown> | null;
    const rawType = raw && typeof raw.componentType === 'string' ? raw.componentType : undefined;
    const type = rawType && nodeTypes.has(rawType as UiNodeType) ? rawType as UiNodeType : undefined;
    const keys = type && compositeTypes.has(type) ? ['id', 'componentType', 'props', 'children'] : ['id', 'componentType', 'props'];
    const data = this.object(value, path, keys);
    if (!data) { if (typeof value === 'object' && value !== null) this.ancestors.delete(value); return undefined; }
    if (!type) this.add(`${path}.componentType`, rawType === 'Unresolved' ? 'UNRESOLVED_INTENT' : 'UNSUPPORTED_TYPE', 'only a recognized component type can be compiled');
    const compiled: Record<string, unknown> = { id: data.id, type: data.componentType, layout: { x: 0, y: 0, width: 1, height: 1 }, props: data.props };
    if (type && compositeTypes.has(type)) {
      if (!Array.isArray(data.children)) this.add(`${path}.children`, 'ARRAY_REQUIRED', 'composite intent children must be an array');
      else compiled.children = data.children.map((child, index) => this.node(child, `${path}.children[${index}]`, depth + 1));
      if (!Array.isArray(data.children)) compiled.children = data.children;
    }
    if (typeof value === 'object' && value !== null) this.ancestors.delete(value);
    return compiled;
  }
}

function intentPath(path: string): string {
  if (path === '$.id') return '$intent.id';
  return path.startsWith('$.root') ? `$intent${path.slice(1)}` : path;
}

function addIntentResourceIssues(node: Record<string, unknown> | undefined, path: string, issues: Issue[]): void {
  if (!node) return;
  const type = node.type;
  const props = node.props;
  if ((type === 'Image' || type === 'Text') && typeof props === 'object' && props !== null && !Array.isArray(props)) {
    const data = props as Record<string, unknown>;
    const fields = type === 'Image' ? ['source'] : ['fontSource'];
    for (const field of fields) if (Object.hasOwn(data, field) && typeof data[field] === 'string') {
      try { validateResourceReference(data[field] as string, `${path}.props.${field}`, 'intent'); }
      catch (error) { issues.push({ path: `${path}.props.${field}`, code: 'INVALID_RESOURCE_REFERENCE', message: error instanceof Error ? error.message : 'invalid resource reference' }); }
    }
  }
  if (Array.isArray(node.children)) node.children.forEach((child, index) => addIntentResourceIssues(child as Record<string, unknown> | undefined, `${path}.children[${index}]`, issues));
}

/** Validate v0.2 intent syntax, branches, props, references, and resources without accepting a layout. */
export function validateTreeIntent(input: unknown): TreeIntent {
  const validator = new IntentStructureValidator();
  const root = validator.object(input, '$intent', ['intentVersion', 'id', 'root']);
  let convertedRoot: Record<string, unknown> | undefined;
  let documentId: unknown;
  if (root) {
    if (root.intentVersion !== '0.2') validator.add('$intent.intentVersion', 'UNSUPPORTED_VERSION', 'only intentVersion 0.2 is supported');
    documentId = root.id;
    convertedRoot = validator.node(root.root, '$intent.root', 1);
  }
  addIntentResourceIssues(convertedRoot, '$intent.root', validator.issues);
  if (convertedRoot !== undefined) {
    try {
      validateDocument({ schemaVersion: UI_SCHEMA_VERSION, id: documentId, canvas: { width: 1, height: 1 }, root: convertedRoot });
    } catch (error) {
      if (error instanceof HarnessError) {
        for (const issue of error.issues) {
          if (issue.code !== 'INVALID_RESOURCE_REFERENCE') validator.issues.push({ ...issue, path: intentPath(issue.path) });
        }
      } else validator.add('$intent', 'INVALID_INTENT', error instanceof Error ? error.message : 'intent validation failed');
    }
  }
  if (validator.issues.length) throw new HarnessError('intent', validator.issues);
  return structuredClone(input) as TreeIntent;
}

function policyObject(value: unknown, path: string, keys: readonly string[], issues: Issue[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { issues.push({ path, code: 'OBJECT_REQUIRED', message: 'must be an object' }); return null; }
  const data = value as Record<string, unknown>;
  for (const key of keys) if (!Object.hasOwn(data, key)) issues.push({ path: `${path}.${key}`, code: 'REQUIRED', message: 'required field is missing' });
  for (const key of Object.keys(data)) if (!keys.includes(key)) issues.push({ path: `${path}.${key}`, code: 'UNSUPPORTED_FIELD', message: 'unknown fields are not accepted' });
  return data;
}
function policyNumber(value: unknown, path: string, issues: Issue[], positive = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) issues.push({ path, code: 'INVALID_NUMBER', message: positive ? 'must be a finite positive number' : 'must be a finite number' });
}

/** Validate explicit/measured layout provenance and per-node layouts. It cannot infer layouts. */
export function validateTreePolicy(input: unknown): TreePolicy {
  const issues: Issue[] = [];
  const root = policyObject(input, '$policy', ['canvas', 'layout', 'layoutSource'], issues);
  if (root) {
    const canvas = policyObject(root.canvas, '$policy.canvas', ['width', 'height'], issues);
    if (canvas) { policyNumber(canvas.width, '$policy.canvas.width', issues, true); policyNumber(canvas.height, '$policy.canvas.height', issues, true); }
    const layout = root.layout;
    if (typeof layout !== 'object' || layout === null || Array.isArray(layout)) issues.push({ path: '$policy.layout', code: 'OBJECT_REQUIRED', message: 'must be an ID-keyed layout object' });
    else for (const [id, value] of Object.entries(layout as Record<string, unknown>)) {
      const path = `$policy.layout[${JSON.stringify(id)}]`;
      if (!identifierPattern.test(id)) issues.push({ path, code: 'INVALID_ID', message: 'layout key must be a node ID' });
      const item = policyObject(value, path, ['x', 'y', 'width', 'height'], issues);
      if (item) { policyNumber(item.x, `${path}.x`, issues); policyNumber(item.y, `${path}.y`, issues); policyNumber(item.width, `${path}.width`, issues, true); policyNumber(item.height, `${path}.height`, issues, true); }
    }
    const source = policyObject(root.layoutSource, '$policy.layoutSource', ['kind', 'description'], issues);
    if (source) {
      if (source.kind !== 'explicit' && source.kind !== 'measured') issues.push({ path: '$policy.layoutSource.kind', code: 'UNSUPPORTED_VALUE', message: 'must be explicit or measured' });
      if (typeof source.description !== 'string' || !source.description.trim() || source.description !== source.description.trim()) issues.push({ path: '$policy.layoutSource.description', code: 'STRING_REQUIRED', message: 'must be a non-empty trimmed string' });
    }
  }
  if (issues.length) throw new HarnessError('compile', issues);
  return structuredClone(input) as TreePolicy;
}

function collectIntentNodes(node: TreeIntentNode, result: TreeIntentNode[] = []): TreeIntentNode[] {
  result.push(node);
  if ('children' in node) node.children.forEach(child => collectIntentNodes(child, result));
  return result;
}
function collectImageSources(nodes: readonly TreeIntentNode[]): Set<string> {
  const sources = new Set<string>();
  for (const node of nodes) if (node.componentType === 'Image') sources.add(node.props.source);
  return sources;
}
function validateImageFacts(input: unknown, imageSources: ReadonlySet<string>, imageNodes: readonly TreeIntentNode[]): ImageFactsMap {
  const issues: Issue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) issues.push({ path: '$facts', code: 'OBJECT_REQUIRED', message: 'must map image sources to decoded facts' });
  else {
    const facts = input as Record<string, unknown>;
    for (const source of imageSources) if (!Object.hasOwn(facts, source)) issues.push({ path: '$facts', code: 'MISSING_IMAGE_FACTS', message: `missing decoded facts for ${source}` });
    for (const source of Object.keys(facts)) {
      const path = `$facts[${JSON.stringify(source)}]`;
      try { validateResourceReference(source, path, 'compile'); }
      catch (error) { issues.push({ path, code: 'INVALID_RESOURCE_REFERENCE', message: error instanceof Error ? error.message : 'invalid resource reference' }); }
      if (!imageSources.has(source)) issues.push({ path, code: 'UNUSED_IMAGE_FACTS', message: 'facts are allowed only for declared Image sources' });
      const value = facts[source];
      const data = policyObject(value, path, ['width', 'height'], issues);
      if (data) {
        for (const key of ['width', 'height'] as const) {
          if (typeof data[key] !== 'number' || !Number.isSafeInteger(data[key]) || data[key] <= 0) issues.push({ path: `${path}.${key}`, code: 'INVALID_IMAGE_FACT', message: 'must be a positive safe integer' });
        }
      }
    }
    for (const node of imageNodes) if (node.componentType === 'Image' && node.props.region) {
      const fact = facts[node.props.source] as ImageFacts | undefined;
      const region = node.props.region;
      if (fact && Number.isSafeInteger(fact.width) && Number.isSafeInteger(fact.height)
        && (region.x + region.width > fact.width || region.y + region.height > fact.height)) {
        issues.push({ path: '$intent.root', code: 'IMAGE_REGION_OUT_OF_BOUNDS', message: `Image region for ${node.id} exceeds decoded source bounds` });
      }
    }
  }
  if (issues.length) throw new HarnessError('compile', issues);
  return structuredClone(input) as ImageFactsMap;
}

function materializeNode(node: TreeIntentNode, layouts: Readonly<Record<string, Layout>>): UiNode {
  const base = { id: node.id, type: node.componentType, layout: layouts[node.id], props: structuredClone(node.props) };
  if ('children' in node) return { ...base, children: node.children.map(child => materializeNode(child, layouts)) } as UiNode;
  return base as UiNode;
}

/** Pure compiler: combines explicit intent, actual decoded image facts, and stated layout policy. */
export function compileTree(input: unknown, imageFacts: unknown, settings: unknown): UiDocument {
  const intent = validateTreeIntent(input);
  const policy = validateTreePolicy(settings);
  const nodes = collectIntentNodes(intent.root);
  const nodeIds = new Set(nodes.map(node => node.id));
  const layoutIssues: Issue[] = [];
  for (const id of nodeIds) if (!Object.hasOwn(policy.layout, id)) layoutIssues.push({ path: `$policy.layout[${JSON.stringify(id)}]`, code: 'MISSING_LAYOUT', message: 'every node requires an explicit policy layout' });
  for (const id of Object.keys(policy.layout)) if (!nodeIds.has(id)) layoutIssues.push({ path: `$policy.layout[${JSON.stringify(id)}]`, code: 'UNUSED_LAYOUT', message: 'policy layout does not belong to an intent node' });
  if (layoutIssues.length) throw new HarnessError('compile', layoutIssues);
  validateImageFacts(imageFacts, collectImageSources(nodes), nodes);
  const document = { schemaVersion: UI_SCHEMA_VERSION, id: intent.id, canvas: policy.canvas, root: materializeNode(intent.root, policy.layout) };
  try { return validateDocument(document); }
  catch (error) {
    if (error instanceof HarnessError) throw new HarnessError('compile', error.issues);
    throw error;
  }
}
