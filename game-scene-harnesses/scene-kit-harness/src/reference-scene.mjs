import { inspectPng, encodeRgbaPng } from './png.mjs';
import { SIGNATURES } from './topology.mjs';
import { createSceneSemantics } from './semantics.mjs';
import { check, clone, contract, hash, id, jsonBytes, seal } from './generation/common.mjs';

// Recompose one reference-validation screen from verified sources. Styles are
// explicit runtime data; original artwork and workflow decisions stay intact.
export function referenceSceneFiles(base, terrain, studyId, layoutRevision = 'reference-screen-v1') {
  id(studyId); check(studyId.length <= 75, 'CANDIDATE_ID');
  check(['reference-screen-v1', 'framed-v2', 'framed-v3'].includes(layoutRevision), 'REFERENCE_LAYOUT');
  const framed = layoutRevision !== 'reference-screen-v1', lowerFrame = layoutRevision === 'framed-v3';
  const files = new Map([...base.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  files.delete('proof-bundle.json');
  files.set('evidence/four-screen-readiness.json', files.get('readiness.json'));
  if (files.has('coverage.json')) { files.set('evidence/four-screen-coverage.json', files.get('coverage.json')); files.delete('coverage.json'); }
  const oldKit = JSON.parse(files.get('kit/kit.json')), kitRef = { kitId: studyId, revision: 'reference-study-v1' };
  const read = ref => JSON.parse(files.get(`kit/${ref.path}`));
  const catalog = read(oldKit.files.catalog), rules = read(oldKit.files.rules), library = read(oldKit.files.presets);
  const map = read(oldKit.files.maps.default), inspection = read(oldKit.files.maps.inspection);
  for (const module of catalog.modules.filter(item => item.kind === 'terrain')) files.delete(`kit/${module.source.path}`);
  catalog.modules = catalog.modules.filter(item => item.kind !== 'terrain'); catalog.format = 'ai_scene_module_catalog_v3';
  const variants = new Map(SIGNATURES.map(signature => [signature, []])), tiles = [];
  for (const signature of SIGNATURES) for (let phase = 0; phase < 32; phase++) {
    const assetId = `r${phase}-blob-${String(signature).padStart(3, '0')}`, path = `assets/${assetId}.png`, bytes = terrain.files.get(`tiles/${assetId}.png`);
    check(bytes, 'CANDIDATE_TILE'); files.set(`kit/${path}`, bytes); variants.get(signature).push(assetId);
    tiles.push({ assetId, kind: 'terrain', source: { path, sha256: hash(bytes), byteLength: bytes.length }, pixelSize: { width: 64, height: 64 },
      footprint: { columns: 1, rows: 1 }, anchorPx: { x: 0, y: 0 }, visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis: 'none' });
  }
  catalog.modules.unshift(...tiles);
  const fields = {};
  for (const kind of ['body', 'cap']) {
    const path = `materials/${kind}-field.png`, bytes = terrain.files.get(path); check(bytes, 'CANDIDATE_MATERIAL'); files.set(`kit/${path}`, bytes);
    fields[kind] = { source: { path, sha256: hash(bytes), byteLength: bytes.length }, pixelSize: { width: 505, height: kind === 'body' ? 253 : 8 } };
  }
  files.set('evidence/macro-terrain-derivation.json', terrain.files.get('derivation.json'));
  files.set('evidence/macro-terrain-bundle.json', terrain.files.get('proof-bundle.json'));
  const source = inspectPng(files.get('source/trees-native.png'), { includePixels: true, allowCabx: true, allowHiddenRgb: true });
  let footY = -1, hidden = 0;
  const rgba = Buffer.from(source.rgba);
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const p = (y * source.width + x) * 4;
    if (rgba[p + 3] >= 128) footY = y;
    if (rgba[p + 3] === 0) { if (rgba[p] || rgba[p + 1] || rgba[p + 2]) hidden++; rgba.fill(0, p, p + 3); }
  }
  check(footY >= 0, 'REVIEW_FOOT_ANCHOR');
  const nativeTree = encodeRgbaPng(source.width, source.height, rgba), nativePath = 'assets/reference-native-trees.png';
  files.set(`kit/${nativePath}`, nativeTree);
  const treeTemplate = { assetId: '', kind: 'environment', source: { path: nativePath, sha256: hash(nativeTree), byteLength: nativeTree.length },
    pixelSize: { width: source.width, height: source.height }, footprint: { columns: Math.ceil(source.width / 64), rows: Math.ceil(source.height / 64) },
    anchorPx: { x: 0, y: footY }, visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis: 'none' };
  const style = (numerator, denominator, tint = 0xffffff, opacity = 1) => ({ scale: { numerator, denominator }, tint, opacity });
  const variant = (assetId, template, anchorPx, renderStyle, preferredLayerId) => {
    const module = { ...clone(template), assetId, anchorPx, renderStyle, preferredLayerId }; catalog.modules.push(module); return module;
  };
  const stock = assetId => catalog.modules.find(item => item.assetId === assetId);
  variant('reference.foreground-tree', treeTemplate, { x: Math.round(source.width * (framed ? 0.806 : 0.744)), y: footY }, style(3, 4, framed ? 0x365c68 : 0x4a7784), 'foreground-tree');
  variant('reference.middle-trees', treeTemplate, { x: Math.round(source.width * 0.49), y: footY }, style(12, 25, 0xd8eddd, 0.92), 'middle-trees');
  variant('reference.bottom-canopy', treeTemplate, { x: Math.round(source.width * 0.56), y: 0 }, style(7, 10, 0x254e58), 'foreground-canopy');
  if (framed) variant('reference.bottom-canopy-right', treeTemplate, { x: 0, y: 0 }, style(7, 10, 0x254e58), 'foreground-canopy');
  const arch = stock('review-arch'), wall = stock('review-wall');
  variant('reference.left-arch', arch, clone(arch.anchorPx), style(11, 20), 'near-ruins');
  variant('reference.right-arch', arch, { x: 145, y: arch.anchorPx.y }, style(1, 1), 'near-ruins');
  variant('reference.far-ruins', wall, clone(wall.anchorPx), style(9, 20, 0x9ac7bd, 0.42), 'far-ruins');
  stock('review-forest').renderStyle = style(1, 1, 0xcbe6dc, 0.75); stock('review-forest').preferredLayerId = 'distant-forest';
  stock('review-trees').preferredLayerId = 'middle-trees'; arch.preferredLayerId = wall.preferredLayerId = 'near-ruins';
  const layer = (layerId, kind, zIndex, p) => ({ layerId, kind, zIndex, parallax: { x: p, y: 1 }, visible: true });
  map.layers = [layer('sky', 'background', 0, 0), layer('far-mountains', 'background', 1, 0.12), layer('distant-forest', 'background', 2, 0.2),
    layer('far-ruins', 'environment', 3, 0.35), layer('middle-trees', 'environment', 4, 0.65), layer('near-ruins', 'environment', 5, 0.9),
    layer('terrain', 'terrain', 6, 1), layer('foreground-tree', 'environment', 7, 1.1), layer('foreground-canopy', 'environment', 8, 1.15)];
  const instance = (instanceId, assetId, layerId, x, y) => ({ instanceId, assetId, layerId, x, y });
  map.instances = [instance('sky', 'review-sky', 'sky', 0, 0), instance('mountains', 'finite-mountains', 'far-mountains', 0, 0),
    instance('forest', 'review-forest', 'distant-forest', 0, 64), instance('far.ruin.1', 'reference.far-ruins', 'far-ruins', 510, 370),
    instance('far.ruin.2', 'reference.far-ruins', 'far-ruins', 670, 354), instance('middle.trees', 'reference.middle-trees', 'middle-trees', 250, 422),
    instance('left.arch', 'reference.left-arch', 'near-ruins', 210, 388), instance('right.arch', 'reference.right-arch', 'near-ruins', 900, 388),
    instance('near.tree', 'reference.foreground-tree', 'foreground-tree', framed ? 0 : 70, 572),
    instance('canopy.left', 'reference.bottom-canopy', 'foreground-canopy', 0, lowerFrame ? 400 : 480),
    instance('canopy.right', framed ? 'reference.bottom-canopy-right' : 'reference.bottom-canopy', 'foreground-canopy', framed ? 790 : 920, lowerFrame ? 416 : framed ? 480 : 496)];
  map.bounds = { x: 0, y: 0, width: 16, height: 9 }; map.mapId = `${studyId}.default`;
  const familyId = rules.familyId, run = (x, y, length) => ({ x, y, length, familyId });
  map.terrainRuns = [run(0, 6, 6), run(0, 7, 6), run(0, 8, 6), run(9, 7, 1), run(9, 8, 1),
    run(13, 6, 3), run(13, 7, 3), run(13, 8, 3), run(9, 4, 3)];
  map.curveTerrains = [{ curveId: 'reference.terrace', familyId, profile: 'sideview-height-curve-v1', baseY: 576,
    points: [{ x: 384, y: 384, slope: 0 }, { x: 480, y: 448, slope: 0 }, { x: 576, y: 448, slope: 0 }] }];
  map.terrainConnections = [{ curveId: 'reference.terrace', endpoint: 'start', cell: { x: 5, y: 6 } },
    { curveId: 'reference.terrace', endpoint: 'end', cell: { x: 9, y: 7 } }];
  rules.revision = 'macro-eight-v1'; rules.entries = SIGNATURES.map(signature => ({ signature, variantAssetIds: variants.get(signature) }));
  for (const document of [catalog, rules, library, map, inspection]) document.kitRef = kitRef;
  for (const document of [map, inspection]) document.rulesRef = { rulesId: rules.rulesId, revision: rules.revision };
  for (const [path, document] of [[oldKit.files.catalog.path, catalog], [oldKit.files.rules.path, rules], [oldKit.files.presets.path, library],
    [oldKit.files.maps.default.path, map], [oldKit.files.maps.inspection.path, inspection]]) files.set(`kit/${path}`, jsonBytes(document));
  const ref = old => ({ path: old.path, sha256: hash(files.get(`kit/${old.path}`)) });
  const kit = { ...clone(oldKit), ...kitRef, format: 'ai_scene_kit_v3', terrainAppearance: { format: 'ai_scene_continuous_terrain_appearance_v2',
    selection: 'world-cell-8x4-phase-order-v1', profileSha256: terrain.report.profileSha256, sourceSha256: terrain.report.source.sha256,
    studySha256: terrain.bundle.sha256, ...fields, visualAcceptance: 'not-assessed', ...(framed ? { tint: 0xd4dfdf } : {}) }, files: {
    catalog: ref(oldKit.files.catalog), rules: ref(oldKit.files.rules), presets: ref(oldKit.files.presets),
    maps: { default: ref(oldKit.files.maps.default), inspection: ref(oldKit.files.maps.inspection) } } };
  for (const document of [kit, catalog, rules, library, map, inspection]) contract(document);
  const model = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: kit.files.presets.path } });
  const author = model.analyzeMap(map, { role: 'default', allowEmpty: false }).summary;
  model.analyzeMap(inspection, { role: 'inspection', allowEmpty: false }); files.set('kit/kit.json', jsonBytes(kit));
  const report = seal({ format: 'ai_scene_reference_composition_readiness_v1', studyId, author, sourceReviewCandidateSha256: base.bundle.sha256,
    ...(framed ? { layoutRevision } : {}),
    scope: 'one-screen-reference-comparison-study', viewport: { width: 1024, height: 576 }, terrainFieldPeriod: { width: 512, height: 256 },
    nativeTreeCanonicalization: { sourceSha256: hash(files.get('source/trees-native.png')), derivedSha256: hash(nativeTree),
      operation: 'zero-hidden-rgb-only-copy-all-alpha-and-visible-rgba', hiddenRgbPixels: hidden, nativeCanvasPreserved: true },
    existingArtReused: ['foreground-tree-from-native-tree-group', 'bottom-framing-from-existing-canopy', 'distant-ruins-from-wall-group'],
    missingArtwork: ['dedicated-foreground-foliage', 'distant-castle-and-bridge', 'waterfall-and-water', 'hanging-vines-and-platform-underside'],
    sourceArtAcceptance: 'unchanged-pending-human-review', fullKitVisualAcceptance: 'not-assessed', productionKit: false, generationCalls: 0 });
  files.set('readiness.json', jsonBytes(report));
  const bundle = seal({ format: 'ai_scene_reference_composition_bundle_v1', studyId, parentReviewBundleSha256: base.bundle.sha256,
    terrainBundleSha256: terrain.bundle.sha256, kitSha256: hash(files.get('kit/kit.json')), readinessSha256: report.sha256,
    productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
