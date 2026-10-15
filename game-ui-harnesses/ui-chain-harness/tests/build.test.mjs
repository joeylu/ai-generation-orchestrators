import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildTemplates, templateStatus } from '../src/templates/build.mjs';
import { clone, save, workspace, fakeRenderer, extended } from './helpers.mjs';

const current = w => readFile(join(w.output,'current.json'),'utf8');
test('publish complete snapshot; deleted sheets never appear as current; old revision remains intact', async () => {
  const spec = extended(), w = await workspace(spec);
  const first = await buildTemplates({ ...w, render: fakeRenderer });
  assert.equal((await templateStatus(w)).status,'current');
  spec.sheets.pop(); spec.revision++;
  await save(w.config,spec);
  assert.equal((await templateStatus(w)).status,'stale');
  const second = await buildTemplates({ ...w, render: fakeRenderer });
  assert.notEqual(first.buildId,second.buildId);
  assert.equal((await templateStatus(w)).status,'current');
  const files = await readdir(join(w.output,'builds',second.buildId));
  assert.ok(!files.some(f => f.startsWith('s05-')));
  assert.ok((await readdir(join(w.output,'builds',first.buildId))).includes('s05-extra.clean.png'));
});

test('invalid JSON/duplicate ID/bounds/overlap do not call renderer or replace current', async () => {
  const w = await workspace(); await buildTemplates({ ...w, render: fakeRenderer });
  const before = await current(w);
  for (const mutate of [
    s => { s.sheets[0].parts[1].assetId = 'surface.panel'; },
    s => { s.sheets[0].parts[0].slotRect[0] = 0; },
    s => { s.sheets[0].parts[1].slotRect = s.sheets[0].parts[0].slotRect; },
  ]) {
    const spec = clone(); mutate(spec); await save(w.config,spec);
    await assert.rejects(buildTemplates({ ...w, render: () => assert.fail('must not render') }));
    assert.equal(await current(w),before);
    assert.equal((await templateStatus(w)).status,'invalid-source');
  }
  await writeFile(w.config,'{broken');
  await assert.rejects(buildTemplates({ ...w, render: () => assert.fail('must not render') }));
  assert.equal(await current(w),before);
});

test('mid-render failure preserves all previous bytes and releases the local writer lock', async () => {
  const w = await workspace(); const first = await buildTemplates({ ...w, render: fakeRenderer });
  const pointer = await current(w), recordFile = join(w.output,'builds',first.buildId,'build-record.json');
  const record = await readFile(recordFile);
  const spec = extended(); await save(w.config,spec);
  await assert.rejects(buildTemplates({ ...w, render: async ({ directory }) => {
    await writeFile(join(directory,'s01-surfaces.clean.png'),'partial'); throw new Error('simulated crash');
  } }));
  assert.equal(await current(w),pointer); assert.deepEqual(await readFile(recordFile),record);
  assert.equal((await templateStatus(w)).status,'stale');
  assert.ok(!(await readdir(w.output)).includes('.build.lock'));
});

test('source change during build is rejected before publication', async () => {
  const w = await workspace(); await buildTemplates({ ...w, render: fakeRenderer });
  const before = await current(w);
  await assert.rejects(buildTemplates({ ...w, render: async options => {
    const result = await fakeRenderer(options); await save(w.config,extended()); return result;
  } }),e => e.issues.some(i => i.code === 'build.changed'));
  assert.equal(await current(w),before);
});

test('artifact corruption and unsafe current pointer are rejected', async () => {
  const w = await workspace(); const first = await buildTemplates({ ...w, render: fakeRenderer });
  await writeFile(join(w.output,'builds',first.buildId,'catalog.json'),'{}');
  assert.equal((await templateStatus(w)).status,'corrupt');
  const pointer = JSON.parse(await current(w)); pointer.buildId = '../escape';
  await save(join(w.output,'current.json'),pointer);
  assert.equal((await templateStatus(w)).status,'corrupt');
});

test('concurrent build is rejected and previous pointer remains readable', async () => {
  const w = await workspace(); await buildTemplates({ ...w, render: fakeRenderer });
  const pointer = await current(w);
  await writeFile(join(w.output,'.build.lock'),'fixture lock');
  await assert.rejects(buildTemplates({ ...w, render: fakeRenderer }),e => e.issues.some(i => i.code === 'build.busy'));
  assert.equal(await current(w),pointer); assert.equal((await templateStatus(w)).status,'current');
});

test('missing current status is read-only and cannot become a successful build', async () => {
  const w = await workspace();
  assert.equal((await templateStatus(w)).status,'missing');
  assert.deepEqual(await readdir(w.directory),['template.json']);
});
