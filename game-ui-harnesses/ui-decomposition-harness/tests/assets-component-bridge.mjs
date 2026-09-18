// Offline integration: consume the real Python ZIP through the official CLI.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBundle, validateBundle, bundleResources } from '../../ui-component-harness/src/bundle.ts';
import { appearanceDocumentSha256 } from '../../ui-component-harness/src/appearance-binding.ts';
import { importDecompositionZip } from '../../ui-component-harness/src/decomposition-import.ts';

const [archivePath, output] = process.argv.slice(2);
const imported = await importDecompositionZip(new Uint8Array(await readFile(archivePath)));
const style = { backgroundColor: '#17314a', borderColor: '#17314a', borderWidth: 0,
  cornerRadius: 0, textColor: '#ffffff', fontFamily: 'sans-serif', fontSize: 6,
  fontWeight: 'normal', opacity: 1 };
const document = { schemaVersion: '0.2', id: 'assets-bridge-fixture', canvas: { width: 64, height: 48 },
  root: { id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 64, height: 48 }, props: { style },
    children: [4, 36].map((x, index) => ({ id: `button-${index}`, type: 'Button',
      layout: { x, y: 30, width: 20, height: 12 }, props: { style, label: 'OK', enabled: true }, children: [] })) } };
const target = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Offline independent assets bridge fixture.' });
const binding = { kind: 'ui-appearance-binding', version: '0.2',
  documentSha256: await appearanceDocumentSha256(document), archiveSha256: imported.archiveSha256,
  deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256,
  registration: { sourceCanvas: document.canvas, targetCanvas: document.canvas, transform: { scale: 1, offset: { x: 0, y: 0 } } },
  bindings: ['button_one', 'button_two'].map((layerId, index) => ({ componentId: `button-${index}`,
    componentType: 'Button', parts: [{ role: 'background', layerId }],
    states: { button: { labelLayout: { coordinateSpace: 'target-component-local', x: 2, y: 2, width: 16, height: 8 } } } })) };
const targetPath = join(output, 'target.json'), bindingPath = join(output, 'binding.json'), resultPath = join(output, 'built.json');
await writeFile(targetPath, JSON.stringify(target));
await writeFile(bindingPath, JSON.stringify(binding));
const cli = fileURLToPath(new URL('../../ui-component-harness/scripts/cli.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000, cwd: output });
const built = run('assets-build', archivePath, targetPath, bindingPath, '--output', resultPath);
assert.equal(built.status, 0, built.stdout + built.stderr);
const disclosure = JSON.parse(built.stderr.trim());
assert.equal(disclosure.upstreamReview.humanVisualAcceptance, false);
assert.equal(disclosure.visualComparisonReady, false);
const bundle = await validateBundle(JSON.parse(await readFile(resultPath, 'utf8')));
const resources = bundleResources(bundle);
for (const layer of imported.layers.filter(layer => layer.id.startsWith('button_'))) {
  const resource = resources.find(row => row.path.endsWith(`/${layer.id}.png`));
  assert.ok(resource);
  assert.deepEqual(resource.bytes, imported.resources.find(row => row.path === layer.path).bytes);
}
assert.equal(run('validate', resultPath).status, 0);
const before = await readFile(resultPath);
assert.notEqual(run('assets-build', archivePath, targetPath, bindingPath, '--output', resultPath).status, 0);
assert.deepEqual(await readFile(resultPath), before);
binding.bindings.pop();
await writeFile(bindingPath, JSON.stringify(binding));
const rejected = run('assets-build', archivePath, targetPath, bindingPath, '--output', join(output, 'missing.json'));
assert.notEqual(rejected.status, 0);
assert.match(rejected.stderr, /INTERACTIVE_BINDING_REQUIRED/);
await assert.rejects(readFile(join(output, 'missing.json')));
console.log(JSON.stringify({ status: 'passed', layers: imported.layers.length, boundComponents: 2,
  runtimeAcceptance: 'not_run', humanVisualAcceptance: false }));
