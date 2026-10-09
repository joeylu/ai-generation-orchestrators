#!/usr/bin/env node
/** Authored editor responses over one imported bundle. Never starts a model process. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {harnessRoot,createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {checkPanelEditProposal} from '../src/edit-planning.mjs';
import {controlId} from '../src/compiler.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';

assert(process.argv.length===8&&process.argv[2]==='--workbench'&&process.argv[4]==='--base'&&process.argv[6]==='--output',
 'Required: --workbench <build> --base <saved bundle> --output <fresh directory>');
const workbench=resolve(process.argv[3]),basePath=resolve(process.argv[5]),output=await createOutputDirectory(process.argv[7]);
const report={continuousEditBrowserVersion:'0.2',status:'RUNNING',sourceKind:'EXISTING_REAL_BASE_WITH_AUTHORED_EDITOR_RESPONSES',
 modelCalls:0,fixtureEditorCalls:0,automaticRetries:0,unexpectedRequests:0,externalRequests:0,checks:[],errors:[],steps:[],
 humanVisualReview:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN'};
const pass=name=>report.checks.push({name,status:'PASS'});
const initial=(fieldId,value)=>({op:'set-state-initial',fieldId,value});
const request={multi:'标题改为“音频偏好”，音乐默认值改为30，其他保持不变。',
 ambiguous:'把音量改成40，其他不变。',answer:'主音量创作默认值改为40，当前试玩值保留，其他保持不变。',
 correction:'主音量默认值改为80，不对，主音量默认值改为45，以这次纠正为准。音乐默认值改为25，其他保持不变。',
 selected:'这个按钮文字改为“恢复声音”，其他不变。'};
let browser,server,page,active,model,stage='base-and-build';
try{
 const core=await loadWorkspaceCore(),baseBytes=await readFile(basePath),base=await validatePanelBundle(JSON.parse(baseBytes),core);
 assert.equal(base.sha256,'524f399fe237d043992e407cd5ec12174a082b8059b904a19a15c2c3e176569e');
 assert.deepEqual(base.state,{row0:35,row1:19,row2:true});assert.equal(base.assetClosure.records.length,3);
 report.base={path:relative(harnessRoot,basePath).replaceAll('\\','/'),fileSha256:await digestBytes(baseBytes),bundleSha256:base.sha256};
 const manifest=await readJson(resolve(workbench,'workbench-build.json'));
 for(const file of manifest.files)assert.equal(await digestBytes(await readFile(resolve(workbench,file.path))),file.sha256);
 report.build=manifest.studio;
 server=await createWorkbenchServer({workbench,outputRoot:resolve(output,'unused-model-output'),port:0,
  planner:async()=>{throw Error('MODEL_FORBIDDEN');},editor:async context=>{
   assert(active&&!active.consumed,'Only one deliberately armed fixture response');active.consumed=true;report.fixtureEditorCalls++;
   active.verify(context);assert.equal(context.editContextVersion,'0.14');
   const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,
    patch:active.question?null:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Authored continuity acceptance response; no model.',operations:active.operations},
    bases:active.question?null:active.operations.map(()=>({kind:'request-interpretation',quote:context.request.text})),
    unresolved:active.question?[{id:'q0',question:active.question}]:[],noChange:null};
   const proposal=await materializeCodexEditDraft(context,draft),checked=await checkPanelEditProposal(context,proposal);
   await writeNewJson(output,active.id+'-context.json',context);await writeNewJson(output,active.id+'-draft.json',draft);
   await writeNewJson(output,active.id+'-proposal.json',proposal);active.result={context,proposal,checked};
   return{proposal,report:checked,receipt:{codexEditingReceiptVersion:'0.1',status:checked.status,model:'gpt-6-luna',effort:'xhigh',
    contextSha256:context.sha256,proposalSha256:checked.proposalSha256,failureCode:null,invocationCount:1,automaticRetries:0,elapsedMs:0,usage:null}};
  }});
 const {chromium}=await loadWorkspaceTool('@playwright/test');
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
 const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});
 const origin=new URL(server.url).origin;
 await context.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  if(!['data:','blob:','file:'].includes(u.protocol)&&u.origin!==origin){report.externalRequests++;return route.abort();}
  if(r.method()!=='GET'&&!(r.method()==='POST'&&u.pathname==='/api/panel/edit'&&active&&!active.consumed)){
   report.unexpectedRequests++;return route.abort();
  }return route.continue();
 });
 const observe=p=>{p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(e.message));
  p.on('console',e=>{if(e.type()==='error')report.errors.push(e.text());});};
 page=await context.newPage();observe(page);
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const snap=()=>page.evaluate(()=>window.panelWorkbench.snapshot());
 const state=()=>page.evaluate(()=>window.panelWorkbench.getState());
 const rounds=async n=>assert.match(await page.locator('#edit-rounds').textContent(),new RegExp(n+' / 10'));
 const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
 const importFile=async path=>{await menu();await page.locator('#panel-file').setInputFiles(path);await idle();};
 const controls=()=>page.evaluate(()=>{const w=window.panelWorkbench,b=w.snapshot().panel;
  return w.inspect().nodes.filter(n=>b.spec.sections.flatMap(s=>s.rows).some(r=>n.id===`${b.spec.id}.row.${r.id}.control`)||n.id.endsWith('.icon'))
   .map(n=>({id:n.id,type:n.type,bounds:n.bounds,visible:n.visible}));});
 await page.goto(server.url);await idle();await importFile(basePath);await rounds(0);
 const original=await snap(),geometry=await controls();assert.equal(geometry.filter(n=>n.id.endsWith('.icon')&&n.visible).length,3);
 const expected=structuredClone(base.spec),versions=[original.panel];
 const preserved=async spec=>{
  const b=(await snap()).panel;assert.deepEqual(b.spec,spec);assert.deepEqual(await state(),base.state);
  for(const key of ['catalog','assetClosure','bindings','actions','compilerVersion','capabilities','selection'])assert.deepEqual(b[key],base[key],key);
  assert.deepEqual(b.componentBundle.resources,base.componentBundle.resources);assert.deepEqual(await controls(),geometry);
 };
 const edit=async({id,text,operations=[],verify,question,update,used,submit='#generate-edit'})=>{
  stage=id;const before=await snap(),values=await state(),calls=report.fixtureEditorCalls;
  active={id,operations,verify,question,consumed:false};
  if(text!==null)await page.locator('#edit-request-text').fill(text);
  const responseReady=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/panel/edit'&&r.request().method()==='POST');
  await page.locator(submit).click();const response=await responseReady;await response.finished();const body=await response.json();await idle();
  assert.equal(response.status(),200,body.code);assert.equal(report.fixtureEditorCalls,calls+1);assert(active.consumed);
  if(question){assert.equal(body.report.status,'NEEDS_INPUT');assert.deepEqual(await snap(),before);assert.deepEqual(await state(),values);}
  else{assert.equal(body.report.status,'READY_TO_APPLY');update(expected);await preserved(expected);
   assert.equal((await snap()).history.length,used);versions.push((await snap()).panel);}
  await rounds(used);report.steps.push({id,status:body.report.status,contextSha256:active.result.context.sha256,
   baseSpecSha256:active.result.context.baseSpecSha256,requestCheck:body.report.requestCheck?.status??null,semanticReview:body.report.requestCheck?.semanticReview??null,
   used,sourceKind:'AUTHORED_RESPONSE'});const result=active.result;active=null;return result;
 };
 const first=await edit({id:'step1-multiple',text:request.multi,operations:[{op:'set-panel-title',title:'音频偏好'},initial('row1',30)],
  verify:c=>{assert.deepEqual(c.spec,base.spec);assert.equal(c.request.text,request.multi);},
  update:s=>{s.title='音频偏好';s.state.find(f=>f.id==='row1').initial=30;},used:1});
 assert.equal(first.checked.requestCheck.status,'MATCHED');pass('first-multi-property-edit-preserves-live-state-three-icons-and-control-geometry');
 await edit({id:'step2-clarify',text:request.ambiguous,question:'请确认哪一个音量，以及40是创作默认值还是当前试玩值？',
  verify:c=>{assert.deepEqual(c.spec,expected);assert.equal(c.request.text,request.ambiguous);},used:1});
 pass('ambiguity-holds-entire-latest-panel-history-and-round');
 stage='answer-entry-does-not-submit';const calls=report.fixtureEditorCalls;
 await page.locator('#edit-questions textarea').fill(request.answer);
 assert.equal(report.fixtureEditorCalls,calls);
 await preserved(expected);await rounds(1);pass(stage);
 await edit({id:'step2-answer',text:null,submit:'#clarify-edit',operations:[initial('row0',40)],
  verify:c=>{assert.deepEqual(c.spec,expected);assert(c.request.text.includes(request.answer));assert(c.request.text.includes('补充回答'));},
  update:s=>{s.state.find(f=>f.id==='row0').initial=40;},used:2});
 pass('clarified-edit-uses-latest-spec-and-retains-first-successful-change');
 const correction=await edit({id:'step3-correction',text:request.correction,operations:[initial('row0',45),initial('row1',25)],
  verify:c=>{assert.deepEqual(c.spec,expected);assert.equal(c.request.text,request.correction);assert.equal(c.requestChecks.items.length,0);},
  update:s=>{s.state.find(f=>f.id==='row0').initial=45;s.state.find(f=>f.id==='row1').initial=25;},used:3});
 assert.notEqual(correction.checked.requestCheck.status,'MATCHED');
 pass('authored-correction-oracle-keeps-final-45-and25-without-claiming-automatic-semantic-review');
 stage='select-button-on-latest-version';await page.locator('#select-edit-target').click();
 await page.locator('.selection-target[data-row-id="row3"]').press('Enter');
 await edit({id:'step4-selected',text:request.selected,operations:[{op:'set-button-label',rowId:'row3',buttonLabel:'恢复声音'}],
  verify:c=>{assert.deepEqual(c.spec,expected);assert.equal(c.selection.rowId,'row3');},
  update:s=>{s.sections[0].rows.find(r=>r.id==='row3').buttonLabel='恢复声音';},used:4});
 assert(await page.locator('#edit-target').isHidden());pass('selected-rename-keeps-prior-defaults-reset-scope-and-clears-used-selection');
 stage='repeat-latest-copy-is-local';const final=await snap(),finalCalls=report.fixtureEditorCalls;
 await page.locator('#edit-request-text').fill('恢复声音按钮文字改为“恢复声音”，其他不变。');
 await page.locator('#generate-edit').click();await idle();
 assert((await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));
 assert.equal(report.fixtureEditorCalls,finalCalls);assert.deepEqual(await snap(),final);await rounds(4);pass(stage);
 await page.screenshot({path:resolve(output,'continuous-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:resolve(output,'continuous-narrow.png'),fullPage:true});await page.setViewportSize({width:1440,height:1080});

 stage='old-proposal-cannot-apply-to-later-spec';await menu();await page.locator('#advanced-tools').click();
 await page.locator('#edit-request-text').fill('标题改为“新标题”，其他不变。');await page.locator('#prepare-edit-context').click();await idle();
 await page.locator('#edit-proposal-file').setInputFiles(resolve(output,'step1-multiple-proposal.json'));await idle();
 assert((await page.locator('#edit-plan-error').innerText()).length>0);assert.deepEqual(await snap(),final);await preserved(expected);await rounds(4);pass(stage);
 await page.locator('#advanced-tools').click();
 stage='actual-final-download-preserves-every-committed-change';
 await menu();let ready=page.waitForEvent('download');await page.locator('#download-panel').click();
 const jsonPath=resolve(output,'final.panel.bundle.json');await(await ready).saveAs(jsonPath);await idle();
 const delivered=await validatePanelBundle(await readJson(jsonPath),core);assert.deepEqual(delivered.spec,expected);assert.deepEqual(delivered.state,base.state);
 ready=page.waitForEvent('download');await page.locator('#download-delivery').click();
 const zipPath=resolve(output,'final.panel-delivery.zip');await(await ready).saveAs(zipPath);await idle();
 const bytes=await readFile(zipPath),files=readStoredZip(bytes),delivery=JSON.parse(files.get('delivery-manifest.json').toString('utf8'));
 assert.equal(files.size,delivery.files.length+1);
 for(const file of delivery.files){assert.equal(files.get(file.path)?.length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
 assert.deepEqual(JSON.parse(files.get('pixi/panel.bundle.json').toString('utf8')),delivered);
 assert.deepEqual(JSON.parse(files.get('unity/panel.bundle.json').toString('utf8')),delivered);
 assert.equal(delivery.verification.unityImport,'NOT_RUN');
 report.download={sha256:await digestBytes(bytes),panelSha256:delivered.sha256,files:files.size};pass(stage);
 stage='four-undos-restore-each-preceding-spec-without-refunding-rounds';
 for(let i=3;i>=0;i--){await menu();await page.locator('#undo').click();await idle();
  assert.deepEqual((await snap()).panel.spec,versions[i].spec);assert.deepEqual(await state(),base.state);
  assert.equal((await snap()).history.length,i);await rounds(4);}
 assert.deepEqual((await snap()).panel,base);pass(stage);
 stage='reimport-and-refresh-retain-four-used-rounds-assets-and-played-values';
 await importFile(jsonPath);await rounds(4);assert.deepEqual((await snap()).panel,delivered);
 assert.deepEqual((await snap()).history,[]);await page.reload();await idle();await page.waitForFunction(()=>Boolean(window.panelWorkbench.snapshot().panel));
 await preserved(expected);await rounds(4);assert.deepEqual((await snap()).history,[]);pass(stage);
 stage='downloaded-zip-opens-offline-with-original-images-and-new-reset-defaults';
 const extracted=await createOutputDirectory(resolve(output,'extracted'));
 for(const [path,content]of files){const target=resolve(extracted,path),rel=relative(extracted,target);
  assert(rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel));await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});}
 const offline=await context.newPage();observe(offline);await offline.goto(pathToFileURL(resolve(extracted,'pixi/index.html')).href);
 await offline.waitForFunction(()=>window.panelDelivery&&document.getElementById('status').dataset.state==='ready');
 assert.deepEqual(await offline.evaluate(()=>window.panelDelivery.getState()),base.state);
 assert.equal(await offline.evaluate(()=>window.panelDelivery.inspect().nodes.filter(n=>n.id.endsWith('.icon')&&n.visible).length),3);
 const node=await offline.evaluate(id=>window.panelDelivery.inspect().nodes.find(n=>n.id===id),controlId(base.spec.id,'row3'));
 const canvas=offline.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 await offline.mouse.click(box.x+(node.bounds.x+node.bounds.width/2)*box.width/base.spec.canvas.width,
  box.y+(node.bounds.y+node.bounds.height/2)*box.height/base.spec.canvas.height);
 assert.deepEqual(await offline.evaluate(()=>window.panelDelivery.getState()),{row0:45,row1:25,row2:false});
 assert.equal(await offline.evaluate(()=>window.panelDelivery.events().at(-1).event.name),'panel.row3');
 await offline.screenshot({path:resolve(output,'offline.png'),fullPage:true});pass(stage);
 stage='library-free-reimport-and-no-extra-request-or-source-change';
 model=await createWorkbenchModel({catalog:base.catalog,pool:null},core);await model.importPanel(delivered);
 assert.deepEqual(await model.exportPanel(),delivered);
 assert.deepEqual(await readFile(basePath),baseBytes);assert.equal(report.fixtureEditorCalls,5);
 assert.equal(report.unexpectedRequests,0);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);pass(stage);
 report.successfulEdits=4;report.usedAfterUndoAndReload=4;report.status='PASS';
}catch(error){report.status='FAIL';report.failure={stage,code:error.code??error.name,message:String(error.message).slice(0,1500)};
 process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});
}finally{model?.dispose();await browser?.close();await server?.close();await writeNewJson(output,'browser-report.json',report);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,fixtureEditorCalls:report.fixtureEditorCalls,modelCalls:0,failure:report.failure??null}));}
