import { MotionAnimator, getMotionStyle } from './workspace/component-browser.mjs';

/** Presentation only. Semantic values/events are owned by the unchanged panel session. */
export function panelVisualMotion(bundle) {
  const theme = bundle.catalog.themes.find(theme => theme.id === bundle.spec.theme.id && theme.version === bundle.spec.theme.version);
  if (!((theme?.visualStyle === 'modern-v1' && bundle.compilerVersion === '0.7.1')
    || (theme?.visualStyle === 'modern-v2' && bundle.compilerVersion === '0.7.2')
    || (theme?.visualStyle === 'modern-v3' && ['0.7.3', '0.8.0', '0.9.0', '0.10.0', '0.11.0', '0.12.0', '0.13.0', '0.14.0'].includes(bundle.compilerVersion)))) return null;
  // Native press and input focus stay immediate. Hover uses a per-button channel,
  // avoiding the shared runtime's whole-tree reset when installing a motion system.
  const actions = { Button: ['hover'] }, bindings = [];
  const visit = node => {
    if (actions[node.type]) bindings.push({ targetId: node.id, componentType: node.type, actions: [...actions[node.type]] });
    for (const child of node.children ?? []) visit(child);
  };
  visit(bundle.componentBundle.document.root);
  return bindings.length ? { motionSystemVersion: '0.1', id: 'panel-modern-v1', style: 'corporate', bindings } : null;
}

/** Dispose before destroying the runtime. Live reduced-motion changes cancel feedback. */
export function attachPanelVisuals(bundle, runtime, media = globalThis.matchMedia, clock = {
  now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id),
}) {
  const motion = panelVisualMotion(bundle);
  alignPanelTitle(bundle, runtime);
  if (!motion) return () => {};
  const preference = typeof media === 'function' ? media.call(globalThis, '(prefers-reduced-motion: reduce)') : null;
  const buttons = new Map(), profile = getMotionStyle(motion.style), animator = new MotionAnimator(clock);
  const visit = node => {
    if (node.type === 'Button') buttons.set(node.id, { key: `panel.hover.b${buttons.size}`, width: node.layout.width, height: node.layout.height, scale: 1 });
    for (const child of node.children ?? []) visit(child);
  };
  visit(bundle.componentBundle.document.root);
  let disposed = false;
  const paint = (id, button, scale) => {
    button.scale = scale;
    runtime.applyMotion(id, { x: button.width * (1 - scale) / 2, y: button.height * (1 - scale) / 2, scaleX: scale, scaleY: scale });
  };
  const reset = () => {
    animator.cancelAll();
    for (const [id, button] of buttons) if (button.scale !== 1) paint(id, button, 1);
  };
  const sync = () => { if (preference?.matches) reset(); };
  alignPanelButtonLabels(runtime);
  const unsubscribe = runtime.subscribe(event => {
    const button = buttons.get(event.id);
    if (disposed || !button) return;
    if (event.type === 'cancel') { animator.cancel(button.key); if (button.scale !== 1) paint(event.id, button, 1); return; }
    if (event.type !== 'hover' || preference?.matches) return;
    const target = event.value === 1 ? profile.hoverScale : 1;
    if (target === button.scale) { animator.cancel(button.key); return; }
    animator.animate(button.key, { scale: button.scale }, [{ to: { scale: target }, duration: profile.hoverMs, easing: profile.easing }],
      values => { if (!disposed) paint(event.id, button, values.scale); });
  });
  preference?.addEventListener('change', sync);
  return () => {
    if (disposed) return;
    disposed = true; preference?.removeEventListener('change', sync); unsubscribe(); reset(); animator.destroy();
  };
}

/** Align the heading's measured glyphs inside its authored slot, with no frame loop. */
export function alignPanelTitle(bundle, runtime) {
  const style = bundle.spec.titleBar;
  if (!style) return;
  const title = runtime.inspect().nodes.find(node => node.id === `${bundle.spec.id}.title`);
  const glyph = title?.renderedTextBounds?.[0]?.bounds;
  if (!title || !glyph) return;
  const box = title.bounds;
  const x = style.horizontalAlign === 'center' ? (box.width - glyph.width) / 2 : style.horizontalAlign === 'right' ? box.width - glyph.width : 0;
  const y = style.verticalAlign === 'middle' ? (box.height - glyph.height) / 2 : style.verticalAlign === 'bottom' ? box.height - glyph.height : 0;
  runtime.applyMotion(title.id, { x: style.horizontalAlign === null ? 0 : box.x + x - glyph.x, y: style.verticalAlign === null ? 0 : box.y + y - glyph.y });
}

/** Environment fonts are measured by Pixi; authored label/state remain unchanged. */
export function alignPanelButtonLabels(runtime) {
  const nodes = runtime.inspect().nodes, byId = new Map(nodes.map(node => [node.id, node]));
  for (const button of nodes.filter(node => node.type === 'Button')) {
    const label = byId.get(`${button.id}.center-label`), text = label?.renderedTextBounds?.[0];
    if (!text) continue;
    runtime.applyMotion(label.id, {
      x: button.bounds.x + (button.bounds.width - text.bounds.width) / 2 - text.bounds.x,
      y: button.bounds.y + (button.bounds.height - text.bounds.height) / 2 - text.bounds.y,
    });
  }
}
