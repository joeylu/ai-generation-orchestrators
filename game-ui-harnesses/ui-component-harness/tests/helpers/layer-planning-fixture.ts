import { requiredLayerDecisionFields } from '../../src/layer-planning-evidence.ts';
import { layerSha256 } from '../../src/layer-component.ts';
import { walkNodes, type UiDocument } from '../../src/tree-contract.ts';
import type { LayerPlanningFinding, LayerMissingInput } from '../../src/layer-planning-evidence.ts';
import { layerComponentFixture } from './layer-component-fixture.ts';

export function fixtureFindings(document: UiDocument) {
  const findings: LayerPlanningFinding[] = requiredLayerDecisionFields(document).map(field => ({ ...field,
    basis: field.pointer === '/props/drawBackground' ? 'explicit-policy' as const : field.pointer.includes('/style/') ? 'inferred' as const : 'observed' as const,
    note: field.pointer.includes('/style/') ? 'Explicit procedural fixture typography proposal.' : 'Programmatic fixture evidence; no live model observation.',
  }));
  findings.push(...fixtureProceduralAdaptations(document).map(adaptation => ({ componentId: adaptation.componentId,
    pointer: '/props/style', basis: 'explicit-policy' as const, note: 'Explicit procedural fixture style; no source artwork recovery claimed.' })));
  return findings;
}
export function fixtureProceduralAdaptations(document: UiDocument) {
  return walkNodes(document).filter(node => !['Container', 'Image', 'Text'].includes(node.type)
    && !Object.hasOwn(node.props, 'appearance') && !Object.hasOwn(node.props, 'backgroundImage'))
    .map(node => ({ kind: 'procedural-control' as const, componentId: node.id, reason: 'Explicit procedural contract fixture.' }));
}
export async function layerPlanningFixture() {
  const fixture = await layerComponentFixture();
  for (const node of walkNodes(fixture.plan.document)) if (node.type === 'Button') node.props.interaction = {
    version: '1.0', mode: 'external', reason: 'Programmatic fixture tests standalone activation; no destination is defined.',
  };
  const proposal = { version: '1.1', reason: 'none', missingInputs: [] as LayerMissingInput[], archiveSha256: fixture.plan.archiveSha256,
    referenceSha256: await layerSha256(fixture.entries.get('reference.png')!), status: 'Draft',
    summary: 'Offline planning response double.', plan: { ...fixture.plan, basis: 'model-proposed', adaptations: [],
      layoutChecks: { version: '1.0', separations: [], unpairedText: [] } },
    findings: fixtureFindings(fixture.plan.document), issues: ['Fixture typography requires human review.'] };
  return { ...fixture, proposal };
}
/** Render test double; no pointer or live renderer is claimed by these offline tests. */
export function fixturePassedRender(document: UiDocument) {
  return { status: 'pass', code: 'LAYER_RENDER_PASS', interactions: { status: 'pass', scope: 'declared-effects-only',
    bindings: [], external: walkNodes(document).filter(node => node.type === 'Button' && node.props.interaction?.mode === 'external').map(node => node.id) } };
}
