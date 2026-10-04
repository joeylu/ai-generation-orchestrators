/** Harness-side viewport behavior; the shared component runtime remains unmodified. */
export function attachLayoutSession(spec, runtime) {
  if (!['0.4', '0.5'].includes(spec.panelSpecVersion)) return Object.freeze({ destroy() {} });
  if (typeof runtime?.getDocument !== 'function' || typeof runtime?.inspect !== 'function' || typeof runtime?.subscribe !== 'function'
      || typeof runtime?.setValue !== 'function' || typeof runtime?.setSelectOpen !== 'function') {
    throw new Error('PANEL_LAYOUT_RUNTIME_REQUIRED');
  }
  const bodyId = `${spec.id}.body`;
  const document = runtime.getDocument();
  let bodyNode;
  const visit = node => { if (node.id === bodyId) bodyNode = node; for (const child of node.children ?? []) visit(child); };
  visit(document.root);
  if (!bodyNode || bodyNode.type !== 'ScrollView') return Object.freeze({ destroy() {} });
  let alive = true, scrolling = false, unsubscribe = () => {};
  const destroy = () => { if (!alive) return; alive = false; const detach = unsubscribe; unsubscribe = () => {}; detach(); };
  const reveal = id => {
    const nodes = runtime.inspect().nodes, viewport = nodes.find(node => node.id === bodyId);
    const control = nodes.find(node => node.id === id);
    if (!viewport || !control || !control.visible) return;
    // Prefer the complete settings row; fall back to the focusable control for
    // non-row targets. Inspection bounds already include all ancestor scrolling.
    const rowId = id.endsWith('.control') ? id.slice(0, -8) : null;
    const row = nodes.find(node => node.id === rowId), target = row ?? control;
    const box = target.bounds, area = viewport.bounds;
    const delta = box.y < area.y ? box.y - area.y
      : box.y + box.height > area.y + area.height ? box.y + box.height - area.y - area.height : 0;
    const current = viewport.value?.y ?? 0;
    const next = Math.max(0, Math.min(bodyNode.props.contentHeight - bodyNode.layout.height, current + delta));
    if (next === current) return;
    scrolling = true;
    try { runtime.setValue(bodyId, { x: 0, y: next }); } finally { scrolling = false; }
  };
  const detach = runtime.subscribe(event => {
    if (!alive) return;
    if (event.type === 'destroy') { destroy(); return; }
    if (event.type === 'focus' && event.source === 'keyboard') reveal(event.id);
    // Pointer focus does not emit the same keyboard-focus event. Revealing on
    // open also makes a partly clipped Select's complete field and popup safe.
    else if (event.type === 'open') reveal(event.id);
    else if (event.type === 'scroll' && event.id === bodyId && !scrolling) {
      for (const node of runtime.inspect().nodes) {
        if (node.type === 'Select' && node.popupOpen) runtime.setSelectOpen(node.id, false);
      }
    }
  });
  if (typeof detach !== 'function') { alive = false; throw new Error('PANEL_LAYOUT_RUNTIME_REQUIRED'); }
  unsubscribe = detach;
  if (!alive) { unsubscribe = () => {}; detach(); }
  return Object.freeze({ destroy });
}
