import { createSceneSemantics } from './semantics.mjs';
import { check, clone, contract, digest, exact, hash, id, jsonBytes, seal, unseal } from './generation/common.mjs';
import { deriveSnowSurface, SNOW_SURFACE_SHA256 } from './terrain-proof/snow-surface.mjs';

// Recompose a verified source candidate with explicit authoring/runtime data.
// Frozen source assembly and every PNG byte remain replayable without this step.
export function sourceCompositionFiles(base, plan) {
  const body = unseal(plan);
  const surfaceRevision = body.format === 'ai_scene_source_composition_plan_v2';
  exact(body, ['format', 'studyId', 'sourceBatchSha256', 'baseCandidateId', 'baseBundleSha256', 'moduleStyles', 'terrainTint', 'map', ...(surfaceRevision ? ['terrainSurface'] : [])]);
  check(surfaceRevision || body.format === 'ai_scene_source_composition_plan_v1', 'COMPOSITION_PLAN'); id(body.studyId);
  check(body.studyId.length <= 60 && base.bundle.format === 'ai_scene_source_candidate_bundle_v1'
    && body.baseBundleSha256 === base.bundle.sha256 && body.sourceBatchSha256 === base.bundle.batchSha256
    && body.baseCandidateId === base.bundle.candidateId, 'COMPOSITION_SOURCE_BINDING');
  const files = new Map([...base.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  const originalKit = JSON.parse(files.get('kit/kit.json'));
  check(originalKit.format === 'ai_scene_kit_v4', 'COMPOSITION_KIT');
  const kit = clone(originalKit), kitRef = { kitId: body.studyId, revision: 'composition-study-v1' };
  const read = ref => JSON.parse(files.get(`kit/${ref.path}`));
  const catalog = read(kit.files.catalog), rules = read(kit.files.rules), library = read(kit.files.presets);
  const originalMap = read(kit.files.maps.default), inspection = read(kit.files.maps.inspection), map = clone(body.map);
  check(digest(map.kitRef) === digest(kitRef) && digest(map.bounds) === digest(originalMap.bounds)
    && digest(map.defaultCamera) === digest(originalMap.defaultCamera) && digest(map.rulesRef) === digest(originalMap.rulesRef), 'COMPOSITION_MAP_BINDING');
  check(Array.isArray(body.moduleStyles) && body.moduleStyles.length <= catalog.modules.length, 'COMPOSITION_STYLES');
  const seen = new Set(), changedStyles = [];
  for (const change of body.moduleStyles) {
    exact(change, ['assetId', 'renderStyle']);
    const module = catalog.modules.find(item => item.assetId === change.assetId);
    check(module?.kind === 'environment' && !seen.has(change.assetId), 'COMPOSITION_STYLE_TARGET'); seen.add(change.assetId);
    if (module.terrainSkin) check(digest(change.renderStyle.scale) === digest(module.renderStyle.scale), 'COMPOSITION_PLATFORM_SCALE');
    changedStyles.push({ assetId: change.assetId, before: module.renderStyle ?? null, after: clone(change.renderStyle) });
    module.renderStyle = clone(change.renderStyle);
  }
  check(body.terrainTint === null || Number.isInteger(body.terrainTint) && body.terrainTint >= 0 && body.terrainTint <= 0xffffff, 'COMPOSITION_TERRAIN_TINT');
  if (body.terrainTint !== null) kit.terrainAppearance.tint = body.terrainTint;
  let terrainRevision = null; const permittedPngChanges = new Set();
  if (surfaceRevision) {
    exact(body.terrainSurface, ['profileSha256', 'sourceSha256']);
    const raw = files.get('source/material.png');
    check(body.terrainSurface.profileSha256 === SNOW_SURFACE_SHA256 && hash(raw) === body.terrainSurface.sourceSha256
      && kit.terrainAppearance.sourceSha256 === body.terrainSurface.sourceSha256, 'COMPOSITION_SURFACE_BINDING');
    const surface = deriveSnowSurface(raw); terrainRevision = surface.report;
    for (const [path, bytes] of surface.files) {
      const target = path.startsWith('tiles/') ? `kit/assets/${path.slice(6)}` : path.startsWith('materials/') ? `kit/${path}` : `surface-proof/${path}`;
      if (files.has(target) && target !== 'kit/materials/body-field.png') permittedPngChanges.add(target);
      files.set(target, bytes);
    }
    for (const module of catalog.modules.filter(item => item.kind === 'terrain')) {
      const bytes = files.get(`kit/${module.source.path}`); module.source.sha256 = hash(bytes); module.source.byteLength = bytes.length;
    }
    kit.terrainAppearance = { ...kit.terrainAppearance, format: 'ai_scene_continuous_terrain_appearance_v3',
      profileSha256: SNOW_SURFACE_SHA256, studySha256: surface.report.sha256,
      cap: { source: { path: 'materials/cap-field.png', sha256: hash(files.get('kit/materials/cap-field.png')),
        byteLength: files.get('kit/materials/cap-field.png').length }, pixelSize: { width: 505, height: 16 } } };
  }
  for (const doc of [catalog, rules, library, inspection]) doc.kitRef = kitRef;
  Object.assign(kit, kitRef);
  for (const [ref, doc] of [[kit.files.catalog, catalog], [kit.files.rules, rules], [kit.files.presets, library],
    [kit.files.maps.default, map], [kit.files.maps.inspection, inspection]]) {
    contract(doc); files.set(`kit/${ref.path}`, jsonBytes(doc));
  }
  kit.files = { catalog: kit.files.catalog, rules: kit.files.rules, presets: kit.files.presets, maps: kit.files.maps };
  for (const ref of [kit.files.catalog, kit.files.rules, kit.files.presets, ...Object.values(kit.files.maps)])
    ref.sha256 = hash(files.get(`kit/${ref.path}`));
  contract(kit);
  const semantics = createSceneSemantics({ kit, catalog, rules, library, artifacts: { presets: kit.files.presets.path } });
  const author = semantics.analyzeMap(map, { role: 'default', allowEmpty: false }).summary;
  semantics.analyzeMap(inspection, { role: 'inspection', allowEmpty: false });
  files.set('kit/kit.json', jsonBytes(kit));
  let preservedPngFiles = 0, changedPngFiles = 0;
  for (const [path, bytes] of base.files) if (path.endsWith('.png')) {
    if (files.get(path)?.equals(bytes)) preservedPngFiles++;
    else { check(permittedPngChanges.has(path), 'COMPOSITION_PNG_CHANGED'); changedPngFiles++; }
  }
  files.set('evidence/base-source-proof-bundle.json', jsonBytes(base.bundle));
  files.set('evidence/base-source-readiness.json', base.files.get('readiness.json'));
  files.set('evidence/composition-plan.json', jsonBytes(plan));
  const report = seal({ format: 'ai_scene_source_composition_readiness_v1', studyId: body.studyId,
    batchSha256: body.sourceBatchSha256, sourceCandidateBundleSha256: base.bundle.sha256, compositionPlanSha256: plan.sha256,
    moduleCount: catalog.modules.length, requiredSourceCount: base.report.requiredSourceCount,
    sourceEvidence: clone(base.report.sourceEvidence), author, changedStyles, preservedPngFiles,
    scope: surfaceRevision ? 'one-screen-layout-and-derived-snow-surface-study' : 'one-screen-layout-and-render-style-study',
    allPngBytesPreserved: changedPngFiles === 0, ...(surfaceRevision ? { changedPngFiles, allSourceAndEnvironmentPngBytesPreserved: true, terrainRevisionSha256: terrainRevision.sha256 } : {}), geometryAcceptance: 'not-assessed',
    fullKitVisualAcceptance: 'not-assessed', productionKit: false, generationCalls: 0 });
  files.set('readiness.json', jsonBytes(report)); files.delete('proof-bundle.json');
  const bundle = seal({ format: 'ai_scene_source_composition_bundle_v1', studyId: body.studyId,
    batchSha256: body.sourceBatchSha256, parentBundleSha256: base.bundle.sha256, compositionPlanSha256: plan.sha256,
    kitSha256: hash(files.get('kit/kit.json')), readinessSha256: report.sha256,
    productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
