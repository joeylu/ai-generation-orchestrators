import { importDecompositionZip, MAX_DECOMPOSITION_ARCHIVE_BYTES } from './decomposition-import.ts';
import { validateAppearanceBinding, appearanceDocumentSha256 } from './appearance-binding.ts';
import type { UiDocument } from './tree-contract.ts';
import type { UiBundle } from './bundle.ts';

type Imported = Awaited<ReturnType<typeof importDecompositionZip>>;
type Binding = Awaited<ReturnType<typeof validateAppearanceBinding>>;
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Local file workflow. Captured semantics and material preview have separate lifetimes. */
export function createDecompositionPanel(hooks: {
  current: () => UiDocument | undefined;
  capture: () => Promise<UiBundle>;
  busy: () => boolean;
  preview: (delivery: Imported) => Promise<void>;
  apply: (delivery: Imported, binding: Binding, target: UiBundle) => Promise<void>;
  clearMaterialPreview: () => void;
}) {
  let revision = 0, working = false;
  let delivery: Imported | undefined, target: UiDocument | undefined, binding: Binding | undefined;
  let targetBundle: UiBundle | undefined;
  const status = (id: string, text: string) => { element(id).textContent = text; };
  function refresh() {
    const disabled = working || hooks.busy();
    element<HTMLInputElement>('decomposition-file').disabled = disabled;
    element<HTMLButtonElement>('decomposition-preview').disabled = disabled || !delivery;
    element<HTMLButtonElement>('appearance-target').disabled = disabled || !hooks.current();
    element<HTMLButtonElement>('appearance-target-export').disabled = disabled || !targetBundle;
    element<HTMLInputElement>('appearance-file').disabled = disabled || !delivery || !target;
    element<HTMLButtonElement>('appearance-export').disabled = disabled || !binding;
    element<HTMLButtonElement>('appearance-apply').disabled = disabled || !delivery || binding?.version !== '0.2' || !targetBundle;
    if (delivery || target || working) element<HTMLButtonElement>('studio-reset').disabled = false;
  }
  function reset() {
    revision++; working = false; delivery = undefined; target = undefined; binding = undefined; targetBundle = undefined;
    status('decomposition-status', '尚未导入拆分素材。');
    status('appearance-target-status', '先打开组件方案，再选择绑定目标。');
    status('appearance-status', '外观绑定用于衔接组件与图层；此处的外观绑定尚未应用到控件。');
    element('decomposition-details').hidden = true; element('decomposition-layers').replaceChildren(); refresh();
  }
  async function operation(work: (check: () => void) => Promise<void>, statusId: string) {
    if (working || hooks.busy()) return;
    const ticket = ++revision; working = true; refresh();
    const check = () => { if (ticket !== revision) throw new DOMException('Superseded import', 'AbortError'); };
    try { await work(check); }
    catch (error) { if (ticket === revision) status(statusId, `未通过校验：${error instanceof Error ? error.message : String(error)}`); }
    finally { if (ticket === revision) { working = false; refresh(); } }
  }
  element('decomposition-file').addEventListener('change', () => {
    const input = element<HTMLInputElement>('decomposition-file'), file = input.files?.[0]; input.value = '';
    if (!file) return;
    void operation(async check => {
      delivery = undefined; binding = undefined; element('decomposition-details').hidden = true;
      hooks.clearMaterialPreview();
      element('decomposition-layers').replaceChildren(); status('appearance-status', '素材已更换，请重新校验绑定。');
      status('decomposition-status', '正在校验本地拆分包…');
      if (!file.size || file.size > MAX_DECOMPOSITION_ARCHIVE_BYTES) throw new Error('ZIP_SIZE_LIMIT');
      const bytes = new Uint8Array(await file.arrayBuffer()); check();
      const imported = await importDecompositionZip(bytes); check(); delivery = imported;
      status('decomposition-status', `${imported.canvas.width} × ${imported.canvas.height} · ${imported.layers.length} 个图层 · ${imported.review.humanVisualAcceptance ? '上游声明已人工审核' : '未人工审核的草稿'}。完整性校验通过。`);
      if (imported.review.automatedQa) element('decomposition-status').append(` 自动检查：${imported.review.automatedQa.outcome}（不代替人工验收）。`);
      element('decomposition-layers').replaceChildren(...imported.layers.map(layer => {
        const li = document.createElement('li'); li.textContent = `${layer.id} · ${layer.left}, ${layer.top} · ${layer.width} × ${layer.height}`; return li;
      }));
      element('decomposition-details').hidden = false;
    }, 'decomposition-status');
  });
  element('appearance-target').addEventListener('click', () => {
    void operation(async check => {
      binding = undefined; target = undefined; targetBundle = undefined;
      status('appearance-status', '绑定目标已更换，请重新校验绑定。');
      if (!hooks.current()) throw new Error('COMPONENT_TARGET_REQUIRED');
      const capturedBundle = await hooks.capture(); check();
      if (capturedBundle.document.schemaVersion !== '0.2') throw new Error('COMPONENT_TARGET_REQUIRED');
      const captured = structuredClone(capturedBundle.document), digest = await appearanceDocumentSha256(captured); check();
      target = captured; targetBundle = capturedBundle;
      status('appearance-target-status', `已固定目标：${target.id} · ${digest}。之后的画布操作不会改变此快照。`);
    }, 'appearance-target-status');
  });
  element('decomposition-preview').addEventListener('click', () => {
    void operation(async check => { if (!delivery) return; await hooks.preview(delivery); check(); }, 'decomposition-status');
  });
  element('appearance-file').addEventListener('change', () => {
    const input = element<HTMLInputElement>('appearance-file'), file = input.files?.[0]; input.value = '';
    if (!file) return;
    void operation(async check => {
      binding = undefined; status('appearance-status', '正在校验绑定…');
      if (!delivery || !target) throw new Error('BINDING_CONTEXT_REQUIRED');
      if (!file.size || file.size > 1024 * 1024) throw new Error('BINDING_SIZE_LIMIT');
      const value: unknown = JSON.parse(await file.text()); check();
      const validated = await validateAppearanceBinding(value, target, delivery); check(); binding = validated;
      status('appearance-status', validated.version === '0.2'
        ? `${validated.bindings.length} 个组件的可应用绑定已校验，可直接应用并预览。`
        : `${validated.bindings.length} 个组件的 0.1 兼容绑定已校验。可导出；此处的外观绑定尚未应用到控件。`);
    }, 'appearance-status');
  });
  element('appearance-export').addEventListener('click', () => {
    if (!binding || working || hooks.busy()) return;
    download(binding, 'ui-appearance-binding.json');
  });
  element('appearance-apply').addEventListener('click', () => {
    void operation(async check => {
      if (!delivery || !binding || !targetBundle) throw new Error('BINDING_CONTEXT_REQUIRED');
      await hooks.apply(delivery, binding, targetBundle); check();
      status('appearance-status', `${binding.bindings.length} 个组件的外观已确定性应用，可切换方案、交互并导出。`);
    }, 'appearance-status');
  });
  element('appearance-target-export').addEventListener('click', () => {
    if (!targetBundle || working || hooks.busy()) return;
    download(targetBundle, 'appearance-target.ui-bundle.json');
  });
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { refresh, reset };
}
