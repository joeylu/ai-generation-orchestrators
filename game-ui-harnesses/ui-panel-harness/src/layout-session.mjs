/** Harness-side viewport behavior; the shared component runtime remains unmodified. */
export function attachLayoutSession(spec, runtime) {
  if (!['0.4', '0.5', '0.6', '0.7'].includes(spec.panelSpecVersion)) return Object.freeze({ destroy() {} });
  if (typeof runtime?.getDocument !== 'function' || typeof runtime?.inspect !== 'function' || typeof runtime?.subscribe !== 'function'
      || typeof runtime?.setValue !== 'function' || typeof runtime?.setSelectOpen !== 'function') {
    throw new Error('PANEL_LAYOUT_RUNTIME_REQUIRED');
  }
  const document = runtime.getDocument();
  const viewports = new Map(), owners = new Map();
  const bodyId = `${spec.id}.body`;
  const visit = (node, owner = null) => {
    if (node.type === 'ScrollView' && (node.id === bodyId || spec.tabs?.pages.some(page => node.id === `${spec.id}.page.${page.id}`))) {
      owner = node.id; viewports.set(owner, node);
    }
    if (owner) owners.set(node.id, owner);
    for (const child of node.children ?? []) visit(child, owner);
  };
  visit(document.root);
  if (!viewports.size && !spec.tabs) return Object.freeze({ destroy() {} });
  let alive = true, scrolling = false, unsubscribe = () => {};
  const destroy = () => { if (!alive) return; alive = false; const detach = unsubscribe; unsubscribe = () => {}; detach(); };
  const reveal = id => {
    const viewportId = owners.get(id) ?? (!spec.tabs ? bodyId : null), bodyNode = viewports.get(viewportId);
    if (!bodyNode) return;
    const nodes = runtime.inspect().nodes, viewport = nodes.find(node => node.id === viewportId);
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
    try { runtime.setValue(viewportId, { x: 0, y: next }); } finally { scrolling = false; }
  };
  const detach = runtime.subscribe(event => {
    if (!alive) return;
    if (event.type === 'destroy') { destroy(); return; }
    if (event.type === 'focus' && event.source === 'keyboard') reveal(event.id);
    // Pointer focus does not emit the same keyboard-focus event. Revealing on
    // open also makes a partly clipped Select's complete field and popup safe.
    else if (event.type === 'open') reveal(event.id);
    else if ((event.type === 'scroll' && viewports.has(event.id) && !scrolling)
        || (event.type === 'change' && spec.tabs && event.id === `${spec.id}.row.${spec.tabs.id}.control`)) {
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
