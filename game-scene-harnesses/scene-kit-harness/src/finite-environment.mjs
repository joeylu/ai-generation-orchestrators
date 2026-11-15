import { contextFor } from './kit.mjs';
import { compileMap } from './compile.mjs';
import { encodeRgbaPng } from './png.mjs';
import { createSceneSemantics } from './semantics.mjs';
import { check, clone, contract, exact, hash, id, jsonBytes, seal } from './generation/common.mjs';

// This is a separate, finite demonstration, never a repair of a repeating strip.
export function finiteEnvironmentFiles(baseKit, prepared, review, options) {
  exact(options, ['exampleId', 'parallax']); id(options.exampleId);
  exact(options.parallax, ['numerator', 'denominator']);
  const { numerator: n, denominator: d } = options.parallax;
  check(Number.isSafeInteger(n) && Number.isSafeInteger(d) && n >= 0 && d > 0 && n <= d && d <= 10000, 'FINITE_PARALLAX');
  const base = contextFor(baseKit), map = clone(base.maps.default), { report } = prepared;
  check(base.kit.purpose === 'synthetic-fixture', 'FINITE_BASE_FIXTURE');
  check(!base.catalog.modules.some(module => ['finite-mountains', 'placeholder-sky'].includes(module.assetId)), 'FINITE_ASSET_COLLISION');
  check(report.layoutStudy && report.target.kind === 'strip' && review.receipt.decision === 'accept'
    && review.receipt.targetSha256 === report.source.sha256, 'FINITE_SOURCE_REVIEW');
  check(base.kit.pixelsPerUnit.numerator === base.kit.pixelsPerUnit.denominator
    && map.bounds.x === 0 && map.bounds.y === 0 && map.defaultCamera.scale === 1, 'FINITE_BASE_GEOMETRY');
  const scene = compileMap(baseKit, map), viewport = map.defaultCamera.viewport;
  const size = report.target.derivation.pixelSize, world = scene.worldBounds;
  check(world.width >= viewport.width && world.height === viewport.height && size.height === viewport.height
    && map.defaultCamera.center.x === viewport.width / 2 && map.defaultCamera.center.y === viewport.height / 2, 'FINITE_BASE_GEOMETRY');
  const travel = world.width - viewport.width, requiredNumerator = viewport.width * d + travel * n;
  check(size.width * d >= requiredNumerator, 'FINITE_COVERAGE');
  const kitRef = { kitId: options.exampleId, revision: 'finite-demo-v1' };
  const files = new Map([...base.files].map(([path, bytes]) => [`kit/${path}`, Buffer.from(bytes)]));
  const mountain = Buffer.from(prepared.files.get('assets/environment.png'));
  const skyRgba = Buffer.alloc(64 * viewport.height * 4);
  // A declared flat engineering placeholder, not generated or accepted sky art.
  for (let p = 0; p < skyRgba.length; p += 4) skyRgba.set([224, 240, 226, 255], p);
  const sky = encodeRgbaPng(64, viewport.height, skyRgba);
  const module = (assetId, kind, bytes, pixelSize, repeatAxis) => ({ assetId, kind,
    source: { path: `assets/${assetId}.png`, sha256: hash(bytes), byteLength: bytes.length }, pixelSize,
    footprint: { columns: Math.ceil(pixelSize.width / base.kit.grid.width), rows: Math.ceil(pixelSize.height / base.kit.grid.height) },
    anchorPx: { x: 0, y: 0 }, visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis });
  const catalog = { ...clone(base.catalog), kitRef, modules: [...clone(base.catalog.modules),
    module('finite-mountains', 'environment', mountain, size, 'none'),
    module('placeholder-sky', 'strip', sky, { width: 64, height: viewport.height }, 'x')] };
  files.set('kit/assets/finite-mountains.png', mountain); files.set('kit/assets/placeholder-sky.png', sky);
  const cells = base.model.analyzeMap(map).cells;
  map.terrainRuns = [...cells].map(([key, familyId]) => { const [x, y] = key.split(',').map(Number); return { x, y, length: 1, familyId }; })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  map.kitRef = kitRef; map.mapId = `${options.exampleId}.default`; map.assemblyInstances = [];
  map.layers = [
    { layerId: 'sky', kind: 'background', zIndex: 0, parallax: { x: 1, y: 1 }, visible: true },
    { layerId: 'far-mountains', kind: 'background', zIndex: 1, parallax: { x: n / d, y: 1 }, visible: true },
    ...map.layers.filter(layer => layer.kind !== 'background'),
  ];
  map.instances = [
    { instanceId: 'sky.placeholder', assetId: 'placeholder-sky', layerId: 'sky', x: 0, y: 0 },
    { instanceId: 'mountains.finite', assetId: 'finite-mountains', layerId: 'far-mountains', x: 0, y: 0 },
  ];
  const rules = { ...clone(base.rules), kitRef }, library = { ...clone(base.library), kitRef };
  const inspection = { ...clone(base.maps.inspection), kitRef };
  const documents = [[base.kit.files.catalog.path, catalog], [base.kit.files.rules.path, rules],
    [base.kit.files.presets.path, library], [base.kit.files.maps.default.path, map], [base.kit.files.maps.inspection.path, inspection]];
  for (const [path, value] of documents) files.set(`kit/${path}`, jsonBytes(value));
  const ref = old => ({ path: old.path, sha256: hash(files.get(`kit/${old.path}`)) });
  const kit = { ...clone(base.kit), ...kitRef, purpose: 'art-candidate', files: {
    catalog: ref(base.kit.files.catalog), rules: ref(base.kit.files.rules), presets: ref(base.kit.files.presets),
    maps: { default: ref(base.kit.files.maps.default), inspection: ref(base.kit.files.maps.inspection) } } };
  files.set('kit/kit.json', jsonBytes(kit));
  for (const document of [kit, catalog, rules, library, map, inspection]) contract(document);
  const semantics = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: kit.files.presets.path } });
  semantics.analyzeMap(map, { role: 'default', allowEmpty: false });
  semantics.analyzeMap(inspection, { role: 'inspection', allowEmpty: false });
  const coverage = seal({ format: 'ai_scene_finite_environment_coverage_v1',
    world, viewport, sourceOrigin: { x: 0, y: 0 }, pixelSize: size, parallax: options.parallax,
    horizontalTravel: travel, requiredWidth: { numerator: requiredNumerator, denominator: d },
    rightMargin: { numerator: size.width * d - requiredNumerator, denominator: d },
    cameraCenterRange: { minX: viewport.width / 2, maxX: world.width - viewport.width / 2, y: viewport.height / 2 },
    guarantee: 'continuous-horizontal-range-at-declared-game-viewport-only', status: 'covered', repeatAxis: 'none' });
  files.set('coverage.json', jsonBytes(coverage));
  files.set('evidence/source-review.json', jsonBytes(review));
  files.set('evidence/derivation.json', prepared.files.get('derivation.json'));
  files.set('source/original.png', prepared.files.get('source/original.png'));
  const bundle = seal({ format: 'ai_scene_finite_environment_demo_v1', exampleId: options.exampleId,
    baseKitSha256: base.bundleSha256, sourceSha256: report.source.sha256, sourceReviewSha256: review.sha256,
    derivationSha256: report.sha256, layoutStudySha256: report.layoutStudy.sha256,
    originalRepeatProofStatus: report.status, repeatingSeam: report.seam, loopingCertified: false,
    coverageSha256: coverage.sha256, kitSha256: hash(files.get('kit/kit.json')),
    terrainArtwork: 'external-study-or-engineering-fixture', skyArtwork: 'flat-engineering-placeholder',
    productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle));
  return { files, bundle, report: coverage };
}
