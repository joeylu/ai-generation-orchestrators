import { MotionAnimator, getMotionStyle } from './workspace/component-browser.mjs';

/** Presentation only. Semantic values/events are owned by the unchanged panel session. */
export function panelVisualMotion(bundle) {
  const theme = bundle.catalog.themes.find(theme => theme.id === bundle.spec.theme.id && theme.version === bundle.spec.theme.version);
  if (!((theme?.visualStyle === 'modern-v1' && bundle.compilerVersion === '0.7.1')
    || (theme?.visualStyle === 'modern-v2' && bundle.compilerVersion === '0.7.2')
    || (theme?.visualStyle === 'modern-v3' && ['0.7.3', '0.8.0', '0.9.0', '0.10.0', '0.11.0', '0.12.0', '0.13.0', '0.14.0', '0.15.0', '0.16.0', '0.17.0', '0.18.0', '0.19.0', '0.20.0','0.21.0','0.22.0','0.23.0','0.24.0','0.25.0','0.26.0','0.27.0'].includes(bundle.compilerVersion)))) return null;
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
  const alignValues=createPanelValueAlignment(bundle,runtime);alignValues();
  if (!motion) return () => {};
  const preference = typeof media === 'function' ? media.call(globalThis, '(prefers-reduced-motion: reduce)') : null;
  const buttons = new Map(), profile = getMotionStyle(motion.style), animator = new MotionAnimator(clock);
  const visit = node => {
    if (node.type === 'Button') buttons.set(node.id, { key: `panel.hover.b${buttons.size}`, width: node.layout.width, height: node.layout.height, scale: 1 });
    for (const child of node.children ?? []) visit(child);
  };
  visit(bundle.componentBundle.document.root);
  let disposed = false;
  const pointerTarget=bundle.compilerVersion==='0.25.0'?runtime.canvas?.ownerDocument.defaultView:null,dragging=new Set();
  const pointerDown=event=>{if(event.target===runtime.canvas&&event.button===0){dragging.add(event.pointerId);alignValues();}};
  const pointerMove=event=>{if(dragging.has(event.pointerId))alignValues();};
  const pointerEnd=event=>{if(dragging.delete(event.pointerId))alignValues();};
  const pointerListeners=[['pointerdown',pointerDown],['pointermove',pointerMove],['pointerup',pointerEnd],['pointercancel',pointerEnd]];
  // Bubble after the component's capture listeners so in-progress previews are already painted.
  for(const [type,listener] of pointerListeners)pointerTarget?.addEventListener(type,listener);
  const paint = (id, button, scale) => {
    button.scale = scale;
    runtime.applyMotion(id, { x: button.width * (1 - scale) / 2, y: button.height * (1 - scale) / 2, scaleX: scale, scaleY: scale });
  };
  const reset = () => {
    animator.cancelAll();
    for (const [id, button] of buttons) if (button.scale !== 1) paint(id, button, 1);
  };
  const sync = () => { if (preference?.matches) reset(); };
  alignPanelButtonLabels(runtime,['0.19.0','0.20.0','0.21.0','0.22.0','0.23.0','0.24.0','0.25.0','0.26.0','0.27.0'].includes(bundle.compilerVersion));
  const unsubscribe = runtime.subscribe(event => {
    if(!disposed&&event.type==='change')alignValues();
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
    disposed = true; preference?.removeEventListener('change', sync); unsubscribe();
    for(const [type,listener] of pointerListeners)pointerTarget?.removeEventListener(type,listener);dragging.clear();reset(); animator.destroy();
  };
}

/** Align the heading's measured glyphs inside its authored slot, with no frame loop. */
export function alignPanelTitle(bundle, runtime) {
  const menu = ['0.19.0','0.20.0','0.21.0','0.22.0','0.23.0','0.24.0','0.25.0','0.26.0','0.27.0'].includes(bundle.compilerVersion)&&bundle.spec.sections.length===1&&bundle.spec.sections[0].rows.every(row=>row.kind==='button'&&row.label==='');
  const style = bundle.spec.titleBar ?? (menu?{horizontalAlign:'center',verticalAlign:'middle'}:null);
  if (!style) return;
  const title = runtime.inspect().nodes.find(node => node.id === `${bundle.spec.id}.title`);
  const glyph = title?.renderedTextBounds?.[0]?.bounds;
  if (!title || !glyph) return;
  const box = title.bounds;
  const x = style.horizontalAlign === 'center' ? (box.width - glyph.width) / 2 : style.horizontalAlign === 'right' ? box.width - glyph.width : 0;
  const y = style.verticalAlign === 'middle' ? (box.height - glyph.height) / 2 : style.verticalAlign === 'bottom' ? box.height - glyph.height : 0;
  const snap=value=>bundle.compilerVersion==='0.25.0'?Math.round(value):value;
  runtime.applyMotion(title.id, { x: style.horizontalAlign === null ? 0 : snap(box.x + x - glyph.x), y: style.verticalAlign === null ? 0 : snap(box.y + y - glyph.y) });
}

/** Use the slider's authored rail edge, measuring each current value after linkage updates. */
export function createPanelValueAlignment(bundle,runtime){
  if(bundle.compilerVersion!=='0.25.0')return()=>{};
  const positions=new Map();
  const visit=(node,x=0)=>{x+=node.layout.x;positions.set(node.id,{x,node});for(const child of node.children??[])visit(child,x);};
  visit(bundle.componentBundle.document.root);
  const sliders=bundle.spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='slider');
  return()=>{
    // setValue emits before the shared renderer refreshes value-text bindings.
    // An empty motion update flushes that paint without changing semantic state.
    if(sliders.length)runtime.applyMotion(`${bundle.spec.id}.row.${sliders[0].id}.value`,{});
    const nodes=new Map(runtime.inspect().nodes.map(node=>[node.id,node]));
    for(const row of sliders){
      const id=`${bundle.spec.id}.row.${row.id}`,value=nodes.get(id+'.value'),glyph=value?.renderedTextBounds?.[0]?.bounds,slider=nodes.get(id+'.control');
      const source=positions.get(id+'.control')?.node.props.appearance,base=positions.get(id+'.value');
      if(!glyph||!slider||!source||!base)continue;
      const right=slider.bounds.x+slider.bounds.width*(source.track.layout.x+source.track.layout.width)/source.sourceCanvas.width;
      // The glyph offset relative to its slot cancels any previous motion; no accumulated drift.
      runtime.applyMotion(value.id,{x:right-base.x-(glyph.x-value.bounds.x)-glyph.width});
    }
  };
}

/** Environment fonts are measured by Pixi; authored label/state remain unchanged. */
export function alignPanelButtonLabels(runtime,pixelSnap=false) {
  const nodes = runtime.inspect().nodes, byId = new Map(nodes.map(node => [node.id, node]));
  for (const button of nodes.filter(node => node.type === 'Button')) {
    const label = byId.get(`${button.id}.center-label`), text = label?.renderedTextBounds?.[0];
    if (!text) continue;
    const snap=value=>pixelSnap?Math.round(value):value;
    runtime.applyMotion(label.id, {
      x: snap(button.bounds.x + (button.bounds.width - text.bounds.width) / 2) - text.bounds.x,
      y: snap(button.bounds.y + (button.bounds.height - text.bounds.height) / 2) - text.bounds.y,
    });
  }
}
