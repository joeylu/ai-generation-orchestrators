import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { buildTemplates, templateStatus } from '../../src/templates/build.mjs';
import { extended, small, workspace } from '../helpers.mjs';

for (const [title, makeSpec, count, parts, pixels] of [
  ['new part and fifth sheet from JSON',extended,10,31,1024],
  ['512 logical square at 2x output',small,2,2,1024],
]) test(title,{ timeout: 120000 },async () => {
  const spec = makeSpec(), w = await workspace(spec);
  const result = await buildTemplates({ ...w, channel: process.env.UI_CHAIN_TEST_BROWSER ?? 'chromium' });
  assert.equal(result.partCount,parts);
  assert.equal((await templateStatus(w)).status,'current');
  const dir = join(w.output,'builds',result.buildId);
  const record = JSON.parse(await readFile(join(dir,'build-record.json'),'utf8'));
  assert.equal(record.runtime.files.length,count);
  for (const entry of record.runtime.files) {
    const bytes = await readFile(join(dir,entry.file));
    assert.equal(bytes.subarray(1,4).toString(),'PNG');
    assert.equal(bytes.readUInt32BE(16),pixels); assert.equal(bytes.readUInt32BE(20),pixels);
    if (entry.role === 'clean') {
      assert.equal(entry.textNodes,0); assert.equal(entry.checks.strayPixels,0);
      assert.ok(entry.checks.partPaintedPixels.every(n => n>0));
      assert.ok(entry.checks.transparentPixels>0); assert.ok(entry.checks.ringCentersClear);
    } else assert.ok(entry.textNodes>0);
  }
  const catalog = JSON.parse(await readFile(join(dir,'catalog.json'),'utf8'));
  assert.equal(catalog.partCount,parts);
  assert.ok((await readFile(join(dir,'overview.md'),'utf8')).includes(`${parts} 个候选部件`));
  if (spec.coordinates.width === 512) {
    const browser = await chromium.launch({ channel: process.env.UI_CHAIN_TEST_BROWSER ?? 'chromium', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
    try {
      const page = await browser.newPage({ serviceWorkers: 'block' });
      await page.route('**/*', route => route.abort());
      const urls = await Promise.all(['clean','review'].map(async mode => `data:image/png;base64,${(await readFile(join(dir,`s01-fixture.${mode}.png`))).toString('base64')}`));
      const decoded = await page.evaluate(async urls => {
        const arrays = [];
        for (const url of urls) {
          const img = new Image(); img.src = url; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const context = c.getContext('2d'); context.drawImage(img,0,0);
          arrays.push(context.getImageData(0,0,c.width,c.height).data);
        }
        const pixel = (array,x,y) => Array.from(array.slice((y*1024+x)*4,(y*1024+x)*4+4));
        let differences = 0;
        for (let i=0; i<arrays[0].length; i+=4) if (arrays[0][i+3] === 255) {
          if ([0,1,2,3].some(c => arrays[0][i+c] !== arrays[1][i+c])) differences++;
        }
        return { outside: pixel(arrays[0],0,0), center: pixel(arrays[0],256,256), ringHole: pixel(arrays[0],736,256), ringEdge: pixel(arrays[0],646,256), reviewCorner: pixel(arrays[1],1000,1000), differences };
      },urls);
      assert.deepEqual(decoded.outside,[0,0,0,0]);
      assert.deepEqual(decoded.center,[215,221,228,255]);
      assert.deepEqual(decoded.ringHole,[0,0,0,0]);
      assert.equal(decoded.ringEdge[3],255);
      assert.deepEqual(decoded.reviewCorner,[245,247,250,255]);
      assert.equal(decoded.differences,0);
    } finally { await browser.close(); }
  }
});
