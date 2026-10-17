import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { encodePng, decodePng } from '../../../src/skins/png.mjs';
import { renderPanelPng, validateRenderOptions } from '../src/render-node.mjs';
const exec = promisify(execFile);
const script = fileURLToPath(new URL('../cli/render.mjs', import.meta.url));

test('headless config has closed, bounded size options', () => {
  assert.deepEqual(validateRenderOptions({ width: 320, height: 180 }), { width: 320, height: 180, resolution: 1 });
  for (const value of [null, { width: 0, height: 180 }, { width: 3000, height: 180, resolution: 2 }, { width: 320, height: 180, extra: true }])
    assert.throws(() => validateRenderOptions(value), e => e.code === 'slice.options');
});

test('CLI renders PNG offline from JSON; verifies alpha, dimensions, digest and no overwrite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'panel-render-test-'));
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let color = x < 8 ? [255, 0, 0, 255] : x >= 56 ? [0, 0, 255, 255] : [0, 255, 0, 255];
    if (x < 2 && y < 2) color = [0, 0, 0, 0];
    else if (x < 6 && y < 2) color = [255, 0, 0, 128];
    pixels.set(color, (y * 64 + x) * 4);
  }
  const input = join(dir, 'source.png'), output = join(dir, 'result.png'), config = join(dir, 'size.json');
  await writeFile(input, encodePng({ width: 64, height: 64, pixels }));
  await writeFile(config, JSON.stringify({ width: 128, height: 96, resolution: 2 }));
  const run = await exec(process.execPath, [script, '--input', input, '--config', config, '--output', output], { cwd: dir, timeout: 90000 });
  const report = JSON.parse(run.stdout), bytes = await readFile(output), png = decodePng(bytes);
  assert.equal(report.status, 'succeeded'); assert.equal(png.width, 256); assert.equal(png.height, 192);
  assert.equal(report.sha256, createHash('sha256').update(bytes).digest('hex'));
  const pixel = (x, y) => [...png.pixels.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
  assert.deepEqual(pixel(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(7, 0), [255, 0, 0, 128]);
  assert.deepEqual(pixel(100, 100), [0, 255, 0, 255]);
  const legacyScript = fileURLToPath(new URL('../../../scripts/panel-render.mjs', import.meta.url));
  const legacyOutput = join(dir, 'legacy-result.png');
  const legacy = await exec(process.execPath, [legacyScript, '--input', input, '--config', config, '--output', legacyOutput], { cwd: dir, timeout: 90000 });
  assert.equal(JSON.parse(legacy.stdout).sha256, report.sha256);
  assert.deepEqual(await readFile(legacyOutput), bytes);
  await assert.rejects(exec(process.execPath, [script, '--input', input, '--config', config, '--output', output], { cwd: dir }), e => {
    assert.equal(e.code, 1); assert.equal(JSON.parse(e.stdout).error.code, 'slice.output-exists'); return true;
  });
  assert.deepEqual(await readFile(output), bytes);
  await writeFile(join(dir, 'empty.png'), encodePng({ width: 64, height: 64, pixels: Buffer.alloc(64 * 64 * 4) }));
  await assert.rejects(renderPanelPng({ input: join(dir, 'empty.png'), output: join(dir, 'failed.png'), width: 128, height: 96 }), /无法自动配置/);
  await assert.rejects(stat(join(dir, 'failed.png')), e => e.code === 'ENOENT');
});
