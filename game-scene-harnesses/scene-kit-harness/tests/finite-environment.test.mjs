import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as api from '../src/generation/index.mjs';
import { loadSceneKit, readMap } from '../src/kit.mjs';
import { compileMap } from '../src/compile.mjs';
import { validateBundle } from '../src/validate.mjs';
import { layerOffset } from '../src/pixi/projection.mjs';
import { prepareFiniteEnvironment } from './helpers/finite-environment.mjs';
import { fixtureRoot } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
test('finite demo requires source acceptance, preserves failed repeat evidence and makes a validated independent kit', t => {
  const c = prepareFiniteEnvironment(t), out = join(c.parent, 'finite');
  rejects(() => api.buildFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit, c.options, out), 'ENVIRONMENT_SOURCE_ACCEPTANCE_REQUIRED');
  assert.equal(existsSync(out), false); c.accept(); const before = api.inspectWorkflow(c.root);
  const bundle = api.buildFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit, c.options, out);
  assert.equal(bundle.productionKit, false); assert.equal(bundle.visualAcceptance, 'not-assessed'); assert.equal(bundle.generationCalls, 0);
  assert.equal(bundle.originalRepeatProofStatus, 'blocked-seam'); assert.equal(bundle.repeatingSeam.status, 'fail'); assert.equal(bundle.loopingCertified, false);
  assert.deepEqual(api.inspectWorkflow(c.root), before); assert.deepEqual(readFileSync(join(out, 'source/original.png')), c.raw);
  assert.equal(validateBundle(join(out, 'kit')).ok, true);
  const kit = loadSceneKit(join(out, 'kit')), map = readMap(kit), scene = compileMap(kit, map);
  assert.equal(kit.purpose, 'art-candidate'); assert.notEqual(kit.bundleSha256, c.kit.bundleSha256);
  assert.equal(map.bounds.width, 64); assert.equal(scene.counts.terrainNodes, 99); assert.equal(scene.counts.visualNodes, 2);
  const layer = scene.layers.find(layer => layer.layerId === 'far-mountains'), node = layer.nodes[0];
  assert.equal(layer.parallax.x, .15); assert.equal(node.kind, 'sprite'); assert.equal(node.repeat, undefined);
  const coverage = api.verifyFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit, c.options, out).coverage;
  assert.deepEqual(coverage.requiredWidth, { numerator: 148480, denominator: 100 });
  assert.deepEqual(coverage.rightMargin, { numerator: 5120, denominator: 100 });
  const optionsFile = join(c.parent, 'options.json'); writeFileSync(optionsFile, JSON.stringify(c.options));
  const cli = spawnSync(process.execPath, ['scripts/workflow.mjs', 'verify-finite-environment-demo', '--root', c.root, '--plan', c.plan.sha256,
    '--kit', fixtureRoot, '--file', optionsFile, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).result.loopingCertified, false);
  for (const x of [0, 768, 1536, 2304, 3072]) {
    const offset = layerOffset({ x: x + 512, y: 288 }, scene.defaultCamera.center, layer.parallax, true);
    const left = node.position.x + offset.x - x;
    assert.ok(left <= 0 && left + node.size.width >= 1024);
  }
  const png = join(out, 'kit/assets/finite-mountains.png'); writeFileSync(png, Buffer.alloc(10));
  rejects(() => api.verifyFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit, c.options, out), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.equal(validateBundle(join(out, 'kit')).ok, false);
});

test('finite demo rejects unsupported coverage and stale artwork before writing any output', t => {
  const c = prepareFiniteEnvironment(t); c.accept(); const out = join(c.parent, 'bad');
  rejects(() => api.buildFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit,
    { ...c.options, parallax: { numerator: 1, denominator: 1 } }, out), 'FINITE_COVERAGE');
  assert.equal(existsSync(out), false);
  rejects(() => api.buildFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit,
    { ...c.options, parallax: { numerator: 0, denominator: 0 } }, out), 'FINITE_PARALLAX');
  rejects(() => api.buildFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit,
    { ...c.options, exampleId: 'a'.repeat(100) }, out), 'WORKFLOW_CONTRACT');
  assert.equal(existsSync(out), false);
  const style = api.createDesignDraft(c.root, { format: 'ai_scene_style_v1', styleId: 'new.style', mode: 'preset', name: 'New synthetic style', rules: ['Synthetic'], anchors: [] });
  api.reviewDesign(c.root, 'style', { decisionId: 'new.style.review', decision: 'accept', targetSha256: style.sha256, notes: 'Test double.' });
  assert.throws(() => api.buildFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit, c.options, out)); assert.equal(existsSync(out), false);
});
