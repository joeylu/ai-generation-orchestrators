import { controlId } from './compiler.mjs';

export function selectionLabel(row) {
  const kinds = { button: '按钮', input: '输入框', text: '说明', slider: '滑条', switch: '开关', select: '下拉框', progress: '进度条' };
  return `${row.label || row.buttonLabel || row.text || row.id} · ${kinds[row.kind] ?? row.kind}`;
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/** Clip against every ancestor viewport. Off-page and off-screen rows cannot be selected. */
export function previewSelectionTargets(spec, document, inspection) {
  const nodes = new Map(inspection.nodes.map(node => [node.id, node]));
  const clips = new Map();
  const visit = (node, ancestors) => {
    clips.set(node.id, ancestors);
    const next = node.type === 'ScrollView' ? [...ancestors, node.id] : ancestors;
    for (const child of node.children ?? []) visit(child, next);
  };
  visit(document.root, []);
  return spec.sections.flatMap(section => section.rows).flatMap(row => {
    const node = nodes.get(`${spec.id}.row.${row.id}`) ?? nodes.get(controlId(spec.id, row.id));
    if (!node?.visible) return [];
    let bounds = intersect(node.bounds, { x: 0, y: 0, ...spec.canvas });
    for (const id of clips.get(node.id) ?? []) {
      const viewport = nodes.get(id);
      if (!viewport?.visible) return [];
      bounds = intersect(bounds, viewport.bounds);
    }
    return bounds.width > 0 && bounds.height > 0 ? [{ rowId: row.id, label: selectionLabel(row), bounds }] : [];
  });
}

/** DOM overlay is present only while selecting; normal Pixi events remain untouched. No animation loop. */
export function attachWorkbenchSelection(host, spec, preview, onSelect, onExit) {
  let active = false, suspended = false, alive = true;
  const layer = document.createElement('div'); layer.className = 'selection-layer'; layer.hidden = true;
  layer.setAttribute('role', 'group'); layer.setAttribute('aria-label', '选择修改对象');
  host.style.position = 'relative'; host.append(layer);
  const update = () => {
    if (!alive || !active || suspended) { layer.hidden = true; return; }
    layer.hidden = false;
    const canvasRect = preview.canvas.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
    Object.assign(layer.style, { left: `${canvasRect.left - hostRect.left}px`, top: `${canvasRect.top - hostRect.top}px`,
      width: `${canvasRect.width}px`, height: `${canvasRect.height}px` });
    // Preserve focused buttons on resize/scroll; never replace the whole layer each frame.
    const targets = previewSelectionTargets(spec, preview.getDocument(), preview.inspect());
    const ids = new Set(targets.map(target => target.rowId));
    for (const child of [...layer.children]) if (!ids.has(child.dataset.rowId)) child.remove();
    for (const target of targets) {
      let button = [...layer.children].find(child => child.dataset.rowId === target.rowId);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'selection-target';
        button.dataset.rowId = target.rowId; button.setAttribute('aria-label', `选择：${target.label}`);
        button.title = target.label;
        button.addEventListener('click', event => { event.stopPropagation(); onSelect(target.rowId); });
        layer.append(button);
      }
      const b = target.bounds;
      Object.assign(button.style, { left: `${100 * b.x / spec.canvas.width}%`, top: `${100 * b.y / spec.canvas.height}%`,
        width: `${100 * b.width / spec.canvas.width}%`, height: `${100 * b.height / spec.canvas.height}%` });
    }
  };
  layer.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onExit(); }
  });
  // Selection must not start a Pixi drag or a page swipe through the canvas.
  for (const type of ['pointerdown', 'pointerup', 'click']) layer.addEventListener(type, event => event.stopPropagation());
  const observer = new ResizeObserver(update); observer.observe(preview.canvas);
  const unsubscribe = preview.subscribe(event => { if (['change', 'scroll'].includes(event.type)) update(); });
  return Object.freeze({
    setActive(value) { const entering = value && !active; active = value; update(); if (entering && !suspended) layer.querySelector('button')?.focus(); },
    setSuspended(value) { if (value === suspended) return; suspended = value; update(); },
    destroy() { alive = false; observer.disconnect(); unsubscribe(); layer.remove(); },
  });
}
