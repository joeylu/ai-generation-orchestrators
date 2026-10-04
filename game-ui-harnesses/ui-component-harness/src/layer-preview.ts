/** Browser render evidence gate; portable plan validation alone cannot measure system fonts. */
import type { LayerComponentPlan } from './layer-component.ts';
import { walkNodes } from './tree-contract.ts';
import { checkLayerLayoutRendering, LayerLayoutRenderError, type LayerLayoutInspection, type LayerLayoutRenderReport } from './layer-layout-checks.ts';

export interface LayerTextInspection extends LayerLayoutInspection {
  nodes: Array<{ id: string; value?: unknown; visible?: boolean; bounds?: import('./tree-contract.ts').Layout; renderedTextBounds?: Array<{ text: string; bounds?: import('./tree-contract.ts').Layout;
    implicitTruncation?: { textId: string; requestedText: string; overflowAxis?: 'x' | 'y' | 'both'; ellipsisFits?: boolean } }> }>;
}
export function assertLayerTextRendering(plan: LayerComponentPlan | undefined, inspection: LayerTextInspection): LayerLayoutRenderReport | undefined {
  if (plan?.basis !== 'model-proposed' && !plan?.layoutChecks) return;
  const definitions = new Map(plan ? walkNodes(plan.document).map(node => [node.id, node]) : []);
  for (const node of inspection.nodes) {
    for (const text of node.renderedTextBounds ?? []) {
      if (plan?.basis === 'model-proposed' && text.implicitTruncation) {
        const definition = definitions.get(node.id), truncation = text.implicitTruncation;
        // Only an authenticated, declared Input value policy permits horizontal
        // ellipsis. Placeholder, vertical overflow and unmeasurable glyphs remain errors.
        const declaredValue = definition?.type === 'Input' && definition.props.valueOverflow === 'ellipsis'
          && typeof node.value === 'string' && node.value.length > 0 && node.value.length <= definition.props.maxLength
          && truncation.textId === `${node.id}.label` && truncation.overflowAxis === 'x' && truncation.ellipsisFits === true
          && truncation.requestedText === (definition.props.inputType === 'password' ? '•'.repeat(node.value.length) : node.value);
        if (!declaredValue) throw new Error(`LAYER_PLAN_TEXT_OVERFLOW: ${truncation.textId}`);
      }
    }
  }
  if (plan?.layoutChecks) {
    const report = checkLayerLayoutRendering(plan.layoutChecks, plan.document, inspection);
    if (report.status === 'repairable') throw new LayerLayoutRenderError(report);
    return report;
  }
}
