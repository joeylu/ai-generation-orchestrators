#!/usr/bin/env node
/** Read-only live service acceptance. All browser POSTs and external requests are denied. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {digestBytes,canonicalJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {controlId} from '../src/compiler.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';

assert(process.argv.length===8&&process.argv[2]==='--url'&&process.argv[4]==='--build'&&process.argv[6]==='--output',
 'Required: --url <loopback Studio> --build <current build> --output <fresh directory>');
const url=new URL(process.argv[3]);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');assert.equal(url.pathname,'/');
const build=resolve(process.argv[5]),output=await createOutputDirectory(process.argv[7]);
const report={dailyStudioBrowserVersion:'0.2',status:'RUNNING',modelCalls:0,modelRequests:0,automaticRetries:0,
 externalRequests:0,checks:[],errors:[],historicalInputs:[],scope:'Isolated browser storage against existing live Studio; no service mutation',
 humanVisualReview:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN'};
const pass=name=>report.checks.push({name,status:'PASS'});
let browser,page,offline,stage='current-build',model;
try{
 const manifest=await readJson(resolve(build,'workbench-build.json'));
 for(const file of manifest.files){
  assert.equal(await digestBytes(await readFile(resolve(build,file.path))),file.sha256);
  const response=await fetch(new URL(file.path==='index.html'?'':file.path,url));assert(response.ok);
  assert.equal(await digestBytes(new Uint8Array(await response.arrayBuffer())),file.sha256);
 }
 const service=await(await fetch(new URL('api/panel/studio',url))).json();
 const capabilities=await(await fetch(new URL('api/panel/capabilities',url))).json();
 assert.equal(service.active,false);assert.deepEqual(service.build,manifest.studio);
 assert.equal(capabilities.model,'gpt-6-luna');assert.equal(capabilities.effort,'xhigh');assert(capabilities.editingAvailable);
 report.build=service.build;report.catalogSha256=manifest.catalogSha256;pass(stage);
 const core=await loadWorkspaceCore();
 const inputs={menu:'output/menu-defaults-real-pause-plan-v1/panel.bundle.json',
  older:'output/composition-real-pause-plan-v1/panel.bundle.json',
  scoped:'output/scoped-copy-browser-v2/scoped.panel.bundle.json',
  edited:'output/scoped-copy-real-edit-plan-v1/panel.bundle.json'};
 const bundles={};
 for(const [key,path]of Object.entries(inputs)){
  const bytes=await readFile(resolve(harnessRoot,path));bundles[key]=await validatePanelBundle(JSON.parse(bytes),core);
  report.historicalInputs.push({path,sha256:await digestBytes(bytes),bundleSha256:bundles[key].sha256,
   sourceKind:key==='scoped'?'PROGRAMMATIC_FIXTURE':'EXISTING_REAL_RESULT'});
 }
 pass('three-existing-real-bundles-strictly-recompile-without-new-generation');
 const {chromium}=await loadWorkspaceTool('@playwright/test');
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
 const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const request=route.request(),target=new URL(request.url());
  if(request.method()!=='GET'){report.modelRequests++;return route.abort();}
  if(!['data:','blob:','file:'].includes(target.protocol)&&target.origin!==url.origin){report.externalRequests++;return route.abort();}
  return route.continue();
 });
 const observe=p=>{p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(e.message));
  p.on('console',e=>{if(e.type()==='error')report.errors.push(e.text());});};
 page=await context.newPage();observe(page);
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const snapshot=()=>page.evaluate(()=>window.panelWorkbench.snapshot());
 const state=()=>page.evaluate(()=>window.panelWorkbench.getState());
 const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('ui-panel-studio.workspace.v1')));
 const rounds=async n=>assert.match(await page.locator('#edit-rounds').textContent(),new RegExp(n+' / 10'));
 const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
 const load=async path=>{await menu();await page.locator('#panel-file').setInputFiles(resolve(harnessRoot,path));await idle();};
 const submit=async text=>{await page.locator('#edit-request-text').fill(text);await page.locator('#generate-edit').click();await idle();};
 const unchanged=async(before,values,n)=>{assert.deepEqual(await snapshot(),before);assert.deepEqual(await state(),values);await rounds(n);};
 stage='daily-studio-core-and-simple-shell';await page.goto(url.href);await idle();
 await page.waitForFunction(()=>document.getElementById('model-status').textContent.includes('gpt-6-luna'));
 assert.equal(await page.locator('#studio-version').getAttribute('data-build'),manifest.studio.buildSha256);
 const seed=JSON.parse(await page.locator('#workbench-seed').textContent());
 assert.equal(seed.pool.index.records.length,12);assert.equal(seed.pool.sha256,manifest.poolSha256);
 assert.equal(await page.locator('textarea:visible').count(),2);pass(stage);

 stage='local-satisfied-repeat-without-request-or-round';await load(inputs.menu);await rounds(0);
 const menuBefore=await snapshot(),menuState=await state();
 await submit('继续游戏按钮文字改为“继续游戏”，其他不变。');
 assert((await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));
 await unchanged(menuBefore,menuState,0);
 const editSnapshot=await page.evaluate(()=>window.panelWorkbench.editSnapshot());
 assert.equal(editSnapshot.report,null);assert.equal(editSnapshot.proposal,null);
 await page.locator('#generate-edit').click();await idle();await unchanged(menuBefore,menuState,0);pass(stage);
 stage='local-feedback-and-choices-fit-390px';await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:resolve(output,'satisfied-narrow.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1080});

 await load(inputs.scoped);const scopedBefore=await snapshot(),scopedState=await state();
 const ambiguous='恢复默认按钮文字改为“恢复声音”，其他不变。';
 await submit(ambiguous);assert(await page.locator('#edit-target-choices').isVisible());
 assert.deepEqual(await page.locator('#edit-target-options button').allTextContents(),['声音 · 恢复默认','显示 · 恢复默认']);
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:resolve(output,'choices-narrow.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1080});pass(stage);
 stage='same-name-choice-keyboard-and-mouse-do-not-dispatch';
 await page.locator('#edit-target-options button[data-row-id="row3"]').press('Enter');
 assert((await page.locator('#edit-target-name').innerText()).includes('显示 · 恢复默认'));
 assert.equal(await page.locator('#edit-request-text').inputValue(),ambiguous);await unchanged(scopedBefore,scopedState,0);
 await page.locator('#clear-edit-target').click();await submit(ambiguous);
 await page.locator('#edit-target-options button[data-row-id="row1"]').click();
 assert((await page.locator('#edit-target-name').innerText()).includes('声音 · 恢复默认'));await unchanged(scopedBefore,scopedState,0);pass(stage);
 stage='description-change-invalidates-detached-choice';await page.locator('#clear-edit-target').click();await submit(ambiguous);
 await page.evaluate(()=>{window.oldChoice=document.querySelector('#edit-target-options button');});
 await page.locator('#edit-request-text').fill('声音分组里的恢复默认按钮文字改为“恢复声音”，其他不变。');
 assert(await page.locator('#edit-target-choices').isHidden());await page.evaluate(()=>window.oldChoice.click());
 assert(await page.locator('#edit-target').isHidden());await unchanged(scopedBefore,scopedState,0);pass(stage);
 stage='authored-defaults-do-not-reset-played-values';
 await submit('主音量默认值改为70，亮度默认值改为40，其他不变。');
 assert((await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));
 assert.deepEqual(await state(),{row0:35,row2:81});await unchanged(scopedBefore,scopedState,0);pass(stage);

 stage='selected-mixed-title-request-held-without-partial-edit-or-dispatch';
 await page.locator('#select-edit-target').click();await page.locator('.selection-target[data-row-id="row1"]').press('Enter');
 const scopeText='声音分组里的恢复默认按钮文字改为“仅恢复声音”，标题改为“音频偏好”，其他不变。';
 const scopeEvents=await page.evaluate(()=>window.panelWorkbench.events());
 await submit(scopeText);assert((await page.locator('#edit-plan-status').innerText()).includes('超出范围'));
 assert((await page.locator('#edit-plan-status').innerText()).includes('本次未调用模型'));
 await unchanged(scopedBefore,scopedState,0);assert.equal(await page.locator('#edit-request-text').inputValue(),scopeText);
 assert((await page.locator('#edit-target-name').innerText()).includes('声音 · 恢复默认'));
 const scopeEdit=await page.evaluate(()=>window.panelWorkbench.editSnapshot());
 assert.equal(scopeEdit.context.request.text,scopeText);assert.deepEqual(scopeEdit.context.selection,{rowId:'row1'});
 assert.equal(scopeEdit.report,null);assert.equal(scopeEdit.proposal,null);
 assert.deepEqual(await page.evaluate(()=>window.panelWorkbench.events()),scopeEvents);pass(stage);
 stage='repeated-selected-scope-conflict-still-keeps-state-and-round';
 await page.locator('#generate-edit').click();await idle();await unchanged(scopedBefore,scopedState,0);
 assert((await page.locator('#edit-plan-status').innerText()).includes('超出范围'));pass(stage);
 stage='selected-scope-feedback-and-cancel-fit-390px';
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await page.locator('#clear-edit-target').isVisible());assert((await page.locator('#edit-plan-status').innerText()).includes('取消选择'));
 await page.screenshot({path:resolve(output,'scope-narrow.png'),fullPage:true});await page.setViewportSize({width:1440,height:1080});pass(stage);
 stage='changing-selected-request-clears-scope-feedback-without-dispatch';
 await page.locator('#edit-request-text').fill('这个按钮文字改为“恢复声音”，其他不变。');
 assert(!(await page.locator('#edit-plan-status').innerText()).includes('超出范围'));await unchanged(scopedBefore,scopedState,0);pass(stage);
 stage='cancel-selected-scope-keeps-original-description-without-auto-submit';
 await submit(scopeText);await page.screenshot({path:resolve(output,'scope-desktop.png'),fullPage:true});
 await page.locator('#clear-edit-target').click();assert(await page.locator('#edit-target').isHidden());
 assert(!(await page.locator('#edit-plan-status').innerText()).includes('超出范围'));
 assert.equal(await page.locator('#edit-request-text').inputValue(),scopeText);await unchanged(scopedBefore,scopedState,0);pass(stage);

 stage='local-edit-and-undo-preserve-state-without-refunding-round';
 await menu();await page.locator('#advanced-tools').click();
 await page.locator('#edit-title').fill('本地整体验收');await page.locator('#apply-edit').click();await idle();
 assert.equal((await snapshot()).panel.spec.title,'本地整体验收');assert.deepEqual(await state(),scopedState);await rounds(1);
 await menu();await page.locator('#undo').click();await idle();
 assert.deepEqual((await snapshot()).panel.spec,scopedBefore.panel.spec);await rounds(1);pass(stage);
 stage='refresh-restores-drafts-panel-played-values-and-used-round';
 await page.locator('#advanced-tools').click();
 await page.locator('#request-text').fill('日常入口整体验收：保留需求草稿。');
 await page.locator('#edit-request-text').fill('暂存修改草稿，稍后继续。');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ui-panel-studio.workspace.v1')).draft.editText==='暂存修改草稿，稍后继续。');
 const workspace=await saved(),beforeRefresh=await snapshot();await page.reload();await idle();
 await page.waitForFunction(()=>Boolean(window.panelWorkbench.snapshot().panel));
 assert.deepEqual((await snapshot()).panel.spec,beforeRefresh.panel.spec);assert.deepEqual(await state(),scopedState);
 assert.equal(await page.locator('#request-text').inputValue(),workspace.draft.text);
 assert.equal(await page.locator('#edit-request-text').inputValue(),workspace.draft.editText);
 assert.deepEqual((await saved()).editUsage,workspace.editUsage);await rounds(1);pass(stage);
 stage='existing-real-edit-import-retains-labels-actions-and-shared-budget';
 await load(inputs.edited);assert.deepEqual((await snapshot()).panel,bundles.edited);assert.deepEqual(await state(),{row0:35,row2:81});await rounds(1);
 assert.deepEqual(bundles.edited.spec.sections.flatMap(s=>s.rows).filter(r=>r.kind==='button').map(r=>r.buttonLabel),['仅恢复声音','仅恢复显示']);
 await page.screenshot({path:resolve(output,'daily-desktop.png'),fullPage:true});pass(stage);

 stage='actual-daily-zip-crc-checksums-and-source-closure';
 const ready=page.waitForEvent('download');await page.locator('#download-delivery').click();
 const zipPath=resolve(output,'downloaded.panel-delivery.zip');await(await ready).saveAs(zipPath);await idle();
 const zipBytes=await readFile(zipPath),files=readStoredZip(zipBytes);
 const delivery=JSON.parse(files.get('delivery-manifest.json').toString('utf8'));
 assert.equal(files.size,delivery.files.length+1);assert.equal(delivery.panelSha256,bundles.edited.sha256);
 for(const file of delivery.files){assert.equal(files.get(file.path)?.length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
 assert.equal(delivery.verification.unityImport,'NOT_RUN');assert.equal(delivery.verification.nativeInteraction,'NOT_RUN');
 assert.equal(delivery.verification.businessBinding,'NOT_CONNECTED');
 const archived=await validatePanelBundle(JSON.parse(files.get('pixi/panel.bundle.json').toString('utf8')),core);
 assert.deepEqual(archived,bundles.edited);
 assert.deepEqual(JSON.parse(files.get('unity/panel.bundle.json').toString('utf8')),archived);
 report.download={sha256:await digestBytes(zipBytes),files:files.size,panelSha256:archived.sha256};
 const extracted=await createOutputDirectory(resolve(output,'extracted'));
 for(const [path,bytes]of files){const target=resolve(extracted,path),rel=relative(extracted,target);
  assert(rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel));
  await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});
 }pass(stage);
 stage='download-opens-offline-and-keeps-group-reset-scopes';
 offline=await context.newPage();observe(offline);
 await offline.goto(pathToFileURL(resolve(extracted,'pixi/index.html')).href);
 await offline.waitForFunction(()=>window.panelDelivery&&document.getElementById('status').dataset.state==='ready');
 assert.deepEqual(await offline.evaluate(()=>window.panelDelivery.getState()),archived.state);
 const clickOffline=async rowId=>{
  const node=await offline.evaluate(id=>window.panelDelivery.inspect().nodes.find(n=>n.id===id),controlId(archived.spec.id,rowId));
  assert(node?.visible);const canvas=offline.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  await offline.mouse.click(box.x+(node.bounds.x+node.bounds.width/2)*box.width/archived.spec.canvas.width,
   box.y+(node.bounds.y+node.bounds.height/2)*box.height/archived.spec.canvas.height);
 };
 await clickOffline('row3');assert.deepEqual(await offline.evaluate(()=>window.panelDelivery.getState()),{row0:35,row2:40});
 await clickOffline('row1');assert.deepEqual(await offline.evaluate(()=>window.panelDelivery.getState()),{row0:70,row2:40});
 assert.deepEqual(await offline.evaluate(()=>window.panelDelivery.events().map(e=>e.event.name)),['panel.row3','panel.row1']);
 await offline.screenshot({path:resolve(output,'offline.png'),fullPage:true});pass(stage);
 stage='download-reimports-without-library-and-retains-used-round';
 model=await createWorkbenchModel({catalog:archived.catalog,pool:null},core);
 await model.importPanel(archived);assert.equal(canonicalJson(await model.exportPanel(archived.state)),canonicalJson(archived));
 await load(relative(harnessRoot,resolve(extracted,'pixi/panel.bundle.json')));
 assert.deepEqual((await snapshot()).panel,archived);assert.deepEqual(await state(),archived.state);await rounds(1);pass(stage);
 stage='no-model-request-error-or-historical-file-change';
 for(const file of report.historicalInputs)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,file.path))),file.sha256);
 assert.equal(report.modelRequests,0);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);
 assert.equal((await(await fetch(new URL('api/panel/studio',url))).json()).active,false);pass(stage);
 report.status='PASS';
}catch(error){report.status='FAIL';report.failure={stage,code:error.code??error.name,message:String(error.message).slice(0,1500)};
 process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});
}finally{
 model?.dispose();await browser?.close();await writeNewJson(output,'browser-report.json',report);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,modelCalls:0,failure:report.failure??null}));
}
