import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureDocument } from '../src/fixtures.ts';
const cli = fileURLToPath(new URL('../scripts/motion-cli.mjs', import.meta.url));
const example = new URL('../skills/ui-motion/assets/confirm-pulse.recipe.json', import.meta.url);
function run(directory: string, ...args: string[]) { return spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', timeout: 15000 }); }

test('motion CLI capabilities, compile, compose, validate and sample run offline from another directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ui-motion-cli-'));
  await writeFile(join(directory, 'ui.json'), JSON.stringify(fixtureDocument('gallery')));
  await writeFile(join(directory, 'recipe.json'), await readFile(example));
  const caps = run(directory, 'capabilities', 'ui.json'); assert.equal(caps.status, 0, caps.stderr);
  assert.equal(JSON.parse(caps.stdout).types.length, 16);
  const compiled = run(directory, 'compile', 'recipe.json', 'ui.json', '--output', 'motion.json');
  assert.equal(compiled.status, 0, compiled.stderr);
  const motion = JSON.parse(await readFile(join(directory, 'motion.json'), 'utf8'));
  const checked = run(directory, 'validate', 'motion.json', 'ui.json'); assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).valid, true);
  const sample = run(directory, 'sample', 'motion.json', 'ui.json', '60'); assert.equal(sample.status, 0, sample.stderr);
  assert.equal(JSON.parse(sample.stdout).samples[0].values.scaleX, 0.97);
  await writeFile(join(directory, 'clips.json'), JSON.stringify({ motionVersion: '0.1', id: 'sequence', duration: 500, trigger: { type: 'manual' }, clips: [{ motion, at: 0 }, { motion, at: 200 }] }));
  const composed = run(directory, 'compose', 'clips.json', 'ui.json'); assert.equal(composed.status, 0, composed.stderr);
  assert.equal(JSON.parse(composed.stdout).tracks.length, motion.tracks.length * 2);
  for (const args of [
    ['compile', 'recipe.json', 'ui.json', '--output', 'motion.json'],
    ['sample', 'motion.json', 'ui.json', 'NaN'], ['sample', 'motion.json', 'ui.json', '181'],
    ['compile', 'recipe.json', 'ui.json', '--engine', 'unity'],
  ]) {
    const failure = run(directory, ...args); assert.notEqual(failure.status, 0); assert.equal(failure.stdout, '');
  }
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'motion.json'), 'utf8')), motion);
});
