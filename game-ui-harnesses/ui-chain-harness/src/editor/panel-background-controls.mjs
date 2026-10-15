import { attachBackground } from '../panel/backgrounds.mjs';
import { maxPanelJsonBytes } from '../slicing/package.mjs';
import { exportBackgroundPng } from '../slicing/export.mjs';
import { loadSliceAsset } from '../slicing/asset.mjs';
import { automaticSliceDocument } from '../slicing/automatic.mjs';
import { createBackgroundPackage } from '../slicing/package.mjs';
import { maxSourceBytes } from '../slicing/source.mjs';

export function panelBackgroundControls({ host, node, session, app, act, download, mode, selected }) {
  const section = document.createElement('section'); section.className = 'panel-background-controls';
  const heading = document.createElement('div'); heading.className = 'form-section'; heading.textContent = 'Panel 背景'; section.append(heading);
  const note = document.createElement('p'); note.className = 'property-note';
  note.textContent = node.props.backgroundRef
    ? '已绑定九宫格素材。修改上方宽高和倍率可更新背景；内容边距独立设置。'
    : '默认工程皮肤。可导入九宫格工具导出的背景包，仅替换这个 Panel。';
  section.append(note);
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true; file.id = 'panel-background-file';
  const button = (id, label, action) => {
    const el = document.createElement('button'); el.id = id; el.type = 'button'; el.textContent = label;
    el.disabled = mode !== 'edit' || node.locked; el.onclick = action; section.append(el); return el;
  };
  button('import-panel-background', '导入背景包', () => file.click());
  file.onchange = () => {
    const input = file.files[0]; file.value = ''; if (!input) return;
    const base = session.revision;
    act(async () => {
      if (input.size > maxPanelJsonBytes) throw Error('背景包最大为 12 MiB。');
      const candidate = attachBackground(session.document, node.id, JSON.parse(await input.text()));
      await session.commit(candidate, base);
    }, '已绑定背景。Panel 尺寸和内容保持原设置，可撤销。');
  };
  section.append(file);
  const png = document.createElement('input'); png.type = 'file'; png.accept = 'image/png,.png'; png.hidden = true; png.id = 'panel-background-png';
  button('import-panel-png', '导入 PNG · 自动配置', () => png.click());
  png.onchange = () => {
    const input = png.files[0]; png.value = ''; if (!input) return;
    const base = session.revision;
    act(async () => {
      if (input.size > maxSourceBytes) throw Error('PNG 最大为 32 MiB。');
      const asset = await loadSliceAsset(await input.arrayBuffer());
      try {
        const doc = automaticSliceDocument(asset, node.size);
        const pack = await createBackgroundPackage(doc, asset.blob);
        if (selected() !== node.id) throw Error('选择已变化，请重新导入。');
        await session.commit(attachBackground(session.document, node.id, pack), base);
      } finally { asset.dispose(); }
    }, '已自动配置 Panel 背景，可直接调整面板尺寸。');
  };
  section.append(png);
  const resolution = document.createElement('select'); resolution.id = 'panel-png-resolution'; resolution.setAttribute('aria-label', '背景 PNG 输出分辨率');
  for (const value of [1, 2, 4]) { const option = document.createElement('option'); option.value = value; option.textContent = `${value}× PNG`; resolution.append(option); }
  section.append(resolution);
  button('export-panel-background', '导出当前背景 PNG', () => act(async () => {
    const base = session.revision;
    const bg = session.current.runtime.handles.get(node.id).adapter.bg;
    const result = await exportBackgroundPng(app.renderer, bg, Number(resolution.value));
    if (base !== session.revision || selected() !== node.id) throw Error('当前选择或参数已变化，请重新导出。');
    download(`${node.id}-${result.width}x${result.height}.png`, result.blob);
  }, '已导出当前尺寸的背景 PNG，不包含文字和子控件。'));
  host.append(section);
}
