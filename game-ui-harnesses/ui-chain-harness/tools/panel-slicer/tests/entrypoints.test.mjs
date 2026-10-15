import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { renderPanelPng } from '../src/node.mjs';
import { renderPanelPng as legacyRender } from '../../../src/slicing/render-node.mjs';
import { SlicedBackground } from '../src/sliced-background.mjs';
import { SlicedBackground as legacyBackground } from '../../../src/runtime/sliced-background.mjs';
import { skinToolIdentity } from '../../../src/skins/package.mjs';

test('legacy APIs resolve to the same implementation and browser API has no Node dependencies', async () => {
  assert.equal(legacyRender, renderPanelPng);
  assert.equal(legacyBackground, SlicedBackground);
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/browser.mjs', import.meta.url))],
    bundle: true, platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
  assert.ok(!Object.keys(result.metafile.inputs).some(f => f.endsWith('/render-node.mjs') || f.includes('playwright')));
  const tool = await skinToolIdentity();
  assert.ok(tool.files.some(f => f.file === 'tools/panel-slicer/src/geometry.mjs'));
});
