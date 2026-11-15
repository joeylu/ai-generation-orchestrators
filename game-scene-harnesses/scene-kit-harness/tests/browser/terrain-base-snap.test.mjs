import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {loadSceneKit} from '../../src/kit.mjs';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {connectedMap} from '../helpers/mixed.mjs';
import {fixtureRoot} from '../helpers/generation.mjs';

test('curve base snapping previews, cancels and joins from either free or grid-connected endpoint as one undo', {timeout:150000},async t=>{
  const base=resolve(tmpdir()),temp=mkdtempSync(join(base,'scene-base-snap-'));t.after(()=>{assert.equal(dirname(temp),base);assert.ok(basename(temp).startsWith('scene-base-snap-'));rmSync(temp,{recursive:true,force:true});});
  const d={...connectedMap(loadSceneKit(fixtureRoot)),format:'ai_scene_document_v6',instanceTransforms:[]};d.terrainConnections=d.terrainConnections.filter(c=>c.endpoint==='start');d.terrainRuns=d.terrainRuns.filter(r=>r.x<12);d.curveTerrains.push({curveId:'free',familyId:'terrain.primary',profile:'sideview-height-curve-v1',baseY:575,points:[{x:800,y:447,slope:0},{x:1152,y:447,slope:0}]});
  const staticRoot=await buildStudio({output:join(temp,'static')}),host=await startStudio({root:fixtureRoot,staticRoot,initialDocument:d});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[],edits=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});page.on('request',r=>{if(r.url()===host.url+'/api/edit')edits.push(r.postDataJSON());});await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));
  await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]');assert.match(await page.title(),/Scene Kit Studio/);
  const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),revision=r=>page.waitForFunction(v=>+document.body.dataset.revision>v,r);
  async function point(x,y){const b=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:b.x+(x-v.x)/v.w*b.width,y:b.y+(y-v.y)/v.h*b.height};}
  async function frame(id,tool='选择 V'){await page.locator(`[data-instance-id="${id}"]`).dblclick();await page.getByRole('button',{name:tool,exact:true}).click();}
  async function begin(x,y,dx,dy){const a=await point(x,y),b=await point(x+dx,y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});}
  async function undo(){const s=await snap();await page.getByRole('button',{name:'撤销',exact:true}).click();await revision(s.revision);}
  async function unchanged(before){const s=await snap();assert.deepEqual(s.document,before.document);assert.deepEqual(s.history,before.history);assert.equal(s.revision,before.revision);}
  await t.test('a click never normalizes the old base; whole drag shows a snap and preserves shape',async()=>{
    await frame('free');const before=await snap(),p=await point(976,500),count=edits.length;await page.mouse.click(p.x,p.y);await unchanged(before);assert.equal(edits.length,count);
    await begin(976,500,-30,0);assert.equal(await page.locator('#canvas-host').getAttribute('data-terrain-base-snap'),'neighbor');assert.match(await page.locator('.canvas-drop-hint').innerText(),/封底已吸附/);await unchanged(before);
    if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'base-snap-preview.png')});}
    await page.mouse.up();await revision(before.revision);const after=await snap(),c=after.document.curveTerrains.find(c=>c.curveId==='free');assert.equal(c.baseY,576);assert.equal(c.points[0].y,448);assert.equal(c.points[0].x,770);assert.equal(after.history.undoDepth,before.history.undoDepth+1);assert.equal(edits.length,count+1);await undo();assert.deepEqual((await snap()).document,before.document);
  });
  await t.test('five cancel paths discard a snapped preview and preserve redo',async()=>{
    const before=await snap();for(const kind of ['escape','right','blur','pointercancel','lostpointercapture']){await begin(976,500,-30,0);assert.equal(await page.locator('#canvas-host').getAttribute('data-terrain-base-snap'),'neighbor');
      if(kind==='escape')await page.keyboard.press('Escape');else if(kind==='right'){await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});}else await page.evaluate(type=>type==='blur'?window.dispatchEvent(new Event('blur')):document.querySelector('canvas').dispatchEvent(new PointerEvent(type,{pointerId:1})),kind);
      await page.mouse.up();await unchanged(before);assert.equal(await page.locator('#canvas-host').getAttribute('data-terrain-base-snap'),'');}
  });
  await t.test('moving out of the attraction range releases the base instead of changing depth',async()=>{
    const before=await snap();await begin(976,500,-30,0);const b=await point(946,480);await page.mouse.move(b.x,b.y,{steps:6});assert.equal(await page.locator('#canvas-host').getAttribute('data-terrain-base-snap'),'');await page.mouse.up();await revision(before.revision);assert.equal((await snap()).document.curveTerrains.find(c=>c.curveId==='free').baseY,555);await undo();assert.deepEqual((await snap()).document,before.document);
  });
  for(const [id,index,x,y,dx,dy,count]of [['free',0,800,447,-29,1,1],['mixed.hill',2,768,448,29,-1,2]])await t.test(`joining from ${id} aligns the free base and preserves the fixed platform`,async()=>{
    await frame(id,'曲线 C');const before=await snap(),submitted=edits.length;await begin(x,y,dx,dy);assert.equal(await page.locator('#canvas-host').getAttribute('data-curve-join'),'ready');assert.equal(await page.locator('#canvas-host').getAttribute('data-terrain-base-snap'),'neighbor');assert.match(await page.locator('#curve-join-hint').innerText(),/封底已吸附/);await unchanged(before);
    await page.mouse.up();await revision(before.revision);const after=await snap();assert.equal(after.document.curveTerrains.length,1);assert.equal(after.document.curveTerrains[0].baseY,576);assert.deepEqual(after.document.terrainConnections,before.document.terrainConnections);assert.equal(after.history.undoDepth,before.history.undoDepth+1);assert.equal(edits.length,submitted+1);assert.equal(edits.at(-1).commands.length,count);await undo();assert.deepEqual((await snap()).document,before.document);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
