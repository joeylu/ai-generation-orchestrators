import { check, exact, id, text, unseal, hash, isDigest } from './generation/common.mjs';
import { encodeRgbaPng } from './png.mjs';
import { raster } from './terrain-proof/raster.mjs';

const kinds = ['background', 'environment', 'terrain', 'foreground', 'atmosphere'];
const q = n => Math.round(n * 1000000) / 1000000;
function number(n, min, max) {
  check(Number.isFinite(n) && n >= min && n <= max && Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001, 'BLUEPRINT_NUMBER');
}
function point(p, frame) {
  exact(p, ['x', 'y']); number(p.x, 0, frame.width); number(p.y, 0, frame.height);
}
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const on = (a, b, p) => Math.abs(cross(a, b, p)) < 0.000001 && p.x >= Math.min(a.x, b.x)
  && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
function intersects(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
    || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
export function polygonBounds(points) {
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
}
function polygon(points, frame) {
  check(Array.isArray(points) && points.length >= 3 && points.length <= 64, 'BLUEPRINT_POLYGON');
  points.forEach(p => point(p, frame)); let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    check(a.x !== b.x || a.y !== b.y, 'BLUEPRINT_POLYGON'); area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || i === 0 && j === points.length - 1) continue;
      check(!intersects(a, b, points[j], points[(j + 1) % points.length]), 'BLUEPRINT_SELF_INTERSECTION');
    }
  }
  check(Math.abs(area) >= 2, 'BLUEPRINT_POLYGON');
  check(polygonMask(points, frame).includes(1), 'BLUEPRINT_EMPTY_ENVELOPE');
}
function unique(rows, field) {
  const seen = new Set(); for (const row of rows) { id(row[field]); check(!seen.has(row[field]), 'BLUEPRINT_DUPLICATE'); seen.add(row[field]); }
}
function inside(points, x, y) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
export function polygonMask(points, frame) {
  const result = Buffer.alloc(frame.width * frame.height), box = polygonBounds(points);
  for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(frame.height, Math.ceil(box.y + box.height)); y++)
    for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(frame.width, Math.ceil(box.x + box.width)); x++)
      if (inside(points, x + 0.5, y + 0.5)) result[y * frame.width + x] = 1;
  return result;
}
export function protectedCoverage(regions, instances, frame) {
  const masks = new Map();
  return regions.map(region => {
    const mask = polygonMask(region.polygon, frame), forbidden = region.forbiddenInstanceIds.map(instanceId => {
      if (!masks.has(instanceId)) masks.set(instanceId, polygonMask(instances.find(i => i.instanceId === instanceId).polygon, frame));
      return masks.get(instanceId);
    });
    let area = 0, covered = 0;
    for (let p = 0; p < mask.length; p++) if (mask[p]) { area++; if (forbidden.some(other => other[p])) covered++; }
    check(area > 0, 'BLUEPRINT_EMPTY_REGION');
    return { regionId: region.regionId, areaPixels: area, coveredPixels: covered,
      coveredPermille: q(covered * 1000 / area), maximumPermille: region.maxOccludedPermille,
      pass: covered * 1000 <= area * region.maxOccludedPermille };
  });
}
export function validateReferenceBlueprint(value) {
  const body = unseal(value);
  exact(body, ['format', 'blueprintId', 'sceneDescription', 'projection', 'viewport', 'layers', 'instances', 'protectedRegions', 'tolerances']);
  check(body.format === 'ai_scene_reference_blueprint_v1' && body.projection === 'pure-sideview', 'BLUEPRINT_FORMAT');
  id(body.blueprintId); text(body.sceneDescription, { limit: 2000 });
  exact(body.viewport, ['width', 'height']);
  const { width, height } = body.viewport;
  check(Number.isInteger(width) && Number.isInteger(height) && width >= 256 && width <= 2048 && height >= 144
    && height <= 1152 && width > height && width * height <= 2097152, 'BLUEPRINT_FRAME');
  check(Array.isArray(body.layers) && body.layers.length > 0 && body.layers.length <= 16, 'BLUEPRINT_LAYERS');
  unique(body.layers, 'layerId');
  body.layers.forEach((layer, index) => {
    exact(layer, ['layerId', 'kind', 'zIndex', 'parallaxX']);
    check(kinds.includes(layer.kind) && Number.isInteger(layer.zIndex) && layer.zIndex >= 0
      && layer.zIndex <= 100 && (!index || layer.zIndex > body.layers[index - 1].zIndex), 'BLUEPRINT_LAYERS');
    number(layer.parallaxX, 0, 2);
  });
  check(Array.isArray(body.instances) && body.instances.length > 0 && body.instances.length <= 24, 'BLUEPRINT_INSTANCES');
  unique(body.instances, 'instanceId');
  for (const instance of body.instances) {
    exact(instance, ['instanceId', 'layerId', 'role', 'content', 'polygon', 'anchor']); id(instance.role); text(instance.content, { limit: 1500 });
    check(body.layers.some(layer => layer.layerId === instance.layerId), 'BLUEPRINT_LAYER_REFERENCE');
    polygon(instance.polygon, body.viewport); point(instance.anchor, body.viewport);
  }
  check(body.layers.every(layer => body.instances.some(instance => instance.layerId === layer.layerId)), 'BLUEPRINT_UNUSED_LAYER');
  check(Array.isArray(body.protectedRegions) && body.protectedRegions.length <= 16, 'BLUEPRINT_REGIONS');
  unique(body.protectedRegions, 'regionId');
  for (const region of body.protectedRegions) {
    exact(region, ['regionId', 'purpose', 'polygon', 'forbiddenInstanceIds', 'maxOccludedPermille']);
    text(region.purpose, { limit: 500 }); polygon(region.polygon, body.viewport);
    check(Array.isArray(region.forbiddenInstanceIds) && region.forbiddenInstanceIds.length > 0
      && region.forbiddenInstanceIds.length <= body.instances.length && new Set(region.forbiddenInstanceIds).size === region.forbiddenInstanceIds.length
      && region.forbiddenInstanceIds.every(instanceId => body.instances.some(i => i.instanceId === instanceId)), 'BLUEPRINT_REGION_REFERENCE');
    check(Number.isInteger(region.maxOccludedPermille) && region.maxOccludedPermille >= 0 && region.maxOccludedPermille <= 1000, 'BLUEPRINT_REGION_LIMIT');
  }
  exact(body.tolerances, ['maxAnchorErrorPx', 'minEnvelopeIoUPermille', 'maxAspectErrorPermille']);
  number(body.tolerances.maxAnchorErrorPx, 0, 64);
  check(Number.isInteger(body.tolerances.minEnvelopeIoUPermille) && body.tolerances.minEnvelopeIoUPermille >= 0
    && body.tolerances.minEnvelopeIoUPermille <= 1000 && Number.isInteger(body.tolerances.maxAspectErrorPermille)
    && body.tolerances.maxAspectErrorPermille >= 0 && body.tolerances.maxAspectErrorPermille <= 20, 'BLUEPRINT_TOLERANCE');
  check(protectedCoverage(body.protectedRegions, body.instances, body.viewport).every(region => region.pass), 'BLUEPRINT_PROTECTED_OVERLAP');
  return value;
}
export function referenceBlueprintGuide(blueprint) {
  validateReferenceBlueprint(blueprint);
  const image = raster(blueprint.viewport.width, blueprint.viewport.height);
  for (let p = 0; p < image.rgba.length; p += 4) image.rgba.set([250, 250, 250, 255], p);
  for (const layer of blueprint.layers) for (const instance of blueprint.instances.filter(i => i.layerId === layer.layerId)) {
    const gray = Math.round(238 - 196 * blueprint.layers.indexOf(layer) / Math.max(1, blueprint.layers.length - 1));
    const mask = polygonMask(instance.polygon, blueprint.viewport), color = [gray, gray, gray];
    for (let p = 0; p < mask.length; p++) if (mask[p]) image.rgba.set([...color, 255], p * 4);
  }
  const bytes = encodeRgbaPng(image.width, image.height, image.rgba);
  return { bytes, artifact: { sha256: hash(bytes), byteLength: bytes.length, pixelSize: { width: image.width, height: image.height } } };
}
export function assessReferenceObservation(blueprint, observation) {
  validateReferenceBlueprint(blueprint);
  const body = unseal(observation); exact(body, ['format', 'planSha256', 'rawSha256', 'coordinates', 'instances']);
  check(body.format === 'ai_scene_reference_observation_v1' && body.coordinates === 'canonical-reference-frame'
    && isDigest(body.planSha256) && isDigest(body.rawSha256), 'REFERENCE_OBSERVATION');
  check(Array.isArray(body.instances) && body.instances.length === blueprint.instances.length, 'REFERENCE_OBSERVATION_COVERAGE');
  unique(body.instances, 'instanceId');
  for (const instance of body.instances) {
    exact(instance, ['instanceId', 'polygon', 'anchor']);
    check(blueprint.instances.some(i => i.instanceId === instance.instanceId), 'REFERENCE_OBSERVATION_COVERAGE');
    polygon(instance.polygon, blueprint.viewport); point(instance.anchor, blueprint.viewport);
  }
  const instances = blueprint.instances.map(expected => {
    const actual = body.instances.find(i => i.instanceId === expected.instanceId);
    const a = polygonMask(expected.polygon, blueprint.viewport), b = polygonMask(actual.polygon, blueprint.viewport);
    let intersection = 0, union = 0;
    for (let p = 0; p < a.length; p++) { if (a[p] && b[p]) intersection++; if (a[p] || b[p]) union++; }
    const error = Math.hypot(actual.anchor.x - expected.anchor.x, actual.anchor.y - expected.anchor.y);
    const iou = union ? intersection * 1000 / union : 0;
    return { instanceId: expected.instanceId, expectedBounds: polygonBounds(expected.polygon), actualBounds: polygonBounds(actual.polygon),
      anchorErrorPx: q(error), envelopeIoUPermille: q(iou),
      pass: error <= blueprint.tolerances.maxAnchorErrorPx && iou >= blueprint.tolerances.minEnvelopeIoUPermille };
  });
  const protectedRegions = protectedCoverage(blueprint.protectedRegions, body.instances, blueprint.viewport);
  return { status: instances.every(i => i.pass) && protectedRegions.every(r => r.pass) ? 'pass' : 'layout-deviation',
    instances, protectedRegions, evidence: 'operator-annotated-layout-envelopes-not-automatic-pixel-segmentation',
    humanVisualAcceptance: 'not-assessed' };
}
export function paintReferenceEnvelopes(image, instances, color) {
  const { width, height } = image;
  const pixel = (x, y) => { if (x >= 0 && x < width && y >= 0 && y < height) image.rgba.set([...color, 255], (y * width + x) * 4); };
  for (const instance of instances) for (let i = 0; i < instance.polygon.length; i++) {
    const a = instance.polygon[i], b = instance.polygon[(i + 1) % instance.polygon.length];
    const steps = Math.ceil(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
    for (let k = 0; k <= steps; k++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      pixel(Math.round(a.x + (b.x - a.x) * k / Math.max(1, steps)) + dx, Math.round(a.y + (b.y - a.y) * k / Math.max(1, steps)) + dy);
  }
}
export { polygon as validateBlueprintPolygon };
