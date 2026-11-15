import { inspectPng } from './png.mjs';
import { createSceneSemantics } from './semantics.mjs';
import { measurePlatformSurface, TERRAIN_SKIN_PROFILE } from './terrain-skins.mjs';
import { check, clone, contract, hash, id, jsonBytes, seal } from './generation/common.mjs';

export const SUPPLEMENT_SCENE_ROLES = Object.freeze({ foliage: 'foreground-foliage', 'distant-ruins': 'distant-ruins',
  platform: 'floating-platform-shell', water: 'valley-water' });
const sizes = { foliage: [768, 256], 'distant-ruins': [1024, 384], platform: [384, 192], water: [768, 256] };
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function supplementSceneFiles(base, sources, studyId) {
  id(studyId); check(studyId.length <= 75, 'CANDIDATE_ID');
  const files = new Map([...base.files].map(([path, bytes]) => [path, Buffer.from(bytes)])); files.delete('proof-bundle.json');
  files.set('evidence/reference-screen-readiness.json', files.get('readiness.json'));
  files.set('evidence/reference-screen-bundle.json', jsonBytes(base.bundle));
  const old = JSON.parse(files.get('kit/kit.json')), read = ref => JSON.parse(files.get(`kit/${ref.path}`));
  const catalog = read(old.files.catalog), rules = read(old.files.rules), library = read(old.files.presets);
  const map = read(old.files.maps.default), inspection = read(old.files.maps.inspection);
  const kitRef = { kitId: studyId, revision: 'accepted-sources-study-v1' }, evidence = [], modules = {};
  const style = (numerator, denominator, tint = 0xffffff, opacity = 1) => ({ scale: { numerator, denominator }, tint, opacity });
  for (const [key, role] of Object.entries(SUPPLEMENT_SCENE_ROLES)) {
    const item = sources[key], { report, files: proofFiles, bundle } = item.prepared;
    check(item.status === 'accepted' && item.review?.receipt.targetSha256 === report.source.sha256 && report.target.role === role,
      'SUPPLEMENT_SOURCE_ACCEPTANCE_REQUIRED');
    const bytes = proofFiles.get('assets/environment.png'), p = inspectPng(bytes, { includePixels: true }), [width, height] = sizes[key];
    check(p.width === width && p.height === height && report.seam.status === 'not-required', 'SUPPLEMENT_SOURCE_GEOMETRY');
    let foot = -1;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (p.rgba[(y * p.width + x) * 4 + 3] >= 128) foot = y;
    check(foot >= 0, 'SUPPLEMENT_ANCHOR');
    const path = `assets/accepted-${key}.png`;
    files.set(`kit/${path}`, bytes);
    const module = { assetId: `accepted.${key}`, kind: 'environment', source: { path, sha256: hash(bytes), byteLength: bytes.length },
      pixelSize: { width, height }, footprint: { columns: Math.ceil(width / 64), rows: Math.ceil(height / 64) },
      anchorPx: { x: Math.round(width / 2), y: foot }, visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis: 'none' };
    if (key === 'platform') {
      const surface = measurePlatformSurface(p), divisor = gcd(192, surface.right - surface.left);
      module.terrainSkin = { profile: TERRAIN_SKIN_PROFILE, columns: 3, rows: 1, surfacePx: surface };
      module.footprint = { columns: 3, rows: 1 }; module.anchorPx = { x: surface.left, y: surface.y };
      module.renderStyle = style(192 / divisor, (surface.right - surface.left) / divisor, old.terrainAppearance.tint ?? 0xffffff);
      module.preferredLayerId = 'platform-skins';
    } else if (key === 'foliage') {
      module.anchorPx.x = Math.round(width * 0.55); module.renderStyle = style(7, 10); module.preferredLayerId = 'foreground-canopy';
    } else if (key === 'distant-ruins') {
      module.renderStyle = style(3, 8, 0xc4d9d3, 0.8); module.preferredLayerId = 'far-ruins';
    } else { module.renderStyle = style(2, 3, 0xcbe5e5, 0.95); module.preferredLayerId = 'valley-water'; }
    catalog.modules.push(module); modules[key] = module;
    files.set(`source/accepted-${key}-native.png`, proofFiles.get('source/original.png'));
    files.set(`evidence/accepted-${key}-assessment.json`, jsonBytes(item.plan));
    files.set(`evidence/accepted-${key}-derivation.json`, proofFiles.get('derivation.json'));
    files.set(`evidence/accepted-${key}-proof-bundle.json`, proofFiles.get('proof-bundle.json'));
    files.set(`evidence/accepted-${key}-source-review.json`, jsonBytes(item.review));
    if (item.approval) {
      files.set(`evidence/accepted-${key}-preparation-approval.json`, jsonBytes(item.approval));
      files.set(`evidence/accepted-${key}-original-plan.json`, jsonBytes(item.originalPlan));
      files.set(`source/accepted-${key}-before-padding.png`, item.original);
    }
    evidence.push({ key, role, sourcePlanSha256: item.plan.sha256, rawSha256: report.source.sha256,
      sourceArtAcceptance: 'accepted', sourceReviewSha256: item.review.sha256, proofBundleSha256: bundle.sha256,
      derivedSha256: hash(bytes), derivedArtAcceptance: 'not-assessed',
      ...(key === 'platform' ? { surfaceMeasurement: module.terrainSkin, scale: module.renderStyle.scale } : {}) });
  }
  const rightLeaf = { ...clone(modules.foliage), assetId: 'accepted.foliage.right', renderStyle: style(3, 5) }; catalog.modules.push(rightLeaf);
  const layer = (layerId, kind, zIndex, x) => ({ layerId, kind, zIndex, parallax: { x, y: 1 }, visible: true });
  map.layers = [layer('sky', 'background', 0, 0), layer('far-mountains', 'background', 1, 0.12), layer('distant-forest', 'background', 2, 0.2),
    layer('far-ruins', 'environment', 3, 0.35), layer('valley-water', 'environment', 4, 0.45), layer('middle-trees', 'environment', 5, 0.65),
    layer('near-ruins', 'environment', 6, 0.9), layer('terrain', 'terrain', 7, 1), layer('platform-skins', 'environment', 8, 1),
    layer('foreground-tree', 'environment', 9, 1.1), layer('foreground-canopy', 'environment', 10, 1.15)];
  map.instances = map.instances.filter(item => !['far.ruin.1', 'far.ruin.2', 'canopy.left', 'canopy.right'].includes(item.instanceId));
  const instance = (instanceId, module, x, y) => ({ instanceId, assetId: module.assetId, layerId: module.preferredLayerId, x, y });
  map.instances.push(instance('bridge.accepted', modules['distant-ruins'], 620, 412), instance('water.accepted', modules.water, 704, 586 - 12),
    instance('foliage.left.accepted', modules.foliage, 120, 584 - 12), instance('foliage.right.accepted', rightLeaf, 1000, 594 - 24));
  map.terrainRuns = map.terrainRuns.filter(run => !(run.x === 9 && run.y === 4 && run.length === 3));
  library.presets.push({ presetId: 'platform.vine.three', sizeCells: { width: 3, height: 1 },
    terrainRuns: [{ x: 0, y: 0, length: 3, familyId: rules.familyId }],
    instances: [{ instanceId: 'appearance', assetId: modules.platform.assetId, x: 0, y: 0 }], assemblies: [] });
  map.assemblyInstances.push({ instanceId: 'floating.platform', presetId: 'platform.vine.three', layerId: 'platform-skins', column: 9, row: 4 });
  map.mapId = `${studyId}.default`; catalog.format = 'ai_scene_module_catalog_v4';
  for (const doc of [catalog, rules, library, map, inspection]) doc.kitRef = kitRef;
  const documents = [[old.files.catalog.path, catalog], [old.files.rules.path, rules], [old.files.presets.path, library],
    [old.files.maps.default.path, map], [old.files.maps.inspection.path, inspection]];
  for (const [path, doc] of documents) files.set(`kit/${path}`, jsonBytes(doc));
  const ref = oldRef => ({ path: oldRef.path, sha256: hash(files.get(`kit/${oldRef.path}`)) });
  const kit = { ...clone(old), ...kitRef, format: 'ai_scene_kit_v4', files: { catalog: ref(old.files.catalog), rules: ref(old.files.rules),
    presets: ref(old.files.presets), maps: { default: ref(old.files.maps.default), inspection: ref(old.files.maps.inspection) } } };
  for (const doc of [kit, catalog, rules, library, map, inspection]) contract(doc);
  const model = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: kit.files.presets.path } });
  const analysis = model.analyzeMap(map, { role: 'default', allowEmpty: false }); model.analyzeMap(inspection, { role: 'inspection', allowEmpty: false });
  check(analysis.cells.size === 32 && analysis.terrainSkins.length === 1, 'SUPPLEMENT_LAYOUT');
  files.set('kit/kit.json', jsonBytes(kit));
  const report = seal({ format: 'ai_scene_supplement_composition_readiness_v1', studyId, parentReferenceBundleSha256: base.bundle.sha256,
    scope: 'single-screen-accepted-source-composition-study', sources: evidence, author: analysis.summary,
    terrainSkins: analysis.terrainSkins, sourceArtAcceptance: 'four-supplement-sources-accepted-other-source-decisions-unchanged',
    previousReadinessEvidence: 'evidence/reference-screen-readiness.json', viewport: { width: 1024, height: 576 },
    physicsAndWalkability: 'not-assessed', surfaceMeasurement: 'placement-baseline-only-not-collision-certification',
    waterExtraRocks: 'accepted-source-art', fullKitVisualAcceptance: 'not-assessed', derivedArtAcceptance: 'not-assessed', productionKit: false, generationCalls: 0 });
  files.set('readiness.json', jsonBytes(report));
  const bundle = seal({ format: 'ai_scene_supplement_composition_bundle_v1', studyId, parentReferenceBundleSha256: base.bundle.sha256,
    kitSha256: hash(files.get('kit/kit.json')), readinessSha256: report.sha256, productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
