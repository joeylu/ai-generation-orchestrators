import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixtureDocument, fixtureInputs } from '../src/fixtures.ts';
import { walkNodes } from '../src/tree-contract.ts';
import { compileMotionSystem, type MotionStyle } from '../src/motion-system.ts';
import { createBundle, validateBundle, bundleResources } from '../src/bundle.ts';

const document = fixtureDocument('gallery');
const targets = walkNodes(document).map(node => node.id);
const provenance = { kind: 'programmatic-fixture' as const, description: 'Motion system IO fixture; no provider called.' };
const resources = await Promise.all(['plate.svg', 'gem.svg'].map(async name => ({ path: `fixtures/${name}`, mime: 'image/svg+xml', bytes: new Uint8Array(await readFile(new URL(`../public/fixtures/${name}`, import.meta.url))) })));
for (const style of ['playful', 'premium', 'corporate'] as MotionStyle[]) test(`${style}: motion system and timeline round trip together without losing bindings or bytes`, async () => {
  const system = compileMotionSystem({ id: `test-${style}`, style, targets }, document);
  const timeline = fixtureInputs('gallery').motion;
  const before = structuredClone({ document, system, timeline });
  const bundle = await createBundle(document, resources, provenance, timeline, system);
  assert.equal(bundle.bundleVersion, '0.2');
  const reloaded = await validateBundle(JSON.parse(JSON.stringify(bundle)));
  assert.deepEqual(reloaded.motionSystem, system); assert.deepEqual(reloaded.motion, timeline);
  assert.deepEqual({ document, system, timeline }, before);
  assert.equal(new Set(reloaded.motionSystem!.bindings.map(binding => binding.componentType)).size, 16);
  assert.deepEqual(bundleResources(reloaded).map(item => item.bytes), resources.map(item => item.bytes));
  assert.throws(() => { reloaded.motionSystem!.style = 'invalid' as MotionStyle; }, TypeError);
});

test('bundle rejects downgraded, missing, unsupported and stale system declarations', async () => {
  const system = compileMotionSystem({ id: 'strict', style: 'premium', targets }, document);
  const bundle = await createBundle(document, resources, provenance, undefined, system);
  await assert.rejects(validateBundle({ ...bundle, bundleVersion: '0.1' }), /BUNDLE_VERSION_REQUIRED/);
  const missing: any = structuredClone(bundle); delete missing.motionSystem;
  await assert.rejects(validateBundle(missing), /REQUIRED/);
  const unknown: any = structuredClone(bundle); unknown.motionSystem.style = 'unknown';
  await assert.rejects(validateBundle(unknown));
  const stale: any = structuredClone(bundle); stale.motionSystem.bindings[0].targetId = 'missing';
  await assert.rejects(validateBundle(stale));
  const old = await createBundle(document, resources, provenance);
  assert.equal(old.bundleVersion, '0.1'); assert.equal(old.motionSystem, undefined);
});

test('motion system CLI catalog, compilation, validation, pack and unpack are executable offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ui-motion-system-'));
  const cli = fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url));
  const motionCli = fileURLToPath(new URL('../scripts/motion-cli.mjs', import.meta.url));
  const run = (executable: string, ...args: string[]) => spawnSync(process.execPath, [executable, ...args], { cwd: directory, encoding: 'utf8', timeout: 15000 });
  const success = (executable: string, ...args: string[]) => { const result = run(executable, ...args); assert.equal(result.status, 0, result.stderr); return result.stdout ? JSON.parse(result.stdout) : undefined; };
  const catalog = success(motionCli, 'catalog');
  assert.deepEqual(Object.keys(catalog.profiles).sort(), ['corporate', 'playful', 'premium']); assert.equal(catalog.components.length, 16);
  await writeFile(join(directory, 'ui.json'), JSON.stringify(document));
  await writeFile(join(directory, 'request.json'), JSON.stringify({ id: 'cli-system', style: 'corporate', targets }));
  success(motionCli, 'system', 'request.json', 'ui.json', '--output', 'system.json');
  assert.equal(success(motionCli, 'validate-system', 'system.json', 'ui.json').bindings, targets.length);
  assert.notEqual(run(motionCli, 'system', 'request.json', 'ui.json', '--output', 'system.json').status, 0);
  for (const item of resources) await writeFile(join(directory, item.path.split('/')[1]), item.bytes);
  success(cli, 'pack', 'ui.json', '--resource', 'fixtures/plate.svg=plate.svg', '--resource', 'fixtures/gem.svg=gem.svg', '--provenance-kind', provenance.kind, '--provenance-description', provenance.description, '--motion-system', 'system.json', '--output', 'bundle.json');
  assert.equal(JSON.parse(await readFile(join(directory, 'bundle.json'), 'utf8')).bundleVersion, '0.2');
  success(cli, 'validate', 'bundle.json');
  assert.equal(success(cli, 'unpack', 'bundle.json', 'restored').motionSystem, true);
  assert.equal(success(motionCli, 'validate-system', 'restored/ui-motion-system.json', 'restored/ui-document.json').style, 'corporate');
  const wrong: any = JSON.parse(await readFile(join(directory, 'system.json'), 'utf8')); wrong.bindings[0].componentType = 'Wrong';
  await writeFile(join(directory, 'invalid-system.json'), JSON.stringify(wrong));
  const failed = run(motionCli, 'validate-system', 'invalid-system.json', 'ui.json');
  assert.notEqual(failed.status, 0); assert.equal(failed.stdout, '');
});

test('unpack refuses a case-variant system metadata resource before writing any payload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ui-motion-metadata-'));
  const ui = structuredClone(document);
  for (const node of walkNodes(ui)) if (node.type === 'Image' && node.props.source === 'fixtures/plate.svg') node.props.source = 'UI-MOTION-SYSTEM.JSON';
  const system = compileMotionSystem({ id: 'metadata-collision', style: 'premium', targets }, ui);
  const inputs = resources.map(resource => resource.path === 'fixtures/plate.svg' ? { ...resource, path: 'UI-MOTION-SYSTEM.JSON' } : resource);
  const bundle = await createBundle(ui, inputs, provenance, undefined, system);
  await writeFile(join(directory, 'bundle.json'), JSON.stringify(bundle));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url)), 'unpack', 'bundle.json', 'out'], { cwd: directory, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /conflicts with unpack metadata/);
  assert.equal(result.stdout, ''); assert.deepEqual(await readdir(join(directory, 'out')), []);
});
