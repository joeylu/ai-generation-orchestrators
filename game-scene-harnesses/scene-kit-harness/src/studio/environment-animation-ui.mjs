import { animationFrameRect, defaultEnvironmentAnimationAnchor, environmentAnimationTransform,
  measureEnvironmentAnimationBaseLock, registerEnvironmentAnimationPose } from '../environment-animation.mjs';

const typeLabels = { static: '静态', idle: '默认 · Idle', interactive: '交互物' };
const playbackLabels = { hold: '静止', loop: '循环', once: '播放一次' };
const generationEndpoint = '/api/environment-animation/generation';
const make = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};
function button(text, run) {
  const element = make('button', text);
  element.type = 'button';
  element.onclick = run;
  return element;
}
function field(name, input) {
  const label = make('label', name);
  input.setAttribute('aria-label', name);
  label.append(input);
  return label;
}
function select(options, value, change) {
  const element = make('select');
  for (const [key, label] of options) element.add(new Option(label, key));
  element.value = value;
  element.onchange = () => change(element.value);
  return element;
}
function number(value, min, max, change) {
  const element = make('input');
  Object.assign(element, { type: 'number', value, min, max, step: 1, required: true });
  element.onchange = () => change(element.valueAsNumber);
  return element;
}
function mediaPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取动画 PNG。'));
    reader.readAsDataURL(file);
  });
}
function savedDraft(module) {
  const draft = structuredClone(module.animation);
  for (const state of draft.states) if (state.clip) {
    const { source, columns, rows, frameMs } = state.clip;
    state.media = { sha256: source.sha256, savedClip: state.clip };
    state.columns = columns; state.rows = rows; state.frameMs = frameMs;
    state.baseLock = Boolean(state.clip.baseLock);
    delete state.clip;
  }
  return draft;
}

function readImageRect(image, { x, y, width, height }, canvas = make('canvas')) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
  return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
}

export function mountEnvironmentAnimation({ getState, canOperate, setBusy, apply, download }) {
  const dialog = make('dialog');
  dialog.className = 'project-dialog animation-dialog';
  dialog.setAttribute('aria-label', '环境素材动画');
  document.body.append(dialog);
  let working = false, stopPreview = () => {}, stopGeneration = () => {};
  dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
  dialog.addEventListener('close', () => { stopPreview(); stopGeneration(); });
  return function open(module, title) {
    if (dialog.open || working || !canOperate()) return;
    const opened = getState(), revision = opened.revision;
    const defaults = { columns: 4, rows: 4, frameMs: 160 };
    const fresh = (id, name, playback) => ({ id, name, playback });
    const drafts = {
      idle: { type: 'idle', initial: 'idle', states: [fresh('idle', 'Idle', 'loop')] },
      interactive: { type: 'interactive', initial: 'idle', states: [fresh('idle', '默认状态', 'hold')] },
    };
    if (module.animation) drafts[module.animation.type] = savedDraft(module);
    const submitted = new Map(), loaded = new Set();
    let type = module.animation?.type ?? 'static', selected = drafts.interactive.initial;
    const body = make('div'), message = make('p');
    message.className = 'project-message';
    message.setAttribute('role', 'status');
    const feedback = text => { message.textContent = text; };
    const form = make('form');
    form.className = 'animation-form';
    const heading = make('div');
    heading.className = 'project-dialog-heading';
    heading.append(make('h2', title + ' · 动画'), button('关闭', () => dialog.close()));
    const save = make('button', '保存动画设置');
    save.type = 'submit';
    const run = async (url, data, success) => {
      if (working || !canOperate()) return;
      working = true;
      setBusy(true);
      const enabled = [...dialog.querySelectorAll('button,input,select,textarea')].filter(control => !control.disabled);
      enabled.forEach(control => { control.disabled = true; });
      try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision, assetId: module.assetId, ...await data() }) });
        if (!response.ok) {
          const error = await response.json(), code = error.errors?.[0]?.code ?? error.code;
          throw new Error(error.message ?? ({
            STALE_REVISION: '项目已更新。请关闭后重新打开动画设置。',
            ANIMATION_ATLAS_GRID: '帧表尺寸与行列数不匹配。',
            ANIMATION_FRAME_COUNT: '静止状态需要 1 帧，循环或播放一次需要至少 2 帧。',
            ANIMATION_BASE_LOCK: '无法定位每帧底座。检查行列数和帧表透明度，或关闭固定底座。',
            BODY_LIMIT: '本次上传总量超过 24 MiB。',
            WORKFLOW_TEXT: '请填写简短的动作描述。',
            ANIMATION_WORKER_OFFLINE: '本机动画生成进程未连接。',
            ANIMATION_OPERATION_ACTIVE: '正在生成另一张动画帧表，请等它完成。',
            ANIMATION_PLAN_CHANGED: '此计划已失效，请重新准备后确认。',
          }[code] ?? `动画设置校验失败（${code}）。`));
        }
        await success(response);
      } catch (error) {
        feedback(error instanceof TypeError ? '与本机服务的连接已中断，请刷新核对保存结果。' : error.message);
      } finally {
        working = false;
        setBusy(false);
        enabled.forEach(control => { control.disabled = false; });
      }
    };
    const gridOf = state => state.playback === 'hold'
      ? { columns: 1, rows: 1, frameMs: state.frameMs ?? defaults.frameMs }
      : { columns: state.columns ?? defaults.columns, rows: state.rows ?? defaults.rows, frameMs: state.frameMs ?? defaults.frameMs };
    const savedClipFor = (state, { columns, rows }) => {
      const clip = state.media?.savedClip;
      if (clip?.columns === columns && clip.rows === rows) return clip;
    };
    const manualAnchorFor = (state, grid) => {
      const clip = savedClipFor(state, grid);
      if (!clip || clip.registration) return {};
      const automatic = defaultEnvironmentAnimationAnchor(module, clip.frameSize);
      return clip.anchorPx.x === automatic.x && clip.anchorPx.y === automatic.y ? {} : { anchorPx: clip.anchorPx };
    };
    function render() {
      stopPreview();
      stopGeneration();
      body.replaceChildren();
      if (type === 'static') {
        body.append(make('p', '在场景中显示原始素材。'));
        return;
      }
      const draft = drafts[type];
      const state = type === 'idle' ? draft.states[0] : draft.states.find(item => item.id === selected);
      if (type === 'interactive') {
        const options = draft.states.map(item => [item.id, item.name]);
        const stateBar = make('div');
        stateBar.className = 'animation-fields';
        stateBar.append(field('编辑状态', select(options, selected, value => { selected = value; render(); })),
          field('初始状态', select(options, draft.initial, value => { draft.initial = value; })));
        const add = button('添加状态', () => {
          const id = 'state-' + crypto.randomUUID();
          draft.states.push(fresh(id, `状态 ${draft.states.length + 1}`, 'hold'));
          selected = id;
          render();
        });
        add.disabled = draft.states.length >= 12;
        const remove = button('删除当前状态', () => {
          draft.states = draft.states.filter(item => item !== state);
          selected = draft.states[0].id;
          if (draft.initial === state.id) draft.initial = selected;
          for (const item of draft.states) {
            if (item.onInteract === state.id) delete item.onInteract;
            if (item.onFinish === state.id) delete item.onFinish;
          }
          render();
        });
        remove.disabled = draft.states.length === 1;
        stateBar.append(add, remove);
        const name = make('input');
        Object.assign(name, { value: state.name, required: true, maxLength: 40 });
        name.onchange = () => { state.name = name.value.trim(); };
        const choices = [['', '保持当前状态'], ...options];
        const changeTarget = key => value => { if (value) state[key] = value; else delete state[key]; };
        body.append(stateBar, field('状态名称', name),
          field('播放方式', select(Object.entries(playbackLabels), state.playback, value => {
            state.playback = value;
            if (value !== 'once') delete state.onFinish;
            render();
          })),
          field('点击后', select(choices, state.onInteract ?? '', changeTarget('onInteract'))));
        if (state.playback === 'once')
          body.append(field('播放完成后', select(choices, state.onFinish ?? '', changeTarget('onFinish'))));
      } else body.append(make('p', '放入场景后自动循环播放 Idle。'));

      const file = make('input');
      Object.assign(file, { type: 'file', accept: 'image/png,.png', hidden: true });
      file.onchange = () => {
        const picked = file.files[0];
        if (!picked) return;
        if (picked.size > 16 * 1024 * 1024) { feedback('单张 PNG 最大 16 MiB。'); file.value = ''; return; }
        state.media = { file: picked };
        feedback('');
        render();
      };
      const fileRow = make('div');
      fileRow.className = 'animation-fields';
      const picker = button(state.media ? '更换 PNG' : '选择 PNG', () => file.click());
      fileRow.append(picker);
      if (state.media) {
        fileRow.append(make('p', state.media.file?.name ?? '已保存的帧表'),
          button('移除帧表', () => { delete state.media; render(); }));
      }
      body.append(field(state.playback === 'hold' ? '静止姿态 PNG（可选）' : '动画帧表 PNG', file), fileRow);
      if (state.playback !== 'hold') {
        const group = make('div');
        group.className = 'animation-fields';
        const { columns, rows, frameMs } = gridOf(state);
        group.append(field('列数', number(columns, 1, 8, value => { state.columns = value; resetPreview(); })),
          field('行数', number(rows, 1, 8, value => { state.rows = value; resetPreview(); })),
          field('每帧毫秒', number(frameMs, 40, 2000, value => { state.frameMs = value; })));
        body.append(group);
      }
      const baseLockStatus = make('p');
      baseLockStatus.setAttribute('role', 'status');
      baseLockStatus.hidden = true;
      const showBaseLockStatus = text => {
        if (baseLockStatus.textContent !== text) baseLockStatus.textContent = text;
        baseLockStatus.hidden = !text;
      };
      if (state.media && state.playback !== 'hold') {
        body.append(field('逐帧定位', select([['original', '保留原始运动'], ['locked', '固定底座']],
          state.baseLock ? 'locked' : 'original', value => {
            state.baseLock = value === 'locked';
            previewFrame(lastIndex);
          })), baseLockStatus);
      }
      const canvas = make('canvas');
      canvas.width = 480;
      canvas.height = 220;
      canvas.setAttribute('aria-label', '当前状态动画预览');
      body.append(canvas);
      const image = new Image();
      const blobUrl = state.media?.file ? URL.createObjectURL(state.media.file) : undefined;
      const atlasUrl = blobUrl ?? opened.animationAtlases?.[state.media?.sha256];
      const still = atlasUrl ? new Image() : image;
      const { width: staticWidth, height: staticHeight } = module.pixelSize;
      const viewportScale = Math.min((canvas.width - 28) / staticWidth, (canvas.height - 24) / staticHeight);
      const originX = (canvas.width - staticWidth * viewportScale) / 2;
      const originY = (canvas.height - staticHeight * viewportScale) / 2;
      let requestId, measured, measuredLock, lastIndex = 0;
      stopPreview = () => {
        cancelAnimationFrame(requestId);
        image.onload = null;
        image.onerror = null;
        still.onload = null;
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      };
      const ctx = canvas.getContext('2d');
      function clipForPreview(grid, width, height) {
        const saved = savedClipFor(state, grid);
        if (saved) return saved;
        const { columns, rows } = grid;
        if (measured?.columns === columns && measured.rows === rows) return measured;
        const first = animationFrameRect(0, width, height, columns, rows);
        const frameSize = { width: Math.ceil(width / columns), height: Math.ceil(height / rows) };
        const source = readImageRect(still, { x: 0, y: 0, width: staticWidth, height: staticHeight });
        const pose = readImageRect(image, first);
        const registration = registerEnvironmentAnimationPose(source, pose, { ...first, x: 0, y: 0 });
        measured = { columns, rows, frameSize, anchorPx: defaultEnvironmentAnimationAnchor(module, frameSize), registration };
        return measured;
      }
      function lockForPreview(grid, width, height) {
        if (!state.baseLock || state.playback === 'hold') return undefined;
        const saved = savedClipFor(state, grid)?.baseLock;
        if (saved) return saved;
        const { columns, rows } = grid;
        if (measuredLock?.columns !== columns || measuredLock?.rows !== rows) {
          const scratch = make('canvas');
          const offsets = measureEnvironmentAnimationBaseLock(width, height, grid, rect => ({
            image: readImageRect(image, rect, scratch), rect: { ...rect, x: 0, y: 0 },
          }));
          measuredLock = { columns, rows, offsets };
        }
        return measuredLock.offsets;
      }
      function previewFrame(index) {
        lastIndex = index;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!still.naturalWidth) return;
        if (!atlasUrl || !image.naturalWidth) {
          ctx.drawImage(still, originX, originY, staticWidth * viewportScale, staticHeight * viewportScale);
          return;
        }
        const grid = gridOf(state), { columns, rows } = grid;
        const { naturalWidth, naturalHeight } = image;
        if (![columns, rows].every(count => Number.isInteger(count) && count >= 1 && count <= 8)
          || naturalWidth > 4096 || naturalHeight > 4096 || Math.floor(naturalWidth / columns) < 8
          || Math.floor(naturalHeight / rows) < 8) {
          showBaseLockStatus(state.baseLock ? '请先检查帧表行列数和尺寸。' : '');
          return;
        }
        const { x, y, width, height } = animationFrameRect(index, naturalWidth, naturalHeight, columns, rows);
        const clip = clipForPreview(grid, naturalWidth, naturalHeight);
        const baseLock = lockForPreview(grid, naturalWidth, naturalHeight);
        const status = state.baseLock && state.playback !== 'hold' && !baseLock
          ? '有帧缺少可识别的底座。当前预览保留原始运动。' : '';
        showBaseLockStatus(status);
        const placement = environmentAnimationTransform(module, { ...clip, baseLock }, index);
        const scale = viewportScale * placement.scale;
        ctx.drawImage(image, x, y, width, height, originX + placement.x * viewportScale,
          originY + placement.y * viewportScale, width * scale, height * scale);
      }
      function resetPreview() {
        cancelAnimationFrame(requestId);
        previewFrame(0);
      }
      still.onload = resetPreview;
      image.onerror = () => feedback('这张 PNG 无法预览。');
      still.src = module.url;
      if (atlasUrl) {
        image.onload = resetPreview;
        image.src = atlasUrl;
      }
      if (state.media && state.playback !== 'hold') {
        body.append(button('播放当前状态', () => {
          if (!form.reportValidity()) return;
          cancelAnimationFrame(requestId);
          const start = performance.now(), { columns, rows, frameMs } = gridOf(state), count = columns * rows;
          const tick = now => {
            const index = Math.floor((now - start) / frameMs);
            previewFrame(state.playback === 'once' ? Math.min(count - 1, index) : index % count);
            if (state.playback !== 'once' || index < count - 1) requestId = requestAnimationFrame(tick);
          };
          requestId = requestAnimationFrame(tick);
        }));
      }
      const generation = make('details');
      generation.append(make('summary', '生成当前状态的帧表'));
      const motion = make('textarea');
      motion.rows = 2;
      motion.maxLength = 500;
      motion.value = state.motion ?? (type === 'idle' ? '自然、小幅度地循环运动，基部保持固定。' : '');
      motion.onchange = () => { state.motion = motion.value; };
      const input = () => ({ stateId: state.id, playback: state.playback, motion: motion.value.trim(), ...gridOf(state) });
      function prepare() {
        if (!form.reportValidity()) return;
        if (!motion.value.trim()) { feedback('请先填写动作描述。'); motion.focus(); return; }
        feedback('正在准备生成计划…');
        if (opened.animationGeneration) {
          void run(generationEndpoint, async () => ({ action: 'prepare', input: input() }), async response => {
            const plan = await response.json();
            const { columns, rows, frameMs, motion: description } = plan.input;
            confirmation.replaceChildren(make('p', `${title} · ${state.name} · ${columns} × ${rows} · 每帧 ${frameMs} 毫秒`),
              make('p', description), make('p', plan.planSha256),
              button('确认生成一次', () => {
                if (Object.entries(plan.input).some(([key, value]) => input()[key] !== value)) {
                  confirmation.replaceChildren();
                  feedback('动作或帧参数已修改，请重新准备计划。');
                  return;
                }
                void run(generationEndpoint, async () => ({ action: 'confirm', planSha256: plan.planSha256 }), async result => {
                  const job = await result.json();
                  submitted.set(job.planSha256, state.media);
                  confirmation.replaceChildren();
                  feedback('');
                  render();
                });
              }));
            feedback('请确认本次生成计划。');
          });
          return;
        }
        void run('/api/environment-animation/plan', async () => ({ input: input() }), async response => {
          download(`${module.assetId}-${state.id}-plan.zip`, await response.blob());
          feedback('已下载生成计划。使用 scripts/environment-animation.mjs inspect 查看计划与摘要。');
        });
      }
      const generate = button(opened.animationGeneration ? '生成帧表' : '下载生成计划', prepare);
      const confirmation = make('div');
      confirmation.style.overflowWrap = 'anywhere';
      generation.append(field('动作描述', motion), generate, confirmation);
      if (!opened.animationGeneration) generation.append(make('p', '下载计划后，用本机 Codex CLI 检查摘要并确认执行，再把输出的 raw.png 导入当前状态。'));
      else {
        const progress = make('p'), useResult = button('使用生成结果', () => {});
        progress.setAttribute('role', 'status');
        useResult.hidden = true;
        generation.append(progress, useResult);
        generation.open = submitted.size > 0;
        let cancelled = false, timer;
        stopGeneration = () => { cancelled = true; clearTimeout(timer); };
        async function attach(job) {
          useResult.disabled = true;
          try {
            const response = await fetch(`${generationEndpoint}/${job.planSha256}.png`);
            if (!response.ok) throw new Error('无法载入生成的帧表。');
            const blob = await response.blob();
            if (cancelled) return;
            const { columns, rows, frameMs } = job.input;
            Object.assign(state, { columns, rows, frameMs, media: { file: new File([blob], '生成帧表.png', { type: 'image/png' }) } });
            loaded.add(job.planSha256);
            feedback('帧表已载入预览。保存动画设置后生效。');
            render();
          } catch (error) {
            if (!cancelled) { progress.textContent = error.message; useResult.disabled = false; useResult.hidden = false; }
          }
        }
        async function poll() {
          try {
            const response = await fetch(generationEndpoint);
            if (!response.ok) throw new Error();
            const { available, current } = await response.json();
            if (cancelled) return;
            const active = ['ready', 'running'].includes(current?.status);
            const match = current?.assetId === module.assetId && current.input.stateId === state.id
              && current.input.playback === state.playback;
            if (!working) generate.disabled = !available || active;
            if (match && !loaded.has(current.planSha256)) {
              if (!progress.textContent) generation.open = true;
              const status = ({
                ready: '已确认，等待本机进程开始。',
                running: '正在生成并检查帧表…',
                pass: '帧表通过检查，可载入预览。',
                fail: `帧表未通过检查（${current.issues.join('、')}）。`,
                blocked: '本机生成工作目录过长，Codex 未启动。原计划已终止。',
                unknown: '生成结果未知。原计划已终止。',
              })[current.status] ?? '';
              const text = !available && current.status !== 'pass' ? `${status} 本机动画生成进程未连接。` : status;
              if (progress.textContent !== text) progress.textContent = text;
              useResult.hidden = current.status !== 'pass';
              useResult.onclick = () => void attach(current);
              if (current.status === 'pass' && submitted.has(current.planSha256)
                && submitted.get(current.planSha256) === state.media && !useResult.disabled) {
                submitted.delete(current.planSha256);
                await attach(current);
              }
            } else {
              const text = !available ? '本机动画生成进程未连接。' : active ? '正在生成另一张动画帧表。' : '';
              if (progress.textContent !== text) progress.textContent = text;
              useResult.hidden = true;
            }
          } catch {
            if (!cancelled) progress.textContent = '暂时无法读取本机生成状态。';
          } finally {
            if (!cancelled) timer = setTimeout(poll, 1100);
          }
        }
        void poll();
      }
      body.append(generation);
    }
    const footer = make('footer');
    footer.className = 'animation-footer';
    footer.append(message, save);
    form.append(heading, field('素材类型', select(Object.entries(typeLabels), type, value => {
      type = value;
      feedback('');
      render();
    })), body, footer);
    form.onsubmit = event => {
      event.preventDefault();
      const draft = drafts[type];
      if (draft?.states.some(state => state.playback !== 'hold' && !state.media)) {
        feedback('请给每个播放状态导入帧表。静止状态可以使用原图。');
        return;
      }
      feedback('正在校验并保存动画…');
      void run('/api/environment-animation', async () => ({ animation: type === 'static' ? null : {
        type, initial: draft.initial,
        states: await Promise.all(draft.states.map(async state => ({
          id: state.id, name: state.name, playback: state.playback,
          ...(state.onInteract ? { onInteract: state.onInteract } : {}),
          ...(state.onFinish ? { onFinish: state.onFinish } : {}),
          ...(state.media ? { clip: { ...gridOf(state), ...(state.baseLock && state.playback !== 'hold' ? { baseLock: true } : {}),
            ...(state.media.file
            ? { png: await mediaPayload(state.media.file) }
            : { sha256: state.media.sha256, ...manualAnchorFor(state, gridOf(state)) }) } } : {}),
        }))),
      } }), async response => {
        const latest = await response.json();
        try { await apply(latest); }
        catch { throw new Error('动画已保存到本机。请刷新后查看。'); }
        dialog.close();
      });
    };
    render();
    dialog.replaceChildren(form);
    dialog.showModal();
  };
}
