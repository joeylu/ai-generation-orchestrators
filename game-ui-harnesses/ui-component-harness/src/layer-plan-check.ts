/** Isolated deterministic render check. Receives validated local resources; never calls a model. */
import { bundleResources, validateBundle } from './bundle.ts';
import { createTreePreview, type TreeInspection, type TreePreview } from './tree-runtime.ts';
import { assertLayerTextRendering } from './layer-preview.ts';
import { walkNodes, type UiDocument } from './tree-contract.ts';
import { LayerLayoutRenderError, layerLayoutIssues, type LayerLayoutRenderReport } from './layer-layout-checks.ts';

interface CheckResult { status: 'pass' | 'repairable'; code: string; inspection?: TreeInspection;
  layoutChecks?: LayerLayoutRenderReport; issues?: ReturnType<typeof layerLayoutIssues> }
let preview: TreePreview | undefined;
const interactionEvents: unknown[] = [];
async function check(value: unknown): Promise<CheckResult> {
  preview?.destroy(); preview = undefined;
  interactionEvents.length = 0;
  const bundle = await validateBundle(value);
  if (!bundle.layerSource || bundle.document.schemaVersion !== '0.2') throw new Error('LAYER_RENDER_SOURCE_REQUIRED');
  const document = bundle.document as UiDocument, controller = new AbortController();
  const resources = new Map(bundleResources(bundle).map(resource => [resource.path, resource]));
  const images = new Map<string, Promise<HTMLImageElement>>();
  const host = window.document.getElementById('check-canvas')!;
  host.style.width = `${document.canvas.width}px`; host.style.height = `${document.canvas.height}px`;
  preview = await createTreePreview(host, () => {});
  preview.subscribe(event => { interactionEvents.push(event); });
  try {
    await preview.load(document, controller.signal, (source, signal) => {
      if (!images.has(source)) images.set(source, (async () => {
        const resource = resources.get(source); if (!resource) throw new Error('LAYER_RENDER_RESOURCE_MISSING');
        const url = URL.createObjectURL(new Blob([new Uint8Array(resource.bytes).buffer], { type: resource.mime }));
        try { const image = new Image(); image.src = url; await image.decode(); signal.throwIfAborted(); return image; }
        finally { URL.revokeObjectURL(url); }
      })());
      return images.get(source)!;
    });
    const inspection = preview.inspect();
    const layoutChecks = assertLayerTextRendering(bundle.layerSource.plan, inspection);
    // Explicit Text.error and Button labelLines overflow throw while loading.
    const textNodes = walkNodes(document).filter(node => node.type === 'Text' && node.props.text && node.props.overflow === 'error');
    if (textNodes.some(node => !inspection.nodes.find(item => item.id === node.id)?.renderedTextBounds?.length)) throw new Error('LAYER_RENDER_TEXT_MISSING');
    return { status: 'pass', code: 'LAYER_RENDER_PASS', inspection, ...(layoutChecks ? { layoutChecks } : {}) };
  } catch (error) {
    if (error instanceof LayerLayoutRenderError) return { status: 'repairable', code: 'LAYER_PLAN_LAYOUT_GAP',
      layoutChecks: error.report, issues: layerLayoutIssues(error.report), inspection: preview.inspect() };
    const message = error instanceof Error ? error.message : '';
    if (/^(?:LAYER_PLAN_TEXT_OVERFLOW|TEXT_OVERFLOW): [A-Za-z0-9._-]+(?: exceeds its explicit layout)?$/.test(message)) {
      return { status: 'repairable', code: message, ...(preview ? { inspection: preview.inspect() } : {}) };
    }
    throw new Error('LAYER_RENDER_FAILED');
  }
}
const snapshot = () => ({ inspection: preview!.inspect(), document: preview!.getDocument(), events: [...interactionEvents] });
window.layerPlanCheck = { check, snapshot, destroy: () => { preview?.destroy(); preview = undefined; } };
declare global { interface Window { layerPlanCheck: { check: typeof check; snapshot: typeof snapshot; destroy(): void } } }
