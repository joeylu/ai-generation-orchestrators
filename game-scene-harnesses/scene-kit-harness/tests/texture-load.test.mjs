import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModuleTextures } from '../src/pixi/texture-load.mjs';

test('module loading bounds requests and reuses one source texture across style variants', async () => {
  let active = 0, peak = 0, calls = 0;
  const modules = Array.from({ length: 90 }, (_, n) => ({ assetId: `asset.${n}`, source: { sha256: String(n % 30) },
    ...(n >= 60 ? { renderStyle: { opacity: 0.4 } } : {}) }));
  const textures = await loadModuleTextures(modules, async () => {
    calls++; active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return { source: {} };
  }, 4);
  assert.equal(calls, 30); assert.equal(peak, 4); assert.equal(textures.size, 90);
  assert.equal(textures.get('asset.0'), textures.get('asset.60')); assert.equal(textures.get('asset.0').source.scaleMode, 'linear');
});

test('a failed texture is not retried and stops undispatched work', async () => {
  let calls = 0; const error = new Error('synthetic missing asset');
  const modules = Array.from({ length: 50 }, (_, n) => ({ assetId: String(n), source: { sha256: String(n) } }));
  await assert.rejects(loadModuleTextures(modules, async () => { calls++; throw error; }), e => e === error);
  assert.ok(calls <= 8); await assert.rejects(loadModuleTextures([], async () => {}, 100), /concurrency/);
});
