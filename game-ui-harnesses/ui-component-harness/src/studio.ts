import './studio.css';
import { recognizeReference, encodeReference } from './studio-vision.ts';
import { walkNodes, type UiDocument } from './tree-contract.ts';
import { createTreePreview, type TreePreview } from './tree-runtime.ts';
import { compileMotionSystem, type MotionStyle, type MotionSystemDocument } from './motion-system.ts';
import { MotionPlayer } from './motion.ts';
import { createBundle, validateBundle, bundleResources, type UiBundle, type ResourceInput } from './bundle.ts';

type Scheme = 'original' | MotionStyle;
type Reference = { source: string; width: number; height: number; file: string };
type View = { scheme: Scheme; host: HTMLElement; preview: TreePreview; timeline?: MotionPlayer; resize: ResizeObserver; activations: number };
const schemes: Scheme[] = ['original', 'playful', 'premium', 'corporate'];
const names: Record<Scheme, string> = { original: '原样', playful: '轻快', premium: '精致', corporate: '稳重' };
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id); if (!element) throw new Error(`MISSING_STUDIO_ELEMENT: ${id}`); return element as T;
};
const controls = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
let bundle: UiBundle | undefined, reference: Reference | undefined;
let resources: ResourceInput[] = [], selected: Scheme = 'original', compare = false, filename = '';
let views: View[] = [], busy = false, generation = 0, controller = new AbortController(), thumbnail: string | undefined;
let analysis = { status: 'Idle', summary: '' };
let originalSystem: MotionSystemDocument | undefined, lastError: string | null = null;

function isCancelled(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError'; }
function abortError(): DOMException { return new DOMException('Superseded preview', 'AbortError'); }
function disposeViews() {
  const previous = views; views = [];
  const failures: unknown[] = [];
  for (const view of previous) {
    view.resize.disconnect();
    try { view.timeline?.destroy(); } catch (error) { failures.push(error); }
    try { view.preview.destroy(); } catch (error) { failures.push(error); }
  }
  $('comparison-grid').replaceChildren();
  if (failures.length) throw new AggregateError(failures, 'Preview cleanup failed');
}
function forgetReference() {
  if (thumbnail) URL.revokeObjectURL(thumbnail); thumbnail = undefined;
  $('reference-image').removeAttribute('src'); reference = undefined;
}
function sync() {
  const ready = Boolean(bundle && views.length && !busy);
  document.body.dataset.ready = String(ready); document.body.dataset.busy = String(busy);
  document.body.dataset.reference = String(Boolean(reference));
  $('drop-zone').hidden = Boolean(reference);
  $('studio-export').toggleAttribute('disabled', !ready);
  $('studio-compare').toggleAttribute('disabled', !ready);
  $('studio-compare').setAttribute('aria-pressed', String(compare));
  $('studio-replay').toggleAttribute('disabled', !ready || (selected === 'original' && !bundle?.motion));
  $('studio-reset').toggleAttribute('disabled', !bundle && !reference && !busy && !lastError);
  $('studio-stage').hidden = !bundle;
  $('studio-empty').hidden = Boolean(bundle) || busy;
  $('main-preview').hidden = compare; $('comparison-grid').hidden = !compare;
  $('reference-preview').hidden = !reference;
  $('analysis-state').hidden = analysis.status === 'Idle';
  $('analysis-summary').textContent = analysis.summary;
  $('canvas-name').textContent = filename || '效果画布';
  $('scheme-name').textContent = ready ? names[selected] : '等待参考图';
  $('reference-name').textContent = filename;
  $('reference-meta').textContent = reference ? `${reference.width} × ${reference.height}` : '';
  $('studio-status').textContent = busy ? analysis.status === 'Analyzing' ? '正在识别组件语义…' : '正在准备画布…' : ready ? '可以预览与导出'
    : analysis.status === 'Unresolved' ? '组件语义尚不确定，请提供更清晰的参考图'
    : analysis.status === 'Custom-required' ? '这张图需要当前组件库之外的组件' : analysis.status === 'Failed' ? '识图未完成' : '添加一张参考图，开始预览';
  $('studio-hint').textContent = !ready ? '参考图将发送至已配置的识图服务进行组件分析' : '直接操作画布中的组件，体验当前方案';
  for (const button of controls<HTMLButtonElement>('#scheme-options [data-scheme], .comparison-title[data-scheme]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scheme === selected)); button.disabled = !ready;
  }
  for (const card of controls<HTMLElement>('.comparison-card[data-scheme]')) card.dataset.selected = String(card.dataset.scheme === selected);

}
function reset() {
  generation++; controller.abort(abortError()); controller = new AbortController();
  try { disposeViews(); } finally {
    bundle = undefined; resources = []; originalSystem = undefined; forgetReference(); filename = ''; selected = 'original'; compare = false; analysis = { status: 'Idle', summary: '' }; busy = false;
    lastError = null; $('studio-error').hidden = true; delete $('studio-error').dataset.errorDetail; sync();
  }
}
function fail(error: unknown, message: string) {
  if (isCancelled(error)) return;
  const cause = error instanceof Error && error.cause instanceof Error ? `; cause: ${error.cause.name}: ${error.cause.message}` : '';
  const reason = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)) + cause;
  try { reset(); } catch (cleanupError) { lastError = `${reason}; cleanup: ${String(cleanupError)}`; }
  lastError ??= reason;
  if (reason.includes('VISION_NOT_CONFIGURED')) message = '识图服务尚未连接，请先配置 MCP 服务。';
  else if (/VISION_|TimeoutError/.test(reason)) message = '识图未完成或结果未通过校验。请检查服务记录；已提交的识图任务可能仍在运行。';
  if (reason.startsWith('Error: STUDIO_VISION_FAILED') && !reason.includes('VISION_NOT_CONFIGURED')) message = '图片已读取，但识图结果未能完整接收或通过校验。请检查识图服务记录。';
  if (reason.startsWith('Error: STUDIO_CONTRACT_FAILED')) message = '识图已完成，但组件方案未通过校验，暂时无法预览。';
  if (reason.startsWith('Error: STUDIO_CANVAS_FAILED')) message = '识图已完成，但当前浏览器未能创建画布。请刷新页面或检查浏览器图形支持。';
  $('studio-error').dataset.errorDetail = reason;
  analysis = { status: 'Failed', summary: message };
  $('error-message').textContent = message; $('studio-error').hidden = false; sync();
}
function action(work: () => void | Promise<void>, message = '预览暂时无法完成，请重新添加图片后再试。') {
  return () => { Promise.resolve().then(work).catch(error => fail(error, message)); };
}
function begin() {
  generation++; controller.abort(abortError()); controller = new AbortController();
  busy = true; lastError = null; $('studio-error').hidden = true; delete $('studio-error').dataset.errorDetail;
  disposeViews(); sync();
  const ticket = generation, signal = controller.signal;
  return { ticket, signal, check: () => { if (ticket !== generation || signal.aborted) throw abortError(); } };
}
async function decode(resource: ResourceInput, signal: AbortSignal): Promise<HTMLImageElement> {
  if (signal.aborted) throw signal.reason;
  const image = new Image(), url = URL.createObjectURL(new Blob([new Uint8Array(resource.bytes).buffer], { type: resource.mime }));
  try {
    return await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('IMAGE_DECODE_TIMEOUT')), 15000);
      const abort = () => finish(signal.reason ?? abortError());
      const finish = (error?: unknown) => {
        window.clearTimeout(timeout); signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null;
        if (error) { image.src = ''; reject(error); }
        else if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) reject(new Error('IMAGE_DIMENSION_LIMIT'));
        else resolve(image);
      };
      image.onload = () => finish(); image.onerror = () => finish(new Error('IMAGE_DECODE_FAILED'));
      signal.addEventListener('abort', abort, { once: true }); image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
function systemFor(scheme: Scheme, document: UiDocument): MotionSystemDocument | null {
  if (scheme === 'original') return null;
  // Preserve an imported selected system (including subsets) until a different
  // whole-canvas style is chosen. Scheme switching never rewrites UI values.
  if (originalSystem?.style === scheme) return originalSystem;
  return compileMotionSystem({ id: `studio-${scheme}`, style: scheme, targets: walkNodes(document).map(node => node.id) }, document);
}
function activeView(): View | undefined { return views.find(view => view.scheme === selected); }
function currentDocument(): UiDocument {
  const current = activeView()?.preview.getDocument() ?? bundle?.document;
  if (!current || current.schemaVersion !== '0.2') throw new Error('NO_STUDIO_DOCUMENT'); return current;
}
function fit(view: View) {
  const canvas = view.preview.canvas, document = view.preview.getDocument();
  const style = getComputedStyle(view.host);
  const width = view.host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 16;
  const height = view.host.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 16;
  const scale = Math.max(0.01, Math.min(1, Math.max(1, width) / document.canvas.width, Math.max(1, height) / document.canvas.height));
  // DOM fit leaves the logical document untouched. Runtime pointer mapping uses
  // canvas.getBoundingClientRect(), so even a large imported canvas fits mobile.
  canvas.style.width = `${document.canvas.width * scale}px`; canvas.style.height = `${document.canvas.height * scale}px`;
}
function replay(view = activeView()) {
  if (!view) return;
  view.timeline?.replay();
  const system = view.preview.getMotionSystem(); if (!system) return;
  const root = view.preview.getDocument().root, binding = system.bindings.find(item => item.targetId === root.id);
  if (binding) view.preview.playMotionAction(root.id, binding.actions.includes('stagger') ? 'stagger' : 'enter');
  else for (const item of system.bindings) if (item.actions.includes('enter')) view.preview.playMotionAction(item.targetId, 'enter');
}
async function mount(document: UiDocument, request: ReturnType<typeof begin>) {
  if (!bundle) throw new Error('NO_STUDIO_BUNDLE');
  const source = new Map(resources.map(resource => [resource.path, resource]));
  const timelineDocument = bundle.motion;
  const chosen = compare ? schemes : [selected];
  sync();
  for (const scheme of chosen) {
    request.check();
    let host = $('main-preview');
    if (compare) {
      const card = window.document.createElement('article'); card.className = 'comparison-card'; card.dataset.scheme = scheme;
      const title = window.document.createElement('button'); title.className = 'comparison-title'; title.dataset.scheme = scheme;
      title.textContent = names[scheme]; title.type = 'button'; title.setAttribute('aria-label', `选择${names[scheme]}方案`);
      title.addEventListener('click', action(() => selectScheme(scheme)));
      host = window.document.createElement('div'); host.className = 'preview-host';
      card.append(title, host); $('comparison-grid').append(card);
    }
    let preview: TreePreview | undefined, registered = false;
    try {
      preview = await createTreePreview(host, error => { if (request.ticket === generation) fail(error, '画布无法继续显示，请重新打开图片或方案。'); });
      request.check();
      // Keep image/texture ownership local to each comparison preview.
      const decoded = new Map<string, Promise<HTMLImageElement>>();
      const resource = (path: string) => {
        const found = source.get(path.startsWith('./') ? path.slice(2) : path);
        if (!found) throw new Error('MISSING_LOCAL_RESOURCE'); return found;
      };
      await preview.load(document, request.signal, (path, signal) => {
        if (!decoded.has(path)) decoded.set(path, decode(resource(path), signal)); return decoded.get(path)!;
      }, async path => new Uint8Array(resource(path).bytes).buffer);
      request.check();
      preview.canvas.setAttribute('aria-label', `${names[scheme]}方案预览`);
      preview.setMotionSystem(systemFor(scheme, document));
      const view: View = { scheme, host, preview, resize: new ResizeObserver(() => { if (views.includes(view)) fit(view); }), activations: 0 };
      if (timelineDocument) view.timeline = new MotionPlayer(timelineDocument, document, preview,
        { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }, undefined,
        error => { if (request.ticket === generation) fail(error, '动效无法继续播放，请重新打开方案。'); });
      preview.subscribe(event => {
        if (event.type === 'activate') view.activations++;
        const trigger = view.timeline?.motion.trigger;
        if (trigger?.type === 'event' && trigger.targetId === event.id && trigger.event === event.type) view.timeline?.replay();
      });
      views.push(view); registered = true; view.resize.observe(host); fit(view);
    } catch (error) { if (!registered) preview?.destroy(); throw error; }
  }
  request.check(); busy = false; sync(); for (const view of views) fit(view);
}
async function selectScheme(scheme: Scheme) {
  if (!bundle || busy || !schemes.includes(scheme)) return;
  if (compare) { selected = scheme; sync(); return; }
  const view = activeView(); if (!view) return;
  view.timeline?.stop(); view.preview.resetMotion();
  view.preview.setMotionSystem(systemFor(scheme, view.preview.getDocument()));
  view.scheme = scheme; selected = scheme; view.preview.canvas.setAttribute('aria-label', `${names[scheme]}方案预览`);
  sync();
  if (scheme !== 'original' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) replay(view);
}
async function toggleCompare() {
  if (!bundle || busy) return;
  const document = currentDocument(); compare = !compare;
  const request = begin();
  try { await mount(document, request); } catch (error) { if (request.ticket === generation) throw error; }
}
async function upload(file: File) {
  reset(); filename = file.name;
  const request = begin();
  let stage = 'IMAGE';
  try {
    const mime = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? '');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('UNSUPPORTED_IMAGE_TYPE');
    if (!file.size || file.size > 2 * 1024 * 1024) throw new Error('IMAGE_SIZE_LIMIT');
    const bytes = new Uint8Array(await file.arrayBuffer()); request.check();
    const digest = await crypto.subtle.digest('SHA-256', bytes); request.check();
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const ext = mime.split('/')[1];
    const resource: ResourceInput = { path: `assets/${hash}.${ext}`, bytes, mime };
    const decoded = await decode(resource, request.signal); request.check();
    reference = { source: resource.path, width: decoded.naturalWidth, height: decoded.naturalHeight, file: file.name };
    resources = [resource];
    thumbnail = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: mime })); $('reference-image').setAttribute('src', thumbnail);
    analysis = { status: 'Analyzing', summary: '正在理解参考图中的组件类型、层级与可见状态…' }; sync();
    stage = 'VISION';
    const result = await recognizeReference({ path: resource.path, sha256: hash, width: reference.width, height: reference.height, mime, base64: encodeReference(bytes) }, request.signal,
      () => { request.check(); analysis.summary = '识图任务正在处理，结果完成后会自动显示。'; sync(); });
    request.check(); analysis = { status: result.status, summary: result.summary };
    if (result.status !== 'Ready') { busy = false; sync(); return; }
    stage = 'CONTRACT';
    bundle = await createBundle(result.document, resources, { kind: 'user-provided', description: 'User reference with LLM-produced semantic intent and layout; strict deterministic compilation passed. Model output is not human visual acceptance.' });
    request.check(); stage = 'CANVAS'; await mount(bundle.document as UiDocument, request);
  } catch (error) { if (request.ticket === generation) throw new Error(`STUDIO_${stage}_FAILED`, { cause: error }); }
}
async function openBundle(file: File) {
  reset(); filename = file.name;
  const request = begin();
  try {
    if (!file.size || file.size > 100 * 1024 * 1024) throw new Error('BUNDLE_SIZE_LIMIT');
    const candidate = await validateBundle(JSON.parse(await file.text())); request.check();
    if (candidate.document.schemaVersion !== '0.2') throw new Error('LEGACY_BUNDLE_REQUIRES_EXPLICIT_CONVERSION');
    resources = bundleResources(candidate); bundle = candidate; originalSystem = candidate.motionSystem;
    selected = candidate.motionSystem?.style ?? 'original';
    analysis = { status: 'Imported', summary: '已恢复保存的组件方案' };
    await mount(candidate.document, request);
  } catch (error) { if (request.ticket === generation) throw error; }
}
async function exportSelected(): Promise<UiBundle> {
  const view = activeView();
  if (!bundle || !view || busy) throw new Error('NO_READY_PREVIEW');
  const ticket = generation, scheme = selected;
  const result = await createBundle(view.preview.getDocument(), resources, bundle.provenance, bundle.motion, view.preview.getMotionSystem() ?? undefined);
  if (ticket !== generation || scheme !== selected || busy) throw abortError();
  return validateBundle(result);
}
async function download() {
  const exported = await exportSelected();
  const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `${(filename.replace(/\.[^.]+$/, '') || 'ui-preview').replace(/[<>:"/\\|?*]/g, '-')}-${names[selected]}.ui-bundle.json`;
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('studio-status').textContent = `已导出${names[selected]}方案`;
}
$('reference-file').addEventListener('change', action(async () => {
  const input = $<HTMLInputElement>('reference-file'), file = input.files?.[0]; input.value = ''; if (file) await upload(file);
}, '图片无法打开，请选择有效的 PNG、JPG 或 WebP 图片（不超过 2 MB）。'));
$('replace-image').addEventListener('click', () => $<HTMLInputElement>('reference-file').click());
$('open-bundle').addEventListener('change', action(async () => {
  const input = $<HTMLInputElement>('open-bundle'), file = input.files?.[0]; input.value = ''; if (file) await openBundle(file);
}, '方案文件不完整、已损坏或版本不受支持，请重新导出新版组件包后再试。'));
for (const button of controls<HTMLButtonElement>('#scheme-options [data-scheme]')) button.addEventListener('click', action(() => selectScheme(button.dataset.scheme as Scheme)));
$('studio-compare').addEventListener('click', action(toggleCompare));
$('studio-replay').addEventListener('click', action(() => { if (compare) for (const view of views) replay(view); else replay(); }));
$('studio-reset').addEventListener('click', action(reset));
$('studio-export').addEventListener('click', action(download, '导出未完成，请重新打开图片或方案后再试。'));
$('dismiss-error').addEventListener('click', () => { $('studio-error').hidden = true; delete $('studio-error').dataset.errorDetail; lastError = null; sync(); });
for (const dropZone of [$('drop-zone'), $('reference-preview')]) {
  for (const event of ['dragenter', 'dragover']) dropZone.addEventListener(event, event => { event.preventDefault(); dropZone.dataset.dragging = 'true'; });
  for (const event of ['dragleave', 'drop']) dropZone.addEventListener(event, event => { event.preventDefault(); delete dropZone.dataset.dragging; });
  dropZone.addEventListener('drop', event => {
    const files = [...(event.dataTransfer?.files ?? [])];
    action(async () => { if (files.length !== 1) throw new Error('ONE_REFERENCE_REQUIRED'); await upload(files[0]); },
      '请每次拖入一张有效图片（PNG、JPG 或 WebP，不超过 2 MB）。')();
  });
}
window.addEventListener('pagehide', () => reset(), { once: true });
const studio = {
  snapshot: () => ({ ready: Boolean(bundle && views.length && !busy), busy, scheme: selected, compare, kind: bundle?.document.schemaVersion === '0.2' ? bundle.document.root.type : null, analysis: { ...analysis },
    filename, resourceCount: resources.length, error: lastError,
    views: views.map(view => ({ scheme: view.scheme, document: view.preview.getDocument(), motionSystem: view.preview.getMotionSystem(),
      inspection: view.preview.inspect(), motionSnapshot: view.preview.inspectMotionSystem(), timelineSnapshot: view.timeline?.snapshot() ?? null, activations: view.activations })) }),
  exportSelected,
};
declare global { interface Window { uiStudio: typeof studio } }
window.uiStudio = studio;
sync();
