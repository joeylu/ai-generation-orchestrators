import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';import {join,resolve,dirname,basename} from 'node:path';import {tmpdir} from 'node:os';
import {buildStudio,dependency,packageRoot} from '../../scripts/studio-build.mjs';import {startStudio} from '../../src/studio/host.mjs';import {loadSceneKit,readMap} from '../../src/index.mjs';

test('preset palette: pointer drag, unit-layer routing, blocked footprint and cancellation',{timeout:120000},async t=>{
 const base=resolve(tmpdir()),temp=mkdtempSync(join(base,'scene-preset-drag-'));let browser,host;
 t.after(async()=>{await browser?.close();await host?.close();assert.equal(dirname(temp),base);assert(basename(temp).startsWith('scene-preset-drag-'));rmSync(temp,{recursive:true,force:true});});
 const root=join(packageRoot,'tests/fixtures/synthetic'),map=readMap(loadSceneKit(root));map.terrainRuns=[];map.instances=[];map.assemblyInstances=[];
 map.layers.find(l=>l.layerId==='environment').parallax.x=.65;map.layers.push({layerId:'unit.presets',kind:'environment',zIndex:99,parallax:{x:1,y:1},visible:true});
 const staticRoot=await buildStudio({output:join(temp,'static')});host=await startStudio({root,staticRoot,initialDocument:map});
 const {chromium}=dependency('playwright').require('playwright');browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
 await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():r.abort());await page.goto(host.url);try{await page.waitForSelector('body[data-ready="true"]');}catch(error){console.error(JSON.stringify({errors,loading:await page.locator('#loading').textContent(),status:await page.locator('#status').textContent()}));throw error;}
 const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),rev=n=>page.waitForFunction(n=>+document.body.dataset.revision>n,n,{timeout:8000});
 async function screen(x,y){const rect=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:rect.x+(x-v.x)/v.w*rect.width,y:rect.y+(y-v.y)/v.h*rect.height};}
 async function drag(id,target,{release=true}={}){const b=await page.locator(`[data-asset-kind="preset"][data-asset-id="${id}"]`).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+15,b.y+b.height/2,{steps:4});await page.mouse.move(target.x,target.y,{steps:15});if(release)await page.mouse.up();}
 const initial=await snap();await page.getByRole('button',{name:'展开或收起分组 空图层',exact:true}).click();
 await page.locator('.layer-heading .layer-title[title="background"]').click();await page.getByRole('button',{name:'组合',exact:true}).click();
 assert.equal(await page.locator('#palette svg.preset-art-preview').count(),initial.presets.length);assert.equal(await page.locator('#palette .preset-preview,#palette svg rect').count(),0);
 for(const preset of initial.presets){const thumbnail=page.locator(`[data-asset-kind="preset"][data-asset-id="${preset.presetId}"] svg`),urls=await thumbnail.locator('image').evaluateAll(images=>images.map(image=>image.getAttribute('href')));
   assert.deepEqual(urls,preset.thumbnail.nodes.map(node=>initial.modules.find(module=>module.assetId===node.assetId).url));assert.ok((await thumbnail.boundingBox()).width>60);}
 assert.equal((await snap()).revision,initial.revision);assert.deepEqual((await snap()).history,initial.history);
 for(const preset of initial.presets){
  const before=await snap();await drag(preset.presetId,await screen(130,130));await rev(before.revision);const placed=await snap(),item=placed.document.assemblyInstances.find(i=>i.instanceId.startsWith('user.'));
  assert(item,'drag creates an assembly');assert.equal(item.layerId,'unit.presets','terrain presets use a unit-parallax layer even when background is active');assert.equal(placed.history.undoDepth,1);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await rev(placed.revision);assert.equal((await snap()).scene.source.authorSha256,initial.scene.source.authorSha256);
 }
 const id=initial.presets[0].presetId;
 for(const cancellation of ['escape','blur','pointercancel','lostpointercapture']){
  const before=await snap();await drag(id,await screen(130,130),{release:false});assert.equal((await snap()).revision,before.revision);assert.equal(await page.locator('#canvas-host').getAttribute('data-drop-valid'),'true');
  if(cancellation==='escape')await page.keyboard.press('Escape');else await page.locator(`[data-asset-kind="preset"][data-asset-id="${id}"]`).evaluate((el,type)=>type==='blur'?window.dispatchEvent(new Event('blur')):el.dispatchEvent(new PointerEvent(type,{pointerId:1})),cancellation);
  await page.mouse.up();assert.equal((await snap()).revision,before.revision);assert.deepEqual((await snap()).history,before.history);
 }
 const beforeOutside=await snap();await drag(id,await screen(130,-100),{release:false});assert.equal(await page.locator('#canvas-host').getAttribute('data-drop-valid'),'false');await page.mouse.up();assert.equal((await snap()).revision,beforeOutside.revision);assert.equal(await page.locator('#status').getAttribute('data-error'),'true');
 await drag(id,await screen(130,130));await rev(beforeOutside.revision);const placed=await snap();await drag(id,await screen(130,130),{release:false});assert.equal(await page.locator('#canvas-host').getAttribute('data-drop-valid'),'false');await page.mouse.up();assert.equal((await snap()).revision,placed.revision);assert.deepEqual((await snap()).history,placed.history);
 await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.equal(await page.locator(`[data-asset-kind="preset"][data-asset-id="${id}"]`).isDisabled(),true);await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();assert.equal(await page.locator(`[data-asset-kind="preset"][data-asset-id="${id}"]`).isEnabled(),true);
 if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'preset-drag.png')});}
 assert.deepEqual(errors,[]);
});
