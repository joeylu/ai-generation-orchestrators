import './studio.css';
import { mountReferencePanel } from './reference-panel.ts';
import { importComponentHandoffWithReview } from './component-handoff.ts';
import { MAX_COMPONENT_HANDOFF_ARCHIVE_BYTES } from './decomposition-import.ts';
import { recognizeReference, encodeReference } from './studio-vision.ts';
import { walkNodes, type UiDocument } from './tree-contract.ts';
import { createTreePreview, type TreePreview, type TreeRuntimeEvent } from './tree-runtime.ts';
import { compileMotionSystem, type MotionStyle, type MotionSystemDocument } from './motion-system.ts';
import { MotionPlayer } from './motion.ts';
import { staticImageSystem, staticImageTimeline } from './studio-static-images.ts';
import { createBundle, validateBundle, bundleResources, type UiBundle, type ResourceInput } from './bundle.ts';
import { compileSemanticObservation, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1, type MissingSemanticField } from './vision-semantic-compiler.ts';
import type { ObservationSource, VisionObservation } from './vision-observation.ts';
import { createSemanticEditor } from './studio-semantic-editor.ts';
import { createDecompositionPanel } from './studio-decomposition.ts';
import { assertValidImportedDecomposition, type ImportedDecomposition } from './decomposition-import.ts';
import { compileImportedAssets } from './component-handoff.ts';
import { applyAppearanceBinding } from './appearance-apply.ts';
import { compileLayerComponents, intakeLayerComponents, MAX_LAYER_SOURCE_BYTES, type LayerComponentPlan } from './layer-component.ts';
import { runLayerAutoDag } from './layer-auto-dag.ts';
import { requestLayerPlan, type LayerPlanExecution } from './studio-layer-plan.ts';
import { assertLayerTextRendering } from './layer-preview.ts';
import { importLayerPackage } from './layer-package.ts';
import { LayerPlanningDiagnosticError } from './layer-planning-evidence.ts';

type Scheme = 'original' | MotionStyle;
type Reference = { source: string; width: number; height: number; file: string };
type View = { scheme: Scheme; host: HTMLElement; preview: TreePreview; timeline?: MotionPlayer; resize: ResizeObserver; activations: number; activationCounts: Record<string, number>; events: TreeRuntimeEvent[] };
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
let semanticObservation: VisionObservation | undefined, semanticSource: ObservationSource | undefined;
let semanticEditor: ReturnType<typeof createSemanticEditor> | undefined, semanticEdits = 0;
let neutralPreview = false;
let materialPreview = false;
let layerPackagePreview = false;
let decompositionPanel: ReturnType<typeof createDecompositionPanel> | undefined;
let layerArchive: Uint8Array | undefined, layerPlan: LayerComponentPlan | undefined, layerArchiveName = '', layerPlanRevision = 0, layerPlanValidated = false;

function showMissing(missing: readonly MissingSemanticField[] = []) {
  const fieldNames: Record<string, string> = { value: '当前值', inputType: '输入类型', title: '标题', placeholder: '占位文字', checked: '勾选状态', label: '标签', text: '文字', min: '最小值', max: '最大值', open: '打开状态', options: '选项内容', items: '列表内容', selectedId: '选中项', activeId: '当前页', tabs: '页签', 'tabs.contentId': '页签内容' };
  $('semantic-missing').replaceChildren(...missing.map(item => {
    const row = document.createElement('li'); row.textContent = `${item.componentId} · ${fieldNames[item.field] ?? item.field}：${item.field === 'tabs.contentId' ? '参考图未提供完整页面内容，暂时无法生成。' : '尚未确认，请补充；确实没有文字时可明确确认为空。'}`; return row;
  }));
}
function clearSemanticPreview() {
  try { disposeViews(); } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  $('main-preview').replaceChildren(); bundle = undefined; originalSystem = undefined;
  analysis = { status: 'Unresolved', summary: '识别结果已修改，请应用修正后查看画布。' };
  $('semantic-feedback').textContent = '尚未应用；原始识图结果保持不变。'; sync();
}
function semanticProvenance() {
  return { kind: 'user-provided' as const, description: `Semantic observation v0.2 with deterministic contract compilation and explicit neutral preview policy v1. Neutral procedural styles are not artwork reconstruction. Local user correction revisions: ${semanticEdits}. Model output is not visual acceptance.` };
}
async function applySemanticEdits() {
  if (!semanticEditor || !semanticSource || busy) return;
  const request = begin(); bundle = undefined; originalSystem = undefined;
  let mounting = false;
  try {
    const result = compileSemanticObservation(semanticEditor.read(), semanticSource, NEUTRAL_SEMANTIC_PREVIEW_POLICY_V1);
    request.check(); semanticEdits++; analysis = { status: result.status, summary: result.summary };
    showMissing(result.status === 'Ready' ? [] : result.missing);
    $('semantic-feedback').textContent = `已在本地应用第 ${semanticEdits} 次修正，没有重新识图。`;
    if (result.status !== 'Ready') { busy = false; sync(); return; }
    mounting = true;
    bundle = await createBundle(result.document, resources, semanticProvenance()); request.check();
    await mount(result.document, request);
  } catch (error) {
    if (request.ticket !== generation) return;
    try { disposeViews(); } catch (cleanupError) { lastError = String(cleanupError); }
    $('main-preview').replaceChildren();
    bundle = undefined; busy = false;
    lastError ??= error instanceof Error ? error.message : String(error);
    analysis = { status: 'Unresolved', summary: mounting ? '画布无法显示。修正内容已保留，可重新应用。' : '修正尚未通过校验，请检查字段类型和数值范围。' };
    $('semantic-feedback').textContent = analysis.summary; sync();
  }
}

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
  const ready = Boolean(bundle && views.length && !busy && !layerPackagePreview);
  document.body.dataset.ready = String(ready); document.body.dataset.busy = String(busy);
  document.body.dataset.reference = String(Boolean(reference));
  $('drop-zone').hidden = Boolean(reference);
  $('studio-export').toggleAttribute('disabled', !ready);
  $('studio-compare').toggleAttribute('disabled', !ready);
  $('studio-compare').setAttribute('aria-pressed', String(compare));
  $('studio-replay').toggleAttribute('disabled', !ready || (selected === 'original' && !bundle?.motion));
  $('studio-reset').toggleAttribute('disabled', !bundle && !reference && !layerArchive && !busy && !lastError);
  $<HTMLInputElement>('layer-plan').disabled = busy || !layerArchive;
  $<HTMLButtonElement>('layer-build').disabled = busy || !layerArchive || !layerPlan;
  $<HTMLButtonElement>('layer-auto').disabled = busy || !layerArchive;
  $<HTMLButtonElement>('layer-plan-export').disabled = busy || !layerPlanValidated;
  $('studio-stage').hidden = !bundle;
  $('studio-empty').hidden = Boolean(bundle) || busy;
  $('main-preview').hidden = compare; $('comparison-grid').hidden = !compare;
  $('reference-preview').hidden = !reference;
  $('analysis-state').hidden = analysis.status === 'Idle';
  $('analysis-summary').textContent = analysis.summary;
  $('semantic-review').hidden = semanticObservation?.status !== 'Observed';
  $('preview-disclosure').hidden = !neutralPreview;
  for (const input of controls<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('#semantic-review input, #semantic-review select, #semantic-review button')) input.disabled = busy;
  $('canvas-name').textContent = filename || '效果画布';
  $('scheme-name').textContent = ready ? selected === 'original' && neutralPreview ? '结构预览' : names[selected] : '等待参考图';
  $('reference-name').textContent = filename;
  $('reference-meta').textContent = reference ? `${reference.width} × ${reference.height}` : '';
  $('studio-status').textContent = busy ? analysis.status === 'Analyzing' ? '正在识别组件语义…' : '正在准备画布…' : ready ? '可以预览与导出'
    : analysis.status === 'NeedsInput' ? '方案需要补充输入'
    : analysis.status === 'Unresolved' ? '部分信息尚不确定，暂时无法生成完整方案'
    : analysis.status === 'Custom-required' ? '这张图需要当前组件库之外的组件' : analysis.status === 'Failed' ? /SESSION_|LAYER_/.test(lastError ?? '') ? '组件方案未完成' : '识图未完成' : '添加一张参考图，开始预览';
  $('studio-hint').textContent = ready ? '直接操作画布中的组件，体验当前方案'
    : layerArchive ? '图层 ZIP 已在本地校验；选择明确组件方案后生成画布，不会调用识图服务。'
    : '参考图将发送至已配置的识图服务进行组件分析';
  for (const button of controls<HTMLButtonElement>('#scheme-options [data-scheme], .comparison-title[data-scheme]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scheme === selected)); button.disabled = !ready;
  }
  for (const card of controls<HTMLElement>('.comparison-card[data-scheme]')) card.dataset.selected = String(card.dataset.scheme === selected);
  if (materialPreview) {
    $('scheme-name').textContent = '拆分包合成图';
    $('studio-hint').textContent = '显示上游 preview.png 原始像素；尚未应用组件外观绑定。';
    $('studio-compare').toggleAttribute('disabled', true);
    $('studio-replay').toggleAttribute('disabled', true);
    for (const button of controls<HTMLButtonElement>('#scheme-options [data-scheme]')) button.disabled = true;
  }
  if (layerPackagePreview) {
    $('scheme-name').textContent = '交付包预览';
    $('studio-status').textContent = busy ? '正在生成组件方案，当前显示交付包预览' : '交付包预览已加载';
    $('studio-hint').textContent = '显示包内 preview.png；组件方案生成通过后会替换此画布。';
  }
  decompositionPanel?.refresh();
}
function reset() {
  generation++; controller.abort(abortError()); controller = new AbortController();
  try { disposeViews(); } finally {
    bundle = undefined; resources = []; originalSystem = undefined; forgetReference(); filename = ''; selected = 'original'; compare = false; analysis = { status: 'Idle', summary: '' }; busy = false;
    semanticObservation = undefined; semanticSource = undefined; semanticEditor = undefined; semanticEdits = 0;
    neutralPreview = false;
    materialPreview = false; decompositionPanel?.reset();
    layerPackagePreview = false;
    layerArchive = undefined; layerPlan = undefined; layerArchiveName = ''; layerPlanRevision++; layerPlanValidated = false;
    $<HTMLInputElement>('layer-archive').value = ''; $<HTMLInputElement>('layer-plan').value = '';
    $('layer-archive-status').textContent = '尚未导入图层交付包。';
    $('layer-plan-status').textContent = '先导入图层 ZIP。';
    $('layer-auto-status').textContent = '由本机 Codex session 读取参考图和图层，规划待复核的组件方案。';
    $('layer-auto-issues').replaceChildren();
    $('semantic-fields').replaceChildren(); showMissing(); $('semantic-feedback').textContent = '';
    $('handoff-review').hidden = true; $('handoff-review').textContent = '';
    $('reference-evidence-panel').replaceChildren();
    lastError = null; $('studio-error').hidden = true; $('reload-studio').hidden = true; delete $('studio-error').dataset.errorDetail; sync();
  }
}
function fail(error: unknown, message: string) {
  if (isCancelled(error)) return;
  let current: unknown = error;
  let diagnostic: LayerPlanningDiagnosticError['diagnostic'] | undefined;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current instanceof LayerPlanningDiagnosticError) { diagnostic = current.diagnostic; break; }
    current = current.cause;
  }
  const cause = error instanceof Error && error.cause instanceof Error ? `; cause: ${error.cause.name}: ${error.cause.message}` : '';
  const reason = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)) + cause;
  const loginSource = /SESSION_NOT_AUTHENTICATED|SESSION_NOT_CONFIGURED|LAYER_PLANNING_UNRESOLVED|SESSION_CORRECTIONS_EXHAUSTED/.test(reason) ? layerArchive : undefined;
  const loginSourceName = layerArchiveName;
  try { reset(); } catch (cleanupError) { lastError = `${reason}; cleanup: ${String(cleanupError)}`; }
  if (loginSource) {
    layerArchive = loginSource; layerArchiveName = loginSourceName; filename = loginSourceName;
    $('layer-archive-status').textContent = `已保留校验过的图层 ZIP：${loginSourceName}。`;
    $('layer-plan-status').textContent = /LAYER_PLANNING_UNRESOLVED|SESSION_CORRECTIONS_EXHAUSTED/.test(reason)
      ? '源 ZIP 已保留。请查看方案未完成的具体原因，或选择明确的组件方案；当前没有可导出的方案。'
      : 'Codex 登录或配置完成后可重新点击生成；当前没有可导出的方案。';
  }
  lastError ??= reason;
  if (/SESSION_NOT_CONFIGURED/.test(reason)) message = '本机 Codex CLI 尚未配置，请先安装并登录后生成组件方案。';
  else if (/SESSION_NOT_AUTHENTICATED/.test(reason)) message = '本机 Codex CLI 尚未登录。请在终端执行 codex login，完成登录后重新点击生成方案。';
  else if (/SESSION_CORRECTIONS_EXHAUSTED/.test(reason)) message = `已完成 3 次自动修正，方案仍未通过检查。${diagnostic ? diagnostic.summary : '所有草稿和错误记录已保留，请查看本地 session 记录。'}`;
  else if (/SESSION_TIMEOUT_NO_RETRY/.test(reason)) message = 'Codex 单轮运行超过 15 分钟，未收到完整响应，任务已停止。执行记录已保留；该轮未完成，当前没有可导出的方案。';
  else if (/SESSION_TRANSPORT_FAILED_NO_RETRY/.test(reason)) message = 'Codex 连接或响应流失败，未收到完整响应，任务已停止。执行记录已保留；当前没有可导出的方案。';
  else if (/SESSION_ABORTED_NO_RETRY/.test(reason)) message = 'Codex 任务已取消，未完成的轮次已停止。执行记录已保留；当前没有可导出的方案。';
  else if (/LAYER_PLAN_LAYOUT_GAP/.test(reason)) message = '草稿中相邻文字或图标的间距未达到方案要求。请修正布局后再导入。';
  else if (/LAYER_PLAN_TEXT_OVERFLOW/.test(reason)) message = '草稿的文字区域放不下完整文字。请修改文字布局或字号后再导入。';
  else if (/LAYER_PLANNING_UNRESOLVED/.test(reason)) message = diagnostic ? `组件方案未完成：${diagnostic.summary}` : '组件方案未完成，请查看本地草稿的具体说明。';
  else if (/SESSION_|LAYER_PLANNING_|LAYER_PLANNER_|LAYER_AUTO_SESSION_PLAN/.test(reason)) message = 'Codex 方案未完成或出现不可自动修正的错误。请查看本地 session 记录。';
  if (reason.includes('VISION_NOT_CONFIGURED')) message = '识图服务尚未连接，请先配置 MCP 服务。';
  else if (/VISION_|TimeoutError/.test(reason)) message = '识图未完成或结果未通过校验。请检查服务记录；已提交的识图任务可能仍在运行。';
  if (reason.startsWith('Error: STUDIO_VISION_FAILED') && !reason.includes('VISION_NOT_CONFIGURED')) message = '图片已读取，但识图结果未能完整接收或通过校验。请检查识图服务记录。';
  if (/VISION_SEMANTIC_COVERAGE_MISMATCH|VISION_IMAGE_FALLBACK|VISION_HIDDEN_SEMANTIC_NODE/.test(reason)) message = '识别出的组件类型与生成方案不一致，暂时无法预览。';
  if (/VISION_OBSERVATION_.*MISMATCH|VISION_OBSERVATION_MISSING_NODE|VISION_OBSERVATION_EXTRA_CONTROL/.test(reason)) message = '生成方案与识图观察不一致，暂时无法预览。';
  if (/VISION_CONTRACT_INVALID|VISION_UNUSED_STYLE|VISION_UNKNOWN_STYLE|VISION_UNKNOWN_PARENT|VISION_MULTIPLE_ROOTS|VISION_TREE_CYCLE/.test(reason)) message = '识图已完成，但组件结构或属性不完整，暂时无法预览。';
  if (reason.startsWith('Error: STUDIO_CONTRACT_FAILED')) message = '识图已完成，但组件方案未通过校验，暂时无法预览。';
  if (reason.startsWith('Error: STUDIO_CANVAS_FAILED')) message = '识图已完成，但当前浏览器未能创建画布。请刷新页面或检查浏览器图形支持。';
  const pageResourceFailed = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(reason);
  if (pageResourceFailed) message = '页面程序资源加载失败，当前标签页可能仍在使用更新前的版本。请刷新页面，再重新选择文件。';
  $('reload-studio').hidden = !pageResourceFailed;
  $('studio-error').dataset.errorDetail = reason;
  if (diagnostic) $('layer-auto-issues').replaceChildren(...[...diagnostic.issues,
    ...(diagnostic.missingInputs ?? []).map(item => `待补充：${item.subject} — ${item.detail}`)].map(issue => {
    const item = document.createElement('li'); item.textContent = issue; return item;
  }));
  analysis = { status: 'Failed', summary: message };
  $('error-message').textContent = message; $('studio-error').hidden = false; sync();
}
function action(work: () => void | Promise<void>, message = '预览暂时无法完成，请重新添加图片后再试。') {
  return () => { Promise.resolve().then(work).catch(error => fail(error, message)); };
}
function begin(preserveLayerPreview = false) {
  $('handoff-review').hidden = true; $('handoff-review').textContent = '';
  generation++; controller.abort(abortError()); controller = new AbortController();
  busy = true; lastError = null; $('studio-error').hidden = true; $('reload-studio').hidden = true; delete $('studio-error').dataset.errorDetail;
  if (!preserveLayerPreview || !layerPackagePreview) { disposeViews(); layerPackagePreview = false; }
  sync();
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
  if (originalSystem?.style === scheme) return staticImageSystem(document, originalSystem);
  return staticImageSystem(document, compileMotionSystem({ id: `studio-${scheme}`, style: scheme, targets: walkNodes(document).map(node => node.id) }, document));
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
  const timelineDocument = staticImageTimeline(document, bundle.motion);
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
      assertLayerTextRendering(bundle.layerSource?.plan, preview.inspect());
      preview.canvas.setAttribute('aria-label', layerPackagePreview ? '交付包 preview.png 预览' : `${names[scheme]}方案预览`);
      preview.setMotionSystem(systemFor(scheme, document));
      const view: View = { scheme, host, preview, resize: new ResizeObserver(() => { if (views.includes(view)) fit(view); }), activations: 0, activationCounts: {}, events: [] };
      if (timelineDocument) view.timeline = new MotionPlayer(timelineDocument, document, preview,
        { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }, undefined,
        error => { if (request.ticket === generation) fail(error, '动效无法继续播放，请重新打开方案。'); });
      preview.subscribe(event => {
        view.events.push(event); if (view.events.length > 200) view.events.shift();
        if (event.type === 'activate') { view.activations++; view.activationCounts[event.id] = (view.activationCounts[event.id] ?? 0) + 1; }
        const trigger = view.timeline?.motion.trigger;
        if (trigger?.type === 'event' && trigger.targetId === event.id && trigger.event === event.type) view.timeline?.replay();
      });
      views.push(view); registered = true; view.resize.observe(host); fit(view);
    } catch (error) { if (!registered) preview?.destroy(); throw error; }
  }
  request.check(); busy = false; sync(); for (const view of views) fit(view);
}
async function selectScheme(scheme: Scheme) {
  if (!bundle || busy || layerPackagePreview || !schemes.includes(scheme)) return;
  if (compare) {
    selected = scheme;
    await toggleCompare();
    $('main-preview').scrollIntoView({ block: 'center', behavior: 'instant' });
    activeView()?.preview.canvas.focus({ preventScroll: true });
    return;
  }
  const view = activeView(); if (!view) return;
  view.timeline?.stop(); view.preview.resetMotion();
  view.preview.setMotionSystem(systemFor(scheme, view.preview.getDocument()));
  view.scheme = scheme; selected = scheme; view.preview.canvas.setAttribute('aria-label', `${names[scheme]}方案预览`);
  sync();
  if (scheme !== 'original' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) replay(view);
}
async function toggleCompare() {
  if (!bundle || busy || layerPackagePreview) return;
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
    if (result.semanticObservation?.status === 'Observed') {
      semanticObservation = result.semanticObservation;
      neutralPreview = true;
      semanticSource = { path: resource.path, sha256: hash, width: reference.width, height: reference.height };
      semanticEditor = createSemanticEditor($('semantic-fields'), result.semanticObservation, clearSemanticPreview);
      showMissing(result.missing);
    }
    if (result.status !== 'Ready') { busy = false; sync(); return; }
    stage = 'CONTRACT';
    bundle = await createBundle(result.document, resources, semanticObservation ? semanticProvenance() : { kind: 'user-provided', description: 'User reference with LLM-produced semantic intent and layout; strict deterministic compilation passed. Model output is not human visual acceptance.' });
    request.check(); stage = 'CANVAS'; await mount(bundle.document as UiDocument, request);
  } catch (error) { if (request.ticket === generation) throw new Error(`STUDIO_${stage}_FAILED`, { cause: error }); }
}
async function openBundle(file: File) {
  reset(); filename = file.name;
  const request = begin();
  try {
    if (!file.size || file.size > 550 * 1024 * 1024) throw new Error('BUNDLE_SIZE_LIMIT');
    const candidate = await validateBundle(JSON.parse(await file.text())); request.check();
    if (candidate.document.schemaVersion !== '0.2') throw new Error('LEGACY_BUNDLE_REQUIRES_EXPLICIT_CONVERSION');
    resources = bundleResources(candidate); bundle = candidate; originalSystem = candidate.motionSystem;
    neutralPreview = /neutral (procedural|preview)/i.test(candidate.provenance.description);
    materialPreview = candidate.provenance.description.startsWith('Static upstream PNG composite only;');
    selected = candidate.motionSystem?.style ?? 'original';
    analysis = { status: 'Imported', summary: candidate.provenance.description.startsWith('Legacy layered pilot:') ? '原始贴图案例：取消、确定、关闭支持按钮反馈；开关与下拉框暂为静态图像。' : '已恢复保存的组件方案' };
    await mount(candidate.document, request);
    await mountReferencePanel($('reference-evidence-panel'), candidate, exportSelected, () => activeView()?.preview, () => activeView()?.timeline?.stop());
  } catch (error) { if (request.ticket === generation) throw error; }
}
async function openHandoff(file: File) {
  reset(); filename = file.name;
  const request = begin();
  try {
    if (!file.size || file.size > MAX_COMPONENT_HANDOFF_ARCHIVE_BYTES) throw new Error('COMPONENT_HANDOFF_SIZE_LIMIT');
    const bytes = new Uint8Array(await file.arrayBuffer()); request.check();
    const result = await importComponentHandoffWithReview(bytes); request.check();
    const candidate = result.bundle;
    if (candidate.document.schemaVersion !== '0.2') throw new Error('LEGACY_BUNDLE_REQUIRES_EXPLICIT_CONVERSION');
    resources = bundleResources(candidate); bundle = candidate; originalSystem = candidate.motionSystem;
    selected = candidate.motionSystem?.style ?? 'original';
    analysis = { status: 'Imported', summary: '交付包已通过摘要、合同与外观绑定校验，可直接操作组件。' };
    await mount(candidate.document, request); request.check();
    await mountReferencePanel($('reference-evidence-panel'), candidate, exportSelected, () => activeView()?.preview, () => activeView()?.timeline?.stop(), !result.hasRuntimeBundle); request.check();
    $('handoff-review').textContent = `交付包 SHA-256：${result.archiveSha256}\n上游视觉审核：${result.review.humanVisualAcceptance ? '已声明通过' : '未通过（草稿）'}\n参考证据：${result.referenceEvidence.status}\n本次视觉验收：未确认。技术校验通过不等于视觉通过。`;
    $('handoff-review').hidden = false;
  } catch (error) { if (request.ticket === generation) throw error; }
}
async function openLayerArchive(file: File) {
  reset(); filename = file.name;
  const request = begin();
  try {
    if (!file.size || file.size > MAX_LAYER_SOURCE_BYTES) throw new Error('LAYER_SOURCE_SIZE_LIMIT');
    const bytes = new Uint8Array(await file.arrayBuffer()); request.check();
    const intake = await intakeLayerComponents(bytes); request.check();
    const pack = await importLayerPackage(bytes); request.check();
    const preview: ResourceInput = { path: pack.composition.preview, mime: 'image/png', bytes: pack.files.get(pack.composition.preview)! };
    const document: UiDocument = { schemaVersion: '0.2', id: 'layer-package-preview', canvas: intake.canvas, root: {
      id: 'layer-package-composite', type: 'Image', layout: { x: 0, y: 0, ...intake.canvas },
      props: { source: preview.path, fit: 'stretch', drawBackground: false, style: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 } },
    } };
    const candidate = await createBundle(document, [preview], { kind: 'user-provided', description: `Static upstream preview.png only. Archive SHA-256: ${intake.archiveSha256}. No component plan or human visual acceptance.` }); request.check();
    layerArchive = bytes; layerArchiveName = file.name;
    bundle = candidate; resources = [preview]; layerPackagePreview = true;
    $('layer-archive-status').textContent = `已校验：${intake.layers.length} 层，${intake.canvas.width} × ${intake.canvas.height}；ZIP SHA-256：${intake.archiveSha256}。上游审核问题 ${intake.reviewIssues.length} 项。`;
    $('layer-plan-status').textContent = '可自动生成草稿，或选择与此 ZIP 摘要匹配的组件方案 JSON。';
    analysis = { status: 'Imported', summary: '图层 ZIP 已校验，当前显示包内预览图；可继续生成组件方案。' };
    await mount(document, request); request.check();
  } catch (error) { if (request.ticket === generation) throw error; }
}
async function autoBuildLayerPreview() {
  const archive = layerArchive;
  if (!archive || busy) throw new Error('LAYER_SOURCE_REQUIRED');
  const request = begin(true);
  try {
    layerPlan = undefined; layerPlanValidated = false;
    analysis = { status: 'Analyzing', summary: 'Codex session 正在读取参考图、图层信息和 16 类组件合同，规划方案草稿…' }; sync();
    $('layer-auto-status').textContent = 'Codex 正在生成完整方案并检查渲染；发现可修正错误时自动反馈，最多修正 3 次。';
    $('layer-auto-issues').replaceChildren();
    let execution: LayerPlanExecution | undefined;
    const result = await runLayerAutoDag(archive, async planningInput => {
      request.check();
      const proposal = await requestLayerPlan(archive, planningInput, request.signal, value => { execution = value; });
      request.check();
      return proposal;
    });
    request.check();
    disposeViews(); layerPackagePreview = false;
    layerPlan = result.plan; layerPlanValidated = true; resources = bundleResources(result.bundle); bundle = result.bundle;
    originalSystem = result.bundle.motionSystem; selected = 'original'; filename = layerArchiveName;
    $('layer-auto-status').textContent = `自动 DAG：${result.nodes.map(node => node.stage).join(' → ')}；${execution ? `实际修正 ${execution.corrections}/3 次，渲染检查通过；` : ''}草稿待人工视觉复核，${result.issues.length} 项提示。`;
    $('layer-auto-issues').replaceChildren(...result.issues.map(issue => {
      const item = document.createElement('li'); item.textContent = issue; return item;
    }), ...(result.plan.adaptations ?? []).map(adaptation => {
      const item = document.createElement('li');
      const label = { crop: '裁切复用', reorder: '调整遮挡顺序', 'procedural-control': '程序控件替代' }[adaptation.kind];
      item.textContent = `${label} · ${adaptation.componentId}：${adaptation.reason}`; return item;
    }), ...(result.plan.layoutChecks?.unpairedText ?? []).map(review => {
      const item = document.createElement('li'); item.textContent = `间距未声明 · ${review.componentId}：${review.reason}`; return item;
    }), ...result.plan.planningEvidence!.findings.filter(finding => finding.basis !== 'observed').map(finding => {
      const item = document.createElement('li'); item.textContent = `${finding.componentId} ${finding.pointer} · ${finding.basis === 'inferred' ? '推断' : '方案策略'}：${finding.note}`; return item;
    }));
    $('layer-plan-status').textContent = '已生成与此 ZIP 摘要绑定的方案草稿；可导出 Bundle，视觉与业务行为仍需复核。';
    analysis = { status: 'Imported', summary: '自动方案草稿已通过严格组件合同与图层绑定校验；尚未通过人工视觉验收。' };
    await mount(result.bundle.document as UiDocument, request); request.check();
    await mountReferencePanel($('reference-evidence-panel'), result.bundle, exportSelected, () => activeView()?.preview, () => activeView()?.timeline?.stop());
  } catch (error) { if (request.ticket === generation) throw error; }
}
async function openLayerPlan(file: File) {
  if (!layerArchive || busy) throw new Error('LAYER_SOURCE_REQUIRED');
  if (bundle && !layerPackagePreview) {
    begin(); bundle = undefined; resources = []; originalSystem = undefined; busy = false;
    $('reference-evidence-panel').replaceChildren();
    $('layer-auto-status').textContent = '已切换到手动方案；先前的自动草稿预览已清除。';
    $('layer-auto-issues').replaceChildren();
    analysis = { status: 'Unresolved', summary: '已选择新方案；重新构建前不会继续显示旧画布。' };
  }
  const ticket = generation, archive = layerArchive, revision = ++layerPlanRevision;
  layerPlan = undefined; layerPlanValidated = false; sync();
  if (!file.size || file.size > 4 * 1024 * 1024) throw new Error('LAYER_PLAN_SIZE_LIMIT');
  const contents = await file.text();
  if (ticket !== generation || archive !== layerArchive || revision !== layerPlanRevision) return;
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('LAYER_PLAN_JSON');
  layerPlan = parsed as LayerComponentPlan;
  $('layer-plan-status').textContent = `已选择 ${file.name}；点击生成后校验方案、图层绑定与源 ZIP 摘要。`;
  sync();
}
async function buildLayerPreview() {
  const archive = layerArchive, plan = layerPlan;
  if (!archive || !plan || busy) throw new Error('LAYER_SOURCE_AND_PLAN_REQUIRED');
  const request = begin(true);
  try {
    const candidate = await compileLayerComponents(archive, plan); request.check();
    disposeViews(); layerPackagePreview = false;
    layerPlanValidated = true;
    resources = bundleResources(candidate); bundle = candidate; originalSystem = candidate.motionSystem;
    selected = 'original'; filename = layerArchiveName;
    analysis = { status: 'Imported', summary: '图层 ZIP、组件方案和绑定已通过校验；已生成可导出的 Bundle 0.4。' };
    await mount(candidate.document as UiDocument, request); request.check();
    $('layer-auto-issues').replaceChildren(...(candidate.layerSource?.plan.adaptations ?? []).map(adaptation => {
      const item = document.createElement('li'); item.textContent = `消费适配 · ${adaptation.componentId}：${adaptation.reason}`; return item;
    }));
    await mountReferencePanel($('reference-evidence-panel'), candidate, exportSelected, () => activeView()?.preview, () => activeView()?.timeline?.stop());
    $('layer-plan-status').textContent = 'Bundle 0.4 已生成并显示。点击右上角“导出”保存方案。';
  } catch (error) { if (request.ticket === generation) throw error; }
}
function downloadLayerPlan() {
  if (!layerPlan || !layerPlanValidated || busy) throw new Error('LAYER_PLAN_NOT_VALIDATED');
  const url = URL.createObjectURL(new Blob([JSON.stringify(layerPlan, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `${layerArchiveName.replace(/\.zip$/i, '') || 'ui-layers'}.component-plan.json`;
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportSelected(): Promise<UiBundle> {
  const view = activeView();
  if (!bundle || !view || busy || layerPackagePreview) throw new Error('NO_READY_PREVIEW');
  const ticket = generation, scheme = selected;
  const result = await createBundle(view.preview.getDocument(), resources, bundle.provenance, staticImageTimeline(view.preview.getDocument(), bundle.motion), view.preview.getMotionSystem() ?? undefined, bundle.componentHandoff, bundle.layerSource);
  if (ticket !== generation || scheme !== selected || busy) throw abortError();
  return validateBundle(result);
}
async function previewDecomposition(imported: ImportedDecomposition) {
  const request = begin();
  try {
  await assertValidImportedDecomposition(imported); request.check();
  const { width, height } = imported.canvas;
  const document: UiDocument = { schemaVersion: '0.2', id: 'decomposition-preview', canvas: { width, height }, root: {
    id: 'decomposition-composite', type: 'Image', layout: { x: 0, y: 0, width, height },
    props: { source: imported.preview.path, fit: 'stretch', drawBackground: false, style: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 } },
  } };
  const next = await createBundle(document, [imported.preview], { kind: 'user-provided', description: `Static upstream PNG composite only; no component binding applied. Delivery policy: ${imported.review.deliveryPolicy}; upstream human visual acceptance: ${imported.review.humanVisualAcceptance}. Archive SHA-256: ${imported.archiveSha256}; delivery digest: ${imported.deliveryDigest}.` });
  request.check(); resources = [imported.preview]; bundle = next;
  materialPreview = true; neutralPreview = false; semanticObservation = undefined; semanticEditor = undefined; semanticSource = undefined;
  originalSystem = undefined; selected = 'original'; compare = false; filename = '拆分合成图';
  analysis = { status: 'Imported', summary: '来自拆分包的静态合成图，组件绑定尚未应用。' };
  await mount(document, request);
  } catch (error) { if (request.ticket === generation) fail(error, '拆分合成图无法显示。'); }
}
async function applyDecompositionAppearance(imported: ImportedDecomposition, appearance: unknown, target: UiBundle) {
  const request = begin();
  try {
    const next = imported.assetsPackage
      ? (await compileImportedAssets(imported, target, appearance)).bundle
      : await applyAppearanceBinding(target, imported, appearance); request.check();
    resources = bundleResources(next); bundle = next; originalSystem = next.motionSystem;
    materialPreview = false; neutralPreview = false; selected = next.motionSystem?.style ?? 'original'; compare = false;
    semanticObservation = undefined; semanticEditor = undefined; semanticSource = undefined;
    filename = '已应用外观绑定'; analysis = { status: 'Imported', summary: '拆分图层已按校验绑定应用到组件，可交互、切换方案并导出。' };
    await mount(next.document as UiDocument, request);
  } catch (error) { if (request.ticket === generation) throw error; }
}
async function download() {
  const exported = await exportSelected();
  const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `${(filename.replace(/\.[^.]+$/, '') || 'ui-preview').replace(/[<>:"/\\|?*]/g, '-')}-${names[selected]}.ui-bundle.json`;
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('studio-status').textContent = `已导出${names[selected]}方案`;
}
$('semantic-apply').addEventListener('click', action(applySemanticEdits));
$('reference-file').addEventListener('change', action(async () => {
  const input = $<HTMLInputElement>('reference-file'), file = input.files?.[0]; input.value = ''; if (file) await upload(file);
}, '图片无法打开，请选择有效的 PNG、JPG 或 WebP 图片（不超过 2 MB）。'));
$('replace-image').addEventListener('click', () => $<HTMLInputElement>('reference-file').click());
$('open-bundle').addEventListener('change', action(async () => {
  const input = $<HTMLInputElement>('open-bundle'), file = input.files?.[0]; input.value = ''; if (file) await openBundle(file);
}, '方案文件不完整、已损坏或版本不受支持，请重新导出新版组件包后再试。'));
$('open-handoff').addEventListener('change', action(async () => {
  const input = $<HTMLInputElement>('open-handoff'), file = input.files?.[0]; input.value = '';
  if (file) await openHandoff(file);
}, '交付包导入失败，请检查包摘要、合同及外观绑定。'));
$('layer-archive').addEventListener('change', action(async () => {
  const input = $<HTMLInputElement>('layer-archive'), file = input.files?.[0]; input.value = '';
  if (file) await openLayerArchive(file);
}, '图层交付 ZIP 未通过校验，请检查包结构、摘要和大小。'));
$('layer-auto').addEventListener('click', action(autoBuildLayerPreview, 'Codex 组件方案草稿未完成；请检查本地 session 记录与方案校验结果。'));
$('layer-plan-export').addEventListener('click', action(downloadLayerPlan, '组件方案草稿尚未通过校验。'));
$('layer-plan').addEventListener('change', action(async () => {
  const input = $<HTMLInputElement>('layer-plan'), file = input.files?.[0]; input.value = '';
  if (file) await openLayerPlan(file);
}, '组件方案 JSON 无法读取，请检查文件格式和大小。'));
$('layer-build').addEventListener('click', action(buildLayerPreview, '无法生成组件 Bundle：请检查方案与源 ZIP 摘要、图层绑定及组件合同。'));
for (const button of controls<HTMLButtonElement>('#scheme-options [data-scheme]')) button.addEventListener('click', action(() => selectScheme(button.dataset.scheme as Scheme)));
$('studio-compare').addEventListener('click', action(toggleCompare));
$('studio-replay').addEventListener('click', action(() => { if (compare) for (const view of views) replay(view); else replay(); }));
$('studio-reset').addEventListener('click', action(reset));
$('studio-export').addEventListener('click', action(download, '导出未完成，请重新打开图片或方案后再试。'));
$('reload-studio').addEventListener('click', () => { window.location.reload(); });
$('dismiss-error').addEventListener('click', () => { $('studio-error').hidden = true; $('reload-studio').hidden = true; delete $('studio-error').dataset.errorDetail; lastError = null; sync(); });
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
  snapshot: () => ({ ready: Boolean(bundle && views.length && !busy && !layerPackagePreview), layerPackagePreview, busy, scheme: selected, compare, kind: bundle?.document.schemaVersion === '0.2' ? bundle.document.root.type : null, analysis: { ...analysis },
    filename, resourceCount: resources.length, error: lastError,
    views: views.map(view => ({ scheme: view.scheme, document: view.preview.getDocument(), motionSystem: view.preview.getMotionSystem(),
      inspection: view.preview.inspect(), motionSnapshot: view.preview.inspectMotionSystem(), timelineSnapshot: view.timeline?.snapshot() ?? null, activations: view.activations, activationCounts: { ...view.activationCounts }, events: [...view.events] })) }),
  exportSelected,
  setValue: (id: string, value: unknown) => { const view=activeView(); if(!view)throw Error('NO_RUNTIME');view.preview.setValue(id,value); },
};
declare global { interface Window { uiStudio: typeof studio } }
window.uiStudio = studio;
decompositionPanel = createDecompositionPanel({
  capture: exportSelected,
  current: () => !materialPreview && !layerPackagePreview && bundle?.document.schemaVersion === '0.2' && views.length && !busy ? currentDocument() : undefined,
  busy: () => busy,
  preview: previewDecomposition,
  apply: applyDecompositionAppearance,
  clearMaterialPreview: () => {
    if (!materialPreview) return;
    disposeViews(); bundle = undefined; resources = []; materialPreview = false;
    filename = ''; analysis = { status: 'Idle', summary: '' }; sync();
  },
});
sync();
