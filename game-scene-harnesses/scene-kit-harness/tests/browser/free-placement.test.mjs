import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync} from 'node:fs';import {join,resolve,dirname,basename} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {buildStudio,dependency,packageRoot} from '../../scripts/studio-build.mjs';import {startStudio} from '../../src/studio/host.mjs';import {scenePixels} from './canvas-controls.mjs';

test('free workspace: outside drop, Play Mode clipping, camera restore and saved negative coordinates',{timeout:120000},async t=>{
 const base=resolve(tmpdir()),temp=mkdtempSync(join(base,'scene-free-workspace-'));let browser,host;
 t.after(async()=>{await browser?.close();await host?.close();assert.equal(dirname(temp),base);assert(basename(temp).startsWith('scene-free-workspace-'));rmSync(temp,{recursive:true,force:true});});
 const staticRoot=await buildStudio({output:join(temp,'static')});host=await startStudio({root:join(packageRoot,'tests/fixtures/synthetic'),staticRoot});
 const {chromium}=dependency('playwright').require('playwright');browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
 await page.route('**/*',route=>new URL(route.request().url()).origin===host.url?route.continue():(external.push(route.request().url()),route.abort()));
 await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]');assert.match(await page.title(),/Scene Kit Studio/);assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
 const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),revision=n=>page.waitForFunction(n=>+document.body.dataset.revision>n,n),hash=b=>createHash('sha256').update(b).digest('hex');
 const visible=()=>page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));
 async function screen(x,y){const box=await page.locator('canvas').boundingBox(),v=await visible();return{x:box.x+(x-v.x)/v.width*box.width,y:box.y+(y-v.y)/v.height*box.height};}
 async function shot(name){if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,name)});}}
 const initial=await snap();await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.equal(await page.locator('#game-frame').isChecked(),true);assert.equal(await page.locator('.toolbar').isVisible(),false);
 const baseline=hash(await scenePixels(page));await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();
 const button=page.locator('#palette [data-asset-id="environment-marker"]'),b=await button.boundingBox(),target=await screen(640,-140);
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+15,b.y+b.height/2,{steps:4});await page.mouse.move(target.x,target.y,{steps:16});await page.mouse.up();await revision(initial.revision);
 const staged=await snap(),item=staged.document.instances.find(i=>i.instanceId.startsWith('user.'));assert(item);assert(item.y<0&&Math.abs(item.y+140)<=2,'drop stays near the intended negative world coordinate after browser pixel rounding');assert.equal(staged.document.format,'ai_scene_document_v5');assert.equal(staged.history.undoDepth,1);assert.deepEqual(staged.scene.worldBounds,initial.scene.worldBounds);
 let node=staged.scene.layers.flatMap(l=>l.nodes).find(n=>n.nodeId==='visual/'+item.instanceId);assert(node.position.y+node.size.height<0);await shot('free-workspace-editor.png');
 const editCamera=await visible();await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.equal(hash(await scenePixels(page)),baseline);await shot('free-workspace-play.png');
 const playCamera=await visible(),canvasBox=await page.locator('canvas').boundingBox();
 await page.mouse.move(canvasBox.x+canvasBox.width*.65,canvasBox.y+canvasBox.height/2);await page.mouse.down();await page.mouse.move(canvasBox.x+canvasBox.width*.45,canvasBox.y+canvasBox.height/2,{steps:10});await page.mouse.up();assert((await visible()).x>playCamera.x,'left mouse drag pans through the playable world');
 assert.equal((await snap()).scene.source.authorSha256,staged.scene.source.authorSha256);assert.deepEqual((await snap()).history,staged.history);
 await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();assert.deepEqual(await visible(),editCamera);
 const saved=page.waitForEvent('download');await page.locator('#download-menu>summary').click();await page.locator('#save').click();await(await saved).saveAs(join(temp,'staged.json'));assert.deepEqual(JSON.parse(readFileSync(join(temp,'staged.json'))),staged.document);
 const start=await screen(node.position.x+node.size.width/2,node.position.y+node.size.height/2),end=await screen(node.position.x+node.size.width/2,node.position.y+node.size.height/2+360);
 assert.equal(await page.evaluate(({x,y})=>{const el=document.elementFromPoint(x,y);return el?.id||el?.tagName;},start),'CANVAS');
 const unchanged = await page.evaluateHandle(() => [
   document.querySelector('#layers').firstElementChild,
   document.querySelector('#palette').firstElementChild,
   document.querySelector('#minimap rect'),
 ]);
 const [moveResponse]=await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname==='/api/edit'&&r.request().method()==='POST'),
   (async()=>{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();})(),
 ]);
 await revision(staged.revision);
 const moved=await snap(),response=await moveResponse.json();
 assert.equal(response.scene,undefined);
 assert.equal(response.scenePatch.baseContentSha256,staged.scene.contentSha256);
 assert.equal(response.scenePatch.contentSha256,moved.scene.contentSha256);
 assert.deepEqual(response.scenePatch.nodes,[moved.scene.layers.flatMap(layer=>layer.nodes).find(n=>n.nodeId===node.nodeId)]);
 assert(await unchanged.evaluate(([layer,palette,terrain]) => layer===document.querySelector('#layers').firstElementChild
   && palette===document.querySelector('#palette').firstElementChild && terrain===document.querySelector('#minimap rect')));
 await unchanged.dispose();
 assert(moved.document.instances.find(i=>i.instanceId===item.instanceId).y>0);await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.notEqual(hash(await scenePixels(page)),baseline);await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();
 await page.locator('#scale-up').click();await revision(moved.revision);assert.equal((await snap()).document.format,'ai_scene_document_v5');
 const scaled=await snap();await page.getByRole('button',{name:'撤销',exact:true}).click();await revision(scaled.revision);assert.equal((await snap()).scene.contentSha256,moved.scene.contentSha256);
 await page.setViewportSize({width:760,height:900});await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('#canvas-host').getAttribute('data-gesture'),'');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
