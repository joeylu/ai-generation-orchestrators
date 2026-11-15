export function createLayerReorder({ canEdit, move, kind = 'layer' }) {
  let drag, marker;
  function clear() {
    if (marker) delete marker.dataset.dropSide;
    drag = marker = undefined;
  }
  return function attach(heading, id, peers, group, label) {
    const index = peers.indexOf(id);
    if (index < 0 || peers.length < 2) return;
    const handle = document.createElement('button'), menu = document.createElement('div');
    handle.type = 'button';
    handle.className = 'layer-reorder-handle';
    handle.dataset[kind === 'layer' ? 'reorderLayer' : 'reorderObject'] = id;
    handle.textContent = '↕';
    handle.title = '拖动排序，点击可上移或下移';
    handle.setAttribute('aria-label', (kind === 'layer' ? '调整图层顺序 ' : '调整对象顺序 ') + label);
    handle.setAttribute('aria-expanded', 'false');
    handle.draggable = true;
    menu.className = 'layer-reorder-menu';
    menu.hidden = true;
    function closeMenu() {
      menu.hidden = true;
      handle.setAttribute('aria-expanded', 'false');
    }
    handle.onclick = event => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      handle.setAttribute('aria-expanded', String(!menu.hidden));
    };
    menu.onclick = event => event.stopPropagation();
    heading.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.stopPropagation();
        closeMenu();
        handle.focus();
      }
    });
    function insert(source, target, after) {
      const order = peers.filter(peer => peer !== source);
      order.splice(order.indexOf(target) + Number(after), 0, source);
      if (order.some((peer, i) => peer !== peers[i])) void move(order, source, peers);
    }
    const unit = kind === 'layer' ? '层' : '位';
    for (const [text, delta] of [['上移一' + unit, -1], ['下移一' + unit, 1]]) {
      const button = document.createElement('button'), target = peers[index + delta];
      button.type = 'button';
      button.textContent = text;
      button.disabled = !target;
      button.onclick = () => { if (target && canEdit(id)) insert(id, target, delta > 0); };
      menu.append(button);
    }
    handle.ondragstart = event => {
      if (!canEdit(id)) { event.preventDefault(); return; }
      closeMenu();
      drag = { id, group };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-scene-' + kind, id);
    };
    handle.ondragend = clear;
    const after = event => {
      const rect = heading.getBoundingClientRect();
      return event.clientY > rect.top + rect.height / 2;
    };
    heading.ondragover = event => {
      if (!drag || drag.group !== group || drag.id === id || !canEdit(id)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (marker && marker !== heading) delete marker.dataset.dropSide;
      marker = heading;
      heading.dataset.dropSide = after(event) ? 'after' : 'before';
    };
    heading.ondragleave = event => {
      if (marker === heading && !heading.contains(event.relatedTarget)) {
        delete heading.dataset.dropSide;
        marker = undefined;
      }
    };
    heading.ondrop = event => {
      if (!drag || drag.group !== group || drag.id === id || !canEdit(id)) return;
      event.preventDefault();
      const source = drag.id;
      clear();
      insert(source, id, after(event));
    };
    heading.append(handle, menu);
  };
}
