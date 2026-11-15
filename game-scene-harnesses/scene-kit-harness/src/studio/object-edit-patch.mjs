import { isDeepStrictEqual as equal } from 'node:util';

export const objectEditResponse = 'application/vnd.scene-kit.object-edit-v1+json';

// Both endpoints of the diff have passed the complete compiler. Keep the full
// response when anything besides existing object presentation has changed.
export function objectEditPatch(before, after) {
  const { instances: oldInstances, instanceTransforms: oldTransforms, instanceAppearances: oldAppearances, ...oldDocument } = before.document;
  const { instances, instanceTransforms, instanceAppearances, ...document } = after.document;
  const withoutPosition = ({ x, y, ...instance }) => instance;
  if (!equal(oldDocument, document) || !equal(oldInstances.map(withoutPosition), instances.map(withoutPosition))) return;

  const { layers: oldLayers, source: oldSource, contentSha256: baseContentSha256, ...oldScene } = before.scene;
  const { layers, source, contentSha256, ...scene } = after.scene;
  if (source.kitSha256 !== oldSource.kitSha256 || !equal(oldScene, scene) || layers.length !== oldLayers.length) return;

  const updates = [];
  for (const [index, { nodes, ...layer }] of layers.entries()) {
    const { nodes: oldNodes, ...oldLayer } = oldLayers[index];
    if (!equal(oldLayer, layer) || nodes.length !== oldNodes.length) return;
    for (const [i, node] of nodes.entries()) {
      const oldNode = oldNodes[i];
      if (equal(oldNode, node)) continue;
      if (!node.nodeId.startsWith('visual/') || !equal(spriteIdentity(oldNode), spriteIdentity(node))) return;
      updates.push(node);
    }
  }
  return { baseContentSha256, source, contentSha256, nodes: updates };
}

function spriteIdentity({ logicalAnchor, position, size, sourceToLogical, renderStyle, appearance, ...identity }) {
  return identity;
}
