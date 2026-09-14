import type { UiBundle } from './bundle.ts';
import type { TreePreview } from './tree-runtime.ts';
import { validatePersistedHandoff, exportReferenceHandoff } from './reference-persistence.ts';
import { replayReferenceState } from './reference-replay.ts';
import { mappedReference } from './reference-visual.ts';
const observers = new WeakMap<HTMLElement, ResizeObserver>();
/** Live runtime stays above; reference is read-only and never replaces it. */
export async function mountReferencePanel(host: HTMLElement, saved: UiBundle, current: () => Promise<UiBundle>, preview: () => TreePreview | undefined, stopTimeline: () => void = () => {}, restoreReference = false) {
  observers.get(host)?.disconnect(); host.replaceChildren();
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '正在加载参考图…'; host.append(status);
  if (!saved.componentHandoff) { status.textContent = '此方案没有包内参考图。'; return; }
  const evidence = await validatePersistedHandoff(saved.componentHandoff, saved);
  if (!host.contains(status)) return;
  const checked = async () => {
    const bundle = await current();
    if (!host.contains(status) || bundle.componentHandoff?.sha256 !== saved.componentHandoff?.sha256) throw new Error('REFERENCE_PANEL_STALE');
    await validatePersistedHandoff(bundle.componentHandoff, bundle); return bundle;
  };
  const toolbar = document.createElement('div'), button = document.createElement('button');
  button.type = 'button'; button.textContent = '导出交付包'; toolbar.append(button); host.append(toolbar);
  button.onclick = async () => {
    button.disabled = true;
    try {
      const bytes = await exportReferenceHandoff(await checked());
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], {type:'application/zip'}));
      const link = document.createElement('a'); link.href = url; link.download = 'ui.component-handoff.draft.zip'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) { status.textContent = `交付包未导出：${String(error)}`; }
    finally { button.disabled = false; }
  };
  if (evidence.status !== 'complete') { status.textContent = '此交付包缺少参考证据，仍可操作上方画布。'; return; }
  const runtime = preview();
  if (restoreReference && runtime) { stopTimeline(); replayReferenceState(evidence, runtime); }
  const reference = await mappedReference(evidence); if (!host.contains(status)) return;
  const figure = document.createElement('figure'), caption = document.createElement('figcaption');
  caption.textContent = '参考图 · 已按合同映射，与上方画布同尺度';
  figure.style.cssText = 'margin:0;display:flex;flex-direction:column;align-items:center;width:100%';
  reference.style.cssText = 'display:block;max-width:100%;height:auto;cursor:default';
  figure.append(caption, reference); host.append(figure);
  const fit = () => { const canvas = preview()?.canvas; if (canvas) reference.style.width = `${canvas.getBoundingClientRect().width}px`; };
  fit(); if(runtime) { const observer=new ResizeObserver(fit); observer.observe(runtime.canvas); observers.set(host,observer); }
  status.textContent = evidence.unknownFields.length ? `部分参考状态未知（${evidence.unknownFields.length}项），不代表完整视觉验收通过。` : '参考图仅供对照，不代表自动视觉验收通过。';
}
