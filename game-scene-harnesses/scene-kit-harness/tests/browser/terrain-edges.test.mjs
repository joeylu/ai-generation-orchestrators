import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { setupTerrainEdgeDelivery } from '../helpers/terrain-edge-delivery.mjs';
import { buildTerrainEdgeDelivery } from '../../src/terrain-edge-pipeline.mjs';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { loadSceneKit, readMap } from '../../src/kit.mjs';
import { exportSceneArchive } from '../../src/persistence.mjs';
import { compileMap } from '../../src/compile.mjs';
import { inspectPng } from '../../src/png.mjs';
import { hash, jsonBytes } from '../../src/generation/common.mjs';
import { NEAR_OPAQUE_JOIN_PROFILE } from '../../src/terrain-edges.mjs';
import { dismissCanvasPanels, scenePixels } from './canvas-controls.mjs';

test('native side covers reach actual software WebGL through Studio asset snapshots and keep export/collision identity', { timeout: 300000 }, async t => {
  const fixture = setupTerrainEdgeDelivery(t);
  fixture.deliveryOptions.controls.left.corner.wallStartY += 6; // A half-world-pixel native corner join.
  fixture.deliveryOptions.controls.joinProfile = NEAR_OPAQUE_JOIN_PROFILE;
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) {
    const item = fixture.deliveryOptions.controls[side][part];
    item.inboardBlend = { fromX: item.innerX, toX: side === 'left' ? 276 : 12 };
  }
  const delivery = buildTerrainEdgeDelivery(fixture.deliveryOptions);
  const kitRoot = join(fixture.deliveryOptions.output, 'candidate/kit'), handle = loadSceneKit(kitRoot), map = readMap(handle);
  // Use an isolated synthetic author to observe both sides without scenery.
  map.terrainRuns = []; map.instances = []; map.assemblyInstances = [];
  map.curveTerrains = [{ curveId: 'two.sides', familyId: 'terrain.primary', profile: 'sideview-height-curve-v1',
    points: [{ x: 64, y: 48, slope: 0 }, { x: 128, y: 32, slope: 0 }, { x: 192, y: 48, slope: 0 }], baseY: 144 }];
  map.defaultCamera = { center: { x: 128, y: 72 }, viewport: { width: 256, height: 144 }, scale: 1 };
  const scene = compileMap(handle, map), zip = exportSceneArchive(handle, map), roots = process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean) ?? [];
  assert.equal(scene.terrainEdgePlacement.placed.length, 2); assert.equal(delivery.finalHumanArtReview, 'pending');
  assert.equal(scene.terrainMaterial.edges.format, 'ai_scene_terrain_edges_v3');
  assert(scene.curveTerrains.flatMap(curve => curve.edgeMeshes ?? []).some(piece => piece.coverageOpacity > 0 && piece.coverageOpacity < 1));
  const staticRoot = await buildStudio({ roots, output: join(fixture.parent, 'static') });
  const host = await startStudio({ root: kitRoot, staticRoot, initialDocument: map }); t.after(() => host.close());
  const { chromium } = dependency('playwright', roots).require('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.SCENE_KIT_BROWSER_CHANNEL ? { channel: process.env.SCENE_KIT_BROWSER_CHANNEL } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--explicitly-allowed-ports=' + new URL(host.url).port] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 }), errors = [], warnings = [], external = [], edgeRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
  page.on('response', response => { if (response.url().includes('/_terrain-edge-')) edgeRequests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== host.url) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(host.url); await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  await dismissCanvasPanels(page); await page.getByRole('checkbox', { name: '网格', exact: true }).uncheck();
  const pixels = inspectPng(await scenePixels(page), { includePixels: true }), counts = new Map();
  for (let p = 0; p < pixels.rgba.length; p += 4) {
    const key = [...pixels.rgba.subarray(p, p + 3)].join(','); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const rgb of ['140,75,35', '160,75,35', '140,90,35', '160,90,35']) assert((counts.get(rgb) ?? 0) > 8, `native ${rgb} edge paint must appear in actual Pixi pixels`);
  assert.equal(new Set(edgeRequests.map(item => item.path)).size, 4); assert(edgeRequests.every(item => item.status === 200));
  const before = await page.evaluate(async () => (await fetch('/api/state')).json());
  assert.equal(before.scene.contentSha256, scene.contentSha256); assert.deepEqual(before.scene.collisionSuggestions, scene.collisionSuggestions);
  const downloaded = Buffer.from(await page.evaluate(async () => [...new Uint8Array(await (await fetch('/api/export?revision=0')).arrayBuffer())]));
  assert.deepEqual(downloaded, zip);
  if (process.env.SCENE_KIT_SCREENSHOTS) {
    mkdirSync(process.env.SCENE_KIT_SCREENSHOTS, { recursive: true });
    const screenshot = await page.screenshot({ path: join(process.env.SCENE_KIT_SCREENSHOTS, 'terrain-edges-studio-synthetic.png'), fullPage: true });
    writeFileSync(join(process.env.SCENE_KIT_SCREENSHOTS, 'terrain-edges-browser-evidence.json'), jsonBytes({
      format: 'ai_scene_terrain_edge_browser_test_evidence_v1', synthetic: true, actualStudioScreenshot: true,
      softwareWebGL: true, generationCalls: 0, finalHumanArtReview: 'not-assessed',
      authorSha256: scene.source.authorSha256, compiledSha256: scene.contentSha256, screenshotSha256: hash(screenshot), browserZipSha256: hash(downloaded),
      browserZipEqualsCli: downloaded.equals(zip), collisionIdentityPreserved: true,
      terrainEdgeFormat: scene.terrainMaterial.edges.format, effectiveRenderAlpha: scene.terrainEdgePlacement.effectiveRenderAlpha,
      nativePaintPixelCounts: Object.fromEntries(['140,75,35', '160,75,35', '140,90,35', '160,90,35'].map(rgb => [rgb, counts.get(rgb)])),
      edgeRequests, errors, warnings, external,
    }));
  }
  assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(external, []);
});
