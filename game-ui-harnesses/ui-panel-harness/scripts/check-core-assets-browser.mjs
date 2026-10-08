#!/usr/bin/env node
/** Verified owned PNGs, authored fixtures, actual pointer/keyboard input and offline exports; zero inference. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,harnessRoot,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {verifyAssetLibrary} from '../src/asset-library.mjs';
import {loadTextureImageAdapter} from '../src/texture-image-adapter.mjs';
import {createWorkbenchAssetPool,workbenchAssetInputs,workbenchRetrieval} from '../src/workbench-assets.mjs';
import {focusedLayoutFixtures} from '../examples/focused-layout-v1/fixture.mjs';
import {semanticSettingsFixture} from '../examples/semantic-controls-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {canonicalJson,digestBytes} from '../src/canonical.mjs';

const report={status:'NOT_RUN',sourceKind:'PROGRAMMATIC_FIXTURE',modelCalls:0,checks:[],consoleErrors:[],networkRequests:0,nativeUnity:'NOT_RUN'};
let output,browser;
const pass=name=>report.checks.push({name,status:'PASS'});
try{
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){assert(['--assets','--output','--sharp-module'].includes(args[i])&&args[i+1]&&!Object.hasOwn(options,args[i]),'CORE_ASSET_BROWSER_ARGUMENTS');options[args[i]]=args[i+1];}
 assert(options['--assets']&&options['--output'],'CORE_ASSET_BROWSER_ARGUMENTS');
 const verified=await verifyAssetLibrary(options['--assets'],await loadTextureImageAdapter(options['--sharp-module']));
 const pool=await createWorkbenchAssetPool(verified.index,[...new Map(verified.index.records.map(r=>[r.file.path,{path:r.file.path,mime:'image/png',bytes:verified.blobs.get(r.file.path)}])).values()]);
 report.library={id:verified.index.id,sha256:verified.index.sha256,records:verified.index.records.length};
 output=await createOutputDirectory(options['--output']);
 await mkdir(resolve(output,'delivery'));await mkdir(resolve(output,'sources'));
 const [catalog,base,core,runtime,sources]=await Promise.all([readJson(resolve(harnessRoot,'examples/modern-navigation.catalog.json')),readJson(resolve(harnessRoot,'examples/settings-controls.panel.json')),loadWorkspaceCore(),buildDeliveryRuntime(),readUnityAdapterSources()]);
 const fixtures=await focusedLayoutFixtures(catalog),settings=semanticSettingsFixture(catalog,base);
 settings.id='core-sound-settings';settings.title='声音设置';settings.sections[0].title='声音设置';
 settings.state=[{...settings.state[0],initial:70},{...settings.state[1],initial:false},{...settings.state[0],id:'music',initial:40}];
 settings.sections[0].rows=[{...settings.sections[0].rows[0],label:'主音量'}, {...settings.sections[0].rows[0],id:'music-row',bind:'music',label:'音乐',event:'audio.musicChanged'}, settings.sections[0].rows[1]];
 settings.sections[1].rows[0].action.fields=['volume','music','muted'];
 const menu=structuredClone(fixtures.menu);menu.id='core-pause-menu';menu.title='暂停菜单';menu.sections[0].title='暂停菜单';
 menu.sections[0].rows.forEach((r,i)=>{r.buttonLabel=['继续游戏','设置','返回主菜单'][i];r.event=['menu.resume','menu.settings','menu.home'][i];});
 const seed={};
 for(const mode of ['light','dark'])for(const [name,input]of Object.entries({settings,role:fixtures.form,menu})){
   const theme=catalog.themes.find(t=>t.id===(mode==='light'?'modern-mint-light':'modern-blue-dark'));
   const original=structuredClone(input);original.theme={id:theme.id,version:theme.version};original.provenance={kind:'programmatic-fixture',description:'Owned asset visual comparison fixture; not a model generation result.',assumptions:[]};
   if(name==='settings'){original.canvas={width:960,height:720};original.layout.width=620;}
   else original.canvas={width:800,height:640};
   const before=await createPanelBundle(original,catalog,core);
   const afterSpec=structuredClone(original),rows=afterSpec.sections[0].rows;
   const mapping=name==='settings'?[[rows[0].id,'volume'],[rows[1].id,'music'],[rows[2].id,'mute']]:name==='role'?[[rows[0].id,'user']]:rows.map((r,i)=>[r.id,['play','settings','home'][i]]);
   afterSpec.assets={library:{id:verified.index.id,sha256:verified.index.sha256},panelSurface:null,rowIcons:mapping.map(([rowId,id])=>({rowId,asset:`panel-core/${id}@1.0.0`}))};
   const after=await createPanelBundle(afterSpec,catalog,core,before.state,await workbenchAssetInputs(afterSpec,pool));
   assert.deepEqual(after.state,before.state);assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.bindings,before.bindings);
   assert.deepEqual(after.spec.sections,before.spec.sections);assert.deepEqual(after.spec.theme,before.spec.theme);
   assert.deepEqual(after.spec.canvas,before.spec.canvas);assert.deepEqual(after.spec.layout,before.spec.layout);pass(`${name}-${mode}-business-theme-and-layout-preserved`);
   const query=name==='settings'?'声音设置：主音量、音乐、静音、恢复默认':name==='role'?'角色命名：角色名、确认、取消':'暂停菜单：继续游戏、设置、返回主菜单';
   const retrieval=workbenchRetrieval(query,pool);for(const icon of afterSpec.assets.rowIcons)assert(retrieval.candidates.some(c=>c.asset.key===icon.asset));pass(`${name}-${mode}-natural-language-retrieval`);
   const key=`${name}-${mode}`;seed[key]={title:({settings:'声音设置',role:'角色命名',menu:'暂停菜单'})[name]+(mode==='light'?' · 浅色':' · 深色'),before,after,assetNames:mapping.map(([,id])=>verified.index.records.find(r=>r.metadata.id===id).metadata.name)};
   for(const [side,bundle]of Object.entries({before,after})){await validatePanelBundle(bundle,core);await writeFile(resolve(output,'sources',`${key}.${side}.panel.bundle.json`),canonicalJson(bundle)+'\n',{flag:'wx'});}
   const kit=await createUnityKitFiles(after,core,sources),delivery=await createPanelDelivery(after,core,{runtime,unityKit:kit});
   for(const [path,bytes]of delivery.contents){const file=resolve(output,'delivery',key,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
   await writeFile(resolve(output,'delivery',key+'.panel-delivery.zip'),createStoredZip(delivery.contents),{flag:'wx'});
   for(const f of delivery.manifest.files){const bytes=delivery.contents.get(f.path);assert.equal(bytes.length,f.bytes);assert.equal(await digestBytes(bytes),f.sha256);}pass(key+'-delivery-checksums');
 }
 const {build}=await loadWorkspaceTool('vite');
 const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,lib:{entry:resolve(harnessRoot,'examples/core-assets-v1/review.mjs'),name:'CoreAssetReview',formats:['iife'],fileName:()=> 'review.js'}}});
 const chunks=(Array.isArray(built)?built:[built]).flatMap(result=>result.output);
 assert.equal(chunks.length,1);await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
 const escaped=canonicalJson(seed).replaceAll('<','\\u003c');
 await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>自有素材对比</title><style>*{box-sizing:border-box}body{margin:0;background:#101c24;color:#e7f1f4;font:15px/1.6 system-ui,sans-serif}main{max-width:1680px;padding:28px;margin:auto}h1{font-size:25px;margin:0 0 6px}p{color:#acbdc7}nav{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}a{color:#b6e8dd;padding:8px 14px;border:1px solid #425966;border-radius:8px;text-decoration:none}a:focus-visible{outline:3px solid #78e0ca}a:hover{background:#253e48}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{min-width:0;background:#182b35;border:1px solid #38515e;border-radius:14px;overflow:hidden}h2{font-size:15px;padding:14px 20px;margin:0;border-bottom:1px solid #38515e}.canvas{width:100%;min-width:0}footer{margin-top:22px;display:flex;gap:16px;flex-wrap:wrap}#assets{color:#c5d6dd}@media(max-width:760px){main{padding:16px}.grid{grid-template-columns:1fr}}</style><main><h1 id="name">自有素材对比</h1><p>左侧为现有控件，右侧使用自有图标。两侧均可试玩；底板跟随主题，按钮保留文字和主次层级。</p><nav>${Object.entries(seed).map(([key,e])=>`<a href="?panel=${key}">${e.title}</a>`).join('')}</nav><div class="grid"><article><h2>现有界面</h2><div class="canvas" id="before"></div></article><article><h2>接入自有素材</h2><div class="canvas" id="after"></div></article></div><p>本页素材：<span id="assets"></span></p><footer><a id="download">下载当前面板交付 ZIP</a><span id="feedback" role="status">可拖动滑条、输入文字或点击菜单</span></footer><p>程序化测试样例 · 模型调用 0 次 · Unity 包已导出，未运行 Unity 编辑器验收</p></main><script id="review-seed" type="application/json">${escaped}</script><script src="review.js"></script></html>`,{flag:'wx'});
 const {chromium}=await loadWorkspaceTool('@playwright/test');browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});
 page.on('pageerror',e=>report.consoleErrors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))report.networkRequests++;});
 async function click(suffix,fraction=.5){const p=await page.evaluate(({suffix,fraction})=>{const d=window.assetReview,n=d.get('after').inspect().nodes.find(n=>n.id.endsWith(suffix)),c=document.querySelector('#after canvas').getBoundingClientRect(),b=d.source('after');if(!n)throw Error('CORE_ASSET_NODE');return{x:c.x+(n.bounds.x+n.bounds.width*fraction)*c.width/b.spec.canvas.width,y:c.y+(n.bounds.y+n.bounds.height/2)*c.height/b.spec.canvas.height};},{suffix,fraction});await page.mouse.click(p.x,p.y);}
 for(const [key,entry]of Object.entries(seed)){
   report.phase=key;await page.goto(pathToFileURL(resolve(output,'index.html')).href+'?panel='+key);await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
   const images=await page.evaluate(()=>window.assetReview.get('after').inspect().nodes.filter(n=>n.type==='Image'&&n.id.endsWith('.icon')).map(n=>({id:n.id,visible:n.visible,bounds:n.bounds})));
   assert.equal(images.length,entry.after.spec.assets.rowIcons.length);assert(images.every(n=>n.visible));pass(key+'-selected-images-mounted');
   await page.screenshot({path:resolve(output,key+'.png')});
   if(key.startsWith('settings')){await click('.row.volume-row.control',.65);assert.notEqual(await page.evaluate(()=>window.assetReview.get('after').getState().volume),70);await click('.row.mute-row.control');assert.equal(await page.evaluate(()=>window.assetReview.get('after').getState().muted),true);await click('.row.reset-row.control');assert.deepEqual(await page.evaluate(()=>window.assetReview.get('after').getState()),entry.after.state);pass(key+'-slider-switch-reset');}
   else if(key.startsWith('role')){const row=entry.after.spec.sections[0].rows.find(r=>r.kind==='input');await click(`.row.${row.id}.control`);await page.keyboard.insertText('青莓');assert.equal(await page.evaluate(id=>window.assetReview.get('after').getState()[id],row.bind),'青莓');const submit=entry.after.spec.sections[0].rows.find(r=>r.action?.kind==='submit');await click(`.row.${submit.id}.control`);assert.equal(await page.evaluate(()=>window.assetReview.events().at(-1).event.action),'submit');pass(key+'-input-and-submit');}
   else{for(const row of entry.after.spec.sections[0].rows){await click(`.row.${row.id}.control`);assert.equal(await page.evaluate(()=>window.assetReview.events().at(-1).event.name),row.event);}pass(key+'-all-menu-buttons');}
   assert.deepEqual(await page.evaluate(()=>window.assetReview.errors()),[]);
   await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);pass(key+'-narrow-no-overflow');await page.setViewportSize({width:1920,height:1080});
   const download=page.waitForEvent('download');await page.locator('#download').click();const zip=await download;const zipPath=resolve(output,`${key}.actual-download.zip`);await zip.saveAs(zipPath);
   const files=readStoredZip(await readFile(zipPath)),manifest=JSON.parse(new TextDecoder().decode(files.get('delivery-manifest.json')));
   for(const f of manifest.files){assert.equal(files.get(f.path).length,f.bytes);assert.equal(await digestBytes(files.get(f.path)),f.sha256);}
   const restored=await validatePanelBundle(JSON.parse(new TextDecoder().decode(files.get('pixi/panel.bundle.json'))),core);assert.deepEqual(restored,entry.after);
   const model=await createWorkbenchModel({catalog,pool:null},core);try{await model.importPanel(restored);assert.deepEqual(await model.exportPanel(),restored);}finally{model.dispose();}pass(key+'-actual-download-and-portable-reimport');
   const offline=resolve(output,'offline',key);
   for(const [path,bytes]of files){const file=resolve(offline,path);assert(file.startsWith(offline+'/')||file.startsWith(offline+'\\'));await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
   await page.goto(pathToFileURL(resolve(offline,'pixi/index.html')).href);await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status').dataset.state));assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),restored.state);pass(key+'-actual-download-offline-assets-mount');
 }
 assert.deepEqual(report.consoleErrors,[]);assert.equal(report.networkRequests,0);report.status='PASS';await writeNewJson(output,'core-assets-browser-report.json',report);console.log(JSON.stringify({status:'PASS',checks:report.checks.length,modelCalls:0,nativeUnity:'NOT_RUN'}));
}catch(error){report.status='FAIL';const raw=error?.message;report.failureCode=/^[A-Z][A-Z0-9_]{0,79}$/.test(raw)?raw:'CORE_ASSET_BROWSER_FAILED';if(error?.code==='ERR_ASSERTION')report.assertion={actual:error.actual,expected:error.expected,operator:error.operator};if(output)await writeNewJson(output,'core-assets-browser-report.json',report);console.error(JSON.stringify({status:'FAIL',phase:report.phase,code:report.failureCode,checks:report.checks.length,assertion:report.assertion}));process.exitCode=1;}
finally{await browser?.close();}
