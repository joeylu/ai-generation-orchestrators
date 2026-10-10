/** Thin workspace adapter. Owns Pixi and panel-session lifetime, never game side effects. */
import { createTreePreview, componentCore } from './workspace/component-browser.mjs';
import { validatePanelBundle } from './panel-bundle.mjs';
import { attachPanelSession } from './state.mjs';
import { attachLayoutSession } from './layout-session.mjs';
import { attachInputEditor } from './input-editor.mjs';
import { attachPanelVisuals } from './panel-visuals.mjs';
import { attachWorkbenchSelection } from './workbench-selection.mjs';
export const browserCore = componentCore;

function decode(resource, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const clean = () => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort); };
    const abort = () => { clean(); image.src = ''; reject(new Error('WORKBENCH_RENDER_ABORTED')); };
    image.onload = () => { clean(); resolve(image); };
    image.onerror = () => { clean(); reject(new Error('WORKBENCH_IMAGE_DECODE')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    image.src = `data:${resource.mime};base64,${resource.base64}`;
  });
}
export function createWorkbenchRenderer(host, onEvent, onError, onSelect = () => {}, onSelectionExit = () => {}) {
  let ticket = 0, mounted, pending, disposed = false, interactionLocked = false;
  const close = item => { if (!item) return; item.controller.abort(); item.selection?.destroy(); item.detachVisuals?.(); item.detachInputEditor?.(); item.layoutSession?.destroy(); item.session?.destroy(); item.preview?.destroy(); item.element.remove(); };
  const lock = item => {
    if (!item || item.lockedControls) return;
    item.session?.setInteractionLocked(true);
    const nodes = item.preview.inspect().nodes;
    item.lockedControls = nodes.filter(node => ['Slider', 'Switch', 'Select', 'Button', 'Tabs', 'Input'].includes(node.type)).map(node => ({ id: node.id, enabled: node.enabled }));
    for (const node of nodes.filter(node => node.type === 'ScrollView')) item.preview.setValue(node.id, node.value);
    // setEnabled cancels in-flight gestures as well as closing select popups.
    for (const node of item.lockedControls) item.preview.setEnabled(node.id, false);
  };
  return Object.freeze({
    async load(input, isCurrent = () => true) {
      if (disposed) throw new Error('WORKBENCH_RENDER_DESTROYED');
      const own = ++ticket; close(pending); pending = undefined;
      let candidate;
      try {
        const bundle = await validatePanelBundle(input, browserCore);
        if (own !== ticket || !isCurrent()) return { status: 'STALE' };
        candidate = { controller: new AbortController(), element: document.createElement('div') };
        if (['0.7.3', '0.8.0', '0.9.0', '0.10.0', '0.11.0', '0.12.0', '0.13.0', '0.14.0', '0.15.0', '0.16.0', '0.17.0', '0.18.0', '0.19.0', '0.20.0','0.21.0','0.22.0','0.23.0','0.24.0','0.25.0','0.26.0','0.27.0','0.28.0'].includes(bundle.compilerVersion)) {
          // Compact forms retain their authored size in a wide Studio preview.
          // The existing canvas CSS still scales them down on smaller screens.
          candidate.element.style.width = '100%';
          candidate.element.style.maxWidth = `${bundle.spec.canvas.width}px`;
          candidate.element.style.marginInline = 'auto';
        }
        pending = candidate;
        candidate.preview = await createTreePreview(candidate.element, error => {
          // A failed replacement must not silence the still-mounted renderer.
          // Candidate failures belong to this load operation, not the old panel.
          candidate.failure = error;
          if (!disposed && mounted === candidate) onError(error);
        });
        if (own !== ticket || !isCurrent()) { close(candidate); return { status: 'STALE' }; }
        const resources = new Map(bundle.componentBundle.resources.map(r => [r.path, r]));
        await candidate.preview.load(bundle.componentBundle.document, candidate.controller.signal, (path, signal) => {
          const resource = resources.get(path); if (!resource || resource.mime !== 'image/png') throw new Error('WORKBENCH_IMAGE_MISSING');
          return decode(resource, signal);
        });
        if (own !== ticket || !isCurrent()) { close(candidate); return { status: 'STALE' }; }
        if (candidate.failure) throw candidate.failure;
        candidate.detachVisuals = attachPanelVisuals(bundle, candidate.preview);
        candidate.session = attachPanelSession(bundle.spec, candidate.preview, event => onEvent(event, candidate.session.getState()), bundle.state, ['0.24.0','0.25.0'].includes(bundle.compilerVersion)?'grouped-v2':['0.19.0','0.20.0','0.21.0','0.22.0','0.23.0','0.24.0','0.25.0','0.26.0','0.27.0','0.28.0'].includes(bundle.compilerVersion)?'minimal-v1':['0.16.0','0.17.0', '0.18.0'].includes(bundle.compilerVersion)?'focused-v1':undefined);
        candidate.detachInputEditor = attachInputEditor(candidate.element, bundle.spec, candidate.preview, candidate.session);
        candidate.layoutSession = attachLayoutSession(bundle.spec, candidate.preview);
        candidate.selection = attachWorkbenchSelection(candidate.element, bundle.spec, candidate.preview, onSelect, onSelectionExit);
        candidate.selection.setSuspended(interactionLocked);
        if (interactionLocked) lock(candidate);
        close(mounted); mounted = candidate; pending = undefined;
        host.replaceChildren(candidate.element);
        return { status: 'READY', state: candidate.session.getState() };
      } catch (error) {
        close(candidate); if (pending === candidate) pending = undefined;
        if (own !== ticket) return { status: 'STALE' };
        throw error;
      }
    },
    setInteractionLocked(value) {
      if (disposed || value === interactionLocked) return;
      interactionLocked = value; host.inert = value;
      mounted?.selection?.setSuspended(value);
      if (value) lock(mounted);
      else if (mounted?.lockedControls) {
        for (const node of mounted.lockedControls) mounted.preview.setEnabled(node.id, node.enabled);
        mounted.lockedControls = null;
        mounted.session?.setInteractionLocked(false);
      }
    },
    setSelectionMode(value) { mounted?.selection?.setActive(value); },
    setSelectedRow(rowId) { mounted?.selection?.setSelectedRow(rowId); },
    getState() { if (!mounted || disposed) throw new Error('WORKBENCH_RENDER_EMPTY'); return mounted.session.getState(); },
    setProgress(fieldId, value) {
      if (!mounted || disposed) throw new Error('WORKBENCH_RENDER_EMPTY');
      if (interactionLocked) throw new Error('WORKBENCH_BUSY');
      mounted.session.setProgress(fieldId, value);
      return mounted.session.getState();
    },
    setText(fieldId, value) {
      if (!mounted || disposed) throw new Error('WORKBENCH_RENDER_EMPTY');
      if (interactionLocked) throw new Error('WORKBENCH_BUSY');
      mounted.session.setText(fieldId, value);
      return mounted.session.getState();
    },
    inspect() { return mounted?.preview.inspect() ?? { empty: true }; },
    clear() { if (disposed) return; ++ticket; close(pending); close(mounted); pending = mounted = undefined; host.replaceChildren(); },
    destroy() { if (disposed) return; disposed = true; ++ticket; close(pending); close(mounted); pending = mounted = undefined; host.replaceChildren(); },
  });
}
