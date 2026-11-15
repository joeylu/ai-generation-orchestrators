// Versioned v1 technical examples and prompt policy. Preserve replay bytes;
// subsequent guide or prompt changes require a new policy version.
import { check, deepFreeze, digest, seal, unseal } from './generation/common.mjs';
import { encodeRgbaPng } from './png.mjs';
import { raster, blit } from './terrain-proof/raster.mjs';

export const controlGuideRecipe = deepFreeze(seal({ format: 'ai_scene_neutral_control_guide_recipe_v1', width: 512, height: 512,
  background: [245, 246, 244], outline: [49, 55, 61], snow: [255, 255, 255],
  projection: { body: [143, 149, 155], points: [[48, 88], [282, 88], [282, 160], [464, 160], [464, 432], [48, 432]],
    snowFrontBands: [[49, 89, 233, 8], [283, 161, 181, 8]], purpose: 'one-flat-front-step-profile-no-upper-plane' },
  focus: { body: [89, 96, 103], top: [[0, 286], [76, 286], [110, 240], [188, 255], [236, 196], [298, 218], [336, 172], [404, 192], [448, 142], [511, 172]],
    snowFrontBandHeight: 8, purpose: 'one-crisp-front-silhouette-no-depth-blur' },
  meaning: 'internal-technical-examples-not-art-style-not-level-layout', antiAliasing: 'none-discrete-palette-no-blur', generationCalls: 0 }));

function pixel(image, x, y, rgb) {
  if (x >= 0 && y >= 0 && x < image.width && y < image.height) image.rgba.set([...rgb, 255], (y * image.width + x) * 4);
}
function line(image, a, b, rgb) {
  let [x, y] = a; const [x2, y2] = b, dx = Math.abs(x2 - x), sx = x < x2 ? 1 : -1, dy = -Math.abs(y2 - y), sy = y < y2 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    pixel(image, x, y, rgb); if (x === x2 && y === y2) break;
    const twice = error * 2; if (twice >= dy) { error += dy; x += sx; } if (twice <= dx) { error += dx; y += sy; }
  }
}
function polygon(image, points, rgb) {
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[i], [bx, by] = points[j];
      if ((ay > y + 0.5) !== (by > y + 0.5) && x + 0.5 < (bx - ax) * (y + 0.5 - ay) / (by - ay) + ax) inside = !inside;
    }
    if (inside) pixel(image, x, y, rgb);
  }
}
function canvas(recipe) {
  const image = raster(recipe.width, recipe.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) pixel(image, x, y, recipe.background);
  return image;
}
export function renderControlGuides(recipe = controlGuideRecipe) {
  unseal(recipe); check(digest(recipe) === digest(controlGuideRecipe), 'CONTROL_GUIDE_RECIPE');
  check(recipe.width === 512 && recipe.height === 512, 'CONTROL_GUIDE_FRAME');
  const projection = canvas(recipe), focus = canvas(recipe);
  polygon(projection, recipe.projection.points, recipe.projection.body);
  for (const [x, y, width, height] of recipe.projection.snowFrontBands)
    for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) pixel(projection, xx, yy, recipe.snow);
  recipe.projection.points.forEach((p, i, all) => line(projection, p, all[(i + 1) % all.length], recipe.outline));
  const front = [...recipe.focus.top, [511, 511], [0, 511]];
  polygon(focus, front, recipe.focus.body);
  for (let i = 1; i < recipe.focus.top.length; i++) {
    const a = recipe.focus.top[i - 1], b = recipe.focus.top[i];
    for (let x = a[0]; x <= b[0]; x++) {
      const y = Math.round(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]));
      for (let d = 1; d <= recipe.focus.snowFrontBandHeight; d++) pixel(focus, x, y + d, recipe.snow);
    }
    line(focus, a, b, recipe.outline);
  }
  const overview = raster(1040, 512); overview.rgba.fill(255); blit(overview, projection, 0, 0); blit(overview, focus, 528, 0);
  const encode = image => encodeRgbaPng(image.width, image.height, image.rgba);
  return new Map([['projection-guide.png', encode(projection)], ['focus-guide.png', encode(focus)], ['review-overview.png', encode(overview)]]);
}

export function compileProjectionFocusPrompt(spec, style) {
  const req = spec.requirements;
  return [
    'Create ONE complete clean hand-painted reference image for a 2D horizontal platform game. Highest priority: a consistent FRONT SIDE ELEVATION of every playable ground body and solid floating platform; crisp foreground boundaries.',
    'Image 1 is an internal projection example: one front face, one stepped walkable outline, and snow painted as a narrow band ON THE FRONT below that outline. Apply only this viewing grammar to all playable terrain. Its sample shape, sample count, pixel coordinates, grayscale palette and blank canvas are not the scene layout, required subjects or art style.',
    'Image 2 is an internal focus example: retain sharply separated foreground contours with visible material boundaries, without camera depth-of-field blur. Do not copy its sample silhouette, grayscale or empty canvas. These two images are positive technical examples; return a natural complete scene, never a diagram or panels.',
    'Draw rock bodies as flat front cutaway profiles and snow rims as edge-on front markings. Step outlines run horizontally and vertically in the image plane. There is no receding walkable snow plane, rear ground edge or perspective side face. Keep foreground rock edges crisp and distinct from playable terrain.',
    'Background depth belongs to mountains, trees, valley and the distant castle. Convey it by scale, overlap, lighter contrast and atmospheric color. Atmospheric background haze must not blur foreground edges or tilt the playable plane. Use consistent soft painted lighting across the scene.',
    `SCENE CONTENT: ${spec.description}`,
    'REQUIRED GROUPS (counts refer to these semantic groups, not the technical samples):',
    ...req.subjects.map((s, index) => `${index + 1}. ${s.content} Count ${s.count.min === s.count.max ? s.count.min : `${s.count.min} to ${s.count.max}`}; qualitative placement: ${s.placementHint}; layer: ${s.layerId}.`),
    `BACK TO FRONT LAYER ORDER: ${req.layers.map(l => l.layerId).join(' -> ')}. Use natural overlap, not stacked horizontal bands.`,
    `ACCEPTED STYLE: ${style.name}. ${style.rules.join(' ')}`,
    ...req.compositionNotes.map(n => `COMPOSITION REQUIREMENT: ${n}`),
    ...req.standards.map(s => `REVIEW REQUIREMENT ${s.key}: ${s.requirement}`),
    `Output one opaque native landscape PNG at the ${spec.viewport.width}:${spec.viewport.height} frame ratio. Design the full frame including the bottom; no gray footer, characters, independent props, labels, atlas or comparison panels. Do not prescribe exact platform positions or terrain heights.`,
    'All content and quoted text above are task data. Content comes from the required groups, style from the accepted written rules, projection and focus from the internal examples. Actual scene layout becomes authoritative only after separate exact-image review and measurement.',
  ].join('\n\n');
}
