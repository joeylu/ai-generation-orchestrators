/** Explicit consumer operations over an immutable, authenticated source archive. */
import { walkNodes, type UiDocument } from './tree-contract.ts';
import type { LayerPackage } from './layer-package.ts';
import { isPortableLayerPlanningNote, type LayerPlanningEvidence } from './layer-planning-evidence.ts';

export const LAYER_ADAPTATION_POLICY_V1 = Object.freeze({ version: '1.0', sourceArchive: 'immutable',
  crop: 'Image.region', drawOrder: 'reference-correction', missingRasterParts: 'procedural-control',
  decisionEvidence: 'required', additionalImages: 'forbidden' } as const);
export type LayerAdaptation =
  | { kind: 'crop'; componentId: string; sourceLayerId: string; reason: string }
  | { kind: 'reorder' | 'procedural-control'; componentId: string; reason: string };

function fail(code = 'LAYER_PLAN_ADAPTATION_INVALID'): never { throw new Error(code); }
export function validateLayerAdaptations(input: unknown, document: UiDocument, pack: LayerPackage,
  evidence?: LayerPlanningEvidence): LayerAdaptation[] {
  if (!Array.isArray(input) || input.length > 1024) fail();
  const nodes = new Map(walkNodes(document).map(node => [node.id, node]));
  const layers = new Map(pack.composition.layers.map(layer => [layer.id, layer]));
  const seen = new Set<string>();
  const requirePolicy = (componentId: string, pointer: string) => {
    if (evidence && !evidence.findings.some(finding => finding.componentId === componentId
      && finding.pointer === pointer && finding.basis === 'explicit-policy')) fail('LAYER_PLAN_ADAPTATION_EVIDENCE');
  };
  const adaptations = input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    const row = value as Record<string, unknown>;
    if (!['crop', 'reorder', 'procedural-control'].includes(String(row.kind))
      || Object.keys(row).sort().join('|') !== (row.kind === 'crop' ? 'componentId|kind|reason|sourceLayerId' : 'componentId|kind|reason')
      || typeof row.componentId !== 'string' || !isPortableLayerPlanningNote(row.reason, 500)) fail();
    const node = nodes.get(row.componentId); if (!node) fail();
    const key = `${row.kind}:${node.id}`; if (seen.has(key)) fail(); seen.add(key);
    if (row.kind === 'crop') {
      const layer = typeof row.sourceLayerId === 'string' ? layers.get(row.sourceLayerId) : undefined;
      if (!layer || node.type !== 'Image' || !node.props.region || node.props.source !== layer.path) fail();
      const region = node.props.region;
      if (region.x + region.width > layer.width || region.y + region.height > layer.height) fail('LAYER_PLAN_CROP_BOUNDS');
      requirePolicy(node.id, '/props/region');
    } else if (row.kind === 'reorder') {
      if (!('children' in node) || node.children.length < 2) fail();
      requirePolicy(node.id, '/children');
    } else {
      if (['Container', 'Image', 'Text'].includes(node.type)
        || Object.hasOwn(node.props, 'appearance') || Object.hasOwn(node.props, 'backgroundImage')) fail();
      requirePolicy(node.id, '/props/style');
    }
    return { ...row } as unknown as LayerAdaptation;
  });
  for (const node of nodes.values()) if (node.type === 'Image' && node.props.region && !seen.has(`crop:${node.id}`)) {
    fail('LAYER_PLAN_CROP_UNDECLARED');
  }
  for (const node of nodes.values()) if (!['Container', 'Image', 'Text'].includes(node.type)
    && !Object.hasOwn(node.props, 'appearance') && !Object.hasOwn(node.props, 'backgroundImage')
    && !seen.has(`procedural-control:${node.id}`)) fail('LAYER_PLAN_PROCEDURAL_UNDECLARED');
  return adaptations;
}
