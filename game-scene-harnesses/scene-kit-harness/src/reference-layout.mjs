import { check, exact, hash, id, isDigest, seal, text, unseal } from './generation/common.mjs';
import { encodeRgbaPng } from './png.mjs';
import { raster } from './terrain-proof/raster.mjs';
import { validateReferenceBlueprint, referenceBlueprintGuide, assessReferenceObservation,
  validateBlueprintPolygon, polygonMask, polygonBounds, protectedCoverage } from './reference-blueprint.mjs';

const q = n => Math.round(n * 1000000) / 1000000;
const within = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
const center = polygon => { const b = polygonBounds(polygon); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
function contains(points, p) {
  let inside = false;
  for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
    const u = points[a], v = points[b], cross = (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
    if (Math.abs(cross) < 0.000001 && p.x >= Math.min(u.x, v.x) && p.x <= Math.max(u.x, v.x)
      && p.y >= Math.min(u.y, v.y) && p.y <= Math.max(u.y, v.y)) return true;
    if ((u.y > p.y) !== (v.y > p.y) && p.x < (v.x - u.x) * (p.y - u.y) / (v.y - u.y) + u.x) inside = !inside;
  }
  return inside;
}
function asLegacy(blueprint) {
  const b = unseal(blueprint);
  return seal({ ...b, format: 'ai_scene_reference_blueprint_v1', protectedRegions: [],
    instances: b.instances.map(instance => {
      const { constraint, ...base } = instance;
      return constraint.mode === 'hard' ? base : { ...base, polygon: constraint.region, anchor: center(constraint.region) };
    }) });
}
function count(mask) { let n = 0; for (const value of mask) n += value; return n; }
function dimensions(blueprint) {
  return { ...blueprint.viewport, pixels: blueprint.viewport.width * blueprint.viewport.height };
}
export function validateFlexibleBlueprint(value) {
  const b = unseal(value);
  check(b.format === 'ai_scene_reference_blueprint_v2' && Array.isArray(b.instances), 'FLEXIBLE_BLUEPRINT_FORMAT');
  // Reuse the frozen v1 geometry limits; v2 never changes the meaning of v1.
  for (const i of b.instances) {
    check(i?.constraint && ['hard', 'art-region'].includes(i.constraint.mode), 'INSTANCE_CONSTRAINT_MODE');
    if (i.constraint.mode === 'hard') exact(i, ['instanceId', 'layerId', 'role', 'content', 'polygon', 'anchor', 'constraint']);
    else exact(i, ['instanceId', 'layerId', 'role', 'content', 'constraint']);
  }
  validateReferenceBlueprint(asLegacy(value));
  const frame = dimensions(b);
  for (const i of b.instances) {
    const c = i.constraint;
    if (c.mode === 'hard') exact(c, ['mode']);
    else {
      exact(c, ['mode', 'region', 'anchorRegion', 'minOccupancyPermille', 'maxOccupancyPermille', 'maxOutsidePermille', 'shapeIntent']);
      validateBlueprintPolygon(c.region, frame); validateBlueprintPolygon(c.anchorRegion, frame); text(c.shapeIntent, { limit: 1000 });
      check(Number.isInteger(c.minOccupancyPermille) && c.minOccupancyPermille >= 1
        && Number.isInteger(c.maxOccupancyPermille) && c.maxOccupancyPermille <= 1000
        && c.minOccupancyPermille <= c.maxOccupancyPermille && Number.isInteger(c.maxOutsidePermille)
        && c.maxOutsidePermille >= 0 && c.maxOutsidePermille <= 50, 'ART_REGION_OCCUPANCY');
      const region = polygonMask(c.region, frame), anchors = polygonMask(c.anchorRegion, frame);
      check(!anchors.some((pixel, p) => pixel && !region[p]), 'ART_ANCHOR_REGION');
    }
  }
  check(Array.isArray(b.protectedRegions) && b.protectedRegions.length <= 16, 'BLUEPRINT_REGIONS');
  const regionIds = new Set();
  for (const region of b.protectedRegions) {
    exact(region, ['regionId', 'purpose', 'polygon', 'forbiddenInstanceIds', 'maxOccludedPermille']); id(region.regionId);
    check(!regionIds.has(region.regionId), 'BLUEPRINT_DUPLICATE'); regionIds.add(region.regionId);
    text(region.purpose, { limit: 500 }); validateBlueprintPolygon(region.polygon, frame);
    check(Array.isArray(region.forbiddenInstanceIds) && region.forbiddenInstanceIds.length > 0
      && new Set(region.forbiddenInstanceIds).size === region.forbiddenInstanceIds.length
      && region.forbiddenInstanceIds.every(instanceId => b.instances.some(i => i.instanceId === instanceId)), 'BLUEPRINT_REGION_REFERENCE');
    check(Number.isInteger(region.maxOccludedPermille) && within(region.maxOccludedPermille, 0, 1000), 'BLUEPRINT_REGION_LIMIT');
  }
  const hardIds = new Set(b.instances.filter(i => i.constraint.mode === 'hard').map(i => i.instanceId));
  const hardRegions = b.protectedRegions.map(r => ({ ...r, forbiddenInstanceIds: r.forbiddenInstanceIds.filter(id => hardIds.has(id)) }))
    .filter(r => r.forbiddenInstanceIds.length);
  check(protectedCoverage(hardRegions, b.instances, frame).every(r => r.pass), 'BLUEPRINT_PROTECTED_OVERLAP');
  // A soft placement region may overlap a protected opening. Its actual art must
  // leave that opening free. Reject designs with no capacity even for min art.
  for (const i of b.instances.filter(i => i.constraint.mode === 'art-region')) {
    const mask = polygonMask(i.constraint.region, frame), area = count(mask), available = Buffer.from(mask);
    for (const r of b.protectedRegions.filter(r => !r.maxOccludedPermille && r.forbiddenInstanceIds.includes(i.instanceId))) {
      const blocked = polygonMask(r.polygon, frame); for (let p = 0; p < mask.length; p++) if (blocked[p]) available[p] = 0;
    }
    check(count(available) * 1000 >= area * i.constraint.minOccupancyPermille, 'ART_REGION_NO_CAPACITY');
  }
  return value;
}
export const validateReferenceLayout = value => value?.format === 'ai_scene_reference_blueprint_v2'
  ? validateFlexibleBlueprint(value) : validateReferenceBlueprint(value);
export function flexibleBlueprintGuide(blueprint) {
  validateFlexibleBlueprint(blueprint);
  const image = raster(blueprint.viewport.width, blueprint.viewport.height);
  for (let p = 0; p < image.rgba.length; p += 4) image.rgba.set([250, 250, 250, 255], p);
  // Hard structures are filled; art regions are only dashed boxes/envelopes.
  // The guide never pretends to have selected the castle/mountain/foliage shape.
  const paint = (x, y, gray) => {
    if (x >= 0 && y >= 0 && x < image.width && y < image.height) image.rgba.set([gray, gray, gray, 255], (y * image.width + x) * 4);
  };
  for (const layer of blueprint.layers) for (const i of blueprint.instances.filter(i => i.layerId === layer.layerId)) {
    const gray = Math.round(210 - 160 * blueprint.layers.indexOf(layer) / Math.max(1, blueprint.layers.length - 1));
    if (i.constraint.mode === 'hard') {
      const mask = polygonMask(i.polygon, blueprint.viewport);
      for (let p = 0; p < mask.length; p++) if (mask[p]) image.rgba.set([gray, gray, gray, 255], p * 4);
    }
  }
  for (const i of blueprint.instances.filter(i => i.constraint.mode === 'art-region')) {
    const points = i.constraint.region;
    for (let j = 0; j < points.length; j++) {
      const a = points[j], b = points[(j + 1) % points.length], steps = Math.ceil(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
      for (let k = 0; k <= steps; k++) if (Math.floor(k / 8) % 2 === 0) {
        const x = Math.round(a.x + (b.x - a.x) * k / Math.max(1, steps)), y = Math.round(a.y + (b.y - a.y) * k / Math.max(1, steps));
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) paint(x + dx, y + dy, 145);
      }
    }
  }
  const bytes = encodeRgbaPng(image.width, image.height, image.rgba);
  return { bytes, artifact: { sha256: hash(bytes), byteLength: bytes.length, pixelSize: blueprint.viewport } };
}
export const referenceLayoutGuide = value => value?.format === 'ai_scene_reference_blueprint_v2'
  ? flexibleBlueprintGuide(value) : referenceBlueprintGuide(value);
export function assessFlexibleObservation(blueprint, observation) {
  validateFlexibleBlueprint(blueprint);
  const o = unseal(observation), frame = dimensions(blueprint);
  exact(o, ['format', 'planSha256', 'rawSha256', 'coordinates', 'instances']);
  check(o.format === 'ai_scene_reference_observation_v1' && o.coordinates === 'canonical-reference-frame'
    && isDigest(o.planSha256) && isDigest(o.rawSha256), 'REFERENCE_OBSERVATION');
  check(Array.isArray(o.instances) && o.instances.length === blueprint.instances.length, 'REFERENCE_OBSERVATION_COVERAGE');
  const ids = new Set();
  for (const i of o.instances) {
    exact(i, ['instanceId', 'polygon', 'anchor']); id(i.instanceId);
    check(!ids.has(i.instanceId), 'BLUEPRINT_DUPLICATE'); ids.add(i.instanceId);
    check(blueprint.instances.some(row => row.instanceId === i.instanceId), 'REFERENCE_OBSERVATION_COVERAGE');
    validateBlueprintPolygon(i.polygon, frame); exact(i.anchor, ['x', 'y']);
    check(within(i.anchor.x, 0, frame.width) && within(i.anchor.y, 0, frame.height)
      && [i.anchor.x, i.anchor.y].every(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001), 'BLUEPRINT_NUMBER');
  }
  const instances = blueprint.instances.map(expected => {
    const actual = o.instances.find(i => i.instanceId === expected.instanceId), a = polygonMask(actual.polygon, frame);
    if (expected.constraint.mode === 'hard') {
      const b = polygonMask(expected.polygon, frame); let intersection = 0, union = 0;
      for (let p = 0; p < a.length; p++) { if (a[p] && b[p]) intersection++; if (a[p] || b[p]) union++; }
      const iou = intersection * 1000 / union, error = Math.hypot(actual.anchor.x - expected.anchor.x, actual.anchor.y - expected.anchor.y);
      return { instanceId: expected.instanceId, mode: 'hard', envelopeIoUPermille: q(iou), anchorErrorPx: q(error),
        pass: iou >= blueprint.tolerances.minEnvelopeIoUPermille && error <= blueprint.tolerances.maxAnchorErrorPx };
    }
    const c = expected.constraint, region = polygonMask(c.region, frame);
    let inside = 0, outside = 0; for (let p = 0; p < a.length; p++) if (a[p]) { if (region[p]) inside++; else outside++; }
    const area = count(region), occupancy = inside * 1000 / area, outsideRatio = outside * 1000 / (inside + outside);
    const anchorInside = contains(c.anchorRegion, actual.anchor) && contains(c.region, actual.anchor);
    return { instanceId: expected.instanceId, mode: 'art-region', occupancyPermille: q(occupancy), outsidePermille: q(outsideRatio), anchorInside,
      silhouetteComparedToPlaceholder: false,
      pass: inside * 1000 >= area * c.minOccupancyPermille && inside * 1000 <= area * c.maxOccupancyPermille
        && outside * 1000 <= (inside + outside) * c.maxOutsidePermille && anchorInside };
  });
  const protectedRegions = protectedCoverage(blueprint.protectedRegions, o.instances, frame);
  return { status: instances.every(i => i.pass) && protectedRegions.every(r => r.pass) ? 'pass' : 'layout-deviation', instances, protectedRegions,
    evidence: 'operator-annotated-hard-geometry-and-soft-placement-not-automatic-segmentation', humanVisualAcceptance: 'not-assessed' };
}
export const assessReferenceLayout = (blueprint, observation) => blueprint?.format === 'ai_scene_reference_blueprint_v2'
  ? assessFlexibleObservation(blueprint, observation) : assessReferenceObservation(blueprint, observation);
export { contains as pointInReferencePolygon };
