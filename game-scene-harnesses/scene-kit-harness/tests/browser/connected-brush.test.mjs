import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';
import {startStudio} from '../../src/studio/host.mjs';
import {loadSceneKit} from '../../src/kit.mjs';
import {connectedMap} from '../helpers/mixed.mjs';
import {fixtureRoot} from '../helpers/generation.mjs';
import {dismissCanvasPanels} from './canvas-controls.mjs';
import {readStoredArchive} from '../../src/archive.mjs';

test('brush reshapes connected platforms with explicit atomic unlinking, exact history and portable persistence',{timeout:120000},async t=>{
 const base=resolve(tmpdir()),temp=mkdtempSync(join(base,'scene-connected-brush-'));let browser,host;
 t.after(async()=>{await browser?.close();await host?.close();assert.equal(dirname(temp),base);rmSync(temp,{recursive:true,force:true});});
 const staticRoot=await buildStudio({output:join(temp,'static')}),workspaceRoot=join(temp,'workspace');host=await startStudio({root:fixtureRoot,staticRoot,initialDocument:connectedMap(loadSceneKit(fixtureRoot)),workspaceRoot,projectName:'Brush fixture'});
 const {chromium}=dependency('playwright').require('playwright');browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[],edits=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});page.on('request',r=>{if(r.url()===host.url+'/api/edit')edits.push(r.postDataJSON());});
 await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));await page.goto(host.url+'/editor');await page.waitForSelector('body[data-ready="true"]');
 const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),revision=r=>page.waitForFunction(n=>+document.body.dataset.revision>n,r);
 async function point(x,y){await dismissCanvasPanels(page);const b=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:b.x+(x-v.x)/v.w*b.width,y:b.y+(y-v.y)/v.h*b.height};}
 async function begin(x1,y1,x2=x1,y2=y1){const a=await point((x1+.5)*64,(y1+.5)*64),b=await point((x2+.5)*64,(y2+.5)*64);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});}
 async function unchanged(before){const after=await snap();assert.deepEqual(after.document,before.document);assert.deepEqual(after.history,before.history);assert.equal(after.revision,before.revision);}
 const initial=await snap();await page.getByRole('button',{name:'画刷 B',exact:true}).click();
 await begin(2,6,3,6);await unchanged(initial);await page.mouse.up();await revision(initial.revision);const painted=await snap();
 assert.equal(edits.length,1);assert.deepEqual(edits[0].commands.map(c=>c.type),['enable-layered-terrain','disconnect-curve-grid','paint-cells']);assert.equal(painted.history.undoDepth,1);assert.equal(painted.scene.counts.terrainNodes,initial.scene.counts.terrainNodes+2);assert.equal(painted.document.format,'ai_scene_document_v6');
 assert.deepEqual(painted.document.curveTerrains,initial.document.curveTerrains);assert.deepEqual(painted.document.terrainConnections,initial.document.terrainConnections.filter(c=>c.endpoint==='end'));assert.equal(await page.locator('#status').isVisible(),true);assert.equal(await page.locator('#status').getAttribute('data-error'),'false');assert.match(await page.locator('#status').innerText(),/接头已解除/);
 if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'connected-brush-steps.png')});}
 await page.getByRole('button',{name:'撤销',exact:true}).click();await revision(painted.revision);const restored=await snap();assert.deepEqual(restored.document,initial.document);assert.equal(restored.history.redoDepth,1);
 const requestCount=edits.length;for(const type of ['escape','right','blur','pointercancel','lostpointercapture']){
  await begin(2,6,3,6);if(type==='escape')await page.keyboard.press('Escape');else if(type==='right'){await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});}else await page.locator('canvas').evaluate((e,type)=>type==='blur'?window.dispatchEvent(new Event('blur')):e.dispatchEvent(new PointerEvent(type,{pointerId:1})),type);await page.mouse.up();await unchanged(restored);
 }assert.equal(edits.length,requestCount);
 await page.getByRole('button',{name:'锁定图层 terrain',exact:true}).click();await begin(2,6,3,6);await page.mouse.up();await unchanged(restored);assert.equal(edits.length,requestCount);await page.getByRole('button',{name:'锁定图层 terrain',exact:true}).click();
 await begin(3,6,7,7);await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#status').dataset.error==='true');await unchanged(restored);assert.match(await page.locator('#status').innerText(),/曲线实体重叠/);assert.equal(edits.length,requestCount+1);
 await page.getByRole('button',{name:'重做',exact:true}).click();await revision(restored.revision);assert.deepEqual((await snap()).document,painted.document);
 let before=await snap();await page.getByRole('button',{name:'擦除 E',exact:true}).click();await begin(12,7);await page.mouse.up();await revision(before.revision);const erased=await snap();assert.equal(erased.document.terrainConnections.length,0);assert.equal(erased.history.undoDepth,2);assert.equal(edits.at(-1).commands[0].type,'disconnect-curve-grid');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await revision(erased.revision);assert.deepEqual((await snap()).document,painted.document);
 before=await snap();await page.getByRole('button',{name:'画刷 B',exact:true}).click();await begin(7,2,8,2);await page.mouse.up();await revision(before.revision);const upper=await snap();assert.equal(edits.at(-1).commands.length,1);assert.deepEqual(upper.document.terrainConnections,painted.document.terrainConnections);assert.equal(upper.scene.counts.terrainNodes,painted.scene.counts.terrainNodes+2);
 await page.reload();await page.waitForSelector('body[data-ready="true"]');assert.deepEqual((await snap()).document,upper.document);const saved=JSON.parse(readFileSync(join(workspaceRoot,'workspace.json')));assert.deepEqual(saved.projects[0].maps[0].document,upper.document);
 const event=page.waitForEvent('download');await page.locator('#download-menu>summary').click();await page.locator('#export-pack').click();const download=await event,file=join(temp,'connected-brush.zip');await download.saveAs(file);const files=readStoredArchive(readFileSync(file));assert.deepEqual(JSON.parse(files.get('scene.document.json')),upper.document);
 const expected=errors.filter(e=>e.includes('422 (Unprocessable Entity)'));assert.equal(expected.length,1);assert.deepEqual(errors.filter(e=>!expected.includes(e)),[]);assert.deepEqual(external,[]);
});
