import { environmentLibraryRoleLabel } from './layer-groups.mjs';

const endpoint = '/api/environment-library';
const pending = new Set(['content-ready', 'content-running', 'image-ready', 'image-running']);
const isPending = job => pending.has(job?.status) || (job?.automatic && ['review-plan', 'candidate'].includes(job.status));
const errors = {
  ENVIRONMENT_SUBJECT_REQUIRED: '请填写设定或选择一张参考图。',
  ENVIRONMENT_REFERENCE_LIMIT: '参考图需小于 4 MiB，像素总量最多约 419 万。',
  ENVIRONMENT_REFERENCE_PNG: '请选择 PNG 参考图。',
  IMAGE_PNG_UNSUPPORTED: '参考图须为 8 位 RGB 或 RGBA PNG。',
  ENVIRONMENT_OPERATION_ACTIVE: '当前还有一个环境素材任务。请先处理该任务。',
  ENVIRONMENT_PLAN_CHANGED: '计划已变化，请重新打开并检查当前计划。',
  ENVIRONMENT_PLACEMENT_ROLE: '请选择可用的素材分组。',
  ENVIRONMENT_MARGIN_RECHECK_UNAVAILABLE: '按新规则检查后，边缘仍未通过。请检查主体与画布边缘是否留有间距。',
  WORKFLOW_TEXT: '设定提取结果未通过文字格式检查。可以用原提示词再发起一次生成。',
  ENVIRONMENT_CONTENT_SUBJECT_REQUIRED: '未能从输入中识别物件。请在提示词里写明要生成的东西。',
  ENVIRONMENT_CONTENT_LENGTH: '提取出的物件描述过长。请减少提示词里的附加要求。',
  ENVIRONMENT_CONTENT_TEXT: '提取出的物件描述含有无效字符。请用简短文字描述物件。',
  ENVIRONMENT_CONTENT_STYLE: '提取结果混入了画法要求。请在提示词里只描述物件。',
  PRIVATE_OPERATIONAL_TEXT: '物件描述含有链接或文件路径。请改用文字描述，或上传参考图。',
  STALE_REVISION: '项目已更新，请刷新页面后继续。',
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function mountEnvironmentLibrary({ styleName, getRevision, hasAsset, onAdded }) {
  const dialog = element('dialog', '', 'project-dialog environment-dialog');
  dialog.setAttribute('aria-labelledby', 'environment-dialog-title');
  const heading = element('div', '', 'project-dialog-heading');
  const title = element('h2', '生成环境素材');
  title.id = 'environment-dialog-title';
  const close = element('button', '关闭');
  close.onclick = () => dialog.close();
  heading.append(title, close);
  const style = element('p', `项目风格 · ${styleName}`, 'project-explanation');
  const body = element('div', '', 'environment-dialog-body');
  const message = element('p', '', 'project-message');
  message.setAttribute('role', 'status');
  dialog.append(heading, style, body, message);
  document.body.append(dialog);

  let working = false, timer, lastJob, referenceUrl, displayedProgress, showingForm = false;
  let destination = 'environment';
  const destinationLabel = role => environmentLibraryRoleLabel(role ?? 'environment');
  function clearReference() {
    if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    referenceUrl = undefined;
  }
  function button(label, run, primary = false) {
    const node = element('button', label, primary ? 'primary' : '');
    node.type = 'button';
    node.onclick = run;
    return node;
  }
  async function api(action, args) {
    const response = await fetch(endpoint, action ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, revision: getRevision(), ...args }),
    } : undefined);
    const result = await response.json();
    if (!response.ok) throw new Error(result.code);
    return result;
  }
  async function act(run) {
    if (working) return;
    working = true;
    close.disabled = true;
    message.textContent = '';
    const inputs = [...body.querySelectorAll('button, input, textarea')];
    inputs.forEach(node => { node.disabled = true; });
    try { await run(); }
    catch (error) { message.textContent = errors[error.message] ?? `操作未完成（${error.message}）。`; }
    finally {
      working = false;
      close.disabled = false;
      inputs.forEach(node => { node.disabled = false; });
    }
  }
  function showForm(previous = lastJob, promptDraft = '') {
    clearReference();
    displayedProgress = undefined;
    showingForm = true;
    const form = element('form');
    const prompt = element('textarea');
    prompt.rows = 4;
    prompt.maxLength = 1200;
    prompt.value = promptDraft;
    prompt.placeholder = '例如：一座矮石灯，方形底座，顶盖四角微翘，石缝里有少量藤蔓。';
    const reference = element('input');
    reference.type = 'file';
    reference.accept = 'image/png,.png';
    const promptLabel = element('label', '提示词');
    promptLabel.append(prompt);
    const referenceLabel = element('label', '参考图（可选）');
    referenceLabel.append(reference);
    const selectedReference = element('div', '', 'environment-reference');
    selectedReference.hidden = true;
    reference.onchange = () => {
      clearReference();
      selectedReference.replaceChildren();
      selectedReference.hidden = true;
      message.textContent = '';
      const file = reference.files[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024 || (file.type !== 'image/png' && !/\.png$/i.test(file.name))) {
        message.textContent = errors[file.size > 4 * 1024 * 1024 ? 'ENVIRONMENT_REFERENCE_LIMIT' : 'ENVIRONMENT_REFERENCE_PNG'];
        reference.value = '';
        return;
      }
      referenceUrl = URL.createObjectURL(file);
      const image = element('img');
      image.src = referenceUrl;
      image.alt = '参考图预览';
      selectedReference.append(image, element('span', file.name), button('移除参考图', () => {
        reference.value = '';
        reference.onchange();
        reference.focus();
      }));
      selectedReference.hidden = false;
    };
    const help = element('p', '提示词和参考图至少提供一项。它们用于描述物件，画法沿用项目风格。', 'project-explanation');
    const submit = element('button', '生成', 'primary');
    submit.type = 'submit';
    const actions = element('div', '', 'environment-actions');
    actions.append(submit, element('span', '生成一张，检查通过后自动入库。', 'project-explanation'));
    form.append(element('p', '加入分组 · ' + destinationLabel(destination)), promptLabel, referenceLabel,
      selectedReference, help, actions);
    form.onsubmit = event => {
      event.preventDefault();
      void act(async () => {
        const file = reference.files[0];
        if (file?.size > 4 * 1024 * 1024) throw new Error('ENVIRONMENT_REFERENCE_LIMIT');
        if (!prompt.value.trim() && !file) throw new Error('ENVIRONMENT_SUBJECT_REQUIRED');
        const encoded = file ? await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }) : null;
        const job = await api('generate', { prompt: prompt.value.trim(), reference: encoded, placementRole: destination });
        showingForm = false;
        await receive(job);
      });
    };
    body.replaceChildren(form);
    if (previous && ['candidate', 'added', 'import-failed', 'rejected', 'indeterminate'].includes(previous.status)) {
      const history = element('div', '', 'environment-last-result');
      const summary = previous.status === 'added' ? '上次生成已入库'
        : previous.status === 'candidate' ? '上次结果可查看' : '上次生成未入库';
      history.append(element('span', summary + ' · ' + destinationLabel(previous.placementRole)),
        button('查看上次结果', () => render(previous)));
      body.append(history);
    }
    if (dialog.open) prompt.focus();
  }
  function schedule(job) {
    clearTimeout(timer);
    if (!isPending(job) && !(job?.status === 'added' && !hasAsset('environment-' + job.jobId))) return;
    timer = setTimeout(async () => {
      if (working) return schedule(job);
      try {
        const latest = await api();
        if (working) return schedule(lastJob);
        if (dialog.open) message.textContent = '';
        await receive(latest);
      } catch {
        if (dialog.open) message.textContent = '暂时无法读取进度，正在等待本机 Studio 恢复连接。';
        schedule(job);
      }
    }, 1000);
  }
  async function receive(job, opening = false) {
    lastJob = job;
    if (job?.status === 'added' && !hasAsset('environment-' + job.jobId)) await onAdded('environment-' + job.jobId);
    schedule(job);
    if (!dialog.open) return;
    const manualReview = job && !job.automatic && ['review-input', 'review-plan'].includes(job.status);
    if (opening && !isPending(job) && !manualReview)
      return showForm(job, job?.status === 'rejected' && (job.placementRole ?? 'environment') === destination ? job.prompt : '');
    if (!opening && showingForm) return;
    render(job);
  }
  function render(job) {
    if (!job) return showForm();
    const progressKey = isPending(job) ? job.jobId + '/' + job.status : undefined;
    if (progressKey && displayedProgress === progressKey) return;
    displayedProgress = progressKey;
    showingForm = false;
    clearReference();
    body.replaceChildren();
    const group = destinationLabel(job.placementRole);
    body.append(element('p', '加入分组 · ' + group));
    const actions = element('div', '', 'environment-actions');
    const accept = (label, targetSha256) => button(label, () => act(async () => {
      await receive(await api('authorize', { jobId: job.jobId, targetSha256 }));
    }), true);
    const abandon = button('放弃当前计划', () => act(async () => {
      showForm(await api('abandon', { jobId: job.jobId }));
    }));
    if (isPending(job)) {
      const step = job.status === 'candidate' ? 3 : job.status.startsWith('content-') ? 1 : 2;
      const labels = ['提取物件设定', '生成透明素材', '检查并加入素材库'];
      const progress = element('progress', '', 'environment-progress');
      progress.max = labels.length;
      if (step > 1) progress.value = step - 1;
      progress.setAttribute('aria-label', '环境素材生成进度');
      progress.setAttribute('aria-valuetext', `第 ${step} 步，共 ${labels.length} 步，${labels[step - 1]}`);
      const caption = element('p', `${step} / ${labels.length} · ${labels[step - 1]}`);
      caption.setAttribute('role', 'status');
      body.append(caption, progress, element('p', job.status.endsWith('-ready')
        ? '等待本机生成进程接收。' : '可关闭弹窗，任务会继续。', 'project-explanation'));
    } else if (job.status === 'review-input') {
      body.append(element('p', '确认后会单次提取设定，供你检查。'));
      if (job.prompt) body.append(element('p', job.prompt, 'environment-input-summary'));
      if (job.reference) body.append(element('p', `参考图 ${job.reference.pixelSize.width} × ${job.reference.pixelSize.height} · ${job.reference.sha256.slice(0, 12)}`));
      actions.append(accept('确认提取设定', job.briefSha256), abandon);
    } else if (job.status === 'review-plan') {
      const list = element('dl');
      for (const [key, label] of [['subject', '物件'], ['structure', '结构'], ['materials', '材质'], ['details', '细节']]) {
        if (job.content[key]) list.append(element('dt', label), element('dd', job.content[key]));
      }
      body.append(element('p', '请确认提取的设定。确认后会按项目风格生成一张透明素材。'), list);
      const details = element('details', '', 'environment-plan-details');
      details.append(element('summary', '查看冻结的出图计划'),
        element('p', `计划 · ${job.planSha256}`), element('p', `项目风格锚图 · ${job.styleAnchorSha256}`),
        element('pre', job.renderPrompt));
      body.append(details);
      actions.append(accept('确认生成一张', job.planSha256), abandon);
    } else if (['candidate', 'added', 'import-failed'].includes(job.status)) {
      const image = element('img', '', 'environment-candidate');
      image.alt = '待审阅的透明环境素材';
      image.src = `/environment-candidates/${job.jobId}/${job.sprite.sha256}.png`;
      const added = job.status === 'added' || hasAsset('environment-' + job.jobId);
      body.append(image, element('p', added ? '已加入「' + group + '」，可拖入画布。'
        : job.status === 'import-failed' ? `素材已生成，保存到素材库失败（${job.importIssue}）。`
          : '透明度与边缘检查通过。确认后可加入素材库。'));
      if (!added && !job.automatic) {
        const adopt = button('确认并加入素材库', () => act(async () => {
          await api('adopt', { jobId: job.jobId, spriteSha256: job.sprite.sha256 });
          location.reload();
        }), true);
        adopt.disabled = true;
        image.onload = () => { adopt.disabled = false; };
        actions.append(adopt);
      }
      actions.append(button('再生成一张', () => showForm(job)));
    } else {
      const issue = job.issues?.[0];
      body.append(element('p', job.status === 'indeterminate'
        ? '执行结果未确认，已保留本次记录。你可以另建计划。'
        : (issue && errors[issue]) || `该结果未进入素材库${job.issues?.length ? `（${job.issues.join('、')}）` : '。'}`));
      if (job.canRecheckMargin) actions.append(button('重新检查原图', () => act(async () => {
        await receive(await api('recheckMargin', { jobId: job.jobId }));
      }), true));
      actions.append(button('返回生成', () => showForm(job, job.prompt)));
    }
    body.append(actions);
  }
  dialog.addEventListener('close', clearReference);
  dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
  void api().then(job => { if (!working && !dialog.open) return receive(job); }).catch(() => {});
  return role => {
    destination = role;
    displayedProgress = undefined;
    if (!dialog.open) dialog.showModal();
    void act(async () => receive(await api(), true));
  };
}
