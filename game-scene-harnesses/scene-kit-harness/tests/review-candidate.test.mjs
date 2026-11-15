import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareReviewCandidate } from './helpers/review-candidate.mjs';
import * as api from '../src/generation/index.mjs';
import { loadSceneKit, readMap, compileMap, exportScene, openSceneExport, validateBundle, validateDocument } from '../src/index.mjs';
import { hash, jsonBytes } from '../src/generation/common.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { decision } from './helpers/generation.mjs';

test('review candidate retains technical failures and pending art, finitely covers four screens, and exports all layers', t => {
  const c = prepareReviewCandidate(t), before = api.inspectWorkflow(c.root), bundle = c.buildReview();
  assert.deepEqual(api.inspectWorkflow(c.root), before); assert.equal(bundle.productionKit, false);
  const verification = api.verifySceneReviewCandidate(c.root, c.kit, c.reviewOptions, c.terrainRoots, c.reviewOut);
  assert.equal(verification.status, 'deterministic-proof-valid');
  const report = verification.readiness; assert.equal(report.sources.length, 5);
  assert.ok(report.sources.every(source => source.sourceArtAcceptance === 'pending-human-review'));
  assert.deepEqual(report.missingArtwork, ['foreground-foliage']); assert.equal(report.loopingBackground, 'not-certified');
  assert.equal(report.finiteCoverage.find(item => item.slot === 'forest').margin.numerator, 2048);
  assert.equal(report.layoutRevision, 'grounded-v3');
  const kitRoot = join(c.reviewOut, 'kit'), valid = validateBundle(kitRoot); assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.equal(valid.moduleCount, 758); const kit = loadSceneKit(kitRoot), map = readMap(kit), scene = compileMap(kit, map);
  assert.equal(scene.counts.visualNodes, 15); assert.equal(scene.counts.terrainNodes, 107);
  assert.equal(map.instances.find(item => item.instanceId === 'arch.1').x, 1450);
  assert.equal(map.instances.find(item => item.instanceId === 'arch.2').x, 3400);
  assert.equal(scene.layers.find(layer => layer.layerId === 'sky').parallax.x, 0);
  assert.ok(scene.layers.flatMap(layer => layer.nodes).filter(node => !node.cell).every(node => node.kind === 'sprite'));
  const exported = join(c.parent, 'review-export'); exportScene(kit, map, exported);
  assert.deepEqual(openSceneExport(exported).compiled, scene);
  const manifest = JSON.parse(readFileSync(join(kitRoot, 'kit.json'))), catalog = JSON.parse(readFileSync(join(kitRoot, manifest.files.catalog.path)));
  for (const slot of ['trees', 'arch', 'wall']) {
    const module = catalog.modules.find(item => item.assetId === `review-${slot}`), pixels = inspectPng(readFileSync(join(kitRoot, module.source.path)), { includePixels: true });
    let last = -1; for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) if (pixels.rgba[(y * pixels.width + x) * 4 + 3] >= 128) last = y;
    assert.equal(module.anchorPx.y, last); assert.equal(report.sources.find(item => item.slot === slot).derivedSha256, hash(readFileSync(join(kitRoot, module.source.path))));
  }
  assert.ok(validateDocument('ai_scene_module_catalog_v1', { ...catalog, format: 'ai_scene_module_catalog_v1' }).length);
  assert.equal(validateDocument('ai_scene_module_catalog_v2', catalog).length, 0);
  // Version 2's background has a stronger opacity contract, even with rebound file hashes.
  const background = catalog.modules.find(module => module.kind === 'background'), image = inspectPng(readFileSync(join(kitRoot, background.source.path)), { includePixels: true });
  image.rgba.fill(0, 0, 4); const bytes = encodeRgbaPng(image.width, image.height, image.rgba);
  writeFileSync(join(kitRoot, background.source.path), bytes); background.source.sha256 = hash(bytes); background.source.byteLength = bytes.length;
  const catalogBytes = jsonBytes(catalog); writeFileSync(join(kitRoot, manifest.files.catalog.path), catalogBytes);
  manifest.files.catalog.sha256 = hash(catalogBytes); writeFileSync(join(kitRoot, 'kit.json'), jsonBytes(manifest));
  assert.ok(validateBundle(kitRoot).errors.some(e => e.code === 'OPAQUE_REQUIRED'));
});

test('review assembly rejects swapped roles and rejected source art instead of silently displaying them', t => {
  const c = prepareReviewCandidate(t), swapped = structuredClone(c.reviewOptions);
  swapped.environmentSources.sky = swapped.environmentSources.trees;
  assert.throws(() => api.buildSceneReviewCandidate(c.root, c.kit, swapped, c.terrainRoots, join(c.parent, 'swapped')), error => error.errors.some(e => e.code === 'REVIEW_SOURCE_ROLE'));
  api.reviewResult(c.root, c.plans.sky.sha256, decision('sky.rejected', c.results.sky.rawSha256, 'reject'));
  assert.throws(() => c.buildReview(), error => error.errors.some(e => e.code === 'ENVIRONMENT_SOURCE_NOT_READY'));
});
