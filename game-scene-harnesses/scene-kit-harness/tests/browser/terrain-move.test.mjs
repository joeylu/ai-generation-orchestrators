import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit} from '../../src/kit.mjs';
import {connectedMap} from '../helpers/mixed.mjs';
import {fixtureRoot} from '../helpers/generation.mjs';
import {dismissCanvasPanels} from './canvas-controls.mjs';

test('selection tool drags free curves and connected grid terrain, previews and cancels without commits, and keeps one undo', {timeout:180000}, async t=>{
  const initialDocument=connectedMap(loadSceneKit(fixtureRoot));
  initialDocument.assemblyInstances=[{instanceId:'piece',presetId:'platform.small',layerId:'environment',column:34,row:3}];
  initialDocument.curveTerrains.push({curveId:'free',familyId:'terrain.primary',profile:'sideview-height-curve-v1',baseY:576,points:[{x:1408,y:448,slope:0},{x:1664,y:320,slope:0},{x:1920,y:448,slope:0}]});
  const output=process.env.SCENE_KIT_SCREENSHOTS,staticRoot=await buildStudio({output:output?join(output,'test-static'):undefined});
  const host=await startStudio({root:fixtureRoot,staticRoot,initialDocument});let browser;t.after(async()=>{await browser?.close();await host.close();});
  const {chromium}=dependency('playwright').require('playwright');browser=await chromium.launch({headless:true,...(process.env.SCENE_KIT_BROWSER_CHANNEL?{channel:process.env.SCENE_KIT_BROWSER_CHANNEL}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
  await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));
  await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]');assert.match(await page.title(),/Scene Kit Studio/);
  const snapshot=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),revision=r=>page.waitForFunction(v=>+document.body.dataset.revision>v,r);
  async function point(x,y){await dismissCanvasPanels(page);const b=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:b.x+(x-v.x)/v.w*b.width,y:b.y+(y-v.y)/v.h*b.height};}
  async function frame(id){await page.locator(`[data-instance-id="${id}"]`).dblclick();await page.getByRole('button',{name:'选择 V',exact:true}).click();}
  async function begin(x,y,dx,dy){const a=await point(x,y),b=await point(x+dx,y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});}
  async function unchanged(before){const s=await snapshot();assert.deepEqual(s.document,before.document);assert.deepEqual(s.history,before.history);assert.equal(s.revision,before.revision);}
  async function undo(){const s=await snapshot();await page.getByRole('button',{name:'撤销',exact:true}).click();await revision(s.revision);}
  await t.test('free curve moves as a solid piece including its base and has exact undo/redo',async()=>{
    await frame('free');const before=await snapshot();await begin(1664,420,-37,-21);await unchanged(before);assert.equal(await page.locator('#canvas-host').getAttribute('data-gesture'),'terrain-move');
    if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'curve-move-preview.png')});}
    await page.mouse.up();await revision(before.revision);const after=await snapshot(),c=after.document.curveTerrains.find(c=>c.curveId==='free');
    assert.equal(c.points[1].x,1627);assert.equal(c.points[1].y,299);assert.equal(c.baseY,555);assert.equal(after.history.undoDepth,before.history.undoDepth+1);
    await undo();assert.deepEqual((await snapshot()).document,before.document);const undone=await snapshot();await page.getByRole('button',{name:'重做',exact:true}).click();await revision(undone.revision);assert.deepEqual((await snapshot()).document,after.document);await undo();
  });
  await t.test('Escape, right click, blur, pointercancel and lost capture discard the entire move and retain redo',async()=>{
    const before=await snapshot();
    for(const type of ['escape','right','blur','pointercancel','lostpointercapture']){
      await begin(1664,420,-30,-20);
      if(type==='escape')await page.keyboard.press('Escape');
      else if(type==='right'){await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});}
      else await page.evaluate(type=>type==='blur'?window.dispatchEvent(new Event('blur')):document.querySelector('canvas').dispatchEvent(new PointerEvent(type,{pointerId:1})),type);
      await page.mouse.up();await unchanged(before);assert.equal(await page.locator('#canvas-host').getAttribute('data-gesture'),'');
    }
  });
  await t.test('dragging a connected grid island snaps to cells and moves both platforms, curve and links together',async()=>{
    await frame('mixed.hill');const before=await snapshot();await begin(100,500,110,-50);await unchanged(before);await page.mouse.up();await revision(before.revision);
    const after=await snapshot(),c=after.document.curveTerrains.find(c=>c.curveId==='mixed.hill');assert.equal(c.points[0].x,384);assert.equal(c.baseY,512);assert.equal(after.scene.mixedTerrains.length,1);
    assert.equal(after.scene.counts.terrainNodes,before.scene.counts.terrainNodes);assert.equal(after.document.terrainConnections[0].cell.x,before.document.terrainConnections[0].cell.x+2);assert.equal(after.history.undoDepth,before.history.undoDepth+1);
    await undo();assert.deepEqual((await snapshot()).document,before.document);
  });
  await t.test('locked/hidden layers, preview mode and clicks do not move terrain',async()=>{
    await frame('free');const lock=page.getByRole('button',{name:'锁定图层 terrain',exact:true});await lock.click();let before=await snapshot();await begin(1664,420,-30,-20);await page.mouse.up();await unchanged(before);await lock.click();
    const eye=page.getByRole('checkbox',{name:'显示图层 terrain',exact:true});await eye.uncheck();before=await snapshot();await begin(1664,420,-30,-20);await page.mouse.up();await unchanged(before);await eye.check();
    before=await snapshot();const p=await point(1664,420);await page.mouse.click(p.x,p.y);await unchanged(before);
    await page.getByRole('button',{name:'Play Mode',exact:true}).click();before=await snapshot();await begin(1664,420,-30,-20);await page.mouse.up();await unchanged(before);await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();
  });
  await t.test('moving out of bounds rejects the complete gesture and retains author and redo',async()=>{
    await frame('free');const before=await snapshot();await begin(1664,420,0,40);await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true');await unchanged(before);
    assert.match(await page.locator('#status').innerText(),/超出地图范围/);
  });
  await t.test('existing standalone assemblies stay selectable and obey the primary terrain layer lock',async()=>{
    await page.locator('[data-instance-id="piece"]').dblclick();const lock=page.getByRole('button',{name:'锁定图层 terrain',exact:true});await lock.click();
    const before=await snapshot();await begin(2208,224,64,0);await page.mouse.up();await unchanged(before);await lock.click();
    await begin(2208,224,64,0);await page.mouse.up();await revision(before.revision);assert.equal((await snapshot()).document.assemblyInstances[0].column,35);await undo();assert.deepEqual((await snapshot()).document,before.document);
  });
  const expected=errors.filter(e=>e.includes('422 (Unprocessable Entity)'));assert.equal(expected.length,1);assert.deepEqual(errors.filter(e=>!expected.includes(e)),[]);assert.deepEqual(external,[]);
});
