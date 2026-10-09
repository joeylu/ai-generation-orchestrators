/** Shared deterministic recipes. No package I/O or workflow imports. */
import { parseUnityTextureMeta } from '../texture-semantics.mjs';
import { renderIconSvg } from '../redesign-icons.mjs';
import { renderPrimitiveSvg } from '../redesign-primitives.mjs';

export const REDESIGN_STYLE = Object.freeze({ id: 'modern-mint', version: '0.1.0',
  geometry: 'rounded-geometric', iconGrid: 24, iconStroke: 2, tintableInk: '#FFFFFF',
  background: '#111622', surface: '#1B2332', accent: '#71DBC3',
  workflow: 'new-vector-authoring-and-deterministic-rasterization' });

export function redesignUnityMetadata(source, border, image) {
  const ppu = source.pixelsPerUnit > 0 ? source.pixelsPerUnit : 100;
  const pivot = source.pivot ?? { x: 0.5, y: 0.5 };
  const b = border ?? { left: 0, bottom: 0, right: 0, top: 0 };
  return parseUnityTextureMeta(`TextureImporter:\n  spriteMode: 1\n  spritePixelsToUnits: ${ppu}\n  spritePivot: {x: ${pivot.x}, y: ${pivot.y}}\n  spriteBorder: {x: ${b.left}, y: ${b.bottom}, z: ${b.right}, w: ${b.top}}\n  alphaIsTransparency: 1\n`, image);
}

export function describeTextureRedesign(original) {
  const { width, height } = original.image, category = original.classification.category;
  if (category === 'icon') return { svg: renderIconSvg(original.source.relativePath, { width, height, color: REDESIGN_STYLE.tintableInk }), border: null, notes: [] };
  return renderPrimitiveSvg(original.source.relativePath, { width, height, color: REDESIGN_STYLE.tintableInk,
    border: original.unity.nineSlice === 'valid' ? original.unity.border : null });
}
