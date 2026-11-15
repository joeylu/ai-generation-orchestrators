import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pipeline from '../src/pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import { sourceCompositionFiles } from '../src/source-composition.mjs';
import { encodeFixturePng } from '../src/png.mjs';
import { hash, jsonBytes, seal, unseal } from '../src/generation/common.mjs';
import { decision } from './helpers/generation.mjs';
import { SNOW_SURFACE_SHA256 } from '../src/terrain-proof/snow-profile.mjs';
import { loadSceneKit } from '../src/kit.mjs';
import { compileMap } from '../src/compile.mjs';
import { readMap } from '../src/kit.mjs';

let opaque, transparent;
function fixture(alpha) {
  if (alpha ? transparent : opaque) return alpha ? transparent : opaque;
  const width = 1024, height = 576, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha && (x < 100 || x > 920 || y < 80 || y > 530)) continue;
    rgba.set([65 + x % 120, 85 + y % 110, 140, 255], (y * width + x) * 4);
  }
  const bytes = encodeFixturePng(width, height, rgba); if (alpha) transparent = bytes; else opaque = bytes; return bytes;
}
const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(issue => issue.code === code));

test('explicit composition preserves every PNG and generation state, validates geometry/styles, and exports a separately replayable kit', { timeout: 240000 }, async t => {
  const parent = mkdtempSync(join(tmpdir(), 'scene-composition-')); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'project'), workflow = join(root, 'workflow');
  pipeline.initScenePipeline(root, { projectId: 'composition.test', description: 'Synthetic snowy side-view scene.', inputs: [],
    style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } }, { purpose: 'synthetic-simulation' });
  let state = pipeline.inspectScenePipeline(root);
  state = pipeline.reviewPipelineDesign(root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  flow.authorizePlan(workflow, state.reference.planSha256, decision('ref.compute', state.reference.planSha256, 'approve-compute'));
  const { request: _req, ...ticket } = flow.reservePlan(workflow, state.reference.planSha256);
  const reference = flow.receiveResult(workflow, ticket, fixture(false));
  state = pipeline.reviewPipelineImage(root, state.reference.planSha256, decision('ref.art', reference.rawSha256));
  pipeline.authorizePipelineStage(root, decision('source.compute', state.activeSourceBatchSha256, 'approve-compute'));
  const calls = []; state = await pipeline.runScenePipeline(root, { async preflight() {}, async generate(input) {
    calls.push(input.planSha256); return fixture(input.request.output.alpha === 'transparent');
  } });
  const baseRoot = join(parent, 'base'), baseId = 'composition.test.kit';
  const bundle = flow.buildSceneSourceCandidate(workflow, state.activeSourceBatchSha256, baseId, baseRoot);
  const files = new Map(bundle.artifacts.map(item => [item.path, readFileSync(join(baseRoot, item.path))]));
  files.set('proof-bundle.json', readFileSync(join(baseRoot, 'proof-bundle.json')));
  const base = { files, bundle, report: JSON.parse(files.get('readiness.json')) };
  const originalMap = readFileSync(join(baseRoot, 'kit/maps/default.scene.json'));
  const map = JSON.parse(originalMap); map.mapId = 'composition.study.default'; map.kitRef = { kitId: 'composition.study', revision: 'composition-study-v1' };
  map.instances.find(item => item.assetId === 'scene.structure-a').x += 20;
  const style = { scale: { numerator: 1, denominator: 2 }, tint: 0xdce8ff, opacity: 0.8 };
  const body = { format: 'ai_scene_source_composition_plan_v1', studyId: 'composition.study', sourceBatchSha256: state.activeSourceBatchSha256,
    baseCandidateId: baseId, baseBundleSha256: bundle.sha256, moduleStyles: [{ assetId: 'scene.middle-scenery', renderStyle: style }], terrainTint: null, map };
  const plan = seal(body), events = flow.inspectWorkflow(workflow).eventCount;
  const prepared = sourceCompositionFiles(base, plan);
  for (const [path, bytes] of files) if (path.endsWith('.png')) assert.ok(prepared.files.get(path).equals(bytes));
  assert.equal(prepared.report.generationCalls, 0); assert.equal(prepared.report.allPngBytesPreserved, true);
  const reseal = changes => seal({ ...body, ...changes });
  rejects(() => sourceCompositionFiles(base, reseal({ baseBundleSha256: 'a'.repeat(64) })), 'COMPOSITION_SOURCE_BINDING');
  rejects(() => sourceCompositionFiles(base, reseal({ moduleStyles: [body.moduleStyles[0], body.moduleStyles[0]] })), 'COMPOSITION_STYLE_TARGET');
  rejects(() => sourceCompositionFiles(base, reseal({ moduleStyles: [{ assetId: 'r0-blob-000', renderStyle: style }] })), 'COMPOSITION_STYLE_TARGET');
  rejects(() => sourceCompositionFiles(base, reseal({ moduleStyles: [{ assetId: 'scene.platform', renderStyle: style }] })), 'COMPOSITION_PLATFORM_SCALE');
  const invalidMap = structuredClone(map); invalidMap.instances[0].x = 99999;
  rejects(() => sourceCompositionFiles(base, reseal({ map: invalidMap })), 'INSTANCE_OUT_OF_BOUNDS');
  rejects(() => sourceCompositionFiles(base, reseal({ terrainTint: -1 })), 'COMPOSITION_TERRAIN_TINT');
  const out = join(parent, 'delivery'), report = pipeline.deliverSceneComposition(root, plan, out);
  assert.equal(pipeline.verifySceneCompositionDelivery(root, out).sha256, report.sha256);
  assert.equal(report.productionKit, false); assert.equal(report.generationCalls, 0);
  assert.equal(JSON.parse(readFileSync(join(out, 'candidate/kit/catalog.json'))).modules.find(m => m.assetId === 'scene.middle-scenery').renderStyle.opacity, 0.8);
  assert.ok(readFileSync(join(baseRoot, 'kit/maps/default.scene.json')).equals(originalMap));
  assert.equal(flow.inspectWorkflow(workflow).eventCount, events); assert.equal(calls.length, 11);
  const stored = JSON.parse(readFileSync(join(out, 'composition-plan.json')));
  writeFileSync(join(out, 'composition-plan.json'), jsonBytes(reseal({ terrainTint: 0xffffff })));
  rejects(() => pipeline.verifySceneCompositionDelivery(root, out), 'COMPOSITION_DELIVERY_IDENTITY');
  writeFileSync(join(out, 'composition-plan.json'), jsonBytes(stored));
  assert.equal(hash(files.get('source/reference.png')), hash(readFileSync(join(out, 'candidate/source/reference.png'))));
  const snowPlan = seal({ ...body, format: 'ai_scene_source_composition_plan_v2',
    terrainSurface: { profileSha256: SNOW_SURFACE_SHA256, sourceSha256: hash(files.get('source/material.png')) } });
  const snowOut = join(parent, 'snow'), snowReport = pipeline.deliverSceneComposition(root, snowPlan, snowOut);
  assert.equal(pipeline.verifySceneCompositionDelivery(root, snowOut).sha256, snowReport.sha256);
  const snowKit = loadSceneKit(join(snowOut, 'candidate/kit')), scene = compileMap(snowKit, readMap(snowKit));
  assert.equal(scene.terrainMaterial.cap.pixelSize.height, 16); assert.equal(scene.mixedTerrains[0].profile.capWidth, 16);
  assert.deepEqual(scene.collisionSuggestions, compileMap(loadSceneKit(join(out, 'candidate/kit')), map).collisionSuggestions);
  const ready = JSON.parse(readFileSync(join(snowOut, 'candidate/readiness.json')));
  assert.equal(ready.allSourceAndEnvironmentPngBytesPreserved, true); assert.equal(ready.allPngBytesPreserved, false);
  rejects(() => sourceCompositionFiles(base, seal({ ...unseal(snowPlan), terrainSurface: { ...snowPlan.terrainSurface, sourceSha256: 'a'.repeat(64) } })), 'COMPOSITION_SURFACE_BINDING');
  const kitPath = join(snowOut, 'candidate/kit/kit.json'), kitBody = JSON.parse(readFileSync(kitPath));
  kitBody.terrainAppearance.format = 'ai_scene_continuous_terrain_appearance_v2'; writeFileSync(kitPath, jsonBytes(kitBody));
  rejects(() => loadSceneKit(join(snowOut, 'candidate/kit')), 'APPEARANCE_PROFILE');
  assert.equal(flow.inspectWorkflow(workflow).eventCount, events); assert.equal(calls.length, 11);
  const current = flow.getSceneSourceBatch(workflow, state.activeSourceBatchSha256);
  const alternative = flow.reviseSceneSourceBatch(workflow, current.sha256, { batchId: 'source.alternative', replacements:
    ['distant-scenery', 'far-structure'].map(slot => ({ slot, planId: `alternative.${slot}`, sourceCompiler: 'alternative-role-v1',
      intent: 'Only this isolated role, with transparent gaps and no mountains.',
      subjectBrief: { content: slot === 'distant-scenery' ? 'A low distant snow-covered pine treeline.' : 'A complete stone castle and its narrow bridge with open arches.',
        exclusions: ['mountain ranges', 'cliffs', 'sky', 'neighboring scene layers'] } })) });
  assert.equal(alternative.newImageRequests, 2);
  for (const [index, sha] of alternative.planSha256s.entries()) {
    if (![3, 4].includes(index)) assert.equal(sha, current.planSha256s[index]);
    else {
      const candidate = flow.getGenerationPlan(workflow, sha);
      assert.equal(candidate.format, 'ai_scene_generation_plan_v14'); assert.match(candidate.request.prompt, /at least 15 percent/);
      assert.equal(candidate.sourceScope.predecessorArtDecisionUnchanged, true);
      assert.equal(flow.getGenerationResult(workflow, current.planSha256s[index]).status, 'pending-visual-review');
      rejects(() => flow.reservePlan(workflow, sha), 'AUTHORIZATION_REQUIRED');
    }
  }
  flow.authorizeSceneSourceBatch(workflow, alternative.sha256, decision('alternative.compute', alternative.sha256, 'approve-compute'));
  const { request: unusedRequest, ...attempt } = flow.reservePlan(workflow, alternative.planSha256s[3]);
  flow.stopAttempt(workflow, attempt, 'indeterminate');
  rejects(() => flow.reservePlan(workflow, alternative.planSha256s[3]), 'RESERVATION_STATE');
  assert.equal(flow.getGenerationResult(workflow, current.planSha256s[3]).status, 'pending-visual-review');
});
