import { createWorkbenchModel } from './workbench-model.mjs';
import { browserCore, createWorkbenchRenderer } from './workbench-renderer.mjs';
import { digestJson } from './canonical.mjs';
import { detectCodexBridge, requestCodexProposal, requestCodexEditProposal } from './workbench-codex-client.mjs';
import { createBrowserUnityKit } from './unity-browser-export.mjs';
import { createWorkbenchRequestIdentity } from './workbench-request-identity.mjs';

const el = id => document.getElementById(id);
const seed = JSON.parse(el('workbench-seed').textContent);
let model, busy = false, disposed = false, draftDirty = true, renderedSha = null, snapshot;
let bridge = null, generation = null, codexReceipt = null;
let questionKey = null;
let editDraftDirty = true, editSnapshot = null;
let editCodexReceipt = null;
let unityExportReceipt = null;
let requestNotice = '';
const hostEvents = [];
const requestIdentity = createWorkbenchRequestIdentity();
const errors = ['request-error', 'proposal-error', 'clarification-error', 'edit-plan-error', 'edit-error', 'preview-error'];
const renderer = createWorkbenchRenderer(el('canvas-host'), (event, state) => {
  hostEvents.push(event); if (hostEvents.length > 100) hostEvents.shift();
  el('event-output').textContent = JSON.stringify(event, null, 2); renderValues(state);
}, () => { renderedSha = null; el('preview-error').textContent = '预览渲染失败，请重新打开面板。'; updateButtons(); });
const phaseLabels = { empty: '', planning: '正在整理需求…', 'awaiting-proposal': '', 'needs-input': '请补充需求信息', ready: '预览已就绪' };
const advancedMode = () => document.body.classList.contains('advanced-mode');
function updateView() {
  const advanced = location.hash === '#advanced';
  document.body.classList.toggle('advanced-mode', advanced);
  el('advanced-tools').setAttribute('aria-expanded', String(advanced));
  el('advanced-tools').textContent = advanced ? '收起高级工具' : '高级工具';
  if (advanced) el('panel-menu').open = true;
  else closeMenu();
}
function closeMenu() {
  if (!advancedMode() && el('panel-menu').open) {
    const hadFocus = el('panel-menu').contains(document.activeElement);
    el('panel-menu').open = false;
    if (hadFocus) el('panel-menu').querySelector('summary').focus();
  }
}
el('advanced-tools').addEventListener('click', () => { location.hash = advancedMode() ? '' : 'advanced'; });
window.addEventListener('hashchange', updateView);
document.addEventListener('click', event => { if (!el('panel-menu').contains(event.target)) closeMenu(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && el('panel-menu').open && !advancedMode()) { closeMenu(); event.preventDefault(); }
});
el('panel-menu').querySelectorAll('button:not(#advanced-tools)').forEach(button => button.addEventListener('click', closeMenu));
el('panel-file').addEventListener('change', closeMenu);
updateView();
function errorText(error) {
  const code = error.code ?? error.issues?.[0]?.code ?? String(error.message).split(':')[0];
  if (error.diagnostic) {
    const reasons = {
      required: '方案缺少必填字段', 'unknown-key': '方案包含协议未允许的字段',
      PLAN_FIELDS: '方案字段不符合协议', PLAN_COVERAGE: '方案缺少部分控件或状态的需求依据',
      PLAN_TARGET: '需求依据的目标重复或无法匹配', PLAN_QUOTE: '方案引用的原文不匹配', PLAN_SPAN: '方案引用的原文位置不匹配',
      PLAN_ASSET_CONTEXT_VERSION: '方案版本与当前上下文版本不一致', PLAN_ASSET_CANDIDATE: '方案选择了候选以外的资源',
      PLAN_ASSET_LIBRARY: '方案引用了其他资源库', PLAN_CONTEXT_MISMATCH: '方案对应另一份需求',
      PLAN_BUSINESS_ORIGIN: '控件或状态缺少当前需求的原文依据',
      PLAN_PROVENANCE: '方案未正确标明 Agent 来源', EDIT_BASE_MISMATCH: '修改补丁对应旧版面板',
      DRAFT_FIELDS: '规划草稿的依据字段不符合协议', DRAFT_COUNT: '规划草稿的依据数量与控件或状态不一致',
      DRAFT_VERSION: '规划草稿的传输版本不支持',
      INTENT_FIELDS: '控件意图字段不符合协议', INTENT_COUNT: '控件或分组数量不符合协议',
      INTENT_QUOTE: '控件引用的原文不精确或重复出现', INTENT_REFERENCE: '控件引用了目录外的配方或主题',
      INTENT_DEFAULT: '下拉必须恰有一个默认选项', INTENT_PRECISION: '滑条精度超出当前支持范围',
      INTENT_VERSION: '控件意图版本不支持', 'layout-coverage': '布局分组引用缺失或重复',
      OUTPUT_JSON: '返回内容不是有效 JSON', OUTPUT_WRAPPER: '返回的传输格式不符合协议',
      OUTPUT_PROPOSAL_JSON: '方案字符串中的 JSON 格式不合法',
      EDIT_CONTEXT_MISMATCH: '修改方案对应其他描述或面板', EDIT_COVERAGE: '修改操作缺少完整依据',
      EDIT_QUOTE: '修改方案引用的原文不匹配', EDIT_FIELDS: '修改方案字段不符合协议',
    };
    const detail = error.diagnostic;
    const targetReasons = { duplicate: '同一个目标填写了多条需求依据', unmatched: '需求依据指向面板中不存在或协议不支持的目标',
      'non-string': '需求依据的目标名必须是字符串' };
    const reason = targetReasons[detail.targetIssue] ?? reasons[detail.validatorCode] ?? '字段或内容不符合面板协议';
    return `Codex 返回的方案未通过校验：${reason}（${detail.validatorCode}）${detail.path ? `，位置 ${detail.path}` : ''}。原面板保留，未自动重试。`;
  }
  const known = {
    PLAN_CONTEXT_MISMATCH: '该方案对应另一份需求。请将当前规划文件交给 Agent，返回匹配的方案。',
    'base-digest': '补丁针对旧版面板。请重新获取当前面板方案后编写补丁。',
    WORKBENCH_HISTORY_LIMIT: '已保存 16 次修改。可撤销，或导出后重新打开以开始新的修改记录。',
    WORKBENCH_CONTEXT_REQUIRED: '请先准备当前需求的规划上下文。',
    WORKBENCH_EDIT_CONTEXT_REQUIRED: '请先针对当前面板准备修改上下文。',
    WORKBENCH_EDIT_STALE: '面板版本已变化，请重新准备修改上下文。',
    EDIT_CONTEXT_MISMATCH: '修改方案与当前描述或面板不匹配，请重新准备并取得新方案。',
    EDIT_BASE_MISMATCH: '修改方案针对旧版面板，请重新准备修改上下文。',
    EDIT_PLAN_NEEDS_INPUT: '请把下方问题的答案补充到修改描述中，再重新准备。',
    EDIT_BUSINESS_ORIGIN: '业务修改缺少当前修改要求中的依据，请让 Agent 修正方案。',
    WORKBENCH_CLARIFICATION_REQUIRED: '当前没有待回答的问题，请先导入对应当前需求的 Agent 方案。',
    CLARIFICATION_CONTEXT_MISMATCH: '这些回答对应旧版需求，请回答当前方案的问题。',
    CLARIFICATION_PROPOSAL_MISMATCH: '待澄清问题已经变化，请回答当前方案的问题。',
    CLARIFICATION_NOT_NEEDED: '当前方案没有待澄清问题。',
    CLARIFICATION_ANSWER_MISSING: '请逐项回答所有问题，再重新准备上下文。',
    CLARIFICATION_ANSWER_TEXT: '请逐项填写有效回答，每项最多 2000 个字符。',
    CLARIFICATION_ANSWER_UNKNOWN: '回答包含当前方案之外的问题，请重新导入当前方案。',
    CLARIFICATION_ANSWER_DUPLICATE: '同一个问题只能提交一项回答。',
    CLARIFICATION_REQUEST_TOO_LONG: '原需求与补充回答合计超过 8000 个字符，请缩短回答后重试。',
    WORKBENCH_ASSET_CONTEXT_REQUIRED: '使用图片的方案必须对应包含资源检索的规划上下文。',
    PLAN_ASSET_CANDIDATE: '方案选用了候选列表以外的资源。请让 Agent 从当前候选中选材。',
    PLAN_NEEDS_INPUT: '请先澄清方案中列出的问题。',
    LAYOUT_OVERFLOW: '面板超出画布，请调整布局尺寸或减少设置行。',
    SELECT_POPUP_OVERFLOW: '下拉菜单展开后超出画布，请增加画布高度或调整设置行顺序。',
    'enum-value': '默认值必须是该下拉菜单中的一个选项。',
    WORKBENCH_FILE_LIMIT: '文件过大。规划方案和面板文件上限为 2 MiB。',
    TEXT_OVERFLOW: '文字超出当前控件，请缩短标签或增加布局宽度。修改未应用，原面板与试玩状态已保留。',
    UNITY_SLIDER_PRECISION_LIMIT: 'Unity 导出最多支持一百万个滑条步长，请减少数值范围或增大步长。',
    UNITY_NUMBER_PRECISION: '该滑条范围和步长无法在 Unity 中精确回算，请调整数值范围或步长后导出。',
    ZIP_SIZE_LIMIT: 'Unity 工具包超过 64 MiB，请减少面板引用的图片后导出。',
    CODEX_BRIDGE_CONTEXT_MISMATCH: '返回的方案与本次需求不匹配，原面板已保留。',
    CODEX_PROPOSAL_INVALID: 'Codex 返回的方案未通过校验，本次没有生成预览。该调用没有留下具体字段原因；原面板保留，未自动重试。',
    CODEX_OUTPUT_INVALID: 'Codex 返回内容的格式无法读取。该调用没有留下具体格式原因；原面板保留，未自动重试。',
    CODEX_PROVENANCE_INVALID: 'Codex 返回的方案未正确标明 Agent 来源；原面板保留，未自动重试。',
    CODEX_NOT_FOUND: '未找到 Codex CLI。请安装并登录 CLI 后重启本地工作台。',
    CODEX_BRIDGE_UNAVAILABLE: '本地 Codex 入口尚未就绪，请通过本地启动命令打开工作台。',
    WORKBENCH_SERVER_CODEX_UNAVAILABLE: '本机未找到 Codex CLI，请检查安装后重启工作台。',
    CODEX_AUTH_REQUIRED_NO_RETRY: 'Codex CLI 登录不可用，请先在终端登录。原面板保留，未自动重试。',
    CODEX_RATE_LIMIT_NO_RETRY: 'Codex 返回额度或速率限制，请稍后手动生成。原面板保留，未自动重试。',
    CODEX_MODEL_UNAVAILABLE_NO_RETRY: 'Codex 未能使用 gpt-6-luna。请检查该账号的模型可用性；没有切换模型或自动重试。',
    CODEX_CONNECTION_FAILED_NO_RETRY: 'Codex 与模型服务的连接中断，本次未取得可用方案。原面板保留，未自动重试。',
    CODEX_TRANSPORT_FAILED_NO_RETRY: 'Codex CLI 调用失败，未取得可用方案。原面板保留，未自动重试。',
    CODEX_BRIDGE_NETWORK_FAILED: '本机工作台连接中断，结果未应用。请确认服务仍在运行；不会自动重新提交。',
  };
  if (error.name === 'AbortError') return '已取消本次生成，原面板保留。不会自动重试。';
  if (String(code).includes('TIMEOUT')) return '本次模型调用超时，原面板保留。未自动重试。';
  if (String(code).includes('BUSY')) return '本地已有一次生成正在结束，请稍后再点生成。';
  if (error instanceof SyntaxError) return 'JSON 格式有误，请检查完整文件或粘贴内容。';
  const path = error.path ?? error.issues?.[0]?.path;
  return known[code] ?? `未能完成操作（${/^[A-Za-z0-9_-]{1,80}$/.test(code) ? code : 'VALIDATION_FAILED'}）${path?.startsWith('$') ? `，位置 ${path}` : ''}。当前面板未被替换，请检查输入。`;
}
function renderValues(values) {
  const fragment = document.createDocumentFragment();
  for (const [key, value] of Object.entries(values)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = key; dd.textContent = String(value); fragment.append(dt, dd);
  }
  el('live-state').replaceChildren(fragment);
}
function currentState() {
  if (!snapshot?.panel || renderedSha !== snapshot.panel.sha256) throw new Error('WORKBENCH_PREVIEW_NOT_CURRENT');
  return renderer.getState();
}
function updateButtons() {
  const ready = Boolean(model && !disposed), context = ready && snapshot?.context && !draftDirty;
  const panel = ready && snapshot?.panel && renderedSha === snapshot.panel.sha256;
  document.body.classList.toggle('busy', busy);
  el('generate-plan').textContent = generation?.kind === 'plan' ? '生成中…' : '生成面板';
  el('generate-edit').textContent = generation?.kind === 'edit' ? '修改中…' : '修改面板';
  el('canvas-host').setAttribute('aria-busy', String(busy));
  renderer.setInteractionLocked(busy);
  document.querySelectorAll('[data-mutation]').forEach(n => { n.disabled = busy || !ready; });
  el('example').disabled = busy || !ready || !seed.example;
  el('prepare').disabled = busy || !ready || !el('request-text').value.trim();
  el('generate-plan').disabled = busy || !ready || !bridge?.available || !el('request-text').value.trim();
  for (const kind of ['plan', 'edit']) {
    const active = generation?.kind === kind;
    el(`cancel-${kind}`).hidden = !active;
    el(`cancel-${kind}`).disabled = !active || generation.phase !== 'calling' || generation.controller.signal.aborted;
  }
  el('proposal-file').disabled = el('accept-proposal').disabled = busy || !context;
  el('download-context').disabled = busy || !context;
  const canAnswer = context && snapshot.report?.status === 'NEEDS_INPUT' && snapshot.proposal?.unresolved.length;
  el('clarify').disabled = busy || !canAnswer;
  el('questions').querySelectorAll('textarea').forEach(input => { input.disabled = busy || !canAnswer; });
  el('download-panel').disabled = el('download-spec').disabled = el('download-unity').disabled = busy || !panel;
  el('editor-fields').disabled = busy || !panel;
  el('edit-enabled').disabled = busy || !panel || readRow()?.kind === 'text';
  el('undo').disabled = busy || !panel || !snapshot?.canUndo;
  el('apply-json-patch').disabled = busy || !panel;
  el('download-patch').disabled = busy || !panel || !snapshot.history.length;
  const editContext = panel && editSnapshot?.context && !editDraftDirty;
  el('edit-request-text').disabled = busy || !panel;
  el('prepare-edit-context').disabled = busy || !panel || !el('edit-request-text').value.trim();
  el('generate-edit').disabled = busy || !panel || !bridge?.editingAvailable || !el('edit-request-text').value.trim();
  el('download-edit-context').disabled = busy || !editContext;
  el('edit-proposal-file').disabled = el('apply-edit-proposal').disabled = busy || !editContext;
}
function readRow() {
  return snapshot?.panel?.spec.sections.flatMap(s => s.rows).find(r => r.id === el('edit-row').value);
}
function fillRow() {
  const row = readRow(); if (!row) return;
  el('edit-label').value = row.label; el('edit-enabled').checked = row.enabled;
  el('edit-enabled').disabled = ['text', 'progress'].includes(row.kind);
  el('edit-enabled').closest('label').hidden = ['text', 'progress'].includes(row.kind);
  el('initial-field').replaceChildren(); el('action-description').textContent = '';
  if (row.kind === 'text') {
    el('action-description').textContent = `只读内容：${row.text}`;
    return;
  }
  if (row.kind === 'button') {
    el('action-description').textContent = row.action.kind === 'reset-initial'
      ? `按钮操作：将 ${row.action.fields.join('、')} 恢复为默认值。` : '按钮操作：通知宿主，不修改面板状态。';
    return;
  }
  const field = snapshot.panel.spec.state.find(f => f.id === row.bind);
  const label = document.createElement('label'); label.htmlFor = 'edit-initial'; label.textContent = '创作默认值';
  const numeric = ['number', 'progress'].includes(field.type);
  const input = document.createElement(numeric ? 'input' : 'select'); input.id = 'edit-initial'; input.dataset.mutation = '';
  if (numeric) { input.type = 'number'; input.min = field.min ?? 0; input.max = field.max; input.step = field.step ?? 'any'; }
  else for (const option of field.type === 'enum' ? field.options : [{ id: 'true', label: 'true' }, { id: 'false', label: 'false' }]) {
    const item = document.createElement('option'); item.value = option.id; item.textContent = option.label; input.append(item);
  }
  input.value = String(field.initial); el('initial-field').append(label, input);
}
function fillEditor() {
  if (!snapshot.panel) return;
  const keep = el('edit-row').value;
  el('edit-title').value = snapshot.panel.spec.title; el('edit-row').replaceChildren();
  for (const section of snapshot.panel.spec.sections) for (const row of section.rows) {
    const option = document.createElement('option'); option.value = row.id; option.textContent = `${row.label} · ${row.kind}`; el('edit-row').append(option);
  }
  if ([...el('edit-row').options].some(o => o.value === keep)) el('edit-row').value = keep;
  fillRow(); el('edit-hint').textContent = '';
}
function candidates(context) {
  el('candidates').replaceChildren();
  const selected = context?.assetRetrieval?.candidates ?? [];
  el('candidate-summary').textContent = `${context?.candidates.length ?? 0} 个控件配方 · ${selected.length} 项资源候选`;
  const images = new Map((seed.pool?.resources ?? []).map(r => [r.path, r]));
  for (const candidate of selected) {
    const card = document.createElement('div'); card.className = 'candidate';
    const image = document.createElement('img'), resource = images.get(`textures/${candidate.asset.sha256}.png`);
    if (resource) { image.src = `data:image/png;base64,${resource.base64}`; image.alt = ''; image.width = 32; image.height = 32; card.append(image); }
    const label = document.createElement('p'), caption = document.createElement('small');
    label.textContent = candidate.asset.name; caption.textContent = candidate.slot === 'row-icon' ? '行图标' : '面板背景';
    card.title = candidate.asset.key; card.append(label, caption); el('candidates').append(card);
  }
  if (!selected.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = seed.pool ? '未找到匹配资源。可调整需求或让 Agent 使用程序控件。' : '当前工作台未打包图片库，可使用程序控件。'; el('candidates').append(p); }
}
function renderQuestions() {
  const questions = snapshot.proposal?.unresolved ?? [];
  const key = JSON.stringify([snapshot.context?.sha256 ?? null, questions]);
  el('clarification-form').hidden = !questions.length;
  // Keep partially entered answers across unrelated edits and validation errors.
  if (key === questionKey) return;
  questionKey = key; el('questions').replaceChildren();
  for (const [index, question] of questions.entries()) {
    const li = document.createElement('li'), label = document.createElement('label'), input = document.createElement('textarea');
    input.id = `clarification-answer-${index}`; input.dataset.questionId = question.id; input.dataset.mutation = '';
    input.rows = 2; input.placeholder = '填写这项的具体约定';
    label.htmlFor = input.id; label.textContent = question.question;
    li.append(label, input); el('questions').append(li);
  }
}
function sync() {
  if (!model) return; snapshot = model.getSnapshot();
  editSnapshot = model.getEditSnapshot();
  el('status').textContent = snapshot.phase === 'awaiting-proposal' ? requestNotice : phaseLabels[snapshot.phase];
  el('context-ready').hidden = !snapshot.context;
  renderQuestions();
  el('edit-questions').replaceChildren();
  for (const question of editDraftDirty ? [] : editSnapshot.proposal?.unresolved ?? []) {
    const li = document.createElement('li'); li.textContent = question.question; el('edit-questions').append(li);
  }
  el('edit-hint').textContent = snapshot.panel ? '' : '生成或打开面板后即可修改。';
  el('edit-plan-status').textContent = !advancedMode()
    ? !editDraftDirty && editSnapshot.report?.status === 'NEEDS_INPUT' ? '请在修改要求中补充以下信息，再点击「修改面板」。'
      : !editSnapshot.context && snapshot.history.at(-1)?.editEvidence && !editDraftDirty ? '修改已应用，试玩值已保留；新默认值在恢复默认时生效。' : ''
    : editDraftDirty && editSnapshot.context ? '修改描述已变化，请重新准备。'
    : editSnapshot.report?.status === 'NEEDS_INPUT' ? '请把这些问题的答案补充到修改描述，再重新准备。'
    : editSnapshot.context ? '修改上下文已准备，可导出给 Agent。'
    : snapshot.history.at(-1)?.editEvidence ? '上一次 Agent 修改已应用，可撤销；继续修改请重新准备。'
    : bridge?.editingAvailable ? '填写修改要求，可直接用 Codex 修改，或导出给 Agent。'
    : '准备后导出给对话中的 Agent，收到修改方案后导入。直接修改需启用本地 Codex 入口。';
  candidates(snapshot.context);
  const currentStep = snapshot.phase === 'ready' ? 'preview' : ['awaiting-proposal', 'needs-input'].includes(snapshot.phase) ? 'proposal' : 'request';
  for (const step of ['request', 'proposal', 'preview']) el(`step-${step}`).classList.toggle('current', step === currentStep);
  el('preview-note').textContent = snapshot.panel && ['awaiting-proposal', 'needs-input'].includes(snapshot.phase)
    ? '当前仍显示上一次面板；新需求在通过方案校验后替换预览。' : '';
  el('history-list').replaceChildren();
  for (const entry of snapshot.history) { const li = document.createElement('li'); li.textContent = entry.patch.reason; el('history-list').append(li); }
  el('evidence-output').textContent = JSON.stringify({ planning: snapshot.report?.status ?? null,
    originalProposalAssetEvidence: snapshot.assetEvidence, appliedEdits: snapshot.history.length,
    lastCodexCall: codexReceipt,
    lastCodexEditCall: editCodexReceipt,
    editPlanning: editSnapshot.report,
    lastUnityDownload: unityExportReceipt,
    semanticReview: 'NOT_RUN', humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' }, null, 2);
  updateButtons();
}
async function showPanel() {
  snapshot = model.getSnapshot(); if (!snapshot.panel) return;
  if (renderedSha !== snapshot.panel.sha256) await renderer.load(snapshot.panel);
  if (disposed) return;
  renderedSha = snapshot.panel.sha256; hostEvents.length = 0;
  el('empty-preview').hidden = true; el('panel-name').textContent = snapshot.panel.spec.title;
  el('panel-dimensions').textContent = `${snapshot.panel.spec.canvas.width} × ${snapshot.panel.spec.canvas.height} · ${snapshot.panel.spec.sections.flatMap(s => s.rows).length} 个控件`;
  el('event-output').textContent = '尚未操作'; renderValues(renderer.getState()); fillEditor();
  if (renderer.inspect().nodes.some(node => node.type === 'ScrollView')) el('panel-dimensions').textContent += ' · 滚轮或拖动空白处查看更多';
}
async function run(errorId, work) {
  if (busy || disposed || !model) return;
  busy = true; errors.forEach(id => { el(id).textContent = ''; }); updateButtons();
  el('status').textContent = '正在校验与处理…';
  try { await work(); }
  catch (error) { if (!disposed) el(errorId).textContent = errorText(error); }
  finally { busy = false; if (!disposed) sync(); }
}
function download(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
  downloadBlob(name, blob);
}
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function fileJson(file) {
  if (!file || file.size > 2 * 1024 * 1024) throw new Error('WORKBENCH_FILE_LIMIT');
  return JSON.parse(await file.text());
}
function dirty() { draftDirty = true; requestNotice = ''; updateButtons(); if (snapshot?.context) el('status').textContent = '需求已更新，点击「生成面板」应用。'; }
for (const id of ['request-text', 'asset-style']) el(id).addEventListener('input', dirty);
el('request-id').addEventListener('input', () => { requestIdentity.setManual(Boolean(el('request-id').value.trim())); dirty(); });
async function prepareCurrentRequest() {
  requestNotice = '';
  el('request-id').value = requestIdentity.select(el('request-text').value, el('asset-style').value, el('request-id').value);
  const prepared = await model.prepare({ requestVersion: '0.1', id: el('request-id').value, text: el('request-text').value, target: 'pixi' }, { style: el('asset-style').value || null });
  draftDirty = false; el('proposal-json').value = '';
  return prepared;
}
el('prepare').addEventListener('click', () => run('request-error', prepareCurrentRequest));
el('clarification-form').addEventListener('submit', event => {
  event.preventDefault();
  run('clarification-error', async () => {
    if (draftDirty) throw new Error('WORKBENCH_CONTEXT_REQUIRED');
    const source = model.getSnapshot();
    if (!source.context || !source.proposal) throw new Error('WORKBENCH_CLARIFICATION_REQUIRED');
    const answers = [...el('questions').querySelectorAll('textarea')].map(input => ({ questionId: input.dataset.questionId, text: input.value }));
    const clarified = await model.clarify({ clarificationVersion: '0.1', contextSha256: source.context.sha256,
      proposalSha256: await digestJson(source.proposal), answers });
    if (disposed || clarified.status === 'STALE') return;
    el('request-text').value = clarified.context.request.text;
    el('request-id').value = clarified.context.request.id;
    el('asset-style').value = clarified.context.assetRetrieval?.policy.style ?? '';
    requestIdentity.adopt(el('request-text').value, el('asset-style').value, el('request-id').value);
    draftDirty = false; el('proposal-json').value = '';
    requestNotice = '回答已补充，请点击「生成面板」。';
  });
});
el('generate-plan').addEventListener('click', () => run('request-error', async () => {
  if (!bridge?.available) throw Object.assign(new Error('CODEX_BRIDGE_UNAVAILABLE'), { code: 'CODEX_BRIDGE_UNAVAILABLE' });
  const active = { controller: new AbortController(), phase: 'calling', kind: 'plan' }; generation = active; codexReceipt = null;
  updateButtons();
  try {
    const prepared = await prepareCurrentRequest();
    if (disposed || active.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    sync(); el('status').textContent = '正在生成面板…';
    el('model-status').textContent = 'gpt-6-luna · xhigh · 正在生成';
    const result = await requestCodexProposal(prepared.context, active.controller.signal);
    if (disposed || active.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    active.phase = 'applying'; updateButtons(); el('status').textContent = '正在校验方案并渲染…';
    codexReceipt = result.receipt;
    el('proposal-json').value = JSON.stringify(result.proposal, null, 2);
    await accept(result.proposal);
  } finally {
    generation = null;
    if (!disposed) { el('model-status').textContent = 'gpt-6-luna · xhigh · 本地 Codex CLI'; updateButtons(); }
  }
}));
for (const kind of ['plan', 'edit']) el(`cancel-${kind}`).addEventListener('click', () => {
  if (generation?.kind === kind && generation.phase === 'calling') {
    generation.controller.abort(); el(kind === 'edit' ? 'edit-plan-status' : 'status').textContent = '正在取消…'; updateButtons();
  }
});
el('example').addEventListener('click', () => run('request-error', async () => {
  el('request-text').value = seed.example.context.request.text; el('request-id').value = seed.example.context.request.id;
  el('asset-style').value = seed.example.context.assetRetrieval?.policy.style ?? '';
  requestIdentity.adopt(el('request-text').value, el('asset-style').value, el('request-id').value);
  await model.prepare(seed.example.context.request, { style: seed.example.context.assetRetrieval?.policy.style ?? null,
    retrieveAssets: Boolean(seed.example.context.assetRetrieval) });
  draftDirty = false; el('proposal-json').value = JSON.stringify(seed.example.proposal, null, 2);
  await model.acceptProposal(seed.example.proposal); await showPanel();
}));
el('download-context').addEventListener('click', () => { if (!draftDirty && snapshot.context) download('planning-context.json', snapshot.context); });
async function accept(proposal) { await model.acceptProposal(proposal); if (model.getSnapshot().phase === 'ready') await showPanel(); }
el('accept-proposal').addEventListener('click', () => run('proposal-error', async () => { if (draftDirty) throw new Error('WORKBENCH_CONTEXT_REQUIRED'); await accept(JSON.parse(el('proposal-json').value)); }));
el('proposal-file').addEventListener('change', event => { const file = event.target.files?.[0]; if (!file) return;
  run('proposal-error', async () => { const proposal = await fileJson(file); if (disposed) return; if (draftDirty) throw new Error('WORKBENCH_CONTEXT_REQUIRED'); el('proposal-json').value = JSON.stringify(proposal, null, 2); await accept(proposal); }).finally(() => { event.target.value = ''; });
});
el('panel-file').addEventListener('change', event => { const file = event.target.files?.[0]; if (!file) return;
  run('preview-error', async () => { const input = await fileJson(file); if (disposed) return; await model.importPanel(input); draftDirty = true; await showPanel(); }).finally(() => { event.target.value = ''; });
});
el('edit-row').addEventListener('change', () => { fillRow(); updateButtons(); });
el('edit-request-text').addEventListener('input', () => {
  editDraftDirty = true; editCodexReceipt = null;
  el('edit-plan-status').textContent = advancedMode() && editSnapshot?.context ? '修改描述已变化，请重新准备。' : '';
  // Questions from the previous description no longer describe the current draft.
  el('edit-questions').replaceChildren();
  updateButtons();
});
async function prepareCurrentEdit() {
  const prepared = await model.prepareEdit({ requestVersion: '0.1', id: 'panel-edit', text: el('edit-request-text').value, target: 'pixi' });
  if (disposed || prepared.status === 'STALE') throw new Error('WORKBENCH_EDIT_STALE');
  editDraftDirty = false; el('edit-proposal-json').value = '';
  return prepared;
}
el('prepare-edit-context').addEventListener('click', () => run('edit-plan-error', async () => {
  editCodexReceipt = null; await prepareCurrentEdit();
}));
el('generate-edit').addEventListener('click', () => run('edit-plan-error', async () => {
  if (!bridge?.editingAvailable) throw Object.assign(new Error('CODEX_BRIDGE_UNAVAILABLE'), { code: 'CODEX_BRIDGE_UNAVAILABLE' });
  const active = { controller: new AbortController(), phase: 'calling', kind: 'edit' };
  generation = active; editCodexReceipt = null; updateButtons();
  try {
    const prepared = await prepareCurrentEdit();
    if (disposed || active.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    sync(); el('edit-plan-status').textContent = '正在修改面板…';
    const result = await requestCodexEditProposal(prepared.context, active.controller.signal);
    if (disposed || active.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    active.phase = 'applying'; updateButtons(); el('edit-plan-status').textContent = '正在校验修改并渲染…';
    editCodexReceipt = result.receipt;
    el('edit-proposal-json').value = JSON.stringify(result.proposal, null, 2);
    await acceptEdit(result.proposal);
  } finally { generation = null; if (!disposed) updateButtons(); }
}));
el('download-edit-context').addEventListener('click', () => {
  if (!editDraftDirty && editSnapshot?.context) download('edit-context.json', editSnapshot.context);
});
async function acceptEdit(proposal) {
  if (editDraftDirty) throw new Error('WORKBENCH_EDIT_CONTEXT_REQUIRED');
  const accepted = await model.acceptEditProposal(proposal, currentState());
  if (disposed || accepted.status === 'STALE') return;
  if (model.getEditSnapshot().report?.status !== 'NEEDS_INPUT') await showPanel();
}
el('edit-proposal-file').addEventListener('change', event => {
  const file = event.target.files?.[0]; if (!file) return;
  run('edit-plan-error', async () => {
    const proposal = await fileJson(file); if (disposed) return;
    el('edit-proposal-json').value = JSON.stringify(proposal, null, 2); await acceptEdit(proposal);
  }).finally(() => { event.target.value = ''; });
});
el('apply-edit-proposal').addEventListener('click', () => run('edit-plan-error', async () => {
  await acceptEdit(JSON.parse(el('edit-proposal-json').value));
}));
el('editor-form').addEventListener('submit', event => { event.preventDefault(); run('edit-error', async () => {
  const panel = snapshot.panel, row = readRow(), operations = [];
  if (el('edit-title').value !== panel.spec.title) operations.push({ op: 'set-panel-title', title: el('edit-title').value });
  if (el('edit-label').value !== row.label) operations.push({ op: 'set-row-label', rowId: row.id, label: el('edit-label').value });
  if (!['text', 'progress'].includes(row.kind) && el('edit-enabled').checked !== row.enabled) operations.push({ op: 'set-row-enabled', rowId: row.id, enabled: el('edit-enabled').checked });
  if (row.bind) {
    const field = panel.spec.state.find(f => f.id === row.bind), raw = el('edit-initial').value;
    const value = ['number', 'progress'].includes(field.type) ? (raw.trim() ? Number(raw) : NaN) : field.type === 'boolean' ? raw === 'true' : raw;
    if (value !== field.initial) operations.push({ op: 'set-state-initial', fieldId: field.id, value });
  }
  if (!operations.length) { el('edit-error').textContent = '没有需要应用的修改。'; return; }
  const live = currentState();
  const patch = { patchVersion: '0.1', baseSpecSha256: await digestJson(panel.spec), reason: '工作台表单修改面板标题、行属性或创作默认值。', operations };
  await model.patch(patch, live); await showPanel();
}); });
el('apply-json-patch').addEventListener('click', () => run('edit-error', async () => { await model.patch(JSON.parse(el('patch-json').value), currentState()); await showPanel(); }));
el('undo').addEventListener('click', () => run('edit-error', async () => { await model.undo(); await showPanel(); }));
el('download-patch').addEventListener('click', () => { const last = snapshot.history.at(-1); if (last) download('panel.patch.json', last.patch); });
el('download-spec').addEventListener('click', () => { if (snapshot.panel) download('panel.spec.json', snapshot.panel.spec); });
el('download-panel').addEventListener('click', () => run('preview-error', async () => {
  const panel = await model.exportPanel(currentState()); if (!disposed && panel.status !== 'STALE') download(`${panel.spec.id}.panel.bundle.json`, panel);
}));
el('download-unity').addEventListener('click', () => run('preview-error', async () => {
  el('unity-export-status').textContent = '';
  const panel = await model.exportPanel(currentState());
  if (disposed || panel.status === 'STALE') return;
  const kit = await createBrowserUnityKit(panel, browserCore);
  if (disposed) return;
  downloadBlob(`${kit.panelId}.unity-kit.zip`, new Blob([kit.bytes], { type: 'application/zip' }));
  unityExportReceipt = { panelSha256: kit.manifest.panelSha256, fileCount: kit.manifest.files.length + 1,
    verification: kit.manifest.verification };
  el('unity-export-status').textContent = '已下载 Unity 导入工具包，包含本次点击时的试玩值。解压后在 Unity 中创建 Prefab，并验证交互。';
}));
function destroy() { if (disposed) return; disposed = true; generation?.controller.abort(); model?.dispose(); renderer.destroy(); }
window.addEventListener('pagehide', destroy, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted && disposed) location.reload(); });
// Read-only acceptance surface; all mutations are exercised through the visible UI.
window.panelWorkbench = Object.freeze({ snapshot: () => model?.getSnapshot(), editSnapshot: () => model?.getEditSnapshot(), inspect: () => renderer.inspect(),
  getState: () => renderer.getState(), events: () => structuredClone(hostEvents), get busy() { return busy; }, destroy });
// Host integration for read-only determinate progress. Values never emit player events.
window.panelHost = Object.freeze({
  setProgress(fieldId, value) {
    if (busy) throw new Error('WORKBENCH_BUSY');
    const values = renderer.setProgress(fieldId, value); renderValues(values); return values;
  },
});
async function initialize() { try {
  if (seed.workbenchSeedVersion !== '0.1') throw new Error('WORKBENCH_SEED_VERSION');
  model = await createWorkbenchModel({ catalog: seed.catalog, pool: seed.pool }, browserCore, async (panel, isCurrent) => {
    const result = await renderer.load(panel, isCurrent);
    if (result.status === 'READY' && isCurrent()) {
      renderedSha = panel.sha256;
      unityExportReceipt = null; el('unity-export-status').textContent = '';
    }
  });
  if (disposed) model.dispose();
  else {
    const styles = [...new Set((seed.pool?.index.records ?? []).map(r => r.metadata.style))].sort();
    for (const style of styles) { const option = document.createElement('option'); option.value = style; option.textContent = style; el('asset-style').append(option); }
    el('library-badge').textContent = seed.pool ? `${seed.pool.index.records.length} 项自有资源 · 离线库` : '程序控件 · 无图片库';
    sync();
    bridge = await detectCodexBridge(location);
    if (!disposed) {
      el('model-status').textContent = bridge?.available || bridge?.editingAvailable ? 'gpt-6-luna · xhigh · 本地 Codex CLI'
        : bridge ? '未找到 Codex CLI，可使用文件导入。' : '离线预览模式：启动本地工作台后可直接调用 Codex。';
      el('model-help').hidden = Boolean(bridge?.available || bridge?.editingAvailable);
      el('bridge-notice').hidden = Boolean(bridge?.available);
      el('bridge-notice').textContent = bridge?.available ? '' : '生成入口未就绪，可从「面板操作」打开面板或查看高级工具。';
      sync();
    }
  }
} catch (error) { el('status').textContent = '初始化失败'; el('request-error').textContent = errorText(error); } }
initialize();
