import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as api from '../src/index.mjs';
import { setup, syntheticImage } from './helpers.mjs';
import * as fs from 'node:fs';
import { main } from '../ui-reference.mjs';

test('doctor and self-test are read-only, disclose readiness and perform zero compute', async () => {
  assert.equal((await main(['self-test'])).computeCalls, 0);
  const doctor = await main(['doctor']); assert.equal(doctor.computeCalls, 0);
  assert.equal(doctor.generation, 'external-adapter-required');
  assert.equal((await main(['presets'])).length, 6);
});
test('CLI rejects unknown and duplicate options and redacts raw filesystem diagnostics', async () => {
  await assert.rejects(main(['plan', '--provider', 'private']), /OPTION_INVALID/);
  await assert.rejects(main(['status', '--root', 'x', '--root', 'y']), /OPTION_INVALID/);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../ui-reference.mjs', import.meta.url)), 'status', '--root', 'Z:/private-home/secret-token'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.deepEqual(JSON.parse(result.stderr), { error: 'JSON_READ_FAILED' });
  assert.ok(!result.stderr.includes('secret-token'));
});

test('parallel CLI requests expose only one reservation; remaining CLI stages round-trip', async t => {
  const { root, temp } = await setup(t), plan = await main(['plan', '--root', root, '--panel', 'audio-settings']);
  await main(['authorize', '--root', root, '--run', plan.run, '--plan-sha256', plan.planSha256, '--approval', 'Test CLI approval.']);
  const cli = fileURLToPath(new URL('../ui-reference.mjs', import.meta.url));
  const reserve = () => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, 'request', '--root', root, '--run', plan.run]); let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const results = await Promise.all([reserve(), reserve()]);
  assert.equal(results.filter(result => result.code === 0).length, 1);
  const request = JSON.parse(results.find(result => result.code === 0).stdout);
  const image = path.join(temp, 'result.png'); fs.writeFileSync(image, syntheticImage());
  const result = await main(['receive', '--root', root, '--run', plan.run, '--request-sha256', request.requestSha256, '--image', image]);
  await main(['review', '--root', root, '--run', plan.run, '--image-sha256', result.imageSha256,
    '--layout', 'pass', '--style', 'pass', '--copy', 'pass', '--decision', 'accept', '--note', 'Synthetic CLI review.']);
  const output = path.join(temp, 'cli-delivery'); await main(['export', '--root', root, '--output', output]);
  assert.equal((await main(['validate', '--delivery', output])).status, 'valid');
});
