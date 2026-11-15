import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { createEnvironmentAnimationPlayer, environmentAnimationTransform } from '../src/environment-animation.mjs';
import { exportEnvironmentAnimationPlan, readEnvironmentAnimationPlan } from '../src/generation/environment-animation-plan.mjs';
import { runEnvironmentAnimation } from '../src/generation/environment-animation-run.mjs';
import { measureEnvironmentAnimationAtlasBaseLock, measureEnvironmentAnimationRegistration } from '../src/environment-animation-media.mjs';
import { encodeRgbaPng } from '../src/png.mjs';
import { readStoredArchive, storeArchive } from '../src/archive.mjs';
import { animationAtlas } from './helpers/environment-animation.mjs';

const red = [210, 45, 45], yellow = [230, 205, 50];
const clip = { columns: 2, rows: 1, frameMs: 160 };

test('registration matches the visible first pose to the still image with one transform', () => {
  const still = animationAtlas([red]), width = 96, height = 40, pixels = Buffer.alloc(width * height * 4);
  for (let y = 12; y < 23; y++) for (let x = 16; x < 27; x++) pixels.set([...red, 255], (y * width + x) * 4);
  for (let y = 14; y < 25; y++) for (let x = 67; x < 78; x++) pixels.set([...yellow, 255], (y * width + x) * 4);
  const atlas = encodeRgbaPng(width, height, pixels);
  const registration = measureEnvironmentAnimationRegistration(still, atlas, clip);
  assert.deepEqual(registration, { scale: 2, x: -27, y: -19 });
  assert.equal(23 * registration.scale + registration.y, 27);
  assert.equal((25 - 23) * registration.scale, 4);
  const baseLock = measureEnvironmentAnimationAtlasBaseLock(atlas, clip);
  assert.deepEqual(baseLock, [{ x: 0, y: 0 }, { x: -3, y: -2 }]);
  assert.deepEqual(environmentAnimationTransform({}, { registration, baseLock }, 1), { scale: 2, x: -33, y: -23 });
  for (let y = 0; y < height; y++) pixels.fill(0, (y * width + width / 2) * 4, (y + 1) * width * 4);
  assert.equal(measureEnvironmentAnimationAtlasBaseLock(encodeRgbaPng(width, height, pixels), clip), undefined);
});

test('per-instance playback handles hold, one shot, completion and looping', () => {
  const config = { initial: 'closed', states: [
    { id: 'closed', playback: 'hold', onInteract: 'opening' },
    { id: 'opening', playback: 'once', clip, onFinish: 'open' },
    { id: 'open', playback: 'hold', onInteract: 'closed' },
  ] };
  const first = createEnvironmentAnimationPlayer(config), second = createEnvironmentAnimationPlayer(config);
  assert(first.interact());
  first.advance(180);
  assert.equal(first.state.id, 'opening');
  assert.equal(first.frame, 1);
  first.advance(200);
  assert.equal(first.state.id, 'open');
  assert.equal(second.state.id, 'closed');
  assert(first.interact());
  assert.equal(first.state.id, 'closed');
  const idle = createEnvironmentAnimationPlayer({ initial: 'idle', states: [{ id: 'idle', playback: 'loop', clip }] });
  idle.advance(160);
  assert.equal(idle.frame, 1);
  idle.advance(160);
  assert.equal(idle.frame, 0);
  assert.equal(idle.interact(), false);
});

test('frozen animation plan binds exact input, reserves before dispatch and keeps unknown terminal', async t => {
  const base = resolve(tmpdir()), root = mkdtempSync(join(base, 'scene-animation-run-'));
  t.after(() => { assert.equal(dirname(root), base); rmSync(root, { recursive: true, force: true }); });
  const reference = animationAtlas([red]), image = animationAtlas([red, yellow]);
  const input = { stateId: 'idle', playback: 'loop', motion: 'Rock gently', ...clip };
  const makePlan = () => exportEnvironmentAnimationPlan('64eadeef-66c7-4bb1-9ada-7d6bb7f703ae', '3'.repeat(64), 'environment-marker', input, reference);
  const archive = makePlan(), { plan } = readEnvironmentAnimationPlan(archive);
  const files = readStoredArchive(archive);
  files.set('reference.png', image);
  assert.throws(() => readEnvironmentAnimationPlan(storeArchive(files)), error => error.errors?.[0]?.code === 'ANIMATION_PLAN_CHANGED');
  let calls = 0;
  const args = { archive, confirmed: plan.sha256, root, createAdapter: () => ({
    async generate({ images, attemptSha256 }) {
      calls++;
      const record = JSON.parse(readFileSync(join(root, plan.sha256, 'reservation.json')));
      assert.equal(record.sha256, attemptSha256);
      assert.deepEqual(images[0].bytes, reference);
      return image;
    },
  }) };
  await assert.rejects(() => runEnvironmentAnimation({ ...args, confirmed: '0'.repeat(64) }),
    error => error.errors?.[0]?.code === 'CONFIRMATION_MISMATCH');
  assert.equal(existsSync(join(root, plan.sha256)), false);
  const passed = await runEnvironmentAnimation(args);
  assert.equal(passed.status, 'pass');
  assert.deepEqual(readFileSync(join(root, plan.sha256, 'raw.png')), image);
  await assert.rejects(() => runEnvironmentAnimation(args), error => error.errors?.[0]?.code === 'OUTPUT_EXISTS');
  assert.equal(calls, 1);
  const second = makePlan(), digest = readEnvironmentAnimationPlan(second).plan.sha256;
  assert.notEqual(digest, plan.sha256);
  const failure = { ...args, archive: second, confirmed: digest, createAdapter: () => ({ generate() { calls++; throw Error('lost'); } }) };
  assert.equal((await runEnvironmentAnimation(failure)).result.state, 'unknown');
  await assert.rejects(() => runEnvironmentAnimation(failure), error => error.errors?.[0]?.code === 'OUTPUT_EXISTS');
  assert.equal(calls, 2);
});
