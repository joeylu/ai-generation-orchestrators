/** Static workspace preview. The component renderer is a read-only development dependency. */
import { createTreePreview } from '../../ui-component-harness/src/tree-runtime.ts';
import { compileTree } from '../../ui-component-harness/src/tree-compiler.ts';
import { validateDocument } from '../../ui-component-harness/src/tree-contract.ts';
import { createBundle, validateBundle, bundleResources } from '../../ui-component-harness/src/bundle.ts';
import { createPanelBundle, validatePanelBundle, panelBundleAssetInputs } from './panel-bundle.mjs';
import { attachPanelSession } from './state.mjs';
import { attachLayoutSession } from './layout-session.mjs';
import { attachInputEditor } from './input-editor.mjs';

const core = { compileTree, validateDocument, createBundle, validateBundle, bundleResources };
const host = document.getElementById('canvas-host'), status = document.getElementById('status');
const output = document.getElementById('state'), eventOutput = document.getElementById('event');
let bundle, runtime, session, layoutSession, controller, ticket = 0, unsubscribe = () => {}, detachInputEditor = () => {};
const events = [], componentEvents = [];
function renderState() { output.textContent = session ? JSON.stringify(session.getState(), null, 2) : ''; }
function fatal() { status.textContent = '面板加载或交互失败，请检查面板文件。'; status.dataset.state = 'error'; }
function release() {
  controller?.abort(); detachInputEditor(); detachInputEditor = () => {}; layoutSession?.destroy(); layoutSession = undefined; session?.destroy(); unsubscribe(); runtime?.destroy();
  session = undefined; runtime = undefined; controller = undefined; unsubscribe = () => {};
  host.replaceChildren(); document.getElementById('export').disabled = true;
}
function imageFor(resource, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); image.src = ''; reject(new Error('PREVIEW_ABORTED')); };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('PREVIEW_IMAGE_DECODE')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    image.src = `data:${resource.mime};base64,${resource.base64}`;
  });
}
async function importPanel(input) {
  const ownTicket = ++ticket;
  let preview;
  try {
    const checked = await validatePanelBundle(input, core);
    if (ownTicket !== ticket) return;
    release(); events.length = 0; componentEvents.length = 0;
    status.textContent = '正在加载面板…'; status.dataset.state = 'loading';
    controller = new AbortController(); const signal = controller.signal;
    preview = await createTreePreview(host, () => { if (ownTicket === ticket) fatal(); });
    if (ownTicket !== ticket) { preview.destroy(); return; }
    runtime = preview;
    const resources = new Map(checked.componentBundle.resources.map(r => [r.path, r]));
    await preview.load(checked.componentBundle.document, signal, (path, loadSignal) => {
      const resource = resources.get(path);
      if (!resource || resource.mime !== 'image/png') throw new Error('PREVIEW_RESOURCE');
      return imageFor(resource, loadSignal);
    });
    if (ownTicket !== ticket) { preview.destroy(); return; }
    bundle = checked;
    layoutSession = attachLayoutSession(bundle.spec, preview);
    unsubscribe = preview.subscribe(event => { componentEvents.push(event); if (componentEvents.length > 200) componentEvents.shift(); });
    session = attachPanelSession(bundle.spec, preview, event => {
      events.push(event); if (events.length > 100) events.shift();
      eventOutput.textContent = JSON.stringify(event, null, 2); renderState();
    }, bundle.state);
    detachInputEditor = attachInputEditor(host, bundle.spec, preview, session);
    document.getElementById('panel-title').textContent = bundle.spec.title;
    host.style.width = `${bundle.spec.canvas.width}px`;
    host.style.height = `${bundle.spec.canvas.height}px`;
    document.getElementById('export').disabled = false;
    status.textContent = preview.inspect().nodes.some(node => node.type === 'ScrollView')
      ? '可交互预览 · 滚轮或拖动空白处查看更多' : '可交互预览';
    status.dataset.state = 'ready'; renderState();
  } catch (error) {
    if (ownTicket !== ticket) { preview?.destroy(); return; }
    if (preview) release();
    fatal(); throw error;
  }
}
async function exportPanel() {
  if (!session || !bundle) throw new Error('PREVIEW_NOT_READY');
  // Recompile from authored defaults + current semantic state, keeping exact embedded assets.
  return createPanelBundle(bundle.spec, bundle.catalog, core, session.getState(), panelBundleAssetInputs(bundle, core));
}
function destroy() { ++ticket; release(); bundle = undefined; renderState(); status.dataset.state = 'destroyed'; }
window.panelHarness = Object.freeze({
  importBundle: importPanel, exportBundle: exportPanel,
  getState: () => session.getState(),
  setState: state => { session.setState(state); renderState(); },
  setProgress: (fieldId, value) => { session.setProgress(fieldId, value); renderState(); },
  getDocument: () => runtime.getDocument(),
  inspect: () => runtime?.inspect() ?? { destroyed: true },
  events: () => structuredClone(events), componentEvents: () => structuredClone(componentEvents),
  clearEvents: () => { events.length = 0; componentEvents.length = 0; }, destroy,
});
document.getElementById('import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const inputTicket = ++ticket;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('PREVIEW_FILE_LIMIT');
    const text = await file.text(); if (inputTicket !== ticket) return;
    await importPanel(JSON.parse(text));
  } catch { if (inputTicket === ticket) fatal(); } finally { event.target.value = ''; }
});
document.getElementById('export').addEventListener('click', async () => {
  try {
    const saved = await exportPanel(), blob = new Blob([`${JSON.stringify(saved)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `${saved.spec.id}.panel.bundle.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { fatal(); }
});
window.addEventListener('pagehide', destroy, { once: true });
importPanel(JSON.parse(document.getElementById('initial-panel').textContent)).catch(() => {});
