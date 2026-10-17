import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { identity, root, scopedOutput, scopedPages, publishEditor } from '../src/editor/build.mjs';
import { sliceEditorData } from '../tools/panel-slicer/web/data.mjs';

test('slicing identity follows imports, excludes canvas authoring, includes shared runtime', async () => {
  const baseline = await identity('slicing');
  const files = baseline.files.map(f => f.file);
  for (const file of ['src/editor/app.mjs', 'configs/canvas-presets.json', 'configs/editor-blocks.json', 'configs/panel-presets.json', 'tests/editor/checks.mjs'])
    assert.ok(!files.includes(file), file);
  for (const file of ['tools/panel-slicer/src/geometry.mjs', 'tools/panel-slicer/src/sliced-background.mjs', 'src/panel/background-pool.mjs', 'tools/panel-slicer/web/data.mjs', 'tools/panel-slicer/tests/browser/checks.mjs'])
    assert.ok(files.includes(file), file);
  const changed = async target => identity('slicing', async file => Buffer.concat([await readFile(join(root, file)), Buffer.from(file === target ? '\n// simulated edit' : '')]));
  assert.equal((await changed('src/editor/app.mjs')).sha256, baseline.sha256);
  assert.equal((await changed('configs/panel-presets.json')).sha256, baseline.sha256);
  assert.notEqual((await changed('tools/panel-slicer/src/geometry.mjs')).sha256, baseline.sha256);
});
test('separate outputs and data retain only required runtime inputs', async () => {
  assert.notEqual(scopedOutput('slicing'), scopedOutput('all'));
  assert.deepEqual(Object.keys(scopedPages('slicing')), ['slice.html', 'slice-runtime.html']);
  assert.ok(scopedPages('all')['index.html']);
  assert.throws(() => scopedOutput('../bad'));
  assert.deepEqual(Object.keys(await sliceEditorData()).sort(), ['profile', 'registry', 'template', 'usage']);
  await assert.rejects(publishEditor({ scope: 'slicing' }, { report: { status: 'failed' } }), /Failed acceptance/);
});
