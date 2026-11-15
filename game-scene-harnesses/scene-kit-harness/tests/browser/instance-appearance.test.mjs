import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { fixtureRoot } from '../helpers/generation.mjs';
import { scenePixels, selectObject } from './canvas-controls.mjs';

test('Studio previews, commits, undoes and independently reopens a per-object color adjustment', {timeout:120000}, async t => {
  const base = resolve(tmpdir()), dir = mkdtempSync(join(base,'scene-appearance-'));
  let host, independent, browser;
  t.after(async () => {
    await browser?.close(); await independent?.close(); await host?.close();
    assert.equal(dirname(dir),base); rmSync(dir,{recursive:true,force:true});
  });
  const staticRoot = await buildStudio({output:join(dir,'static')});
  host = await startStudio({root:fixtureRoot,staticRoot,workspaceRoot:join(dir,'workspace')});
  independent = await startStudio({root:fixtureRoot,staticRoot,workspaceRoot:join(dir,'independent')});
  const {chromium} = dependency('playwright').require('playwright');
  browser = await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:[
    '--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+[host,independent].map(h=>new URL(h.url).port).join(','),
  ]});
  const problems = [];
  async function editor(url) {
    const page = await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',error=>problems.push(error.message));
    page.on('console',message=>{if(['error','warning'].includes(message.type()))problems.push(message.text());});
    await page.route('**/*',request=>new URL(request.request().url()).origin===url?request.continue():request.abort());
    await page.goto(url+'/editor'); await ready(page);
    return page;
  }
  const ready = page => page.waitForSelector('body[data-ready="true"]');
  const snap = page => page.evaluate(async () => (await fetch('/api/state')).json());
  const button = (page,name) => page.getByRole('button',{name,exact:true});
  const changed = (page,previous) => page.waitForFunction(revision=>Number(document.body.dataset.revision)>revision,previous);
  const frames = page => page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const page = await editor(host.url);
  const before = await snap(page);
  await selectObject(page,'marker.main');
  const properties=page.locator('#selection-tools').getByRole('button',{name:'对象属性',exact:true});
  assert.equal(await properties.innerText(),'对象属性');
  await properties.click();
  assert.equal(await page.locator('#object-appearance').evaluate(panel=>panel.open),true);
  const fog = page.getByRole('slider',{name:'雾化',exact:true});
  const opacity = page.getByRole('slider',{name:'不透明度',exact:true});
  const originalPixels = await scenePixels(page);
  await fog.press('End'); await frames(page);
  const fullFog = await scenePixels(page);
  assert(!fullFog.equals(originalPixels));
  await fog.press('ArrowLeft'); await frames(page);
  assert(!(await scenePixels(page)).equals(fullFog), 'live filter updates as the value changes');
  assert.deepEqual((await snap(page)).document,before.document);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur'))); await frames(page);
  assert((await scenePixels(page)).equals(originalPixels));
  await fog.press('End'); await opacity.press('ArrowLeft'); await frames(page);
  const draftPixels = await scenePixels(page);
  await button(page,'应用调色').click(); await changed(page,before.revision);
  const saved = await snap(page);
  assert.equal(saved.history.undoDepth,before.history.undoDepth+1);
  assert.deepEqual(saved.document.instanceAppearances.map(({instanceId,appearance})=>[instanceId,appearance.opacity,appearance.fog]),[['marker.main',99,100]]);
  assert((await scenePixels(page)).equals(draftPixels));
  await button(page,'撤销').click(); await changed(page,saved.revision);
  const undone = await snap(page); assert.deepEqual(undone.document,before.document);
  await button(page,'重做').click(); await changed(page,undone.revision);
  assert.deepEqual((await snap(page)).document,saved.document);
  await page.reload(); await ready(page);
  assert.deepEqual((await snap(page)).document,saved.document);

  await page.locator('#project-switch').click();
  const download = page.waitForEvent('download');
  await button(page,'下载当前项目').click();
  const path = await (await download).path();
  const other = await editor(independent.url);
  await other.locator('#project-switch').click();
  await Promise.all([other.waitForEvent('load'),other.locator('#project-file').setInputFiles(path)]); await ready(other);
  const reopened = await snap(other);
  assert.deepEqual(reopened.document,saved.document);
  assert.equal(reopened.scene.contentSha256,saved.scene.contentSha256);
  assert.deepEqual(problems,[]);
});
