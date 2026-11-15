import {canvasField,selectObject,dismissCanvasPanels} from './canvas-controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { loadSceneKit, readMap } from '../../src/index.mjs';
import { prepareTerrainPreview } from '../helpers/terrain-preview.mjs';
import { fixtureRoot } from '../helpers/generation.mjs';

const roots = process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean) ?? [];
test('curve endpoints: visible snap preview, atomic forward/reverse join, cancel, explicit join and saved state', {timeout:180000}, async t=>{
  const context=prepareTerrainPreview(t), staticRoot=await buildStudio({roots,output:join(context.parent,'static')});
  const curve=(curveId,points)=>({curveId,profile:'sideview-height-curve-v1',familyId:'terrain.primary',baseY:576,points:points.map(([x,y])=>({x,y,slope:0}))});
  const initialDocument={...readMap(loadSceneKit(fixtureRoot)),format:'ai_scene_document_v2',terrainRuns:[],assemblyInstances:[],curveTerrains:[
    curve('ground.left',[[64,448],[256,320],[448,384]]),curve('ground.right',[[480,384],[704,256],[960,448]]),
  ]};
  const host=await startStudio({root:fixtureRoot,staticRoot,terrainPreview:context.preview,initialDocument});t.after(()=>host.close());
  const {chromium}=dependency('playwright',roots).require('playwright');
  const browser=await chromium.launch({headless:true,...(process.env.SCENE_KIT_BROWSER_CHANNEL?{channel:process.env.SCENE_KIT_BROWSER_CHANNEL}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader', '--explicitly-allowed-ports='+new URL(host.url).port]});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1}), errors=[],warnings=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());if(message.type()==='warning')warnings.push(message.text());});
  page.on('dialog',dialog=>dialog.accept());
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==host.url){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  assert.equal(await page.title(),'Scene Kit Studio · 横版场景编辑');assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
  await page.getByRole('checkbox',{name:'网格',exact:true}).uncheck();
  const snapshot=()=>page.evaluate(async()=>(await fetch('/api/state')).json());
  const waitRevision=revision=>page.waitForFunction(value=>Number(document.body.dataset.revision)>value,revision);
  async function screenPoint(x,y){
    await dismissCanvasPanels(page);
    const rect=await page.locator('canvas').boundingBox(),visible=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));
    return {x:rect.x+(x-visible.x)/visible.width*rect.width,y:rect.y+(y-visible.y)/visible.height*rect.height,scale:rect.width/visible.width};
  }
  async function select(id,index){await (await canvasField(page,'curve-selection')).selectOption(id);await (await canvasField(page,'curve-point')).selectOption(String(index));}
  async function dragStart(source,target){const a=await screenPoint(source.x,source.y),b=await screenPoint(target.x,target.y);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);}
  async function undo(){const before=await snapshot();await page.getByRole('button',{name:'撤销',exact:true}).click();await waitRevision(before.revision);}
  async function capture(name){if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,name),fullPage:true});}}
  const initial=await snapshot();
  await t.test('right endpoint previews one shared anchor without a commit; release is one reversible join',async()=>{
    await select('ground.left',2);await capture('curve-join-before.png');
    const before=await snapshot();await dragStart({x:448,y:384},{x:477,y:384});
    assert.equal(await page.locator('#canvas-host').getAttribute('data-curve-join'),'ready');
    assert.match(await page.locator('#curve-join-hint').innerText(),/松手合并/);assert.equal((await snapshot()).revision,before.revision);
    await capture('curve-join-snap.png');await page.mouse.up();await waitRevision(before.revision);
    const after=await snapshot();assert.equal(after.document.curveTerrains.length,1);assert.equal(after.document.curveTerrains[0].points.length,5);
    assert.deepEqual(after.document.curveTerrains[0].points[2],{x:480,y:384,slope:0});
    assert.equal(after.history.undoDepth,1);assert.match(await page.locator('#status').innerText(),/共用一个连接点/);
    assert.equal(after.scene.collisionSuggestions.curveContours.length,1);
    await select('ground.left',2);await (await canvasField(page,'collision')).check();await capture('curve-join-after.png');
    await undo();assert.deepEqual((await snapshot()).document,initial.document);
    const undone=await snapshot();await page.getByRole('button',{name:'重做',exact:true}).click();await waitRevision(undone.revision);
    assert.equal((await snapshot()).scene.contentSha256,after.scene.contentSha256);await undo();
  });
  await t.test('left endpoint joins into the left curve and preserves its stationary coordinate',async()=>{
    await select('ground.right',0);const before=await snapshot();await dragStart({x:480,y:384},{x:451,y:384});await page.mouse.up();await waitRevision(before.revision);
    const after=await snapshot();assert.equal(after.document.curveTerrains[0].curveId,'ground.left');assert.deepEqual(after.document.curveTerrains[0].points[2],{x:448,y:384,slope:0});await undo();
  });
  await t.test('Escape, blur, pointer cancel and lost capture discard a pending snap and retain history',async()=>{
    await select('ground.left',2);const before=await snapshot();
    for(const type of ['escape','blur','pointercancel','lostpointercapture']){
      await dragStart({x:448,y:384},{x:477,y:384});assert.equal(await page.locator('#canvas-host').getAttribute('data-curve-join'),'ready');
      if(type==='escape')await page.keyboard.press('Escape');else await page.evaluate(value=>value==='blur'?window.dispatchEvent(new Event('blur')):document.querySelector('canvas').dispatchEvent(new PointerEvent(value,{pointerId:1})),type);
      await page.mouse.up();assert.equal((await snapshot()).scene.contentSha256,before.scene.contentSha256);assert.deepEqual((await snapshot()).history,before.history);
      assert.equal(await page.locator('#canvas-host').getAttribute('data-curve-join'),'');
    }
  });
  await t.test('already-close endpoints stay separate on selection; the explicit button merges them',async()=>{
    await (await canvasField(page,'curve-x')).fill('479');const before=await snapshot();await page.getByRole('button',{name:'应用曲线参数',exact:true}).click();await waitRevision(before.revision);
    const close=await snapshot(),p=await screenPoint(479,384);await page.mouse.click(p.x,p.y);
    assert.equal((await snapshot()).scene.contentSha256,close.scene.contentSha256);assert.equal((await snapshot()).document.curveTerrains.length,2);
    assert.equal(await page.locator('#join-curves').isEnabled(),true);await page.getByRole('button',{name:'合并附近端点',exact:true}).click();await waitRevision(close.revision);
    assert.equal((await snapshot()).document.curveTerrains.length,1);await undo();await undo();
  });
  await t.test('incompatible bases show a blocked snap and a rejected release preserves both originals',async()=>{
    await select('ground.right',0);await (await canvasField(page,'curve-base')).fill('560');const original=await snapshot();await page.getByRole('button',{name:'应用曲线参数',exact:true}).click();await waitRevision(original.revision);
    await select('ground.left',2);const before=await snapshot();await dragStart({x:448,y:384},{x:477,y:384});
    assert.equal(await page.locator('#canvas-host').getAttribute('data-curve-join'),'blocked');assert.match(await page.locator('#curve-join-hint').innerText(),/封底/);
    await page.mouse.up();await page.waitForFunction(()=>document.getElementById('status').dataset.error==='true');
    assert.match(await page.locator('#status').innerText(),/封底/);assert.deepEqual((await snapshot()).document,before.document);assert.deepEqual((await snapshot()).history,before.history);await undo();
  });
  await t.test('joined maps survive download/import, and controls stay usable at desktop and narrow sizes',async()=>{
    await select('ground.left',2);const before=await snapshot();await dragStart({x:448,y:384},{x:477,y:384});await page.mouse.up();await waitRevision(before.revision);
    await page.locator('#download-menu>summary').click();
    const merged=await snapshot(),event=page.waitForEvent('download');await page.getByRole('button',{name:'地图 JSON',exact:true}).click();const download=await event,file=join(context.parent,'joined.json');await download.saveAs(file);
    assert.deepEqual(JSON.parse(readFileSync(file)),merged.document);await page.locator('#file').setInputFiles(file);await waitRevision(merged.revision);assert.equal((await snapshot()).scene.contentSha256,merged.scene.contentSha256);
    for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1050});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#join-curves').isVisible(),true);}
    await capture('curve-join-narrow.png');
  });
  const deliberate=errors.filter(message=>message.includes('422 (Unprocessable Entity)'));assert.equal(deliberate.length,1);
  assert.deepEqual(errors.filter(message=>!deliberate.includes(message)),[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[]);
});
