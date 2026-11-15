import { inspectPng, encodeRgbaPng } from './png.mjs';
import { resampleEnvironmentAlpha } from './environment-proof.mjs';
import { createSceneSemantics } from './semantics.mjs';
import { check, clone, contract, hash, id, jsonBytes, seal } from './generation/common.mjs';

export const REVIEW_ROLES = Object.freeze({ sky: 'sky-background', forest: 'distant-forest', trees: 'tree-group',
  arch: 'ruins-arch-group', wall: 'ruins-wall-group' });
const sizes = { sky: [1024, 576], forest: [1536, 512], trees: [512, 512], arch: [640, 480], wall: [512, 256] };

// A deliberately separate review composition. Passed technical reception is
// enough to see candidate art here; no accepted-source or release claim follows.
export function reviewCandidateFiles(base, environments, reviewId, layoutRevision = 'initial-v1') {
  id(reviewId); check(reviewId.length <= 75, 'CANDIDATE_ID');
  check(['initial-v1', 'grounded-v2', 'grounded-v3'].includes(layoutRevision), 'REVIEW_LAYOUT');
  const grounded = layoutRevision !== 'initial-v1', footAnchors = layoutRevision === 'grounded-v3';
  const files = new Map([...base.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  files.delete('proof-bundle.json'); files.set('evidence/base-readiness.json', files.get('readiness.json'));
  const oldKit = JSON.parse(files.get('kit/kit.json')), kitRef = { kitId: reviewId, revision: 'review-v1' };
  const read = ref => JSON.parse(files.get(`kit/${ref.path}`));
  const catalog = read(oldKit.files.catalog), rules = read(oldKit.files.rules), library = read(oldKit.files.presets);
  const map = read(oldKit.files.maps.default), inspection = read(oldKit.files.maps.inspection);
  const placeholder = catalog.modules.find(module => module.assetId === 'placeholder-sky');
  const mountains = catalog.modules.find(module => module.assetId === 'finite-mountains');
  check(placeholder && !catalog.modules.some(module => module.assetId.startsWith('review-')), 'REVIEW_BASE');
  check(mountains?.kind === 'environment' && mountains.repeatAxis === 'none' && mountains.pixelSize.height === 576
    && mountains.anchorPx.x === 0 && mountains.anchorPx.y === 0 && mountains.visualOffset.x === 0 && mountains.visualOffset.y === 0, 'REVIEW_BASE');
  files.delete(`kit/${placeholder.source.path}`); catalog.modules = catalog.modules.filter(module => module !== placeholder);
  catalog.format = 'ai_scene_module_catalog_v2';
  const sources = [];
  for (const [slot, role] of Object.entries(REVIEW_ROLES)) {
    const item = environments[slot], { report } = item.prepared;
    check(report.target.role === role && ['pending-visual-review', 'accepted'].includes(item.status), 'REVIEW_SOURCE_ROLE');
    const png = inspectPng(item.prepared.files.get('assets/environment.png'), { includePixels: true }), [width, height] = sizes[slot];
    check(png.width >= width && png.height >= height && png.width * height === png.height * width, 'REVIEW_RESIZE');
    const scaled = resampleEnvironmentAlpha(png, { x: 0, y: 0, width: png.width, height: png.height }, width, height);
    const bytes = encodeRgbaPng(width, height, scaled.rgba), assetId = `review-${slot}`, path = `assets/${assetId}.png`;
    let anchorY = height - 1;
    if (footAnchors && !['sky', 'forest'].includes(slot)) {
      anchorY = -1;
      // This is a placement anchor only. Never crop, threshold or rewrite RGBA.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (scaled.rgba[(y * width + x) * 4 + 3] >= 128) anchorY = y;
      check(anchorY >= 0, 'REVIEW_FOOT_ANCHOR');
    }
    files.set(`kit/${path}`, bytes);
    catalog.modules.push({ assetId, kind: slot === 'sky' ? 'background' : 'environment',
      source: { path, sha256: hash(bytes), byteLength: bytes.length }, pixelSize: { width, height },
      footprint: { columns: Math.ceil(width / 64), rows: Math.ceil(height / 64) },
      anchorPx: slot === 'sky' || slot === 'forest' ? { x: 0, y: 0 } : { x: width / 2, y: anchorY },
      visualOffset: { x: 0, y: 0 }, allowedTransforms: ['identity'], repeatAxis: 'none' });
    files.set(`source/${slot}-native.png`, item.prepared.files.get('source/original.png'));
    files.set(`evidence/${slot}-derivation.json`, item.prepared.files.get('derivation.json'));
    files.set(`evidence/${slot}-assessment.json`, jsonBytes(item.plan));
    if (item.approval) {
      files.set(`evidence/${slot}-padding-approval.json`, jsonBytes(item.approval));
      files.set(`source/${slot}-before-padding.png`, item.original);
    }
    if (item.review) files.set(`evidence/${slot}-source-review.json`, jsonBytes(item.review));
    sources.push({ slot, role, planSha256: item.plan.sha256, rawSha256: report.source.sha256,
      sourceStatus: item.status, sourceArtAcceptance: item.status === 'accepted' ? 'accepted' : 'pending-human-review',
      proofBundleSha256: item.prepared.bundle.sha256, nativeTechnicalSha256: report.sourceTechnicalSha256,
      derivedSha256: hash(bytes), originalSeam: report.seam, repeatAxis: 'none',
      resize: { from: { width: png.width, height: png.height }, to: { width, height }, method: 'integer-area-premultiplied-alpha-round-half-up-v1' },
      ...(footAnchors && !['sky', 'forest'].includes(slot) ? { placementAnchor: { x: width / 2, y: anchorY,
        policy: 'last-row-with-alpha-at-least-128-anchor-only-no-pixel-change-v1' } } : {}),
      derivedArtAcceptance: 'not-assessed' });
  }
  const layer = (layerId, kind, zIndex, x = 1) => ({ layerId, kind, zIndex, parallax: { x, y: 1 }, visible: true });
  const terrain = map.layers.find(item => item.kind === 'terrain');
  map.layers = [layer('sky', 'background', 0, 0), layer('far-mountains', 'background', 1, 0.15),
    layer('distant-forest', 'background', 2, 0.16), layer('trees', 'environment', 3), layer('ruins', 'environment', 4),
    { ...terrain, zIndex: 5 }, layer('foreground', 'environment', 6)];
  const instance = (instanceId, slot, layerId, x, y) => ({ instanceId, assetId: `review-${slot}`, layerId, x, y });
  map.instances = [instance('sky.review', 'sky', 'sky', 0, 0),
    { instanceId: 'mountains.finite', assetId: 'finite-mountains', layerId: 'far-mountains', x: 0, y: 0 },
    instance('forest.finite', 'forest', 'distant-forest', 0, 64),
    ...[[200, 388], [660, 390], [1450, 388], [grounded ? 2304 : 2200, 516], [grounded ? 2670 : 2850, 516], [3670, 516]].map(([x, y], i) => instance(`trees.${i}`, 'trees', 'trees', x, y)),
    ...[[470, 388], [grounded ? 1450 : 1750, 388], [grounded ? 3400 : 3180, 516]].map(([x, y], i) => instance(`arch.${i}`, 'arch', 'ruins', x, y)),
    ...[[700, 388], [grounded ? 2304 : 2250, 516], [3800, 516]].map(([x, y], i) => instance(`wall.${i}`, 'wall', 'ruins', x, y))];
  map.mapId = `${reviewId}.default`;
  for (const document of [catalog, rules, library, map, inspection]) document.kitRef = kitRef;
  const docs = [[oldKit.files.catalog.path, catalog], [oldKit.files.rules.path, rules], [oldKit.files.presets.path, library],
    [oldKit.files.maps.default.path, map], [oldKit.files.maps.inspection.path, inspection]];
  for (const [path, value] of docs) files.set(`kit/${path}`, jsonBytes(value));
  const ref = old => ({ path: old.path, sha256: hash(files.get(`kit/${old.path}`)) });
  const kit = { ...clone(oldKit), ...kitRef, files: { catalog: ref(oldKit.files.catalog), rules: ref(oldKit.files.rules),
    presets: ref(oldKit.files.presets), maps: { default: ref(oldKit.files.maps.default), inspection: ref(oldKit.files.maps.inspection) } } };
  for (const document of [kit, catalog, rules, library, map, inspection]) contract(document);
  const model = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: kit.files.presets.path } });
  const author = model.analyzeMap(map, { role: 'default', allowEmpty: false }).summary;
  model.analyzeMap(inspection, { role: 'inspection', allowEmpty: false });
  const worldWidth = map.bounds.width * kit.grid.width, viewport = map.defaultCamera.viewport;
  check(worldWidth === 4096 && viewport.width === 1024 && viewport.height === 576 && map.bounds.height === 9
    && map.bounds.x === 0 && map.bounds.y === 0 && map.defaultCamera.center.x === 512 && map.defaultCamera.center.y === 288
    && map.defaultCamera.scale === 1, 'REVIEW_VIEWPORT');
  const finiteCoverage = [{ slot: 'sky', width: 1024, parallax: { numerator: 0, denominator: 100 } },
    { slot: 'mountains', width: mountains.pixelSize.width, parallax: { numerator: 15, denominator: 100 } },
    { slot: 'forest', width: 1536, parallax: { numerator: 16, denominator: 100 } }].map(item => {
    const required = viewport.width * item.parallax.denominator + (worldWidth - viewport.width) * item.parallax.numerator;
    check(item.width * item.parallax.denominator >= required, 'FINITE_COVERAGE');
    return { ...item, requiredWidth: { numerator: required, denominator: item.parallax.denominator },
      margin: { numerator: item.width * item.parallax.denominator - required, denominator: item.parallax.denominator },
      cameraLeftRange: { min: 0, max: 3072 }, repeatAxis: 'none', guarantee: 'declared-fixed-game-viewport-only' };
  });
  files.set('kit/kit.json', jsonBytes(kit));
  const report = seal({ format: 'ai_scene_review_candidate_readiness_v1', reviewId, author, sources, finiteCoverage,
    ...(grounded ? { layoutRevision } : {}),
    status: 'technical-review-candidate', missingArtwork: ['foreground-foliage'],
    excludedArtwork: [{ role: 'foreground-foliage', reason: 'real-visible-alpha-at-source-edge-no-preparation-approval' }],
    fullKitVisualAcceptance: 'not-assessed', terrainVisualAcceptance: 'not-assessed', loopingBackground: 'not-certified',
    physicsAndWalkability: 'not-assessed', productionKit: false, generationCalls: 0 });
  files.set('readiness.json', jsonBytes(report));
  const bundle = seal({ format: 'ai_scene_review_candidate_bundle_v1', reviewId, baseCandidateSha256: base.bundle.sha256,
    kitSha256: hash(files.get('kit/kit.json')), readinessSha256: report.sha256,
    sourcePlanSha256s: sources.map(item => item.planSha256), productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
