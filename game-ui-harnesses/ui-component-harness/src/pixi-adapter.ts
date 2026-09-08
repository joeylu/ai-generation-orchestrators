import { Application, Container, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { HarnessError, validateButton, type ButtonContract } from './contract.ts';
import { ButtonStateMachine, type ButtonEvent, type InputSource, type StateSnapshot } from './button-state.ts';
import { loadImage } from './resource.ts';
import { compileButton, validateButtonIntent, validatePreviewPolicy, type ButtonIntent, type ImageFacts, type PreviewPolicy } from './intent-compiler.ts';

export interface ButtonInstance {
  readonly id: string;
  snapshot(): StateSnapshot;
  subscribe(listener: (event: ButtonEvent) => void): () => void;
  setEnabled(enabled: boolean): void;
  cancel(reason: string): void;
  destroy(): void;
}
export interface Preview {
  readonly canvas: HTMLCanvasElement;
  load(input: unknown, signal: AbortSignal, resolver?: typeof loadImage): Promise<ButtonInstance>;
  loadIntent(input: unknown, policy: unknown, signal: AbortSignal, progress: (stage: 'intent' | 'resource-start' | 'resource' | 'compile') => void, resolver?: typeof loadImage): Promise<{ instance: ButtonInstance; compilation: Compilation }>;
  setZoom(zoom: number): void;
  inspect(): { instances: number; externalListeners: number; zoom: number; renderer: string };
  destroy(): void;
}
export interface Compilation {
  compilerVersion: '0.1';
  intent: ButtonIntent;
  image: ImageFacts;
  policy: PreviewPolicy;
  contract: ButtonContract;
}
const sourceOf = (e: { pointerType: string }): InputSource => {
  if (e.pointerType === 'mouse' || e.pointerType === 'touch' || e.pointerType === 'pen') return e.pointerType;
  throw new HarnessError('runtime', [{ path: 'event.pointerType', code: 'UNSUPPORTED_POINTER', message: `不支持 ${e.pointerType}` }]);
};

export async function createPreview(host: HTMLElement, onFatal: (error: unknown) => void): Promise<Preview> {
  if (typeof PointerEvent !== 'function') throw new HarnessError('runtime', [{ path: 'browser.PointerEvent', code: 'UNSUPPORTED_BROWSER', message: '本轮要求支持 Pointer Events 的浏览器' }]);
  const app = new Application();
  // Explicit WebGL renderer, no alternate-renderer recovery path.
  await app.init({ width: 640, height: 400, backgroundAlpha: 0, antialias: true, resolution: 1, preference: 'webgl', autoStart: false });
  const canvas = app.canvas;
  canvas.setAttribute('aria-label', 'PixiJS Button 交互画布'); canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0; canvas.style.touchAction = 'none';
  host.append(canvas);
  const stage = new Container(); app.stage.addChild(stage);
  const instances = new Set<ButtonInstance>();
  let externalListeners = 0, zoom = 1, destroyed = false;
  const render = () => { if (!destroyed) app.render(); };
  const assertAlive = () => { if (destroyed) throw new Error('PREVIEW_DESTROYED: 预览已销毁'); };
  const contextLost = (event: Event) => {
    event.preventDefault();
    for (const instance of [...instances]) instance.destroy();
    onFatal(new HarnessError('runtime', [{ path: 'renderer', code: 'WEBGL_CONTEXT_LOST', message: 'WebGL 上下文丢失，已停止组件。请重新打开页面。' }]));
  };
  canvas.addEventListener('webglcontextlost', contextLost);

  function mount(contract: ButtonContract, image: HTMLImageElement): ButtonInstance {
    const model = new ButtonStateMachine(contract.props.enabled);
    const view = new Container();
    const texture = Texture.from(image);
    const sprite = new Sprite(texture);
    sprite.width = contract.layout.width; sprite.height = contract.layout.height; sprite.eventMode = 'none';
    view.addChild(sprite); view.position.set(contract.layout.x, contract.layout.y);
    view.hitArea = new Rectangle(0, 0, contract.layout.width, contract.layout.height);
    view.eventMode = 'static'; view.cursor = contract.props.enabled ? 'pointer' : 'default';
    const cleanups: (() => void)[] = [];
    const listen = (target: EventTarget, type: string, listener: EventListener, capture = false) => {
      target.addEventListener(type, listener, capture); externalListeners++;
      cleanups.push(() => { target.removeEventListener(type, listener, capture); externalListeners--; });
    };
    const bind = (name: string, listener: (event: FederatedPointerEvent) => void) => {
      const guarded = (event: FederatedPointerEvent) => {
        try { listener(event); } catch (error) { instance.destroy(); onFatal(error); }
      };
      view.on(name, guarded); cleanups.push(() => view.off(name, guarded));
    };
    const inside = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) * app.screen.width / bounds.width) / zoom;
      const y = ((event.clientY - bounds.top) * app.screen.height / bounds.height) / zoom;
      const l = contract.layout;
      return x >= l.x && y >= l.y && x < l.x + l.width && y < l.y + l.height;
    };
    bind('pointerover', e => model.over(sourceOf(e)));
    bind('pointerout', e => model.out(sourceOf(e)));
    bind('pointerdown', e => {
      canvas.focus({ preventScroll: true });
      model.down(e.pointerId, sourceOf(e), e.button, e.isPrimary);
    });
    bind('pointerup', e => model.up(e.pointerId, sourceOf(e), true));
    bind('pointerupoutside', e => model.up(e.pointerId, sourceOf(e), false));
    // Native listeners cover releases beyond the canvas and browser cancellations.
    // The model consumes a pointer once, so a native + federated release cannot duplicate activate.
    listen(window, 'pointerup', ((e: PointerEvent) => {
      if (model.snapshot().pressedPointer !== e.pointerId) return;
      try { model.up(e.pointerId, sourceOf(e), inside(e)); } catch (error) { instance.destroy(); onFatal(error); }
    }) as EventListener);
    const cancelPointer = (reason: string) => ((e: PointerEvent) => {
      if (model.snapshot().pressedPointer !== e.pointerId) return;
      try { model.cancel(reason, sourceOf(e), e.pointerId); } catch (error) { instance.destroy(); onFatal(error); }
    }) as EventListener;
    listen(window, 'pointercancel', cancelPointer('pointercancel'), true);
    listen(canvas, 'lostpointercapture', cancelPointer('lostpointercapture'));
    listen(window, 'blur', () => model.cancel('blur'));
    listen(document, 'visibilitychange', () => { if (document.hidden) model.cancel('hidden'); });
    listen(window, 'keydown', ((e: KeyboardEvent) => { if (e.key === 'Escape') model.cancel('Escape'); }) as EventListener);
    const instance: ButtonInstance = {
      id: contract.id,
      snapshot: () => model.snapshot(),
      subscribe: listener => model.subscribe(listener),
      setEnabled(enabled) { model.setEnabled(enabled); view.cursor = enabled ? 'pointer' : 'default'; },
      cancel: reason => model.cancel(reason),
      destroy() {
        if (model.snapshot().destroyed) return;
        for (const cleanup of cleanups.splice(0)) cleanup();
        view.removeFromParent(); view.destroy({ children: true }); texture.destroy(true);
        instances.delete(instance); model.destroy(); render();
      },
    };
    stage.addChild(view); instances.add(instance); render();
    return instance;
  }
  render();
  return {
    canvas,
    async load(input, signal, resolver = loadImage) {
      assertAlive();
      if (instances.size) throw new Error('INSTANCE_EXISTS: 先销毁已有实例再加载');
      const contract = validateButton(input);
      const image = await resolver(contract.slots.visual.props.source, signal);
      signal.throwIfAborted(); assertAlive();
      if (instances.size) throw new Error('INSTANCE_EXISTS: 并发加载冲突');
      return mount(contract, image);
    },
    async loadIntent(input, settings, signal, progress, resolver = loadImage) {
      assertAlive(); signal.throwIfAborted();
      if (instances.size) throw new Error('INSTANCE_EXISTS: 先销毁已有实例再加载');
      const intent = validateButtonIntent(input); progress('intent');
      const policy = validatePreviewPolicy(settings);
      if (policy.canvas.width !== 640 || policy.canvas.height !== 400) throw new HarnessError('compile', [{ path: '$policy.canvas', code: 'CANVAS_MISMATCH', message: '当前验收画布为 640×400，配置必须与实际画布一致' }]);
      progress('resource-start');
      const image = await resolver(intent.visual.source, signal, '$intent.visual.source');
      signal.throwIfAborted(); assertAlive(); progress('resource');
      const imageFacts = { width: image.naturalWidth, height: image.naturalHeight };
      const contract = compileButton(intent, imageFacts, policy); progress('compile');
      signal.throwIfAborted(); assertAlive();
      if (instances.size) throw new Error('INSTANCE_EXISTS: 并发加载冲突');
      return { instance: mount(contract, image), compilation: { compilerVersion: '0.1', intent, image: imageFacts, policy, contract } };
    },
    setZoom(value) {
      assertAlive();
      if (!Number.isFinite(value) || value < 0.5 || value > 1.5) throw new Error('INVALID_ZOOM: 缩放必须在 0.5–1.5');
      for (const instance of instances) instance.cancel('zoom');
      zoom = value; stage.scale.set(zoom); app.renderer.resize(640 * zoom, 400 * zoom); render();
    },
    inspect: () => ({ instances: instances.size, externalListeners, zoom, renderer: 'WebGL' }),
    destroy() {
      if (destroyed) return;
      for (const instance of [...instances]) instance.destroy();
      destroyed = true; canvas.removeEventListener('webglcontextlost', contextLost);
      app.destroy(true, { children: true });
    },
  };
}
