import { HarnessError, type Issue } from './contract.ts';
import { validateResourceReference } from './resource-reference.ts';

/** Strict, engine-neutral UI document contract for the v0.2 tree runtime. */
export const UI_SCHEMA_VERSION = '0.2' as const;
export const MAX_TREE_DEPTH = 32;
export const MAX_TREE_NODES = 1_000;

export type UiNodeType =
  | 'Image' | 'Text' | 'Container' | 'Button' | 'Switch' | 'CheckBox'
  | 'RadioGroup' | 'Input' | 'Select' | 'ProgressBar' | 'Slider'
  | 'ScrollView' | 'List' | 'Panel' | 'Dialog' | 'Tabs';

export interface Layout { x: number; y: number; width: number; height: number }
export interface CanvasSize { width: number; height: number }
export interface ImageRegion { x: number; y: number; width: number; height: number }
export interface ControlStyle {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
  textColor: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  opacity: number;
}

export interface Choice { id: string; label: string }
export interface TabDefinition { id: string; label: string; contentId: string }

export interface ImageProps { source: string; region?: ImageRegion; fit: 'stretch' | 'contain' | 'cover'; style: ControlStyle }
export interface TextProps { text: string; wrap: 'none' | 'word'; overflow: 'clip' | 'ellipsis' | 'error'; lineHeight: number; fontSource?: string; style: ControlStyle }
export interface ContainerProps { style: ControlStyle }
export interface ButtonProps { label: string; enabled: boolean; style: ControlStyle }
export interface ToggleProps { label: string; checked: boolean; enabled: boolean; style: ControlStyle }
export interface ChoiceProps { selectedId: string | null; options: Choice[]; enabled: boolean; style: ControlStyle }
export interface InputProps { value: string; placeholder: string; inputType: 'text' | 'password' | 'email' | 'number'; readOnly: boolean; maxLength: number; enabled: boolean; style: ControlStyle }
export interface ProgressBarProps { value: number; max: number; style: ControlStyle }
export interface SliderProps { value: number; min: number; max: number; step: number; enabled: boolean; style: ControlStyle }
export interface ScrollViewProps { scrollX: number; scrollY: number; contentWidth: number; contentHeight: number; style: ControlStyle }
export interface ListProps { selectedId: string | null; items: Choice[]; itemTemplate: 'text-row'; itemHeight: number; enabled: boolean; style: ControlStyle }
export interface PanelProps { title: string; style: ControlStyle }
export interface DialogProps { open: boolean; title: string; modal: boolean; style: ControlStyle }
export interface TabsProps { activeId: string; tabs: TabDefinition[]; enabled: boolean; style: ControlStyle }

interface BaseNode<T extends UiNodeType, P> { id: string; type: T; layout: Layout; props: P }
export type ImageNode = BaseNode<'Image', ImageProps>;
export type TextNode = BaseNode<'Text', TextProps>;
export type ContainerNode = BaseNode<'Container', ContainerProps> & { children: UiNode[] };
export type ButtonNode = BaseNode<'Button', ButtonProps> & { children: UiNode[] };
export type SwitchNode = BaseNode<'Switch', ToggleProps>;
export type CheckBoxNode = BaseNode<'CheckBox', ToggleProps>;
export type RadioGroupNode = BaseNode<'RadioGroup', ChoiceProps>;
export type InputNode = BaseNode<'Input', InputProps>;
export type SelectNode = BaseNode<'Select', ChoiceProps>;
export type ProgressBarNode = BaseNode<'ProgressBar', ProgressBarProps>;
export type SliderNode = BaseNode<'Slider', SliderProps>;
export type ScrollViewNode = BaseNode<'ScrollView', ScrollViewProps> & { children: UiNode[] };
export type ListNode = BaseNode<'List', ListProps> & { children: UiNode[] };
export type PanelNode = BaseNode<'Panel', PanelProps> & { children: UiNode[] };
export type DialogNode = BaseNode<'Dialog', DialogProps> & { children: UiNode[] };
export type TabsNode = BaseNode<'Tabs', TabsProps> & { children: UiNode[] };
export type UiNode = ImageNode | TextNode | ContainerNode | ButtonNode | SwitchNode | CheckBoxNode
  | RadioGroupNode | InputNode | SelectNode | ProgressBarNode | SliderNode | ScrollViewNode
  | ListNode | PanelNode | DialogNode | TabsNode;

export interface UiDocument { schemaVersion: typeof UI_SCHEMA_VERSION; id: string; canvas: CanvasSize; root: UiNode }

const nodeTypes = new Set<UiNodeType>([
  'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
  'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
]);
const compositeTypes = new Set<UiNodeType>(['Container', 'Button', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs']);
const identifierPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;
const colorPattern = /^(?:#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6})$/;

interface PendingReference { path: string; value: string; target: 'node' | 'choice' | 'item' | 'tab'; directChildren?: Set<string> }

class ContractValidator {
  readonly issues: Issue[] = [];
  readonly allIds = new Set<string>();
  readonly nodeIds = new Set<string>();
  readonly choiceIds = new Set<string>();
  readonly itemIds = new Set<string>();
  readonly tabIds = new Set<string>();
  readonly references: PendingReference[] = [];
  private nodes = 0;
  private readonly ancestors = new WeakSet<object>();

  add(path: string, code: string, message: string): void { this.issues.push({ path, code, message }); }
  object(value: unknown, path: string, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.add(path, 'OBJECT_REQUIRED', 'must be an object'); return null;
    }
    const data = value as Record<string, unknown>;
    for (const key of required) if (!Object.hasOwn(data, key)) this.add(`${path}.${key}`, 'REQUIRED', 'required field is missing');
    for (const key of Object.keys(data)) if (!keys.includes(key)) this.add(`${path}.${key}`, 'UNSUPPORTED_FIELD', 'unknown fields are not accepted');
    return data;
  }
  string(value: unknown, path: string, allowEmpty = false): value is string {
    if (typeof value !== 'string' || value !== value.trim() || (!allowEmpty && value.length === 0)) {
      this.add(path, 'STRING_REQUIRED', allowEmpty ? 'must be a trimmed string' : 'must be a non-empty trimmed string'); return false;
    }
    return true;
  }
  identifier(value: unknown, path: string, kind: 'node' | 'choice' | 'item' | 'tab'): value is string {
    if (!this.string(value, path) || !identifierPattern.test(value)) {
      if (typeof value === 'string' && value === value.trim() && value.length > 0) this.add(path, 'INVALID_ID', 'ID must start with a letter and contain only letters, digits, dot, underscore, or hyphen');
      return false;
    }
    if (this.allIds.has(value)) this.add(path, 'DUPLICATE_ID', `ID is already used: ${value}`);
    else {
      this.allIds.add(value);
      if (kind === 'node') this.nodeIds.add(value);
      else if (kind === 'choice') this.choiceIds.add(value);
      else if (kind === 'item') this.itemIds.add(value);
      else this.tabIds.add(value);
    }
    return true;
  }
  finite(value: unknown, path: string, options: { positive?: boolean; nonNegative?: boolean; integer?: boolean; min?: number; max?: number } = {}): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || (options.integer && !Number.isSafeInteger(value))
      || (options.positive && value <= 0) || (options.nonNegative && value < 0)
      || (options.min !== undefined && value < options.min) || (options.max !== undefined && value > options.max)) {
      this.add(path, 'INVALID_NUMBER', 'must be a finite number in the required range'); return false;
    }
    return true;
  }
  boolean(value: unknown, path: string): value is boolean {
    if (typeof value !== 'boolean') { this.add(path, 'BOOLEAN_REQUIRED', 'must be a boolean'); return false; }
    return true;
  }
  resource(value: unknown, path: string): value is string {
    if (!this.string(value, path)) return false;
    try { validateResourceReference(value, path, 'contract'); }
    catch (error) { this.add(path, 'INVALID_RESOURCE_REFERENCE', error instanceof Error ? error.message : 'invalid resource reference'); return false; }
    return true;
  }
  layout(value: unknown, path: string): void {
    const data = this.object(value, path, ['x', 'y', 'width', 'height']);
    if (!data) return;
    this.finite(data.x, `${path}.x`); this.finite(data.y, `${path}.y`);
    this.finite(data.width, `${path}.width`, { positive: true }); this.finite(data.height, `${path}.height`, { positive: true });
  }
  canvas(value: unknown, path: string): void {
    const data = this.object(value, path, ['width', 'height']);
    if (!data) return;
    this.finite(data.width, `${path}.width`, { positive: true }); this.finite(data.height, `${path}.height`, { positive: true });
  }
  style(value: unknown, path: string): void {
    const data = this.object(value, path, ['backgroundColor', 'borderColor', 'borderWidth', 'cornerRadius', 'textColor', 'fontFamily', 'fontSize', 'fontWeight', 'opacity']);
    if (!data) return;
    for (const key of ['backgroundColor', 'borderColor', 'textColor'] as const) {
      if (!this.string(data[key], `${path}.${key}`) || !colorPattern.test(data[key] as string)) this.add(`${path}.${key}`, 'COLOR_REQUIRED', 'must be a #RGB or #RRGGBB color');
    }
    this.finite(data.borderWidth, `${path}.borderWidth`, { nonNegative: true });
    this.finite(data.cornerRadius, `${path}.cornerRadius`, { nonNegative: true });
    this.string(data.fontFamily, `${path}.fontFamily`);
    this.finite(data.fontSize, `${path}.fontSize`, { positive: true });
    if (data.fontWeight !== 'normal' && data.fontWeight !== 'bold') this.add(`${path}.fontWeight`, 'UNSUPPORTED_VALUE', 'must be normal or bold');
    this.finite(data.opacity, `${path}.opacity`, { min: 0, max: 1 });
  }
  choices(value: unknown, path: string, kind: 'choice' | 'item', minimum = 0): string[] {
    if (!Array.isArray(value)) { this.add(path, 'ARRAY_REQUIRED', 'must be an array'); return []; }
    if (value.length < minimum) this.add(path, 'MIN_ITEMS_REQUIRED', `must contain at least ${minimum} item`);
    const ids: string[] = [];
    value.forEach((entry, index) => {
      const itemPath = `${path}[${index}]`;
      const data = this.object(entry, itemPath, ['id', 'label']);
      if (!data) return;
      if (this.identifier(data.id, `${itemPath}.id`, kind)) ids.push(data.id);
      this.string(data.label, `${itemPath}.label`);
    });
    return ids;
  }
  selected(value: unknown, path: string, ids: readonly string[], target: 'choice' | 'item'): void {
    if (value === null) return;
    if (!this.string(value, path)) return;
    if (!ids.includes(value)) this.add(path, 'BROKEN_REFERENCE', `must reference a declared ${target} ID`);
  }
  node(value: unknown, path: string, depth: number): void {
    if (depth > MAX_TREE_DEPTH) { this.add(path, 'TREE_DEPTH_LIMIT', `tree depth must not exceed ${MAX_TREE_DEPTH}`); return; }
    if (typeof value === 'object' && value !== null) {
      if (this.ancestors.has(value)) { this.add(path, 'TREE_CYCLE', 'tree must not contain a cycle'); return; }
      this.ancestors.add(value);
    }
    this.nodes += 1;
    if (this.nodes > MAX_TREE_NODES) this.add(path, 'TREE_NODE_LIMIT', `tree must not exceed ${MAX_TREE_NODES} nodes`);
    const raw = value as Record<string, unknown> | null;
    const rawType = raw && typeof raw.type === 'string' ? raw.type : undefined;
    const type = rawType && nodeTypes.has(rawType as UiNodeType) ? rawType as UiNodeType : undefined;
    const keys = type && compositeTypes.has(type) ? ['id', 'type', 'layout', 'props', 'children'] : ['id', 'type', 'layout', 'props'];
    const data = this.object(value, path, keys);
    if (!data) { if (typeof value === 'object' && value !== null) this.ancestors.delete(value); return; }
    if (!type) this.add(`${path}.type`, 'UNSUPPORTED_TYPE', 'unsupported renderable node type');
    this.identifier(data.id, `${path}.id`, 'node');
    this.layout(data.layout, `${path}.layout`);
    if (type) this.props(type, data.props, `${path}.props`);
    if (type === 'ScrollView') this.scrollBounds(data.props, data.layout, `${path}.props`);
    if (type && compositeTypes.has(type)) {
      if (!Array.isArray(data.children)) this.add(`${path}.children`, 'ARRAY_REQUIRED', 'composite node children must be an array');
      else data.children.forEach((child, index) => this.node(child, `${path}.children[${index}]`, depth + 1));
      if (type === 'Tabs' && Array.isArray(data.children)) this.validateTabContentRefs(data.props, `${path}.props`, data.children);
    }
    if (typeof value === 'object' && value !== null) this.ancestors.delete(value);
  }
  props(type: UiNodeType, value: unknown, path: string): void {
    const keysByType: Record<UiNodeType, readonly string[]> = {
      Image: ['source', 'region', 'fit', 'style'], Text: ['text', 'wrap', 'overflow', 'lineHeight', 'fontSource', 'style'],
      Container: ['style'], Button: ['label', 'enabled', 'style'], Switch: ['label', 'checked', 'enabled', 'style'], CheckBox: ['label', 'checked', 'enabled', 'style'],
      RadioGroup: ['selectedId', 'options', 'enabled', 'style'], Input: ['value', 'placeholder', 'inputType', 'readOnly', 'maxLength', 'enabled', 'style'],
      Select: ['selectedId', 'options', 'enabled', 'style'], ProgressBar: ['value', 'max', 'style'], Slider: ['value', 'min', 'max', 'step', 'enabled', 'style'],
      ScrollView: ['scrollX', 'scrollY', 'contentWidth', 'contentHeight', 'style'], List: ['selectedId', 'items', 'itemTemplate', 'itemHeight', 'enabled', 'style'],
      Panel: ['title', 'style'], Dialog: ['open', 'title', 'modal', 'style'], Tabs: ['activeId', 'tabs', 'enabled', 'style'],
    };
    const optionalByType: Partial<Record<UiNodeType, readonly string[]>> = { Image: ['region'], Text: ['fontSource'] };
    const allowed = keysByType[type];
    const required = keysByType[type].filter(key => !optionalByType[type]?.includes(key));
    const data = this.object(value, path, allowed, required);
    if (!data) return;
    switch (type) {
      case 'Image': {
        this.resource(data.source, `${path}.source`);
        if (Object.hasOwn(data, 'region')) this.region(data.region, `${path}.region`);
        if (data.fit !== 'stretch' && data.fit !== 'contain' && data.fit !== 'cover') this.add(`${path}.fit`, 'UNSUPPORTED_VALUE', 'must be stretch, contain, or cover');
        this.style(data.style, `${path}.style`); break;
      }
      case 'Text': {
        this.string(data.text, `${path}.text`, true);
        if (data.wrap !== 'none' && data.wrap !== 'word') this.add(`${path}.wrap`, 'UNSUPPORTED_VALUE', 'must be none or word');
        if (data.overflow !== 'clip' && data.overflow !== 'ellipsis' && data.overflow !== 'error') this.add(`${path}.overflow`, 'UNSUPPORTED_VALUE', 'must be clip, ellipsis, or error');
        this.finite(data.lineHeight, `${path}.lineHeight`, { positive: true });
        if (Object.hasOwn(data, 'fontSource')) this.resource(data.fontSource, `${path}.fontSource`);
        this.style(data.style, `${path}.style`); break;
      }
      case 'Container': case 'Panel':
        if (type === 'Panel') this.string(data.title, `${path}.title`, true);
        this.style(data.style, `${path}.style`); break;
      case 'Button':
        this.string(data.label, `${path}.label`, true); this.boolean(data.enabled, `${path}.enabled`); this.style(data.style, `${path}.style`); break;
      case 'Switch': case 'CheckBox':
        this.string(data.label, `${path}.label`, true); this.boolean(data.checked, `${path}.checked`); this.boolean(data.enabled, `${path}.enabled`); this.style(data.style, `${path}.style`); break;
      case 'RadioGroup': case 'Select': {
        const ids = this.choices(data.options, `${path}.options`, 'choice', 1);
        this.selected(data.selectedId, `${path}.selectedId`, ids, 'choice'); this.boolean(data.enabled, `${path}.enabled`); this.style(data.style, `${path}.style`); break;
      }
      case 'Input':
        this.string(data.value, `${path}.value`, true); this.string(data.placeholder, `${path}.placeholder`, true);
        if (data.inputType !== 'text' && data.inputType !== 'password' && data.inputType !== 'email' && data.inputType !== 'number') this.add(`${path}.inputType`, 'UNSUPPORTED_VALUE', 'unsupported input type');
        this.boolean(data.readOnly, `${path}.readOnly`); this.finite(data.maxLength, `${path}.maxLength`, { positive: true, integer: true });
        if (typeof data.value === 'string' && typeof data.maxLength === 'number' && Number.isSafeInteger(data.maxLength) && data.value.length > data.maxLength) this.add(`${path}.value`, 'VALUE_TOO_LONG', 'value exceeds maxLength');
        this.boolean(data.enabled, `${path}.enabled`); this.style(data.style, `${path}.style`); break;
      case 'ProgressBar':
        this.finite(data.max, `${path}.max`, { positive: true }); this.finite(data.value, `${path}.value`, { nonNegative: true });
        if (typeof data.value === 'number' && typeof data.max === 'number' && Number.isFinite(data.value) && Number.isFinite(data.max) && data.value > data.max) this.add(`${path}.value`, 'OUT_OF_RANGE', 'value must not exceed max');
        this.style(data.style, `${path}.style`); break;
      case 'Slider':
        this.finite(data.min, `${path}.min`); this.finite(data.max, `${path}.max`); this.finite(data.step, `${path}.step`, { positive: true }); this.finite(data.value, `${path}.value`);
        if (this.validRange(data.min, data.max, path)) {
          const max = data.max as number;
          if (typeof data.value === 'number' && Number.isFinite(data.value) && (data.value < data.min || data.value > max)) this.add(`${path}.value`, 'OUT_OF_RANGE', 'value must be inside min/max');
          if (typeof data.value === 'number' && typeof data.step === 'number' && Number.isFinite(data.value) && Number.isFinite(data.step) && !isStepAligned(data.value, data.min, data.step)) this.add(`${path}.value`, 'STEP_MISMATCH', 'value must align with min and step');
        }
        this.boolean(data.enabled, `${path}.enabled`); this.style(data.style, `${path}.style`); break;
      case 'ScrollView':
        this.finite(data.scrollX, `${path}.scrollX`, { nonNegative: true }); this.finite(data.scrollY, `${path}.scrollY`, { nonNegative: true });
        this.finite(data.contentWidth, `${path}.contentWidth`, { positive: true }); this.finite(data.contentHeight, `${path}.contentHeight`, { positive: true }); this.style(data.style, `${path}.style`); break;
      case 'List': {
        const ids = this.choices(data.items, `${path}.items`, 'item');
        this.selected(data.selectedId, `${path}.selectedId`, ids, 'item');
        if (data.itemTemplate !== 'text-row') this.add(`${path}.itemTemplate`, 'UNSUPPORTED_VALUE', 'v0.2 supports only the text-row item template');
        this.finite(data.itemHeight, `${path}.itemHeight`, { positive: true }); this.boolean(data.enabled, `${path}.enabled`); this.style(data.style, `${path}.style`); break;
      }
      case 'Dialog':
        this.boolean(data.open, `${path}.open`); this.string(data.title, `${path}.title`, true); this.boolean(data.modal, `${path}.modal`); this.style(data.style, `${path}.style`); break;
      case 'Tabs':
        if (this.string(data.activeId, `${path}.activeId`) && !identifierPattern.test(data.activeId)) this.add(`${path}.activeId`, 'INVALID_ID', 'must be a valid tab ID reference');
        this.tabs(data.tabs, `${path}.tabs`); this.boolean(data.enabled, `${path}.enabled`); this.style(data.style, `${path}.style`); break;
    }
  }
  region(value: unknown, path: string): void {
    const data = this.object(value, path, ['x', 'y', 'width', 'height']);
    if (!data) return;
    this.finite(data.x, `${path}.x`, { nonNegative: true, integer: true }); this.finite(data.y, `${path}.y`, { nonNegative: true, integer: true });
    this.finite(data.width, `${path}.width`, { positive: true, integer: true }); this.finite(data.height, `${path}.height`, { positive: true, integer: true });
  }
  scrollBounds(props: unknown, layout: unknown, path: string): void {
    if (typeof props !== 'object' || props === null || Array.isArray(props)
      || typeof layout !== 'object' || layout === null || Array.isArray(layout)) return;
    const data = props as Record<string, unknown>;
    const bounds = layout as Record<string, unknown>;
    if (typeof data.scrollX === 'number' && typeof data.contentWidth === 'number' && typeof bounds.width === 'number'
      && Number.isFinite(data.scrollX) && Number.isFinite(data.contentWidth) && Number.isFinite(bounds.width)
      && data.scrollX > Math.max(0, data.contentWidth - bounds.width)) {
      this.add(`${path}.scrollX`, 'OUT_OF_RANGE', 'scrollX exceeds content width minus viewport width');
    }
    if (typeof data.scrollY === 'number' && typeof data.contentHeight === 'number' && typeof bounds.height === 'number'
      && Number.isFinite(data.scrollY) && Number.isFinite(data.contentHeight) && Number.isFinite(bounds.height)
      && data.scrollY > Math.max(0, data.contentHeight - bounds.height)) {
      this.add(`${path}.scrollY`, 'OUT_OF_RANGE', 'scrollY exceeds content height minus viewport height');
    }
  }
  tabs(value: unknown, path: string): void {
    if (!Array.isArray(value)) { this.add(path, 'ARRAY_REQUIRED', 'must be an array'); return; }
    if (value.length === 0) this.add(path, 'MIN_ITEMS_REQUIRED', 'tabs must contain at least one tab');
    value.forEach((entry, index) => {
      const tabPath = `${path}[${index}]`;
      const data = this.object(entry, tabPath, ['id', 'label', 'contentId']);
      if (!data) return;
      this.identifier(data.id, `${tabPath}.id`, 'tab'); this.string(data.label, `${tabPath}.label`);
      if (this.string(data.contentId, `${tabPath}.contentId`) && !identifierPattern.test(data.contentId)) this.add(`${tabPath}.contentId`, 'INVALID_ID', 'must be a valid node ID reference');
    });
  }
  validateTabContentRefs(props: unknown, path: string, children: unknown[]): void {
    const data = props as { tabs?: unknown; activeId?: unknown };
    if (!Array.isArray(data.tabs)) return;
    const childIds = new Set<string>();
    children.forEach(child => {
      if (typeof child === 'object' && child !== null && !Array.isArray(child) && typeof (child as Record<string, unknown>).id === 'string') childIds.add((child as Record<string, unknown>).id as string);
    });
    const tabIds = new Set<string>();
    data.tabs.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return;
      const tab = entry as Record<string, unknown>;
      if (typeof tab.id === 'string') tabIds.add(tab.id);
      if (typeof tab.contentId === 'string' && !childIds.has(tab.contentId)) this.add(`${path}.tabs[${index}].contentId`, 'BROKEN_REFERENCE', 'must reference a direct child node');
    });
    if (typeof data.activeId === 'string' && !tabIds.has(data.activeId)) this.add(`${path}.activeId`, 'BROKEN_REFERENCE', 'must reference a declared tab ID');
  }
  validRange(min: unknown, max: unknown, path: string): min is number {
    if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max)) return false;
    if (max <= min) { this.add(`${path}.max`, 'INVALID_RANGE', 'slider max must be greater than min'); return false; }
    return true;
  }
  finish(): void { if (this.issues.length) throw new HarnessError('contract', this.issues); }
}

function isStepAligned(value: number, min: number, step: number): boolean {
  const quotient = (value - min) / step;
  return Math.abs(quotient - Math.round(quotient)) <= Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
}

/** Validate and clone a complete v0.2 UI tree without changing any caller-owned value. */
export function validateDocument(input: unknown): UiDocument {
  const validator = new ContractValidator();
  const root = validator.object(input, '$', ['schemaVersion', 'id', 'canvas', 'root']);
  if (root) {
    if (root.schemaVersion !== UI_SCHEMA_VERSION) validator.add('$.schemaVersion', 'UNSUPPORTED_VERSION', 'only schemaVersion 0.2 is supported');
    validator.identifier(root.id, '$.id', 'node');
    validator.canvas(root.canvas, '$.canvas');
    validator.node(root.root, '$.root', 1);
  }
  validator.finish();
  return structuredClone(input) as UiDocument;
}

/** Pre-order drawing order. The function remains bounded if an untrusted cast bypassed validation. */
export function walkNodes(document: UiDocument): UiNode[] {
  const result: UiNode[] = [];
  const stack: Array<{ node: UiNode; depth: number }> = [{ node: document.root, depth: 1 }];
  const seen = new WeakSet<object>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth > MAX_TREE_DEPTH || result.length >= MAX_TREE_NODES || seen.has(current.node)) {
      throw new HarnessError('contract', [{ path: '$.root', code: 'INVALID_TREE_WALK', message: 'tree exceeds bounds or contains a cycle' }]);
    }
    seen.add(current.node); result.push(current.node);
    if ('children' in current.node) for (let index = current.node.children.length - 1; index >= 0; index -= 1) stack.push({ node: current.node.children[index], depth: current.depth + 1 });
  }
  return result;
}
