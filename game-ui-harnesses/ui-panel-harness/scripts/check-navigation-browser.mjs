#!/usr/bin/env node
/** Offline fixtures, real pointer/keyboard input, native export data and downloaded delivery. No model calls. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,harnessRoot,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {navigationFixture} from '../examples/navigation-v1/fixture.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {canonicalJson,digestJson,digestBytes} from '../src/canonical.mjs';
const report={status:'NOT_RUN',sourceKind:'PROGRAMMATIC_FIXTURE',modelCalls:0,checks:[],consoleErrors:[],networkRequests:0,nativeUnity:'NOT_RUN',humanVisualReview:'NOT_RUN'};
let browser,output;
try{
  const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output','NAVIGATION_BROWSER_ARGUMENTS');output=await createOutputDirectory(args[1]);
  const [catalog,oldCatalog,base,core]=await Promise.all([readJson(resolve(harnessRoot,'examples/modern-navigation.catalog.json')),readJson(resolve(harnessRoot,'examples/modern-layout.catalog.json')),readJson(resolve(harnessRoot,'examples/settings-controls.panel.json')),loadWorkspaceCore()]);
  report.catalogSha256=await digestJson(catalog);const seed={},pass=name=>report.checks.push({name,status:'PASS'});
  await mkdir(resolve(output,'sources'));await mkdir(resolve(output,'delivery'));
  const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources();
  for(const theme of catalog.themes){
    const before=(await navigationFixture(oldCatalog,base,core,theme.id)).bundle,after=(await navigationFixture(catalog,base,core,theme.id)).bundle;
    assert.deepEqual(before.state,after.state);assert.deepEqual(before.actions,after.actions);assert.deepEqual(before.bindings,after.bindings);
    seed[theme.id]={title:theme.name??theme.id,before,after};
    for(const [side,bundle]of Object.entries({before,after})){await validatePanelBundle(bundle,core);await writeFile(resolve(output,'sources',`${theme.id}.${side}.panel.bundle.json`),canonicalJson(bundle)+'\n',{flag:'wx'});}
    const kit=await createUnityKitFiles(after,core,sources),delivery=await createPanelDelivery(after,core,{runtime,unityKit:kit});
    const files=readStoredZip(createStoredZip(delivery.contents));
    for(const f of delivery.manifest.files){assert.equal(files.get(f.path).length,f.bytes);assert.equal(await digestBytes(files.get(f.path)),f.sha256);}
    assert(![...delivery.contents.keys()].some(p=>p.startsWith('unity/generated/')));assert.equal(kit.manifest.verification.unityImport,'NOT_RUN');
    await writeFile(resolve(output,'delivery',theme.id+'.panel-delivery.zip'),createStoredZip(delivery.contents),{flag:'wx'});pass(theme.id+'-business-bindings-and-delivery-checksums');
  }
  const {build}=await loadWorkspaceTool('vite'),built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,sourcemap:false,lib:{entry:resolve(harnessRoot,'examples/navigation-v1/review.mjs'),name:'NavigationReview',formats:['iife'],fileName:()=> 'review.js'}}});
  const chunks=(Array.isArray(built)?built:[built]).flatMap(r=>r.output);assert.equal(chunks.length,1);await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
  const links=catalog.themes.map(t=>`<a href="?panel=${t.id}">${t.id.replace('modern-','')}</a>`).join('');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>页签主题与状态保留</title><style>*{box-sizing:border-box}body{margin:0;background:#070F17;color:#EAF3F8;font:16px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}header{padding:24px 40px;border-bottom:1px solid #263C4B}h1{font-size:22px;margin:0}small,h2{color:#A8BCC8}nav{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px}a{color:#6CCBE9}main{padding:42px 32px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px}h2{font-size:17px;font-weight:500;text-align:center;margin:0 0 14px}.canvas{width:100%;margin:auto}footer{padding:20px 40px;border-top:1px solid #263C4B;color:#A8BCC8}@media(max-width:900px){header{padding:20px}main{padding:24px 16px;grid-template-columns:minmax(0,1fr)}footer{padding:20px}}</style><header><h1 id="name">页签主题</h1><small>程序化交互样例 · 模型调用为零</small><nav>${links}<a id="download" download>下载当前面板</a></nav></header><main><article><h2>优化前 · Focused-v1</h2><div id="before" class="canvas"></div></article><article><h2>优化后 · Tabs-v1</h2><div id="after" class="canvas"></div></article></main><footer>支持鼠标和方向键切换；可输入角色名、修改设置、滚动正文。<span id="feedback">示例未连接游戏</span></footer><script id="review-seed" type="application/json">${JSON.stringify(seed).replace(/</g,'\\u003c')}</script><script src="./review.js"></script></html>`;
  await writeFile(resolve(output,'index.html'),html,{flag:'wx'});
  const {chromium}=await loadWorkspaceTool('@playwright/test');browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});page.on('pageerror',e=>report.consoleErrors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.networkRequests++;});
  const state=()=>page.evaluate(()=>window.navigationReview.get('after').getState());
  const tab=async index=>{const p=await page.evaluate(i=>{const d=window.navigationReview,n=d.get('after').inspect().nodes.find(n=>n.type==='Tabs'),c=document.querySelector('#after canvas').getBoundingClientRect(),b=d.source('after');return{x:c.x+(n.bounds.x+n.bounds.width*(i+.5)/3)*c.width/b.spec.canvas.width,y:c.y+(n.bounds.y+24)*c.height/b.spec.canvas.height};},index);await page.mouse.click(p.x,p.y);};
  const control=async(type,suffix)=>{const p=await page.evaluate(({type,suffix})=>{const d=window.navigationReview,n=d.get('after').inspect().nodes.find(n=>n.visible&&(suffix?n.id.endsWith(suffix):n.type===type)),c=document.querySelector('#after canvas').getBoundingClientRect(),b=d.source('after');if(!n)throw Error('NAVIGATION_NODE');return{x:c.x+(n.bounds.x+n.bounds.width/2)*c.width/b.spec.canvas.width,y:c.y+(n.bounds.y+n.bounds.height/2)*c.height/b.spec.canvas.height};},{type,suffix});await page.mouse.click(p.x,p.y);};
  for(const theme of catalog.themes){
    report.phase=theme.id;
    await page.goto(pathToFileURL(resolve(output,'index.html')).href+'?panel='+theme.id);await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');assert.deepEqual(await page.evaluate(()=>window.navigationReview.errors()),[]);
    await control('Input');await page.keyboard.insertText('Blueberry');assert.equal((await state()).form_f_row0,'Blueberry');pass(theme.id+'-actual-text-input');
    await tab(1);assert.equal((await state()).navigation,'page1');await control('Select');assert.equal(await page.evaluate(()=>window.navigationReview.get('after').inspect().nodes.find(n=>n.type==='Select').popupOpen),true);
    const option=await page.evaluate(()=>{const d=window.navigationReview,n=d.get('after').inspect().nodes.find(n=>n.type==='Select'),r=n.popupItems.at(-1).textBounds[0].bounds,c=document.querySelector('#after canvas').getBoundingClientRect(),b=d.source('after');return{x:c.x+(r.x+r.width/2)*c.width/b.spec.canvas.width,y:c.y+(r.y+r.height/2)*c.height/b.spec.canvas.height};});await page.mouse.click(option.x,option.y);assert.equal((await state()).settings_f_quality,'high');pass(theme.id+'-select-popup-pointer');
    await tab(1);await page.keyboard.press('Tab');await page.keyboard.press('ArrowRight');assert.equal((await state()).navigation,'page2');await page.keyboard.press('Home');assert.equal((await state()).navigation,'page0');await page.keyboard.press('End');assert.equal((await state()).navigation,'page2');await page.keyboard.press('ArrowLeft');assert.equal((await state()).navigation,'page1');pass(theme.id+'-arrow-home-end-navigation');
    await control('Switch');assert.equal((await state()).settings_f_muted,true);await tab(0);assert.equal((await state()).form_f_row0,'Blueberry');await control(null,'.row.form_r_row1.control');const submit=await page.evaluate(()=>window.navigationReview.events().at(-1).event);assert.equal(submit.action,'submit');assert.deepEqual(submit.values,{form_f_row0:'Blueberry'});assert.equal((await state()).settings_f_quality,'high');pass(theme.id+'-switch-submit-and-hidden-values-retained');
    await tab(2);const beforeScroll=await page.evaluate(()=>window.navigationReview.get('after').inspect().nodes.find(n=>n.visible&&n.type==='ScrollView').value.y);assert.equal(beforeScroll,0);
    const point=await page.evaluate(()=>{const d=window.navigationReview,n=d.get('after').inspect().nodes.find(n=>n.visible&&n.type==='ScrollView'),c=document.querySelector('#after canvas').getBoundingClientRect(),b=d.source('after');return{x:c.x+(n.bounds.x+n.bounds.width/2)*c.width/b.spec.canvas.width,y:c.y+(n.bounds.y+n.bounds.height/2)*c.height/b.spec.canvas.height};});await page.mouse.move(point.x,point.y);await page.mouse.wheel(0,300);await page.waitForFunction(()=>window.navigationReview.get('after').inspect().nodes.find(n=>n.visible&&n.type==='ScrollView').value.y>0);
    const scrolled=await page.evaluate(()=>window.navigationReview.get('after').inspect().nodes.find(n=>n.visible&&n.type==='ScrollView').value.y);await tab(0);await tab(2);assert.equal(await page.evaluate(()=>window.navigationReview.get('after').inspect().nodes.find(n=>n.visible&&n.type==='ScrollView').value.y),scrolled);pass(theme.id+'-scroll-position-retained');
    await tab(0);assert.deepEqual(await page.evaluate(()=>window.navigationReview.errors()),[]);await page.screenshot({path:resolve(output,theme.id+'.png')});
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);await tab(1);assert.equal((await state()).navigation,'page1');pass(theme.id+'-narrow-pointer-and-no-overflow');await page.setViewportSize({width:1920,height:1080});
  }
  const downloaded=page.waitForEvent('download');await page.locator('#download').click();await(await downloaded).saveAs(resolve(output,'actual-download.panel-delivery.zip'));
  const files=readStoredZip(await readFile(resolve(output,'actual-download.panel-delivery.zip'))),manifest=JSON.parse(new TextDecoder().decode(files.get('delivery-manifest.json')));
  for(const f of manifest.files){assert.equal(files.get(f.path).length,f.bytes);assert.equal(await digestBytes(files.get(f.path)),f.sha256);}pass('actual-download-crc-and-all-checksums');
  const restored=await validatePanelBundle(JSON.parse(new TextDecoder().decode(files.get('pixi/panel.bundle.json'))),core);assert.deepEqual(restored,seed['modern-orange-dark'].after);
  const model=await createWorkbenchModel({catalog,pool:null},core);try{await model.importPanel(restored);assert.deepEqual(await model.exportPanel(),restored);}finally{model.dispose();}pass('actual-download-portable-reimport');
  for(const [path,bytes]of files){const full=resolve(output,'offline',path);assert(full.startsWith(resolve(output,'offline')+'/')||full.startsWith(resolve(output,'offline')+'\\'));await mkdir(dirname(full),{recursive:true});await writeFile(full,bytes,{flag:'wx'});}
  await page.goto(pathToFileURL(resolve(output,'offline/pixi/index.html')).href);await page.waitForFunction(()=>document.getElementById('status').dataset.state==='ready'||document.getElementById('status').dataset.state==='error');assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),restored.state);pass('actual-download-offline-load');
  const p=await page.evaluate(()=>{const n=window.panelDelivery.inspect().nodes.find(n=>n.type==='Tabs'),c=document.querySelector('canvas').getBoundingClientRect(),b=window.panelDelivery.bundle;return{x:c.x+(n.bounds.x+n.bounds.width/2)*c.width/b.spec.canvas.width,y:c.y+(n.bounds.y+24)*c.height/b.spec.canvas.height};});await page.mouse.click(p.x,p.y);assert.equal(await page.evaluate(()=>window.panelDelivery.getState().navigation),'page1');await page.keyboard.press('Tab');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>window.panelDelivery.getState().navigation),'page0');pass('offline-pointer-and-keyboard-navigation');
  assert.deepEqual(report.consoleErrors,[]);assert.equal(report.networkRequests,0);report.status='PASS';report.bundleHashes=Object.fromEntries(Object.entries(seed).map(([name,e])=>[name,e.after.sha256]));
  await writeNewJson(output,'navigation-browser-report.json',report);console.log(JSON.stringify({status:report.status,checks:report.checks.length,modelCalls:0,nativeUnity:'NOT_RUN'}));
}catch(error){report.status='FAIL';const code=error?.code??error?.message;report.failureCode=/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'NAVIGATION_BROWSER_FAILED';if(error?.code==='ERR_ASSERTION')report.assertion={actual:error.actual,expected:error.expected,operator:error.operator};if(output)await writeNewJson(output,'navigation-browser-report.json',report);console.error(JSON.stringify({status:'FAIL',code:report.failureCode,completedChecks:report.checks.length,assertion:report.assertion}));process.exitCode=1;}
finally{await browser?.close();}
