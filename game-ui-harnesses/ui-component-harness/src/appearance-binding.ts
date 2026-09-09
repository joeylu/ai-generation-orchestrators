import { HarnessError, type Issue } from './contract.ts';
import { assertValidImportedDecomposition, type ImportedDecomposition } from './decomposition-import.ts';
import { validateDocument, walkNodes, type UiDocument, type UiNodeType } from './tree-contract.ts';

/**
 * An engine-neutral handoff from an authenticated decomposition delivery to a
 * semantic UI tree. This contract describes evidence and intended placement;
 * it deliberately does not change a UI runtime or compose layer pixels.
 */
export const APPEARANCE_BINDING_KIND = 'ui-appearance-binding' as const;
export const APPEARANCE_BINDING_VERSION = '0.1' as const;
export const APPEARANCE_APPLICATION_BINDING_VERSION = '0.2' as const;
export type AppearanceBindingVersion = typeof APPEARANCE_BINDING_VERSION | typeof APPEARANCE_APPLICATION_BINDING_VERSION;

export type AppearanceRole =
  | 'image' | 'text' | 'background' | 'foreground' | 'icon'
  | 'track' | 'thumb' | 'box' | 'mark' | 'option' | 'indicator'
  | 'placeholder' | 'caret' | 'fill' | 'viewport' | 'content'
  | 'scrollbar-track' | 'scrollbar-thumb' | 'row' | 'selected-row'
  | 'header' | 'body' | 'overlay' | 'tab' | 'active-tab' | 'popup';

export interface AppearanceRoleDefinition {
  readonly componentType: UiNodeType;
  readonly requiredRoles: readonly AppearanceRole[];
  readonly allowedRoles: readonly AppearanceRole[];
}

export interface AppearanceRoleCatalog {
  readonly version: AppearanceBindingVersion;
  readonly components: readonly AppearanceRoleDefinition[];
}

export interface AppearancePoint {
  readonly x: number;
  readonly y: number;
}

export interface AppearanceCanvas {
  readonly width: number;
  readonly height: number;
}

export interface AppearanceRegistration {
  readonly sourceCanvas: AppearanceCanvas;
  readonly targetCanvas: AppearanceCanvas;
  /** A single scale applies to both axes; offsets are in target-canvas coordinates. */
  readonly transform: {
    readonly scale: number;
    readonly offset: AppearancePoint;
  };
}

export interface SwitchStateAppearance {
  readonly thumbPositions: {
    readonly coordinateSpace: 'target-component-local';
    /** x/y identify the thumb image's top-left corner; no other anchor is implied. */
    readonly anchor: 'top-left';
    readonly off: AppearancePoint;
    readonly on: AppearancePoint;
  };
  readonly labelLayout?: AppearanceTextLayout;
}
export interface AppearanceTextLayout {
  readonly coordinateSpace: 'target-component-local';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface ButtonStateAppearance { readonly labelLayout: AppearanceTextLayout }
export interface SelectStateAppearance {
  readonly labelLayout: AppearanceTextLayout;
  readonly popupPlacement: {
    readonly coordinateSpace: 'target-component-local';
    readonly anchor: 'below-start';
    readonly gap: number;
  };
}
export interface CheckBoxStateAppearance { readonly labelLayout: AppearanceTextLayout }
export interface RadioGroupStateAppearance {
  readonly options: readonly { readonly optionId: string; readonly hitArea: AppearanceTextLayout; readonly labelLayout: AppearanceTextLayout }[];
}
export interface InputStateAppearance { readonly textLayout: AppearanceTextLayout; readonly placeholderLayout: AppearanceTextLayout }
export interface ProgressBarStateAppearance {
  readonly sourceState: 'full-range-template';
  readonly fillClip: AppearanceTextLayout & { readonly anchor: 'top-left'; readonly direction: 'left-to-right' };
}
export interface SliderStateAppearance {
  readonly sourceState: 'full-range-template';
  readonly fillClip: AppearanceTextLayout & { readonly anchor: 'top-left'; readonly direction: 'left-to-right' };
  readonly thumbPositions: { readonly coordinateSpace: 'target-component-local'; readonly anchor: 'top-left'; readonly min: AppearancePoint; readonly max: AppearancePoint };
}
export interface PanelStateAppearance { readonly titleLayout: AppearanceTextLayout }
export interface ScrollViewStateAppearance {
  readonly thumbPositions: { readonly coordinateSpace: 'target-component-local'; readonly anchor: 'top-left'; readonly min: AppearancePoint; readonly max: AppearancePoint };
}
export interface RepeatedItemLayout { readonly coordinateSpace: 'target-item-local'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface ListStateAppearance { readonly labelLayout: RepeatedItemLayout; readonly hitArea: RepeatedItemLayout }
export interface DialogStateAppearance { readonly titleLayout: AppearanceTextLayout }
export interface TabsStateAppearance { readonly headerHeight: number; readonly labelLayout: RepeatedItemLayout; readonly hitArea: RepeatedItemLayout }

export interface AppearancePartBinding {
  readonly role: AppearanceRole;
  readonly layerId: string;
  /** Required only for each 0.2 RadioGroup option/indicator layer. */
  readonly optionId?: string;
  /** Required for the 0.2 List row/selected-row sample template. */
  readonly itemId?: string;
  /** Required for the 0.2 Tabs tab/active-tab sample template. */
  readonly tabId?: string;
}

export interface AppearanceComponentBinding {
  readonly componentId: string;
  readonly componentType: UiNodeType;
  readonly parts: readonly AppearancePartBinding[];
  /** Present for stateful raster geometry; coordinates are never inferred. */
  readonly states?: { readonly button: ButtonStateAppearance } | { readonly switch: SwitchStateAppearance } | { readonly select: SelectStateAppearance }
    | { readonly checkBox: CheckBoxStateAppearance } | { readonly radioGroup: RadioGroupStateAppearance } | { readonly input: InputStateAppearance }
    | { readonly progressBar: ProgressBarStateAppearance } | { readonly slider: SliderStateAppearance } | { readonly panel: PanelStateAppearance }
    | { readonly scrollView: ScrollViewStateAppearance } | { readonly list: ListStateAppearance } | { readonly dialog: DialogStateAppearance }
    | { readonly tabs: TabsStateAppearance };
}

export interface AppearanceBindingDocument {
  readonly kind: typeof APPEARANCE_BINDING_KIND;
  readonly version: AppearanceBindingVersion;
  /** SHA-256 of canonical JSON for the exact semantic UI document snapshot. */
  readonly documentSha256: string;
  /** Digest asserted by delivery.json, separate from the raw ZIP fingerprint. */
  readonly deliveryDigest: string;
  /** SHA-256 of the exact imported scene.json bytes. */
  readonly sceneSha256: string;
  /** SHA-256 of the exact ZIP supplied to the decomposition importer. */
  readonly archiveSha256: string;
  readonly registration: AppearanceRegistration;
  /** A subset of document controls may be bound; an individual binding is complete. */
  readonly bindings: readonly AppearanceComponentBinding[];
}

const roleDefinitions: readonly AppearanceRoleDefinition[] = [
  { componentType: 'Image', requiredRoles: ['image'], allowedRoles: ['image'] },
  { componentType: 'Text', requiredRoles: ['text'], allowedRoles: ['text'] },
  { componentType: 'Container', requiredRoles: ['background'], allowedRoles: ['background', 'foreground'] },
  { componentType: 'Button', requiredRoles: ['background'], allowedRoles: ['background', 'foreground', 'icon', 'text'] },
  { componentType: 'Switch', requiredRoles: ['track', 'thumb'], allowedRoles: ['track', 'thumb', 'text'] },
  { componentType: 'CheckBox', requiredRoles: ['box', 'mark'], allowedRoles: ['box', 'mark', 'text'] },
  { componentType: 'RadioGroup', requiredRoles: ['option', 'indicator'], allowedRoles: ['option', 'indicator', 'text'] },
  { componentType: 'Input', requiredRoles: ['background'], allowedRoles: ['background', 'text', 'placeholder', 'caret'] },
  { componentType: 'Select', requiredRoles: ['background', 'indicator'], allowedRoles: ['background', 'indicator', 'text', 'option', 'popup'] },
  { componentType: 'ProgressBar', requiredRoles: ['track', 'fill'], allowedRoles: ['track', 'fill'] },
  { componentType: 'Slider', requiredRoles: ['track', 'thumb'], allowedRoles: ['track', 'fill', 'thumb'] },
  { componentType: 'ScrollView', requiredRoles: ['viewport'], allowedRoles: ['viewport', 'content', 'scrollbar-track', 'scrollbar-thumb'] },
  { componentType: 'List', requiredRoles: ['background', 'row'], allowedRoles: ['background', 'row', 'selected-row', 'text'] },
  { componentType: 'Panel', requiredRoles: ['background', 'header'], allowedRoles: ['background', 'header', 'body', 'text'] },
  { componentType: 'Dialog', requiredRoles: ['background', 'header', 'body'], allowedRoles: ['background', 'overlay', 'header', 'body', 'text'] },
  { componentType: 'Tabs', requiredRoles: ['tab', 'active-tab', 'content'], allowedRoles: ['tab', 'active-tab', 'content', 'text'] },
] as const;
const applicationRoleDefinitions: readonly AppearanceRoleDefinition[] = [
  { componentType: 'Image', requiredRoles: ['image'], allowedRoles: ['image'] },
  { componentType: 'Text', requiredRoles: ['text'], allowedRoles: ['text'] },
  { componentType: 'Container', requiredRoles: ['background'], allowedRoles: ['background'] },
  { componentType: 'Button', requiredRoles: ['background'], allowedRoles: ['background'] },
  { componentType: 'Switch', requiredRoles: ['track', 'thumb'], allowedRoles: ['track', 'thumb'] },
  { componentType: 'CheckBox', requiredRoles: ['box', 'mark'], allowedRoles: ['box', 'mark'] },
  { componentType: 'RadioGroup', requiredRoles: ['option', 'indicator'], allowedRoles: ['option', 'indicator'] },
  { componentType: 'Input', requiredRoles: ['background'], allowedRoles: ['background'] },
  { componentType: 'Select', requiredRoles: ['background', 'indicator', 'popup'], allowedRoles: ['background', 'indicator', 'popup'] },
  { componentType: 'ProgressBar', requiredRoles: ['track', 'fill'], allowedRoles: ['track', 'fill'] },
  { componentType: 'Slider', requiredRoles: ['track', 'fill', 'thumb'], allowedRoles: ['track', 'fill', 'thumb'] },
  { componentType: 'Panel', requiredRoles: ['background', 'header'], allowedRoles: ['background', 'header', 'body'] },
  { componentType: 'ScrollView', requiredRoles: ['viewport', 'scrollbar-track', 'scrollbar-thumb'], allowedRoles: ['viewport', 'scrollbar-track', 'scrollbar-thumb'] },
  { componentType: 'List', requiredRoles: ['background', 'row', 'selected-row'], allowedRoles: ['background', 'row', 'selected-row'] },
  { componentType: 'Dialog', requiredRoles: ['background', 'header', 'body'], allowedRoles: ['background', 'header', 'body', 'overlay'] },
  { componentType: 'Tabs', requiredRoles: ['tab', 'active-tab'], allowedRoles: ['tab', 'active-tab'] },
] as const;

const rolesByType = new Map<UiNodeType, AppearanceRoleDefinition>(roleDefinitions.map(definition => [definition.componentType, definition]));
const applicationRolesByType = new Map<UiNodeType, AppearanceRoleDefinition>(applicationRoleDefinitions.map(definition => [definition.componentType, definition]));
const allRoles = new Set<AppearanceRole>(roleDefinitions.flatMap(definition => definition.allowedRoles));
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumBindings = 1_000;

/** A caller-isolated, reviewable role matrix for all 16 supported component types. */
export function appearanceRoleCatalog(version: AppearanceBindingVersion = APPEARANCE_BINDING_VERSION): AppearanceRoleCatalog {
  if (version !== APPEARANCE_BINDING_VERSION && version !== APPEARANCE_APPLICATION_BINDING_VERSION) throw new HarnessError('contract', [{ path: '$version', code: 'UNSUPPORTED_VERSION', message: 'appearance role catalog supports only 0.1 and 0.2' }]);
  const definitions = version === APPEARANCE_APPLICATION_BINDING_VERSION ? applicationRoleDefinitions : roleDefinitions;
  return {
    version,
    components: definitions.map(definition => ({
      componentType: definition.componentType,
      requiredRoles: [...definition.requiredRoles],
      allowedRoles: definition.allowedRoles.filter(role => version !== APPEARANCE_BINDING_VERSION || role !== 'popup'),
    })),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON-only canonicalization keeps document fingerprints stable across object key order. */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CANONICAL_JSON_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error('CANONICAL_JSON_INVALID');
}

async function sha256Utf8(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('CRYPTO_UNAVAILABLE');
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Hashes the strict UI tree after validation and canonical JSON serialization. */
export async function appearanceDocumentSha256(componentDocument: UiDocument): Promise<string> {
  return sha256Utf8(canonicalJson(validateDocument(componentDocument)));
}

class BindingValidator {
  readonly issues: Issue[] = [];

  add(path: string, code: string, message: string): void { this.issues.push({ path, code, message }); }

  object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> | undefined {
    if (!isObject(value)) { this.add(path, 'OBJECT_REQUIRED', 'must be an object'); return undefined; }
    for (const key of keys) if (!Object.hasOwn(value, key)) this.add(`${path}.${key}`, 'REQUIRED', 'required field is missing');
    for (const key of Object.keys(value)) if (!keys.includes(key)) this.add(`${path}.${key}`, 'UNSUPPORTED_FIELD', 'unknown fields are not accepted');
    return value;
  }

  string(value: unknown, path: string): value is string {
    if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > 256) {
      this.add(path, 'STRING_REQUIRED', 'must be a bounded non-empty trimmed string'); return false;
    }
    return true;
  }

  hash(value: unknown, path: string): value is string {
    if (typeof value !== 'string' || !sha256Pattern.test(value)) {
      this.add(path, 'SHA256_REQUIRED', 'must be a lowercase SHA-256 hex digest'); return false;
    }
    return true;
  }

  positive(value: unknown, path: string): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      this.add(path, 'POSITIVE_NUMBER_REQUIRED', 'must be a finite number greater than zero'); return false;
    }
    return true;
  }

  finite(value: unknown, path: string): value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.add(path, 'FINITE_NUMBER_REQUIRED', 'must be a finite number'); return false;
    }
    return true;
  }

  canvas(value: unknown, path: string): AppearanceCanvas | undefined {
    const data = this.object(value, path, ['width', 'height']);
    if (!data) return undefined;
    const width = this.positive(data.width, `${path}.width`) ? data.width as number : undefined;
    const height = this.positive(data.height, `${path}.height`) ? data.height as number : undefined;
    return width === undefined || height === undefined ? undefined : { width, height };
  }

  point(value: unknown, path: string): AppearancePoint | undefined {
    const data = this.object(value, path, ['x', 'y']);
    if (!data) return undefined;
    const x = this.finite(data.x, `${path}.x`) ? data.x as number : undefined;
    const y = this.finite(data.y, `${path}.y`) ? data.y as number : undefined;
    return x === undefined || y === undefined ? undefined : { x, y };
  }

  finish(): void {
    if (this.issues.length) throw new HarnessError('contract', this.issues);
  }
}

function sameCanvas(left: AppearanceCanvas, right: AppearanceCanvas): boolean {
  return left.width === right.width && left.height === right.height;
}

function validateRegistration(
  validator: BindingValidator,
  value: unknown,
  sourceCanvas: AppearanceCanvas,
  targetCanvas: AppearanceCanvas,
): number | undefined {
  const data = validator.object(value, '$appearanceBinding.registration', ['sourceCanvas', 'targetCanvas', 'transform']);
  if (!data) return undefined;
  const source = validator.canvas(data.sourceCanvas, '$appearanceBinding.registration.sourceCanvas');
  const target = validator.canvas(data.targetCanvas, '$appearanceBinding.registration.targetCanvas');
  if (source && !sameCanvas(source, sourceCanvas)) {
    validator.add('$appearanceBinding.registration.sourceCanvas', 'SOURCE_CANVAS_MISMATCH', 'must equal the imported scene canvas; registration is never inferred');
  }
  if (target && !sameCanvas(target, targetCanvas)) {
    validator.add('$appearanceBinding.registration.targetCanvas', 'TARGET_CANVAS_MISMATCH', 'must equal the captured UI document canvas');
  }
  const transform = validator.object(data.transform, '$appearanceBinding.registration.transform', ['scale', 'offset']);
  if (!transform) return undefined;
  const scale = validator.positive(transform.scale, '$appearanceBinding.registration.transform.scale') ? transform.scale as number : undefined;
  const offset = validator.point(transform.offset, '$appearanceBinding.registration.transform.offset');
  if (source && target && scale !== undefined && offset) {
    const right = offset.x + source.width * scale;
    const bottom = offset.y + source.height * scale;
    if (offset.x < 0 || offset.y < 0 || !Number.isFinite(right) || !Number.isFinite(bottom) || right > target.width || bottom > target.height) {
      validator.add('$appearanceBinding.registration.transform', 'REGISTRATION_CROPS_SOURCE', 'v0.1 registration must contain the entire scaled source canvas within the target canvas');
    }
  }
  return scale;
}

function validateSwitchState(
  validator: BindingValidator,
  value: unknown,
  path: string,
  width: number,
  height: number,
  thumbImage: { width: number; height: number } | undefined,
  registrationScale: number | undefined,
  applicationVersion: boolean,
  requiresLabel: boolean,
): void {
  const states = validator.object(value, path, ['switch']);
  if (!states) return;
  const state = validator.object(states.switch, `${path}.switch`, applicationVersion ? ['thumbPositions', 'labelLayout'] : ['thumbPositions']);
  if (!state) return;
  const positions = validator.object(state.thumbPositions, `${path}.switch.thumbPositions`, ['coordinateSpace', 'anchor', 'off', 'on']);
  if (!positions) return;
  if (positions.coordinateSpace !== 'target-component-local') {
    validator.add(`${path}.switch.thumbPositions.coordinateSpace`, 'UNSUPPORTED_COORDINATE_SPACE', 'must be target-component-local');
  }
  if (positions.anchor !== 'top-left') validator.add(`${path}.switch.thumbPositions.anchor`, 'UNSUPPORTED_POSITION_ANCHOR', 'must be top-left');
  const off = validator.point(positions.off, `${path}.switch.thumbPositions.off`);
  const on = validator.point(positions.on, `${path}.switch.thumbPositions.on`);
  for (const [name, point] of [['off', off], ['on', on]] as const) {
    if (point && (point.x < 0 || point.y < 0 || point.x > width || point.y > height)) {
      validator.add(`${path}.switch.thumbPositions.${name}`, 'POSITION_OUT_OF_BOUNDS', 'must be within the target component local bounds');
    }
  }
  if (off && on && off.x === on.x && off.y === on.y) {
    validator.add(`${path}.switch.thumbPositions`, 'IDENTICAL_SWITCH_POSITIONS', 'off and on positions must differ');
  }
  if (thumbImage && registrationScale !== undefined) {
    const thumbWidth = thumbImage.width * registrationScale, thumbHeight = thumbImage.height * registrationScale;
    if (!Number.isFinite(thumbWidth) || !Number.isFinite(thumbHeight)) {
      validator.add(`${path}.switch.thumbPositions`, 'THUMB_TRANSFORM_OVERFLOW', 'scaled thumb dimensions must remain finite');
    } else for (const [name, point] of [['off', off], ['on', on]] as const) {
      if (point && (point.x + thumbWidth > width || point.y + thumbHeight > height)) {
        validator.add(`${path}.switch.thumbPositions.${name}`, 'THUMB_OUT_OF_BOUNDS', 'the scaled top-left-anchored thumb must fit within the target component');
      }
    }
  }
  if (applicationVersion) {
    if (requiresLabel && !Object.hasOwn(state, 'labelLayout')) validator.add(`${path}.switch.labelLayout`, 'REQUIRED', 'non-empty Switch labels require explicit layout');
    if (Object.hasOwn(state, 'labelLayout')) validateTextLayout(validator, state.labelLayout, `${path}.switch.labelLayout`, width, height);
  }
}

function validateTextLayout(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const label = validator.object(value, path, ['coordinateSpace', 'x', 'y', 'width', 'height']);
  if (!label) return;
  if (label.coordinateSpace !== 'target-component-local') validator.add(`${path}.coordinateSpace`, 'UNSUPPORTED_COORDINATE_SPACE', 'must be target-component-local');
  const x = validator.finite(label.x, `${path}.x`) ? label.x as number : undefined;
  const y = validator.finite(label.y, `${path}.y`) ? label.y as number : undefined;
  const labelWidth = validator.positive(label.width, `${path}.width`) ? label.width as number : undefined;
  const labelHeight = validator.positive(label.height, `${path}.height`) ? label.height as number : undefined;
  if (x !== undefined && y !== undefined && labelWidth !== undefined && labelHeight !== undefined
    && (x < 0 || y < 0 || x + labelWidth > width || y + labelHeight > height)) validator.add(path, 'LABEL_LAYOUT_OUT_OF_BOUNDS', 'must fit within the target component');
}

function validateRepeatedItemLayout(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const layout = validator.object(value, path, ['coordinateSpace', 'x', 'y', 'width', 'height']);
  if (!layout) return;
  if (layout.coordinateSpace !== 'target-item-local') validator.add(`${path}.coordinateSpace`, 'UNSUPPORTED_COORDINATE_SPACE', 'must be target-item-local');
  const x = validator.finite(layout.x, `${path}.x`) ? layout.x as number : undefined;
  const y = validator.finite(layout.y, `${path}.y`) ? layout.y as number : undefined;
  const itemWidth = validator.positive(layout.width, `${path}.width`) ? layout.width as number : undefined;
  const itemHeight = validator.positive(layout.height, `${path}.height`) ? layout.height as number : undefined;
  if (x !== undefined && y !== undefined && itemWidth !== undefined && itemHeight !== undefined
    && (x < 0 || y < 0 || x + itemWidth > width || y + itemHeight > height)) validator.add(path, 'ITEM_LAYOUT_OUT_OF_BOUNDS', 'must fit within one repeated item');
}

function validateButtonState(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const states = validator.object(value, path, ['button']);
  if (!states) return;
  const state = validator.object(states.button, `${path}.button`, ['labelLayout']);
  if (state) validateTextLayout(validator, state.labelLayout, `${path}.button.labelLayout`, width, height);
}

function validateSelectState(
  validator: BindingValidator,
  value: unknown,
  path: string,
  width: number,
  height: number,
): void {
  const states = validator.object(value, path, ['select']);
  if (!states) return;
  const state = validator.object(states.select, `${path}.select`, ['labelLayout', 'popupPlacement']);
  if (!state) return;
  validateTextLayout(validator, state.labelLayout, `${path}.select.labelLayout`, width, height);
  const popup = validator.object(state.popupPlacement, `${path}.select.popupPlacement`, ['coordinateSpace', 'anchor', 'gap']);
  if (popup) {
    if (popup.coordinateSpace !== 'target-component-local') validator.add(`${path}.select.popupPlacement.coordinateSpace`, 'UNSUPPORTED_COORDINATE_SPACE', 'must be target-component-local');
    if (popup.anchor !== 'below-start') validator.add(`${path}.select.popupPlacement.anchor`, 'UNSUPPORTED_POSITION_ANCHOR', 'must be below-start');
    const gap = validator.finite(popup.gap, `${path}.select.popupPlacement.gap`);
    if (gap && (popup.gap as number) < 0) validator.add(`${path}.select.popupPlacement.gap`, 'NON_NEGATIVE_NUMBER_REQUIRED', 'must be zero or greater');
  }
}

function validateCheckBoxState(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const states = validator.object(value, path, ['checkBox']); if (!states) return;
  const state = validator.object(states.checkBox, `${path}.checkBox`, ['labelLayout']); if (state) validateTextLayout(validator, state.labelLayout, `${path}.checkBox.labelLayout`, width, height);
}
function validateInputState(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const states = validator.object(value, path, ['input']); if (!states) return;
  const state = validator.object(states.input, `${path}.input`, ['textLayout', 'placeholderLayout']); if (!state) return;
  validateTextLayout(validator, state.textLayout, `${path}.input.textLayout`, width, height); validateTextLayout(validator, state.placeholderLayout, `${path}.input.placeholderLayout`, width, height);
}
function validateFillClip(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const clip = validator.object(value, path, ['coordinateSpace', 'anchor', 'direction', 'x', 'y', 'width', 'height']); if (!clip) return;
  if (clip.anchor !== 'top-left') validator.add(`${path}.anchor`, 'UNSUPPORTED_POSITION_ANCHOR', 'must be top-left');
  if (clip.direction !== 'left-to-right') validator.add(`${path}.direction`, 'UNSUPPORTED_FILL_DIRECTION', 'must be left-to-right');
  validateTextLayout(validator, { coordinateSpace: clip.coordinateSpace, x: clip.x, y: clip.y, width: clip.width, height: clip.height }, path, width, height);
}
function validateProgressState(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const states = validator.object(value, path, ['progressBar']); if (!states) return;
  const state = validator.object(states.progressBar, `${path}.progressBar`, ['sourceState', 'fillClip']); if (state) { if (state.sourceState !== 'full-range-template') validator.add(`${path}.progressBar.sourceState`, 'FULL_RANGE_TEMPLATE_REQUIRED', 'must declare a complete full-range fill template'); validateFillClip(validator, state.fillClip, `${path}.progressBar.fillClip`, width, height); }
}
function validateSliderState(validator: BindingValidator, value: unknown, path: string, width: number, height: number, thumbImage?: { width: number; height: number }, registrationScale?: number): void {
  const states = validator.object(value, path, ['slider']); if (!states) return;
  const state = validator.object(states.slider, `${path}.slider`, ['sourceState', 'fillClip', 'thumbPositions']); if (!state) return;
  if (state.sourceState !== 'full-range-template') validator.add(`${path}.slider.sourceState`, 'FULL_RANGE_TEMPLATE_REQUIRED', 'must declare a complete full-range fill template');
  validateFillClip(validator, state.fillClip, `${path}.slider.fillClip`, width, height);
  const positions = validator.object(state.thumbPositions, `${path}.slider.thumbPositions`, ['coordinateSpace', 'anchor', 'min', 'max']); if (!positions) return;
  if (positions.coordinateSpace !== 'target-component-local') validator.add(`${path}.slider.thumbPositions.coordinateSpace`, 'UNSUPPORTED_COORDINATE_SPACE', 'must be target-component-local');
  if (positions.anchor !== 'top-left') validator.add(`${path}.slider.thumbPositions.anchor`, 'UNSUPPORTED_POSITION_ANCHOR', 'must be top-left');
  const min = validator.point(positions.min, `${path}.slider.thumbPositions.min`), max = validator.point(positions.max, `${path}.slider.thumbPositions.max`);
  if (min && max && min.x === max.x && min.y === max.y) validator.add(`${path}.slider.thumbPositions`, 'IDENTICAL_SLIDER_POSITIONS', 'min and max positions must differ');
  if (min && max && (min.y !== max.y || max.x <= min.x)) validator.add(`${path}.slider.thumbPositions`, 'SLIDER_AXIS_MISMATCH', 'left-to-right fill requires horizontal endpoints with max.x greater than min.x');
  if (thumbImage && registrationScale !== undefined) for (const [name, point] of [['min', min], ['max', max]] as const) if (point && (point.x < 0 || point.y < 0 || point.x + thumbImage.width * registrationScale > width || point.y + thumbImage.height * registrationScale > height)) validator.add(`${path}.slider.thumbPositions.${name}`, 'THUMB_OUT_OF_BOUNDS', 'the complete thumb must fit within the target component');
}
function validatePanelState(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const states = validator.object(value, path, ['panel']); if (!states) return;
  const state = validator.object(states.panel, `${path}.panel`, ['titleLayout']);
  if (state) validateTextLayout(validator, state.titleLayout, `${path}.panel.titleLayout`, width, height);
}
function validateScrollViewState(validator: BindingValidator, value: unknown, path: string, width: number, height: number, thumbImage?: { width: number; height: number }, registrationScale?: number): void {
  const states = validator.object(value, path, ['scrollView']); if (!states) return;
  const state = validator.object(states.scrollView, `${path}.scrollView`, ['thumbPositions']); if (!state) return;
  const positions = validator.object(state.thumbPositions, `${path}.scrollView.thumbPositions`, ['coordinateSpace', 'anchor', 'min', 'max']); if (!positions) return;
  if (positions.coordinateSpace !== 'target-component-local') validator.add(`${path}.scrollView.thumbPositions.coordinateSpace`, 'UNSUPPORTED_COORDINATE_SPACE', 'must be target-component-local');
  if (positions.anchor !== 'top-left') validator.add(`${path}.scrollView.thumbPositions.anchor`, 'UNSUPPORTED_POSITION_ANCHOR', 'must be top-left');
  const min = validator.point(positions.min, `${path}.scrollView.thumbPositions.min`), max = validator.point(positions.max, `${path}.scrollView.thumbPositions.max`);
  if (min && max && (min.x !== max.x || max.y <= min.y)) validator.add(`${path}.scrollView.thumbPositions`, 'SCROLL_AXIS_MISMATCH', 'vertical scrolling requires equal x coordinates and max.y greater than min.y');
  if (thumbImage && registrationScale !== undefined) for (const [name, point] of [['min', min], ['max', max]] as const) if (point && (point.x < 0 || point.y < 0 || point.x + thumbImage.width * registrationScale > width || point.y + thumbImage.height * registrationScale > height)) validator.add(`${path}.scrollView.thumbPositions.${name}`, 'THUMB_OUT_OF_BOUNDS', 'the complete thumb must fit within the target component');
}
function validateListState(validator: BindingValidator, value: unknown, path: string, width: number, itemHeight: number): void {
  const states = validator.object(value, path, ['list']); if (!states) return;
  const state = validator.object(states.list, `${path}.list`, ['labelLayout', 'hitArea']); if (!state) return;
  validateRepeatedItemLayout(validator, state.labelLayout, `${path}.list.labelLayout`, width, itemHeight);
  validateRepeatedItemLayout(validator, state.hitArea, `${path}.list.hitArea`, width, itemHeight);
}
function validateDialogState(validator: BindingValidator, value: unknown, path: string, width: number, height: number): void {
  const states = validator.object(value, path, ['dialog']); if (!states) return;
  const state = validator.object(states.dialog, `${path}.dialog`, ['titleLayout']); if (state) validateTextLayout(validator, state.titleLayout, `${path}.dialog.titleLayout`, width, height);
}
function validateTabsState(validator: BindingValidator, value: unknown, path: string, tabWidth: number, height: number): void {
  const states = validator.object(value, path, ['tabs']); if (!states) return;
  const state = validator.object(states.tabs, `${path}.tabs`, ['headerHeight', 'labelLayout', 'hitArea']); if (!state) return;
  const headerHeight = validator.positive(state.headerHeight, `${path}.tabs.headerHeight`) ? state.headerHeight as number : undefined;
  if (headerHeight !== undefined && headerHeight > height) validator.add(`${path}.tabs.headerHeight`, 'HEADER_OUT_OF_BOUNDS', 'must fit within the Tabs component');
  if (headerHeight !== undefined) {
    validateRepeatedItemLayout(validator, state.labelLayout, `${path}.tabs.labelLayout`, tabWidth, headerHeight);
    validateRepeatedItemLayout(validator, state.hitArea, `${path}.tabs.hitArea`, tabWidth, headerHeight);
  }
}
function validateRadioState(validator: BindingValidator, value: unknown, path: string, width: number, height: number, optionIds: readonly string[]): void {
  const states = validator.object(value, path, ['radioGroup']); if (!states) return;
  const state = validator.object(states.radioGroup, `${path}.radioGroup`, ['options']); if (!state) return;
  if (!Array.isArray(state.options) || state.options.length !== optionIds.length) { validator.add(`${path}.radioGroup.options`, 'OPTION_STATE_MISMATCH', 'must contain one state entry for every option'); return; }
  const seen = new Set<string>(); const areas: Array<{ path: string; x: number; y: number; width: number; height: number }> = [];
  state.options.forEach((raw, index) => { const itemPath = `${path}.radioGroup.options[${index}]`, item = validator.object(raw, itemPath, ['optionId', 'hitArea', 'labelLayout']); if (!item) return;
    if (!validator.string(item.optionId, `${itemPath}.optionId`) || !optionIds.includes(item.optionId as string)) validator.add(`${itemPath}.optionId`, 'UNKNOWN_OPTION', 'must reference a RadioGroup option'); else if (seen.has(item.optionId as string)) validator.add(`${itemPath}.optionId`, 'DUPLICATE_OPTION', 'each option may appear once'); else seen.add(item.optionId as string);
    validateTextLayout(validator, item.hitArea, `${itemPath}.hitArea`, width, height); validateTextLayout(validator, item.labelLayout, `${itemPath}.labelLayout`, width, height);
    const hitArea = item.hitArea; if (isObject(hitArea) && ['x','y','width','height'].every(key => typeof hitArea[key] === 'number')) areas.push({ path: `${itemPath}.hitArea`, x: hitArea.x as number, y: hitArea.y as number, width: hitArea.width as number, height: hitArea.height as number });
  });
  for (let left = 0; left < areas.length; left++) for (let right = left + 1; right < areas.length; right++) { const a = areas[left], b = areas[right]; if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) validator.add(b.path, 'OVERLAPPING_HIT_AREAS', 'RadioGroup hit areas must not overlap'); }
}

/**
 * Validates and clones a standalone appearance handoff. It first authenticates
 * the ZIP result, binds all three imported fingerprints, and then resolves
 * every component and layer by its explicit ID. No layer names, coordinates,
 * states, or registration values are inferred.
 */
export async function validateAppearanceBinding(
  input: unknown,
  componentDocument: UiDocument,
  importedDelivery: ImportedDecomposition,
): Promise<AppearanceBindingDocument> {
  let candidate: unknown;
  try { candidate = structuredClone(input); }
  catch { throw new HarnessError('contract', [{ path: '$appearanceBinding', code: 'UNCLONEABLE_INPUT', message: 'must be structured-cloneable JSON data' }]); }
  const document = validateDocument(componentDocument);
  const imported = await assertValidImportedDecomposition(importedDelivery);
  const documentSha256 = await appearanceDocumentSha256(document);
  const validator = new BindingValidator();
  const data = validator.object(candidate, '$appearanceBinding', [
    'kind', 'version', 'documentSha256', 'deliveryDigest', 'sceneSha256', 'archiveSha256', 'registration', 'bindings',
  ]);
  if (!data) { validator.finish(); throw new Error('UNREACHABLE'); }

  if (data.kind !== APPEARANCE_BINDING_KIND) validator.add('$appearanceBinding.kind', 'UNSUPPORTED_KIND', `must be ${APPEARANCE_BINDING_KIND}`);
  const applicationVersion = data.version === APPEARANCE_APPLICATION_BINDING_VERSION;
  if (data.version !== APPEARANCE_BINDING_VERSION && !applicationVersion) validator.add('$appearanceBinding.version', 'UNSUPPORTED_VERSION', 'only appearance binding versions 0.1 and 0.2 are supported');
  if (validator.hash(data.documentSha256, '$appearanceBinding.documentSha256') && data.documentSha256 !== documentSha256) {
    validator.add('$appearanceBinding.documentSha256', 'DOCUMENT_DIGEST_MISMATCH', 'must bind the captured semantic UI document');
  }
  if (validator.hash(data.deliveryDigest, '$appearanceBinding.deliveryDigest') && data.deliveryDigest !== imported.deliveryDigest) {
    validator.add('$appearanceBinding.deliveryDigest', 'DELIVERY_DIGEST_MISMATCH', 'must bind the authenticated imported delivery');
  }
  if (validator.hash(data.sceneSha256, '$appearanceBinding.sceneSha256') && data.sceneSha256 !== imported.sceneSha256) {
    validator.add('$appearanceBinding.sceneSha256', 'SCENE_DIGEST_MISMATCH', 'must bind the authenticated imported scene');
  }
  if (validator.hash(data.archiveSha256, '$appearanceBinding.archiveSha256') && data.archiveSha256 !== imported.archiveSha256) {
    validator.add('$appearanceBinding.archiveSha256', 'ARCHIVE_DIGEST_MISMATCH', 'must bind the exact imported ZIP archive');
  }
  const registrationScale = validateRegistration(validator, data.registration, imported.scene.canvas, document.canvas);

  if (!Array.isArray(data.bindings)) {
    validator.add('$appearanceBinding.bindings', 'ARRAY_REQUIRED', 'must be an array');
  } else {
    const nodesById = new Map(walkNodes(document).map(node => [node.id, node]));
    const layers = new Set(imported.scene.layers.map(layer => layer.id));
    const componentIds = new Set<string>();
    const layerIds = new Set<string>();
    if (data.bindings.length === 0 || data.bindings.length > maximumBindings || data.bindings.length > nodesById.size) {
      validator.add('$appearanceBinding.bindings', 'BINDING_LIMIT', 'must bind between one and the number of UI components');
    }
    for (const [index, rawBinding] of data.bindings.entries()) {
      const path = `$appearanceBinding.bindings[${index}]`;
      if (!isObject(rawBinding)) { validator.add(path, 'OBJECT_REQUIRED', 'must be an object'); continue; }
      const rawType = rawBinding.componentType;
      const actualType = typeof rawType === 'string' && rolesByType.has(rawType as UiNodeType) ? rawType as UiNodeType : undefined;
      const statefulApplicationTypes: readonly UiNodeType[] = ['Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select', 'ProgressBar', 'Slider', 'Panel', 'ScrollView', 'List', 'Dialog', 'Tabs'];
      const stateful = actualType === 'Switch' || (applicationVersion && actualType !== undefined && statefulApplicationTypes.includes(actualType));
      const keys = stateful ? ['componentId', 'componentType', 'parts', 'states'] : ['componentId', 'componentType', 'parts'];
      const binding = validator.object(rawBinding, path, keys);
      if (!binding) continue;
      const componentId = validator.string(binding.componentId, `${path}.componentId`) ? binding.componentId : undefined;
      const component = componentId ? nodesById.get(componentId) : undefined;
      if (componentId && !component) validator.add(`${path}.componentId`, 'UNKNOWN_COMPONENT', 'must reference an existing UI component');
      if (componentId && componentIds.has(componentId)) validator.add(`${path}.componentId`, 'DUPLICATE_COMPONENT', 'a UI component may have one appearance binding');
      if (componentId) componentIds.add(componentId);
      if (!actualType) validator.add(`${path}.componentType`, 'UNSUPPORTED_COMPONENT_TYPE', 'must be one of the 16 supported UI component types');
      if (component && actualType && actualType !== component.type) validator.add(`${path}.componentType`, 'COMPONENT_TYPE_MISMATCH', 'must match the referenced UI component type');
      if (applicationVersion && actualType && !applicationRolesByType.has(actualType)) validator.add(`${path}.componentType`, 'APPLICATION_COMPONENT_UNSUPPORTED', 'binding version 0.2 supports only runtime-applicable component types');
      const roleMap = applicationVersion ? applicationRolesByType : rolesByType;
      const definition = component ? roleMap.get(component.type) : actualType ? roleMap.get(actualType) : undefined;
      if (!Array.isArray(binding.parts)) {
        validator.add(`${path}.parts`, 'ARRAY_REQUIRED', 'must be an array');
      } else if (definition) {
        const radioOptionIds = applicationVersion && component?.type === 'RadioGroup' ? component.props.options.map(option => option.id) : [];
        const listItemIds = applicationVersion && component?.type === 'List' ? component.props.items.map(item => item.id) : [];
        const tabIds = applicationVersion && component?.type === 'Tabs' ? component.props.tabs.map(tab => tab.id) : [];
        const maximumParts = radioOptionIds.length ? radioOptionIds.length * 2 : definition.allowedRoles.length;
        if (binding.parts.length === 0 || binding.parts.length > maximumParts) {
          validator.add(`${path}.parts`, 'PART_LIMIT', 'must contain only the explicitly allowed component roles');
        }
        const roles = new Set<AppearanceRole>();
        const radioRoles = new Map<string, Set<AppearanceRole>>();
        for (const [partIndex, rawPart] of binding.parts.entries()) {
          const partPath = `${path}.parts[${partIndex}]`;
          const radioPart = applicationVersion && actualType === 'RadioGroup' && isObject(rawPart) && (rawPart.role === 'option' || rawPart.role === 'indicator');
          const listPart = applicationVersion && actualType === 'List' && isObject(rawPart) && (rawPart.role === 'row' || rawPart.role === 'selected-row');
          const tabPart = applicationVersion && actualType === 'Tabs' && isObject(rawPart) && (rawPart.role === 'tab' || rawPart.role === 'active-tab');
          const part = validator.object(rawPart, partPath, radioPart ? ['role', 'layerId', 'optionId'] : listPart ? ['role', 'layerId', 'itemId'] : tabPart ? ['role', 'layerId', 'tabId'] : ['role', 'layerId']);
          if (!part) continue;
          const role = typeof part.role === 'string' && allRoles.has(part.role as AppearanceRole) ? part.role as AppearanceRole : undefined;
          if (!role) validator.add(`${partPath}.role`, 'UNSUPPORTED_ROLE', 'must be a catalogued appearance role');
          else if (!definition.allowedRoles.includes(role) || (!applicationVersion && role === 'popup')) validator.add(`${partPath}.role`, 'ROLE_NOT_ALLOWED', 'is not allowed for this component type or binding version');
          else if (!radioPart && roles.has(role)) validator.add(`${partPath}.role`, 'DUPLICATE_ROLE', 'a role may be mapped once per component');
          else roles.add(role);
          if (radioPart) {
            const optionId = validator.string(part.optionId, `${partPath}.optionId`) ? part.optionId as string : undefined;
            if (optionId && !radioOptionIds.includes(optionId)) validator.add(`${partPath}.optionId`, 'UNKNOWN_OPTION', 'must reference a RadioGroup option');
            if (optionId && role) { const assigned = radioRoles.get(optionId) ?? new Set<AppearanceRole>(); if (assigned.has(role)) validator.add(`${partPath}.role`, 'DUPLICATE_OPTION_ROLE', 'each RadioGroup option may map this role once'); assigned.add(role); radioRoles.set(optionId, assigned); }
          }
          if (listPart) {
            const itemId = validator.string(part.itemId, `${partPath}.itemId`) ? part.itemId as string : undefined;
            if (itemId && !listItemIds.includes(itemId)) validator.add(`${partPath}.itemId`, 'UNKNOWN_ITEM', 'must reference a List item');
            if (itemId && role === 'selected-row' && component?.type === 'List' && itemId !== component.props.selectedId) validator.add(`${partPath}.itemId`, 'SELECTED_ITEM_MISMATCH', 'selected-row must reference the current selectedId');
            if (itemId && role === 'row' && component?.type === 'List' && component.props.items.length > 1 && itemId === component.props.selectedId) validator.add(`${partPath}.itemId`, 'UNSELECTED_SAMPLE_REQUIRED', 'row must reference an unselected item when one exists');
          }
          if (tabPart) {
            const tabId = validator.string(part.tabId, `${partPath}.tabId`) ? part.tabId as string : undefined;
            if (tabId && !tabIds.includes(tabId)) validator.add(`${partPath}.tabId`, 'UNKNOWN_TAB', 'must reference a Tabs entry');
            if (tabId && role === 'active-tab' && component?.type === 'Tabs' && tabId !== component.props.activeId) validator.add(`${partPath}.tabId`, 'ACTIVE_TAB_MISMATCH', 'active-tab must reference the current activeId');
            if (tabId && role === 'tab' && component?.type === 'Tabs' && component.props.tabs.length > 1 && tabId === component.props.activeId) validator.add(`${partPath}.tabId`, 'INACTIVE_SAMPLE_REQUIRED', 'tab must reference an inactive tab when one exists');
          }
          const layerId = validator.string(part.layerId, `${partPath}.layerId`) ? part.layerId : undefined;
          if (layerId && !layers.has(layerId)) validator.add(`${partPath}.layerId`, 'UNKNOWN_LAYER', 'must reference an imported scene layer by ID');
          if (layerId && layerIds.has(layerId)) validator.add(`${partPath}.layerId`, 'DUPLICATE_LAYER', 'an imported layer may be bound once');
          if (layerId) layerIds.add(layerId);
        }
        for (const required of definition.requiredRoles) if (!roles.has(required)) {
          validator.add(`${path}.parts`, 'MISSING_REQUIRED_ROLE', `must explicitly map required role: ${required}`);
        }
        if (applicationVersion && component?.type === 'List' && component.props.selectedId === null) validator.add(`${path}.componentId`, 'SELECTED_SAMPLE_REQUIRED', 'List appearance application requires a current selectedId for the selected-row sample');
        if (applicationVersion && component?.type === 'Dialog' && !component.props.modal && roles.has('overlay')) validator.add(`${path}.parts`, 'OVERLAY_MODAL_MISMATCH', 'overlay is allowed only for a modal Dialog');
        for (const optionId of radioOptionIds) for (const required of ['option', 'indicator'] as const) if (!radioRoles.get(optionId)?.has(required)) validator.add(`${path}.parts`, 'MISSING_OPTION_ROLE', `RadioGroup option ${optionId} must explicitly map ${required}`);
      }
      if (component?.type === 'Switch') {
        const thumbLayerId = Array.isArray(binding.parts)
          ? binding.parts.find(part => isObject(part) && part.role === 'thumb' && typeof part.layerId === 'string')?.layerId
          : undefined;
        const thumbLayer = thumbLayerId ? imported.scene.layers.find(layer => layer.id === thumbLayerId) : undefined;
        validateSwitchState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height, thumbLayer, registrationScale, applicationVersion, component.props.label.length > 0);
      }
      if (applicationVersion && component?.type === 'Button') {
        validateButtonState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height);
      }
      if (applicationVersion && component?.type === 'Select') {
        validateSelectState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height);
      }
      if (applicationVersion && component?.type === 'CheckBox') validateCheckBoxState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height);
      if (applicationVersion && component?.type === 'RadioGroup') validateRadioState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height, component.props.options.map(option => option.id));
      if (applicationVersion && component?.type === 'Input') validateInputState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height);
      if (applicationVersion && component?.type === 'ProgressBar') validateProgressState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height);
      if (applicationVersion && component?.type === 'Slider') {
        const thumbLayerId = Array.isArray(binding.parts) ? binding.parts.find(part => isObject(part) && part.role === 'thumb' && typeof part.layerId === 'string')?.layerId : undefined;
        validateSliderState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height, imported.scene.layers.find(layer => layer.id === thumbLayerId), registrationScale);
      }
      if (applicationVersion && component?.type === 'Panel') validatePanelState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height);
      if (applicationVersion && component?.type === 'ScrollView') {
        if (component.props.scrollX !== 0 || component.props.contentWidth > component.layout.width || component.props.contentHeight <= component.layout.height) validator.add(`${path}.componentId`, 'VERTICAL_SCROLL_TEMPLATE_REQUIRED', 'ScrollView appearance currently requires vertical-only overflow and zero scrollX');
        const thumbLayerId = Array.isArray(binding.parts) ? binding.parts.find(part => isObject(part) && part.role === 'scrollbar-thumb' && typeof part.layerId === 'string')?.layerId : undefined;
        validateScrollViewState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height, imported.scene.layers.find(layer => layer.id === thumbLayerId), registrationScale);
      }
      if (applicationVersion && component?.type === 'List') validateListState(validator, binding.states, `${path}.states`, component.layout.width, component.props.itemHeight);
      if (applicationVersion && component?.type === 'Dialog') validateDialogState(validator, binding.states, `${path}.states`, component.layout.width, component.layout.height);
      if (applicationVersion && component?.type === 'Tabs') validateTabsState(validator, binding.states, `${path}.states`, component.layout.width / component.props.tabs.length, component.layout.height);
    }
  }
  validator.finish();
  return structuredClone(candidate) as AppearanceBindingDocument;
}
