import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';import {join,resolve,dirname} from 'node:path';import {tmpdir} from 'node:os';
import {buildStudio,dependency} from '../../scripts/studio-build.mjs';import {startStudio} from '../../src/studio/host.mjs';import {loadSceneKit,readMap} from '../../src/kit.mjs';import {fixtureRoot} from '../helpers/generation.mjs';

test('UX closure: synchronized selection, intentional placement, dismissible overlays and truthful save/dialog feedback',{timeout:120000},async t=>{
 const base=resolve(tmpdir()),temp=mkdtempSync(join(base,'scene-ux-closure-'));let browser,host;
 t.after(async()=>{await browser?.close();await host?.close();assert.equal(dirname(temp),base);rmSync(temp,{recursive:true,force:true});});
 const document=readMap(loadSceneKit(fixtureRoot));document.terrainRuns=[];document.assemblyInstances=[];document.inspectionCases=[];document.instances=[{instanceId:'ux.marker',assetId:'environment-marker',layerId:'environment',x:400,y:200}];
 const staticRoot=await buildStudio({output:join(temp,'static')});host=await startStudio({root:fixtureRoot,staticRoot,initialDocument:document,workspaceRoot:join(temp,'workspace'),projectName:'UX fixture'});
 const {chromium}=dependency('playwright').require('playwright');browser=await chromium.launch({headless:true,channel:process.env.SCENE_KIT_BROWSER_CHANNEL??'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--explicitly-allowed-ports='+new URL(host.url).port]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[],edits=[],expectedHttp=[];
 await page.addInitScript(()=>{
   let clears=0;
   for(const gl of [WebGLRenderingContext,WebGL2RenderingContext]){
     const clear=gl.prototype.clear;
     gl.prototype.clear=function(...args){clears++;return clear.apply(this,args);};
   }
   window.canvasClears=()=>clears;
 });
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(!['error','warning'].includes(m.type()))return;const url=m.location().url;
  if((url===host.url+'/api/edit'&&m.text().includes('net::ERR_FAILED'))||(url.startsWith(host.url+'/api/projects/export?')&&m.text().includes('409 (Conflict)')))expectedHttp.push(m.text());else errors.push(m.text());});
 page.on('request',r=>{if(r.url()===host.url+'/api/edit')edits.push(r.postDataJSON());});
 await page.route('**/*',r=>new URL(r.request().url()).origin===host.url?r.continue():(external.push(r.request().url()),r.abort()));await page.goto(host.url+'/editor');await page.waitForSelector('body[data-ready="true"]');
 const idle=await page.evaluate(async()=>{
   const frames=async count=>{for(let i=0;i<count;i++)await new Promise(requestAnimationFrame);};
   await frames(4);
   const before=window.canvasClears();
   await frames(6);
   return {before,after:window.canvasClears()};
 });
 assert(idle.before>0);
 assert.equal(idle.after,idle.before,'static canvas should retain its last frame while idle');
 const snap=()=>page.evaluate(async()=>(await fetch('/api/state')).json()),revision=r=>page.waitForFunction(n=>+document.body.dataset.revision>n,r);
 async function point(x,y){const b=await page.locator('canvas').boundingBox(),v=await page.locator('#minimap rect').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),w:+e.getAttribute('width'),h:+e.getAttribute('height')}));return{x:b.x+(x-v.x)/v.w*b.width,y:b.y+(y-v.y)/v.h*b.height};}
 async function clickWorld(x,y){const p=await point(x,y);await page.mouse.click(p.x,p.y);}
 const initial=await snap();assert.equal(await page.locator('#download-menu>summary').isVisible(),true);
 await page.locator('#tab-terrain').click();const brush=page.getByRole('button',{name:'地形画刷',exact:true});await brush.click();assert.equal(await brush.getAttribute('aria-pressed'),'true');
 await page.locator('[data-instance-id="ux.marker"]').click();assert.equal(await brush.getAttribute('aria-pressed'),'false');assert.equal(await page.locator('body').getAttribute('data-active-tool'),'select');assert.equal(edits.length,0);
 await page.locator('#tab-environment').click();const module=page.locator('#palette [data-asset-id="environment-marker"]');await module.click();assert.equal(await module.getAttribute('aria-pressed'),'true',JSON.stringify(await page.evaluate(()=>({tool:document.body.dataset.activeTool,card:document.querySelector('#palette [data-asset-id="environment-marker"]').outerHTML}))));await page.locator('[data-instance-id="ux.marker"]').click();assert.equal(await module.getAttribute('aria-pressed'),'false');
 await page.locator('#tab-curves').click();const hill=page.getByRole('button',{name:'丘陵',exact:true});await hill.click();assert.equal(await hill.getAttribute('aria-pressed'),'true');assert.equal(await page.locator('body').getAttribute('data-active-tool'),'place-curve');assert.deepEqual((await snap()).document,initial.document);assert.equal(edits.length,0);
 await page.locator('#canvas-options>summary').click();
 await page.keyboard.press('Escape');assert.equal(await hill.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#canvas-options').evaluate(e=>e.open),false);
 await page.keyboard.press('Escape');assert.equal(await hill.getAttribute('aria-pressed'),'false');assert.equal(await page.locator('body').getAttribute('data-active-tool'),'select');assert.equal(edits.length,0);
 await hill.click();await clickWorld(650,320);await revision(initial.revision);const curved=await snap();assert.equal(curved.document.bounds.width,initial.document.bounds.width);assert.equal(curved.document.curveTerrains.length,1);assert.equal(curved.document.curveTerrains[0].points[0].x,640);assert.ok(Math.abs(curved.document.curveTerrains[0].points[0].y-320)<=1);assert.equal(curved.history.undoDepth,1);assert.equal(edits.length,1);
 await page.locator('#tab-environment').click();await module.click();await clickWorld(744,179);await revision(curved.revision);const placed=await snap(),item=placed.document.instances.find(i=>i.instanceId!=='ux.marker');assert.ok(Math.abs(item.x-744)<=1);assert.ok(Math.abs(item.y-179)<=1);assert.equal(await module.getAttribute('aria-pressed'),'false');
 await page.getByRole('button',{name:'对象属性',exact:true}).click();assert.equal(await page.locator('#canvas-properties').isVisible(),true);await page.locator('#canvas-options>summary').click();assert.equal(await page.locator('#canvas-options').evaluate(e=>e.open),true);assert.equal(await page.locator('#canvas-properties').isVisible(),false);await page.keyboard.press('Escape');assert.equal(await page.locator('#canvas-options').evaluate(e=>e.open),false);
 await page.getByRole('button',{name:'对象属性',exact:true}).click();await page.locator('#tab-terrain').click();assert.equal(await page.locator('#canvas-properties').isVisible(),false);
 await brush.click();await page.setViewportSize({width:760,height:900});const libraryButton=page.getByRole('button',{name:'模块库',exact:true}),layersButton=page.getByRole('button',{name:'图层面板',exact:true});await libraryButton.click();assert.equal(await libraryButton.getAttribute('aria-expanded'),'true');const beforeDismiss=await snap(),count=edits.length,canvas=await page.locator('canvas').boundingBox();await page.mouse.click(canvas.x+canvas.width*.7,canvas.y+canvas.height*.6);assert.equal(await libraryButton.getAttribute('aria-expanded'),'false');assert.equal(edits.length,count);assert.deepEqual((await snap()).document,beforeDismiss.document);
 await layersButton.focus();await page.keyboard.press('Enter');assert.equal(await layersButton.getAttribute('aria-expanded'),'true');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'layer-panel');await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#layer-panel')),true);
 await page.keyboard.press('Escape');assert.equal(await layersButton.getAttribute('aria-expanded'),'false');
 assert.equal(await layersButton.evaluate(button=>document.activeElement===button),true);
 await libraryButton.click();await page.getByRole('button',{name:'Play Mode',exact:true}).click();assert.equal(await libraryButton.getAttribute('aria-expanded'),'false');await page.keyboard.press('Escape');assert.equal(await page.locator('body').getAttribute('data-preview'),'false');assert.deepEqual((await snap()).history,beforeDismiss.history);
 await page.setViewportSize({width:1440,height:1000});await page.locator('#project-switch').click();await page.locator('#project-file').evaluate(input=>{const file=new File(['x'],'too-large.zip');Object.defineProperty(file,'size',{value:129*1024*1024});const data=new DataTransfer();data.items.add(file);input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));});assert.match(await page.locator('#project-dialog .project-message').innerText(),/128 MiB/);
 const failedDownload=async r=>r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'STALE_REVISION'})});await page.route('**/api/projects/export?revision=*',failedDownload);await page.getByRole('button',{name:'下载当前项目',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#project-dialog .project-message').textContent.includes('另一个窗口'));assert.equal(await page.getByRole('button',{name:'下载当前项目',exact:true}).isEnabled(),true);await page.unroute('**/api/projects/export?revision=*',failedDownload);
 if(process.env.SCENE_KIT_SCREENSHOTS){mkdirSync(process.env.SCENE_KIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'ux-project-error-visible.png')});}await page.getByRole('button',{name:'关闭',exact:true}).click();assert.deepEqual((await snap()).document,beforeDismiss.document);
 let release;
 const gate=new Promise(resolve=>release=resolve),delayed=async r=>{await gate;await r.continue();};
 await page.route('**/api/edit',delayed);
 let before=await snap();
 const beforeStroke=edits.length,canvasHost=page.locator('#canvas-host'),beforeDraw=await page.evaluate(()=>window.canvasClears());
 await clickWorld(160,160);
 try {
   await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='正在保存到本机…');
   assert.equal(await brush.isDisabled(),true);
   assert.equal(await canvasHost.getAttribute('data-pending-gesture'),'paint');
   assert.match(await page.locator('#status').innerText(),/完成后可继续绘制/);
   await page.waitForFunction(n=>window.canvasClears()>n,beforeDraw);
   await clickWorld(224,160);
   assert.equal(await canvasHost.getAttribute('data-pending-gesture'),'paint');
   assert.equal(edits.length,beforeStroke+1);
   assert.deepEqual((await snap()).history,before.history);
 } finally {release();}
 await revision(before.revision);
 await page.unroute('**/api/edit',delayed);
 assert.equal(await page.locator('#save-state').innerText(),'已保存到本机');
 assert.equal(await canvasHost.getAttribute('data-pending-gesture'),'');
 const failSave=async r=>r.abort('failed');await page.route('**/api/edit',failSave);before=await snap();const beforeFailureRequests=edits.length;await clickWorld(224,160);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='保存结果待核对'&&!document.querySelector('#canvas-host').dataset.pendingGesture);assert.match(await page.locator('#status').innerText(),/连接已中断.*尚未确认/);assert.deepEqual((await snap()).document,before.document);assert.deepEqual((await snap()).history,before.history);assert.equal(edits.length,beforeFailureRequests+1);await page.unroute('**/api/edit',failSave);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#save-state').isVisible(),true);
 const toolbarRows=await page.locator('.toolbar').evaluate(toolbar=>new Set([...toolbar.children].map(control=>{
   const rect=control.getBoundingClientRect();return Math.round((rect.top+rect.bottom)/2);
 })).size);
 assert.equal(toolbarRows,1);
 await page.locator('#download-menu>summary').click();
 for(const name of ['地图 JSON','场景资源 ZIP','整个项目 ZIP'])
   assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),true,name);
 await page.keyboard.press('Escape');
 if(process.env.SCENE_KIT_SCREENSHOTS)await page.screenshot({path:join(process.env.SCENE_KIT_SCREENSHOTS,'ux-save-connection-feedback.png')});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(expectedHttp.length,2);
});
