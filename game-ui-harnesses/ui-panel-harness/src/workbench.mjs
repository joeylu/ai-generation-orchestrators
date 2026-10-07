import { createWorkbenchModel } from './workbench-model.mjs';
import { browserCore, createWorkbenchRenderer } from './workbench-renderer.mjs';
import { digestJson } from './canonical.mjs';
import { detectCodexBridge, requestCodexProposal, requestCodexEditProposal } from './workbench-codex-client.mjs';
import { createBrowserUnityKit,createBrowserUnityKitFiles } from './unity-browser-export.mjs';
import {createPanelDelivery} from './panel-delivery.mjs';
import {createStoredZip} from './zip-store.mjs';
import {createBrowserSharedSdk} from './shared-sdk-browser.mjs';
import deliveryRuntime from 'virtual:panel-delivery-runtime';
import { createWorkbenchRequestIdentity } from './workbench-request-identity.mjs';
import { createWorkbenchStorage, WORKBENCH_STORAGE_KEY } from './workbench-storage.mjs';
import { beginnerExamples, questionPresentation, appendEditAnswers, clarificationDisplayText, summarizePanel } from './workbench-guidance.mjs';
import { selectionLabel } from './workbench-selection.mjs';
import { editChangeValue } from './edit-review.mjs';

const el = id => document.getElementById(id);
const seed = JSON.parse(el('workbench-seed').textContent);
let model, busy = false, disposed = false, draftDirty = true, renderedSha = null, snapshot;
let bridge = null, generation = null, codexReceipt = null;
let questionKey = null, editQuestionKey = null, summaryKey = null;
let editDraftDirty = true, editSnapshot = null;
let editCodexReceipt = null;
let unityExportReceipt = null;
let deliveryReceipt = null;
let requestNotice = '';
let editAnswerNotice = '';
let clarifiedDraft = null, editClarifiedDraft = null;
let workspaceStorage = null, storagePaused = true, saveTimer = null, manualRequestId = false;
let selectedRowId = null, selecting = false;
const hostEvents = [];
const requestIdentity = createWorkbenchRequestIdentity();
const errors = ['request-error', 'proposal-error', 'clarification-error', 'edit-plan-error', 'edit-clarification-error', 'edit-error', 'preview-error'];
const renderer = createWorkbenchRenderer(el('canvas-host'), (event, state) => {
  hostEvents.push(event); if (hostEvents.length > 100) hostEvents.shift();
  el('event-output').textContent = JSON.stringify(event, null, 2); renderValues(state); scheduleSave();
}, () => { renderedSha = null; el('preview-error').textContent = '预览渲染失败，请重新打开面板。'; updateButtons(); },
rowId => {
  selectedRowId = rowId; selecting = false; invalidateSelectedEdit(); updateButtons(); el('edit-request-text').focus();
}, () => { selecting = false; updateButtons(); el('select-edit-target').focus(); });
function invalidateSelectedEdit() {
  editDraftDirty = true; editCodexReceipt = null; editClarifiedDraft = null; editAnswerNotice = '';
  el('edit-proposal-json').value = ''; el('edit-plan-status').textContent = '';
  el('edit-plan-error').textContent = ''; renderEditQuestions();
}
el('select-edit-target').addEventListener('click', () => {
  selecting = !selecting; updateButtons();
});
el('clear-edit-target').addEventListener('click', () => {
  selectedRowId = null; selecting = false; invalidateSelectedEdit(); updateButtons();
});
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
  if (code === 'EDIT_REQUEST_INCOMPLETE' || error.diagnostic?.validatorCode === 'EDIT_REQUEST_INCOMPLETE') {
    const missing = error.requestCheck?.items.filter(item=>!item.matched).map(item=>`${item.label}要求 ${editChangeValue(item.expected)}，方案为 ${editChangeValue(item.actual)}`).join('；');
    return `明确的修改要求未全部落实${missing?'：'+missing:''}。本轮未应用，原面板和试玩值已保留，未自动重试。`;
  }
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
      EDIT_INPUT_RECIPE: '新增输入框未选择当前目录中的输入配方',
      'action-field': '按钮引用的状态不存在、重复或不属于可提交的输入字段',
      'binding': '控件与状态绑定不匹配', 'binding-type': '控件绑定了错误类型的状态',
      'input-value': '文本不是单行内容或超过最大长度', 'input-type': '输入框类型不受支持',
      integer: '长度或尺寸必须是允许范围内的整数', duplicate: '控件或状态标识重复',
    };
    const detail = error.diagnostic;
    const issue = detail.cause ?? detail;
    const targetReasons = { duplicate: '同一个目标填写了多条需求依据', unmatched: '需求依据指向面板中不存在或协议不支持的目标',
      'non-string': '需求依据的目标名必须是字符串' };
    const messageIssue = issue.validatorCode === 'text' && /\.(?:requiredMessage|minLengthMessage)$/.test(issue.path ?? '');
    const reason = targetReasons[detail.targetIssue] ?? (messageIssue ? '校验提示必须是非空的单行文字，最多 80 个字符' : reasons[issue.validatorCode]) ?? '字段或内容不符合面板协议';
    return `Codex 返回的方案未通过校验：${reason}（${issue.validatorCode}）${issue.path ? `，位置 ${issue.path}` : ''}。原面板保留，未自动重试。`;
  }
  const known = {
    PLAN_CONTEXT_MISMATCH: '该方案对应另一份需求。请将当前规划文件交给 Agent，返回匹配的方案。',
    'base-digest': '补丁针对旧版面板。请重新获取当前面板方案后编写补丁。',
    WORKBENCH_HISTORY_LIMIT: '会话撤销记录已满。请先撤销部分修改或导出备份。',
    WORKBENCH_EDIT_LIMIT: '已达到 10 轮修改上限。可继续试玩、撤销或导出；生成新面板后重新开始。',
    WORKBENCH_CONTEXT_REQUIRED: '请先准备当前需求的规划上下文。',
    WORKBENCH_EDIT_CONTEXT_REQUIRED: '请先针对当前面板准备修改上下文。',
    WORKBENCH_EDIT_STALE: '面板版本已变化，请重新准备修改上下文。',
    EDIT_CONTEXT_MISMATCH: '修改方案与当前描述或面板不匹配，请重新准备并取得新方案。',
    EDIT_BASE_MISMATCH: '修改方案针对旧版面板，请重新准备修改上下文。',
    EDIT_SELECTION: '选中的控件已失效，请重新选择修改对象。',
    EDIT_SELECTION_SCOPE: '方案修改了选中对象之外的内容。要修改整页或其他控件，请先取消选择。',
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
    'input-value': '当前试玩文字超过修改后的最大长度，或不是单行文字。修改未应用，原面板、输入和撤销历史已保留。请先缩短试玩文字，或提高最大长度。',
    WORKBENCH_FILE_LIMIT: '文件过大。规划方案和面板文件上限为 2 MiB。',
    TEXT_OVERFLOW: '文字超出当前控件，请缩短标签或增加布局宽度。修改未应用，原面板与试玩状态已保留。',
    UNITY_SLIDER_PRECISION_LIMIT: 'Unity 导出最多支持一百万个滑条步长，请减少数值范围或增大步长。',
    UNITY_NUMBER_PRECISION: '该滑条范围和步长无法在 Unity 中精确回算，请调整数值范围或步长后导出。',
    ZIP_SIZE_LIMIT: '下载包超过 64 MiB，请减少面板引用的图片后导出。',
    DELIVERY_PANEL_ID: '当前面板标识不能用作 Unity 文件夹名，请使用稳定英文标识后导出。',
    DELIVERY_RUNTIME_INTEGRITY: '内置预览运行库校验失败，请重新构建 Studio。',
    DELIVERY_UNITY_INTEGRITY: 'Unity 工具包文件校验失败，本次未下载。',
    DELIVERY_UNITY_SOURCE: 'Unity 工具包与当前面板来源不匹配，本次未下载。',
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
function currentDraft() {
  return { text: el('request-text').value, id: el('request-id').value, style: el('asset-style').value,
    editText: el('edit-request-text').value, manualId: manualRequestId };
}
function adoptDraft(draft) {
  el('request-text').value = draft.text; el('request-id').value = draft.id;
  if (![...el('asset-style').options].some(option => option.value === draft.style)) {
    const option = document.createElement('option'); option.value = draft.style; option.textContent = draft.style; el('asset-style').append(option);
  }
  el('asset-style').value = draft.style; el('edit-request-text').value = draft.editText;
  manualRequestId = draft.manualId; requestIdentity.setManual(manualRequestId);
  requestIdentity.adopt(draft.text, draft.style, draft.id);
  draftDirty = true; editDraftDirty = true; clarifiedDraft = null; editClarifiedDraft = null;
  requestNotice = ''; editAnswerNotice = ''; codexReceipt = null; editCodexReceipt = null;
  el('proposal-json').value = ''; el('edit-proposal-json').value = '';
}
function storageStatus(text, error = false) {
  el('save-status').textContent = text; el('save-status').dataset.error = String(error);
  el('storage-dialog-status').textContent = error ? text : '';
}
function storageFailure(error) {
  const code = error?.message;
  if (['WORKSPACE_CONFLICT', 'WORKSPACE_INVALID', 'WORKSPACE_BLOCKED'].includes(code)) storagePaused = true;
  const messages = {
    WORKSPACE_CONFLICT: '另一标签页更新了存档，已暂停本页自动保存。请先导出当前面板，再从历史版本重新读取。',
    WORKSPACE_INVALID: '本机存档无法读取，原记录已保留。可在历史版本中备份并重置。',
    WORKSPACE_QUOTA: '浏览器空间不足，未保存本次变化。请导出当前面板备份。',
    WORKSPACE_TOO_LARGE: '当前面板超出本机保存容量，请导出面板备份。',
    WORKSPACE_UNAVAILABLE: '浏览器不允许本机保存，请使用「导出当前面板」备份。',
  };
  storageStatus(messages[code] ?? '本机恢复或保存失败，原存档已保留。请导出当前面板备份。', true);
  if (model) updateButtons();
}
function renderSavedVersions() {
  const saved = workspaceStorage?.snapshot(); el('saved-versions').replaceChildren();
  el('saved-history-empty').hidden = Boolean(saved?.versions.length);
  for (const entry of [...(saved?.versions ?? [])].reverse()) {
    const li = document.createElement('li'), description = document.createElement('div');
    const title = document.createElement('strong'), detail = document.createElement('p'), button = document.createElement('button');
    title.textContent = entry.panel.spec?.title ?? '面板版本'; detail.className = 'hint';
    detail.textContent = new Date(entry.savedAt).toLocaleString(); description.append(title, detail);
    button.type = 'button'; button.disabled = busy || disposed || storagePaused;
    button.textContent = entry.id === saved.currentId ? '恢复当前存档' : '恢复此版本';
    button.addEventListener('click', () => run('preview-error', async () => {
      if (storagePaused) throw new Error('WORKSPACE_BLOCKED');
      // Revalidate and render before changing drafts or the persisted selection.
      await model.importPanel(entry.panel, entry.state); await showPanel(); adoptDraft(entry.draft);
      el('saved-history').close();
    }));
    li.append(description, button); el('saved-versions').append(li);
  }
}
function flushWorkspace() {
  clearTimeout(saveTimer); saveTimer = null;
  if (storagePaused || !workspaceStorage || disposed || !model) return;
  const panel = model.getSnapshot().panel;
  if (panel && panel.sha256 !== renderedSha) return;
  try {
    const { workspace, removed } = workspaceStorage.save({ draft: currentDraft(), panel, state: panel ? currentState() : null, editUsage: model.getEditUsage() });
    storageStatus(`已保存到本机${workspace.versions.length ? ` · ${workspace.versions.length} 个版本` : ' · 草稿'}${removed ? '（较早版本已腾出空间）' : ''}`);
    if (el('saved-history').open) renderSavedVersions();
  } catch (error) { storageFailure(error); }
}
function scheduleSave() {
  if (storagePaused || disposed) return;
  clearTimeout(saveTimer); saveTimer = setTimeout(flushWorkspace, 250);
}
async function restoreWorkspace() {
  storagePaused = true;
  try {
    const saved = workspaceStorage.read(), active = saved.versions.find(entry => entry.id === saved.currentId);
    if (active) { await model.importPanel(active.panel, active.state); model.restoreEditUsage(saved.editUsage); await showPanel(); }
    else {
      model.clear(); renderer.clear(); renderedSha = null; summaryKey = null;
      model.restoreEditUsage(saved.editUsage);
      el('empty-preview').hidden = false; el('panel-name').textContent = '尚未生成面板';
      el('panel-dimensions').textContent = '支持鼠标和键盘';
      el('event-output').textContent = '尚未操作'; el('live-state').replaceChildren();
      unityExportReceipt = null; deliveryReceipt = null; el('unity-export-status').textContent = '';
    }
    if (disposed) return;
    adoptDraft(saved.draft); storagePaused = false;
    storageStatus(active ? '已恢复最近面板、草稿与试玩值。' : saved.draft.text ? '已恢复需求草稿。' : '自动保存到本机 · 仅当前浏览器与地址');
    renderSavedVersions(); sync();
  } catch (error) { storagePaused = true; storageFailure(error); }
}
el('open-saved-history').addEventListener('click', () => { flushWorkspace(); renderSavedVersions(); el('saved-history').showModal(); });
el('close-saved-history').addEventListener('click', () => el('saved-history').close());
el('reload-saved-history').addEventListener('click', () => run('preview-error', restoreWorkspace));
el('backup-saved-history').addEventListener('click', () => {
  try { const raw = workspaceStorage?.backup(); if (raw) downloadBlob('panel-studio.workspace-backup.json', new Blob([raw], { type: 'application/json' })); }
  catch (error) { storageFailure(error); }
});
el('reset-saved-history').addEventListener('click', () => { el('reset-saved-confirm').hidden = false; });
el('confirm-reset-saved').addEventListener('click', () => {
  try {
    workspaceStorage.reset(); storagePaused = false; el('reset-saved-confirm').hidden = true;
    flushWorkspace(); renderSavedVersions();
  } catch (error) { storageFailure(error); }
});
window.addEventListener('storage', event => {
  if (workspaceStorage && (event.key === WORKBENCH_STORAGE_KEY || event.key === null)) {
    storagePaused = true; storageFailure(new Error('WORKSPACE_CONFLICT'));
  }
});
function updateButtons() {
  for (const id of ['open-saved-history', 'reload-saved-history', 'reset-saved-history', 'confirm-reset-saved']) el(id).disabled = busy || !model || disposed;
  for (const button of el('saved-versions').querySelectorAll('button')) button.disabled = busy || !model || disposed || storagePaused;
  const ready = Boolean(model && !disposed), context = ready && snapshot?.context && !draftDirty;
  const panel = ready && snapshot?.panel && renderedSha === snapshot.panel.sha256;
  const budget = model?.getEditBudget(), editLimitReached = budget?.remaining === 0;
  const selectionSupported = panel && ['0.7','0.8','0.9','0.10','0.11','0.12','0.13', '0.14'].includes(snapshot.panel.spec.panelSpecVersion)
    && snapshot.panel.catalog.themes.some(theme => theme.id === snapshot.panel.spec.theme.id && theme.version === snapshot.panel.spec.theme.version && theme.visualStyle === 'modern-v3');
  if (!selectionSupported) { selecting = false; selectedRowId = null; }
  const selectedRow = panel ? snapshot.panel.spec.sections.flatMap(section => section.rows).find(row => row.id === selectedRowId) : null;
  el('select-edit-target').disabled = busy || !selectionSupported || editLimitReached;
  el('select-edit-target').textContent = selecting ? '返回试玩' : '选择修改对象';
  el('select-edit-target').setAttribute('aria-pressed', String(selecting));
  el('clear-edit-target').hidden = !selectedRow;
  el('clear-edit-target').disabled = busy;
  el('edit-target').hidden = !selectedRow;
  el('edit-target-name').textContent = selectedRow ? `修改对象：${selectionLabel(selectedRow)}` : '';
  el('selection-help').hidden = !selecting;
  renderer.setSelectionMode(selecting);
  el('edit-rounds').textContent = panel ? budget.remaining === 0
    ? '已达到 10 轮修改上限。可继续试玩、撤销或导出；生成新面板后重新开始。'
    : `已修改 ${budget.used} / ${budget.limit} 轮` : '';
  if (panel && editLimitReached) el('edit-plan-status').textContent = '';
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
  el('questions').querySelectorAll('textarea,button').forEach(input => { input.disabled = busy || !canAnswer; });
  el('download-panel').disabled = el('download-spec').disabled = el('download-unity').disabled = busy || !panel;
  el('download-delivery').disabled = busy || !panel;
  el('download-shared-sdk').disabled = busy || !ready;
  el('editor-fields').disabled = busy || !panel || editLimitReached;
  el('edit-enabled').disabled = busy || !panel || editLimitReached || readRow()?.kind === 'text';
  el('undo').disabled = busy || !panel || !snapshot?.canUndo;
  el('apply-json-patch').disabled = busy || !panel || editLimitReached;
  el('download-patch').disabled = busy || !panel || !snapshot.history.length;
  const editContext = panel && editSnapshot?.context && !editDraftDirty;
  el('edit-request-text').disabled = busy || !panel;
  el('prepare-edit-context').disabled = busy || !panel || editLimitReached || !el('edit-request-text').value.trim();
  el('generate-edit').disabled = busy || !panel || editLimitReached || !bridge?.editingAvailable || !el('edit-request-text').value.trim();
  el('download-edit-context').disabled = busy || !editContext;
  el('edit-proposal-file').disabled = el('apply-edit-proposal').disabled = busy || !editContext || editLimitReached;
  const canAnswerEdit = editContext && editSnapshot.report?.status === 'NEEDS_INPUT';
  el('clarify-edit').disabled = busy || !canAnswerEdit;
  el('edit-questions').querySelectorAll('textarea,button').forEach(input => { input.disabled = busy || !canAnswerEdit; });
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
  const input = document.createElement(numeric || field.type === 'string' ? 'input' : 'select'); input.id = 'edit-initial'; input.dataset.mutation = '';
  if (field.type === 'string') { input.type = 'text'; input.maxLength = field.maxLength; }
  else if (numeric) { input.type = 'number'; input.min = field.min ?? 0; input.max = field.max; input.step = field.step ?? 'any'; }
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
function fillQuestions(containerId, questions) {
  const container = el(containerId); container.replaceChildren();
  for (const [index, question] of questions.entries()) {
    const presentation = questionPresentation(question.question);
    const li = document.createElement('li'), label = document.createElement('label'), input = document.createElement('textarea');
    input.id = `${containerId}-answer-${index}`; input.dataset.questionId = question.id; input.dataset.mutation = '';
    input.rows = 2; input.placeholder = presentation.choices.length ? '可点选上方回答，也可自己填写' : '填写这项的具体约定';
    label.id = `${containerId}-label-${index}`; label.htmlFor = input.id; label.textContent = presentation.prompt;
    li.append(label);
    const group = document.createElement('div'); group.className = 'suggested-answers';
    group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', label.id);
    const buttons = [];
    const markSelection = () => buttons.forEach(({ button, value }) => button.setAttribute('aria-pressed', String(input.value === value)));
    for (const choice of presentation.choices) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.mutation = '';
      button.textContent = `${choice.recommended ? '推荐：' : ''}${choice.value}`;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => { input.value = choice.value; markSelection(); });
      buttons.push({ button, value: choice.value }); group.append(button);
    }
    input.addEventListener('input', markSelection);
    if (buttons.length) li.append(group);
    li.append(input); container.append(li);
  }
}
function renderQuestions() {
  const questions = draftDirty ? [] : snapshot.proposal?.unresolved ?? [];
  const key = JSON.stringify([snapshot.context?.sha256 ?? null, questions]);
  el('clarification-form').hidden = !questions.length;
  // Keep partially entered answers across unrelated edits and validation errors.
  if (key === questionKey) return;
  questionKey = key; fillQuestions('questions', questions);
}
function renderEditQuestions() {
  const questions = editDraftDirty ? [] : editSnapshot.proposal?.unresolved ?? [];
  const key = JSON.stringify([editSnapshot.context?.sha256 ?? null, questions]);
  el('edit-clarification-form').hidden = !questions.length;
  if (key === editQuestionKey) return;
  editQuestionKey = key; fillQuestions('edit-questions', questions);
}
function renderSummary() {
  el('requirement-summary').hidden = !snapshot.panel;
  if (!snapshot.panel || summaryKey === snapshot.panel.sha256) return;
  summaryKey = snapshot.panel.sha256;
  const summary = summarizePanel(snapshot.panel.spec);
  el('summary-overview').textContent = `当前面板：${summary.overview}`;
  el('summary-details').replaceChildren();
  for (const text of summary.details) { const li = document.createElement('li'); li.textContent = text; el('summary-details').append(li); }
}
function renderEditChanges() {
  const entry = snapshot.history.at(-1), changes = entry?.changes ?? [];
  el('edit-changes').hidden = !changes.length;
  el('edit-changes-heading').textContent = `上次实际变化 · ${changes.length} 项`;
  el('edit-changes-list').replaceChildren();
  for (const change of changes.slice(0,60)) {
    const li = document.createElement('li');
    li.textContent = `${change.label}：${editChangeValue(change.before)} → ${editChangeValue(change.after)}`;
    el('edit-changes-list').append(li);
  }
  if(changes.length>60){const li=document.createElement('li');li.textContent=`另有 ${changes.length-60} 项，完整内容可查看面板方案。`;el('edit-changes-list').append(li);}
  const check=entry?.editEvidence?.report.requestCheck;
  el('edit-check-summary').textContent=check?.items.length
    ? `${check.items.length} 项明确要求已核对。其他描述请结合预览确认。`
    : '已列出实际变化；自然语言要求是否完整落实，请结合预览确认。';
  if(check?.preserveRest?.requested&&!check.preserveRest.enforced)el('edit-check-summary').textContent+='“其他不变”尚未自动核对。';
  el('edit-check-list').replaceChildren();
  for (const item of check?.items??[]) {
    const li=document.createElement('li');li.textContent=`${item.quote}：已符合要求`;el('edit-check-list').append(li);
  }
}
function sync() {
  if (!model) return; snapshot = model.getSnapshot();
  editSnapshot = model.getEditSnapshot();
  el('status').textContent = snapshot.phase === 'awaiting-proposal' ? requestNotice : phaseLabels[snapshot.phase];
  el('context-ready').hidden = !snapshot.context;
  renderQuestions();
  renderEditQuestions(); renderSummary();
  renderEditChanges();
  el('edit-hint').textContent = snapshot.panel ? '' : '生成或打开面板后即可修改。';
  el('edit-plan-status').textContent = editAnswerNotice ? editAnswerNotice : !editDraftDirty && editSnapshot.report?.status === 'NO_CHANGES'
    ? `无需修改：${editSnapshot.proposal?.noChange?.reason ?? '当前面板已符合要求'}。当前面板和输入已保留。`
    : !advancedMode()
    ? !editDraftDirty && editSnapshot.report?.status === 'NEEDS_INPUT' ? '请回答下面的问题，再点击「修改面板」。'
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
    lastDeliveryDownload: deliveryReceipt,
    semanticReview: 'NOT_RUN', humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' }, null, 2);
  updateButtons();
}
async function showPanel() {
  snapshot = model.getSnapshot(); if (!snapshot.panel) return;
  selectedRowId = null; selecting = false; renderer.setSelectionMode(false);
  if (renderedSha !== snapshot.panel.sha256) editAnswerNotice = '';
  if (renderedSha !== snapshot.panel.sha256) await renderer.load(snapshot.panel);
  if (disposed) return;
  renderedSha = snapshot.panel.sha256; hostEvents.length = 0;
  el('empty-preview').hidden = true; el('panel-name').textContent = snapshot.panel.spec.title;
  el('panel-dimensions').textContent = `${snapshot.panel.spec.canvas.width} × ${snapshot.panel.spec.canvas.height} · ${snapshot.panel.spec.sections.flatMap(s => s.rows).length} 个控件`;
  if(snapshot.panel.spec.frame){const frame=snapshot.panel.spec.frame;el('panel-dimensions').textContent=`面板 ${frame.width} × ${Number(frame.height.toFixed(2))} · 画布 `+el('panel-dimensions').textContent;}
  el('event-output').textContent = '尚未操作'; renderValues(renderer.getState()); fillEditor();
  if (renderer.inspect().nodes.some(node => node.type === 'ScrollView')) el('panel-dimensions').textContent += ' · 滚轮或拖动空白处查看更多';
}
async function run(errorId, work) {
  if (busy || disposed || !model) return;
  flushWorkspace();
  busy = true; errors.forEach(id => { el(id).textContent = ''; }); updateButtons();
  el('status').textContent = '正在校验与处理…';
  try { await work(); }
  catch (error) { if (!disposed) el(errorId).textContent = errorText(error); }
  finally { busy = false; if (!disposed) { sync(); flushWorkspace(); } }
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
function dirty() { scheduleSave(); draftDirty = true; clarifiedDraft = null; requestNotice = ''; if (snapshot) renderQuestions(); updateButtons(); if (snapshot?.context) el('status').textContent = '需求已更新，点击「生成面板」应用。'; }
for (const example of beginnerExamples) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.mutation = '';
  button.textContent = `${example.title}：${example.text}`;
  button.addEventListener('click', () => { el('request-text').value = example.text; dirty(); el('requirement-examples').open = false; el('request-text').focus(); });
  el('example-choices').append(button);
}
for (const id of ['request-text', 'asset-style']) el(id).addEventListener('input', dirty);
el('request-id').addEventListener('input', () => { manualRequestId = Boolean(el('request-id').value.trim()); requestIdentity.setManual(manualRequestId); dirty(); });
async function prepareCurrentRequest() {
  requestNotice = '';
  const existing = model.getSnapshot().context;
  if (!draftDirty && clarifiedDraft && existing?.sha256 === clarifiedDraft.contextSha256
      && el('request-text').value === clarifiedDraft.text && el('request-id').value === clarifiedDraft.id
      && el('asset-style').value === clarifiedDraft.style) return { context: existing };
  clarifiedDraft = null;
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
    el('request-text').value = clarificationDisplayText(el('request-text').value, source.proposal.unresolved, answers);
    el('request-id').value = clarified.context.request.id;
    el('asset-style').value = clarified.context.assetRetrieval?.policy.style ?? '';
    requestIdentity.adopt(el('request-text').value, el('asset-style').value, el('request-id').value);
    clarifiedDraft = { contextSha256: clarified.context.sha256, text: el('request-text').value,
      id: el('request-id').value, style: el('asset-style').value };
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
  scheduleSave();
  editDraftDirty = true; editCodexReceipt = null; editAnswerNotice = ''; editClarifiedDraft = null;
  el('edit-plan-status').textContent = advancedMode() && editSnapshot?.context ? '修改描述已变化，请重新准备。' : '';
  // Questions from the previous description no longer describe the current draft.
  renderEditQuestions();
  updateButtons();
});
el('edit-clarification-form').addEventListener('submit', event => {
  event.preventDefault();
  run('edit-clarification-error', async () => {
    const source = model.getEditSnapshot();
    const boundDisplay = editClarifiedDraft && editClarifiedDraft.sourceContextSha256 === source.context?.sha256
      && editClarifiedDraft.text === el('edit-request-text').value;
    if (editDraftDirty || !source.context || source.report?.status !== 'NEEDS_INPUT'
        || source.context.request.text !== el('edit-request-text').value && !boundDisplay) throw new Error('WORKBENCH_EDIT_CONTEXT_REQUIRED');
    const answers = [...el('edit-questions').querySelectorAll('textarea')].map(input => ({ questionId: input.dataset.questionId, text: input.value }));
    const request = appendEditAnswers(source.context.request, source.proposal.unresolved, answers);
    el('edit-request-text').value = clarificationDisplayText(el('edit-request-text').value, source.proposal.unresolved, answers);
    el('edit-request-text').dispatchEvent(new Event('input'));
    editClarifiedDraft = { sourceContextSha256: source.context.sha256, text: el('edit-request-text').value, request };
    editAnswerNotice = '回答已补充，请点击「修改面板」。';
    el('edit-request-text').focus();
  });
});
async function prepareCurrentEdit() {
  editAnswerNotice = '';
  const clarified = editClarifiedDraft && model.getEditSnapshot().context?.sha256 === editClarifiedDraft.sourceContextSha256
    && el('edit-request-text').value === editClarifiedDraft.text ? editClarifiedDraft : null;
  const prepared = await model.prepareEdit(clarified ? clarified.request
    : { requestVersion: '0.1', id: 'panel-edit', text: el('edit-request-text').value, target: 'pixi' },
    selectedRowId ? { rowId: selectedRowId } : null);
  if (disposed || prepared.status === 'STALE') throw new Error('WORKBENCH_EDIT_STALE');
  editDraftDirty = false; el('edit-proposal-json').value = '';
  if (clarified) clarified.sourceContextSha256 = prepared.context.sha256;
  else editClarifiedDraft = null;
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
  if (!['NEEDS_INPUT', 'NO_CHANGES'].includes(model.getEditSnapshot().report?.status)) await showPanel();
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
el('download-delivery').addEventListener('click',()=>run('preview-error',async()=>{
  el('unity-export-status').textContent='';
  const panel=await model.exportPanel(currentState());if(disposed||panel.status==='STALE')return;
  const unityKit=await createBrowserUnityKitFiles(panel,browserCore),delivery=await createPanelDelivery(panel,browserCore,{runtime:deliveryRuntime,unityKit});
  if(disposed)return;
  downloadBlob(`${delivery.panelId}.panel-delivery.zip`,new Blob([createStoredZip(delivery.contents)],{type:'application/zip'}));
  deliveryReceipt={panelSha256:delivery.manifest.panelSha256,fileCount:delivery.manifest.files.length+1,verification:delivery.manifest.verification};
  el('unity-export-status').textContent='已下载完整交付包：可运行的 Pixi 预览、Unity 导入工具包和业务接线说明。包含本次点击时的试玩值。';
}));
el('download-shared-sdk').addEventListener('click',()=>run('preview-error',async()=>{
  const sdk=await createBrowserSharedSdk(deliveryRuntime);if(disposed)return;
  downloadBlob('panel-shared-sdk-0.1.0.zip',new Blob([sdk.bytes],{type:'application/zip'}));
  el('unity-export-status').textContent='已下载共享接入 SDK，所有面板安装一次并复用。';
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
function destroy() { if (disposed) return; flushWorkspace(); disposed = true; clearTimeout(saveTimer); generation?.controller.abort(); model?.dispose(); renderer.destroy(); }
window.addEventListener('pagehide', destroy, { once: true });
window.addEventListener('pageshow', event => { if (event.persisted && disposed) location.reload(); });
// Read-only acceptance surface; all mutations are exercised through the visible UI.
window.panelWorkbench = Object.freeze({ snapshot: () => model?.getSnapshot(), editSnapshot: () => model?.getEditSnapshot(), inspect: () => renderer.inspect(),
  getState: () => renderer.getState(), events: () => structuredClone(hostEvents), get busy() { return busy; }, destroy });
// Host updates for determinate progress and text. Setters never emit player events.
window.panelHost = Object.freeze({
  setProgress(fieldId, value) {
    if (busy) throw new Error('WORKBENCH_BUSY');
    const values = renderer.setProgress(fieldId, value); renderValues(values); scheduleSave(); return values;
  },
  setText(fieldId, value) {
    if (busy) throw new Error('WORKBENCH_BUSY');
    const row = model.getSnapshot().panel?.spec.sections.flatMap(section => section.rows).find(row => row.kind === 'input' && row.bind === fieldId);
    if (!row) throw new Error('PANEL_INPUT_FIELD_UNKNOWN');
    const values = renderer.setText(fieldId, value); renderValues(values); scheduleSave(); return values;
  },
});
async function initialize() { try {
  updateButtons();
  if (seed.workbenchSeedVersion !== '0.1') throw new Error('WORKBENCH_SEED_VERSION');
  model = await createWorkbenchModel({ catalog: seed.catalog, pool: seed.pool }, browserCore, async (panel, isCurrent) => {
    const result = await renderer.load(panel, isCurrent);
    if (result.status === 'READY' && isCurrent()) {
      renderedSha = panel.sha256;
      unityExportReceipt = null; el('unity-export-status').textContent = '';
      deliveryReceipt = null;
    }
  });
  if (disposed) model.dispose();
  else {
    const styles = [...new Set((seed.pool?.index.records ?? []).map(r => r.metadata.style))].sort();
    for (const style of styles) { const option = document.createElement('option'); option.value = style; option.textContent = style; el('asset-style').append(option); }
    el('library-badge').textContent = seed.pool ? `${seed.pool.index.records.length} 项自有资源 · 离线库` : '程序控件 · 无图片库';
    try { workspaceStorage = createWorkbenchStorage(window.localStorage); await restoreWorkspace(); }
    catch (error) { storagePaused = true; storageFailure(error?.name === 'SecurityError' ? new Error('WORKSPACE_UNAVAILABLE') : error); }
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
