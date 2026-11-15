import { SIGNATURES } from './topology.mjs';
import { createSceneSemantics } from './semantics.mjs';
import { check, clone, contract, exact, hash, id, jsonBytes, seal } from './generation/common.mjs';

// Assemble existing verified derivations. This never invokes a model or awards
// human artwork acceptance. The old finite kit and appearance studies stay intact.
export function sceneCandidateFiles(finite, terrain, materialReview, options) {
  exact(options, ['candidateId']); id(options.candidateId);
  check(options.candidateId.length <= 75, 'CANDIDATE_ID');
  check(terrain.report.format === 'ai_scene_terrain_continuity_study_derivation_v1'
    && materialReview.receipt.decision === 'accept' && materialReview.receipt.targetSha256 === terrain.report.source.sha256, 'CANDIDATE_MATERIAL');
  const files = new Map([...finite.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  files.delete('proof-bundle.json'); files.delete('evidence/source-review.json');
  files.set('evidence/environment-source-review.json', finite.files.get('evidence/source-review.json'));
  const oldKit = JSON.parse(files.get('kit/kit.json')), kitRef = { kitId: options.candidateId, revision: 'candidate-v1' };
  const read = ref => JSON.parse(files.get(`kit/${ref.path}`));
  const oldCatalog = read(oldKit.files.catalog), oldRules = read(oldKit.files.rules), map = read(oldKit.files.maps.default);
  const inspection = read(oldKit.files.maps.inspection), library = read(oldKit.files.presets);
  const retained = oldCatalog.modules.filter(module => ['finite-mountains', 'placeholder-sky'].includes(module.assetId));
  // Only these two environment modules survive; all old engineering terrain and
  // marker PNGs are removed from the new candidate dependency closure.
  for (const module of oldCatalog.modules) if (!retained.some(item => item.assetId === module.assetId)) files.delete(`kit/${module.source.path}`);
  const modules = [], bySignature = new Map(SIGNATURES.map(signature => [signature, []]));
  for (const signature of SIGNATURES) for (let phase = 0; phase < 16; phase++) {
    const assetId = `p${phase}-blob-${String(signature).padStart(3, '0')}`, path = `assets/${assetId}.png`;
    const bytes = terrain.files.get(`tiles/${assetId}.png`); check(bytes, 'CANDIDATE_TILE');
    files.set(`kit/${path}`, bytes); bySignature.get(signature).push(assetId);
    modules.push({ assetId, kind: 'terrain', source: { path, sha256: hash(bytes), byteLength: bytes.length },
      pixelSize: { width: 64, height: 64 }, footprint: { columns: 1, rows: 1 }, anchorPx: { x: 0, y: 0 },
      visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis: 'none' });
  }
  const fields = {};
  for (const kind of ['body', 'cap']) {
    const path = `materials/${kind}-field.png`, bytes = terrain.files.get(path); check(bytes, 'CANDIDATE_MATERIAL');
    files.set(`kit/${path}`, bytes);
    fields[kind] = { source: { path, sha256: hash(bytes), byteLength: bytes.length }, pixelSize: { width: 253, height: kind === 'body' ? 253 : 8 } };
  }
  const catalog = { ...oldCatalog, kitRef, modules: [...modules, ...retained] };
  const rules = { ...oldRules, kitRef, revision: 'continuous-v1', entries: SIGNATURES.map(signature => ({ signature, variantAssetIds: bySignature.get(signature) })) };
  for (const document of [map, inspection, library]) document.kitRef = kitRef;
  for (const document of [map, inspection]) document.rulesRef = { rulesId: rules.rulesId, revision: rules.revision };
  for (const preset of library.presets) preset.instances = [];
  const familyId = rules.familyId;
  const run = (x, y, length) => ({ x, y, length, familyId });
  const preset = (presetId, width, height, terrainRuns) => ({ presetId, sizeCells: { width, height }, terrainRuns, instances: [], assemblies: [] });
  library.presets.push(
    preset('ground.flat.16', 16, 2, [run(0, 0, 16), run(0, 1, 16)]),
    preset('ground.stairs.12', 12, 4, [run(0, 3, 12), run(3, 2, 9), run(6, 1, 6), run(9, 0, 3)]),
    preset('ground.gap.16', 16, 2, [run(0, 0, 6), run(0, 1, 6), run(10, 0, 6), run(10, 1, 6)]));
  map.format = 'ai_scene_document_v3'; map.mapId = `${options.candidateId}.default`;
  map.terrainRuns = [run(0, 6, 12), run(0, 7, 12), run(0, 8, 12), run(20, 6, 8), run(20, 7, 8), run(20, 8, 8),
    run(32, 8, 14), run(47, 8, 17), run(36, 7, 5), run(38, 6, 3), run(40, 5, 1), run(50, 4, 4), run(57, 3, 3)];
  map.curveTerrains = [{ curveId: 'forest.hill', familyId, profile: 'sideview-height-curve-v1', baseY: 576,
    points: [{ x: 768, y: 384, slope: 0 }, { x: 1024, y: 256, slope: 0 }, { x: 1280, y: 384, slope: 0 }] }];
  map.terrainConnections = [{ curveId: 'forest.hill', endpoint: 'start', cell: { x: 11, y: 6 } },
    { curveId: 'forest.hill', endpoint: 'end', cell: { x: 20, y: 6 } }];
  const docs = [[oldKit.files.catalog.path, catalog], [oldKit.files.rules.path, rules], [oldKit.files.presets.path, library],
    [oldKit.files.maps.default.path, map], [oldKit.files.maps.inspection.path, inspection]];
  for (const [path, value] of docs) files.set(`kit/${path}`, jsonBytes(value));
  const ref = old => ({ path: old.path, sha256: hash(files.get(`kit/${old.path}`)) });
  const appearance = { format: 'ai_scene_continuous_terrain_appearance_v1', selection: 'world-cell-4x4-phase-order-v1',
    profileSha256: terrain.report.profileSha256, sourceSha256: terrain.report.source.sha256, studySha256: terrain.bundle.sha256,
    ...fields, visualAcceptance: 'not-assessed' };
  const kit = { ...oldKit, ...kitRef, format: 'ai_scene_kit_v2', terrainAppearance: appearance, files: {
    catalog: ref(oldKit.files.catalog), rules: ref(oldKit.files.rules), presets: ref(oldKit.files.presets),
    maps: { default: ref(oldKit.files.maps.default), inspection: ref(oldKit.files.maps.inspection) } } };
  for (const document of [kit, catalog, rules, library, map, inspection]) contract(document);
  const semantics = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: kit.files.presets.path } });
  const defaultSummary = semantics.analyzeMap(map, { role: 'default', allowEmpty: false }).summary;
  semantics.analyzeMap(inspection, { role: 'inspection', allowEmpty: false });
  files.set('kit/kit.json', jsonBytes(kit));
  files.set('source/material-original.png', terrain.files.get('source/original.png'));
  files.set('evidence/material-source-review.json', jsonBytes(materialReview));
  files.set('evidence/material-derivation.json', terrain.files.get('derivation.json'));
  const report = seal({ format: 'ai_scene_candidate_readiness_v1', candidateId: options.candidateId,
    author: defaultSummary, available: ['blob47-16-phases', 'curve-materials', 'grid-curve-connections', 'finite-mountains', 'five-terrain-presets'],
    missingArtwork: ['accepted-sky-art', 'distant-forest', 'midground-tree-groups', 'ruins-groups', 'foreground-foliage'],
    sky: 'flat-engineering-placeholder', terrainVisualAcceptance: 'not-assessed', fullKitVisualAcceptance: 'not-assessed',
    loopingBackground: 'not-certified', physicsAndWalkability: 'not-assessed', generationCalls: 0, productionKit: false });
  files.set('readiness.json', jsonBytes(report));
  const bundle = seal({ format: 'ai_scene_candidate_bundle_v1', candidateId: options.candidateId,
    parentFiniteBundleSha256: finite.bundle.sha256, terrainStudySha256: terrain.bundle.sha256,
    materialSourceReviewSha256: materialReview.sha256, environmentSourceReviewSha256: finite.bundle.sourceReviewSha256,
    kitSha256: hash(files.get('kit/kit.json')), readinessSha256: report.sha256,
    productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
