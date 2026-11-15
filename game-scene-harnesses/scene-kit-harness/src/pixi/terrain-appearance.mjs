import { normalizeSignature } from '../topology.mjs';

// Fixed preview profile only. Source geometry remains in the compiled scene;
// camera, map extent and random seed do not participate in this appearance key.
export function terrainStudyTextureKey(node) {
  if (!Object.hasOwn(node, 'cell') && !Object.hasOwn(node, 'signature')) return null;
  const { cell, signature, position, size } = node;
  if (!cell || !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)
    || !Number.isInteger(signature) || signature < 0 || signature > 255 || normalizeSignature(signature) !== signature
    || node.kind !== 'sprite' || position?.x !== cell.x * 64 || position?.y !== cell.y * 64
    || size?.width !== 64 || size?.height !== 64
    || node.sourceToLogical?.numerator !== 1 || node.sourceToLogical?.denominator !== 1) {
    throw new Error('Terrain study requires the declared 64-unit identity geometry');
  }
  const phase = ((cell.y % 4 + 4) % 4) * 4 + ((cell.x % 4 + 4) % 4);
  return `p${phase}-blob-${String(signature).padStart(3, '0')}`;
}
