export const DEFAULT_APPEARANCE = Object.freeze({
  opacity: 100, brightness: 0, contrast: 0, saturation: 0, fog: 0, fogColor: 0xb6d8ed,
});

export function supportsInstanceAppearance(module) {
  return !!module && !module.terrainSkin && ['environment', 'background'].includes(module.kind);
}

export function isDefaultAppearance(appearance) {
  return Object.entries(DEFAULT_APPEARANCE).every(([key, value]) => appearance[key] === value);
}

export function instanceOpacity(node, appearance = node.appearance) {
  return (node.renderStyle?.opacity ?? 1) * ((appearance?.opacity ?? 100) / 100);
}

// Three affine RGB rows in normalized sRGB. Keep Alpha independent so haze
// can soften masonry without making the scenery behind it show through.
export function appearanceMatrix(appearance) {
  if (!appearance || ![appearance.brightness, appearance.contrast, appearance.saturation, appearance.fog].some(Boolean)) return null;
  const saturation = 1 + appearance.saturation / 100, contrast = 1 + appearance.contrast / 100;
  const fog = appearance.fog / 100, color = [appearance.fogColor >> 16 & 255, appearance.fogColor >> 8 & 255, appearance.fogColor & 255];
  const luma = [0.2126, 0.7152, 0.0722];
  const offset = (0.5 * (1 - contrast) + appearance.brightness / 100) * (1 - fog);
  return color.map((channel, row) => [
    ...luma.map((weight, col) => (weight * (1 - saturation) + (row === col ? saturation : 0)) * contrast * (1 - fog)),
    offset + fog * channel / 255,
  ]);
}
