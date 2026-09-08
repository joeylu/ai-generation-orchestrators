import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixtureDocument } from '../src/fixtures.ts';
import { compileMotionSystem } from '../src/motion-system.ts';
import { previewUrl, validateRunManifest, readLocalResource } from '../scripts/workflow-run.mjs';

const document = fixtureDocument('gallery');
const compiled = { document, motionSystem: compileMotionSystem({ id: 'test-system', style: 'premium', targets: ['confirm'] }, document) };
const manifest = () => ({ runVersion: '0.1', workflow: {}, resources: [],
  provenance: { kind: 'programmatic-fixture', description: 'Workflow test' },
  checks: [{ kind: 'motion', targetId: 'confirm', action: 'press', verifyPixels: true }] });

test('workflow browser URL rejects remote origins, credentials, and ambiguous local names', () => {
  assert.equal(previewUrl('http://127.0.0.1:4173/').origin, 'http://127.0.0.1:4173');
  assert.equal(previewUrl('http://[::1]:4173/').hostname, '[::1]');
  for (const value of ['https://127.0.0.1/', 'http://localhost/', 'http://example.com/', 'http://127.0.0.1/?token=secret',
    'http://user:password@127.0.0.1/', 'file:///example', 'http://127.0.0.1/#secret']) assert.throws(() => previewUrl(value));
});
test('workflow check validation rejects stale bindings and unspecified outcomes before launching a browser', () => {
  assert.equal(validateRunManifest(manifest(), compiled).checks.length, 1);
  const rejected = [
    { ...manifest(), checks: [] },
    { ...manifest(), ignored: true },
    { ...manifest(), checks: [{ kind: 'motion', targetId: 'sound', action: 'change', verifyPixels: false }] },
    { ...manifest(), checks: [{ kind: 'motion', targetId: 'confirm', action: 'press' }] },
    { ...manifest(), checks: [{ kind: 'click', targetId: 'confirm' }] },
    { ...manifest(), checks: [{ kind: 'click', targetId: 'confirm', expectActivations: -1 }] },
    { ...manifest(), checks: [{ kind: 'click', targetId: 'confirm', xRatio: 2, expectActivations: 1 }] },
    { ...manifest(), checks: [{ kind: 'timeline', time: 120, verifyPixels: false }] },
    { ...manifest(), resources: [{ path: 'image.png', file: 'https://example.com/remote.png', mime: 'image/png' }] },
  ];
  for (const candidate of rejected) assert.throws(() => validateRunManifest(candidate, compiled));
});
test('manifest resources cannot escape their directory, use links, or exceed byte caps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-workflow-paths-'));
  const local = join(root, 'manifest'); await mkdir(local);
  await writeFile(join(local, 'image.bin'), new Uint8Array([1, 2, 3]));
  await writeFile(join(root, 'outside.bin'), 'outside');
  assert.deepEqual(await readLocalResource(local, 'image.bin', 3), new Uint8Array([1, 2, 3]));
  for (const file of ['../outside.bin', '/outside.bin', 'C:/outside.bin', 'dir/../../outside.bin', 'dir\\outside.bin']) {
    assert.throws(() => validateRunManifest({ ...manifest(), resources: [{ path: 'image.bin', file, mime: 'application/octet-stream' }] }, compiled));
    await assert.rejects(readLocalResource(local, file, 100));
  }
  await assert.rejects(readLocalResource(local, 'image.bin', 2), /size|limit/);
  await symlink(root, join(local, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readLocalResource(local, 'linked/outside.bin', 100), /links/);
});
function run(...args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/cli.mjs', import.meta.url)), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
}
test('unified CLI stops before browser on invalid contracts, records failure, and refuses rerun output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ui-workflow-'));
  const filename = join(root, 'run.json'), output = join(root, 'result');
  await writeFile(filename, JSON.stringify(manifest()));
  const args = ['run', filename, '--preview-url', 'http://127.0.0.1:1/', '--output', output];
  const failed = await run(...args);
  assert.notEqual(failed.code, 0, failed.output);
  const original = await readFile(join(output, 'run-report.json'), 'utf8');
  const report = JSON.parse(original);
  assert.equal(report.status, 'FAIL');
  assert.equal(report.stages.at(-1).name, 'component-and-motion-contracts');
  assert.equal(report.humanVisualReview, 'NOT_RUN');
  assert.deepEqual(await readdir(output), ['run-report.json']);
  assert.equal(original.includes(root), false);
  assert.notEqual((await run(...args)).code, 0);
  assert.equal(await readFile(join(output, 'run-report.json'), 'utf8'), original);
});
