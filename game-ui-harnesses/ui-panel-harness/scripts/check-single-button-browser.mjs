#!/usr/bin/env node
/** Recompile acceptance uses an unchanged saved proposal. No generation requests. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {controlId} from '../src/compiler.mjs';
const args=process.argv.slice(2);
assert([6,8].includes(args.length)&&args[0]==='--workbench'&&args[2]==='--panel'&&args[4]==='--output'
 &&(args.length===6||args[6]==='--url'),'Required: --workbench <build> --panel <bundle> --output <fresh directory> [--url <loopback Studio>]');
const workbench=resolve(args[1]),panelPath=resolve(args[3]),output=await createOutputDirectory(args[5]);
const report={singleButtonBrowserVersion:'0.1',status:'RUNNING',modelCalls:0,modelRequests:0,externalRequests:0,
 checks:[],errors:[],sourceKind:'RECOMPILED_UNCHANGED_SAVED_PROPOSAL',nativeUnity:'NOT_RUN'};
const pass=name=>report.checks.push({name,status:'PASS'});
let server,browser,page,stage='setup';
try{
 const core=await loadWorkspaceCore(),manifest=await readJson(resolve(workbench,'workbench-build.json'));
 const bundle=await validatePanelBundle(await readJson(panelPath),core);report.panelSha256=bundle.sha256;report.build=manifest.studio;
 const audit=await readJson(resolve(harnessRoot,'output/single-button-recovery-input-v1/source-audit.json'));
 assert.equal(typeof audit.source,'string');
 const outputRoot=resolve(harnessRoot,'output'),source=resolve(outputRoot,audit.source);
 assert(source.startsWith(outputRoot+sep),'Saved source must stay inside local output');
 for(const file of audit.files)assert.equal(await digestBytes(await readFile(resolve(source,file.name))),file.sha256);
 const original=await readJson(resolve(source,'proposal.json')),originalContext=await readJson(resolve(source,'planning-context.json'));
 assert.deepEqual(bundle.spec,original.spec);assert.deepEqual(bundle.catalog,originalContext.catalog);
 assert.equal(bundle.spec.sections[0].rows.length,1);assert.equal(bundle.spec.sections[0].rows[0].buttonLabel,'开始');
 pass('original-five-source-files-and-full-spec-remain-unchanged');
 if(!args[7])server=await createWorkbenchServer({workbench,outputRoot:resolve(output,'unused-model-runs'),port:0,
  planner:async()=>{throw Error('UNEXPECTED_MODEL_CALL');},editor:async()=>{throw Error('UNEXPECTED_MODEL_CALL');}});
 const url=new URL(args[7]??server.url);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');
 for(const file of manifest.files){const response=await fetch(new URL(file.path==='index.html'?'':file.path,url));assert(response.ok);
  assert.equal(await digestBytes(new Uint8Array(await response.arrayBuffer())),file.sha256);}
 pass('served-static-files-match-fixed-candidate');
 const {chromium}=await loadWorkspaceTool('@playwright/test');
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
 const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});
 await context.route('**/*',route=>{const request=route.request(),target=new URL(request.url());
  if(request.method()!=='GET'){report.modelRequests++;return route.abort();}
  if(!['blob:','data:'].includes(target.protocol)&&target.origin!==url.origin){report.externalRequests++;return route.abort();}
  return route.continue();});
 page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>report.errors.push(error.message));page.on('console',entry=>{if(entry.type()==='error')report.errors.push(entry.text());});
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
 stage='import';await page.goto(url.href);await idle();await page.locator('#request-text').fill('生成一个开始按钮');
 await menu();await page.locator('#panel-file').setInputFiles(panelPath);await idle();
 assert.deepEqual(await page.evaluate(()=>window.panelWorkbench.snapshot().panel),bundle);
 assert.equal(await page.locator('#preview-error').innerText(),'');assert.equal(await page.locator('#panel-name').innerText(),'开始');
 const inspected=await page.evaluate(()=>window.panelWorkbench.inspect());
 const button=inspected.nodes.find(n=>n.id===controlId(bundle.spec.id,'row0'));assert(button?.visible);
 assert.equal(button.bounds.height,48);assert.match(await page.locator('#edit-rounds').innerText(),/0 \/ 10/);
 pass('recovered-single-button-renders-with-zero-edit-rounds');
 stage='click';const canvas=page.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 await page.mouse.click(box.x+(button.bounds.x+button.bounds.width/2)*box.width/bundle.spec.canvas.width,
  box.y+(button.bounds.y+button.bounds.height/2)*box.height/bundle.spec.canvas.height);
 const events=await page.evaluate(()=>window.panelWorkbench.events());assert.equal(events.length,1);
 assert.equal(events[0].name,'panel.row0');assert.deepEqual(await page.evaluate(()=>window.panelWorkbench.getState()),{});
 pass('start-button-click-emits-the-original-preview-event-once');
 stage='reload';await page.reload();await idle();await page.waitForFunction(()=>Boolean(window.panelWorkbench.snapshot().panel));
 assert.deepEqual(await page.evaluate(()=>window.panelWorkbench.snapshot().panel),bundle);
 assert.equal(await page.locator('#request-text').inputValue(),'生成一个开始按钮');
 assert.match(await page.locator('#edit-rounds').innerText(),/0 \/ 10/);pass('refresh-restores-exact-single-button-and-original-description');
 stage='download';await menu();const pending=page.waitForEvent('download');await page.locator('#download-panel').click();
 await(await pending).saveAs(resolve(output,'downloaded.panel.bundle.json'));await idle();
 assert.deepEqual(await validatePanelBundle(await readJson(resolve(output,'downloaded.panel.bundle.json')),core),bundle);
 pass('actual-panel-download-strictly-recompiles');
 stage='viewports';await page.screenshot({path:resolve(output,'single-button-desktop.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#canvas-host').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'single-button-narrow.png'),fullPage:false});
 pass('desktop-and-390px-preview-have-no-page-overflow');
 for(const file of audit.files)assert.equal(await digestBytes(await readFile(resolve(source,file.name))),file.sha256);
 assert.equal(report.modelRequests,0);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);
 pass('no-new-model-request-browser-error-or-source-file-change');report.status='PASS';
}catch(error){report.status='FAIL';report.failure={stage,code:error.code??error.name,message:String(error.message).slice(0,1500)};
 process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});
}finally{await browser?.close();await server?.close();await writeNewJson(output,'browser-report.json',report);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,modelCalls:0,failure:report.failure??null}));}
