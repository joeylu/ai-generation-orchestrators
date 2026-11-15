import { check, contract, digest, exact, id, isDigest, seal, text, unseal } from './generation/common.mjs';
import { validateBlueprintPolygon } from './reference-blueprint.mjs';
import { pointInReferencePolygon } from './reference-layout.mjs';

export const REFERENCE_STANDARDS = Object.freeze(['projection', 'layer-separation', 'frame-completeness', 'terrain-readability',
  'foreground-readability', 'style-consistency', 'decomposability']);
export function validateReferenceViewport(frame) {
  exact(frame, ['width', 'height']);
  check(Number.isInteger(frame.width) && frame.width >= 256 && frame.width <= 2048 && Number.isInteger(frame.height)
    && frame.height >= 144 && frame.height <= 1152 && frame.width > frame.height && frame.width * frame.height <= 2097152, 'REFERENCE_FRAME');
}
export function validateReferenceRequirements(value) {
  unseal(value); contract(value);
  const layers = new Set(), subjects = new Set();
  value.layers.forEach((layer, index) => {
    check(!layers.has(layer.layerId) && (!index || layer.zIndex > value.layers[index - 1].zIndex), 'REFERENCE_REQUIREMENT_LAYERS'); layers.add(layer.layerId);
  });
  for (const subject of value.subjects) {
    check(!subjects.has(subject.subjectId) && layers.has(subject.layerId) && subject.count.min <= subject.count.max, 'REFERENCE_REQUIREMENT_SUBJECT');
    subjects.add(subject.subjectId); text(subject.content, { limit: 1000 });
  }
  check(value.subjects.reduce((sum, subject) => sum + subject.count.max, 0) <= 24, 'REFERENCE_REQUIREMENT_COUNT');
  check(value.layers.every(l => value.subjects.some(s => s.layerId === l.layerId)), 'REFERENCE_REQUIREMENT_UNUSED_LAYER');
  check(new Set(value.standards.map(s => s.key)).size === REFERENCE_STANDARDS.length, 'REFERENCE_STANDARD_COVERAGE');
  value.compositionNotes.forEach(n => text(n, { limit: 1000 })); value.standards.forEach(s => text(s.requirement, { limit: 1000 }));
  return value;
}
function point(value, frame) {
  exact(value, ['x', 'y']);
  check([value.x, value.y].every(n => Number.isFinite(n) && Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001)
    && value.x >= 0 && value.x <= frame.width && value.y >= 0 && value.y <= frame.height, 'REFERENCE_MEASURED_POINT');
}
function unique(rows, key) {
  const ids = new Set(); for (const row of rows) { id(row[key]); check(!ids.has(row[key]), 'REFERENCE_MEASURED_DUPLICATE'); ids.add(row[key]); }
}
export function assessMeasuredReference(requirements, viewport, analysis) {
  validateReferenceRequirements(requirements); validateReferenceViewport(viewport);
  const a = unseal(analysis);
  exact(a, ['format', 'planSha256', 'rawSha256', 'coordinates', 'layers', 'instances', 'surfaces', 'quality']);
  check(a.format === 'ai_scene_measured_reference_layout_v1' && a.coordinates === 'canonical-reference-frame'
    && isDigest(a.planSha256) && isDigest(a.rawSha256), 'REFERENCE_MEASURED_FORMAT');
  check(Array.isArray(a.layers) && a.layers.length > 0 && a.layers.length <= requirements.layers.length, 'REFERENCE_MEASURED_LAYERS');
  unique(a.layers, 'layerId');
  a.layers.forEach((layer, index) => {
    const expected = requirements.layers.find(l => l.layerId === layer.layerId);
    check(expected && digest(expected) === digest(layer) && (!index || layer.zIndex > a.layers[index - 1].zIndex), 'REFERENCE_MEASURED_LAYERS');
  });
  check(Array.isArray(a.instances) && a.instances.length > 0 && a.instances.length <= 24, 'REFERENCE_MEASURED_INSTANCES');
  unique(a.instances, 'instanceId');
  for (const i of a.instances) {
    exact(i, ['instanceId', 'subjectId', 'layerId', 'visibleEnvelope', 'anchor', 'visibility', 'anchorEvidence', 'notes']);
    const subject = requirements.subjects.find(s => s.subjectId === i.subjectId);
    check(subject && subject.layerId === i.layerId && a.layers.some(l => l.layerId === i.layerId), 'REFERENCE_MEASURED_SUBJECT');
    validateBlueprintPolygon(i.visibleEnvelope, viewport); point(i.anchor, viewport); text(i.notes, { limit: 1000 });
    check(['visible', 'occluded', 'frame-clipped', 'occluded-and-frame-clipped'].includes(i.visibility)
      && ['observed', 'inferred'].includes(i.anchorEvidence) && (i.anchorEvidence !== 'inferred' || i.visibility !== 'visible'), 'REFERENCE_MEASURED_EVIDENCE');
    check(i.anchorEvidence !== 'observed' || pointInReferencePolygon(i.visibleEnvelope, i.anchor), 'REFERENCE_MEASURED_ANCHOR');
  }
  check(a.layers.every(l => a.instances.some(i => i.layerId === l.layerId)), 'REFERENCE_MEASURED_UNUSED_LAYER');
  check(Array.isArray(a.surfaces) && a.surfaces.length <= 48, 'REFERENCE_MEASURED_SURFACES'); unique(a.surfaces, 'surfaceId');
  for (const s of a.surfaces) {
    exact(s, ['surfaceId', 'instanceId', 'points', 'evidence', 'notes']);
    const instance = a.instances.find(i => i.instanceId === s.instanceId);
    check(instance && a.layers.find(l => l.layerId === instance.layerId)?.kind === 'terrain', 'REFERENCE_SURFACE_INSTANCE');
    check(Array.isArray(s.points) && s.points.length >= 2 && s.points.length <= 64, 'REFERENCE_SURFACE_POINTS');
    s.points.forEach(p => point(p, viewport));
    check(s.points.every((p, index) => !index || p.x >= s.points[index - 1].x)
      && s.points.at(-1).x > s.points[0].x, 'REFERENCE_SURFACE_ORDER');
    check(['observed', 'partly-inferred'].includes(s.evidence), 'REFERENCE_SURFACE_EVIDENCE'); text(s.notes, { limit: 1000 });
    check(s.evidence !== 'observed' || s.points.every(p => pointInReferencePolygon(instance.visibleEnvelope, p)), 'REFERENCE_SURFACE_EVIDENCE');
  }
  const missingSurfaces = a.instances.filter(i => a.layers.find(l => l.layerId === i.layerId).kind === 'terrain'
    && !a.surfaces.some(s => s.instanceId === i.instanceId)).map(i => i.instanceId);
  check(Array.isArray(a.quality) && a.quality.length === REFERENCE_STANDARDS.length, 'REFERENCE_QUALITY_COVERAGE'); unique(a.quality, 'key');
  for (const q of a.quality) {
    exact(q, ['key', 'verdict', 'notes']); check(REFERENCE_STANDARDS.includes(q.key) && ['pass', 'fail', 'uncertain'].includes(q.verdict), 'REFERENCE_QUALITY_VERDICT');
    text(q.notes, { limit: 1500 });
  }
  const counts = requirements.subjects.map(s => {
    const actual = a.instances.filter(i => i.subjectId === s.subjectId).length;
    return { subjectId: s.subjectId, minimum: s.count.min, maximum: s.count.max, actual, pass: actual >= s.count.min && actual <= s.count.max };
  });
  const ready = counts.every(c => c.pass) && missingSurfaces.length === 0 && a.quality.every(q => q.verdict === 'pass');
  return { status: ready ? 'requirements-reported-satisfied' : 'requires-correction-or-review', readyForHumanAcceptance: ready,
    counts, missingSurfaces, quality: a.quality, coordinates: 'measured-from-actual-image', comparisonToPregenerationGeometry: 'not-applicable',
    automaticSemanticDetection: false, pixelSegmentation: 'not-performed', hiddenGeometry: 'not-recovered', humanVisualAcceptance: 'not-assessed' };
}
export function measuredTargetCandidate(plan, result, analysis, assessment) {
  const requirements = plan.referenceRequirements;
  return seal({ format: 'ai_scene_measured_target_candidate_v1', status: 'unaccepted', mode: 'reference-led', planSha256: plan.sha256,
    rawSha256: result.rawSha256, requirementsSha256: requirements.sha256, analysisSha256: analysis.sha256, mapping: result.technical.mapping,
    layers: analysis.layers, instances: analysis.instances.map(i => ({ ...i, role: requirements.subjects.find(s => s.subjectId === i.subjectId).role })),
    surfaces: analysis.surfaces, assessmentReady: assessment.readyForHumanAcceptance, envelopeMeaning: 'operator-envelope-not-alpha-mask',
    hiddenGeometry: 'not-recovered', faithfulAssetReconstruction: 'not-implemented' });
}
