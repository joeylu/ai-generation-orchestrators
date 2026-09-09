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
export interface Point { x: number; y: number }
export interface SwitchRasterAppearance {
  trackImage: string;
  thumbImage: string;
  sourceCanvas: CanvasSize;
  thumbPositions: { off: Point; on: Point };
  labelLayout?: Layout;
}
export interface ButtonRasterAppearance { backgroundImage: string; sourceCanvas: CanvasSize; labelLayout: Layout }
export interface SelectRasterAppearance {
  fieldImage: string;
  arrowImage: string;
  popupImage: string;
  sourceCanvas: CanvasSize;
  labelLayout: Layout;
  arrowLayout: Layout;
  popupCanvas: CanvasSize;
  popupGap: number;
}
export interface PositionedRasterPart { image: string; canvas: CanvasSize; layout: Layout }
export interface CheckBoxRasterAppearance {
  sourceCanvas: CanvasSize;
  box: PositionedRasterPart;
  mark: PositionedRasterPart;
  labelLayout: Layout;
}
export interface RadioGroupRasterAppearance {
  sourceCanvas: CanvasSize;
  items: Array<{ optionId: string; option: PositionedRasterPart; indicator: PositionedRasterPart; hitArea: Layout; labelLayout: Layout }>;
}
export interface InputRasterAppearance { backgroundImage: string; sourceCanvas: CanvasSize; textLayout: Layout; placeholderLayout: Layout }
export interface ProgressBarRasterAppearance {
  sourceCanvas: CanvasSize;
  track: PositionedRasterPart;
  fill: PositionedRasterPart;
  fillClip: Layout;
  fillDirection: 'left-to-right';
  fillSource: 'full-range-template';
}
export interface SliderRasterAppearance {
  sourceCanvas: CanvasSize;
  track: PositionedRasterPart;
  fill: PositionedRasterPart;
  fillClip: Layout;
  fillDirection: 'left-to-right';
  fillSource: 'full-range-template';
  thumbImage: string;
  thumbCanvas: CanvasSize;
  thumbPositions: { min: Point; max: Point };
}
export interface ScrollViewRasterAppearance {
  sourceCanvas: CanvasSize;
  viewport: PositionedRasterPart;
  scrollbarTrack: PositionedRasterPart;
  scrollbarThumbImage: string;
  scrollbarThumbCanvas: CanvasSize;
  scrollbarThumbPositions: { min: Point; max: Point };
}
export interface ListRasterAppearance {
  sourceCanvas: CanvasSize;
  backgroundImage: string;
  rowImage: string;
  rowCanvas: CanvasSize;
  selectedRowImage: string;
  selectedRowCanvas: CanvasSize;
  labelLayout: Layout;
  hitArea: Layout;
}
export interface DialogRasterAppearance {
  sourceCanvas: CanvasSize;
  background: PositionedRasterPart;
  header: PositionedRasterPart;
  body: PositionedRasterPart;
  overlayImage?: string;
  overlayCanvas?: CanvasSize;
  titleLayout: Layout;
}
export interface TabsRasterAppearance {
  sourceCanvas: CanvasSize;
  tabImage: string;
  tabCanvas: CanvasSize;
  activeTabImage: string;
  activeTabCanvas: CanvasSize;
  headerHeight: number;
  labelLayout: Layout;
  hitArea: Layout;
}
export interface ContainerRasterAppearance {
  sourceCanvas: CanvasSize;
  background: PositionedRasterPart;
}
export interface PanelRasterAppearance {
  sourceCanvas: CanvasSize;
  background: PositionedRasterPart;
  header: PositionedRasterPart;
  body?: PositionedRasterPart;
  /** The semantic title remains Pixi text; this only fixes its explicit bounds. */
  titleLayout: Layout;
}

export interface ImageProps { source: string; region?: ImageRegion; fit: 'stretch' | 'contain' | 'cover'; drawBackground?: boolean; style: ControlStyle }
export interface TextProps { text: string; wrap: 'none' | 'word'; overflow: 'clip' | 'ellipsis' | 'error'; lineHeight: number; fontSource?: string; style: ControlStyle }
export interface ContainerProps { appearance?: ContainerRasterAppearance; style: ControlStyle }
export interface ButtonProps { label: string; enabled: boolean; backgroundImage?: string; appearance?: ButtonRasterAppearance; style: ControlStyle }
export interface ToggleProps { label: string; checked: boolean; enabled: boolean; style: ControlStyle }
export interface SwitchProps extends ToggleProps { appearance?: SwitchRasterAppearance }
export interface ChoiceProps { selectedId: string | null; options: Choice[]; enabled: boolean; style: ControlStyle }
export interface CheckBoxProps extends ToggleProps { appearance?: CheckBoxRasterAppearance }
export interface RadioGroupProps extends ChoiceProps { appearance?: RadioGroupRasterAppearance }
export interface SelectProps extends ChoiceProps { appearance?: SelectRasterAppearance }
export interface InputProps { value: string; placeholder: string; inputType: 'text' | 'password' | 'email' | 'number'; readOnly: boolean; maxLength: number; enabled: boolean; appearance?: InputRasterAppearance; style: ControlStyle }
export interface ProgressBarProps { value: number; max: number; appearance?: ProgressBarRasterAppearance; style: ControlStyle }
export interface SliderProps { value: number; min: number; max: number; step: number; enabled: boolean; appearance?: SliderRasterAppearance; style: ControlStyle }
export interface ScrollViewProps { scrollX: number; scrollY: number; contentWidth: number; contentHeight: number; appearance?: ScrollViewRasterAppearance; style: ControlStyle }
export interface ListProps { selectedId: string | null; items: Choice[]; itemTemplate: 'text-row'; itemHeight: number; enabled: boolean; appearance?: ListRasterAppearance; style: ControlStyle }
export interface PanelProps { title: string; appearance?: PanelRasterAppearance; style: ControlStyle }
export interface DialogProps { open: boolean; title: string; modal: boolean; appearance?: DialogRasterAppearance; style: ControlStyle }
export interface TabsProps { activeId: string; tabs: TabDefinition[]; enabled: boolean; appearance?: TabsRasterAppearance; style: ControlStyle }

interface BaseNode<T extends UiNodeType, P> { id: string; type: T; layout: Layout; props: P }
export type ImageNode = BaseNode<'Image', ImageProps>;
export type TextNode = BaseNode<'Text', TextProps>;
export type ContainerNode = BaseNode<'Container', ContainerProps> & { children: UiNode[] };
export type ButtonNode = BaseNode<'Button', ButtonProps> & { children: UiNode[] };
export type SwitchNode = BaseNode<'Switch', SwitchProps>;
export type CheckBoxNode = BaseNode<'CheckBox', CheckBoxProps>;
export type RadioGroupNode = BaseNode<'RadioGroup', RadioGroupProps>;
export type InputNode = BaseNode<'Input', InputProps>;
export type SelectNode = BaseNode<'Select', SelectProps>;
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
  rasterCanvas(value: unknown, path: string): void {
    const data = this.object(value, path, ['width', 'height']); if (!data) return;
    this.finite(data.width, `${path}.width`, { positive: true, integer: true }); this.finite(data.height, `${path}.height`, { positive: true, integer: true });
  }
  appearanceLayout(value: unknown, path: string, canvas?: Record<string, unknown> | null): void {
    const data = this.object(value, path, ['x', 'y', 'width', 'height']);
    if (!data) return;
    const x = this.finite(data.x, `${path}.x`, { nonNegative: true }); const y = this.finite(data.y, `${path}.y`, { nonNegative: true });
    const width = this.finite(data.width, `${path}.width`, { positive: true }); const height = this.finite(data.height, `${path}.height`, { positive: true });
    if (canvas && x && width && typeof canvas.width === 'number' && data.x as number + (data.width as number) > canvas.width) this.add(path, 'OUT_OF_RANGE', 'layout exceeds sourceCanvas width');
    if (canvas && y && height && typeof canvas.height === 'number' && data.y as number + (data.height as number) > canvas.height) this.add(path, 'OUT_OF_RANGE', 'layout exceeds sourceCanvas height');
  }
  positionedRasterPart(value: unknown, path: string, sourceCanvas?: Record<string, unknown> | null): void {
    const data = this.object(value, path, ['image', 'canvas', 'layout']);
    if (!data) return;
    this.resource(data.image, `${path}.image`); this.rasterCanvas(data.canvas, `${path}.canvas`); this.appearanceLayout(data.layout, `${path}.layout`, sourceCanvas);
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
      Image: ['source', 'region', 'fit', 'drawBackground', 'style'], Text: ['text', 'wrap', 'overflow', 'lineHeight', 'fontSource', 'style'],
      Container: ['appearance', 'style'], Button: ['label', 'enabled', 'backgroundImage', 'appearance', 'style'], Switch: ['label', 'checked', 'enabled', 'appearance', 'style'], CheckBox: ['label', 'checked', 'enabled', 'appearance', 'style'],
      RadioGroup: ['selectedId', 'options', 'enabled', 'appearance', 'style'], Input: ['value', 'placeholder', 'inputType', 'readOnly', 'maxLength', 'enabled', 'appearance', 'style'],
      Select: ['selectedId', 'options', 'enabled', 'appearance', 'style'], ProgressBar: ['value', 'max', 'appearance', 'style'], Slider: ['value', 'min', 'max', 'step', 'enabled', 'appearance', 'style'],
      ScrollView: ['scrollX', 'scrollY', 'contentWidth', 'contentHeight', 'appearance', 'style'], List: ['selectedId', 'items', 'itemTemplate', 'itemHeight', 'enabled', 'appearance', 'style'],
      Panel: ['title', 'appearance', 'style'], Dialog: ['open', 'title', 'modal', 'appearance', 'style'], Tabs: ['activeId', 'tabs', 'enabled', 'appearance', 'style'],
    };
    const optionalByType: Partial<Record<UiNodeType, readonly string[]>> = { Image: ['region', 'drawBackground'], Text: ['fontSource'], Container: ['appearance'], Button: ['backgroundImage', 'appearance'], Switch: ['appearance'], CheckBox: ['appearance'], RadioGroup: ['appearance'], Input: ['appearance'], Select: ['appearance'], ProgressBar: ['appearance'], Slider: ['appearance'], ScrollView: ['appearance'], List: ['appearance'], Panel: ['appearance'], Dialog: ['appearance'], Tabs: ['appearance'] };
    const allowed = keysByType[type];
    const required = keysByType[type].filter(key => !optionalByType[type]?.includes(key));
    const data = this.object(value, path, allowed, required);
    if (!data) return;
    switch (type) {
      case 'Image': {
        this.resource(data.source, `${path}.source`);
        if (Object.hasOwn(data, 'region')) this.region(data.region, `${path}.region`);
        if (data.fit !== 'stretch' && data.fit !== 'contain' && data.fit !== 'cover') this.add(`${path}.fit`, 'UNSUPPORTED_VALUE', 'must be stretch, contain, or cover');
        if (Object.hasOwn(data, 'drawBackground')) this.boolean(data.drawBackground, `${path}.drawBackground`);
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
        if (Object.hasOwn(data, 'appearance')) {
          if (type === 'Container') {
            const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'background']);
            if (appearance) {
              const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
              if (sourceCanvas) {
                this.rasterCanvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`);
                this.positionedRasterPart(appearance.background, `${path}.appearance.background`, sourceCanvas);
              }
            }
          } else {
            const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'background', 'header', 'body', 'titleLayout'], ['sourceCanvas', 'background', 'header', 'titleLayout']);
            if (appearance) {
              const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
              if (sourceCanvas) {
                this.rasterCanvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`);
                this.positionedRasterPart(appearance.background, `${path}.appearance.background`, sourceCanvas);
                this.positionedRasterPart(appearance.header, `${path}.appearance.header`, sourceCanvas);
                if (Object.hasOwn(appearance, 'body')) this.positionedRasterPart(appearance.body, `${path}.appearance.body`, sourceCanvas);
                this.appearanceLayout(appearance.titleLayout, `${path}.appearance.titleLayout`, sourceCanvas);
              }
            }
          }
        }
        this.style(data.style, `${path}.style`); break;
      case 'Button':
        this.string(data.label, `${path}.label`, true); this.boolean(data.enabled, `${path}.enabled`);
        if (Object.hasOwn(data, 'backgroundImage')) this.resource(data.backgroundImage, `${path}.backgroundImage`);
        if (Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['backgroundImage', 'sourceCanvas', 'labelLayout']);
          if (appearance) {
            this.resource(appearance.backgroundImage, `${path}.appearance.backgroundImage`);
            const source = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
            if (source) {
              const width = this.finite(source.width, `${path}.appearance.sourceCanvas.width`, { positive: true });
              const height = this.finite(source.height, `${path}.appearance.sourceCanvas.height`, { positive: true });
              const layout = this.object(appearance.labelLayout, `${path}.appearance.labelLayout`, ['x', 'y', 'width', 'height']);
              if (layout) {
                const x = this.finite(layout.x, `${path}.appearance.labelLayout.x`, { nonNegative: true }); const y = this.finite(layout.y, `${path}.appearance.labelLayout.y`, { nonNegative: true });
                const lw = this.finite(layout.width, `${path}.appearance.labelLayout.width`, { positive: true }); const lh = this.finite(layout.height, `${path}.appearance.labelLayout.height`, { positive: true });
                if (width && x && lw && (layout.x as number) + (layout.width as number) > (source.width as number)) this.add(`${path}.appearance.labelLayout`, 'OUT_OF_RANGE', 'layout exceeds sourceCanvas width');
                if (height && y && lh && (layout.y as number) + (layout.height as number) > (source.height as number)) this.add(`${path}.appearance.labelLayout`, 'OUT_OF_RANGE', 'layout exceeds sourceCanvas height');
              }
            }
          }
        }
        this.style(data.style, `${path}.style`); break;
      case 'Switch': case 'CheckBox':
        this.string(data.label, `${path}.label`, true); this.boolean(data.checked, `${path}.checked`); this.boolean(data.enabled, `${path}.enabled`);
        if (type === 'Switch' && Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['trackImage', 'thumbImage', 'sourceCanvas', 'thumbPositions', 'labelLayout'], ['trackImage', 'thumbImage', 'sourceCanvas', 'thumbPositions']);
          if (appearance) {
            this.resource(appearance.trackImage, `${path}.appearance.trackImage`);
            this.resource(appearance.thumbImage, `${path}.appearance.thumbImage`);
            this.canvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`);
            const positions = this.object(appearance.thumbPositions, `${path}.appearance.thumbPositions`, ['off', 'on']);
            if (positions) for (const state of ['off', 'on'] as const) {
              const point = this.object(positions[state], `${path}.appearance.thumbPositions.${state}`, ['x', 'y']);
              if (point) { this.finite(point.x, `${path}.appearance.thumbPositions.${state}.x`, { nonNegative: true }); this.finite(point.y, `${path}.appearance.thumbPositions.${state}.y`, { nonNegative: true }); }
            }
            if (Object.hasOwn(appearance, 'labelLayout')) this.layout(appearance.labelLayout, `${path}.appearance.labelLayout`);
          }
        }
        if (type === 'CheckBox' && Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'box', 'mark', 'labelLayout']);
          if (appearance) {
            const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
            if (sourceCanvas) { this.canvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.positionedRasterPart(appearance.box, `${path}.appearance.box`, sourceCanvas); this.positionedRasterPart(appearance.mark, `${path}.appearance.mark`, sourceCanvas); this.appearanceLayout(appearance.labelLayout, `${path}.appearance.labelLayout`, sourceCanvas); }
          }
        }
        this.style(data.style, `${path}.style`); break;
      case 'RadioGroup': case 'Select': {
        const ids = this.choices(data.options, `${path}.options`, 'choice', 1);
        this.selected(data.selectedId, `${path}.selectedId`, ids, 'choice'); this.boolean(data.enabled, `${path}.enabled`);
        if (type === 'RadioGroup' && Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'items']);
          if (appearance) {
            const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
            if (sourceCanvas) this.canvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`);
            if (!Array.isArray(appearance.items) || appearance.items.length !== ids.length) this.add(`${path}.appearance.items`, 'OPTION_APPEARANCE_MISMATCH', 'must contain one appearance item for every option');
            else {
              const seen = new Set<string>();
              appearance.items.forEach((raw, index) => {
                const itemPath = `${path}.appearance.items[${index}]`; const item = this.object(raw, itemPath, ['optionId', 'option', 'indicator', 'hitArea', 'labelLayout']); if (!item) return;
                if (!this.string(item.optionId, `${itemPath}.optionId`) || !ids.includes(item.optionId as string)) this.add(`${itemPath}.optionId`, 'BROKEN_REFERENCE', 'must reference an option in this RadioGroup');
                else if (seen.has(item.optionId as string)) this.add(`${itemPath}.optionId`, 'DUPLICATE_OPTION_APPEARANCE', 'each option may appear once'); else seen.add(item.optionId as string);
                this.positionedRasterPart(item.option, `${itemPath}.option`, sourceCanvas); this.positionedRasterPart(item.indicator, `${itemPath}.indicator`, sourceCanvas); this.appearanceLayout(item.hitArea, `${itemPath}.hitArea`, sourceCanvas); this.appearanceLayout(item.labelLayout, `${itemPath}.labelLayout`, sourceCanvas);
              });
            }
          }
        }
        if (type === 'Select' && Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['fieldImage', 'arrowImage', 'popupImage', 'sourceCanvas', 'labelLayout', 'arrowLayout', 'popupCanvas', 'popupGap']);
          if (appearance) {
            this.resource(appearance.fieldImage, `${path}.appearance.fieldImage`);
            this.resource(appearance.arrowImage, `${path}.appearance.arrowImage`);
            this.resource(appearance.popupImage, `${path}.appearance.popupImage`);
            const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
            if (sourceCanvas) {
              const widthValid = this.finite(sourceCanvas.width, `${path}.appearance.sourceCanvas.width`, { positive: true });
              const heightValid = this.finite(sourceCanvas.height, `${path}.appearance.sourceCanvas.height`, { positive: true });
              for (const key of ['labelLayout', 'arrowLayout'] as const) {
                const layout = this.object(appearance[key], `${path}.appearance.${key}`, ['x', 'y', 'width', 'height']);
                if (!layout) continue;
                const xValid = this.finite(layout.x, `${path}.appearance.${key}.x`, { nonNegative: true });
                const yValid = this.finite(layout.y, `${path}.appearance.${key}.y`, { nonNegative: true });
                const layoutWidthValid = this.finite(layout.width, `${path}.appearance.${key}.width`, { positive: true });
                const layoutHeightValid = this.finite(layout.height, `${path}.appearance.${key}.height`, { positive: true });
                if (widthValid && xValid && layoutWidthValid && (layout.x as number) + (layout.width as number) > (sourceCanvas.width as number)) this.add(`${path}.appearance.${key}`, 'OUT_OF_RANGE', 'layout exceeds sourceCanvas width');
                if (heightValid && yValid && layoutHeightValid && (layout.y as number) + (layout.height as number) > (sourceCanvas.height as number)) this.add(`${path}.appearance.${key}`, 'OUT_OF_RANGE', 'layout exceeds sourceCanvas height');
              }
            }
            this.canvas(appearance.popupCanvas, `${path}.appearance.popupCanvas`);
            this.finite(appearance.popupGap, `${path}.appearance.popupGap`, { nonNegative: true });
          }
        }
        this.style(data.style, `${path}.style`); break;
      }
      case 'Input':
        this.string(data.value, `${path}.value`, true); this.string(data.placeholder, `${path}.placeholder`, true);
        if (data.inputType !== 'text' && data.inputType !== 'password' && data.inputType !== 'email' && data.inputType !== 'number') this.add(`${path}.inputType`, 'UNSUPPORTED_VALUE', 'unsupported input type');
        this.boolean(data.readOnly, `${path}.readOnly`); this.finite(data.maxLength, `${path}.maxLength`, { positive: true, integer: true });
        if (typeof data.value === 'string' && typeof data.maxLength === 'number' && Number.isSafeInteger(data.maxLength) && data.value.length > data.maxLength) this.add(`${path}.value`, 'VALUE_TOO_LONG', 'value exceeds maxLength');
        this.boolean(data.enabled, `${path}.enabled`);
        if (Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['backgroundImage', 'sourceCanvas', 'textLayout', 'placeholderLayout']);
          if (appearance) {
            this.resource(appearance.backgroundImage, `${path}.appearance.backgroundImage`); const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
            if (sourceCanvas) { this.rasterCanvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.appearanceLayout(appearance.textLayout, `${path}.appearance.textLayout`, sourceCanvas); this.appearanceLayout(appearance.placeholderLayout, `${path}.appearance.placeholderLayout`, sourceCanvas); }
          }
        }
        this.style(data.style, `${path}.style`); break;
      case 'ProgressBar':
        this.finite(data.max, `${path}.max`, { positive: true }); this.finite(data.value, `${path}.value`, { nonNegative: true });
        if (typeof data.value === 'number' && typeof data.max === 'number' && Number.isFinite(data.value) && Number.isFinite(data.max) && data.value > data.max) this.add(`${path}.value`, 'OUT_OF_RANGE', 'value must not exceed max');
        if (Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'track', 'fill', 'fillClip', 'fillDirection', 'fillSource']);
          if (appearance) {
            const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
            if (sourceCanvas) { this.canvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.positionedRasterPart(appearance.track, `${path}.appearance.track`, sourceCanvas); this.positionedRasterPart(appearance.fill, `${path}.appearance.fill`, sourceCanvas); this.appearanceLayout(appearance.fillClip, `${path}.appearance.fillClip`, sourceCanvas); }
            if (appearance.fillDirection !== 'left-to-right') this.add(`${path}.appearance.fillDirection`, 'UNSUPPORTED_VALUE', 'must be left-to-right');
            if (appearance.fillSource !== 'full-range-template') this.add(`${path}.appearance.fillSource`, 'UNSUPPORTED_VALUE', 'must declare full-range-template');
          }
        }
        this.style(data.style, `${path}.style`); break;
      case 'Slider':
        this.finite(data.min, `${path}.min`); this.finite(data.max, `${path}.max`); this.finite(data.step, `${path}.step`, { positive: true }); this.finite(data.value, `${path}.value`);
        if (this.validRange(data.min, data.max, path)) {
          const max = data.max as number;
          if (typeof data.value === 'number' && Number.isFinite(data.value) && (data.value < data.min || data.value > max)) this.add(`${path}.value`, 'OUT_OF_RANGE', 'value must be inside min/max');
          if (typeof data.value === 'number' && typeof data.step === 'number' && Number.isFinite(data.value) && Number.isFinite(data.step) && !isStepAligned(data.value, data.min, data.step)) this.add(`${path}.value`, 'STEP_MISMATCH', 'value must align with min and step');
        }
        this.boolean(data.enabled, `${path}.enabled`);
        if (Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'track', 'fill', 'fillClip', 'fillDirection', 'fillSource', 'thumbImage', 'thumbCanvas', 'thumbPositions']);
          if (appearance) {
            const sourceCanvas = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']);
            if (sourceCanvas) { this.canvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.positionedRasterPart(appearance.track, `${path}.appearance.track`, sourceCanvas); this.positionedRasterPart(appearance.fill, `${path}.appearance.fill`, sourceCanvas); this.appearanceLayout(appearance.fillClip, `${path}.appearance.fillClip`, sourceCanvas); }
            if (appearance.fillDirection !== 'left-to-right') this.add(`${path}.appearance.fillDirection`, 'UNSUPPORTED_VALUE', 'must be left-to-right');
            if (appearance.fillSource !== 'full-range-template') this.add(`${path}.appearance.fillSource`, 'UNSUPPORTED_VALUE', 'must declare full-range-template');
            this.resource(appearance.thumbImage, `${path}.appearance.thumbImage`); const thumbCanvas = this.object(appearance.thumbCanvas, `${path}.appearance.thumbCanvas`, ['width', 'height']); if (thumbCanvas) this.rasterCanvas(appearance.thumbCanvas, `${path}.appearance.thumbCanvas`);
            const positions = this.object(appearance.thumbPositions, `${path}.appearance.thumbPositions`, ['min', 'max']);
            if (positions) {
              const points = new Map<string, Record<string, unknown>>(); for (const key of ['min', 'max'] as const) {
                const point = this.object(positions[key], `${path}.appearance.thumbPositions.${key}`, ['x', 'y']);
                if (point) { this.finite(point.x, `${path}.appearance.thumbPositions.${key}.x`, { nonNegative: true }); this.finite(point.y, `${path}.appearance.thumbPositions.${key}.y`, { nonNegative: true }); points.set(key, point); }
              }
              const minPoint = points.get('min'), maxPoint = points.get('max');
              if (minPoint && maxPoint && typeof minPoint.x === 'number' && typeof minPoint.y === 'number' && typeof maxPoint.x === 'number' && typeof maxPoint.y === 'number' && (minPoint.y !== maxPoint.y || maxPoint.x <= minPoint.x)) this.add(`${path}.appearance.thumbPositions`, 'SLIDER_AXIS_MISMATCH', 'left-to-right fill requires horizontal endpoints with max.x greater than min.x');
              if (sourceCanvas && thumbCanvas && typeof sourceCanvas.width === 'number' && typeof sourceCanvas.height === 'number' && typeof thumbCanvas.width === 'number' && typeof thumbCanvas.height === 'number') for (const [key, point] of points) if (typeof point.x === 'number' && typeof point.y === 'number' && (point.x + thumbCanvas.width > sourceCanvas.width || point.y + thumbCanvas.height > sourceCanvas.height)) this.add(`${path}.appearance.thumbPositions.${key}`, 'THUMB_OUT_OF_BOUNDS', 'the complete thumb must fit within sourceCanvas');
            }
          }
        }
        this.style(data.style, `${path}.style`); break;
      case 'ScrollView':
        this.finite(data.scrollX, `${path}.scrollX`, { nonNegative: true }); this.finite(data.scrollY, `${path}.scrollY`, { nonNegative: true });
        this.finite(data.contentWidth, `${path}.contentWidth`, { positive: true }); this.finite(data.contentHeight, `${path}.contentHeight`, { positive: true });
        if (Object.hasOwn(data, 'appearance')) {
          const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'viewport', 'scrollbarTrack', 'scrollbarThumbImage', 'scrollbarThumbCanvas', 'scrollbarThumbPositions']);
          if (appearance) {
            const source = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']); if (source) { this.rasterCanvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.positionedRasterPart(appearance.viewport, `${path}.appearance.viewport`, source); this.positionedRasterPart(appearance.scrollbarTrack, `${path}.appearance.scrollbarTrack`, source); }
            this.resource(appearance.scrollbarThumbImage, `${path}.appearance.scrollbarThumbImage`); const thumb = this.object(appearance.scrollbarThumbCanvas, `${path}.appearance.scrollbarThumbCanvas`, ['width', 'height']); if (thumb) this.rasterCanvas(appearance.scrollbarThumbCanvas, `${path}.appearance.scrollbarThumbCanvas`);
            const positions = this.object(appearance.scrollbarThumbPositions, `${path}.appearance.scrollbarThumbPositions`, ['min', 'max']); if (positions) {
              const points: Record<string, Record<string, unknown>> = {}; for (const key of ['min', 'max'] as const) { const point = this.object(positions[key], `${path}.appearance.scrollbarThumbPositions.${key}`, ['x', 'y']); if (point) { this.finite(point.x, `${path}.appearance.scrollbarThumbPositions.${key}.x`, { nonNegative: true }); this.finite(point.y, `${path}.appearance.scrollbarThumbPositions.${key}.y`, { nonNegative: true }); points[key] = point; } }
              if (points.min && points.max && typeof points.min.x === 'number' && typeof points.min.y === 'number' && typeof points.max.x === 'number' && typeof points.max.y === 'number' && (points.min.x !== points.max.x || points.max.y <= points.min.y)) this.add(`${path}.appearance.scrollbarThumbPositions`, 'SCROLLBAR_AXIS_MISMATCH', 'vertical scrollbar requires equal x and increasing y');
              if (source && thumb && typeof source.width === 'number' && typeof source.height === 'number' && typeof thumb.width === 'number' && typeof thumb.height === 'number') for (const [key, point] of Object.entries(points)) if (typeof point.x === 'number' && typeof point.y === 'number' && (point.x + thumb.width > source.width || point.y + thumb.height > source.height)) this.add(`${path}.appearance.scrollbarThumbPositions.${key}`, 'THUMB_OUT_OF_BOUNDS', 'the complete thumb must fit within sourceCanvas');
            }
          }
        }
        this.style(data.style, `${path}.style`); break;
      case 'List': {
        const ids = this.choices(data.items, `${path}.items`, 'item');
        this.selected(data.selectedId, `${path}.selectedId`, ids, 'item');
        if (data.itemTemplate !== 'text-row') this.add(`${path}.itemTemplate`, 'UNSUPPORTED_VALUE', 'v0.2 supports only the text-row item template');
        this.finite(data.itemHeight, `${path}.itemHeight`, { positive: true }); this.boolean(data.enabled, `${path}.enabled`);
        if (Object.hasOwn(data, 'appearance')) { const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'backgroundImage', 'rowImage', 'rowCanvas', 'selectedRowImage', 'selectedRowCanvas', 'labelLayout', 'hitArea']); if (appearance) { const source = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']); if (source) this.rasterCanvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.resource(appearance.backgroundImage, `${path}.appearance.backgroundImage`); this.resource(appearance.rowImage, `${path}.appearance.rowImage`); const rowCanvas = this.object(appearance.rowCanvas, `${path}.appearance.rowCanvas`, ['width', 'height']); if (rowCanvas) { this.rasterCanvas(appearance.rowCanvas, `${path}.appearance.rowCanvas`); this.appearanceLayout(appearance.labelLayout, `${path}.appearance.labelLayout`, rowCanvas); this.appearanceLayout(appearance.hitArea, `${path}.appearance.hitArea`, rowCanvas); } this.resource(appearance.selectedRowImage, `${path}.appearance.selectedRowImage`); const selectedCanvas = this.object(appearance.selectedRowCanvas, `${path}.appearance.selectedRowCanvas`, ['width', 'height']); if (selectedCanvas) { this.rasterCanvas(appearance.selectedRowCanvas, `${path}.appearance.selectedRowCanvas`); if (rowCanvas && (selectedCanvas.width !== rowCanvas.width || selectedCanvas.height !== rowCanvas.height)) this.add(`${path}.appearance.selectedRowCanvas`, 'ROW_TEMPLATE_SIZE_MISMATCH', 'selected and unselected row templates must have identical intrinsic size'); } } }
        this.style(data.style, `${path}.style`); break;
      }
      case 'Dialog':
        this.boolean(data.open, `${path}.open`); this.string(data.title, `${path}.title`, true); this.boolean(data.modal, `${path}.modal`);
        if (Object.hasOwn(data, 'appearance')) { const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'background', 'header', 'body', 'overlayImage', 'overlayCanvas', 'titleLayout'], ['sourceCanvas', 'background', 'header', 'body', 'titleLayout']); if (appearance) { const source = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']); if (source) { this.rasterCanvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.positionedRasterPart(appearance.background, `${path}.appearance.background`, source); this.positionedRasterPart(appearance.header, `${path}.appearance.header`, source); this.positionedRasterPart(appearance.body, `${path}.appearance.body`, source); this.appearanceLayout(appearance.titleLayout, `${path}.appearance.titleLayout`, source); } const hasOverlay = Object.hasOwn(appearance, 'overlayImage') || Object.hasOwn(appearance, 'overlayCanvas'); if (hasOverlay) { this.resource(appearance.overlayImage, `${path}.appearance.overlayImage`); this.rasterCanvas(appearance.overlayCanvas, `${path}.appearance.overlayCanvas`); } if (data.modal === false && hasOverlay) this.add(`${path}.appearance`, 'OVERLAY_MODAL_MISMATCH', 'overlay fields are allowed only for a modal Dialog'); } }
        this.style(data.style, `${path}.style`); break;
      case 'Tabs':
        if (this.string(data.activeId, `${path}.activeId`) && !identifierPattern.test(data.activeId)) this.add(`${path}.activeId`, 'INVALID_ID', 'must be a valid tab ID reference');
        this.tabs(data.tabs, `${path}.tabs`); this.boolean(data.enabled, `${path}.enabled`);
        if (Object.hasOwn(data, 'appearance')) { const appearance = this.object(data.appearance, `${path}.appearance`, ['sourceCanvas', 'tabImage', 'tabCanvas', 'activeTabImage', 'activeTabCanvas', 'headerHeight', 'labelLayout', 'hitArea']); if (appearance) { const source = this.object(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`, ['width', 'height']); if (source) this.rasterCanvas(appearance.sourceCanvas, `${path}.appearance.sourceCanvas`); this.resource(appearance.tabImage, `${path}.appearance.tabImage`); const tabCanvas = this.object(appearance.tabCanvas, `${path}.appearance.tabCanvas`, ['width', 'height']); if (tabCanvas) this.rasterCanvas(appearance.tabCanvas, `${path}.appearance.tabCanvas`); this.resource(appearance.activeTabImage, `${path}.appearance.activeTabImage`); const activeCanvas = this.object(appearance.activeTabCanvas, `${path}.appearance.activeTabCanvas`, ['width', 'height']); if (activeCanvas) { this.rasterCanvas(appearance.activeTabCanvas, `${path}.appearance.activeTabCanvas`); if (tabCanvas && (activeCanvas.width !== tabCanvas.width || activeCanvas.height !== tabCanvas.height)) this.add(`${path}.appearance.activeTabCanvas`, 'TAB_TEMPLATE_SIZE_MISMATCH', 'active and inactive tab templates must have identical intrinsic size'); } this.finite(appearance.headerHeight, `${path}.appearance.headerHeight`, { positive: true }); if (tabCanvas) { this.appearanceLayout(appearance.labelLayout, `${path}.appearance.labelLayout`, tabCanvas); this.appearanceLayout(appearance.hitArea, `${path}.appearance.hitArea`, tabCanvas); if (typeof appearance.headerHeight === 'number' && appearance.headerHeight !== tabCanvas.height) this.add(`${path}.appearance.headerHeight`, 'TAB_HEADER_SIZE_MISMATCH', 'headerHeight must equal the template height'); } } }
        this.style(data.style, `${path}.style`); break;
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
