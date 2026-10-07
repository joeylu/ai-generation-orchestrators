#!/usr/bin/env node
// Optional real-backend regression, separate from the dependency-free fixture suite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--sharp-module')) throw new Error('ASSET_ARGUMENTS');
const modulePath = args[1], adapter = await loadTextureImageAdapter(modulePath);
const sharp = createRequire(import.meta.url)(modulePath ? resolve(modulePath) : 'sharp');
const path = new URL('../tests/fixtures/asset-input/alpha-colors.png', import.meta.url);
const original = await readFile(path);
assert.deepEqual([...await sharp(original).ensureAlpha().raw().toBuffer()], [255, 0, 0, 0, 20, 40, 60, 128, 70, 80, 90, 255, 10, 20, 30, 1]);
const normalized = await adapter.normalizePng(original);
assert.deepEqual([...await sharp(normalized).ensureAlpha().raw().toBuffer()], [0, 0, 0, 0, 20, 40, 60, 128, 70, 80, 90, 255, 10, 20, 30, 1]);
const image = await adapter.analyze(normalized);
assert.equal(image.alpha.hiddenRgbPixels, 0); assert.equal(image.alpha.softPixels, 2);
assert.deepEqual(await readFile(path), original);
process.stdout.write(`${JSON.stringify({ status: 'PASS', check: 'hidden RGB cleared; visible RGB and continuous alpha preserved; source unchanged', renderer: adapter.evidence })}\n`);
