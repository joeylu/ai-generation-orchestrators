#!/usr/bin/env node
/** Native HTTP response faults plus one authored editor. No model transport. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {listenLoopback} from '../src/loopback-listener.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {checkPanelEditProposal} from '../src/edit-planning.mjs';
import {digestBytes} from '../src/canonical.mjs';
assert(process.argv.length===6&&process.argv[2]==='--workbench'&&process.argv[4]==='--output',
 'Required: --workbench <build> --output <fresh directory>');
const workbench=resolve(process.argv[3]),output=await createOutputDirectory(process.argv[5]);
const report={responseRecoveryBrowserVersion:'0.1',status:'RUNNING',sourceKind:'LOCAL_HTTP_FAULTS_AND_AUTHORED_EDITOR',
 modelCalls:0,automaticRetries:0,fixtureEditorCalls:0,fixturePosts:0,externalRequests:0,unexpectedRequests:0,
 checks:[],errors:[],expectedNetworkErrors:[],transportFaults:[],nativeUnity:'NOT_RUN',humanVisualReview:'NOT_RUN'};
const pass=name=>report.checks.push({name,status:'PASS'});
const text='标题改为“音频控制”，其他不变。';
let server,proxy,browser,page,active,releaseStream,stage='setup';
try{
 const core=await loadWorkspaceCore(),manifest=await readJson(resolve(workbench,'workbench-build.json'));
 for(const file of manifest.files)assert.equal(await digestBytes(await readFile(resolve(workbench,file.path))),file.sha256);
 report.build=manifest.studio;
 const basePath=resolve(harnessRoot,'output/continuous-edit-real-plan-v1/panel.bundle.json'),baseBytes=await readFile(basePath);
 const base=await validatePanelBundle(JSON.parse(baseBytes),core);
 assert.equal(base.sha256,'f4fcaaff8c9149d3dfee0e09ddabe38e5637f51902098ad3fa9509f932af98d2');
 assert.deepEqual(base.state,{row0:35,row1:19,row2:true});report.baseFileSha256=await digestBytes(baseBytes);
 assert.equal(base.spec.assets.rowIcons.length,3);assert.equal(base.assetClosure.records.length,3);
 await writeNewJson(output,'base.panel.bundle.json',base);
 server=await createWorkbenchServer({workbench,outputRoot:resolve(output,'authored-editor-runs'),port:0,
  planner:async()=>{throw Error('UNEXPECTED_PLANNER_CALL');},editor:async context=>{
   assert(active?.mode==='ready'&&!active.editorConsumed);active.editorConsumed=true;report.fixtureEditorCalls++;
   assert.equal(context.request.text,text);
   const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,
    reason:'Authored recovery fixture, not a model result.',operations:[{op:'set-panel-title',title:'音频控制'}]},
    bases:[{kind:'request-interpretation',quote:context.request.text}],unresolved:[],noChange:null};
   const proposal=await materializeCodexEditDraft(context,draft),checked=await checkPanelEditProposal(context,proposal);
   await writeNewJson(output,'authored-ready-context.json',context);await writeNewJson(output,'authored-ready-draft.json',draft);
   return{proposal,report:checked,receipt:{codexEditingReceiptVersion:'0.1',status:checked.status,model:'gpt-6-luna',effort:'xhigh',
    contextSha256:context.sha256,proposalSha256:checked.proposalSha256,failureCode:null,invocationCount:1,automaticRetries:0,elapsedMs:0,usage:null}};
  }});
 // GETs use the existing Studio server. Only explicitly armed POST faults are
 // intercepted here; a valid response goes to its injected editor, never a CLI.
 proxy=createServer(async(request,response)=>{
  try{
   if(request.method==='GET'){
    const fetched=await fetch(new URL(request.url,server.url));
    response.writeHead(fetched.status,{'Content-Type':fetched.headers.get('content-type')??'application/octet-stream'});
    response.end(Buffer.from(await fetched.arrayBuffer()));return;
   }
   assert(request.method==='POST'&&request.url==='/api/panel/edit'&&active&&!active.consumed,'UNARMED_POST');
   const own=active;own.consumed=true;report.fixturePosts++;
   const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;assert(size<=2*1024*1024);chunks.push(chunk);}
   const body=Buffer.concat(chunks),input=JSON.parse(body);assert.equal(input.context.request.text,text);
   if(own.mode==='ready'){
    const forwarded=await fetch(new URL('api/panel/edit',server.url),{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(server.url).origin},body});
    response.writeHead(forwarded.status,{'Content-Type':'application/json'});response.end(Buffer.from(await forwarded.arrayBuffer()));return;
   }
   if(own.mode==='network'){
    const payload=Buffer.from(JSON.stringify({protocol:'0.1',requestId:input.requestId,contextSha256:input.context.sha256,
     sourceKind:'AUTHORED_INCOMPLETE_TRANSPORT_FIXTURE',padding:'x'.repeat(1024)}));
    response.writeHead(200,{'Content-Type':'application/json','Content-Length':payload.length});response.write(payload.subarray(0,32));
    await new Promise(done=>{releaseStream=done;});own.destroyed=true;response.destroy();return;
   }
   assert(['malformed','limit'].includes(own.mode));response.writeHead(200,{'Content-Type':'application/json'});
   response.end(own.mode==='malformed'?'{"protocol":':'x'.repeat(2*1024*1024+1));
  }catch(error){report.errors.push('Fixture proxy: '+error.message);if(!response.headersSent)response.writeHead(500);response.end();}
 });
 await listenLoopback(proxy,0);const url=`http://127.0.0.1:${proxy.address().port}/`,origin=new URL(url).origin;
 const {chromium}=await loadWorkspaceTool('@playwright/test');
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
 const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const request=route.request(),target=new URL(request.url());
  if(!['blob:','data:'].includes(target.protocol)&&target.origin!==origin){report.externalRequests++;return route.abort();}
  if(request.method()!=='GET'&&!(request.method()==='POST'&&target.pathname==='/api/panel/edit'&&active&&!active.consumed)){
   report.unexpectedRequests++;return route.abort();
  }return route.continue();
 });
 await context.addInitScript(()=>{
  window.responseReads=[];const original=window.fetch.bind(window);
  window.fetch=async(...args)=>{
   const response=await original(...args);if(args[0]!=='/api/panel/edit')return response;
   const observation={bytes:0,complete:false,error:null};window.responseReads.push(observation);
   const getReader=response.body.getReader.bind(response.body);
   response.body.getReader=(...readerArgs)=>{
    const reader=getReader(...readerArgs),read=reader.read.bind(reader);
    reader.read=async()=>{try{const chunk=await read();observation.bytes+=chunk.value?.byteLength??0;
     if(chunk.done)observation.complete=true;return chunk;}catch(error){observation.error=error.name;throw error;}};
    return reader;
   };return response;
  };
 });
 page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',entry=>{
  if(entry.type()!=='error')return;
  if(entry.location().url===new URL('api/panel/edit',url).href&&/Failed to load resource: net::ERR_(?:CONTENT_LENGTH_MISMATCH|CONNECTION_RESET|CONNECTION_CLOSED)/.test(entry.text())){
   report.expectedNetworkErrors.push(entry.text());return;
  }report.errors.push(entry.text());
 });
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const snapshot=()=>page.evaluate(()=>window.panelWorkbench.snapshot()),state=()=>page.evaluate(()=>window.panelWorkbench.getState());
 const events=()=>page.evaluate(()=>window.panelWorkbench.events());
 const rounds=async n=>assert.match(await page.locator('#edit-rounds').textContent(),new RegExp(n+' / 10'));
 const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
 await page.goto(url);await idle();await menu();await page.locator('#panel-file').setInputFiles(resolve(output,'base.panel.bundle.json'));await idle();
 const before=await snapshot(),beforeEvents=await events();assert.deepEqual(before.panel,base);await rounds(0);pass('existing-real-base-with-three-embedded-icons-imports-exactly');
 for(const [mode,message]of [['network','连接中断'],['malformed','内容不完整或格式无法读取'],['limit','返回内容过大']]){
  stage=mode;active={mode,consumed:false};await page.locator('#edit-request-text').fill(text);await page.locator('#generate-edit').click();
  if(mode==='network'){
   await page.waitForFunction(()=>window.responseReads.at(-1)?.bytes===32);assert(releaseStream);releaseStream();releaseStream=null;
  }
  await idle();const shown=await page.locator('#edit-plan-error').innerText();assert(shown.includes(message));assert(shown.includes('原面板和试玩值保留'));
  assert(/未自动重试|不会自动重新提交/.test(shown));assert(!shown.includes('CODEX_'));
  assert(active.consumed);assert.equal(report.fixtureEditorCalls,0);assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await state(),base.state);assert.deepEqual(await events(),beforeEvents);await rounds(0);
  assert.equal(await page.locator('#edit-request-text').inputValue(),text);
  const edit=await page.evaluate(()=>window.panelWorkbench.editSnapshot());assert.equal(edit.proposal,null);assert.equal(edit.report,null);
  const reads=await page.evaluate(()=>window.responseReads.at(-1));
  if(mode==='network'){assert.equal(reads.bytes,32);assert.equal(reads.complete,false);assert.equal(reads.error,'TypeError');assert(active.destroyed);}
  report.transportFaults.push({mode,shown,reads,fixturePosts:report.fixturePosts});active=null;
  pass(mode+'-fault-keeps-panel-icons-played-state-history-and-round-with-no-retry');
 }
 assert.equal(report.fixturePosts,3);await page.screenshot({path:resolve(output,'failure-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert((await page.locator('#edit-plan-error').innerText()).includes('返回内容过大'));
 await page.screenshot({path:resolve(output,'failure-narrow.png'),fullPage:true});await page.setViewportSize({width:1440,height:1080});pass('failure-feedback-fits-390px');
 await menu();const downloaded=page.waitForEvent('download');await page.locator('#download-panel').click();await(await downloaded).saveAs(resolve(output,'after-failure.panel.bundle.json'));await idle();
 assert.deepEqual(await validatePanelBundle(await readJson(resolve(output,'after-failure.panel.bundle.json')),core),base);pass('original-real-result-still-downloads-and-strictly-recompiles-after-failures');
 await page.reload();await idle();await page.waitForFunction(()=>Boolean(window.panelWorkbench.snapshot().panel));
 assert.deepEqual((await snapshot()).panel,base);assert.deepEqual(await state(),base.state);await rounds(0);
 assert.equal(await page.locator('#edit-request-text').inputValue(),text);assert.equal(report.fixturePosts,3);pass('reload-restores-panel-icons-description-and-zero-used-rounds-without-resubmission');
 stage='manual-success';active={mode:'ready',consumed:false};await page.locator('#generate-edit').click();await idle();
 assert(active.editorConsumed);assert.equal(report.fixtureEditorCalls,1);assert.equal(report.fixturePosts,4);
 const expected=structuredClone(base.spec);expected.title='音频控制';const after=await snapshot();assert.deepEqual(after.panel.spec,expected);
 assert.deepEqual(after.panel.spec.assets,base.spec.assets);assert.deepEqual(after.panel.actions,base.actions);assert.deepEqual(after.panel.bindings,base.bindings);
 assert.deepEqual(after.panel.assetClosure,base.assetClosure);assert.deepEqual(after.panel.componentBundle.resources,base.componentBundle.resources);
 assert.deepEqual(await state(),base.state);await rounds(1);assert.equal(after.history.length,1);
 assert.equal(await page.locator('#edit-plan-error').innerText(),'');active=null;pass('only-a-new-manual-click-applies-one-authored-edit-and-one-round-after-failure');
 await menu();await page.locator('#undo').click();await idle();assert.deepEqual((await snapshot()).panel.spec,base.spec);assert.deepEqual(await state(),base.state);await rounds(1);
 pass('undo-restores-original-spec-without-refunding-successful-round');
 assert.deepEqual(await readFile(basePath),baseBytes);assert.equal(report.externalRequests,0);assert.equal(report.unexpectedRequests,0);assert.deepEqual(report.errors,[]);
 pass('no-model-unexpected-request-browser-error-or-original-artifact-change');report.status='PASS';
}catch(error){report.status='FAIL';report.failure={stage,code:error.code??error.name,message:String(error.message).slice(0,1500)};
 process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});
}finally{releaseStream?.();await browser?.close();if(proxy){proxy.closeAllConnections();await new Promise(done=>proxy.close(done));}
 await server?.close();await writeNewJson(output,'browser-report.json',report);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,fixturePosts:report.fixturePosts,fixtureEditorCalls:report.fixtureEditorCalls,modelCalls:0,failure:report.failure??null}));}
