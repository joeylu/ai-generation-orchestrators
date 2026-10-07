import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, stat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, copy } from './helpers.mjs';
import { createOutputDirectory } from '../src/io.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (...args) => spawnSync(process.execPath, ['scripts/cli.mjs', ...args], { cwd: root, encoding: 'utf8' });
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'cli-'));

test('offline CLI validate and catalog search have no delivery side effects', () => {
  const checked = run('validate', 'examples/audio-settings.panel.json');
  assert.equal(checked.status, 0, checked.stderr); assert.equal(JSON.parse(checked.stdout).status, 'SPEC_VALID');
  const found = run('catalog', '--query', '音量'); assert.equal(found.status, 0, found.stderr);
  assert.equal(JSON.parse(found.stdout)[0].recipe.id, 'settings.slider');
  assert.notEqual(run('compile', 'examples/audio-settings.panel.json', '--unexpected', 'true').status, 0);
});

test('CLI creates separate compatible component output and verified panel envelope, refusing overwrite', async () => {
  const output = join(work, 'delivery');
  const result = run('compile', 'examples/audio-settings.panel.json', '--output', output);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(join(output, 'delivery.json'), 'utf8'));
  assert.equal(report.status, 'COMPLETE'); assert.equal(report.browser, 'NOT_RUN');
  for (const file of report.files) assert.equal(createHash('sha256').update(await readFile(join(output, file.path))).digest('hex'), file.sha256);
  const first = await readFile(join(output, 'panel.bundle.json'), 'utf8');
  const inspected = run('inspect', join(output, 'panel.bundle.json')); assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).state.volume, 80);
  const repeated = run('compile', 'examples/audio-settings.panel.json', '--output', output);
  assert.notEqual(repeated.status, 0); assert.equal(JSON.parse(repeated.stderr).code, 'OUTPUT_EXISTS');
  assert.equal(await readFile(join(output, 'panel.bundle.json'), 'utf8'), first);
});

test('CLI restore keeps authored initial data while saving explicit current state in a new delivery', async () => {
  const stateFile = join(work, 'state.json'); await writeFile(stateFile, JSON.stringify({ volume: 40, audioEnabled: false }));
  const source = join(work, 'source'), restored = join(work, 'restored');
  assert.equal(run('compile', 'examples/audio-settings.panel.json', '--output', source).status, 0);
  const result = run('restore', join(source, 'panel.bundle.json'), '--state', stateFile, '--output', restored);
  assert.equal(result.status, 0, result.stderr);
  const checked = JSON.parse(run('inspect', join(restored, 'panel.bundle.json')).stdout);
  assert.deepEqual(checked.state, { volume: 40, audioEnabled: false });
  const nullState = join(work, 'null.json'); await writeFile(nullState, 'null');
  const invalidOutput = join(work, 'null-output');
  const invalid = run('restore', join(source, 'panel.bundle.json'), '--state', nullState, '--output', invalidOutput);
  assert.notEqual(invalid.status, 0); await assert.rejects(stat(invalidOutput), { code: 'ENOENT' });
});

test('invalid spec never creates a successful or partial delivery directory', async () => {
  const bad = copy(fixture); bad.layout.labelWidth = 4000;
  const file = join(work, 'bad.json'), output = join(work, 'failed'); await writeFile(file, JSON.stringify(bad));
  const result = run('compile', file, '--output', output);
  assert.notEqual(result.status, 0); await assert.rejects(stat(output), { code: 'ENOENT' });
  assert.equal(result.stderr.includes(root), false);
});

test('output confinement rejects sibling paths and harness root before writing', async () => {
  await assert.rejects(createOutputDirectory(root), /OUTSIDE/);
  await assert.rejects(createOutputDirectory(resolve(root, '../outside-panel-test')), /OUTSIDE/);
  await assert.rejects(createOutputDirectory(join(root, '.git', 'output')), /RESERVED/);
});

test('output confinement rejects a symlink/junction anywhere in output ancestors', async context => {
  const target = join(work, 'target'), link = join(work, 'link'); await mkdir(target);
  try { await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { context.skip('Filesystem does not permit creating test links'); return; } throw error; }
  await assert.rejects(createOutputDirectory(join(link, 'delivery')), /LINK_FORBIDDEN/);
  await assert.rejects(stat(join(target, 'delivery')), { code: 'ENOENT' });
});
