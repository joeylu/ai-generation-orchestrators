export function layerOffset(center, reference, parallax, preview) {
  return preview ? { x: (center.x - reference.x) * (1 - parallax.x) || 0, y: (center.y - reference.y) * (1 - parallax.y) || 0 } : { x: 0, y: 0 };
}

export function repeatCoverage(node, visible, offset) {
  const x = visible.x - offset.x;
  return { x, width: visible.width, tileX: node.position.x - x };
}
