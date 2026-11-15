import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {prepareTerrainSkinConversion} from '../helpers/terrain-skin-conversion.mjs';
import {canvasField,selectObject,dismissCanvasPanels,scenePixels} from './canvas-controls.mjs';
import {sha256} from '../../src/validate.mjs';

test('explicit platform conversion replaces the full image once, respects locks and lets the shared brush extend all four sides',{timeout:900000},async t=>{
  const f=prepareTerrainSkinConversion(t),staticRoot=await buildStudio({output:join(f.f.parent,'conversion-static')}),
    host=await startStudio({root:f.root,staticRoot,initialDocument:f.map});t.after(()=>host.close());
  const {chromium}=dependency('playwright').require('playwright'),browser=await chromium.launch({headless:true,
    ...(process.env.SCENE_KIT_BROWSER_CHANNEL?{channel:process.env.SCENE_KIT_BROWSER_CHANNEL}:{}),
    args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1}),errors=[],warnings=[],external=[],edits=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/edit')edits.push(r.postDataJSON());});
  await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));
  await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]',{timeout:90000});
  const state=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),wait=r=>page.waitForFunction(v=>+document.body.dataset.revision>v,r),
    conversion=page.locator('#convert-terrain-skin'),initial=await state();
  assert.equal(initial.scene.terrainSkins.length,1);assert.equal(initial.history.undoDepth,0);
  await selectObject(page,'conversion.platform');
  assert.equal(await conversion.isVisible(),true);assert.equal(await conversion.isDisabled(),false);
  assert.match(await page.locator('#terrain-conversion-note').innerText(),/替换整图外观.*一次撤销可恢复/);
  const terrainLayer=initial.document.layers.find(l=>l.kind==='terrain').layerId;
  for(const layer of [f.layerId,terrainLayer]){
    const lock=page.getByRole('button',{name:'锁定图层 '+layer,exact:true});await lock.click();assert.equal(await conversion.isDisabled(),true);
    assert.deepEqual((await state()).document,initial.document);assert.deepEqual((await state()).history,initial.history);await lock.click();
    assert.equal(await conversion.isDisabled(),false);
  }
  const eye=page.getByRole('checkbox',{name:'显示图层 '+f.layerId,exact:true});await eye.uncheck();assert.equal(await conversion.isDisabled(),true);await eye.check();
  await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.equal(await conversion.isDisabled(),true);
  await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();assert.equal(await conversion.isDisabled(),false);
  assert.deepEqual((await state()).document,initial.document);assert.deepEqual((await state()).history,initial.history);
  await dismissCanvasPanels(page);const beforePixels=sha256(await scenePixels(page));
  await conversion.click();await wait(initial.revision);const converted=await state();
  assert.equal(converted.history.undoDepth,1);assert.equal(converted.scene.terrainSkins.length,0);
  assert.equal(converted.scene.counts.terrainNodes,initial.scene.counts.terrainNodes);assert.deepEqual(converted.scene.collisionSuggestions,initial.scene.collisionSuggestions);
  assert.equal(converted.scene.counts.visualNodes,initial.scene.counts.visualNodes-1);
  assert(converted.scene.gridTerrains.length>0);assert(converted.scene.terrainBottomEdgePlacement.placed.length>0);
  assert.notEqual(sha256(await scenePixels(page)),beforePixels,'the real Pixi frame must replace the complete source with shared terrain');
  assert.equal(edits.filter(e=>e.commands?.some(c=>c.type==='convert-terrain-skin')).length,1);
  assert.deepEqual(edits.find(e=>e.commands?.some(c=>c.type==='convert-terrain-skin')).commands,[{type:'convert-terrain-skin',instanceId:'conversion.platform'}]);
  assert.match(await page.locator('#status').innerText(),/替换完整平台外观.*一次撤销可恢复/);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await wait(converted.revision);const restored=await state();
  assert.deepEqual(restored.document,initial.document);assert.deepEqual(restored.scene,initial.scene);
  await page.getByRole('button',{name:'重做',exact:true}).click();await wait(restored.revision);
  await page.getByRole('button',{name:'画刷 B',exact:true}).click();
  for(const [x,y]of [[5,3],[6+f.width,3],[6,2],[6,3+f.height]]){
    const before=await state();await(await canvasField(page,'cell-x')).fill(String(x));await(await canvasField(page,'cell-y')).fill(String(y));
    await(await canvasField(page,'apply-cell')).click();await wait(before.revision);const after=await state();
    assert.equal(after.history.undoDepth,before.history.undoDepth+1);assert.equal(after.scene.counts.terrainNodes,before.scene.counts.terrainNodes+1);
    assert.equal(after.scene.terrainSkins.length,0);assert(after.scene.terrainBottomEdgePlacement.placed.length>0);
  }
  const extended=await state();assert.equal(extended.scene.counts.terrainNodes,initial.scene.counts.terrainNodes+4);
  await dismissCanvasPanels(page);
  for(let i=0;i<5;i++){const before=await state();await page.getByRole('button',{name:'撤销',exact:true}).click();await wait(before.revision);}
  assert.deepEqual((await state()).document,initial.document);assert.deepEqual((await state()).scene,initial.scene);
  await selectObject(page,'conversion.platform');await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('canvas').width===Math.round(document.querySelector('#canvas-host').clientWidth));
  await dismissCanvasPanels(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const box=await page.locator('#selection-tools').boundingBox();assert(box.x>=0&&box.x+box.width<=390,'conversion tools must fit the narrow canvas');
  if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'terrain-skin-conversion-mobile.png'),fullPage:true});}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert(warnings.every(v=>/ReadPixels|GPU stall|deprecated|powerPreference/i.test(v)),warnings.join('\n'));
});
