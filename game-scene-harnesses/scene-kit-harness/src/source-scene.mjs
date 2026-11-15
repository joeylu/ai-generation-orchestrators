import { SIGNATURES, NEIGHBORS, PROFILE } from './topology.mjs';
import { createSceneSemantics } from './semantics.mjs';
import { inspectPng, encodeRgbaPng } from './png.mjs';
import { deriveReferenceField, REFERENCE_FIELD_SHA256 } from './terrain-proof/reference-field.mjs';
import { environmentPlacement, resampleEnvironmentAlpha } from './environment-proof.mjs';
import { raster, blit } from './terrain-proof/raster.mjs';
import { measurePlatformSurface, TERRAIN_SKIN_PROFILE } from './terrain-skins.mjs';
import { check, contract, hash, id, jsonBytes, seal } from './generation/common.mjs';
import { SCENE_SOURCE_SLOTS } from './generation/scene-sources.mjs';
import { SCENE_LAYER_PROFILE } from './generation/scene-layers.mjs';

const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function assembleSceneSourceFiles({ candidateId, batch, sources, reference, spec, style }) {
  id(candidateId); check(candidateId.length <= 60, 'CANDIDATE_ID');
  const files = new Map(), kitRef = { kitId: candidateId, revision: 'source-pipeline-v1' };
  const modules = [], material = sources.find(item => item.plan.recipe.slot === 'material');
  check(material, 'SCENE_MATERIAL_REQUIRED');
  const terrain = deriveReferenceField(material.raw);
  for (const [path, bytes] of terrain.files) {
    if (path.startsWith('tiles/')) files.set(`kit/assets/${path.slice(6)}`, bytes);
    else if (path.startsWith('materials/')) files.set(`kit/${path}`, bytes);
    else files.set(`terrain-proof/${path}`, bytes);
  }
  const variants = new Map(SIGNATURES.map(signature => [signature, []]));
  const moduleFor = (assetId, path, bytes, kind, width, height) => ({ assetId, kind,
    source: { path, sha256: hash(bytes), byteLength: bytes.length }, pixelSize: { width, height },
    footprint: { columns: Math.ceil(width / 64), rows: Math.ceil(height / 64) }, anchorPx: { x: 0, y: 0 },
    visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis: 'none' });
  for (const signature of SIGNATURES) for (let phase = 0; phase < 32; phase++) {
    const assetId = `r${phase}-blob-${String(signature).padStart(3, '0')}`, path = `assets/${assetId}.png`;
    modules.push(moduleFor(assetId, path, files.get(`kit/${path}`), 'terrain', 64, 64)); variants.get(signature).push(assetId);
  }
  const derived = {}, sourceEvidence = [];
  for (const item of sources) {
    const { plan, raw, result, review } = item, key = plan.recipe.slot;
    files.set(`source/${key}.png`, raw); files.set(`evidence/${key}-plan.json`, jsonBytes(plan));
    files.set(`evidence/${key}-result.json`, jsonBytes(result));
    if (review) files.set(`evidence/${key}-review.json`, jsonBytes(review));
    sourceEvidence.push({ slot: key, planSha256: plan.sha256, rawSha256: hash(raw),
      technicalSha256: result.technical.sha256, sourceArtAcceptance: review ? 'accepted' : 'not-assessed' });
    if (key === 'material') continue;
    const source = inspectPng(raw, { includePixels: true, allowCabx: true, allowHiddenRgb: true });
    const placement = environmentPlacement(source, plan.target, result.technical.alphaEvidence), size = placement.outputSize;
    const image = raster(size.width, size.height);
    blit(image, resampleEnvironmentAlpha(source, placement.crop, placement.resized.width, placement.resized.height), placement.offset.x, placement.offset.y);
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba), path = `assets/scene-${key}.png`;
    files.set(`kit/${path}`, bytes);
    const mod = moduleFor(`scene.${key}`, path, bytes, plan.target.kind, size.width, size.height);
    if (mod.kind !== 'background') {
      let foot = -1;
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (image.rgba[(y * image.width + x) * 4 + 3] >= 128) foot = y;
      check(foot >= 0, 'SCENE_DERIVED_EMPTY'); mod.anchorPx = { x: Math.round(image.width / 2), y: foot };
    }
    if (key === 'platform') {
      const surface = measurePlatformSurface(image), divisor = gcd(192, surface.right - surface.left);
      mod.terrainSkin = { profile: TERRAIN_SKIN_PROFILE, columns: 3, rows: 1, surfacePx: surface };
      mod.footprint = { columns: 3, rows: 1 }; mod.anchorPx = { x: surface.left, y: surface.y };
      mod.renderStyle = { scale: { numerator: 192 / divisor, denominator: (surface.right - surface.left) / divisor }, tint: 0xffffff, opacity: 1 };
    }
    mod.preferredLayerId = key; modules.push(mod); derived[key] = mod;
    files.set(`evidence/${key}-derivation.json`, jsonBytes(seal({ format: 'ai_scene_source_placement_v1',
      sourceSha256: hash(raw), derivedSha256: hash(bytes), placement, sourcePixelsModified: false,
      derivedArtAcceptance: 'not-assessed', repeatAxis: 'none', ...(mod.terrainSkin ? { terrainSkin: mod.terrainSkin } : {}) })));
  }
  const catalog = { format: 'ai_scene_module_catalog_v4', kitRef, modules };
  const rules = { format: 'ai_scene_terrain_rules_v1', kitRef, rulesId: 'terrain.primary', revision: 'macro-eight-v1',
    profile: PROFILE, familyId: 'terrain.primary', entries: SIGNATURES.map(signature => ({ signature, variantAssetIds: variants.get(signature) })) };
  const run = (x, y, length) => ({ x, y, length, familyId: rules.familyId });
  const layer = (layerId, kind, zIndex, x = 1) => ({ layerId, kind, zIndex, parallax: { x, y: 1 }, visible: true });
  const layers = reference.plan.format === 'ai_scene_generation_plan_v10'
    ? SCENE_LAYER_PROFILE.layers.map((entry, index) => layer(entry.layerId, entry.kind, index, entry.parallaxX))
    : [layer('sky', 'background', 0, 0), layer('far-backdrop', 'background', 1, 0.12),
    layer('distant-scenery', 'background', 2, 0.2), layer('far-structure', 'environment', 3, 0.35),
    layer('valley-detail', 'environment', 4, 0.45), layer('middle-scenery', 'environment', 5, 0.65),
    layer('structure-a', 'environment', 6, 0.9), layer('structure-b', 'environment', 7, 0.9),
    layer('terrain', 'terrain', 8), layer('platform', 'environment', 9), layer('foreground', 'environment', 10, 1.1)];
  const baseMap = (mapId, width, height) => ({ format: 'ai_scene_document_v3', mapId, kitRef,
    rulesRef: { rulesId: rules.rulesId, revision: rules.revision }, bounds: { x: 0, y: 0, width, height }, seed: candidateId,
    layers, terrainRuns: [], instances: [], assemblyInstances: [], curveTerrains: [], terrainConnections: [], inspectionCases: [],
    defaultCamera: { center: { x: 512, y: 288 }, viewport: { width: 1024, height: 576 }, scale: 1 } });
  const map = baseMap(`${candidateId}.default`, 16, 9);
  map.terrainRuns = [run(0, 6, 6), run(0, 7, 6), run(0, 8, 6), run(9, 7, 1), run(9, 8, 1), run(13, 6, 3), run(13, 7, 3), run(13, 8, 3)];
  map.curveTerrains = [{ curveId: 'default.valley', familyId: rules.familyId, profile: 'sideview-height-curve-v1', baseY: 576,
    points: [{ x: 384, y: 384, slope: 0 }, { x: 480, y: 448, slope: 0 }, { x: 576, y: 448, slope: 0 }] }];
  map.terrainConnections = [{ curveId: 'default.valley', endpoint: 'start', cell: { x: 5, y: 6 } },
    { curveId: 'default.valley', endpoint: 'end', cell: { x: 9, y: 7 } }];
  const positions = { sky: [0, 0], 'far-backdrop': [512, 380], 'distant-scenery': [512, 420], 'far-structure': [680, 410],
    'middle-scenery': [320, 420], 'structure-a': [180, 388], 'structure-b': [850, 390], foreground: [170, 568], 'valley-detail': [710, 560] };
  map.instances = Object.entries(positions).map(([key, [x, y]]) => ({ instanceId: `default.${key}`, assetId: derived[key].assetId, layerId: key, x, y }));
  map.assemblyInstances = [{ instanceId: 'default.platform', presetId: 'platform.three', layerId: 'platform', column: 9, row: 4 }];
  const preset = (presetId, width, height, terrainRuns) => ({ presetId, sizeCells: { width, height }, terrainRuns, instances: [], assemblies: [] });
  const library = { format: 'ai_scene_assembly_presets_v1', kitRef, presets: [
    preset('ground.flat', 16, 2, [run(0, 0, 16), run(0, 1, 16)]),
    preset('ground.steps', 12, 4, [run(0, 3, 12), run(3, 2, 9), run(6, 1, 6), run(9, 0, 3)]),
    preset('ground.gap', 16, 2, [run(0, 0, 6), run(0, 1, 6), run(10, 0, 6), run(10, 1, 6)]),
    { ...preset('platform.three', 3, 1, [run(0, 0, 3)]), instances: [{ instanceId: 'appearance', assetId: derived.platform.assetId, x: 0, y: 0 }] },
  ] };
  const inspection = baseMap(`${candidateId}.inspection`, 40, 30), cells = new Set();
  SIGNATURES.forEach((signature, index) => {
    const x = index % 8 * 5 + 2, y = Math.floor(index / 8) * 5 + 2; cells.add(`${x},${y}`);
    for (const [dx, dy, bit] of NEIGHBORS) if (signature & bit) cells.add(`${x + dx},${y + dy}`);
    inspection.inspectionCases.push({ caseId: `signature-${signature}`, cell: { x, y }, expectedSignature: signature });
  });
  inspection.terrainRuns = [...cells].map(key => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([x, y]) => run(x, y, 1));
  for (const [path, value] of [['catalog.json', catalog], ['rules.json', rules], ['presets.json', library],
    ['maps/default.scene.json', map], ['maps/inspection.scene.json', inspection]]) files.set(`kit/${path}`, jsonBytes(value));
  const ref = path => ({ path, sha256: hash(files.get(`kit/${path}`)) });
  const field = (kind, height) => ({ source: { path: `materials/${kind}-field.png`, sha256: hash(files.get(`kit/materials/${kind}-field.png`)),
    byteLength: files.get(`kit/materials/${kind}-field.png`).length }, pixelSize: { width: 505, height } });
  const kit = { format: 'ai_scene_kit_v4', ...kitRef, profile: PROFILE, purpose: 'art-candidate', grid: spec.grid, pixelsPerUnit: spec.pixelsPerUnit,
    terrainAppearance: { format: 'ai_scene_continuous_terrain_appearance_v2', selection: 'world-cell-8x4-phase-order-v1',
      profileSha256: REFERENCE_FIELD_SHA256, sourceSha256: hash(material.raw), studySha256: terrain.report.sha256,
      body: field('body', 253), cap: field('cap', 8), visualAcceptance: 'not-assessed' },
    files: { catalog: ref('catalog.json'), rules: ref('rules.json'), presets: ref('presets.json'),
      maps: { default: ref('maps/default.scene.json'), inspection: ref('maps/inspection.scene.json') } } };
  for (const doc of [kit, catalog, rules, library, map, inspection]) contract(doc);
  const model = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: 'presets.json' } });
  model.analyzeMap(map, { role: 'default', allowEmpty: false }); model.analyzeMap(inspection, { role: 'inspection', allowEmpty: false });
  files.set('kit/kit.json', jsonBytes(kit));
  files.set('source/reference.png', reference.raw);
  if (reference.plan.composition) {
    files.set('evidence/layer-profile.json', jsonBytes(SCENE_LAYER_PROFILE));
    files.set('evidence/layer-design.json', jsonBytes(reference.plan.recipe.layerDesign));
    files.set('evidence/reference-layer-checklist.json', jsonBytes(reference.plan.visualReviewChecklist));
  }
  for (const [key, value] of Object.entries({ batch, spec, style, 'reference-plan': reference.plan, 'reference-result': reference.result, 'reference-review': reference.review }))
    files.set(`evidence/${key}.json`, jsonBytes(value));
  const report = seal({ format: 'ai_scene_source_candidate_readiness_v1', candidateId, batchSha256: batch.sha256,
    requiredSourceCount: SCENE_SOURCE_SLOTS.length, sourceEvidence, moduleCount: modules.length, terrainRoleCount: 47, phaseCount: 32,
    layout: 'sideview-default-screen-v1', coverage: 'one-screen-finite-only', missingRequiredSources: [],
    fullKitVisualAcceptance: 'not-assessed', geometryAcceptance: 'not-assessed', productionKit: false, generationCalls: 0 });
  files.set('readiness.json', jsonBytes(report));
  const bundle = seal({ format: 'ai_scene_source_candidate_bundle_v1', candidateId, batchSha256: batch.sha256,
    kitSha256: hash(files.get('kit/kit.json')), readinessSha256: report.sha256, productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
