import { layerPlanningFixture, fixtureFindings } from './layer-planning-fixture.ts';
import { fixtureStyle } from '../../src/fixtures.ts';
import type { LayerComponentPlan } from '../../src/layer-component.ts';
import type { TextNode } from '../../src/tree-contract.ts';

/** Synthetic labels and source artwork only; deliberately overlapping name/count. */
export async function layerLayoutFixture() {
  const fixture = await layerPlanningFixture();
  const plan: LayerComponentPlan = structuredClone(fixture.proposal.plan) as LayerComponentPlan;
  const text = (id: string, value: string, y: number): TextNode => ({ id, type: 'Text',
    layout: { x: 95, y, width: 100, height: 24 }, props: { text: value, wrap: 'none', overflow: 'error', lineHeight: 15,
      drawBackground: false, style: { ...fixtureStyle, fontFamily: 'Arial', fontSize: 12, borderWidth: 0 } } });
  plan.document.root.children.push(
    { id: 'spacing-icon', type: 'Image', layout: { x: 79, y: 25, width: 12, height: 14 },
      props: { source: 'layers/layer-002.png', fit: 'stretch', drawBackground: false, style: { ...fixtureStyle, borderWidth: 0 } } },
    text('name', 'Name', 25), text('count', '4/4', 30));
  plan.bindings.push({ layerId: 'button', pointer: '/root/children/2/props/source' });
  plan.layoutChecks = { version: '1.0', separations: [
    { id: 'icon-name', firstId: 'spacing-icon', secondId: 'name', axis: 'x', minGap: 4, reason: 'Synthetic icon precedes caption with four canvas pixels.' },
    { id: 'name-count', firstId: 'name', secondId: 'count', axis: 'y', minGap: 4, reason: 'Synthetic name sits above its count with four canvas pixels.' },
  ], unpairedText: [] };
  const proposal = { ...fixture.proposal, plan, findings: fixtureFindings(plan.document) };
  const corrected = structuredClone(proposal);
  corrected.plan.document.root.children.find(node => node.id === 'count')!.layout.y = 60;
  return { ...fixture, proposal, corrected, plan };
}
