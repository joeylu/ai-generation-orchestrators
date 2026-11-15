import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { loadSceneKit, readMap } from '../../src/index.mjs';
import { prepareTerrainPreview } from '../helpers/terrain-preview.mjs';
import { fixtureRoot } from '../helpers/generation.mjs';
import { dismissCanvasPanels } from './canvas-controls.mjs';

const roots = process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean) ?? [];
test('double click the curve edge to insert, select and drag one undoable point; other tools and guards stay intact', { timeout: 180000 }, async t => {
  const context = prepareTerrainPreview(t), staticRoot = await buildStudio({ roots, output: join(context.parent, 'static') });
  const c = (curveId, points) => ({ curveId, profile: 'sideview-height-curve-v1', familyId: 'terrain.primary', baseY: 576, points: points.map(([x,y]) => ({ x,y,slope:0 })) });
  const initialDocument = { ...readMap(loadSceneKit(fixtureRoot)), format: 'ai_scene_document_v2', terrainRuns: [], assemblyInstances: [],
    curveTerrains: [c('left', [[64,448],[256,320],[448,448]]), c('right', [[512,448],[736,320],[960,448]])] };
  const host = await startStudio({ root: fixtureRoot, staticRoot, terrainPreview: context.preview, initialDocument }); t.after(() => host.close());
  const { chromium } = dependency('playwright', roots).require('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.SCENE_KIT_BROWSER_CHANNEL ? { channel: process.env.SCENE_KIT_BROWSER_CHANNEL } : {}),
    args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (['error','warning'].includes(m.type())) errors.push(m.text()); });
  await page.route('**/*', r => new URL(r.request().url()).origin === host.url ? r.continue() : (external.push(r.request().url()), r.abort()));
  await page.goto(host.url); await page.waitForSelector('body[data-ready="true"]');
  assert.match(await page.title(), /Scene Kit Studio/); assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
  const snapshot = () => page.evaluate(async () => (await fetch('/api/state')).json());
  const revision = r => page.waitForFunction(value => +document.body.dataset.revision > value, r);
  async function position(x,y) {
    await dismissCanvasPanels(page);
    const b = await page.locator('canvas').boundingBox(), v = await page.locator('#minimap rect').last().evaluate(e => ({ x:+e.getAttribute('x'), y:+e.getAttribute('y'), w:+e.getAttribute('width'), h:+e.getAttribute('height') }));
    return { x: b.x+(x-v.x)/v.w*b.width, y:b.y+(y-v.y)/v.h*b.height };
  }
  async function click(x,y,double=true) { const p=await position(x,y); await page.mouse[double?'dblclick':'click'](p.x,p.y); }
  async function undo() { const before=await snapshot(); await page.getByRole('button',{name:'撤销',exact:true}).click(); await revision(before.revision); }
  async function unchanged(before) { const after=await snapshot(); assert.deepEqual(after.document,before.document); assert.deepEqual(after.history,before.history); }
  await page.getByRole('button',{name:'全图',exact:true}).click();
  await t.test('single click only; double click inserts on the curve and selects the new point', async () => {
    const before=await snapshot(); await click(160,384,false); await unchanged(before);
    await click(160,384); await revision(before.revision);
    const after=await snapshot(); assert.equal(after.document.curveTerrains[0].points.length,4); assert.deepEqual(after.document.curveTerrains[1],before.document.curveTerrains[1]);
    assert.ok(Math.abs(after.document.curveTerrains[0].points[1].x-160)<=1); assert.ok(Math.abs(after.document.curveTerrains[0].points[1].y-384)<=1);
    assert.equal(await page.locator('#curve-point').inputValue(),'1'); assert.equal(after.history.undoDepth,before.history.undoDepth+1);
    if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'curve-double-click.png')});}
    const p=after.document.curveTerrains[0].points[1], a=await position(p.x,p.y), b=await position(p.x,p.y-20);
    await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{steps:5}); await page.mouse.up(); await revision(after.revision);
    assert.ok((await snapshot()).document.curveTerrains[0].points[1].y < p.y-15); await undo(); await undo(); assert.deepEqual((await snapshot()).document,before.document);
    const undone=await snapshot(); await page.getByRole('button',{name:'重做',exact:true}).click(); await revision(undone.revision); assert.equal((await snapshot()).document.curveTerrains[0].points.length,4); await undo();
  });
  await t.test('empty fill, existing points and cramped locations do not create points or erase redo', async () => {
    await page.locator('[data-instance-id="left"]').dblclick();
    const before=await snapshot(); await click(160,540); await unchanged(before);
    await click(256,320); await page.waitForFunction(()=>!document.querySelector('[data-tool="curve"]').disabled); await unchanged(before);
    // At x=80, the first point is less than the minimum 32 world units away.
    await click(80,445.48); await page.waitForFunction(()=>document.getElementById('status').dataset.error==='true'); await unchanged(before);
    assert.match(await page.locator('#status').innerText(),/太近/);
  });
  await t.test('unselected curves can be targeted and the radius works after zooming', async () => {
    await page.locator('[data-instance-id="right"]').dblclick();
    await page.locator('[data-instance-id="left"]').click();
    const before=await snapshot(); await click(624,384); await revision(before.revision);
    const after=await snapshot(); assert.deepEqual(after.document.curveTerrains[0],before.document.curveTerrains[0]); assert.equal(after.document.curveTerrains[1].points.length,4); await undo();
  });
  await t.test('locked/hidden terrain, selection tool and Play Mode never add curve points', async () => {
    const lock=page.getByRole('button',{name:'锁定图层 terrain',exact:true}); await lock.click(); let before=await snapshot(); await click(624,384); await unchanged(before); await lock.click();
    const eye=page.getByRole('checkbox',{name:'显示图层 terrain',exact:true}); await eye.uncheck(); before=await snapshot(); await click(624,384); await unchanged(before); await eye.check();
    await page.getByRole('button',{name:'选择 V',exact:true}).click(); before=await snapshot(); await click(624,384); await unchanged(before);
    await page.getByRole('button',{name:'曲线 C',exact:true}).click(); await page.getByRole('button',{name:'Play Mode',exact:true}).click(); before=await snapshot(); await click(624,384); await unchanged(before); await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();
  });
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
});
