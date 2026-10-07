#!/usr/bin/env node
/** Visible journeys and actual ZIP/offline use. Injected fixtures, zero model calls. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {checkPanelProposal,proposalTargets} from '../src/proposal.mjs';
import {checkPanelEditProposal} from '../src/edit-planning.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {formIntent} from '../examples/forms-v1/fixture.mjs';
import {progressIntent} from '../examples/progress-v1/fixture.mjs';
import {controlId} from '../src/compiler.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';

const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){assert(['--workbench','--output'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[i+1];}
assert.equal(Object.keys(options).length,2);
const output=await createOutputDirectory(options['--output']),report={version:'0.1',status:'RUNNING',checks:[],deliveries:[],screenshots:[],modelCalls:0,automaticRetries:0,nativeEngines:'NOT_RUN',humanVisualReview:'NOT_RUN',scope:'Visible generate/edit/download with injected explicit fixture adapters; real Pixi, ZIP and offline reimport.'};
const pass=name=>report.checks.push({name,status:'PASS'}),calls=[],problems=[];
let browser,context,page,offline,server,stage='verified-build-and-runtime',mode='settings';
try{
 const core=await loadWorkspaceCore(),sources=await readUnityAdapterSources(),runtime=await buildDeliveryRuntime();
 const manifest=await readJson(resolve(options['--workbench'],'workbench-build.json'));
 assert.equal(manifest.status,'COMPLETE');assert.equal(manifest.deliveryRuntime.sha256,runtime.sha256);
 for(const file of manifest.files){const bytes=await readFile(resolve(options['--workbench'],file.path));assert.equal(bytes.length,file.bytes);assert.equal(await digestBytes(bytes),file.sha256);}
 report.build=manifest;pass(stage);
 const fixture=await readJson(new URL('../examples/settings-controls.panel.json',import.meta.url));
 fixture.state.find(field=>field.id==='volume').initial=70;fixture.state.find(field=>field.id==='muted').initial=false;
 fixture.provenance={kind:'agent-authored',description:'Explicit delivery UI fixture; not a model result.',assumptions:[]};
 const basis=request=>({kind:'request-interpretation',start:0,end:request.text.length,quote:request.text});
 const invoke=operation=>async input=>{
  calls.push({operation,request:input.request,contextSha256:input.sha256,fixture:mode});let proposal,checked;
  if(operation==='plan'){
   if(mode==='settings'){
    const spec=structuredClone(fixture);spec.id=input.request.id;
    proposal={proposalVersion:input.planningContextVersion,contextSha256:input.sha256,spec,decisions:proposalTargets(spec,input.planningContextVersion).map(target=>({target,basis:basis(input.request)})),unresolved:[]};
   }else{
    const intent=mode==='form'?formIntent(input):progressIntent(input);
    if(mode==='loading'){
     intent.panelIntentVersion='0.6';for(const row of intent.panel.body.children[0].rows)if(row.kind==='button')row.submitRows=[];
     if(manifest.library){const surface=input.assetRetrieval?.candidates.find(candidate=>candidate.slot==='panel-surface');assert(surface,'Asset fixture requires verified surface candidate');intent.panel.panelSurface=surface.asset.key;}
    }
    proposal=await materializePanelIntent(input,intent);
   }
   checked=await checkPanelProposal(input,proposal);
  }else{
   const operations=[{op:'set-panel-title',title:'声音设置'},{op:'set-state-initial',fieldId:'volume',value:50},
    {op:'add-row',sectionId:'preferences',afterRowId:'mute-row',row:{...fixture.sections[0].rows.find(row=>row.kind==='slider'),id:'sfx-row',label:'音效音量',bind:'sfxVolume',event:'sfx.changed'},state:{id:'sfxVolume',type:'number',initial:40,min:0,max:100,step:1}}];
   proposal={editProposalVersion:'0.1',contextSha256:input.sha256,patch:{patchVersion:'0.1',baseSpecSha256:input.baseSpecSha256,reason:'Explicit delivery edit fixture.',operations},decisions:operations.map((_item,operationIndex)=>({operationIndex,basis:basis(input.request)})),unresolved:[]};
   checked=await checkPanelEditProposal(input,proposal);
  }
  assert.equal(checked.status,operation==='plan'?'READY_TO_COMPILE':'READY_TO_APPLY');
  return{proposal,report:checked,receipt:{[operation==='plan'?'codexPlanningReceiptVersion':'codexEditingReceiptVersion']:'0.1',status:checked.status,model:'gpt-6-luna',effort:'xhigh',contextSha256:input.sha256,proposalSha256:checked.proposalSha256,failureCode:null,invocationCount:1,automaticRetries:0,elapsedMs:0,usage:null}};
 };
 server=await createWorkbenchServer({workbench:resolve(options['--workbench']),outputRoot:resolve(output,'fixture-transport'),port:0,planner:invoke('plan'),editor:invoke('edit')});
 const origin=new URL(server.url).origin;
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true});
 await context.route(url=>!['file:','data:','blob:'].includes(url.protocol)&&url.origin!==origin,route=>{problems.push('External request');return route.abort();});
 await context.addInitScript(()=>{
  window.deliveryBusy=[];
  new MutationObserver(()=>{if(document.body?.classList.contains('busy'))window.deliveryBusy.push({disabled:document.getElementById('download-delivery')?.disabled,inert:document.getElementById('canvas-host')?.inert});}).observe(document,{subtree:true,attributes:true,attributeFilter:['class','disabled','inert']});
 });
 const track=p=>{p.on('pageerror',error=>problems.push(error.message));p.on('console',item=>{if(item.type()==='error')problems.push(item.text());});p.setDefaultTimeout(30000);};
 page=await context.newPage();track(page);
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const snap=()=>page.evaluate(()=>window.panelWorkbench.snapshot()),state=()=>page.evaluate(()=>window.panelWorkbench.getState());
 const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(node=>node.open))await page.locator('#panel-menu>summary').click();};
 const healthy=async()=>{assert.deepEqual(problems,[]);for(const id of ['preview-error','request-error','edit-plan-error','proposal-error'])assert.equal((await page.locator('#'+id).textContent()).trim(),'');};
 const capture=async(name,p=page)=>{await p.screenshot({path:resolve(output,name),fullPage:true});report.screenshots.push(name);};
 const control=async(p,source,rowId,standalone=false,ratio=null)=>{
  const inspection=await p.evaluate(flag=>flag?window.panelDelivery.inspect():window.panelWorkbench.inspect(),standalone);
  const node=inspection.nodes.find(node=>node.id===controlId(source.spec.id,rowId));assert(node&&node.bounds,'Visible node required');
  const canvas=p.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  const x=ratio===null?node.bounds.x+node.bounds.width/2:node.bounds.x+14+ratio*(node.bounds.width-28);
  await p.mouse.click(box.x+x*box.width/source.spec.canvas.width,box.y+(node.bounds.y+node.bounds.height/2)*box.height/source.spec.canvas.height);
 };
 const download=async(selector,name)=>{const waiting=page.waitForEvent('download');await page.locator(selector).click();await idle();const download=await waiting;assert.equal(await download.failure(),null);await download.saveAs(resolve(output,name));return{bytes:await readFile(resolve(output,name)),filename:download.suggestedFilename()};};
 const pack=async name=>{
  const before=await snap(),played=await state(),eventCount=(await page.evaluate(()=>window.panelWorkbench.events())).length;
  const archive=await download('#download-delivery',name+'.zip'),files=readStoredZip(archive.bytes),manifest=JSON.parse(files.get('delivery-manifest.json'));
  assert.equal(manifest.status,'COMPLETE');assert.equal(files.size,manifest.files.length+1);
  for(const file of manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  const source=await validatePanelBundle(JSON.parse(files.get('pixi/panel.bundle.json')),core);assert.deepEqual(source.spec,before.panel.spec);assert.deepEqual(source.state,played);
  assert.deepEqual(JSON.parse(files.get('unity/panel.bundle.json')),source);
  for(const resource of source.componentBundle.resources){const bytes=Buffer.from(resource.base64,'base64');assert.deepEqual(files.get('pixi/'+resource.path),bytes);assert.deepEqual(files.get('unity/'+resource.path),bytes);}
  assert.equal(archive.filename,source.spec.id+'.panel-delivery.zip');
  assert.equal(manifest.panelSha256,source.sha256);assert.equal(manifest.verification.unityImport,'NOT_RUN');assert.equal(manifest.verification.nativeInteraction,'NOT_RUN');
  assert.equal(JSON.parse(files.get('integration-contract.json')).panelSha256,source.sha256);
  assert.deepEqual(JSON.parse(files.get('game-binding.template.json')).states,[]);
  const cli=await createPanelDelivery(source,core,{runtime,unityKit:await createUnityKitFiles(source,core,sources)});
  for(const [path,bytes]of cli.contents)assert.equal(await digestBytes(files.get(path)),await digestBytes(bytes),'Browser/CLI '+path);
  assert.equal(await digestBytes(archive.bytes),await digestBytes(createStoredZip(cli.contents)));
  assert.equal((await snap()).panel.sha256,before.panel.sha256);assert.deepEqual((await snap()).history,before.history);assert.deepEqual(await state(),played);assert.equal((await page.evaluate(()=>window.panelWorkbench.events())).length,eventCount);
  const folder=resolve(output,name);await mkdir(folder);
  for(const [path,bytes]of files){assert(/^[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').includes('..')&&!path.startsWith('/'));const target=resolve(folder,path);assert(target.startsWith(folder+'/')||target.startsWith(folder+'\\'));await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
  report.deliveries.push({name,panelId:source.spec.id,panelSha256:source.sha256,zipSha256:await digestBytes(archive.bytes),zipBytes:archive.bytes.length});await healthy();return{source,files,folder,archive};
 };
 stage='default-left-two-inputs-selection-helper-download-disabled-until-generated';await page.goto(server.url);await idle();
 assert.equal(await page.locator('textarea:visible').count(),2);assert.deepEqual(await page.locator('.request-column button:visible').allTextContents(),['生成面板','选择修改对象','修改面板']);assert(await page.locator('#select-edit-target').isDisabled());assert(await page.locator('#download-delivery').isDisabled());pass(stage);
 stage='generate-settings-through-visible-button';
 await page.locator('#request-text').fill('生成设置面板：主音量范围0～100，步长1，默认70；静音默认关闭；画质三档默认高；恢复默认重置原有设置；应用按钮通知宿主。');
 await page.locator('#generate-plan').click();await idle();await healthy();const initial=(await snap()).panel;assert(initial);assert.equal(calls.length,1);pass(stage);
 stage='real-slider-and-toggle-trial-retained';const slider=initial.spec.sections[0].rows.find(row=>row.kind==='slider'),toggle=initial.spec.sections[0].rows.find(row=>row.kind==='switch');
 await control(page,initial,slider.id,false,0.23);
 await control(page,initial,toggle.id);const played=await state();assert.equal(played.volume,23);assert.equal(played.muted,true);pass(stage);
 stage='visible-edit-adds-slider-without-resetting-played-values';
 await page.locator('#edit-request-text').fill('标题改成声音设置。主音量默认值改为50；在静音后增加音效音量滑条，0～100，步长1，默认40。恢复默认的原有范围保持不变。');await page.locator('#generate-edit').click();await idle();await healthy();
 const modified=(await snap()).panel;assert.equal(modified.spec.id,initial.spec.id);assert.equal(modified.spec.state.find(field=>field.id==='volume').initial,50);assert.deepEqual(await state(),{...played,sfxVolume:40});assert.equal(calls.length,2);pass(stage);
 stage='download-complete-package-shares-browser-cli-bytes-and-freezes-current-state';const settings=await pack('settings-delivery');
 const busy=await page.evaluate(()=>window.deliveryBusy);assert(busy.length&&busy.every(item=>item.disabled&&item.inert));await capture('studio-download-desktop.png');pass(stage);
 stage='same-panel-same-state-repeated-download-identical';const repeated=await download('#download-delivery','settings-repeat.zip');assert.deepEqual(repeated.bytes,settings.archive.bytes);assert.equal(calls.length,2);pass(stage);
 stage='shared-sdk-keeps-stable-script-guids-and-is-separate-from-panel-package';await menu();const sdk=await download('#download-shared-sdk','shared-sdk.zip'),sdkFiles=readStoredZip(sdk.bytes),sdkManifest=JSON.parse(sdkFiles.get('sdk-manifest.json'));
 assert.equal(sdkManifest.coreSharedScripts,3);assert.equal(sdkManifest.optionalExampleScripts,1);
 for(const file of sdkManifest.files){assert.equal(sdkFiles.get(file.path).length,file.bytes);assert.equal(await digestBytes(sdkFiles.get(file.path)),file.sha256);if(file.path.startsWith('Assets/PanelHarness/')){const path=file.path.replace('Assets/PanelHarness/','adapters/unity/');assert.deepEqual(sdkFiles.get(file.path),await readFile(resolve(harnessRoot,path)));}}
 assert.equal(sdkFiles.size,sdkManifest.files.length+1);assert.equal([...settings.files.keys()].some(path=>path.includes('GameRuntime')),false);assert.equal(calls.length,2);report.sharedSdk={filename:sdk.filename,zipSha256:await digestBytes(sdk.bytes)};pass(stage);
 stage='standalone-file-offline-preview-retains-current-values-and-reset-defaults';offline=await context.newPage();track(offline);
 await offline.goto(pathToFileURL(resolve(settings.folder,'pixi/index.html')).href);await offline.waitForFunction(()=>window.panelDelivery&&document.getElementById('status').dataset.state==='ready');
 assert.deepEqual(await offline.evaluate(()=>window.panelDelivery.getState()),settings.source.state);
 const reset=settings.source.spec.sections.flatMap(section=>section.rows).find(row=>row.action?.kind==='reset-initial');await control(offline,settings.source,reset.id,true);
 assert.equal((await offline.evaluate(()=>window.panelDelivery.getState())).volume,50);assert.equal((await offline.evaluate(()=>window.panelDelivery.getState())).sfxVolume,40);pass(stage);
 stage='standalone-silent-write-close-reopen-and-clean-destruction';
 const prior=await offline.evaluate(()=>window.panelDelivery.events().length);
 await offline.evaluate(async()=>{const app=window.panelDelivery;app.setState({...app.getState(),volume:23});app.panel.close();await app.panel.open();});
 assert.equal((await offline.evaluate(()=>window.panelDelivery.getState())).volume,23);assert.equal(await offline.locator('#canvas-host canvas').count(),1);assert.equal(await offline.evaluate(()=>window.panelDelivery.events().length),prior);
 await offline.evaluate(()=>window.panelDelivery.destroy());assert.equal(await offline.locator('#canvas-host canvas').count(),0);pass(stage);
 stage='modified-export-reopens-in-studio-with-original-authored-defaults';await menu();await page.locator('#panel-file').setInputFiles(resolve(settings.folder,'pixi/panel.bundle.json'));await idle();assert.deepEqual(await state(),settings.source.state);assert.deepEqual((await snap()).panel.spec,settings.source.spec);assert.equal(calls.length,2);pass(stage);
 stage='mobile-studio-download-and-preview-have-no-horizontal-overflow';await page.setViewportSize({width:390,height:844});await page.locator('#download-delivery').scrollIntoViewIfNeeded();assert(await page.locator('#download-delivery').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture('studio-mobile.png');pass(stage);
 stage='new-form-request-generates-a-distinct-panel-and-uses-same-runtime';mode='form';await page.setViewportSize({width:1440,height:1000});await page.locator('#request-text').fill('生成角色命名面板：角色名输入框，单行文本，初始为空，占位文字请输入角色名，必填，最少2个字符，最多12个字符；确认按钮校验并提交角色名；取消只通知宿主。');await page.locator('#generate-plan').click();await idle();await healthy();const form=await pack('form-delivery');assert.notEqual(form.source.spec.id,settings.source.spec.id);assert.deepEqual(form.files.get('pixi/panel-runtime.js'),settings.files.get('pixi/panel-runtime.js'));pass(stage);
 stage='offline-form-edit-and-submit-keep-unicode-and-validation';await offline.goto(pathToFileURL(resolve(form.folder,'pixi/index.html')).href);await offline.waitForFunction(()=>window.panelDelivery&&document.getElementById('status').dataset.state==='ready');
 await control(offline,form.source,'row0',true);const input=offline.locator('#canvas-host input');await input.waitFor({state:'visible'});await input.fill('角色😀');await input.press('Tab');await control(offline,form.source,'row1',true);
 assert.equal((await offline.evaluate(()=>window.panelDelivery.getState())).row0,'角色😀');const formEvents=await offline.evaluate(()=>window.panelDelivery.events());assert(formEvents.some(envelope=>JSON.stringify(envelope).includes('角色😀')));await capture('offline-form.png',offline);pass(stage);
 stage='new-loading-request-download-has-read-only-progress';mode='loading';await page.locator('#request-text').fill('生成资源加载面板：加载进度0～1，初始0.2，百分比一位小数；已下载0～250，初始50，两位小数；声音默认开启；重新开始仅重置加载进度。');await page.locator('#generate-plan').click();await idle();await healthy();const loading=await pack('loading-delivery');assert.notEqual(loading.source.spec.id,form.source.spec.id);pass(stage);
 stage='offline-mobile-loader-accepts-host-progress-without-player-event';if(manifest.library)assert(loading.source.componentBundle.resources.length>0);await offline.setViewportSize({width:390,height:844});await offline.goto(pathToFileURL(resolve(loading.folder,'pixi/index.html')).href);await offline.waitForFunction(()=>window.panelDelivery&&document.getElementById('status').dataset.state==='ready');
 await offline.evaluate(()=>{window.panelDelivery.setProgress('row0',0.78);window.panelDelivery.setProgress('row1',194);});assert.equal((await offline.evaluate(()=>window.panelDelivery.getState())).row0,0.78);assert.equal(await offline.evaluate(()=>window.panelDelivery.events().length),0);assert(await offline.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await capture('offline-loading-mobile.png',offline);pass(stage);
 stage='all-panel-packages-keep-one-identical-runtime-source-and-distinct-documents';
 for(const other of [form,loading]){for(const path of [...settings.files.keys()].filter(path=>/^unity\/Runtime\//.test(path)))assert.deepEqual(other.files.get(path),settings.files.get(path));assert.deepEqual(other.files.get('unity/unity-runtime.json'),settings.files.get('unity/unity-runtime.json'));}
 assert.equal(calls.length,4);assert.deepEqual(calls.map(call=>call.operation),['plan','edit','plan','plan']);await healthy();pass(stage);
 report.status='PASS';
}catch(error){report.status='FAIL';report.failure={stage,code:error.code??error.name,message:String(error.message).slice(0,1200)};if(page)try{await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});}catch{}process.exitCode=1;
}finally{
 report.fixtureCalls=calls;report.browserProblems=problems;
 await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await server?.close().catch(()=>{});
 await writeNewJson(output,'delivery-browser-report.json',report);console.log(JSON.stringify({status:report.status,checks:report.checks.length,modelCalls:0,failedStage:report.failure?.stage??null}));
}
