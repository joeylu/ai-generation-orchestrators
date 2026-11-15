import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';import {join,resolve,dirname,basename} from 'node:path';import {tmpdir} from 'node:os';
import {buildStudio,dependency,packageRoot} from '../../scripts/studio-build.mjs';import {startStudio} from '../../src/studio/host.mjs';import {dismissCanvasPanels} from './canvas-controls.mjs';

test('brush palette: one named brush, read-only advanced tiles, real paint/erase/undo and palette drag',{timeout:120000},async t=>{
 const base=resolve(tmpdir()),temp=mkdtempSync(join(base,'scene-brush-palette-'));let browser,host;
 t.after(async()=>{await browser?.close();await host?.close();assert.equal(dirname(temp),base);assert(basename(temp).startsWith('scene-brush-palette-'));rmSync(temp,{recursive:true,force:true});});
 const staticRoot=await buildStudio({output:join(temp,'static')});host=await startStudio({root:join(packageRoot,'tests/fixtures/synthetic'),staticRoot});
 const {chromium}=dependency('playwright').require('playwright');browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
 await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));await page.goto(host.url);await page.waitForSelector('body[data-ready="true"]');assert.match(await page.title(),/Scene Kit Studio/);assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);
 const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),rev=n=>page.waitForFunction(n=>+document.body.dataset.revision>n,n,{timeout:8000});
 async function screen(x,y){await dismissCanvasPanels(page);const rect=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:rect.x+(x-v.x)/v.w*rect.width,y:rect.y+(y-v.y)/v.h*rect.height};}
 async function stroke(from,to){const a=await screen((from+.5)*64,160),b=await screen((to+.5)*64,160);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();}
 const initial=await snap();assert.equal(initial.brushes.length,1);assert.equal(initial.brushes[0].kind,'terrain');assert.equal(initial.brushes[0].familyId,initial.familyId);
 await page.getByRole('button',{name:'画刷',exact:true}).click();const card=page.getByRole('button',{name:'地形画刷',exact:true});assert.equal(await page.locator('#palette button').count(),1);assert.doesNotMatch(await page.locator('#palette').innerText(),/\b\d{3}\b/);
 const cardStyle=()=>card.evaluate(e=>{const style=getComputedStyle(e);return {background:style.backgroundColor,border:style.borderColor,shadow:style.boxShadow};});
 await page.mouse.move(1000,80);assert.equal(await card.getAttribute('aria-pressed'),'false');const inactiveStyle=await cardStyle();
 await card.click();await page.mouse.move(1000,80);assert.equal(await card.getAttribute('aria-pressed'),'true');const selectedStyle=await cardStyle();
 assert.notEqual(selectedStyle.background,inactiveStyle.background,'active brush needs a visible background beyond its text color');
 assert.notEqual(selectedStyle.border,inactiveStyle.border,'active brush border must survive workbench card overrides');assert.notEqual(selectedStyle.shadow,'none');
 assert.equal(await card.locator('.brush-selected-mark').isVisible(),true);assert.equal(await page.getByRole('button',{name:'画刷 B',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'选择 V',exact:true}).click();assert.equal(await card.getAttribute('aria-pressed'),'false');assert.equal(await card.locator('.brush-selected-mark').isVisible(),false);assert.deepEqual(await cardStyle(),inactiveStyle);
 await page.getByRole('button',{name:'画刷 B',exact:true}).click();assert.deepEqual(await cardStyle(),selectedStyle);assert.equal(await card.locator('.brush-selected-mark').isVisible(),true);
 await page.getByRole('button',{name:'擦除 E',exact:true}).click();assert.equal(await card.getAttribute('aria-pressed'),'false');assert.equal(await card.locator('.brush-selected-mark').isVisible(),false);
 await card.click();await page.mouse.move(1000,80);assert.deepEqual(await cardStyle(),selectedStyle);assert.equal((await snap()).scene.source.authorSha256,initial.scene.source.authorSha256);assert.deepEqual((await snap()).history,initial.history);
 if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.locator('.library').screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'brush-selected.png')});}
 await page.locator('#canvas-options>summary').click();await page.locator('#brush-preview>summary').click();await page.waitForFunction(()=>document.querySelectorAll('#brush-tiles figure').length===47);assert.equal(await page.locator('#brush-tiles figure').count(),47);assert.equal(await page.locator('#brush-tiles button').count(),0);assert.equal((await snap()).revision,initial.revision);await dismissCanvasPanels(page);
 await stroke(9,11);await rev(initial.revision);const painted=await snap();assert.equal(painted.scene.counts.terrainNodes,initial.scene.counts.terrainNodes+3);assert.equal(painted.history.undoDepth,1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await rev(painted.revision);assert.equal((await snap()).scene.contentSha256,initial.scene.contentSha256);
 let before=await snap();await page.getByRole('button',{name:'重做',exact:true}).click();await rev(before.revision);assert.equal((await snap()).scene.contentSha256,painted.scene.contentSha256);
 before=await snap();await page.getByRole('button',{name:'擦除 E',exact:true}).click();await stroke(9,11);await rev(before.revision);assert.equal((await snap()).scene.contentSha256,initial.scene.contentSha256);
 const beforeDrop=await snap(),box=await card.boundingBox(),target=await screen(864,160);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+15,box.y+box.height/2,{steps:4});await page.mouse.move(target.x,target.y,{steps:12});await page.mouse.up();await rev(beforeDrop.revision);
 const dropped=await snap();assert.equal(dropped.scene.counts.terrainNodes,initial.scene.counts.terrainNodes+1);assert.equal(dropped.history.undoDepth,beforeDrop.history.undoDepth+1);assert.equal(await card.getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await rev(dropped.revision);assert.equal((await snap()).scene.contentSha256,initial.scene.contentSha256);
 if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'brush-palette.png')});}
 await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.equal(await card.isDisabled(),true);await page.getByRole('button',{name:'退出 Play Mode',exact:true}).click();assert.equal(await card.isEnabled(),true);
 await page.setViewportSize({width:760,height:900});await page.getByRole('button',{name:'模块库',exact:true}).click();assert.equal(await card.isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
});
