#!/usr/bin/env node
/** New-panel lifecycle in isolated storage. All model POSTs and external requests are denied. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {emptyWorkbenchDraft,WORKBENCH_STORAGE_KEY} from '../src/workbench-storage.mjs';

const args=process.argv.slice(2);
assert([4,6].includes(args.length)&&args[0]==='--workbench'&&args[2]==='--output'
 &&(args.length===4||args[4]==='--url'),'Required: --workbench <build> --output <fresh directory> [--url <loopback Studio>]');
const workbench=resolve(args[1]),output=await createOutputDirectory(args[3]);
const report={newPanelBrowserVersion:'0.1',status:'RUNNING',modelCalls:0,modelRequests:0,externalRequests:0,
 checks:[],errors:[],storage:'ISOLATED_BROWSER_CONTEXT',nativeUnity:'NOT_RUN'};
const pass=name=>report.checks.push({name,status:'PASS'});
let server,browser,page,stage='setup';
try{
 const manifest=await readJson(resolve(workbench,'workbench-build.json'));report.build=manifest.studio;
 const unexpected=async()=>{throw Error('UNEXPECTED_MODEL_CALL');};
 if(!args[5])server=await createWorkbenchServer({workbench,outputRoot:resolve(output,'unused-model-runs'),port:0,planner:unexpected,editor:unexpected});
 const url=new URL(args[5]??server.url);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');assert.equal(url.pathname,'/');
 for(const file of manifest.files){
  assert.equal(await digestBytes(await readFile(resolve(workbench,file.path))),file.sha256);
  const response=await fetch(new URL(file.path==='index.html'?'':file.path,url));assert(response.ok);
  assert.equal(await digestBytes(new Uint8Array(await response.arrayBuffer())),file.sha256);
 }
 pass('served-files-match-candidate-build');
 const basePath=resolve(harnessRoot,'output/continuous-edit-real-plan-v1/panel.bundle.json'),baseBytes=await readFile(basePath),base=JSON.parse(baseBytes);
 assert.equal(base.sha256,'f4fcaaff8c9149d3dfee0e09ddabe38e5637f51902098ad3fa9509f932af98d2');
 report.baseFileSha256=await digestBytes(baseBytes);
 const {chromium}=await loadWorkspaceTool('@playwright/test');
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
 const context=await browser.newContext({viewport:{width:1440,height:1080},serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const request=route.request(),target=new URL(request.url());
  if(request.method()!=='GET'){report.modelRequests++;return route.abort();}
  if(!['blob:','data:'].includes(target.protocol)&&target.origin!==url.origin){report.externalRequests++;return route.abort();}
  return route.continue();
 });
 await context.addInitScript(key=>{
  const original=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,value){
   if(k===key&&window.failWorkspaceWrites)throw new DOMException('Authored storage fault','QuotaExceededError');
   return original.call(this,k,value);
  };
 },WORKBENCH_STORAGE_KEY);
 const observe=p=>{p.setDefaultTimeout(15000);p.on('pageerror',error=>report.errors.push(error.message));
  p.on('console',entry=>{if(entry.type()==='error')report.errors.push(entry.text());});};
 page=await context.newPage();observe(page);
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const snapshot=()=>page.evaluate(()=>window.panelWorkbench.snapshot());
 const saved=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),WORKBENCH_STORAGE_KEY);
 const raw=()=>page.evaluate(key=>localStorage.getItem(key),WORKBENCH_STORAGE_KEY);
 const rounds=async n=>assert.match(await page.locator('#edit-rounds').innerText(),new RegExp(n+' / 10'));
 const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
 const restoreLatest=async()=>{
  await menu();await page.locator('#open-saved-history').click();
  await page.locator('#saved-versions button').first().click();await idle();
 };
 const checkBlank=async()=>{
  const current=await snapshot();assert.equal(current.panel,null);assert.equal(current.context,null);
  assert.equal(current.canUndo,false);assert.deepEqual(current.history,[]);
  const edit=await page.evaluate(()=>window.panelWorkbench.editSnapshot());assert.equal(edit.context,null);assert.equal(edit.report,null);
  assert.equal(await page.locator('#request-text').inputValue(),'');assert.equal(await page.locator('#edit-request-text').inputValue(),'');
  for(const id of ['empty-preview'])assert(await page.locator('#'+id).isVisible());
  for(const id of ['clarification-form','edit-clarification-form','edit-target','edit-target-choices','edit-changes'])assert(await page.locator('#'+id).isHidden());
  for(const id of ['generate-plan','generate-edit','download-panel','download-delivery','undo'])assert(await page.locator('#'+id).isDisabled());
  assert.deepEqual(await page.evaluate(()=>window.panelWorkbench.events()),[]);
  assert.equal(await page.locator('#live-state').textContent(),'');assert.equal(await page.locator('#event-output').textContent(),'尚未操作');
  assert.equal((await saved()).currentId,null);assert.deepEqual((await saved()).draft,emptyWorkbenchDraft());
 };
 stage='initial-blank';await page.goto(url.href);await idle();
 assert(await page.locator('#new-panel').isVisible());assert(await page.locator('#new-panel').isEnabled());
 await page.locator('#new-panel').click();await idle();await checkBlank();
 assert(await page.locator('#request-text').evaluate(n=>document.activeElement===n));pass('visible-new-button-starts-focused-blank-without-a-model-request');
 stage='saved-panel';await menu();await page.locator('#panel-file').setInputFiles(basePath);await idle();
 assert.deepEqual((await snapshot()).panel,base);await rounds(0);
 await menu();await page.locator('#advanced-tools').click();
 await page.locator('#edit-title').fill('新建前的音频设置');await page.locator('#apply-edit').click();await idle();await rounds(1);
 await page.locator('#request-text').fill('原面板需求草稿');await page.locator('#edit-request-text').fill('把标题改为“下一版”，其他不变。');
 await page.locator('#prepare-edit-context').click();await idle();assert((await page.evaluate(()=>window.panelWorkbench.editSnapshot())).context);
 await page.locator('#prepare').click();await idle();const oldRequestId=(await snapshot()).context.request.id;
 await page.locator('#select-edit-target').click();await page.locator('.selection-target[data-row-id="row0"]').press('Enter');
 assert(await page.locator('#edit-target').isVisible());
 await page.locator('details').filter({has:page.locator('#patch-json')}).locator('summary').click();
 await page.locator('#patch-json').fill('未提交补丁');
 const panelBefore=(await snapshot()).panel,stateBefore=await page.evaluate(()=>window.panelWorkbench.getState());
 assert.deepEqual(stateBefore,base.state);assert.equal(panelBefore.spec.assets.rowIcons.length,3);
 stage='new-clears-context';await page.locator('#new-panel').click();await idle();await checkBlank();
 const blank=await saved();assert.equal(blank.versions.length,2);assert.equal(blank.editUsage[base.spec.id],1);
 const old=blank.versions.at(-1);assert.deepEqual(old.panel,panelBefore);assert.deepEqual(old.state,stateBefore);
 assert.equal(old.draft.text,'原面板需求草稿');assert.equal(old.draft.editText,'把标题改为“下一版”，其他不变。');
 assert.equal(await page.locator('#patch-json').inputValue(),'');
 assert(await page.locator('#request-text').evaluate(n=>document.activeElement===n));
 pass('new-clears-inputs-preview-selection-contexts-undo-and-pending-patch-but-retains-complete-history');
 stage='blank-reload';await page.reload();await idle();await checkBlank();assert.deepEqual(await saved(),blank);
 await page.locator('#new-panel').click();await idle();assert.deepEqual(await saved(),blank);
 pass('blank-with-history-survives-reload-and-repeated-new-without-duplicate-versions');
 stage='fresh-identity';await page.locator('#request-text').fill(old.draft.text);
 await page.locator('#prepare').click();await idle();assert.notEqual((await snapshot()).context.request.id,oldRequestId);
 assert.equal((await saved()).draft.manualId,false);assert.deepEqual((await saved()).editUsage,blank.editUsage);
 pass('same-requirement-starts-a-fresh-automatic-identity-without-refunding-old-rounds');
 stage='history-restore';await restoreLatest();await rounds(1);
 assert.deepEqual((await snapshot()).panel,panelBefore);assert.deepEqual(await page.evaluate(()=>window.panelWorkbench.getState()),stateBefore);
 assert.equal(await page.locator('#request-text').inputValue(),old.draft.text);assert.equal(await page.locator('#edit-request-text').inputValue(),old.draft.editText);
 pass('history-restore-recovers-exact-panel-three-icons-played-values-drafts-and-used-round');
 stage='quota-failure';const beforeRaw=await raw();await page.evaluate(()=>{window.failWorkspaceWrites=true;});
 await page.locator('#new-panel').click();await idle();assert.equal(await raw(),beforeRaw);
 assert.deepEqual((await snapshot()).panel,panelBefore);await rounds(1);
 assert((await page.locator('#save-status').innerText()).includes('空间不足'));
 assert.equal(await page.locator('#request-text').inputValue(),old.draft.text);
 await page.evaluate(()=>{window.failWorkspaceWrites=false;});
 pass('failed-save-keeps-current-panel-inputs-and-original-storage-bytes');
 await page.locator('#request-text').fill(old.draft.text);
 await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('已保存到本机'));
 stage='narrow';await menu();await page.locator('#advanced-tools').click();
 await page.waitForFunction(()=>!document.body.classList.contains('advanced-mode'));
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#new-panel').scrollIntoViewIfNeeded();assert(await page.locator('#new-panel').isVisible());
 await page.screenshot({path:resolve(output,'new-button-narrow.png'),fullPage:false});
 await page.setViewportSize({width:1440,height:1080});await page.locator('#new-panel').scrollIntoViewIfNeeded();
 await page.screenshot({path:resolve(output,'new-button-desktop.png'),fullPage:false});pass('new-button-fits-desktop-and-390px-toolbar');
 stage='concurrent-tab';const other=await context.newPage();observe(other);await other.goto(url.href);
 await other.waitForFunction(()=>window.panelWorkbench?.snapshot().panel&&!window.panelWorkbench.busy);
 await other.locator('#request-text').fill('另一标签页正在继续原任务');
 await page.waitForFunction(()=>document.getElementById('save-status').textContent.includes('另一标签页'));
 assert(await page.locator('#new-panel').isDisabled());assert.deepEqual((await snapshot()).panel,panelBefore);await rounds(1);
 await other.close();pass('concurrent-tab-save-disables-new-button-and-keeps-current-work');
 assert.deepEqual(await readFile(basePath),baseBytes);assert.equal(report.modelRequests,0);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);
 pass('no-model-request-external-request-browser-error-or-historical-artifact-change');report.status='PASS';
}catch(error){report.status='FAIL';report.failure={stage,code:error.code??error.name,message:String(error.message).slice(0,1500)};
 process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});
}finally{await browser?.close();await server?.close();await writeNewJson(output,'browser-report.json',report);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,modelCalls:0,failure:report.failure??null}));}
