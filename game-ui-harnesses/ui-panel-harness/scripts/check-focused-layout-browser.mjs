#!/usr/bin/env node
/** Deterministic fixtures, actual Pixi interactions, native data and offline ZIP replay. No model jobs. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,harnessRoot,writeNewJson} from '../src/io.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {focusedLayoutFixtures,layoutSettings} from '../examples/focused-layout-v1/fixture.mjs';
import {semanticSettingsFixture} from '../examples/semantic-controls-v1/fixture.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
import {composePanelBundles} from '../src/panel-composition.mjs';
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
 const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output','FOCUSED_BROWSER_ARGUMENTS');output=await createOutputDirectory(args[1]);
 const [catalog,oldCatalog,base,core]=await Promise.all([readJson(resolve(harnessRoot,'examples/modern-layout.catalog.json')),readJson(resolve(harnessRoot,'examples/modern-controls.catalog.json')),readJson(resolve(harnessRoot,'examples/settings-controls.panel.json')),loadWorkspaceCore()]);
 const fixtures=await focusedLayoutFixtures(catalog),theme=catalog.themes.find(t=>t.id===fixtures.form.theme.id),seed={};report.catalogSha256=await digestJson(catalog);
 const pass=name=>report.checks.push({name,status:'PASS'}),titles={menu:'菜单：居中等宽按钮',form:'表单：字段对齐与紧凑操作区',dialog:'弹窗：全宽正文与操作区'};
 for(const [name,spec]of Object.entries(fixtures)){
  const before=structuredClone(spec);before.theme.version='0.5.0';
  const old=arrangeIntentSpec(before,layoutSettings(),oldCatalog.themes.find(t=>t.id===theme.id));
  seed[name]={title:titles[name],before:await createPanelBundle(old,oldCatalog,core),after:await createPanelBundle(spec,catalog,core)};
  assert.deepEqual(seed[name].before.state,seed[name].after.state);assert.deepEqual(seed[name].before.actions,seed[name].after.actions);assert.deepEqual(seed[name].before.spec.sections,seed[name].after.spec.sections);pass(name+'-business-order-defaults-preserved');
 }
 const scroll=structuredClone(fixtures.dialog);scroll.sections[0].rows[0].text=scroll.sections[0].rows[0].text.repeat(2);
 seed.scroll={title:'长正文：滚动与完整操作按钮',after:await createPanelBundle(arrangeIntentSpec(scroll,{...layoutSettings(360),maxHeight:300},theme),catalog,core)};
 const form=seed.form.after,dialog=seed.dialog.after;
 const result=await composePanelBundles({panelCompositionRequestVersion:'0.1',id:'focused-review-composite',title:'角色与删除确认',sources:[{namespace:'form',bundleSha256:form.sha256},{namespace:'dialog',bundleSha256:dialog.sha256}],layout:'tabs',width:640,canvasWidth:760,canvasHeight:640,maxHeight:480,surfaceFrom:null},[form,dialog],core);
 seed.composition={title:'组合：表单与确认弹窗切换',after:result.bundle};
 seed.settings={title:'设置：保持行式控件与主题下拉菜单',after:await createPanelBundle(semanticSettingsFixture(catalog,base),catalog,core,{volume:65,muted:false,quality:'medium'})};
 await mkdir(resolve(output,'sources'));await mkdir(resolve(output,'delivery'));
 const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources();
 for(const [name,entry]of Object.entries(seed)){
  for(const [side,bundle]of Object.entries(entry).filter(([key])=>key!=='title')){await validatePanelBundle(bundle,core);await writeFile(resolve(output,'sources',`${name}.${side}.panel.bundle.json`),canonicalJson(bundle)+'\n',{flag:'wx'});}
  const bundle=entry.after,kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
  for(const [path,bytes]of delivery.contents){const full=resolve(output,'delivery',name,path);await mkdir(dirname(full),{recursive:true});await writeFile(full,bytes,{flag:'wx'});}
  const zip=createStoredZip(delivery.contents);await writeFile(resolve(output,'delivery',name+'.panel-delivery.zip'),zip,{flag:'wx'});
  for(const f of delivery.manifest.files){const bytes=delivery.contents.get(f.path);assert.equal(bytes.length,f.bytes);assert.equal(await digestBytes(bytes),f.sha256);}pass(name+'-delivery-checksums');
 }
 const {build}=await loadWorkspaceTool('vite'),built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,sourcemap:false,lib:{entry:resolve(harnessRoot,'examples/focused-layout-v1/review.mjs'),name:'FocusedReview',formats:['iife'],fileName:()=> 'review.js'}}});
 const chunks=(Array.isArray(built)?built:[built]).flatMap(r=>r.output);assert.equal(chunks.length,1);await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>菜单、表单与弹窗排版对比</title><style>*{box-sizing:border-box}body{margin:0;background:#070F17;color:#EAF3F8;font:16px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}header{padding:26px 48px;border-bottom:1px solid #263C4B;display:flex;align-items:center;gap:20px}h1{font-size:22px;margin:0}small,h2{color:#A8BCC8}nav{margin-left:auto;display:flex;gap:20px;flex-wrap:wrap}a{color:#6CCBE9}main{min-height:780px;padding:54px 48px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:48px;align-items:start}article[hidden]{display:none}main:has(article[hidden]){grid-template-columns:minmax(0,900px);justify-content:center}h2{font-size:17px;font-weight:500;text-align:center;margin:0 0 22px}.canvas{width:100%;margin:auto}footer{padding:20px 48px;border-top:1px solid #263C4B;color:#A8BCC8;display:flex;justify-content:space-between;gap:20px}@media(max-width:900px){header{padding:20px;display:block}nav{margin-top:16px}main{padding:24px 16px;grid-template-columns:minmax(0,1fr);gap:36px;min-height:0}footer{padding:20px;display:block}}</style><header><div><h1 id="name">排版对比</h1><small>程序化交互样例 · 本轮未调用模型</small></div><nav><a href="?panel=menu">菜单</a><a href="?panel=form">表单</a><a href="?panel=dialog">弹窗</a><a href="?panel=scroll">长正文</a><a href="?panel=composition">组合切换</a><a href="?panel=settings">设置</a><a id="download" download>下载当前面板</a></nav></header><main><article id="before-card"><h2>优化前 · Semantic-v1</h2><div id="before" class="canvas"></div></article><article id="after-card"><h2>优化后 · Focused-v1</h2><div id="after" class="canvas"></div></article></main><footer><span>菜单收拢 · 字段对齐 · 正文换行 · 操作区留白</span><span id="feedback">可直接输入和点击；示例未连接游戏</span></footer><script id="review-seed" type="application/json">${JSON.stringify(seed).replace(/</g,'\\u003c')}</script><script src="./review.js"></script></html>`;
 await writeFile(resolve(output,'index.html'),html,{flag:'wx'});
 const {chromium}=await loadWorkspaceTool('@playwright/test');browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});page.on('pageerror',e=>report.consoleErrors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.networkRequests++;});
 const open=async name=>{await page.goto(pathToFileURL(resolve(output,'index.html')).href+'?panel='+name);await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.deepEqual(await page.evaluate(()=>window.focusedReview.errors()),[]);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');};
 const click=async predicate=>{const point=await page.evaluate(predicate=>{const d=window.focusedReview,n=d.get('after').inspect().nodes.find(n=>n.visible&&(predicate.type?n.type===predicate.type:n.id.endsWith(predicate.suffix))),b=d.source('after'),c=document.querySelector('#after canvas').getBoundingClientRect();if(!n)throw Error('REVIEW_NODE');return{x:c.x+(n.bounds.x+n.bounds.width/2)*c.width/b.spec.canvas.width,y:c.y+(n.bounds.y+n.bounds.height/2)*c.height/b.spec.canvas.height};},predicate);await page.mouse.click(point.x,point.y);};
 const textFits=async()=>{const failures=await page.evaluate(()=>window.focusedReview.get('after').inspect().nodes.filter(n=>n.visible&&n.type==='Text').flatMap(n=>(n.renderedTextBounds??[]).filter(t=>t.bounds.x<n.bounds.x-2||t.bounds.x+t.bounds.width>n.bounds.x+n.bounds.width+2).map(()=>n.id)));assert.deepEqual(failures,[]);};
 for(const name of ['menu','form','dialog']){
  await open(name);await textFits();pass(name+'-actual-pixi-render-text-fit');await page.screenshot({path:resolve(output,name+'-compare.png')});
  if(name==='menu'){await click({suffix:'.row.row1.control'});assert.equal(await page.evaluate(()=>window.focusedReview.events().at(-1).event.name),seed.menu.after.actions[0].event);pass('menu-actual-pointer-event');}
  if(name==='form'){
   assert.equal(await page.evaluate(()=>window.focusedReview.get('after').inspect().nodes.find(n=>n.type==='Button').enabled),false);await click({type:'Input'});await page.keyboard.insertText('Blueberry');
   assert.deepEqual(await page.evaluate(()=>window.focusedReview.get('after').getState()),{row0:'Blueberry'});await click({suffix:'.row.row1.control'});
   const event=await page.evaluate(()=>window.focusedReview.events().at(-1).event);assert.equal(event.action,'submit');assert.deepEqual(event.values,{row0:'Blueberry'});pass('form-actual-input-validation-submit');
   await click({suffix:'.row.row2.control'});assert.equal(await page.evaluate(()=>window.focusedReview.events().at(-1).event.action),'emit');assert.deepEqual(await page.evaluate(()=>window.focusedReview.get('after').getState()),{row0:'Blueberry'});pass('form-cancel-retains-played-state');
  }
  if(name==='dialog'){await click({suffix:'.row.delete.control'});assert.equal(await page.evaluate(()=>window.focusedReview.events().at(-1).event.name),'dialog.delete');pass('dialog-danger-button-original-event');}
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);await textFits();pass(name+'-narrow-no-horizontal-overflow');await page.screenshot({path:resolve(output,name+'-narrow.png'),fullPage:true});await page.setViewportSize({width:1920,height:1080});
 }
 await open('scroll');const scrollBefore=await page.evaluate(()=>window.focusedReview.get('after').inspect().nodes.find(n=>n.type==='ScrollView').value.y);const canvas=await page.locator('#after canvas').boundingBox();await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.wheel(0,500);await page.waitForFunction(()=>window.focusedReview.get('after').inspect().nodes.find(n=>n.type==='ScrollView').value.y>0);assert.equal(scrollBefore,0);await click({suffix:'.row.delete.control'});assert.equal(await page.evaluate(()=>window.focusedReview.events().at(-1).event.name),'dialog.delete');pass('scroll-reveal-complete-footer-and-click');await page.screenshot({path:resolve(output,'scroll.png')});
 await open('composition');await click({type:'Input'});await page.keyboard.insertText('Blueberry');
 const tabPoint=async index=>page.evaluate(index=>{const d=window.focusedReview,n=d.get('after').inspect().nodes.find(n=>n.type==='Tabs'),c=document.querySelector('#after canvas').getBoundingClientRect(),b=d.source('after');return{x:c.x+(n.bounds.x+n.bounds.width*(index+.5)/2)*c.width/b.spec.canvas.width,y:c.y+(n.bounds.y+24)*c.height/b.spec.canvas.height};},index);
 let p=await tabPoint(1);await page.mouse.click(p.x,p.y);await click({suffix:'.row.dialog_r_delete.control'});p=await tabPoint(0);await page.mouse.click(p.x,p.y);assert.equal(await page.evaluate(()=>Object.values(window.focusedReview.get('after').getState()).includes('Blueberry')),true);pass('composition-tab-switch-retains-input-and-dialog-event');await page.screenshot({path:resolve(output,'composition.png')});
 await open('settings');await click({type:'Select'});assert.equal(await page.evaluate(()=>window.focusedReview.get('after').inspect().nodes.find(n=>n.type==='Select').popupOpen),true);await page.keyboard.press('Escape');pass('settings-themed-select-popup');
 const downloaded=page.waitForEvent('download');await page.locator('#download').click();await(await downloaded).saveAs(resolve(output,'actual-download.panel-delivery.zip'));
 const files=readStoredZip(await readFile(resolve(output,'actual-download.panel-delivery.zip'))),manifest=JSON.parse(new TextDecoder().decode(files.get('delivery-manifest.json')));
 for(const file of manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}pass('actual-download-zip-crc-and-checksums');
 const restored=await validatePanelBundle(JSON.parse(new TextDecoder().decode(files.get('pixi/panel.bundle.json'))),core);assert.deepEqual(restored,seed.settings.after);
 const model=await createWorkbenchModel({catalog,pool:null},core);try{await model.importPanel(restored);assert.deepEqual(await model.exportPanel(),restored);}finally{model.dispose();}pass('actual-download-portable-reimport');
 for(const [path,bytes]of files){const full=resolve(output,'offline',path);assert(full.startsWith(resolve(output,'offline')+'/')||full.startsWith(resolve(output,'offline')+'\\'));await mkdir(dirname(full),{recursive:true});await writeFile(full,bytes,{flag:'wx'});}
 await page.goto(pathToFileURL(resolve(output,'offline/pixi/index.html')).href);await page.waitForFunction(()=>window.panelDelivery&&document.getElementById('status').dataset.state==='ready');assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),seed.settings.after.state);pass('actual-download-offline-pixi-load');
 assert.deepEqual(report.consoleErrors,[]);assert.equal(report.networkRequests,0);report.status='PASS';report.bundleHashes=Object.fromEntries(Object.entries(seed).map(([name,value])=>[name,value.after.sha256]));
 await writeNewJson(output,'focused-layout-browser-report.json',report);console.log(JSON.stringify({status:report.status,checks:report.checks.length,modelCalls:0,nativeUnity:'NOT_RUN'}));
}catch(error){report.status='FAIL';const code=error?.code??error?.message;report.failureCode=/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'FOCUSED_BROWSER_FAILED';if(output)await writeNewJson(output,'focused-layout-browser-report.json',report);console.error(JSON.stringify({status:'FAIL',code:report.failureCode,completedChecks:report.checks.length}));process.exitCode=1;}
finally{await browser?.close();}
