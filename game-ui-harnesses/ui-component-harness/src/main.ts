import './style.css';
import { VERSION as PIXI_VERSION } from 'pixi.js';
import { createPreview, type Preview, type ButtonInstance } from './pixi-adapter.ts';
import { HarnessError, validateButton, type ButtonContract } from './contract.ts';
import { validateButtonIntent, validatePreviewPolicy } from './intent-compiler.ts';
import { createTreePreview, type TreePreview, type TreeRuntimeEvent } from './tree-runtime.ts';
import { validateDocument, walkNodes, type UiDocument, type UiNode } from './tree-contract.ts';
import { compileTree, validateTreeIntent, validateTreePolicy, type ImageFactsMap } from './tree-compiler.ts';
import { createBundle, validateBundle, bundleResources, type ResourceInput, type BundleProvenance } from './bundle.ts';
import { validateResourceReference } from './resource-reference.ts';
import { fixtureInputs, fixtureStyle } from './fixtures.ts';
import { MotionPlayer, type MotionDocument } from './motion.ts';
import { compileMotionSystem, type MotionAction, type MotionSystemDocument, type MotionStyle } from './motion-system.ts';
import { runProbes } from './probes.ts';

const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const value = document.getElementById(id); if (!value) throw new Error(`MISSING_ELEMENT: ${id}`); return value as T;
};
const json = (value: unknown) => JSON.stringify(value, null, 2);
const parse = (id: string) => JSON.parse(el<HTMLTextAreaElement>(id).value) as unknown;
const resources = new Map<string, ResourceInput>();
const canonical = (source: string) => source.startsWith('./') ? source.slice(2) : source;
let tree: TreePreview | undefined, legacy: Preview | undefined, legacyInstance: ButtonInstance | undefined;
let currentDocument: UiDocument | ButtonContract | undefined;
let provenance: BundleProvenance = { kind: 'programmatic-fixture', description: 'Explicit procedural engineering fixture; not vision recognition.' };
let controller: AbortController | undefined, generation = 0, selectedId = '', activates = 0;
const activationCounts = new Map<string, number>();
let motion: MotionPlayer | undefined, currentMotion: MotionDocument | undefined;
let latestImage: { source: string; width: number; height: number } | undefined, thumbnailUrl: string | undefined;
let probing = false;

function log(value: unknown, kind = '') {
  const row = document.createElement('li'); row.className = kind;
  row.textContent = typeof value === 'string' ? value : JSON.stringify(value);
  const list = el('events'); list.prepend(row); if (list.children.length > 150) list.lastElementChild?.remove();
}
function resetOutput() {
  activationCounts.clear();
  currentDocument = undefined; currentMotion = undefined; selectedId = '';
  el('output-json').textContent = '尚未生成合同'; el('inspector').textContent = '没有实例';
  el('selected-name').textContent = '选择一个节点'; el('tree').replaceChildren();
  el('node-count').textContent = '0'; el('live-counts').textContent = '0 节点 / 0 资源';
  el('motion-system-note').textContent = '加载 v0.2 组件后选择风格';
  el<HTMLTextAreaElement>('motion-system-editor').value = '';
  for (const id of ['apply-motion-system', 'play-system-enter', 'play-system-exit', 'clear-motion-system', 'apply-system-json']) el<HTMLButtonElement>(id).disabled = true;
  for (const id of ['export-bundle', 'show-dialog', 'node-enabled', 'node-value', 'set-node-value']) (el(id) as HTMLButtonElement).disabled = true;
}
function cleanup(keepLegacy = false) {
  const errors: unknown[] = [];
  const oldMotion = motion, oldTree = tree, oldInstance = legacyInstance, oldLegacy = legacy;
  motion = undefined; tree = undefined; legacyInstance = undefined; if (!keepLegacy) legacy = undefined;
  for (const release of [() => oldMotion?.destroy(), () => oldTree?.destroy(), () => oldInstance?.destroy(), () => { if (!keepLegacy) oldLegacy?.destroy(); }]) {
    try { release(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, '实例清理失败');
}
function invalidate(keepLegacy = false) {
  generation++; controller?.abort(new DOMException('加载被新请求替换', 'AbortError')); controller = undefined;
  try { cleanup(keepLegacy); } finally { resetOutput(); }
}
function report(error: unknown) {
  try { invalidate(); } catch (cleanupError) { log(String(cleanupError), 'error'); }
  el('lifecycle').textContent = '失败'; el('render-info').textContent = '实例已清理';
  const area = el('error'); area.hidden = false;
  area.textContent = errorText(error);
  log(area.textContent, 'error');
}
function errorText(error: unknown): string {
  if (error instanceof AggregateError) return `${error.message}: ${error.errors.map(errorText).join('; ')}`;
  return error instanceof HarnessError ? `[${error.stage}] ${error.message}` : error instanceof Error ? error.message : String(error);
}
function action(fn: () => unknown | Promise<unknown>) {
  return () => { void Promise.resolve().then(fn).catch(error => { if (!(error instanceof DOMException && error.name === 'AbortError')) report(error); }); };
}
function begin(keepLegacy = false) {
  invalidate(keepLegacy); const ticket = generation; const pending = new AbortController(); controller = pending;
  if (!probing) { el('probe-report').hidden = true; el('probe-report').textContent = ''; }
  el('error').hidden = true; el('error').textContent = ''; el('lifecycle').textContent = '正在校验输入';
  const check = () => { pending.signal.throwIfAborted(); if (ticket !== generation) throw new DOMException('过期加载已取消', 'AbortError'); };
  return { ticket, signal: pending.signal, check };
}
function refreshResources() {
  el('resource-count').textContent = String(resources.size); const list = el('resources'); list.replaceChildren();
  for (const item of resources.values()) {
    const row = document.createElement('li'); row.textContent = item.path; const hint = document.createElement('small');
    hint.textContent = `${item.mime} · ${(item.bytes.byteLength / 1024).toFixed(1)} KB`; row.append(hint); list.append(row);
  }
}
async function resource(source: string, signal: AbortSignal): Promise<ResourceInput> {
  validateResourceReference(source, '$resource', 'contract'); signal.throwIfAborted();
  const path = canonical(source), prior = resources.get(path); if (prior) return prior;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  const response = await fetch(source, { signal: bounded });
  if (!response.ok) throw new HarnessError('resource', [{ path: source, code: 'RESOURCE_HTTP', message: `HTTP ${response.status}` }]);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
  if (!mime.startsWith('image/') && !mime.startsWith('font/') && !['application/font-woff', 'application/octet-stream'].includes(mime)) throw new Error(`RESOURCE_MIME: ${source}`);
  const bytes = new Uint8Array(await response.arrayBuffer()); bounded.throwIfAborted();
  if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) throw new Error('RESOURCE_SIZE_LIMIT');
  const value = { path, mime, bytes }; resources.set(path, value); refreshResources(); return value;
}
async function decode(item: ResourceInput, signal: AbortSignal): Promise<HTMLImageElement> {
  if (!item.mime.startsWith('image/')) throw new Error(`IMAGE_MIME_REQUIRED: ${item.path}`);
  const url = URL.createObjectURL(new Blob([new Uint8Array(item.bytes).buffer], { type: item.mime }));
  const image = new Image(); image.src = url;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  let abort: () => void = () => {};
  try {
    await Promise.race([image.decode(), new Promise<never>((_, reject) => { abort = () => reject(bounded.reason); if (bounded.aborted) abort(); else bounded.addEventListener('abort', abort, { once: true }); })]);
    bounded.throwIfAborted(); if (!image.naturalWidth || !image.naturalHeight) throw new Error('EMPTY_IMAGE'); return image;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new HarnessError('resource', [{ path: item.path, code: 'IMAGE_DECODE_FAILED', message: error instanceof Error ? error.message : String(error) }]);
  } finally { bounded.removeEventListener('abort', abort); URL.revokeObjectURL(url); }
}
function inspectSelected() {
  const node = tree?.inspect().nodes.find(item => item.id === selectedId);
  el('selected-name').textContent = node ? `${node.type} / ${node.id}` : legacyInstance ? `Button / ${legacyInstance.id}` : '选择一个节点';
  el('inspector').textContent = node ? json(node) : legacyInstance ? json(legacyInstance.snapshot()) : '没有实例';
  const enabled = el<HTMLInputElement>('node-enabled'); enabled.disabled = node ? node.enabled === null : !legacyInstance;
  enabled.checked = node ? node.enabled === true : legacyInstance?.snapshot().enabled ?? false;
  const input = el<HTMLInputElement>('node-value'); input.disabled = !node || node.value === undefined;
  el<HTMLButtonElement>('set-node-value').disabled = input.disabled; input.value = json(node?.value ?? null);
}
function sync() {
  const info = tree?.inspect();
  if (tree && currentDocument) currentDocument = tree.getDocument();
  else if (legacyInstance && currentDocument?.schemaVersion === '0.1') currentDocument = { ...currentDocument, props: { enabled: legacyInstance.snapshot().enabled } };
  if (currentDocument) el('output-json').textContent = json(currentDocument);
  el('live-counts').textContent = info ? `${info.nodes.length} 节点 / ${info.resources} 资源 / ${info.externalListeners} 监听` : legacy ? `${legacy.inspect().instances} 实例 / ${legacy.inspect().externalListeners} 监听` : '0 节点 / 0 资源';
  el('node-count').textContent = String(info?.nodes.length ?? (legacyInstance ? 1 : 0));
  const list = el('tree'); list.replaceChildren();
  for (const node of info?.nodes ?? []) {
    const button = document.createElement('button'); button.textContent = node.id;
    button.setAttribute('aria-pressed', String(node.id === selectedId)); button.dataset.nodeId = node.id;
    const type = document.createElement('small'); type.textContent = node.type; button.append(type);
    button.addEventListener('click', () => { selectedId = node.id; sync(); }); list.append(button);
  }
  inspectSelected();
  for (const id of ['apply-motion-system', 'apply-system-json']) el<HTMLButtonElement>(id).disabled = !tree;
  const system = tree?.getMotionSystem();
  for (const id of ['play-system-enter', 'play-system-exit', 'clear-motion-system']) el<HTMLButtonElement>(id).disabled = !system;
}
function event(event: TreeRuntimeEvent) {
  log(event, event.type); if (event.type === 'activate') {
    activates++; activationCounts.set(event.id, (activationCounts.get(event.id) ?? 0) + 1);
  }
  if (event.type === 'destroy') {
    const trigger = motion?.motion.trigger;
    if (motion?.motion.tracks.some(track => track.targetId === event.id) || (trigger?.type === 'event' && trigger.targetId === event.id)) {
      const stale = motion; motion = undefined; currentMotion = undefined; stale?.destroy();
      el<HTMLTextAreaElement>('motion-editor').value = '';
    }
    return;
  }
  if (event.type === 'activate' && event.id === 'dialog-close' && currentDocument?.id === 'fixture-gallery') tree?.setValue('dialog', false);
  const trigger = motion?.motion.trigger;
  if (trigger?.type === 'event' && trigger.targetId === event.id && trigger.event === event.type) motion?.replay();
  sync();
}
async function mountTree(documentInput: unknown, request: ReturnType<typeof begin>, decoded = new Map<string, HTMLImageElement>()) {
  const contract = validateDocument(documentInput); request.check(); el('lifecycle').textContent = '正在准备 PixiJS 资源';
  const preview = await createTreePreview(el('canvas-host'), error => { if (request.ticket === generation) report(error); });
  try {
    request.check(); tree = preview; preview.subscribe(event);
    await preview.load(contract, request.signal, async (source, signal) => {
      const existing = decoded.get(source); return existing ?? decode(await resource(source, signal), signal);
    }, async (source, signal) => new Uint8Array((await resource(source, signal)).bytes).buffer);
    request.check(); preview.setZoom(Number(el<HTMLSelectElement>('zoom').value)); currentDocument = contract;
    selectedId = contract.root.id; el('lifecycle').textContent = '运行中'; el('render-info').textContent = 'PixiJS · WebGL';
    el<HTMLButtonElement>('export-bundle').disabled = false; el<HTMLButtonElement>('show-dialog').disabled = contract.id !== 'fixture-gallery';
    el<HTMLButtonElement>('legacy-probes').disabled = true; sync();
  } catch (error) { if (tree === preview) tree = undefined; preview.destroy(); throw error; }
}
async function compile(input: unknown = parse('intent-editor'), settings: unknown = parse('policy-editor')) {
  const request = begin();
  try {
    const intent = validateTreeIntent(input); const policy = validateTreePolicy(settings);
    const sources = new Set<string>();
    const collect = (node: typeof intent.root) => { if (node.componentType === 'Image') sources.add(node.props.source); if ('children' in node) node.children.forEach(collect); };
    collect(intent.root); const facts: ImageFactsMap = {}; const decoded = new Map<string, HTMLImageElement>();
    for (const source of sources) { const image = await decode(await resource(source, request.signal), request.signal); request.check(); facts[source] = { width: image.naturalWidth, height: image.naturalHeight }; decoded.set(source, image); }
    const result = compileTree(intent, facts, policy); request.check();
    await mountTree(result, request, decoded); el('source-note').textContent = provenance.description;
    log({ type: 'compile', id: result.id, source: policy.layoutSource.kind, imageFacts: facts }); return result;
  } catch (error) { if (request.ticket === generation) report(error); throw error; }
}
async function loadDocument(input: unknown) {
  const request = begin(); try { await mountTree(input, request); } catch (error) { if (request.ticket === generation) report(error); throw error; }
}
async function importDocument(input: unknown) {
  provenance = { kind: 'user-provided', description: '用户导入组件合同 · 原始资源按声明引用加载' };
  if ((input as { schemaVersion?: string })?.schemaVersion === '0.1') await loadLegacy(validateButton(input));
  else await loadDocument(input);
  el('source-note').textContent = provenance.description;
}
const legacyIntent = { intentVersion: '0.1', id: 'legacy-button', componentType: 'Button', visual: { source: './fixtures/button.svg', mode: 'whole-image' }, text: { mode: 'baked', value: 'TEST BUTTON / ENGINEERING FIXTURE' } };
const legacyPolicy = { canvas: { width: 640, height: 400 }, placement: 'center', scale: 1, enabled: true };
async function loadLegacy(contract?: ButtonContract) {
  const request = begin(true);
  try {
    if (!legacy) { const created = await createPreview(el('canvas-host'), error => { report(error); }); if (request.ticket !== generation) { created.destroy(); request.check(); } legacy = created; }
    const imageResolver = async (source: string, signal: AbortSignal) => decode(await resource(source, signal), signal);
    if (contract) { currentDocument = validateButton(contract); legacyInstance = await legacy.load(contract, request.signal, imageResolver); }
    else {
      const input = validateButtonIntent(legacyIntent), policy = validatePreviewPolicy(legacyPolicy);
      const result = await legacy.loadIntent(input, policy, request.signal, () => {}, imageResolver); legacyInstance = result.instance; currentDocument = result.compilation.contract;
    }
    request.check(); legacyInstance.subscribe(value => { if (value.type === 'activate') activates++; log(value, value.type); sync(); });
    legacy.setZoom(Number(el<HTMLSelectElement>('zoom').value)); el('lifecycle').textContent = '运行中'; el('render-info').textContent = 'PixiJS · v0.1 Button';
    el('canvas-title').textContent = 'v0.1 整图 Button'; el('source-note').textContent = provenance.description;
    el<HTMLButtonElement>('legacy-probes').disabled = !!contract; el<HTMLButtonElement>('export-bundle').disabled = false; sync();
  } catch (error) { if (request.ticket === generation) report(error); throw error; }
}
async function exportBundle() {
  if (!currentDocument) throw new Error('NO_SUCCESSFUL_DOCUMENT');
  const contract = tree ? tree.getDocument() : currentDocument;
  const timeline = currentMotion, system = tree?.getMotionSystem() ?? undefined;
  const needed = new Set<string>();
  if (contract.schemaVersion === '0.1') needed.add(contract.slots.visual.props.source);
  else for (const node of walkNodes(contract)) { if (node.type === 'Image') needed.add(node.props.source); if (node.type === 'Text' && node.props.fontSource) needed.add(node.props.fontSource); }
  const signal = controller?.signal ?? new AbortController().signal;
  const data = await Promise.all([...needed].map(source => resource(source, signal)));
  return createBundle(contract, data, provenance, timeline, system);
}
async function importBundle(input: unknown) {
  invalidate(); const ticket = generation;
  const bundle = await validateBundle(input); if (ticket !== generation) throw new DOMException('过期导入', 'AbortError');
  const imported = await bundleResources(bundle); resources.clear(); for (const item of imported) resources.set(item.path, item); refreshResources();
  provenance = bundle.provenance;
  if (bundle.document.schemaVersion === '0.1') await loadLegacy(bundle.document); else await loadDocument(bundle.document);
  if (bundle.motion) { el<HTMLTextAreaElement>('motion-editor').value = json(bundle.motion); applyMotion(); }
  if (bundle.motionSystem) setMotionSystem(bundle.motionSystem);
  el('source-note').textContent = `组件包 · ${provenance.description}`; log({ type: 'bundle-import', id: bundle.document.id });
  return bundle.document;
}
function applyMotion() {
  if (!tree || !currentDocument || currentDocument.schemaVersion !== '0.2') throw new Error('MOTION_REQUIRES_V02_TREE');
  motion?.destroy(); motion = undefined; currentMotion = undefined;
  const player = new MotionPlayer(parse('motion-editor'), tree.getDocument(), tree, { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }, (time, running) => {
    el<HTMLInputElement>('motion-time').value = String(time); el('motion-position').textContent = `${Math.round(time)} ms${running ? ' ▶' : ''}`;
  }, report);
  motion = player; currentMotion = player.motion; el<HTMLInputElement>('motion-time').max = String(player.motion.duration); log({ type: 'motion-validated', id: player.motion.id });
}
function setMotionSystem(input: unknown | null) {
  if (!tree) throw new Error('MOTION_SYSTEM_REQUIRES_V02_TREE');
  tree.setMotionSystem(input);
  const system = tree.getMotionSystem();
  if (system) el<HTMLSelectElement>('motion-style').value = system.style;
  el<HTMLTextAreaElement>('motion-system-editor').value = system ? json(system) : '';
  el('motion-system-note').textContent = system
    ? `${system.style} · ${system.bindings.length} 个节点 · 在画布中操作控件体验反馈`
    : '动效体系已清除，组件回到基础外观';
  log({ type: 'motion-system', id: system?.id ?? null, style: system?.style ?? null }); sync();
}
function applySelectedMotionStyle() {
  if (!tree) throw new Error('MOTION_SYSTEM_REQUIRES_V02_TREE');
  const document = tree.getDocument(), style = el<HTMLSelectElement>('motion-style').value as MotionStyle;
  setMotionSystem(compileMotionSystem({ id: `canvas-${style}`, style, targets: walkNodes(document).map(node => node.id) }, document));
}
function playMotionAction(id: string, action: MotionAction) {
  if (!tree) throw new Error('NO_TREE');
  tree.playMotionAction(id, action);
}
function playCanvasMotion(action: 'enter' | 'exit') {
  const system = tree?.getMotionSystem(); if (!tree || !system) throw new Error('NO_MOTION_SYSTEM');
  const root = tree.getDocument().root;
  const rootBinding = system.bindings.find(binding => binding.targetId === root.id);
  if (rootBinding) playMotionAction(root.id, action === 'enter' && rootBinding.actions.includes('stagger') ? 'stagger' : action);
  else for (const binding of system.bindings) if (binding.actions.includes(action)) playMotionAction(binding.targetId, action);
}
async function loadExample() {
  const kind = el<HTMLSelectElement>('scenario').value;
  provenance = { kind: 'programmatic-fixture', description: '程序夹具 · 明确资源与布局 · 未进行真实组合图识别' };
  if (kind === 'legacy') { el<HTMLTextAreaElement>('intent-editor').value = json(legacyIntent); el<HTMLTextAreaElement>('policy-editor').value = json(legacyPolicy); await loadLegacy(); return; }
  if (kind !== 'gallery' && kind !== 'composite') throw new Error('UNKNOWN_EXAMPLE');
  const sample = fixtureInputs(kind); el<HTMLTextAreaElement>('intent-editor').value = json(sample.intent); el<HTMLTextAreaElement>('policy-editor').value = json(sample.policy); el<HTMLTextAreaElement>('motion-editor').value = json(sample.motion);
  el('canvas-title').textContent = kind === 'gallery' ? '完整控件画布' : '独立底板＋图标＋文字';
  await compile(sample.intent, sample.policy); applyMotion();
}
const mimeOf = (file: File) => file.type || ({ woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }[file.name.split('.').at(-1) ?? ''] ?? '');
async function importAssets(files: File[]) {
  const incoming: ResourceInput[] = []; let candidate: typeof latestImage;
  for (const file of files) {
    if (!file.size || file.size > 16 * 1024 * 1024) throw new Error('RESOURCE_SIZE_LIMIT');
    const mime = mimeOf(file); if (!/^(image\/(png|jpeg|webp|svg\+xml)|font\/(woff2?|ttf|otf))$/.test(mime)) throw new Error(`UNSUPPORTED_MIME: ${mime}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'font/woff': 'woff', 'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf' }[mime];
    const item = { path: `assets/${sha}.${ext}`, mime, bytes }; incoming.push(item);
    if (mime.startsWith('image/')) { const image = await decode(item, new AbortController().signal); candidate = { source: item.path, width: image.naturalWidth, height: image.naturalHeight }; }
  }
  const total = [...resources.values(), ...incoming].reduce((sum, item) => sum + item.bytes.length, 0); if (total > 64 * 1024 * 1024) throw new Error('RESOURCE_TOTAL_LIMIT');
  for (const item of incoming) resources.set(item.path, item); refreshResources();
  if (candidate) {
    latestImage = candidate; if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl); const item = resources.get(candidate.source)!;
    thumbnailUrl = URL.createObjectURL(new Blob([new Uint8Array(item.bytes).buffer], { type: item.mime })); el<HTMLImageElement>('source-image').src = thumbnailUrl;
    el('source-description').textContent = `${candidate.width} × ${candidate.height} · 原始图片`; el('source-preview').hidden = false;
  }
}
async function useImage() {
  if (!latestImage) throw new Error('NO_IMPORTED_IMAGE');
  const image = latestImage, type = el<HTMLSelectElement>('asset-type').value;
  const scale = Math.min(1, 780 / image.width, 440 / image.height), width = image.width * scale, height = image.height * scale;
  const img = { id: 'imported-image', componentType: 'Image', props: { source: image.source, fit: 'contain', style: { ...fixtureStyle, borderWidth: 0 } } };
  const root = type === 'Image' ? img : { id: 'imported-button', componentType: 'Button', props: { label: '', enabled: true, style: { ...fixtureStyle, borderWidth: 0 } }, children: [img] };
  const positions: Record<string, UiNode['layout']> = { [root.id]: { x: (920 - width) / 2, y: (540 - height) / 2, width, height } };
  if (type === 'Button') positions[img.id] = { x: 0, y: 0, width, height };
  const intent = { intentVersion: '0.2', id: 'imported-component', root };
  const policy = { canvas: { width: 920, height: 540 }, layout: positions, layoutSource: { kind: 'explicit', description: `User selected whole-image ${type}; preview fit scale=${scale}; decoded image=${image.width}x${image.height}. No inferred business or layered artwork.` } };
  provenance = { kind: 'user-provided', description: `用户导入整图 · 人工指定 ${type} · 预览显式居中缩放 ${scale.toFixed(3)}` };
  el<HTMLTextAreaElement>('intent-editor').value = json(intent); el<HTMLTextAreaElement>('policy-editor').value = json(policy); el<HTMLTextAreaElement>('motion-editor').value = '';
  el('canvas-title').textContent = '用户整图组件'; await compile(intent, policy);
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([json(value)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.addEventListener('click', () => {
  const tab = button.dataset.tab; for (const other of document.querySelectorAll('[data-tab]')) other.setAttribute('aria-selected', String(other === button));
  for (const [name, id] of [['intent', 'intent-editor'], ['policy', 'policy-editor'], ['contract', 'output-json'], ['motion', 'motion-editor']]) el(id).hidden = name !== tab;
  el('motion-controls').hidden = tab !== 'motion';
});
el('load-example').addEventListener('click', action(loadExample));
el('compile').addEventListener('click', action(async () => { const input = parse('intent-editor'); provenance = { kind: 'user-provided', description: '导入或编辑的严格 intent · 布局来源由显式 policy 记录' }; if ((input as { intentVersion?: string })?.intentVersion === '0.1') { const validated = validateButtonIntent(input); Object.assign(legacyIntent, validated); Object.assign(legacyPolicy, validatePreviewPolicy(parse('policy-editor'))); await loadLegacy(); } else { await compile(input); } }));
el('destroy').addEventListener('click', action(() => { invalidate(); el('lifecycle').textContent = '已销毁'; el('render-info').textContent = '无实例'; }));
el('zoom').addEventListener('change', action(() => { const zoom = Number(el<HTMLSelectElement>('zoom').value); tree?.setZoom(zoom); legacy?.setZoom(zoom); sync(); }));
el('show-dialog').addEventListener('click', action(() => { tree?.setValue('dialog', true); sync(); }));
el('node-enabled').addEventListener('change', action(() => { const value = el<HTMLInputElement>('node-enabled').checked; if (tree) tree.setEnabled(selectedId, value); else legacyInstance?.setEnabled(value); sync(); }));
el('set-node-value').addEventListener('click', action(() => { if (!tree) throw new Error('NO_TREE'); tree.setValue(selectedId, JSON.parse(el<HTMLInputElement>('node-value').value)); sync(); }));
el('clear-events').addEventListener('click', () => { el('events').replaceChildren(); activates = 0; });
el('asset-files').addEventListener('change', action(async () => { const input = el<HTMLInputElement>('asset-files'); try { await importAssets([...(input.files ?? [])]); } finally { input.value = ''; } }));
el('use-image').addEventListener('click', action(useImage));
el('intent-file').addEventListener('change', action(async () => { const file = el<HTMLInputElement>('intent-file').files?.[0]; if (file) { if (file.size > 4 * 1024 * 1024) throw new Error('INTENT_SIZE_LIMIT'); const input = JSON.parse(await file.text()); if (input.intentVersion === '0.1') validateButtonIntent(input); else validateTreeIntent(input); el<HTMLTextAreaElement>('intent-editor').value = json(input); log('intent 已导入；配置明确布局后编译'); } }));
el('bundle-file').addEventListener('change', action(async () => { const file = el<HTMLInputElement>('bundle-file').files?.[0]; if (file) { if (file.size > 100 * 1024 * 1024) throw new Error('BUNDLE_SIZE_LIMIT'); await importBundle(JSON.parse(await file.text())); } }));
el('document-file').addEventListener('change', action(async () => {
  const input = el<HTMLInputElement>('document-file'), file = input.files?.[0];
  try { if (file) { if (file.size > 4 * 1024 * 1024) throw new Error('DOCUMENT_SIZE_LIMIT'); await importDocument(JSON.parse(await file.text())); } }
  finally { input.value = ''; }
}));
el('export-bundle').addEventListener('click', action(async () => download(await exportBundle(), `${currentDocument?.id ?? 'component'}.ui-bundle.json`)));
el('motion-apply').addEventListener('click', action(applyMotion));
el('apply-motion-system').addEventListener('click', action(applySelectedMotionStyle));
el('apply-system-json').addEventListener('click', action(() => setMotionSystem(parse('motion-system-editor'))));
el('clear-motion-system').addEventListener('click', action(() => setMotionSystem(null)));
el('play-system-enter').addEventListener('click', action(() => playCanvasMotion('enter')));
el('play-system-exit').addEventListener('click', action(() => playCanvasMotion('exit')));
el('motion-play').addEventListener('click', action(() => { applyMotion(); motion!.replay(); }));
el('motion-stop').addEventListener('click', action(() => motion?.stop()));
el('motion-time').addEventListener('input', action(() => { if (!motion) applyMotion(); motion!.seek(Number(el<HTMLInputElement>('motion-time').value)); }));
el('legacy-probes').addEventListener('click', action(async () => {
  if (!legacy || !legacyInstance) throw new Error('NO_LEGACY_INSTANCE');
  const button = el<HTMLButtonElement>('legacy-probes'); button.disabled = true; probing = true; el('probe-report').hidden = false;
  try { await runProbes({ preview: legacy, load: () => loadLegacy(), current: () => { if (!legacyInstance) throw new Error('NO_INSTANCE'); return legacyInstance; }, dispose: () => { generation++; controller?.abort(new DOMException('已销毁', 'AbortError')); legacyInstance?.destroy(); legacyInstance = undefined; sync(); }, count: () => activates, output: message => { el('probe-report').textContent = message; } }); }
  finally { probing = false; button.disabled = !legacyInstance; }
}));
window.addEventListener('pagehide', () => { invalidate(); if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl); }, { once: true });
window.addEventListener('error', event => report(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => report(event.reason));
/** Engine-neutral integration surface, also exercised by browser acceptance tests. */
const api = {
  workflowAdapter: { version: '0.1', engine: 'pixi.js', engineVersion: PIXI_VERSION },
  setMotionSystem, getMotionSystem: (): MotionSystemDocument | null => tree?.getMotionSystem() ?? null,
  playMotionAction, inspectMotionSystem: () => tree?.inspectMotionSystem() ?? null,
  inspect: () => tree?.inspect() ?? { instances: legacy?.inspect().instances ?? 0, externalListeners: legacy?.inspect().externalListeners ?? 0, resources: legacyInstance ? 1 : 0, nodes: [] },
  getDocument: () => tree ? tree.getDocument() : currentDocument && structuredClone(currentDocument),
  loadDocument, importDocument, compile, importBundle, exportBundle, importAssets, loadExample,
  setValue: (id: string, value: unknown) => { if (!tree) throw new Error('NO_TREE'); tree.setValue(id, value); sync(); },
  setEnabled: (id: string, value: boolean) => { if (!tree) throw new Error('NO_TREE'); tree.setEnabled(id, value); sync(); },
  setVisible: (id: string, value: boolean) => { if (!tree) throw new Error('NO_TREE'); tree.setVisible(id, value); sync(); },
  destroyNode: (id: string) => { if (!tree) throw new Error('NO_TREE'); tree.destroyNode(id); sync(); },
  legacySnapshot: () => legacyInstance?.snapshot(), activates: () => activates,
  activationCount: (id: string) => activationCounts.get(id) ?? 0,
  motionSnapshot: () => motion?.snapshot(), seekMotion: (time: number) => { if (!motion) applyMotion(); motion!.seek(time); },
  clear: () => {
    try { invalidate(); } finally {
      resources.clear(); latestImage = undefined; refreshResources();
      if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl); thumbnailUrl = undefined;
      el('source-preview').hidden = true;
    }
  }, resourcePaths: () => [...resources.keys()],
};
declare global { interface Window { uiHarness: typeof api } }
window.uiHarness = api;
await loadExample().catch(error => { if (!(error instanceof DOMException && error.name === 'AbortError')) report(error); });
