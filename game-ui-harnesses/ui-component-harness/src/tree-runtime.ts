import {
  Application, Container, Graphics, Matrix, Rectangle, Sprite, Text, Texture,
  type FederatedPointerEvent, type FederatedWheelEvent,
} from 'pixi.js';
import { HarnessError } from './contract.ts';
import { loadImage } from './resource.ts';
import {
  validateDocument, walkNodes,
  type ControlStyle, type ImageNode, type Layout, type TextNode, type UiDocument, type UiNode,
} from './tree-contract.ts';
import { clampScroll, isStepAligned, snapSlider } from './runtime-state.ts';
import {
  MotionAnimator, getMotionStyle, validateMotionSystem,
  type MotionAction, type MotionStyle, type MotionSystemDocument,
} from './motion-system.ts';

export type RuntimeInputSource = 'mouse' | 'touch' | 'pen' | 'keyboard' | 'wheel' | 'control';
export type RuntimeEventType = 'activate' | 'change' | 'focus' | 'blur' | 'destroy' | 'scroll'
  | 'press' | 'release' | 'cancel' | 'hover' | 'open' | 'close';

/**
 * `id` is the control which emitted the event. `sourceId` and `targetId` make
 * delegated controls (choice rows and tab headers) unambiguous to consumers.
 */
export interface TreeRuntimeEvent {
  type: RuntimeEventType;
  id: string;
  source: RuntimeInputSource;
  sourceId: string;
  targetId: string;
  value?: string | boolean | number | null | { x: number; y: number };
}

export interface RuntimeBounds { x: number; y: number; width: number; height: number }
export interface RuntimeNodeInspection {
  id: string;
  type: UiNode['type'];
  bounds: RuntimeBounds;
  visible: boolean;
  enabled: boolean | null;
  value?: string | boolean | number | null | { x: number; y: number };
}
export interface TreeInspection {
  instances: number;
  externalListeners: number;
  resources: number;
  nodes: RuntimeNodeInspection[];
}

export interface MotionPresentationInspection {
  id: string;
  type: UiNode['type'];
  visible: boolean;
  presentation: Record<string, number>;
}

export interface MotionSystemInspection {
  style: MotionStyle | null;
  systemId: string | null;
  scheduler: { running: number; pendingFrame: boolean; destroyed: boolean };
  nodes: MotionPresentationInspection[];
}

export type ImageResolver = (source: string, signal: AbortSignal) => Promise<HTMLImageElement>;
export type FontResolver = (source: string, signal: AbortSignal) => Promise<ArrayBuffer>;
export interface MotionValues { x?: number; y?: number; alpha?: number; scaleX?: number; scaleY?: number; rotation?: number }

export interface TreePreview {
  readonly canvas: HTMLCanvasElement;
  load(document: unknown, signal: AbortSignal, resolver?: ImageResolver, fontResolver?: FontResolver): Promise<void>;
  subscribe(listener: (event: TreeRuntimeEvent) => void): () => void;
  inspect(): TreeInspection;
  getDocument(): UiDocument;
  setValue(id: string, value: unknown): void;
  setEnabled(id: string, enabled: boolean): void;
  setVisible(id: string, visible: boolean): void;
  /** Removes a mounted node and releases only its resource references. */
  destroyNode(id: string): void;
  setZoom(zoom: number): void;
  applyMotion(id: string, values: MotionValues): void;
  resetMotion(): void;
  /** Validates and installs the independent component motion system for this mounted tree. */
  setMotionSystem(input: unknown | null): void;
  getMotionSystem(): MotionSystemDocument | null;
  playMotionAction(id: string, action: MotionAction): void;
  inspectMotionSystem(): MotionSystemInspection;
  destroy(): void;
}

interface ImageEntry { texture: Texture; references: number }
interface FontEntry { face: FontFace; family: string }

class TreeResources {
  private readonly images = new Map<string, ImageEntry>();
  private readonly fonts = new Map<string, FontEntry>();
  private disposed = false;

  private assertOpen(): void { if (this.disposed) throw new Error('RESOURCE_SCOPE_DESTROYED'); }

  async prepare(document: UiDocument, signal: AbortSignal, imageResolver: ImageResolver, fontResolver: FontResolver, current: () => void): Promise<void> {
    const imageSources = new Set<string>();
    const fontSources = new Map<string, string>();
    for (const node of walkNodes(document)) {
      if (node.type === 'Image') imageSources.add(node.props.source);
      if (node.type === 'Container' && node.props.appearance) imageSources.add(node.props.appearance.background.image);
      if (node.type === 'Button' && node.props.backgroundImage) imageSources.add(node.props.backgroundImage);
      if (node.type === 'Button' && node.props.appearance) imageSources.add(node.props.appearance.backgroundImage);
      if (node.type === 'Switch' && node.props.appearance) {
        imageSources.add(node.props.appearance.trackImage);
        imageSources.add(node.props.appearance.thumbImage);
      }
      if (node.type === 'Select' && node.props.appearance) {
        imageSources.add(node.props.appearance.fieldImage);
        imageSources.add(node.props.appearance.arrowImage);
        imageSources.add(node.props.appearance.popupImage);
      }
      if (node.type === 'CheckBox' && node.props.appearance) { imageSources.add(node.props.appearance.box.image); imageSources.add(node.props.appearance.mark.image); }
      if (node.type === 'RadioGroup' && node.props.appearance) for (const item of node.props.appearance.items) { imageSources.add(item.option.image); imageSources.add(item.indicator.image); }
      if (node.type === 'Input' && node.props.appearance) imageSources.add(node.props.appearance.backgroundImage);
      if (node.type === 'ProgressBar' && node.props.appearance) { imageSources.add(node.props.appearance.track.image); imageSources.add(node.props.appearance.fill.image); }
      if (node.type === 'Slider' && node.props.appearance) { imageSources.add(node.props.appearance.track.image); imageSources.add(node.props.appearance.fill.image); imageSources.add(node.props.appearance.thumbImage); }
      if (node.type === 'ScrollView' && node.props.appearance) {
        imageSources.add(node.props.appearance.viewport.image);
        imageSources.add(node.props.appearance.scrollbarTrack.image);
        imageSources.add(node.props.appearance.scrollbarThumbImage);
      }
      if (node.type === 'List' && node.props.appearance) {
        imageSources.add(node.props.appearance.backgroundImage);
        imageSources.add(node.props.appearance.rowImage);
        imageSources.add(node.props.appearance.selectedRowImage);
      }
      if (node.type === 'Panel' && node.props.appearance) {
        imageSources.add(node.props.appearance.background.image);
        imageSources.add(node.props.appearance.header.image);
        if (node.props.appearance.body) imageSources.add(node.props.appearance.body.image);
      }
      if (node.type === 'Dialog' && node.props.appearance) {
        imageSources.add(node.props.appearance.background.image);
        imageSources.add(node.props.appearance.header.image);
        imageSources.add(node.props.appearance.body.image);
        if (node.props.appearance.overlayImage) imageSources.add(node.props.appearance.overlayImage);
      }
      if (node.type === 'Tabs' && node.props.appearance) {
        imageSources.add(node.props.appearance.tabImage);
        imageSources.add(node.props.appearance.activeTabImage);
      }
      if (node.type === 'Text' && node.props.fontSource) fontSources.set(`${node.props.fontSource}\u0000${node.props.style.fontFamily}`, node.props.fontSource);
    }
    await Promise.all([...imageSources].map(async source => {
      const image = await imageResolver(source, signal);
      this.assertOpen(); current(); signal.throwIfAborted();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(`RESOURCE_DECODE_FAILED: ${source}`);
      // skipCache gives this tree scope sole ownership; an old tree cannot invalidate a new one.
      this.images.set(source, { texture: Texture.from(image, true), references: 0 });
    }));
    // A compiled document has already checked regions against image facts. Direct runtime
    // callers do not supply those facts, so verify the same safety boundary after decode.
    for (const node of walkNodes(document)) {
      if (node.type === 'Image' && node.props.region) {
        const entry = this.images.get(node.props.source);
        const region = node.props.region;
        if (!entry || region.x + region.width > entry.texture.width || region.y + region.height > entry.texture.height) {
          throw new Error(`IMAGE_REGION_OUT_OF_BOUNDS: ${node.id}`);
        }
      }
      if (node.type === 'Button' && node.props.appearance) {
        const background = this.images.get(node.props.appearance.backgroundImage)?.texture;
        if (!background || background.width !== node.props.appearance.sourceCanvas.width || background.height !== node.props.appearance.sourceCanvas.height) {
          throw new Error(`BUTTON_BACKGROUND_CANVAS_MISMATCH: ${node.id}`);
        }
      }
      if (node.type === 'Switch' && node.props.appearance) {
        const appearance = node.props.appearance;
        const track = this.images.get(appearance.trackImage)?.texture;
        const thumb = this.images.get(appearance.thumbImage)?.texture;
        if (!track || track.width !== appearance.sourceCanvas.width || track.height !== appearance.sourceCanvas.height) {
          throw new Error(`SWITCH_TRACK_CANVAS_MISMATCH: ${node.id}`);
        }
        if (!thumb || [appearance.thumbPositions.off, appearance.thumbPositions.on].some(point =>
          point.x + thumb.width > appearance.sourceCanvas.width || point.y + thumb.height > appearance.sourceCanvas.height)) {
          throw new Error(`SWITCH_THUMB_OUT_OF_BOUNDS: ${node.id}`);
        }
      }
      if (node.type === 'Select' && node.props.appearance) {
        const appearance = node.props.appearance;
        const field = this.images.get(appearance.fieldImage)?.texture;
        const arrow = this.images.get(appearance.arrowImage)?.texture;
        const popup = this.images.get(appearance.popupImage)?.texture;
        if (!field || field.width !== appearance.sourceCanvas.width || field.height !== appearance.sourceCanvas.height) {
          throw new Error(`SELECT_FIELD_CANVAS_MISMATCH: ${node.id}`);
        }
        if (!popup || popup.width !== appearance.popupCanvas.width || popup.height !== appearance.popupCanvas.height) {
          throw new Error(`SELECT_POPUP_CANVAS_MISMATCH: ${node.id}`);
        }
        if (!arrow) throw new Error(`SELECT_ARROW_DECODE_FAILED: ${node.id}`);
      }
      if (node.type === 'CheckBox' && node.props.appearance) {
        const box = this.images.get(node.props.appearance.box.image)?.texture, mark = this.images.get(node.props.appearance.mark.image)?.texture;
        if (!box || box.width !== node.props.appearance.box.canvas.width || box.height !== node.props.appearance.box.canvas.height) throw new Error(`CHECKBOX_BOX_CANVAS_MISMATCH: ${node.id}`);
        if (!mark || mark.width !== node.props.appearance.mark.canvas.width || mark.height !== node.props.appearance.mark.canvas.height) throw new Error(`CHECKBOX_MARK_CANVAS_MISMATCH: ${node.id}`);
      }
      if (node.type === 'RadioGroup' && node.props.appearance) {
        for (const item of node.props.appearance.items) {
          const option = this.images.get(item.option.image)?.texture, indicator = this.images.get(item.indicator.image)?.texture;
          if (!option || option.width !== item.option.canvas.width || option.height !== item.option.canvas.height) throw new Error(`RADIO_OPTION_CANVAS_MISMATCH: ${node.id}/${item.optionId}`);
          if (!indicator || indicator.width !== item.indicator.canvas.width || indicator.height !== item.indicator.canvas.height) throw new Error(`RADIO_INDICATOR_CANVAS_MISMATCH: ${node.id}/${item.optionId}`);
        }
      }
      if (node.type === 'Input' && node.props.appearance) {
        const background = this.images.get(node.props.appearance.backgroundImage)?.texture;
        if (!background || background.width !== node.props.appearance.sourceCanvas.width || background.height !== node.props.appearance.sourceCanvas.height) throw new Error(`INPUT_BACKGROUND_CANVAS_MISMATCH: ${node.id}`);
      }
      if (node.type === 'ProgressBar' && node.props.appearance) {
        const track = this.images.get(node.props.appearance.track.image)?.texture, fill = this.images.get(node.props.appearance.fill.image)?.texture;
        if (!track || track.width !== node.props.appearance.track.canvas.width || track.height !== node.props.appearance.track.canvas.height) throw new Error(`PROGRESS_TRACK_CANVAS_MISMATCH: ${node.id}`);
        if (!fill || fill.width !== node.props.appearance.fill.canvas.width || fill.height !== node.props.appearance.fill.canvas.height) throw new Error(`PROGRESS_FILL_CANVAS_MISMATCH: ${node.id}`);
      }
      if (node.type === 'Slider' && node.props.appearance) {
        const track = this.images.get(node.props.appearance.track.image)?.texture, fill = this.images.get(node.props.appearance.fill.image)?.texture, thumb = this.images.get(node.props.appearance.thumbImage)?.texture;
        if (!track || track.width !== node.props.appearance.track.canvas.width || track.height !== node.props.appearance.track.canvas.height) throw new Error(`SLIDER_TRACK_CANVAS_MISMATCH: ${node.id}`);
        if (!fill || fill.width !== node.props.appearance.fill.canvas.width || fill.height !== node.props.appearance.fill.canvas.height) throw new Error(`SLIDER_FILL_CANVAS_MISMATCH: ${node.id}`);
        if (!thumb || thumb.width !== node.props.appearance.thumbCanvas.width || thumb.height !== node.props.appearance.thumbCanvas.height) throw new Error(`SLIDER_THUMB_CANVAS_MISMATCH: ${node.id}`);
      }
      const part = (source: string, canvas: { width: number; height: number }, code: string): void => {
        const texture = this.images.get(source)?.texture;
        if (!texture || texture.width !== canvas.width || texture.height !== canvas.height) throw new Error(`${code}: ${node.id}`);
      };
      if (node.type === 'Container' && node.props.appearance) {
        part(node.props.appearance.background.image, node.props.appearance.background.canvas, 'CONTAINER_BACKGROUND_CANVAS_MISMATCH');
      }
      if (node.type === 'ScrollView' && node.props.appearance) {
        const appearance = node.props.appearance;
        part(appearance.viewport.image, appearance.viewport.canvas, 'SCROLL_VIEWPORT_CANVAS_MISMATCH');
        part(appearance.scrollbarTrack.image, appearance.scrollbarTrack.canvas, 'SCROLLBAR_TRACK_CANVAS_MISMATCH');
        part(appearance.scrollbarThumbImage, appearance.scrollbarThumbCanvas, 'SCROLLBAR_THUMB_CANVAS_MISMATCH');
      }
      if (node.type === 'List' && node.props.appearance) {
        const appearance = node.props.appearance;
        part(appearance.backgroundImage, appearance.sourceCanvas, 'LIST_BACKGROUND_CANVAS_MISMATCH');
        part(appearance.rowImage, appearance.rowCanvas, 'LIST_ROW_CANVAS_MISMATCH');
        part(appearance.selectedRowImage, appearance.selectedRowCanvas, 'LIST_SELECTED_ROW_CANVAS_MISMATCH');
      }
      if (node.type === 'Panel' && node.props.appearance) {
        const appearance = node.props.appearance;
        part(appearance.background.image, appearance.background.canvas, 'PANEL_BACKGROUND_CANVAS_MISMATCH');
        part(appearance.header.image, appearance.header.canvas, 'PANEL_HEADER_CANVAS_MISMATCH');
        if (appearance.body) part(appearance.body.image, appearance.body.canvas, 'PANEL_BODY_CANVAS_MISMATCH');
      }
      if (node.type === 'Dialog' && node.props.appearance) {
        const appearance = node.props.appearance;
        part(appearance.background.image, appearance.background.canvas, 'DIALOG_BACKGROUND_CANVAS_MISMATCH');
        part(appearance.header.image, appearance.header.canvas, 'DIALOG_HEADER_CANVAS_MISMATCH');
        part(appearance.body.image, appearance.body.canvas, 'DIALOG_BODY_CANVAS_MISMATCH');
        if (appearance.overlayImage && appearance.overlayCanvas) part(appearance.overlayImage, appearance.overlayCanvas, 'DIALOG_OVERLAY_CANVAS_MISMATCH');
      }
      if (node.type === 'Tabs' && node.props.appearance) {
        part(node.props.appearance.tabImage, node.props.appearance.tabCanvas, 'TAB_CANVAS_MISMATCH');
        part(node.props.appearance.activeTabImage, node.props.appearance.activeTabCanvas, 'ACTIVE_TAB_CANVAS_MISMATCH');
      }
    }
    await Promise.all([...fontSources.entries()].map(async ([key, source]) => {
      const family = key.slice(key.indexOf('\u0000') + 1);
      const bytes = await fontResolver(source, signal);
      this.assertOpen(); current(); signal.throwIfAborted();
      if (typeof FontFace !== 'function' || !documentFonts()) throw new Error(`FONT_LOADING_UNSUPPORTED: ${source}`);
      const face = new FontFace(family, bytes);
      await face.load();
      this.assertOpen(); current(); signal.throwIfAborted();
      documentFonts()!.add(face);
      this.fonts.set(key, { face, family });
    }));
  }

  acquireImage(source: string): { texture: Texture; release: () => void } {
    this.assertOpen();
    const entry = this.images.get(source);
    if (!entry) throw new Error(`RESOURCE_NOT_PREPARED: ${source}`);
    entry.references += 1;
    let released = false;
    return {
      texture: entry.texture,
      release: () => {
        if (released) return;
        released = true; entry.references -= 1;
        if (entry.references === 0) {
          entry.texture.destroy(true);
          this.images.delete(source);
        }
      },
    };
  }

  count(): number { return this.images.size + this.fonts.size; }

  destroy(errors: unknown[] = []): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.images.values()) captureCleanup(errors, () => entry.texture.destroy(true));
    this.images.clear();
    for (const entry of this.fonts.values()) captureCleanup(errors, () => documentFonts()?.delete(entry.face));
    this.fonts.clear();
  }
}

interface Gesture {
  record: RuntimeRecord;
  move?(point: { x: number; y: number }): void;
  end(inside: boolean, source: RuntimeInputSource): void;
  cancel(reason: string, source: RuntimeInputSource): void;
}

interface RuntimeRecord {
  readonly scope: MountedScope;
  readonly node: UiNode;
  readonly view: Container;
  /** Transform wrapper shared by painted chrome and actual child component views. */
  readonly visual: Container;
  /** Redrawable chrome; clearing it must never destroy child component views. */
  readonly paint: Container;
  /** Raster header/scrollbar chrome that must remain above semantic child views. */
  readonly foreground: Container;
  readonly displayParent: Container;
  readonly order: number;
  readonly childIds: string[];
  readonly parent?: RuntimeRecord;
  readonly modalScope?: string;
  cleanups: Array<() => void>;
  resourceReleases: Array<() => void>;
  toggleTextures?: { track: Texture; thumb: Texture };
  checkboxTextures?: { box: Texture; mark: Texture };
  radioTextures?: Map<string, { option: Texture; indicator: Texture }>;
  inputTexture?: Texture;
  progressTextures?: { track: Texture; fill: Texture };
  sliderTextures?: { track: Texture; fill: Texture; thumb: Texture };
  containerTexture?: Texture;
  scrollTextures?: { viewport: Texture; scrollbarTrack: Texture; scrollbarThumb: Texture };
  listTextures?: { background: Texture; row: Texture; selectedRow: Texture };
  panelTextures?: { background: Texture; header: Texture; body?: Texture };
  dialogTextures?: { background: Texture; header: Texture; body: Texture; overlay?: Texture };
  tabsTextures?: { tab: Texture; activeTab: Texture };
  buttonTexture?: Texture;
  selectTextures?: { field: Texture; arrow: Texture; popup: Texture };
  userVisible: boolean;
  tabVisible: boolean;
  destroyed: boolean;
  popup?: Container;
  popupClosing: boolean;
  dialogBlocker?: Container;
  dialogHasRasterOverlay?: boolean;
  dialogDetached: boolean;
  logicalDialogTransform?: Matrix;
  dialogClosing: boolean;
  redraw?: () => void;
  updateContentPosition?: () => void;
  updateTabs?: () => void;
  sliderPreview?: number;
  motion: MotionValues;
  presentation: Record<string, number>;
  motionKeys: Set<string>;
}

interface MountedScope {
  document: UiDocument;
  holder: Container;
  /** Full-canvas modal backdrops are intentionally separate from animated panels. */
  modalLayer: Container;
  /** Overlay is a sibling of the root so Select rows are neither clipped nor hit-tested through its base control. */
  overlay: Container;
  resources: TreeResources;
  records: Map<string, RuntimeRecord>;
  root?: RuntimeRecord;
  disposed: boolean;
}

const textNodeTypes = new Set<UiNode['type']>(['Text']);
const enabledNodeTypes = new Set<UiNode['type']>(['Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select', 'Slider', 'List', 'Tabs']);
const sourceOf = (pointerType: string): RuntimeInputSource => pointerType === 'touch' ? 'touch' : pointerType === 'pen' ? 'pen' : 'mouse';
const documentFonts = (): FontFaceSet | undefined => (document as Document & { fonts?: FontFaceSet }).fonts;
const captureCleanup = (errors: unknown[], callback: () => void): void => { try { callback(); } catch (error) { errors.push(error); } };

function styleOf(node: UiNode): ControlStyle { return node.props.style; }
function enabledOf(node: UiNode): boolean | null { return enabledNodeTypes.has(node.type) ? (node.props as { enabled: boolean }).enabled : null; }
function isComposite(node: UiNode): node is Extract<UiNode, { children: UiNode[] }> { return 'children' in node; }

function drawBox(width: number, height: number, style: ControlStyle, fill = style.backgroundColor): Graphics {
  const graphic = new Graphics();
  const radius = Math.min(style.cornerRadius, width / 2, height / 2);
  if (radius > 0) graphic.roundRect(0, 0, width, height, radius);
  else graphic.rect(0, 0, width, height);
  graphic.fill({ color: fill });
  if (style.borderWidth > 0) graphic.stroke({ color: style.borderColor, width: style.borderWidth, alignment: 0.5 });
  return graphic;
}

function clear(container: Container): void {
  for (const child of container.removeChildren()) child.destroy({ children: true });
}

function addClip(parent: Container, width: number, height: number): Container {
  const holder = new Container();
  const mask = new Graphics().rect(0, 0, width, height).fill({ color: '#ffffff' });
  holder.addChild(mask); holder.mask = mask; parent.addChild(holder);
  return holder;
}

function fits(text: Text, layout: Layout): boolean { return text.width <= layout.width + 0.01 && text.height <= layout.height + 0.01; }

function makeText(node: TextNode, value = node.props.text): Text {
  const { props } = node;
  const text = new Text({
    text: value,
    style: {
      fontFamily: props.style.fontFamily,
      fontSize: props.style.fontSize,
      fontWeight: props.style.fontWeight,
      fill: props.style.textColor,
      lineHeight: props.lineHeight,
      wordWrap: props.wrap === 'word',
      wordWrapWidth: node.layout.width,
      breakWords: props.wrap === 'word',
    },
  });
  if (props.overflow === 'ellipsis' && !fits(text, node.layout)) {
    const codepoints = [...value];
    let low = 0, high = codepoints.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      text.text = `${codepoints.slice(0, middle).join('')}…`;
      if (fits(text, node.layout)) low = middle;
      else high = middle - 1;
    }
    text.text = low === 0 ? '…' : `${codepoints.slice(0, low).join('')}…`;
  }
  if (props.overflow === 'error' && !fits(text, node.layout)) {
    text.destroy();
    throw new Error(`TEXT_OVERFLOW: ${node.id} exceeds its explicit layout`);
  }
  return text;
}

function drawTextNode(record: RuntimeRecord): void {
  const node = record.node as TextNode;
  clear(record.paint);
  record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
  const target = node.props.overflow === 'clip' ? addClip(record.paint, node.layout.width, node.layout.height) : record.paint;
  target.addChild(makeText(node));
}

function cloneForSnapshot(document: UiDocument): UiDocument { return validateDocument(structuredClone(document)); }

async function defaultFontResolver(source: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const timeout = AbortSignal.timeout(10_000);
  const bounded = AbortSignal.any([signal, timeout]);
  try {
    const response = await fetch(source, { signal: bounded });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.arrayBuffer();
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new HarnessError('resource', [{ path: '$.root', code: timeout.aborted ? 'FONT_TIMEOUT' : 'FONT_LOAD_FAILED', message: `${source}: ${error instanceof Error ? error.message : String(error)}` }]);
  }
}

/** Create a PixiJS-backed preview. UI documents and runtime events remain engine-neutral. */
export async function createTreePreview(host: HTMLElement, onFatal: (error: unknown) => void): Promise<TreePreview> {
  if (typeof PointerEvent !== 'function') throw new Error('UNSUPPORTED_BROWSER: Pointer Events are required');
  const app = new Application();
  await app.init({ width: 1, height: 1, backgroundAlpha: 0, antialias: true, resolution: 1, preference: 'webgl', autoStart: false });
  const canvas = app.canvas as HTMLCanvasElement;
  canvas.setAttribute('aria-label', 'PixiJS component tree canvas'); canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0; canvas.style.touchAction = 'none'; host.append(canvas);
  app.renderer.events.features.wheel = true;

  const stage = new Container(); app.stage.addChild(stage);
  const listeners = new Set<(event: TreeRuntimeEvent) => void>();
  const externalCleanups: Array<() => void> = [];
  const gestures = new Map<number, Gesture>();
  let externalListeners = 0;
  let zoom = 1;
  let loadGeneration = 0;
  let destroyed = false;
  let active: MountedScope | undefined;
  let focusedInput: RuntimeRecord | undefined;
  let openSelect: RuntimeRecord | undefined;
  const controllers = new Set<AbortController>();
  // One animator frame can update a parent plus many staggered descendants.
  // Their presentation writes must all reach Pixi before a single render; a
  // full render per channel makes software WebGL spend most of the frame
  // repainting intermediate states and delays subsequent native frames.
  let renderBatchDepth = 0;
  let renderDirty = false;

  // A host error callback must not prevent cleanup, but cleanup failures are still
  // delivered once every owned resource/listener has been released.
  const reportFatal = (error: unknown): void => { try { onFatal(error); } catch { /* host callback failure cannot strand resources */ } };
  const reportCleanupErrors = (errors: readonly unknown[]): void => { for (const error of errors) reportFatal(error); };
  const assertAlive = (): void => { if (destroyed) throw new Error('TREE_PREVIEW_DESTROYED'); };
  const render = (): void => {
    if (destroyed) return;
    if (renderBatchDepth > 0) { renderDirty = true; return; }
    renderDirty = false; app.render();
  };
  const flushBatchedRender = (): void => {
    if (!destroyed && renderDirty) { renderDirty = false; app.render(); }
  };
  const animator = new MotionAnimator({
    now: () => performance.now(),
    request: callback => requestAnimationFrame(timestamp => {
      renderBatchDepth += 1;
      try { callback(timestamp); }
      finally { renderBatchDepth -= 1; if (renderBatchDepth === 0) flushBatchedRender(); }
    }),
    cancel: frame => cancelAnimationFrame(frame),
  }, reportFatal);
  let motionSystem: MotionSystemDocument | null = null;
  let motionStyle: MotionStyle | null = null;
  const listen = (target: EventTarget, type: string, callback: EventListener, options?: boolean | AddEventListenerOptions): void => {
    target.addEventListener(type, callback, options); externalListeners += 1;
    externalCleanups.push(() => { target.removeEventListener(type, callback, options); externalListeners -= 1; });
  };

  const editor = document.createElement('input');
  editor.setAttribute('aria-hidden', 'true'); editor.tabIndex = -1;
  Object.assign(editor.style, { position: 'fixed', opacity: '0', width: '1px', height: '1px', pointerEvents: 'none', left: '-10000px', top: '0' });
  host.append(editor);

  function emit(record: RuntimeRecord, type: RuntimeEventType, source: RuntimeInputSource, value?: TreeRuntimeEvent['value'], targetId = record.node.id): void {
    const event: TreeRuntimeEvent = { type, id: record.node.id, source, sourceId: record.node.id, targetId };
    if (value !== undefined) event.value = value;
    for (const listener of [...listeners]) {
      try { listener(event); } catch (error) { reportFatal(error); }
    }
    if (type === 'activate') {
      // A bound press action already supplies the release feedback. Emphasis is
      // retained as the fallback for an authored activation-only binding.
      if (!hasAction(record, 'press')) runSystemAction(record, 'emphasis');
    }
    else if (type === 'change') runSystemAction(record, record.node.type === 'ProgressBar' || record.node.type === 'Slider' ? 'progress' : 'change');
    else if (type === 'scroll') runSystemAction(record, 'scroll');
    else if (type === 'focus') runSystemAction(record, 'focus', true);
    else if (type === 'blur') runSystemAction(record, 'focus', false);
  }

  function canonicalPresentation(record: RuntimeRecord): Record<string, number> {
    const common = { entryAlpha: 1, entryY: 0, entryScale: 1, emphasisScale: 1 };
    switch (record.node.type) {
      case 'Button': return { ...common, pressScale: 1, hoverScale: 1 };
      case 'Switch': return { ...common, hoverScale: 1, checked: record.node.props.checked ? 1 : 0 };
      case 'CheckBox': return { ...common, hoverScale: 1, checked: record.node.props.checked ? 1 : 0, checkAlpha: record.node.props.checked ? 1 : 0, checkScale: 1 };
      case 'RadioGroup': {
        const row = record.node.layout.height / record.node.props.options.length;
        const selectedId = record.node.props.selectedId;
        const index = Math.max(0, record.node.props.options.findIndex(option => option.id === selectedId));
        const item = record.node.props.appearance?.items[index], markerY = item ? (item.indicator.layout.y + item.indicator.layout.height / 2) * record.node.layout.height / record.node.props.appearance!.sourceCanvas.height : index * row + row / 2;
        return { ...common, hoverScale: 1, markerAlpha: selectedId === null ? 0 : 1, markerY };
      }
      case 'Input': return { ...common, focus: focusedInput === record ? 1 : 0 };
      case 'Select': return { ...common, hoverScale: 1, popupOpen: record.popup ? 1 : 0, selectionFlash: 0 };
      case 'ProgressBar': return { ...common, progress: record.node.props.value / record.node.props.max };
      case 'Slider': return { ...common, hoverScale: 1, sliderValue: record.sliderPreview ?? record.node.props.value };
      case 'ScrollView': return { ...common, scrollX: record.node.props.scrollX, scrollY: record.node.props.scrollY };
      case 'List': {
        const selectedId = record.node.props.selectedId;
        return { ...common, hoverScale: 1, listSelection: selectedId === null ? -1 : record.node.props.items.findIndex(item => item.id === selectedId), stagger: 1 };
      }
      case 'Container': case 'Panel': return { ...common, stagger: 1 };
      case 'Dialog': return { ...common, dialogScale: 1, dialogAlpha: 1 };
      case 'Tabs': return { ...common, hoverScale: 1, tabProgress: 1 };
      default: return common;
    }
  }
  function presentation(record: RuntimeRecord): Record<string, number> {
    const values = { ...canonicalPresentation(record), ...record.presentation };
    for (const key of ['entryAlpha', 'dialogAlpha', 'checkAlpha', 'markerAlpha', 'focus', 'popupOpen', 'selectionFlash', 'progress', 'checked', 'tabProgress', 'stagger']) {
      if (key in values) values[key] = Math.max(0, Math.min(1, values[key]));
    }
    return values;
  }
  function pinPresentation(record: RuntimeRecord, keys: readonly string[]): void {
    const values = presentation(record);
    for (const key of keys) if (key in values) record.presentation[key] = values[key];
  }
  function preparePresentationChange(record: RuntimeRecord, action: MotionAction, keys: readonly string[]): void {
    if (hasAction(record, action)) pinPresentation(record, keys);
    else for (const key of keys) delete record.presentation[key];
  }
  function applyPresentation(record: RuntimeRecord): void {
    const values = presentation(record);
    const centerX = record.node.layout.width / 2, centerY = record.node.layout.height / 2;
    const scale = (values.entryScale ?? 1) * (values.pressScale ?? 1) * (values.hoverScale ?? 1) * (values.emphasisScale ?? 1) * (values.dialogScale ?? 1);
    record.visual.position.set(centerX, centerY + (values.entryY ?? 0));
    record.visual.scale.set(Math.max(0.001, scale));
    record.visual.alpha = Math.max(0, Math.min(1, (values.entryAlpha ?? 1) * (values.dialogAlpha ?? 1)));
    if (record.popup) record.popup.alpha = Math.max(0, Math.min(1, values.popupOpen ?? 1));
    if (record.dialogBlocker) {
      const alpha = Math.max(0, Math.min(1, values.dialogAlpha ?? 1));
      record.dialogBlocker.alpha = (record.dialogHasRasterOverlay ? 1 : 0.28) * alpha;
    }
  }
  function refreshPresentation(record: RuntimeRecord): void {
    if (record.destroyed) return;
    record.redraw?.(); applyPresentation(record); record.updateContentPosition?.(); positionOpenPopup(record.scope); render();
  }
  function resetPresentation(record: RuntimeRecord): void {
    record.presentation = {}; refreshPresentation(record);
  }
  function cancelRecordPresentation(record: RuntimeRecord, reset = true): void {
    for (const key of record.motionKeys) animator.cancel(key);
    record.motionKeys.clear();
    if (reset) resetPresentation(record);
  }
  function cancelPresentationTree(record: RuntimeRecord): void {
    cancelRecordPresentation(record);
    if (record.popupClosing) closePopup(record, undefined, true);
    if (record.dialogClosing) {
      record.dialogClosing = false; updateDialogBlocker(record); refreshVisibility(record);
    }
    for (const childId of record.childIds) {
      const child = record.scope.records.get(childId);
      if (child) cancelPresentationTree(child);
    }
  }
  function bindingFor(record: RuntimeRecord): MotionSystemDocument['bindings'][number] | undefined {
    return motionSystem?.bindings.find(binding => binding.targetId === record.node.id && binding.componentType === record.node.type);
  }
  function hasAction(record: RuntimeRecord, action: MotionAction): boolean {
    return Boolean(bindingFor(record)?.actions.includes(action));
  }
  function animatePresentation(
    record: RuntimeRecord,
    channel: string,
    from: Record<string, number>,
    steps: Array<{ to: Record<string, number>; duration: number; easing: ReturnType<typeof getMotionStyle>['easing'] }>,
    complete?: () => void,
  ): void {
    // Animation keys belong to this preview scheduler. Ordinals avoid exceeding
    // the public identifier cap when a valid node ID is already 128 characters.
    const key = `motion.n${record.order}.${channel}`;
    record.motionKeys.add(key);
    animator.animate(key, from, steps, values => {
      if (record.destroyed) return;
      Object.assign(record.presentation, values); refreshPresentation(record);
    }, () => {
      record.motionKeys.delete(key);
      complete?.();
    });
  }

  function currentModal(scope: MountedScope): RuntimeRecord | undefined {
    let last: RuntimeRecord | undefined, highestLayerIndex = -1;
    for (const record of scope.records.values()) {
      if (record.node.type !== 'Dialog' || !record.node.props.modal || !(record.node.props.open || record.dialogClosing) || !effectiveVisible(record)) continue;
      const layerIndex = record.dialogDetached ? scope.modalLayer.getChildIndex(record.view) : -1;
      if (layerIndex >= highestLayerIndex) { last = record; highestLayerIndex = layerIndex; }
    }
    return last;
  }
  function effectiveVisible(record: RuntimeRecord): boolean {
    return !record.destroyed && record.userVisible && record.tabVisible && (record.node.type !== 'Dialog' || record.node.props.open || record.dialogClosing)
      && (!record.parent || effectiveVisible(record.parent));
  }
  function blocked(record: RuntimeRecord): boolean {
    const modal = currentModal(record.scope);
    return Boolean(modal && record.modalScope !== modal.node.id && record.node.id !== modal.node.id);
  }
  function interactive(record: RuntimeRecord): boolean {
    return active === record.scope && effectiveVisible(record) && enabledOf(record.node) !== false && !blocked(record);
  }
  function refreshVisibility(record: RuntimeRecord): void {
    record.view.visible = effectiveVisible(record);
    if (record.node.type === 'Dialog') updateDialogBlocker(record);
    for (const childId of record.childIds) {
      const child = record.scope.records.get(childId);
      if (child) refreshVisibility(child);
    }
  }
  function cancelGestures(reason: string, source: RuntimeInputSource = 'control', cleanupErrors?: unknown[]): void {
    for (const gesture of [...gestures.values()]) {
      if (cleanupErrors) captureCleanup(cleanupErrors, () => gesture.cancel(reason, source));
      else gesture.cancel(reason, source);
    }
  }
  function isDescendantOf(record: RuntimeRecord, ancestor: RuntimeRecord): boolean {
    for (let current: RuntimeRecord | undefined = record; current; current = current.parent) if (current === ancestor) return true;
    return false;
  }
  function cancelGesturesFor(ancestor: RuntimeRecord, reason: string, source: RuntimeInputSource = 'control', cleanupErrors?: unknown[]): void {
    for (const gesture of [...gestures.values()]) {
      if (!isDescendantOf(gesture.record, ancestor)) continue;
      if (cleanupErrors) captureCleanup(cleanupErrors, () => gesture.cancel(reason, source));
      else gesture.cancel(reason, source);
    }
  }
  function canvasPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return { x: -Infinity, y: -Infinity };
    return {
      x: (event.clientX - bounds.left) * app.screen.width / bounds.width / zoom,
      y: (event.clientY - bounds.top) * app.screen.height / bounds.height / zoom,
    };
  }
  function contains(record: RuntimeRecord, point: { x: number; y: number }): boolean {
    const local = record.view.toLocal({ x: point.x * zoom, y: point.y * zoom });
    return local.x >= 0 && local.y >= 0 && local.x <= record.node.layout.width && local.y <= record.node.layout.height;
  }
  function inspectionBounds(record: RuntimeRecord): RuntimeBounds {
    const { width, height } = record.node.layout;
    const corners = [record.view.toGlobal({ x: 0, y: 0 }), record.view.toGlobal({ x: width, y: 0 }), record.view.toGlobal({ x: 0, y: height }), record.view.toGlobal({ x: width, y: height })];
    const xs = corners.map(point => point.x / zoom), ys = corners.map(point => point.y / zoom);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  function closePopup(record: RuntimeRecord, cleanupErrors?: unknown[], force = false): void {
    if (!record.popup) return;
    const popup = record.popup;
    const close = () => {
      if (record.popup !== popup) return;
      popup.removeFromParent(); popup.destroy({ children: true }); record.popup = undefined; record.popupClosing = false;
      if (openSelect === record) openSelect = undefined; delete record.presentation.popupOpen; refreshPresentation(record);
    };
    if (!force && !cleanupErrors && hasAction(record, 'close') && !record.popupClosing) {
      record.popupClosing = true;
      const from = { popupOpen: presentation(record).popupOpen ?? 1 };
      animatePresentation(record, 'popup', from, [{ to: { popupOpen: 0 }, duration: getMotionStyle(motionStyle!).exitMs, easing: getMotionStyle(motionStyle!).easing }], close);
      emit(record, 'close', 'control');
      return;
    }
    if (cleanupErrors) captureCleanup(cleanupErrors, close); else close();
  }
  function positionPopup(record: RuntimeRecord): void {
    const popup = record.popup;
    if (!popup) return;
    // A Select may be nested in a clipped/animated composite. Place the popup in
    // the scope overlay using the actual transformed bottom-left rather than a
    // layout sum, so it remains above sibling controls and receives its own hits.
    const node = record.node;
    const gap = node.type === 'Select' && node.props.appearance ? node.props.appearance.popupGap : 2;
    const global = record.view.toGlobal({ x: 0, y: node.layout.height + gap });
    const local = record.scope.holder.toLocal(global);
    popup.position.copyFrom(local);
  }
  function positionOpenPopup(scope: MountedScope): void {
    if (openSelect?.scope === scope) positionPopup(openSelect);
  }
  function updateNodeAlpha(record: RuntimeRecord): void {
    const disabled = enabledOf(record.node) === false;
    record.view.alpha = styleOf(record.node).opacity * (disabled ? 0.55 : 1) * (record.motion.alpha ?? 1);
    record.view.cursor = disabled ? 'default' : 'pointer';
  }
  function makeInteractive(record: RuntimeRecord, cursor = 'pointer'): void {
    record.view.eventMode = 'static'; record.view.cursor = cursor;
    record.view.hitArea = new Rectangle(0, 0, record.node.layout.width, record.node.layout.height);
    bind(record, 'pointerenter', event => {
      if (!interactive(record)) return;
      runSystemAction(record, 'hover', true); emit(record, 'hover', sourceOf(event.pointerType), 1);
    });
    bind(record, 'pointerleave', event => {
      runSystemAction(record, 'hover', false); emit(record, 'hover', sourceOf(event.pointerType), 0);
    });
  }
  function bind(record: RuntimeRecord, name: 'pointerdown' | 'pointerup' | 'pointerupoutside' | 'pointertap' | 'pointerenter' | 'pointerleave', callback: (event: FederatedPointerEvent) => void): void {
    const guarded = (event: FederatedPointerEvent) => { try { callback(event); } catch (error) { reportFatal(error); } };
    record.view.on(name, guarded); record.cleanups.push(() => record.view.off(name, guarded));
  }
  function bindWheel(record: RuntimeRecord, callback: (event: FederatedWheelEvent) => void): void {
    const guarded = (event: FederatedWheelEvent) => { try { callback(event); } catch (error) { reportFatal(error); } };
    record.view.on('wheel', guarded); record.cleanups.push(() => record.view.off('wheel', guarded));
  }
  function press(record: RuntimeRecord, activate: (source: RuntimeInputSource) => void): void {
    makeInteractive(record);
    const release = (pointerId: number, inside: boolean, source: RuntimeInputSource): void => {
      const gesture = gestures.get(pointerId); if (!gesture || gesture.record !== record) return;
      gestures.delete(pointerId);
      if (inside && interactive(record)) {
        if (!runSystemAction(record, 'press', false)) { delete record.presentation.pressScale; refreshPresentation(record); }
        emit(record, 'release', source); activate(source);
      }
      else { cancelRecordPresentation(record); emit(record, 'cancel', source); }
      render();
    };
    bind(record, 'pointerdown', event => {
      if (!interactive(record) || event.button !== 0 || !event.isPrimary || gestures.has(event.pointerId)) return;
      // Popup rows are their own controls. Do not turn their press into a second Select toggle.
      if (record.popup && event.target !== record.view) return;
      if (openSelect && openSelect !== record) closePopup(openSelect);
      canvas.focus({ preventScroll: true });
      if (!runSystemAction(record, 'press')) { record.presentation.pressScale = 0.97; refreshPresentation(record); }
      emit(record, 'press', sourceOf(event.pointerType));
      gestures.set(event.pointerId, {
        record,
        end: (inside, source) => release(event.pointerId, inside, source),
        cancel: (_reason, source) => {
          if (gestures.get(event.pointerId)?.record === record) gestures.delete(event.pointerId);
          cancelRecordPresentation(record); emit(record, 'cancel', source);
        },
      });
    });
    bind(record, 'pointerup', event => release(event.pointerId, true, sourceOf(event.pointerType)));
    bind(record, 'pointerupoutside', event => release(event.pointerId, false, sourceOf(event.pointerType)));
  }

  function renderImage(record: RuntimeRecord): void {
    const node = record.node as ImageNode;
    clear(record.paint);
    if (node.props.drawBackground !== false) record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    const handle = record.scope.resources.acquireImage(node.props.source); record.resourceReleases.push(handle.release);
    let texture = handle.texture;
    if (node.props.region) {
      const region = node.props.region;
      texture = new Texture({ source: handle.texture.source, frame: new Rectangle(region.x, region.y, region.width, region.height) });
      record.cleanups.push(() => texture.destroy(false));
    }
    const sprite = new Sprite(texture);
    const sourceWidth = texture.width, sourceHeight = texture.height;
    if (node.props.fit === 'stretch') { sprite.width = node.layout.width; sprite.height = node.layout.height; }
    else {
      const scale = node.props.fit === 'contain'
        ? Math.min(node.layout.width / sourceWidth, node.layout.height / sourceHeight)
        : Math.max(node.layout.width / sourceWidth, node.layout.height / sourceHeight);
      sprite.width = sourceWidth * scale; sprite.height = sourceHeight * scale;
      sprite.x = (node.layout.width - sprite.width) / 2; sprite.y = (node.layout.height - sprite.height) / 2;
    }
    const target = node.props.fit === 'cover' ? addClip(record.paint, node.layout.width, node.layout.height) : record.paint;
    target.addChild(sprite);
  }

  function renderButtonBackgroundImage(record: RuntimeRecord, source: string): void {
    const handle = record.scope.resources.acquireImage(source); record.resourceReleases.push(handle.release);
    const sprite = new Sprite(handle.texture);
    sprite.width = record.node.layout.width; sprite.height = record.node.layout.height;
    record.paint.addChild(sprite);
  }

  function rasterScale(record: RuntimeRecord, sourceCanvas: { width: number; height: number }): { x: number; y: number } {
    return { x: record.node.layout.width / sourceCanvas.width, y: record.node.layout.height / sourceCanvas.height };
  }
  function rasterPart(record: RuntimeRecord, texture: Texture, sourceCanvas: { width: number; height: number }, layout: Layout): Sprite {
    const scale = rasterScale(record, sourceCanvas), sprite = new Sprite(texture);
    sprite.x = layout.x * scale.x; sprite.y = layout.y * scale.y;
    sprite.width = layout.width * scale.x; sprite.height = layout.height * scale.y;
    return sprite;
  }

  function label(record: RuntimeRecord, value: string, x: number, y: number, width: number, height: number, style = styleOf(record.node), target: Container = record.paint): void {
    const synthetic: TextNode = {
      id: `${record.node.id}.label`, type: 'Text', layout: { x, y, width, height },
      props: { text: value, wrap: 'none', overflow: 'ellipsis', lineHeight: style.fontSize * 1.25, style },
    };
    const item = makeText(synthetic); item.x = x; item.y = y + Math.max(0, (height - item.height) / 2); target.addChild(item);
  }
  function drawButton(record: RuntimeRecord): void {
    const node = record.node;
    if (node.type !== 'Button') return;
    clear(record.paint);
    if (node.props.appearance && record.buttonTexture) {
      const background = new Sprite(record.buttonTexture); background.width = node.layout.width; background.height = node.layout.height; record.paint.addChild(background);
      const scaleX = node.layout.width / node.props.appearance.sourceCanvas.width, scaleY = node.layout.height / node.props.appearance.sourceCanvas.height;
      const layout = node.props.appearance.labelLayout;
      label(record, node.props.label, layout.x * scaleX, layout.y * scaleY, layout.width * scaleX, layout.height * scaleY);
      return;
    }
    if (node.props.backgroundImage) {
      renderButtonBackgroundImage(record, node.props.backgroundImage);
      // This source may already contain its legacy raster label. `label` stays
      // semantic data, but is not painted a second time over the source PNG.
      return;
    }
    record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    // Explicit text children are the compositional label. Do not bake a second copy from Button.label.
    if (node.props.label && !node.children.some(child => textNodeTypes.has(child.type))) label(record, node.props.label, 8, 0, node.layout.width - 16, node.layout.height);
  }
  function drawToggle(record: RuntimeRecord): void {
    const node = record.node;
    if (node.type !== 'Switch' && node.type !== 'CheckBox') return;
    clear(record.paint);
    const side = Math.min(node.layout.height - 14, 28);
    const values = presentation(record);
    if (node.type === 'Switch') {
      const checked = Math.max(0, Math.min(1, values.checked ?? (node.props.checked ? 1 : 0)));
      if (node.props.appearance && record.toggleTextures) {
        const appearance = node.props.appearance;
        const scaleX = node.layout.width / appearance.sourceCanvas.width;
        const scaleY = node.layout.height / appearance.sourceCanvas.height;
        const track = new Sprite(record.toggleTextures.track);
        track.width = node.layout.width; track.height = node.layout.height;
        const thumb = new Sprite(record.toggleTextures.thumb);
        thumb.width = record.toggleTextures.thumb.width * scaleX;
        thumb.height = record.toggleTextures.thumb.height * scaleY;
        thumb.x = (appearance.thumbPositions.off.x + (appearance.thumbPositions.on.x - appearance.thumbPositions.off.x) * checked) * scaleX;
        thumb.y = (appearance.thumbPositions.off.y + (appearance.thumbPositions.on.y - appearance.thumbPositions.off.y) * checked) * scaleY;
        record.paint.addChild(track, thumb);
        if (appearance.labelLayout) {
          const layout = appearance.labelLayout;
          label(record, node.props.label, layout.x * scaleX, layout.y * scaleY, layout.width * scaleX, layout.height * scaleY);
        }
        return;
      }
      record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
      const track = new Graphics().roundRect(8, (node.layout.height - side) / 2, side * 1.7, side, side / 2)
        .fill({ color: checked > 0.5 ? node.props.style.borderColor : '#AAB7C6' });
      const knob = new Graphics().circle(8 + side * (0.45 + checked * 0.8), node.layout.height / 2, side * 0.34).fill({ color: '#FFFFFF' });
      record.paint.addChild(track, knob); label(record, node.props.label, side * 1.9 + 10, 0, node.layout.width - side * 1.9 - 16, node.layout.height);
    } else {
      const checked = Math.max(0, Math.min(1, values.checked ?? (node.props.checked ? 1 : 0)));
      if (node.props.appearance && record.checkboxTextures) {
        const appearance = node.props.appearance, scaleX = node.layout.width / appearance.sourceCanvas.width, scaleY = node.layout.height / appearance.sourceCanvas.height;
        const place = (texture: Texture, part: typeof appearance.box) => { const sprite = new Sprite(texture); sprite.x = part.layout.x * scaleX; sprite.y = part.layout.y * scaleY; sprite.width = part.layout.width * scaleX; sprite.height = part.layout.height * scaleY; return sprite; };
        record.paint.addChild(place(record.checkboxTextures.box, appearance.box));
        const mark = place(record.checkboxTextures.mark, appearance.mark), markHolder = new Container(); markHolder.position.set(mark.x + mark.width / 2, mark.y + mark.height / 2); mark.position.set(-mark.width / 2, -mark.height / 2); markHolder.scale.set(Math.max(0.001, values.checkScale ?? 1)); markHolder.alpha = Math.max(0, Math.min(1, values.checkAlpha ?? checked)); markHolder.addChild(mark); record.paint.addChild(markHolder);
        const layout = appearance.labelLayout; label(record, node.props.label, layout.x * scaleX, layout.y * scaleY, layout.width * scaleX, layout.height * scaleY);
        return;
      }
      record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
      const box = new Graphics().roundRect(9, (node.layout.height - side) / 2, side, side, 3).fill({ color: checked > 0.5 ? node.props.style.borderColor : '#FFFFFF' })
        .stroke({ color: node.props.style.borderColor, width: 1 });
      record.paint.addChild(box);
      const tick = new Graphics().moveTo(14, node.layout.height / 2).lineTo(19, node.layout.height / 2 + 5).lineTo(28, node.layout.height / 2 - 6).stroke({ color: '#FFFFFF', width: 2.5 });
      tick.alpha = Math.max(0, Math.min(1, values.checkAlpha ?? checked)); tick.scale.set(Math.max(0.001, values.checkScale ?? 1)); tick.pivot.set(19, node.layout.height / 2); tick.position.set(19, node.layout.height / 2);
      record.paint.addChild(tick);
      label(record, node.props.label, side + 18, 0, node.layout.width - side - 26, node.layout.height);
    }
  }
  function drawChoices(record: RuntimeRecord, kind: 'radio' | 'select'): void {
    const node = record.node;
    if (kind === 'select') {
      if (node.type !== 'Select') return;
      clear(record.paint);
      if (node.props.appearance && record.selectTextures) {
        const { appearance } = node.props;
        const scaleX = node.layout.width / appearance.sourceCanvas.width;
        const scaleY = node.layout.height / appearance.sourceCanvas.height;
        const field = new Sprite(record.selectTextures.field); field.width = node.layout.width; field.height = node.layout.height;
        record.paint.addChild(field);
        const selected = node.props.options.find(option => option.id === node.props.selectedId);
        const text = appearance.labelLayout;
        label(record, selected?.label ?? '', text.x * scaleX, text.y * scaleY, text.width * scaleX, text.height * scaleY);
        const arrowLayout = appearance.arrowLayout;
        const arrow = new Sprite(record.selectTextures.arrow);
        arrow.x = arrowLayout.x * scaleX; arrow.y = arrowLayout.y * scaleY;
        arrow.width = arrowLayout.width * scaleX; arrow.height = arrowLayout.height * scaleY;
        record.paint.addChild(arrow);
      } else {
        record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
        const options = node.props.options;
        const selected = options.find(option => option.id === node.props.selectedId);
        label(record, selected?.label ?? '', 10, 0, node.layout.width - 34, node.layout.height);
        label(record, '⌄', node.layout.width - 26, 0, 20, node.layout.height);
      }
      const flash = Math.max(0, Math.min(1, presentation(record).selectionFlash ?? 0));
      if (flash > 0) record.paint.addChild(new Graphics().roundRect(1, 1, node.layout.width - 2, node.layout.height - 2, Math.max(0, node.props.style.cornerRadius - 1)).stroke({ color: node.props.style.borderColor, width: 3, alpha: flash }));
      return;
    }
    if (node.type !== 'RadioGroup') return;
    clear(record.paint);
    const options = node.props.options;
    if (node.props.appearance && record.radioTextures) {
      const appearance = node.props.appearance, scaleX = node.layout.width / appearance.sourceCanvas.width, scaleY = node.layout.height / appearance.sourceCanvas.height;
      const selected = node.props.selectedId;
      for (const option of options) {
        const item = appearance.items.find(candidate => candidate.optionId === option.id), textures = record.radioTextures.get(option.id); if (!item || !textures) continue;
        const place = (texture: Texture, part: typeof item.option) => { const sprite = new Sprite(texture); sprite.x = part.layout.x * scaleX; sprite.y = part.layout.y * scaleY; sprite.width = part.layout.width * scaleX; sprite.height = part.layout.height * scaleY; return sprite; };
        record.paint.addChild(place(textures.option, item.option));
        const layout = item.labelLayout; label(record, option.label, layout.x * scaleX, layout.y * scaleY, layout.width * scaleX, layout.height * scaleY);
        if (selected === option.id) { const indicator = place(textures.indicator, item.indicator), markerY = presentation(record).markerY; if (markerY !== undefined) indicator.y = markerY - indicator.height / 2; indicator.alpha = Math.max(0, Math.min(1, presentation(record).markerAlpha ?? 1)); record.paint.addChild(indicator); }
      }
      return;
    }
    record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    const row = node.layout.height / Math.max(1, options.length);
    const values = presentation(record);
    options.forEach((option, index) => {
      const y = index * row + row / 2;
      record.paint.addChild(new Graphics().circle(17, y, 9).fill({ color: '#FFFFFF' }).stroke({ color: node.props.style.borderColor, width: 1 }));
      label(record, option.label, 34, index * row, node.layout.width - 42, row);
    });
    if ((values.markerAlpha ?? 0) > 0) {
      const marker = new Graphics().circle(17, values.markerY ?? row / 2, 5).fill({ color: node.props.style.borderColor });
      marker.alpha = Math.max(0, Math.min(1, values.markerAlpha ?? 1)); record.paint.addChild(marker);
    }
  }
  function drawProgress(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'ProgressBar') return;
    clear(record.paint);
    const amount = Math.max(0, Math.min(1, presentation(record).progress ?? node.props.value / node.props.max));
    if (node.props.appearance && record.progressTextures) {
      const appearance = node.props.appearance, scaleX = node.layout.width / appearance.sourceCanvas.width, scaleY = node.layout.height / appearance.sourceCanvas.height;
      const place = (texture: Texture, part: typeof appearance.track) => { const sprite = new Sprite(texture); sprite.x = part.layout.x * scaleX; sprite.y = part.layout.y * scaleY; sprite.width = part.layout.width * scaleX; sprite.height = part.layout.height * scaleY; return sprite; };
      record.paint.addChild(place(record.progressTextures.track, appearance.track));
      const fill = place(record.progressTextures.fill, appearance.fill), clip = new Graphics().rect(appearance.fillClip.x * scaleX, appearance.fillClip.y * scaleY, appearance.fillClip.width * scaleX * amount, appearance.fillClip.height * scaleY).fill({ color: '#FFFFFF' });
      fill.mask = clip; record.paint.addChild(fill, clip); return;
    }
    record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    record.paint.addChild(new Graphics().roundRect(1, 1, Math.max(0, (node.layout.width - 2) * amount), Math.max(0, node.layout.height - 2), Math.min(node.props.style.cornerRadius, node.layout.height / 2)).fill({ color: node.props.style.borderColor }));
  }
  function sliderValue(record: RuntimeRecord): number {
    const node = record.node; return node.type === 'Slider' ? presentation(record).sliderValue ?? record.sliderPreview ?? node.props.value : 0;
  }
  function drawSlider(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'Slider') return;
    clear(record.paint);
    const margin = 14, trackY = node.layout.height / 2, trackWidth = node.layout.width - margin * 2;
    const ratio = (sliderValue(record) - node.props.min) / (node.props.max - node.props.min);
    if (node.props.appearance && record.sliderTextures) {
      const appearance = node.props.appearance, scaleX = node.layout.width / appearance.sourceCanvas.width, scaleY = node.layout.height / appearance.sourceCanvas.height;
      const track = new Sprite(record.sliderTextures.track); track.x = appearance.track.layout.x * scaleX; track.y = appearance.track.layout.y * scaleY; track.width = appearance.track.layout.width * scaleX; track.height = appearance.track.layout.height * scaleY;
      const fill = new Sprite(record.sliderTextures.fill); fill.x = appearance.fill.layout.x * scaleX; fill.y = appearance.fill.layout.y * scaleY; fill.width = appearance.fill.layout.width * scaleX; fill.height = appearance.fill.layout.height * scaleY;
      const clip = new Graphics().rect(appearance.fillClip.x * scaleX, appearance.fillClip.y * scaleY, appearance.fillClip.width * scaleX * ratio, appearance.fillClip.height * scaleY).fill({ color: '#FFFFFF' }); fill.mask = clip;
      const thumb = new Sprite(record.sliderTextures.thumb); thumb.x = (appearance.thumbPositions.min.x + (appearance.thumbPositions.max.x - appearance.thumbPositions.min.x) * ratio) * scaleX; thumb.y = (appearance.thumbPositions.min.y + (appearance.thumbPositions.max.y - appearance.thumbPositions.min.y) * ratio) * scaleY; thumb.width = appearance.thumbCanvas.width * scaleX; thumb.height = appearance.thumbCanvas.height * scaleY;
      record.paint.addChild(track, fill, clip, thumb); return;
    }
    record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    record.paint.addChild(new Graphics().roundRect(margin, trackY - 3, trackWidth, 6, 3).fill({ color: '#D7E0EC' }));
    record.paint.addChild(new Graphics().roundRect(margin, trackY - 3, trackWidth * ratio, 6, 3).fill({ color: node.props.style.borderColor }));
    record.paint.addChild(new Graphics().circle(margin + trackWidth * ratio, trackY, 9).fill({ color: '#FFFFFF' }).stroke({ color: node.props.style.borderColor, width: 2 }));
  }
  function drawInput(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'Input') return;
    clear(record.paint);
    if (node.props.appearance && record.inputTexture) { const background = new Sprite(record.inputTexture); background.width = node.layout.width; background.height = node.layout.height; record.paint.addChild(background); }
    else record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    const visible = node.props.value.length === 0 ? node.props.placeholder : node.props.inputType === 'password' ? '•'.repeat(node.props.value.length) : node.props.value;
    const style = node.props.value.length === 0 ? { ...node.props.style, textColor: '#75869A' } : node.props.style;
    if (node.props.appearance) { const source = node.props.value.length === 0 ? node.props.appearance.placeholderLayout : node.props.appearance.textLayout; const scaleX = node.layout.width / node.props.appearance.sourceCanvas.width, scaleY = node.layout.height / node.props.appearance.sourceCanvas.height; label(record, visible, source.x * scaleX, source.y * scaleY, source.width * scaleX, source.height * scaleY, style); }
    else label(record, visible, 10, 0, node.layout.width - 20, node.layout.height, style);
    const focus = Math.max(0, Math.min(1, presentation(record).focus ?? 0));
    if (focus > 0) record.paint.addChild(new Graphics().roundRect(1, 1, node.layout.width - 2, node.layout.height - 2, Math.max(0, node.props.style.cornerRadius - 1)).stroke({ color: node.props.style.borderColor, width: 2, alpha: focus }));
  }
  function drawContainer(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'Container') return;
    clear(record.paint);
    if (node.props.appearance && record.containerTexture) {
      record.paint.addChild(rasterPart(record, record.containerTexture, node.props.appearance.sourceCanvas, node.props.appearance.background.layout));
      return;
    }
    record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
  }
  function drawScroll(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'ScrollView') return;
    clear(record.paint); clear(record.foreground);
    if (!node.props.appearance || !record.scrollTextures) {
      record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style)); return;
    }
    const appearance = node.props.appearance, values = presentation(record);
    record.paint.addChild(rasterPart(record, record.scrollTextures.viewport, appearance.sourceCanvas, appearance.viewport.layout));
    record.foreground.addChild(rasterPart(record, record.scrollTextures.scrollbarTrack, appearance.sourceCanvas, appearance.scrollbarTrack.layout));
    const amount = node.props.contentHeight <= node.layout.height ? 0 : Math.max(0, Math.min(1, (values.scrollY ?? node.props.scrollY) / (node.props.contentHeight - node.layout.height)));
    const scale = rasterScale(record, appearance.sourceCanvas), thumb = new Sprite(record.scrollTextures.scrollbarThumb);
    thumb.x = (appearance.scrollbarThumbPositions.min.x + (appearance.scrollbarThumbPositions.max.x - appearance.scrollbarThumbPositions.min.x) * amount) * scale.x;
    thumb.y = (appearance.scrollbarThumbPositions.min.y + (appearance.scrollbarThumbPositions.max.y - appearance.scrollbarThumbPositions.min.y) * amount) * scale.y;
    thumb.width = appearance.scrollbarThumbCanvas.width * scale.x; thumb.height = appearance.scrollbarThumbCanvas.height * scale.y;
    record.foreground.addChild(thumb);
  }
  function drawList(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'List') return;
    clear(record.paint);
    const appearance = node.props.appearance, textures = record.listTextures;
    if (appearance && textures) {
      const background = new Sprite(textures.background); background.width = node.layout.width; background.height = node.layout.height; record.paint.addChild(background);
    } else record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    const rows = addClip(record.paint, node.layout.width, node.layout.height);
    const values = presentation(record);
    const selection = values.listSelection ?? (node.props.selectedId === null ? -1 : node.props.items.findIndex(item => item.id === node.props.selectedId));
    const stagger = Math.max(0, Math.min(1, values.stagger ?? 1));
    node.props.items.forEach((item, index) => {
      const y = index * node.props.itemHeight;
      const row = new Container(); row.y = y; row.alpha = Math.max(0, Math.min(1, stagger * node.props.items.length - index)); rows.addChild(row);
      if (appearance && textures) {
        const base = new Sprite(textures.row); base.width = node.layout.width; base.height = node.props.itemHeight; row.addChild(base);
      } else row.addChild(new Graphics().rect(1, 0, node.layout.width - 2, node.props.itemHeight).fill({ color: '#FFFFFF' }));
      const selected = Math.max(0, Math.min(1, 1 - Math.abs(selection - index)));
      if (selected > 0) {
        if (appearance && textures) { const highlighted = new Sprite(textures.selectedRow); highlighted.width = node.layout.width; highlighted.height = node.props.itemHeight; highlighted.alpha = selected; row.addChild(highlighted); }
        else row.addChild(new Graphics().rect(1, 0, node.layout.width - 2, node.props.itemHeight).fill({ color: '#E3F1EC', alpha: selected }));
      }
      const labelLayout = appearance
        ? { x: appearance.labelLayout.x * node.layout.width / appearance.rowCanvas.width, y: appearance.labelLayout.y * node.props.itemHeight / appearance.rowCanvas.height, width: appearance.labelLayout.width * node.layout.width / appearance.rowCanvas.width, height: appearance.labelLayout.height * node.props.itemHeight / appearance.rowCanvas.height }
        : { x: 12, y: 0, width: node.layout.width - 24, height: node.props.itemHeight };
      const synthetic: TextNode = { id: `${node.id}.${item.id}`, type: 'Text', layout: labelLayout, props: { text: item.label, wrap: 'none', overflow: 'ellipsis', lineHeight: node.props.style.fontSize * 1.25, style: node.props.style } };
      const text = makeText(synthetic); text.x = labelLayout.x; text.y = labelLayout.y + Math.max(0, (labelLayout.height - text.height) / 2); row.addChild(text);
    });
  }
  function drawPanel(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'Panel' && node.type !== 'Dialog' && node.type !== 'Tabs') return;
    clear(record.paint); clear(record.foreground);
    if (node.type === 'Panel' && node.props.appearance && record.panelTextures) {
      const appearance = node.props.appearance;
      record.paint.addChild(rasterPart(record, record.panelTextures.background, appearance.sourceCanvas, appearance.background.layout));
      if (appearance.body && record.panelTextures.body) record.paint.addChild(rasterPart(record, record.panelTextures.body, appearance.sourceCanvas, appearance.body.layout));
      record.foreground.addChild(rasterPart(record, record.panelTextures.header, appearance.sourceCanvas, appearance.header.layout));
      const scale = rasterScale(record, appearance.sourceCanvas), title = appearance.titleLayout;
      label(record, node.props.title, title.x * scale.x, title.y * scale.y, title.width * scale.x, title.height * scale.y, undefined, record.foreground);
      return;
    }
    if (node.type === 'Dialog' && node.props.appearance && record.dialogTextures) {
      const appearance = node.props.appearance;
      record.paint.addChild(rasterPart(record, record.dialogTextures.background, appearance.sourceCanvas, appearance.background.layout));
      record.paint.addChild(rasterPart(record, record.dialogTextures.body, appearance.sourceCanvas, appearance.body.layout));
      record.foreground.addChild(rasterPart(record, record.dialogTextures.header, appearance.sourceCanvas, appearance.header.layout));
      const scale = rasterScale(record, appearance.sourceCanvas), title = appearance.titleLayout;
      label(record, node.props.title, title.x * scale.x, title.y * scale.y, title.width * scale.x, title.height * scale.y, undefined, record.foreground);
      return;
    }
    record.paint.addChild(drawBox(node.layout.width, node.layout.height, node.props.style));
    if (node.type === 'Panel' || node.type === 'Dialog') label(record, node.props.title, 14, 5, node.layout.width - 28, 30);
  }
  function drawTabs(record: RuntimeRecord): void {
    const node = record.node; if (node.type !== 'Tabs') return;
    drawPanel(record);
    const appearance = node.props.appearance, textures = record.tabsTextures;
    const headerHeight = appearance ? appearance.headerHeight * node.layout.height / appearance.sourceCanvas.height : 48, width = node.layout.width / node.props.tabs.length;
    node.props.tabs.forEach((tab, index) => {
      const selected = tab.id === node.props.activeId;
      if (appearance && textures) {
        const texture = selected ? textures.activeTab : textures.tab;
        const background = new Sprite(texture); background.x = index * width; background.width = width; background.height = headerHeight; record.foreground.addChild(background);
        const labelLayout = appearance.labelLayout;
        label(record, tab.label, index * width + labelLayout.x * width / appearance.tabCanvas.width, labelLayout.y * headerHeight / appearance.tabCanvas.height, labelLayout.width * width / appearance.tabCanvas.width, labelLayout.height * headerHeight / appearance.tabCanvas.height, undefined, record.foreground);
      } else {
        record.paint.addChild(new Graphics().rect(index * width, 0, width, headerHeight).fill({ color: selected ? '#E8F3EE' : '#FFFFFF' }).stroke({ color: node.props.style.borderColor, width: 1 }));
        label(record, tab.label, index * width + 5, 0, width - 10, headerHeight);
      }
    });
    const selected = Math.max(0, node.props.tabs.findIndex(tab => tab.id === node.props.activeId));
    const progress = Math.max(0, Math.min(1, presentation(record).tabProgress ?? 1));
    if (!appearance) record.paint.addChild(new Graphics().rect(selected * width, headerHeight - 3, width * progress, 3).fill({ color: node.props.style.borderColor }));
  }
  function syncDetachedDialog(record: RuntimeRecord): void {
    if (!record.dialogDetached || !record.logicalDialogTransform) return;
    // Keep the portal in the same world space as its logical parent. Use the
    // current global transforms rather than the render-pass cache: an ancestor
    // may have just moved through the legacy timeline or a ScrollView update.
    const world = record.displayParent.getGlobalTransform().append(record.logicalDialogTransform);
    const local = record.scope.modalLayer.getGlobalTransform().invert().append(world);
    record.view.setFromMatrix(local);
  }
  function syncDetachedDialogs(scope: MountedScope): void {
    for (const record of scope.records.values()) syncDetachedDialog(record);
  }
  function setLogicalDialogTransform(record: RuntimeRecord): void {
    record.logicalDialogTransform = new Matrix().setTransform(
      record.node.layout.x + (record.motion.x ?? 0), record.node.layout.y + (record.motion.y ?? 0),
      0, 0, record.motion.scaleX ?? 1, record.motion.scaleY ?? 1, record.motion.rotation ?? 0, 0, 0,
    );
    syncDetachedDialog(record);
  }
  function updateDialogBlocker(record: RuntimeRecord): void {
    const node = record.node;
    const needed = node.type === 'Dialog' && node.props.modal && (node.props.open || record.dialogClosing) && effectiveVisible(record);
    if (!needed) {
      if (record.dialogBlocker) { record.dialogBlocker.removeFromParent(); record.dialogBlocker.destroy(); record.dialogBlocker = undefined; }
      if (record.dialogDetached) {
        record.displayParent.addChild(record.view);
        record.view.setFromMatrix(record.logicalDialogTransform ?? new Matrix().setTransform(record.node.layout.x + (record.motion.x ?? 0), record.node.layout.y + (record.motion.y ?? 0), 0, 0, record.motion.scaleX ?? 1, record.motion.scaleY ?? 1, record.motion.rotation ?? 0, 0, 0));
        record.logicalDialogTransform = undefined;
        record.dialogDetached = false;
      }
      return;
    }
    if (!record.dialogBlocker) {
      const blocker = new Container();
      if (record.dialogTextures?.overlay) {
        const overlay = new Sprite(record.dialogTextures.overlay);
        overlay.width = record.scope.document.canvas.width; overlay.height = record.scope.document.canvas.height;
        blocker.addChild(overlay); record.dialogHasRasterOverlay = true;
      } else {
        blocker.addChild(new Graphics().rect(0, 0, record.scope.document.canvas.width, record.scope.document.canvas.height).fill({ color: '#10233F', alpha: 1 }));
        record.dialogHasRasterOverlay = false;
      }
      blocker.eventMode = 'static'; blocker.hitArea = new Rectangle(0, 0, record.scope.document.canvas.width, record.scope.document.canvas.height);
      record.scope.modalLayer.addChild(blocker); record.dialogBlocker = blocker;
    }
    if (!record.dialogDetached) {
      // The logical transform is our authoritative layout/timeline state. It
      // avoids taking a possibly stale cached local matrix while a Dialog is
      // first opened before a render pass.
      setLogicalDialogTransform(record);
      record.view.removeFromParent(); record.scope.modalLayer.addChild(record.view);
      record.dialogDetached = true; syncDetachedDialog(record);
    }
    record.scope.modalLayer.addChild(record.dialogBlocker!); record.scope.modalLayer.addChild(record.view);
    applyPresentation(record);
  }

  function buildScope(document: UiDocument, resources: TreeResources): MountedScope {
    const scope: MountedScope = { document, resources, holder: new Container(), modalLayer: new Container(), overlay: new Container(), records: new Map(), disposed: false };
    scope.holder.addChild(scope.modalLayer);
    let ordinal = 0;
    const build = (node: UiNode, parent: Container, modalScope?: string, parentRecord?: RuntimeRecord): RuntimeRecord => {
      const view = new Container(); view.position.set(node.layout.x, node.layout.y);
      const visual = new Container(); visual.pivot.set(node.layout.width / 2, node.layout.height / 2); visual.position.set(node.layout.width / 2, node.layout.height / 2);
      const paint = new Container(), foreground = new Container();
      // Foreground raster/text overlays never own input. Keeping them out of hit
      // testing makes the semantic node's explicit hit area authoritative.
      foreground.eventMode = 'none';
      visual.addChild(paint); view.addChild(visual); parent.addChild(view);
      const record: RuntimeRecord = { scope, node, view, visual, paint, foreground, displayParent: parent, order: ordinal++, childIds: [], parent: parentRecord, modalScope, cleanups: [], resourceReleases: [], userVisible: true, tabVisible: true, destroyed: false, popupClosing: false, dialogDetached: false, dialogClosing: false, motion: {}, presentation: {}, motionKeys: new Set() };
      scope.records.set(node.id, record); updateNodeAlpha(record);
      switch (node.type) {
        case 'Image': renderImage(record); break;
        case 'Text': drawTextNode(record); break;
        case 'Container':
          if (node.props.appearance) {
            const background = scope.resources.acquireImage(node.props.appearance.background.image);
            record.containerTexture = background.texture; record.resourceReleases.push(background.release);
          }
          record.redraw = () => drawContainer(record); record.redraw(); break;
        case 'Button':
          if (node.props.appearance) {
            const background = scope.resources.acquireImage(node.props.appearance.backgroundImage);
            record.buttonTexture = background.texture; record.resourceReleases.push(background.release);
          }
          record.redraw = () => drawButton(record); record.redraw();
          press(record, source => emit(record, 'activate', source));
          break;
        case 'Switch': case 'CheckBox':
          if (node.type === 'Switch' && node.props.appearance) {
            const track = scope.resources.acquireImage(node.props.appearance.trackImage);
            const thumb = scope.resources.acquireImage(node.props.appearance.thumbImage);
            record.toggleTextures = { track: track.texture, thumb: thumb.texture };
            record.resourceReleases.push(track.release, thumb.release);
          }
          if (node.type === 'CheckBox' && node.props.appearance) {
            const box = scope.resources.acquireImage(node.props.appearance.box.image), mark = scope.resources.acquireImage(node.props.appearance.mark.image);
            record.checkboxTextures = { box: box.texture, mark: mark.texture }; record.resourceReleases.push(box.release, mark.release);
          }
          record.redraw = () => drawToggle(record); record.redraw();
          press(record, source => { if (record.node.type === 'Switch' || record.node.type === 'CheckBox') {
            const keys = record.node.type === 'CheckBox' ? ['checked', 'checkAlpha', 'checkScale'] : ['checked'];
            preparePresentationChange(record, 'change', keys);
            record.node.props.checked = !record.node.props.checked; record.redraw!(); emit(record, 'change', source, record.node.props.checked);
          } });
          break;
        case 'RadioGroup':
          if (node.props.appearance) {
            record.radioTextures = new Map();
            for (const item of node.props.appearance.items) { const option = scope.resources.acquireImage(item.option.image), indicator = scope.resources.acquireImage(item.indicator.image); record.radioTextures.set(item.optionId, { option: option.texture, indicator: indicator.texture }); record.resourceReleases.push(option.release, indicator.release); }
          }
          record.redraw = () => drawChoices(record, 'radio'); record.redraw(); makeInteractive(record);
          bind(record, 'pointertap', event => {
            if (!interactive(record) || record.node.type !== 'RadioGroup') return;
            const point = event.getLocalPosition(record.view);
            let choice;
            if (record.node.props.appearance) {
              const scaleX = record.node.layout.width / record.node.props.appearance.sourceCanvas.width, scaleY = record.node.layout.height / record.node.props.appearance.sourceCanvas.height;
              const item = record.node.props.appearance.items.find(candidate => point.x >= candidate.hitArea.x * scaleX && point.x <= (candidate.hitArea.x + candidate.hitArea.width) * scaleX && point.y >= candidate.hitArea.y * scaleY && point.y <= (candidate.hitArea.y + candidate.hitArea.height) * scaleY);
              choice = item ? record.node.props.options.find(option => option.id === item.optionId) : undefined;
            } else {
              const row = record.node.layout.height / record.node.props.options.length, index = Math.min(record.node.props.options.length - 1, Math.max(0, Math.floor(point.y / row))); choice = record.node.props.options[index];
            }
            if (choice && record.node.props.selectedId !== choice.id) { preparePresentationChange(record, 'change', ['markerAlpha', 'markerY']); record.node.props.selectedId = choice.id; record.redraw!(); emit(record, 'change', sourceOf(event.pointerType), choice.id, choice.id); render(); }
          });
          break;
        case 'Input':
          if (node.props.appearance) { const background = scope.resources.acquireImage(node.props.appearance.backgroundImage); record.inputTexture = background.texture; record.resourceReleases.push(background.release); }
          record.redraw = () => drawInput(record); record.redraw();
          press(record, source => focusInput(record, source));
          break;
        case 'Select':
          if (node.props.appearance) {
            const field = scope.resources.acquireImage(node.props.appearance.fieldImage);
            const arrow = scope.resources.acquireImage(node.props.appearance.arrowImage);
            const popup = scope.resources.acquireImage(node.props.appearance.popupImage);
            record.selectTextures = { field: field.texture, arrow: arrow.texture, popup: popup.texture };
            record.resourceReleases.push(field.release, arrow.release, popup.release);
          }
          record.redraw = () => drawChoices(record, 'select'); record.redraw();
          press(record, () => toggleSelect(record));
          break;
        case 'ProgressBar':
          if (node.props.appearance) { const track = scope.resources.acquireImage(node.props.appearance.track.image), fill = scope.resources.acquireImage(node.props.appearance.fill.image); record.progressTextures = { track: track.texture, fill: fill.texture }; record.resourceReleases.push(track.release, fill.release); }
          record.redraw = () => drawProgress(record); record.redraw(); break;
        case 'Slider':
          if (node.props.appearance) { const track = scope.resources.acquireImage(node.props.appearance.track.image), fill = scope.resources.acquireImage(node.props.appearance.fill.image), thumb = scope.resources.acquireImage(node.props.appearance.thumbImage); record.sliderTextures = { track: track.texture, fill: fill.texture, thumb: thumb.texture }; record.resourceReleases.push(track.release, fill.release, thumb.release); }
          record.redraw = () => drawSlider(record); record.redraw(); makeInteractive(record);
          bind(record, 'pointerdown', event => beginSlider(record, event));
          break;
        case 'ScrollView':
          if (node.props.appearance) {
            const viewport = scope.resources.acquireImage(node.props.appearance.viewport.image);
            const scrollbarTrack = scope.resources.acquireImage(node.props.appearance.scrollbarTrack.image);
            const scrollbarThumb = scope.resources.acquireImage(node.props.appearance.scrollbarThumbImage);
            record.scrollTextures = { viewport: viewport.texture, scrollbarTrack: scrollbarTrack.texture, scrollbarThumb: scrollbarThumb.texture };
            record.resourceReleases.push(viewport.release, scrollbarTrack.release, scrollbarThumb.release);
          }
          record.redraw = () => drawScroll(record); record.redraw(); makeInteractive(record, 'grab');
          bind(record, 'pointerdown', event => beginScrollDrag(record, event));
          bindWheel(record, event => {
            if (!interactive(record) || record.node.type !== 'ScrollView') return;
            event.preventDefault(); preparePresentationChange(record, 'scroll', ['scrollX', 'scrollY']); record.node.props.scrollY = clampScroll(record.node.props.scrollY + event.deltaY, record.node.props.contentHeight, record.node.layout.height);
            record.node.props.scrollX = clampScroll(record.node.props.scrollX + event.deltaX, record.node.props.contentWidth, record.node.layout.width);
            record.redraw?.(); record.updateContentPosition?.(); emit(record, 'scroll', 'wheel', { x: record.node.props.scrollX, y: record.node.props.scrollY }); render();
          });
          break;
        case 'List':
          if (node.props.appearance) {
            const background = scope.resources.acquireImage(node.props.appearance.backgroundImage);
            const row = scope.resources.acquireImage(node.props.appearance.rowImage);
            const selectedRow = scope.resources.acquireImage(node.props.appearance.selectedRowImage);
            record.listTextures = { background: background.texture, row: row.texture, selectedRow: selectedRow.texture };
            record.resourceReleases.push(background.release, row.release, selectedRow.release);
          }
          record.redraw = () => drawList(record); record.redraw(); makeInteractive(record);
          bind(record, 'pointertap', event => {
            if (!interactive(record) || record.node.type !== 'List') return;
            const point = event.getLocalPosition(record.view);
            const index = Math.floor(point.y / record.node.props.itemHeight);
            const appearance = record.node.props.appearance;
            if (appearance) {
              const localX = point.x * appearance.rowCanvas.width / record.node.layout.width;
              const localY = (point.y - index * record.node.props.itemHeight) * appearance.rowCanvas.height / record.node.props.itemHeight;
              const hit = appearance.hitArea;
              if (localX < hit.x || localX > hit.x + hit.width || localY < hit.y || localY > hit.y + hit.height) return;
            }
            const item = record.node.props.items[index]; if (item && record.node.props.selectedId !== item.id) { preparePresentationChange(record, 'change', ['listSelection']); record.node.props.selectedId = item.id; record.redraw!(); emit(record, 'change', sourceOf(event.pointerType), item.id, item.id); render(); }
          });
          break;
        case 'Panel':
          if (node.props.appearance) {
            const background = scope.resources.acquireImage(node.props.appearance.background.image);
            const header = scope.resources.acquireImage(node.props.appearance.header.image);
            const body = node.props.appearance.body ? scope.resources.acquireImage(node.props.appearance.body.image) : undefined;
            record.panelTextures = { background: background.texture, header: header.texture, body: body?.texture };
            record.resourceReleases.push(background.release, header.release); if (body) record.resourceReleases.push(body.release);
          }
          record.redraw = () => drawPanel(record); record.redraw(); break;
        case 'Dialog':
          if (node.props.appearance) {
            const background = scope.resources.acquireImage(node.props.appearance.background.image);
            const header = scope.resources.acquireImage(node.props.appearance.header.image);
            const body = scope.resources.acquireImage(node.props.appearance.body.image);
            const overlay = node.props.appearance.overlayImage ? scope.resources.acquireImage(node.props.appearance.overlayImage) : undefined;
            record.dialogTextures = { background: background.texture, header: header.texture, body: body.texture, overlay: overlay?.texture };
            record.resourceReleases.push(background.release, header.release, body.release); if (overlay) record.resourceReleases.push(overlay.release);
          }
          record.redraw = () => { drawPanel(record); updateDialogBlocker(record); }; record.redraw();
          break;
        case 'Tabs':
          if (node.props.appearance) {
            const tab = scope.resources.acquireImage(node.props.appearance.tabImage);
            const activeTab = scope.resources.acquireImage(node.props.appearance.activeTabImage);
            record.tabsTextures = { tab: tab.texture, activeTab: activeTab.texture }; record.resourceReleases.push(tab.release, activeTab.release);
          }
          record.redraw = () => drawTabs(record); record.redraw(); makeInteractive(record);
          bind(record, 'pointertap', event => {
            if (!interactive(record) || record.node.type !== 'Tabs') return;
            const point = event.getLocalPosition(record.view);
            const appearance = record.node.props.appearance;
            const headerHeight = appearance ? appearance.headerHeight * record.node.layout.height / appearance.sourceCanvas.height : 48;
            if (point.y > headerHeight) return;
            const index = Math.min(record.node.props.tabs.length - 1, Math.max(0, Math.floor(point.x / (record.node.layout.width / record.node.props.tabs.length))));
            if (appearance) {
              const tabWidth = record.node.layout.width / record.node.props.tabs.length;
              const localX = (point.x - index * tabWidth) * appearance.tabCanvas.width / tabWidth;
              const localY = point.y * appearance.tabCanvas.height / headerHeight;
              const hit = appearance.hitArea;
              if (localX < hit.x || localX > hit.x + hit.width || localY < hit.y || localY > hit.y + hit.height) return;
            }
            const tab = record.node.props.tabs[index]; if (record.node.props.activeId !== tab.id) { preparePresentationChange(record, 'change', ['tabProgress']); record.node.props.activeId = tab.id; record.redraw!(); record.updateTabs?.(); emit(record, 'change', sourceOf(event.pointerType), tab.id, tab.id); render(); }
          });
          break;
      }
      if (isComposite(node)) {
        let childParent = visual;
        if (node.type === 'ScrollView') {
          const appearance = node.props.appearance;
          const scale = appearance ? rasterScale(record, appearance.sourceCanvas) : undefined;
          const clipped = addClip(visual, appearance ? appearance.viewport.layout.width * scale!.x : node.layout.width, appearance ? appearance.viewport.layout.height * scale!.y : node.layout.height);
          if (appearance) clipped.position.set(appearance.viewport.layout.x * scale!.x, appearance.viewport.layout.y * scale!.y);
          const content = new Container(); clipped.addChild(content); childParent = content;
          record.updateContentPosition = () => {
            const values = presentation(record); content.position.set(-(values.scrollX ?? node.props.scrollX), -(values.scrollY ?? node.props.scrollY));
            syncDetachedDialogs(scope); positionOpenPopup(scope);
          };
          record.updateContentPosition();
        }
        const childModalScope = node.type === 'Dialog' && node.props.modal ? node.id : modalScope;
        for (const child of node.children) {
          const built = build(child, childParent, childModalScope, record); record.childIds.push(built.node.id);
        }
        if (node.type === 'Tabs') {
          record.updateTabs = () => {
            if (record.node.type !== 'Tabs') return;
            for (const tab of record.node.props.tabs) {
              const child = scope.records.get(tab.contentId); if (!child) continue;
              child.tabVisible = tab.id === record.node.props.activeId; refreshVisibility(child);
            }
            if (openSelect?.scope === scope && !effectiveVisible(openSelect)) closePopup(openSelect, undefined, true);
          };
          record.updateTabs();
        }
      }
      visual.addChild(foreground);
      applyPresentation(record);
      return record;
    };
    try {
      scope.root = build(document.root, scope.holder);
      // Keep transient Select menus outside the tree root. A Select's own
      // hitArea covers only its base rectangle, which must not cull menu rows.
      scope.holder.addChild(scope.modalLayer); scope.holder.addChild(scope.overlay);
      // Initial Dialog.open and the inactive Tabs pages have the same visibility
      // semantics as their later mutations; Pixi views default to visible.
      refreshVisibility(scope.root);
      return scope;
    } catch (error) {
      // A text overflow or display-object failure can happen halfway through a
      // detached candidate. Release that partial candidate before propagating it.
      disposeScope(scope, false);
      throw error;
    }
  }

  function disposeScope(scope: MountedScope, emitDestroy: boolean): void {
    if (scope.disposed) return;
    scope.disposed = true;
    const cleanupErrors: unknown[] = [];
    const records = [...scope.records.values()].sort((a, b) => b.order - a.order);
    for (const record of records) destroyRecord(record, emitDestroy, cleanupErrors);
    captureCleanup(cleanupErrors, () => scope.holder.removeFromParent());
    captureCleanup(cleanupErrors, () => scope.holder.destroy({ children: true }));
    scope.resources.destroy(cleanupErrors); scope.records.clear();
    reportCleanupErrors(cleanupErrors);
  }
  function destroyRecord(record: RuntimeRecord, shouldEmit: boolean, cleanupErrors: unknown[]): void {
    if (record.destroyed) return;
    cancelRecordPresentation(record);
    record.destroyed = true;
    // A direct destroyNode call must release descendants before Pixi destroys their display objects.
    for (const childId of [...record.childIds]) {
      const child = record.scope.records.get(childId);
      if (child) destroyRecord(child, shouldEmit, cleanupErrors);
    }
    closePopup(record, cleanupErrors);
    if (record.dialogBlocker) captureCleanup(cleanupErrors, () => { record.dialogBlocker?.removeFromParent(); record.dialogBlocker?.destroy(); record.dialogBlocker = undefined; });
    for (const [pointerId, gesture] of [...gestures]) if (gesture.record === record) { gestures.delete(pointerId); captureCleanup(cleanupErrors, () => gesture.cancel('destroy', 'control')); }
    if (focusedInput === record) { focusedInput = undefined; captureCleanup(cleanupErrors, () => editor.blur()); }
    for (const cleanup of record.cleanups.splice(0)) captureCleanup(cleanupErrors, cleanup);
    for (const release of record.resourceReleases.splice(0)) captureCleanup(cleanupErrors, release);
    captureCleanup(cleanupErrors, () => record.view.removeFromParent());
    captureCleanup(cleanupErrors, () => record.view.destroy({ children: true }));
    record.scope.records.delete(record.node.id);
    if (shouldEmit) emit(record, 'destroy', 'control');
  }

  function requireRecord(id: string): RuntimeRecord {
    assertAlive(); const record = active?.records.get(id);
    if (!record || record.destroyed) throw new Error(`UNKNOWN_NODE: ${id}`);
    return record;
  }
  function removeFromDocument(record: RuntimeRecord): void {
    const parent = record.parent;
    if (!parent || !isComposite(parent.node)) throw new Error(`DOCUMENT_PARENT_MISSING: ${record.node.id}`);
    const candidate = structuredClone(record.scope.document);
    const candidateParent = walkNodes(candidate).find(node => node.id === parent.node.id);
    if (!candidateParent || !isComposite(candidateParent)) throw new Error(`DOCUMENT_PARENT_MISSING: ${record.node.id}`);
    const candidateIndex = candidateParent.children.findIndex(node => node.id === record.node.id);
    if (candidateIndex < 0) throw new Error(`DOCUMENT_NODE_MISSING: ${record.node.id}`);
    candidateParent.children.splice(candidateIndex, 1);
    // Tabs content references and every other structural invariant are checked before
    // changing the live document or releasing a single display/resource record.
    validateDocument(candidate);
    const liveIndex = parent.node.children.findIndex(node => node.id === record.node.id);
    if (liveIndex < 0) throw new Error(`DOCUMENT_NODE_MISSING: ${record.node.id}`);
    parent.node.children.splice(liveIndex, 1);
    const childIndex = parent.childIds.indexOf(record.node.id);
    if (childIndex >= 0) parent.childIds.splice(childIndex, 1);
  }
  function sliderFromPoint(record: RuntimeRecord, point: { x: number; y: number }): number {
    const node = record.node; if (node.type !== 'Slider') throw new Error('NOT_SLIDER');
    // View space remains the logical hit/layout space. This works for rotation,
    // legacy transforms, and presentation transforms without changing the drag contract.
    const local = record.view.toLocal({ x: point.x * zoom, y: point.y * zoom });
    let ratio: number;
    if (node.props.appearance) {
      const appearance = node.props.appearance, scaleX = node.layout.width / appearance.sourceCanvas.width, scaleY = node.layout.height / appearance.sourceCanvas.height;
      const start = { x: (appearance.thumbPositions.min.x + appearance.thumbCanvas.width / 2) * scaleX, y: (appearance.thumbPositions.min.y + appearance.thumbCanvas.height / 2) * scaleY };
      const end = { x: (appearance.thumbPositions.max.x + appearance.thumbCanvas.width / 2) * scaleX, y: (appearance.thumbPositions.max.y + appearance.thumbCanvas.height / 2) * scaleY };
      const dx = end.x - start.x, dy = end.y - start.y, length = dx * dx + dy * dy;
      ratio = Math.max(0, Math.min(1, length === 0 ? 0 : ((local.x - start.x) * dx + (local.y - start.y) * dy) / length));
    } else ratio = Math.max(0, Math.min(1, (local.x - 14) / Math.max(1, node.layout.width - 28)));
    return snapSlider(node.props.min + ratio * (node.props.max - node.props.min), node.props.min, node.props.max, node.props.step);
  }
  function beginSlider(record: RuntimeRecord, event: FederatedPointerEvent): void {
    if (!interactive(record) || record.node.type !== 'Slider' || event.button !== 0 || !event.isPrimary || gestures.has(event.pointerId)) return;
    if (openSelect) closePopup(openSelect);
    const origin = record.node.props.value;
    const assign = (value: number) => { record.sliderPreview = value; record.presentation.sliderValue = value; record.redraw?.(); render(); };
    assign(sliderFromPoint(record, canvasPoint(event.nativeEvent as PointerEvent)));
    gestures.set(event.pointerId, {
      record,
      move: point => assign(sliderFromPoint(record, point)),
      end: (_inside, source) => {
        if (gestures.get(event.pointerId)?.record !== record || record.node.type !== 'Slider') return;
        gestures.delete(event.pointerId); const committed = record.sliderPreview ?? origin; record.sliderPreview = undefined;
        if (record.node.props.value !== committed) { record.node.props.value = committed; emit(record, 'change', source, committed); }
        record.redraw?.(); render();
      },
      cancel: () => {
        if (gestures.get(event.pointerId)?.record !== record || record.node.type !== 'Slider') return;
        gestures.delete(event.pointerId); record.sliderPreview = undefined; cancelRecordPresentation(record); record.redraw?.(); render();
      },
    });
  }
  function beginScrollDrag(record: RuntimeRecord, event: FederatedPointerEvent): void {
    if (!interactive(record) || record.node.type !== 'ScrollView' || event.button !== 0 || !event.isPrimary || gestures.has(event.pointerId)) return;
    if (openSelect) closePopup(openSelect);
    canvas.focus({ preventScroll: true });
    event.preventDefault();

    const node = record.node;
    const startCanvas = canvasPoint(event.nativeEvent as PointerEvent);
    const start = record.view.toLocal({ x: startCanvas.x * zoom, y: startCanvas.y * zoom });
    const origin = { x: node.props.scrollX, y: node.props.scrollY };
    const maxScrollY = Math.max(0, node.props.contentHeight - node.layout.height);
    let thumbTravelY = 0;
    let draggingThumb = false;
    if (node.props.appearance) {
      const appearance = node.props.appearance, scale = rasterScale(record, appearance.sourceCanvas);
      const amount = maxScrollY === 0 ? 0 : origin.y / maxScrollY;
      const thumbX = (appearance.scrollbarThumbPositions.min.x + (appearance.scrollbarThumbPositions.max.x - appearance.scrollbarThumbPositions.min.x) * amount) * scale.x;
      const thumbY = (appearance.scrollbarThumbPositions.min.y + (appearance.scrollbarThumbPositions.max.y - appearance.scrollbarThumbPositions.min.y) * amount) * scale.y;
      const thumbWidth = appearance.scrollbarThumbCanvas.width * scale.x, thumbHeight = appearance.scrollbarThumbCanvas.height * scale.y;
      const hitPadding = 4;
      draggingThumb = start.x >= thumbX - hitPadding && start.x <= thumbX + thumbWidth + hitPadding
        && start.y >= thumbY - hitPadding && start.y <= thumbY + thumbHeight + hitPadding;
      thumbTravelY = (appearance.scrollbarThumbPositions.max.y - appearance.scrollbarThumbPositions.min.y) * scale.y;
    }
    const motionKey = `motion.n${record.order}.scroll`;
    animator.cancel(motionKey); record.motionKeys.delete(motionKey);
    record.view.cursor = 'grabbing';

    const assign = (point: { x: number; y: number }): void => {
      const local = record.view.toLocal({ x: point.x * zoom, y: point.y * zoom });
      const x = draggingThumb ? origin.x : clampScroll(origin.x - (local.x - start.x), node.props.contentWidth, node.layout.width);
      const y = draggingThumb
        ? clampScroll(origin.y + (thumbTravelY === 0 ? 0 : (local.y - start.y) * maxScrollY / thumbTravelY), node.props.contentHeight, node.layout.height)
        : clampScroll(origin.y - (local.y - start.y), node.props.contentHeight, node.layout.height);
      node.props.scrollX = x; node.props.scrollY = y;
      record.presentation.scrollX = x; record.presentation.scrollY = y;
      record.redraw?.(); record.updateContentPosition?.(); render();
    };
    const finish = (restore: boolean, source: RuntimeInputSource): void => {
      if (restore) { node.props.scrollX = origin.x; node.props.scrollY = origin.y; }
      delete record.presentation.scrollX; delete record.presentation.scrollY;
      record.view.cursor = 'grab';
      record.redraw?.(); record.updateContentPosition?.();
      if (restore) emit(record, 'cancel', source);
      else if (node.props.scrollX !== origin.x || node.props.scrollY !== origin.y) emit(record, 'scroll', source, { x: node.props.scrollX, y: node.props.scrollY });
      render();
    };
    gestures.set(event.pointerId, {
      record,
      move: assign,
      end: (_inside, source) => {
        if (gestures.get(event.pointerId)?.record !== record || record.node.type !== 'ScrollView') return;
        gestures.delete(event.pointerId); finish(false, source);
      },
      cancel: (_reason, source) => {
        if (gestures.get(event.pointerId)?.record !== record || record.node.type !== 'ScrollView') return;
        gestures.delete(event.pointerId); finish(true, source);
      },
    });
  }
  function focusInput(record: RuntimeRecord, source: RuntimeInputSource): void {
    if (!interactive(record) || record.node.type !== 'Input') return;
    if (focusedInput && focusedInput !== record) blurInput(focusedInput, source);
    focusedInput = record; editor.type = record.node.props.inputType; editor.maxLength = record.node.props.maxLength; editor.value = record.node.props.value;
    editor.readOnly = record.node.props.readOnly; editor.focus({ preventScroll: true }); emit(record, 'focus', source);
  }
  function blurInput(record: RuntimeRecord, source: RuntimeInputSource): void {
    if (focusedInput !== record) return;
    focusedInput = undefined;
    if (document.activeElement === editor) editor.blur();
    emit(record, 'blur', source); render();
  }
  function toggleSelect(record: RuntimeRecord): void {
    const node = record.node;
    if (!interactive(record) || node.type !== 'Select') return;
    if (openSelect === record) { closePopup(record); render(); return; }
    if (openSelect) closePopup(openSelect);
    const popup = new Container(); popup.eventMode = 'passive';
    const popupHeight = node.props.appearance
      ? node.layout.width * node.props.appearance.popupCanvas.height / node.props.appearance.popupCanvas.width
      : Math.max(32, node.layout.height) * node.props.options.length;
    const rowHeight = popupHeight / node.props.options.length;
    if (node.props.appearance && record.selectTextures) {
      const background = new Sprite(record.selectTextures.popup);
      background.width = node.layout.width; background.height = popupHeight; popup.addChild(background);
    }
    node.props.options.forEach((option, index) => {
      const row = new Container(); row.y = index * rowHeight; row.eventMode = 'static'; row.cursor = 'pointer'; row.hitArea = new Rectangle(0, 0, node.layout.width, rowHeight);
      if (!node.props.appearance) row.addChild(drawBox(node.layout.width, rowHeight, node.props.style, option.id === node.props.selectedId ? '#E3F1EC' : '#FFFFFF'));
      else if (option.id === node.props.selectedId) row.addChild(new Graphics().roundRect(8, 6, node.layout.width - 16, rowHeight - 12, Math.min(12, rowHeight / 4)).fill({ color: '#6B8F3A', alpha: 0.14 }));
      const synthetic: TextNode = { id: `${node.id}.${option.id}`, type: 'Text', layout: { x: 10, y: 0, width: node.layout.width - 20, height: rowHeight }, props: { text: option.label, wrap: 'none', overflow: 'ellipsis', lineHeight: node.props.style.fontSize * 1.25, style: node.props.style } };
      const item = makeText(synthetic); item.x = 10; item.y = Math.max(0, (rowHeight - item.height) / 2); row.addChild(item);
      const choose = (event: FederatedPointerEvent) => {
        try {
          if (!interactive(record) || node.props.selectedId !== option.id) {
            if (!interactive(record)) return;
            node.props.selectedId = option.id; record.redraw?.(); emit(record, 'change', sourceOf(event.pointerType), option.id, option.id);
          }
          closePopup(record); render();
        } catch (error) { reportFatal(error); }
      };
      // The popup owns its row listeners. Its destroy call clears them on every
      // close, so repeated opening cannot retain callbacks on the Select record.
      row.on('pointertap', choose); popup.addChild(row);
    });
    record.scope.overlay.addChild(popup); record.popup = popup; record.popupClosing = false; openSelect = record;
    if (hasAction(record, 'open')) record.presentation.popupOpen = 0;
    positionPopup(record); runSystemAction(record, 'open'); emit(record, 'open', 'control'); render();
  }

  /** Dispatches only actions explicitly bound in the installed system. */
  function runSystemAction(record: RuntimeRecord, action: MotionAction, activeState = true, strict = false): boolean {
    if (!hasAction(record, action)) {
      if (strict) throw new Error(`MOTION_ACTION_NOT_BOUND: ${record.node.id}:${action}`);
      return false;
    }
    const profile = getMotionStyle(motionStyle!);
    const values = presentation(record);
    const boundedEasing = profile.easing === 'spring' ? 'ease-out' : profile.easing;
    const one = (channel: string, from: Record<string, number>, to: Record<string, number>, duration: number, easing = profile.easing, complete?: () => void): void => {
      if (duration <= 0) { Object.assign(record.presentation, to); refreshPresentation(record); complete?.(); return; }
      animatePresentation(record, channel, from, [{ to, duration, easing }], complete);
    };
    const revealChildren = (): void => {
      for (const [index, childId] of record.childIds.entries()) {
        const child = record.scope.records.get(childId); if (!child || child.destroyed) continue;
        const childValues = presentation(child);
        const entryRunning = child.motionKeys.has(`motion.n${child.order}.entry`);
        const from = !entryRunning ? { entryAlpha: 0, entryY: profile.enterOffsetY, entryScale: profile.enterScale }
          : { entryAlpha: childValues.entryAlpha ?? 0, entryY: childValues.entryY ?? profile.enterOffsetY, entryScale: childValues.entryScale ?? profile.enterScale };
        const steps: Array<{ to: Record<string, number>; duration: number; easing: ReturnType<typeof getMotionStyle>['easing'] }> = [];
        if (index > 0) steps.push({ to: from, duration: index * profile.staggerMs, easing: 'linear' });
        steps.push({ to: { entryAlpha: 1, entryY: 0, entryScale: 1 }, duration: profile.enterMs, easing: boundedEasing });
        animatePresentation(child, 'entry', from, steps);
      }
    };
    switch (action) {
      case 'press': {
        const from = { pressScale: values.pressScale ?? 1 };
        if (activeState) one('press', from, { pressScale: profile.pressScale }, profile.pressMs, 'ease-out');
        else {
          const steps: Array<{ to: Record<string, number>; duration: number; easing: ReturnType<typeof getMotionStyle>['easing'] }> = [];
          if (profile.releasePeak !== 1) steps.push({ to: { pressScale: profile.releasePeak }, duration: profile.releasePeakMs, easing: 'ease-out' });
          steps.push({ to: { pressScale: 1 }, duration: profile.releasePeak === 1 ? profile.releasePeakMs : profile.releaseSettleMs, easing: profile.releasePeak === 1 ? 'ease-out' : profile.easing });
          animatePresentation(record, 'press', from, steps);
        }
        return true;
      }
      case 'hover':
        one('hover', { hoverScale: values.hoverScale ?? 1 }, { hoverScale: activeState ? profile.hoverScale : 1 }, profile.hoverMs, boundedEasing); return true;
      case 'focus':
        one('focus', { focus: values.focus ?? 0 }, { focus: activeState ? 1 : 0 }, profile.focusMs, boundedEasing); return true;
      case 'enter':
        one('entry', !record.motionKeys.has(`motion.n${record.order}.entry`) ? { entryAlpha: 0, entryY: profile.enterOffsetY, entryScale: profile.enterScale } : { entryAlpha: values.entryAlpha ?? 0, entryY: values.entryY ?? profile.enterOffsetY, entryScale: values.entryScale ?? profile.enterScale }, { entryAlpha: 1, entryY: 0, entryScale: 1 }, profile.enterMs, boundedEasing);
        if (record.node.type === 'Container' || record.node.type === 'Panel') revealChildren();
        return true;
      case 'exit':
        one('entry', { entryAlpha: values.entryAlpha ?? 1, entryY: values.entryY ?? 0, entryScale: values.entryScale ?? 1 }, { entryAlpha: 0, entryY: -profile.enterOffsetY / 2, entryScale: profile.enterScale }, profile.exitMs, boundedEasing);
        if (record.node.type === 'Container' || record.node.type === 'Panel') {
          for (const childId of record.childIds) {
            const child = record.scope.records.get(childId); if (!child || child.destroyed) continue;
            const childValues = presentation(child);
            animatePresentation(child, 'entry', { entryAlpha: childValues.entryAlpha ?? 1, entryY: childValues.entryY ?? 0, entryScale: childValues.entryScale ?? 1 }, [{ to: { entryAlpha: 0, entryY: -profile.enterOffsetY / 2, entryScale: profile.enterScale }, duration: profile.exitMs, easing: boundedEasing }]);
          }
        }
        return true;
      case 'emphasis':
        animatePresentation(record, 'emphasis', { emphasisScale: values.emphasisScale ?? 1 }, [
          { to: { emphasisScale: profile.releasePeak === 1 ? profile.pressScale : profile.releasePeak }, duration: profile.releasePeakMs, easing: 'ease-out' },
          { to: { emphasisScale: 1 }, duration: Math.max(1, profile.releaseSettleMs || profile.releasePeakMs), easing: boundedEasing },
        ]);
        return true;
      case 'change': {
        if (record.node.type === 'Switch') one('checked', { checked: values.checked ?? 0 }, { checked: record.node.props.checked ? 1 : 0 }, profile.changeMs, boundedEasing);
        else if (record.node.type === 'CheckBox') one('checked', { checked: values.checked ?? 0, checkAlpha: values.checkAlpha ?? 0, checkScale: values.checkScale ?? 1 }, { checked: record.node.props.checked ? 1 : 0, checkAlpha: record.node.props.checked ? 1 : 0, checkScale: 1 }, profile.changeMs, boundedEasing);
        else if (record.node.type === 'RadioGroup') {
          const row = record.node.layout.height / record.node.props.options.length;
          const selectedId = record.node.props.selectedId;
          const index = Math.max(0, record.node.props.options.findIndex(option => option.id === selectedId));
          const item = record.node.props.appearance?.items[index], targetY = item ? (item.indicator.layout.y + item.indicator.layout.height / 2) * record.node.layout.height / record.node.props.appearance!.sourceCanvas.height : index * row + row / 2;
          one('marker', { markerAlpha: values.markerAlpha ?? 0, markerY: values.markerY ?? (item ? targetY : row / 2) }, { markerAlpha: selectedId === null ? 0 : 1, markerY: targetY }, profile.changeMs, boundedEasing);
        } else if (record.node.type === 'Select') {
          animatePresentation(record, 'selection', { selectionFlash: 0 }, [{ to: { selectionFlash: 1 }, duration: Math.max(1, profile.changeMs / 2), easing: boundedEasing }, { to: { selectionFlash: 0 }, duration: Math.max(1, profile.changeMs / 2), easing: boundedEasing }]);
        } else if (record.node.type === 'List') {
          const selectedId = record.node.props.selectedId;
          const target = selectedId === null ? -1 : record.node.props.items.findIndex(item => item.id === selectedId);
          one('selection', { listSelection: values.listSelection ?? -1 }, { listSelection: target }, profile.changeMs, boundedEasing);
        } else if (record.node.type === 'Tabs') {
          one('tabs', { tabProgress: 0 }, { tabProgress: 1 }, profile.changeMs, boundedEasing);
          const activeId = record.node.props.activeId;
          const tab = record.node.props.tabs.find(item => item.id === activeId);
          const content = tab ? record.scope.records.get(tab.contentId) : undefined;
          if (content && !content.destroyed) {
            animatePresentation(content, 'entry', { entryAlpha: 0, entryY: profile.enterOffsetY / 2, entryScale: 1 }, [{ to: { entryAlpha: 1, entryY: 0, entryScale: 1 }, duration: profile.changeMs, easing: boundedEasing }]);
          }
        }
        return true;
      }
      case 'progress':
        if (record.node.type === 'ProgressBar') one('progress', { progress: values.progress ?? 0 }, { progress: record.node.props.value / record.node.props.max }, profile.changeMs, boundedEasing);
        else if (record.node.type === 'Slider') one('slider', { sliderValue: values.sliderValue ?? record.node.props.value }, { sliderValue: record.sliderPreview ?? record.node.props.value }, profile.changeMs, boundedEasing);
        return true;
      case 'scroll':
        if (record.node.type === 'ScrollView') one('scroll', { scrollX: values.scrollX ?? 0, scrollY: values.scrollY ?? 0 }, { scrollX: record.node.props.scrollX, scrollY: record.node.props.scrollY }, profile.scrollMs, boundedEasing);
        return true;
      case 'open':
        if (record.node.type === 'Select') one('popup', { popupOpen: values.popupOpen ?? 0 }, { popupOpen: 1 }, profile.enterMs, boundedEasing);
        else if (record.node.type === 'Dialog') one('dialog', { dialogScale: values.dialogScale ?? profile.enterScale, dialogAlpha: values.dialogAlpha ?? 0 }, { dialogScale: 1, dialogAlpha: 1 }, profile.enterMs, boundedEasing);
        return true;
      case 'close':
        if (record.node.type === 'Select') {
          one('popup', { popupOpen: values.popupOpen ?? (record.popup ? 1 : 0) }, { popupOpen: 0 }, profile.exitMs, boundedEasing);
          return true;
        }
        if (record.node.type === 'Dialog') one('dialog', { dialogScale: values.dialogScale ?? 1, dialogAlpha: values.dialogAlpha ?? 1 }, { dialogScale: profile.enterScale, dialogAlpha: 0 }, profile.exitMs, boundedEasing, () => {
          if (record.dialogClosing) { record.dialogClosing = false; updateDialogBlocker(record); refreshVisibility(record); render(); }
        });
        return true;
      case 'stagger':
        one('entry', record.motionKeys.has(`motion.n${record.order}.entry`) ? { entryAlpha: values.entryAlpha ?? 0, entryY: values.entryY ?? profile.enterOffsetY, entryScale: values.entryScale ?? profile.enterScale } : { entryAlpha: 0, entryY: profile.enterOffsetY, entryScale: profile.enterScale }, { entryAlpha: 1, entryY: 0, entryScale: 1 }, profile.enterMs, boundedEasing);
        one('stagger', record.motionKeys.has(`motion.n${record.order}.stagger`) ? { stagger: values.stagger ?? 0 } : { stagger: 0 }, { stagger: 1 }, Math.max(profile.enterMs, record.childIds.length * profile.staggerMs), boundedEasing);
        revealChildren(); return true;
    }
  }

  listen(window, 'pointermove', ((event: PointerEvent) => {
    const gesture = gestures.get(event.pointerId); if (!gesture?.move) return;
    try {
      event.preventDefault(); gesture.move(canvasPoint(event));
    }
    catch (error) { reportFatal(error); }
  }) as EventListener, true);
  listen(window, 'pointerup', ((event: PointerEvent) => {
    const gesture = gestures.get(event.pointerId); if (!gesture) return;
    try { gesture.end(contains(gesture.record, canvasPoint(event)), sourceOf(event.pointerType)); } catch (error) { reportFatal(error); }
  }) as EventListener, true);
  listen(window, 'pointercancel', ((event: PointerEvent) => {
    const gesture = gestures.get(event.pointerId);
    if (!gesture) return;
    try { gesture.cancel('pointercancel', sourceOf(event.pointerType)); } catch (error) { reportFatal(error); }
  }) as EventListener, true);
  listen(window, 'blur', () => { cancelGestures('blur'); if (openSelect) { closePopup(openSelect, undefined, true); render(); } });
  listen(document, 'visibilitychange', () => {
    if (!document.hidden) return;
    cancelGestures('hidden');
    if (openSelect) { closePopup(openSelect, undefined, true); render(); }
  });
  listen(window, 'keydown', ((event: KeyboardEvent) => { if (event.key === 'Escape') cancelGestures('Escape', 'keyboard'); }) as EventListener);
  listen(editor, 'input', () => {
    const record = focusedInput; if (!record || record.node.type !== 'Input' || record.node.props.readOnly || !interactive(record)) return;
    const next = editor.value.slice(0, record.node.props.maxLength);
    if (next !== record.node.props.value) { record.node.props.value = next; record.redraw?.(); emit(record, 'change', 'keyboard', next); render(); }
  });
  listen(editor, 'blur', () => { if (focusedInput) blurInput(focusedInput, 'keyboard'); });
  const contextLost = (event: Event) => {
    event.preventDefault();
    const cleanupErrors: unknown[] = [];
    cancelGestures('contextlost', 'control', cleanupErrors);
    const prior = active; active = undefined;
    if (prior) disposeScope(prior, true);
    reportCleanupErrors(cleanupErrors); reportFatal(new Error('WEBGL_CONTEXT_LOST'));
  };
  listen(canvas, 'webglcontextlost', contextLost);

  return {
    canvas,
    async load(input, signal, resolver: ImageResolver = (source, currentSignal) => loadImage(source, currentSignal, '$.root'), fontResolver: FontResolver = defaultFontResolver): Promise<void> {
      assertAlive(); signal.throwIfAborted();
      const document = validateDocument(input);
      const generation = ++loadGeneration;
      const controller = new AbortController(); controllers.add(controller);
      const combined = AbortSignal.any([signal, controller.signal]);
      const current = (): void => { if (destroyed || generation !== loadGeneration) throw new DOMException('stale tree load', 'AbortError'); };
      const resources = new TreeResources(); let candidate: MountedScope | undefined;
      try {
        await resources.prepare(document, combined, resolver, fontResolver, current); current(); combined.throwIfAborted();
        candidate = buildScope(document, resources); current(); combined.throwIfAborted();
        const prior = active;
        if (prior) { animator.cancelAll(); motionSystem = null; motionStyle = null; }
        stage.addChild(candidate.holder); active = candidate;
        stage.scale.set(zoom); app.renderer.resize(document.canvas.width * zoom, document.canvas.height * zoom);
        if (prior) disposeScope(prior, true);
        render();
      } catch (error) {
        // Stop sibling resolver work before releasing the scope. Each resolver
        // continuation also checks the disposed scope before creating a texture.
        const cleanupErrors: unknown[] = [];
        captureCleanup(cleanupErrors, () => controller.abort(error));
        if (candidate) disposeScope(candidate, false); else resources.destroy(cleanupErrors);
        reportCleanupErrors(cleanupErrors);
        throw error;
      } finally { controllers.delete(controller); }
    },
    subscribe(listener) { assertAlive(); listeners.add(listener); return () => listeners.delete(listener); },
    inspect(): TreeInspection {
      assertAlive();
      const scope = active;
      return {
        instances: scope ? 1 : 0, externalListeners, resources: scope?.resources.count() ?? 0,
        nodes: scope ? [...scope.records.values()].sort((a, b) => a.order - b.order).map(record => ({ id: record.node.id, type: record.node.type, bounds: inspectionBounds(record), visible: effectiveVisible(record), enabled: enabledOf(record.node), value: inspectValue(record.node) })) : [],
      };
    },
    getDocument(): UiDocument { assertAlive(); if (!active) throw new Error('TREE_NOT_LOADED'); return cloneForSnapshot(active.document); },
    setValue(id, value): void {
      const record = requireRecord(id); const node = record.node;
      if (node.type === 'Switch' || node.type === 'CheckBox') {
        if (typeof value !== 'boolean') throw new TypeError('BOOLEAN_VALUE_REQUIRED'); preparePresentationChange(record, 'change', node.type === 'CheckBox' ? ['checked', 'checkAlpha', 'checkScale'] : ['checked']); node.props.checked = value; record.redraw?.(); emit(record, 'change', 'control', value);
      } else if (node.type === 'Input') {
        if (typeof value !== 'string' || value.length > node.props.maxLength) throw new TypeError('INPUT_VALUE_INVALID');
        node.props.value = value; if (focusedInput === record) editor.value = value; record.redraw?.(); emit(record, 'change', 'control', value);
      } else if (node.type === 'Slider') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < node.props.min || value > node.props.max || !isStepAligned(value, node.props.min, node.props.step)) throw new TypeError('SLIDER_VALUE_INVALID');
        // A direct value assignment owns the value. Do not let a stale drag's
        // captured origin overwrite it on pointerup.
        cancelGesturesFor(record, 'programmatic-value');
        preparePresentationChange(record, 'progress', ['sliderValue']); node.props.value = value; record.sliderPreview = undefined; record.redraw?.(); emit(record, 'change', 'control', node.props.value);
      } else if (node.type === 'ProgressBar') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > node.props.max) throw new TypeError('PROGRESS_VALUE_INVALID'); preparePresentationChange(record, 'progress', ['progress']); node.props.value = value; record.redraw?.(); emit(record, 'change', 'control', value);
      } else if (node.type === 'RadioGroup' || node.type === 'Select') {
        if (value !== null && (typeof value !== 'string' || !node.props.options.some(option => option.id === value))) throw new TypeError('CHOICE_VALUE_INVALID'); if (node.type === 'RadioGroup') preparePresentationChange(record, 'change', ['markerAlpha', 'markerY']); node.props.selectedId = value; record.redraw?.(); emit(record, 'change', 'control', value);
      } else if (node.type === 'List') {
        if (value !== null && (typeof value !== 'string' || !node.props.items.some(item => item.id === value))) throw new TypeError('LIST_VALUE_INVALID'); preparePresentationChange(record, 'change', ['listSelection']); node.props.selectedId = value; record.redraw?.(); emit(record, 'change', 'control', value);
      } else if (node.type === 'Tabs') {
        if (typeof value !== 'string' || !node.props.tabs.some(tab => tab.id === value)) throw new TypeError('TAB_VALUE_INVALID'); preparePresentationChange(record, 'change', ['tabProgress']); node.props.activeId = value; record.redraw?.(); record.updateTabs?.(); emit(record, 'change', 'control', value, value);
      } else if (node.type === 'ScrollView') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('SCROLL_VALUE_REQUIRED');
        const data = value as { x?: unknown; y?: unknown }; if (typeof data.x !== 'number' || typeof data.y !== 'number' || !Number.isFinite(data.x) || !Number.isFinite(data.y)) throw new TypeError('SCROLL_VALUE_INVALID');
        const maxX = Math.max(0, node.props.contentWidth - node.layout.width), maxY = Math.max(0, node.props.contentHeight - node.layout.height);
        if (data.x < 0 || data.x > maxX || data.y < 0 || data.y > maxY) throw new TypeError('SCROLL_VALUE_OUT_OF_RANGE');
        preparePresentationChange(record, 'scroll', ['scrollX', 'scrollY']); node.props.scrollX = data.x; node.props.scrollY = data.y; record.redraw?.(); record.updateContentPosition?.(); emit(record, 'scroll', 'control', { x: node.props.scrollX, y: node.props.scrollY });
      } else if (node.type === 'Dialog') {
        if (typeof value !== 'boolean') throw new TypeError('DIALOG_OPEN_REQUIRED');
        const wasOpen = node.props.open, wasClosing = record.dialogClosing;
        pinPresentation(record, ['dialogScale', 'dialogAlpha']); node.props.open = value;
        if (value) {
          record.dialogClosing = false;
          if (!wasOpen && !wasClosing && hasAction(record, 'open')) {
            record.presentation.dialogScale = getMotionStyle(motionStyle ?? 'corporate').enterScale; record.presentation.dialogAlpha = 0;
          }
          record.redraw?.(); refreshVisibility(record); updateDialogBlocker(record);
          if (!wasOpen || wasClosing) { runSystemAction(record, 'open'); emit(record, 'open', 'control'); }
        } else {
          record.dialogClosing = (wasOpen || wasClosing) && hasAction(record, 'close'); record.redraw?.(); refreshVisibility(record); updateDialogBlocker(record);
          if (record.dialogClosing) { runSystemAction(record, 'close'); emit(record, 'close', 'control'); }
          else { updateDialogBlocker(record); refreshVisibility(record); }
        }
        if (openSelect && blocked(openSelect)) closePopup(openSelect, undefined, true);
      } else throw new Error(`VALUE_UNSUPPORTED: ${node.type}`);
      render();
    },
    setEnabled(id, enabled): void {
      if (typeof enabled !== 'boolean') throw new TypeError('ENABLED_BOOLEAN_REQUIRED'); const record = requireRecord(id);
      if (!enabledNodeTypes.has(record.node.type)) throw new Error(`ENABLED_UNSUPPORTED: ${record.node.type}`);
      (record.node.props as { enabled: boolean }).enabled = enabled; updateNodeAlpha(record);
      if (!enabled && focusedInput === record) blurInput(record, 'control'); if (!enabled) { cancelGesturesFor(record, 'setEnabled'); cancelRecordPresentation(record); closePopup(record, undefined, true); } render();
    },
    setVisible(id, visible): void {
      if (typeof visible !== 'boolean') throw new TypeError('VISIBLE_BOOLEAN_REQUIRED'); const record = requireRecord(id); record.userVisible = visible;
      if (!visible && focusedInput === record) blurInput(record, 'control'); if (!visible) { cancelGesturesFor(record, 'setVisible'); cancelPresentationTree(record); } refreshVisibility(record);
      if (focusedInput && !effectiveVisible(focusedInput)) blurInput(focusedInput, 'control');
      if (openSelect && !effectiveVisible(openSelect)) closePopup(openSelect, undefined, true); render();
    },
    destroyNode(id): void {
      const record = requireRecord(id); if (active?.root === record) throw new Error('ROOT_NODE_DESTROY_FORBIDDEN');
      removeFromDocument(record);
      const cleanupErrors: unknown[] = []; destroyRecord(record, true, cleanupErrors); reportCleanupErrors(cleanupErrors); render();
      const scope = active;
      if (motionSystem && scope) {
        const bindings = motionSystem.bindings.filter(binding => scope.records.has(binding.targetId));
        if (bindings.length === 0) { motionSystem = null; motionStyle = null; }
        else motionSystem = validateMotionSystem({ ...motionSystem, bindings }, scope.document);
      }
    },
    setZoom(value): void {
      assertAlive(); if (!Number.isFinite(value) || value < 0.5 || value > 2) throw new RangeError('INVALID_ZOOM');
      cancelGestures('zoom'); zoom = value; stage.scale.set(zoom); if (active) app.renderer.resize(active.document.canvas.width * zoom, active.document.canvas.height * zoom); render();
    },
    applyMotion(id, values): void {
      const record = requireRecord(id); const allowed = ['x', 'y', 'alpha', 'scaleX', 'scaleY', 'rotation'] as const;
      for (const key of Object.keys(values)) if (!allowed.includes(key as typeof allowed[number])) throw new TypeError(`UNSUPPORTED_MOTION_PROPERTY: ${key}`);
      for (const [key, value] of Object.entries(values)) if (value !== undefined && (!Number.isFinite(value) || ((key === 'alpha') && (value < 0 || value > 1)) || ((key === 'scaleX' || key === 'scaleY') && value <= 0))) throw new TypeError(`INVALID_MOTION_VALUE: ${key}`);
      record.motion = { ...record.motion, ...values };
      if (record.dialogDetached) setLogicalDialogTransform(record);
      else {
        record.view.position.set(record.node.layout.x + (record.motion.x ?? 0), record.node.layout.y + (record.motion.y ?? 0));
        record.view.scale.set(record.motion.scaleX ?? 1, record.motion.scaleY ?? 1); record.view.rotation = record.motion.rotation ?? 0;
      }
      updateNodeAlpha(record); syncDetachedDialogs(record.scope); positionOpenPopup(record.scope); render();
    },
    resetMotion(): void {
      assertAlive(); if (!active) return;
      for (const record of active.records.values()) {
        record.motion = {};
        if (record.dialogDetached) setLogicalDialogTransform(record);
        else { record.view.position.set(record.node.layout.x, record.node.layout.y); record.view.scale.set(1); record.view.rotation = 0; }
        updateNodeAlpha(record); positionPopup(record);
      }
      syncDetachedDialogs(active);
      render();
    },
    setMotionSystem(input): void {
      assertAlive(); const scope = active;
      if (!scope) throw new Error('TREE_NOT_LOADED');
      const validated = input === null ? null : validateMotionSystem(input, scope.document);
      animator.cancelAll();
      for (const record of scope.records.values()) cancelPresentationTree(record);
      if (input === null) { motionSystem = null; motionStyle = null; return; }
      motionSystem = validated; motionStyle = validated!.style;
    },
    getMotionSystem(): MotionSystemDocument | null {
      assertAlive(); return motionSystem ? structuredClone(motionSystem) : null;
    },
    playMotionAction(id, action): void {
      const record = requireRecord(id);
      if (!hasAction(record, action)) runSystemAction(record, action, true, true);
      if (record.node.type === 'Select' && (action === 'open' || action === 'close') && !record.popup) throw new Error('MOTION_SELECT_POPUP_NOT_OPEN');
      runSystemAction(record, action, true, true);
    },
    inspectMotionSystem(): MotionSystemInspection {
      assertAlive(); const scope = active;
      return {
        style: motionStyle, systemId: motionSystem?.id ?? null, scheduler: animator.snapshot(),
        nodes: scope ? [...scope.records.values()].sort((left, right) => left.order - right.order).map(record => ({
          id: record.node.id, type: record.node.type, visible: effectiveVisible(record), presentation: presentation(record),
        })) : [],
      };
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true; loadGeneration += 1;
      const cleanupErrors: unknown[] = [];
      for (const controller of controllers) captureCleanup(cleanupErrors, () => controller.abort(new DOMException('tree preview destroyed', 'AbortError')));
      cancelGestures('destroy', 'control', cleanupErrors); if (active) { const scope = active; active = undefined; disposeScope(scope, true); }
      captureCleanup(cleanupErrors, () => animator.destroy()); motionSystem = null; motionStyle = null;
      for (const cleanup of externalCleanups.splice(0)) captureCleanup(cleanupErrors, cleanup);
      captureCleanup(cleanupErrors, () => editor.remove()); listeners.clear(); captureCleanup(cleanupErrors, () => app.destroy({ removeView: true }, { children: true }));
      reportCleanupErrors(cleanupErrors);
    },
  };
}

function inspectValue(node: UiNode): RuntimeNodeInspection['value'] | undefined {
  switch (node.type) {
    case 'Switch': case 'CheckBox': return node.props.checked;
    case 'Input': case 'ProgressBar': case 'Slider': return node.props.value;
    case 'RadioGroup': case 'Select': case 'List': return node.props.selectedId;
    case 'Tabs': return node.props.activeId;
    case 'ScrollView': return { x: node.props.scrollX, y: node.props.scrollY };
    default: return undefined;
  }
}
