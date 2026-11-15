import {canvasField,selectObject,dismissCanvasPanels,scenePixels} from './canvas-controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {join,delimiter} from 'node:path';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit} from '../../src/index.mjs';
import {prepareTerrainPreview} from '../helpers/terrain-preview.mjs';
import {fixtureRoot} from '../helpers/generation.mjs';
import {mixedMap} from '../helpers/mixed.mjs';
import {inspectPng} from '../../src/png.mjs';
const roots=process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean)??[];
test('mixed terrain: two grid corners, unified rendered surface, locked anchors, cancellation and v6 round trip',{timeout:180000},async t=>{
  const context=prepareTerrainPreview(t),staticRoot=await buildStudio({roots,output:join(context.parent,'static')});
  const host=await startStudio({root:fixtureRoot,staticRoot,terrainPreview:context.preview,initialDocument:mixedMap(loadSceneKit(fixtureRoot))});t.after(()=>host.close());
  const {chromium}=dependency('playwright',roots).require('playwright'),browser=await chromium.launch({headless:true,...(process.env.SCENE_KIT_BROWSER_CHANNEL?{channel:process.env.SCENE_KIT_BROWSER_CHANNEL}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader', '--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1}),errors=[],warnings=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});page.on('dialog',d=>d.accept());
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==host.url){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]',{timeout:60000});assert.equal(await page.title(),'Scene Kit Studio · 横版场景编辑');assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
  const snapshot=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),waitRevision=r=>page.waitForFunction(v=>+document.body.dataset.revision>v,r);
  async function point(x,y){const rect=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));return {x:rect.x+(x-v.x)/v.width*rect.width,y:rect.y+(y-v.y)/v.height*rect.height};}
  async function clickEdit(id){const before=await snapshot();await (await canvasField(page,id)).click();await waitRevision(before.revision);return snapshot();}
  async function select(index){await (await canvasField(page,'curve-selection')).selectOption('mixed.hill');await (await canvasField(page,'curve-point')).selectOption(String(index));}
  async function capture(name){if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,name),fullPage:true});}}
  const original=await snapshot();
  await t.test('both grid connections preserve authored cells and each gesture has one undo entry',async()=>{
    await select(0);assert.equal(await page.locator('#connect-grid').isEnabled(),true);
    const first=await clickEdit('connect-grid');assert.equal(first.document.format,'ai_scene_document_v6');assert.equal(first.history.undoDepth,1);assert.equal(first.document.terrainConnections.length,1);
    await select(2);const second=await clickEdit('connect-grid');assert.equal(second.history.undoDepth,2);assert.equal(second.document.terrainConnections.length,2);
    assert.deepEqual(second.document.terrainRuns,original.document.terrainRuns);assert.equal(second.scene.mixedTerrains.length,1);assert.equal(second.scene.collisionSuggestions.mixedContours.length,1);assert.equal(second.scene.collisionSuggestions.curveContours.length,0);
    await clickEdit('undo');assert.equal((await snapshot()).document.terrainConnections.length,1);await clickEdit('redo');assert.equal((await snapshot()).scene.contentSha256,second.scene.contentSha256);
  });
  await t.test('shared mesh has no sampled background gap at either interface at three zoom levels',async()=>{
    await select(1);await page.getByRole('checkbox',{name:'网格',exact:true}).uncheck();await page.getByRole('checkbox',{name:'显示图层 environment',exact:true}).uncheck();await page.getByRole('checkbox',{name:'显示图层 background',exact:true}).uncheck();
    const before=await snapshot();
    for(let zoom=0;zoom<3;zoom++){
      const bounds=await page.locator('canvas').boundingBox(),png=inspectPng(await scenePixels(page),{includePixels:true});
      for(const x of [256,768])for(const y of [480,512,544]){const p=await point(x,y);for(const dx of [-1,0,1]){const index=(Math.floor(p.y-bounds.y)*png.width+Math.floor(p.x-bounds.x)+dx)*4;assert.notDeepEqual([...png.rgba.subarray(index,index+3)],[29,43,59]);}}
      if(zoom<2)await page.getByRole('button',{name:'放大',exact:true}).click();
    }
    assert.equal((await snapshot()).scene.contentSha256,before.scene.contentSha256);await select(1);await (await canvasField(page,'collision')).check();await capture('mixed-two-sided.png');
  });
  await t.test('connected endpoints are locked; disconnect allows a move and a later button reconnects',async()=>{
    await select(0);assert.equal(await (await canvasField(page,'curve-x')).isDisabled(),true);const before=await snapshot(),a=await point(256,448),b=await point(280,448);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up();assert.equal((await snapshot()).scene.contentSha256,before.scene.contentSha256);
    await clickEdit('disconnect-grid');assert.equal(await (await canvasField(page,'curve-x')).isEnabled(),true);await (await canvasField(page,'curve-x')).fill('257');await clickEdit('apply-curve');
    const after=await clickEdit('connect-grid');assert.equal(after.scene.contentSha256,before.scene.contentSha256);
  });
  await t.test('pending grid snap cancels four ways without a commit, then one release reconnects',async()=>{
    await select(0);await clickEdit('disconnect-grid');await (await canvasField(page,'curve-x')).fill('300');await clickEdit('apply-curve');const before=await snapshot();
    async function begin(){const a=await point(300,448),b=await point(260,448);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);assert.equal(await page.locator('#canvas-host').getAttribute('data-grid-connection'),'ready');}
    for(const type of ['escape','blur','pointercancel','lostpointercapture']){await begin();if(type==='escape')await page.keyboard.press('Escape');else await page.evaluate(v=>v==='blur'?window.dispatchEvent(new Event('blur')):document.querySelector('canvas').dispatchEvent(new PointerEvent(v,{pointerId:1})),type);await page.mouse.up();assert.equal((await snapshot()).scene.contentSha256,before.scene.contentSha256);assert.deepEqual((await snapshot()).history,before.history);}
    await begin();assert.equal((await snapshot()).revision,before.revision);await page.mouse.up();await waitRevision(before.revision);const after=await snapshot();assert.equal(after.document.terrainConnections.length,2);assert.equal(after.history.undoDepth,before.history.undoDepth+1);assert.equal(after.document.curveTerrains[0].points[0].x,256);
  });
  await t.test('reshaping a connected rectangle explicitly unlinks once and undo restores it; unrelated grid editing keeps links',async()=>{
    const before=await snapshot();await page.getByRole('button',{name:'擦除 E',exact:true}).click();await (await canvasField(page,'cell-x')).fill('0');await (await canvasField(page,'cell-y')).fill('7');await page.locator('#apply-cell').click();await waitRevision(before.revision);const reshaped=await snapshot();assert.equal(reshaped.scene.counts.terrainNodes,15);assert.equal(reshaped.document.terrainConnections.length,1);assert.deepEqual(reshaped.document.curveTerrains,before.document.curveTerrains);assert.equal(reshaped.history.undoDepth,before.history.undoDepth+1);assert.equal(await page.locator('#status').getAttribute('data-error'),'false');await clickEdit('undo');assert.deepEqual((await snapshot()).document,before.document);
    await page.getByRole('button',{name:'画刷 B',exact:true}).click();await (await canvasField(page,'cell-x')).fill('20');await (await canvasField(page,'cell-y')).fill('8');const changed=await clickEdit('apply-cell');assert.equal(changed.scene.counts.terrainNodes,17);await clickEdit('undo');assert.equal((await snapshot()).scene.contentSha256,before.scene.contentSha256);
  });
  await t.test('mixed template, v6 save/import and responsive controls retain the same editable map',async()=>{
    const before=await snapshot(),added=await clickEdit('add-mixed');assert.equal(added.scene.mixedTerrains.length,2);assert.equal(added.document.terrainConnections.length,4);assert.equal(added.history.undoDepth,before.history.undoDepth+1);await clickEdit('undo');assert.equal((await snapshot()).scene.contentSha256,before.scene.contentSha256);
    const saved=await snapshot(),event=page.waitForEvent('download');await page.locator('#download-menu>summary').click();await page.locator('#save').click();const download=await event,file=join(context.parent,'mixed.saved.json');await download.saveAs(file);assert.deepEqual(JSON.parse(readFileSync(file)),saved.document);await page.locator('#file').setInputFiles(file);await waitRevision(saved.revision);assert.equal((await snapshot()).scene.contentSha256,saved.scene.contentSha256);
    for(const width of [1440,1024,390]){await page.setViewportSize({width,height:1050});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('#connect-grid').isVisible(),true);}await capture('mixed-narrow.png');
  });
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(external,[]);
});
