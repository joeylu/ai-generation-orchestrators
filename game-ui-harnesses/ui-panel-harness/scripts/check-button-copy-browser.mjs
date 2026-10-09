#!/usr/bin/env node
/** Real Studio/Pixi controls with explicitly authored editor substitutes. No model process. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {checkPanelEditProposal} from '../src/edit-planning.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {menuFixture} from '../examples/menu-defaults-v1/fixture.mjs';
import {scopedCopyFixture} from '../examples/scoped-button-copy-v1/fixture.mjs';
import {coverageIntent,INPUT_COVERAGE_V2} from '../examples/input-coverage-v2/suite.mjs';
import {controlId} from '../src/compiler.mjs';
import {digestBytes} from '../src/canonical.mjs';

assert(process.argv.length===6&&process.argv[2]==='--workbench'&&process.argv[4]==='--output',
 'Required: --workbench <build> --output <fresh directory>');
const workbench=resolve(process.argv[3]),output=await createOutputDirectory(process.argv[5]);
const report={buttonCopyBrowserVersion:'0.3',status:'RUNNING',sourceKind:'PROGRAMMATIC_FIXTURE',modelCalls:0,
 fixtureEditorCalls:0,automaticRetries:0,externalRequests:0,blockedRequests:0,checks:[],errors:[],
 nativeUnity:'NOT_RUN',humanVisualReview:'NOT_RUN'};
const pass=name=>report.checks.push({name,status:'PASS'});
const rename=(buttonLabel,rowId='row0')=>({op:'set-button-label',rowId,buttonLabel});
let browser,server,page,active,expectedError=false,stage='setup';
try{
 const core=await loadWorkspaceCore(),catalog=await readJson(resolve(harnessRoot,'examples/modern-menu.catalog.json'));
 const manifest=await readJson(resolve(workbench,'workbench-build.json'));
 for(const file of manifest.files)assert.equal(await digestBytes(await readFile(resolve(workbench,file.path))),file.sha256);
 report.buildSha256=manifest.studio.buildSha256;
 const menu=await createPanelBundle((await menuFixture(catalog)).spec,catalog,core);
 const item=INPUT_COVERAGE_V2.cases.find(c=>c.id==='G02');
 const pc=await createPlanningContext({requestVersion:'0.1',id:'audio-copy-browser',target:'pixi',text:item.text},catalog,undefined,{actionLayouts:true,textWrap:true});
 const audio=await createPanelBundle((await materializePanelIntent(pc,coverageIntent(pc,item))).spec,catalog,core,{row0:35,row1:true});
 const scoped=await createPanelBundle((await scopedCopyFixture(catalog)).spec,catalog,core,{row0:35,row2:81});
 await writeNewJson(output,'menu.panel.bundle.json',menu);await writeNewJson(output,'audio.panel.bundle.json',audio);
 await writeNewJson(output,'scoped.panel.bundle.json',scoped);
 server=await createWorkbenchServer({workbench,outputRoot:resolve(output,'fixture-runs'),port:0,
  planner:async()=>{throw Error('UNEXPECTED_PLANNER_CALL');},editor:async context=>{
   assert(active&&!active.consumed,'Only one explicitly armed fixture response');active.consumed=true;report.fixtureEditorCalls++;
   assert.equal(context.request.text,active.text);assert(['0.13','0.14'].includes(context.editContextVersion));
   assert.equal(context.requestChecks.policy,context.editContextVersion==='0.14'?'explicit-properties-v4':'explicit-properties-v3');
   const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,
    patch:active.questions?null:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Authored browser copy fixture.',operations:active.operations},
    bases:active.questions?null:active.operations.map(()=>({kind:'request-interpretation',quote:context.request.text})),unresolved:active.questions??[],noChange:null};
   await writeNewJson(output,active.id+'-context.json',context);
   await writeNewJson(output,active.id+'-draft.json',draft);
   const proposal=await materializeCodexEditDraft(context,draft),checked=await checkPanelEditProposal(context,proposal);
   return{proposal,report:checked,receipt:{codexEditingReceiptVersion:'0.1',status:checked.status,
    model:'gpt-6-luna',effort:'xhigh',contextSha256:context.sha256,proposalSha256:checked.proposalSha256,
    failureCode:null,invocationCount:1,automaticRetries:0,elapsedMs:0,usage:null}};
  }});
 const {chromium}=await loadWorkspaceTool('@playwright/test');
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
 const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});
 const origin=new URL(server.url).origin;
 await context.route('**/*',route=>{
  const r=route.request(),u=new URL(r.url());
  if(!['data:','blob:'].includes(u.protocol)&&u.origin!==origin){report.externalRequests++;return route.abort();}
  if(r.method()!=='GET'&&!(r.method()==='POST'&&u.pathname==='/api/panel/edit'&&active&&!active.consumed)){
   report.blockedRequests++;return route.abort();
  }
  return route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',entry=>{if(entry.type()==='error'&&!(expectedError&&/Failed to load resource/.test(entry.text())))report.errors.push(entry.text());});
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const snapshot=()=>page.evaluate(()=>window.panelWorkbench.snapshot());
 const state=()=>page.evaluate(()=>window.panelWorkbench.getState());
 const events=()=>page.evaluate(()=>window.panelWorkbench.events());
 const openMenu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
 const load=async name=>{await openMenu();await page.locator('#panel-file').setInputFiles(resolve(output,name+'.panel.bundle.json'));await idle();};
 const rounds=async used=>assert.match(await page.locator('#edit-rounds').textContent(),new RegExp(used+' / 10'));
 const edit=async(id,text,operations,rejected=false,questions=null)=>{
  stage=id;active={id,text,operations,questions,consumed:false};expectedError=rejected;
  const before=await snapshot(),beforeState=await state(),beforeEvents=await events(),calls=report.fixtureEditorCalls;
  await page.locator('#edit-request-text').fill(text);
  const waiting=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/panel/edit'&&r.request().method()==='POST');
  await page.locator('#generate-edit').click();const response=await waiting;await response.finished();const body=await response.json();await idle();
  await writeNewJson(output,id+'-response.json',{httpStatus:response.status(),body});
  assert.equal(report.fixtureEditorCalls,calls+1);assert(active.consumed);
  if(rejected||questions){
   if(questions){assert.equal(response.status(),200);assert.equal(body.report.status,'NEEDS_INPUT');
    assert((await page.locator('#edit-questions').textContent()).includes(questions[0].question));}
   else if(rejected===true){assert(!response.ok());assert.equal(body.code,'EDIT_REQUEST_INCOMPLETE');}
   else{assert.equal(response.status(),200);assert.equal(body.report.requestCheck.status,'MATCHED');
    assert((await page.locator('#edit-plan-error').textContent()).includes(rejected));}
   const after=await snapshot();assert.deepEqual(after.panel,before.panel);assert.deepEqual(after.history,before.history);
   assert.deepEqual(await state(),beforeState);assert.deepEqual(await events(),beforeEvents);
   assert.equal((await page.locator('#edit-plan-error').textContent()).length>0,!questions);
  }else{
   assert.equal(response.status(),200,body.code);assert.equal(body.report.requestCheck.status,'MATCHED');
   assert.equal(body.report.requestCheck.preserveRest.status,'MATCHED');
   const expected=structuredClone(before.panel.spec);
   for(const op of operations){
    if(op.op==='set-panel-title')expected.title=op.title;
    else expected.sections.flatMap(s=>s.rows).find(r=>r.id===op.rowId).buttonLabel=op.buttonLabel;
   }
   assert.deepEqual((await snapshot()).panel.spec,expected);assert.deepEqual(await state(),beforeState);
  }
  expectedError=false;active=null;
 };
 const undo=async()=>{await openMenu();await page.locator('#undo').click();await idle();};
 const click=async rowId=>{
  const spec=(await snapshot()).panel.spec,node=(await page.evaluate(()=>window.panelWorkbench.inspect())).nodes.find(n=>n.id===controlId(spec.id,rowId));
  assert(node?.visible);const canvas=page.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  await page.mouse.click(box.x+(node.bounds.x+node.bounds.width/2)*box.width/spec.canvas.width,
   box.y+(node.bounds.y+node.bounds.height/2)*box.height/spec.canvas.height);
 };
 await page.goto(server.url);await idle();await load('menu');assert.deepEqual((await snapshot()).panel,menu);await rounds(0);
 stage='local-already-satisfied';
 const localSame='继续游戏按钮文字改为“继续游戏”，其他不变。',localBefore=await snapshot(),localEvents=await events();
 await page.locator('#edit-request-text').fill(localSame);await page.locator('#generate-edit').click();await idle();
 assert((await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));
 assert.equal(report.fixtureEditorCalls,0);assert.deepEqual(await snapshot(),localBefore);assert.deepEqual(await events(),localEvents);await rounds(0);
 const localEdit=await page.evaluate(()=>window.panelWorkbench.editSnapshot());assert.equal(localEdit.report,null);assert.equal(localEdit.proposal,null);
 await page.locator('#generate-edit').click();await idle();assert.equal(report.fixtureEditorCalls,0);assert.deepEqual(await snapshot(),localBefore);await rounds(0);
 await page.screenshot({path:resolve(output,'local-satisfied-desktop.png'),fullPage:true});
 pass('already-satisfied-and-repeated-submit-make-no-editor-request-proposal-history-or-round');
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert((await page.locator('#edit-plan-status').innerText()).includes('未调用模型'));await page.screenshot({path:resolve(output,'local-satisfied-narrow.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1080});pass('local-already-satisfied-feedback-fits-390px');
 await page.locator('#edit-request-text').fill('继续游戏按钮文字改为“返回游戏”，其他不变。');
 assert(!(await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));pass('changing-request-clears-stale-local-satisfied-feedback');
 await edit('local-satisfied-mixed','继续游戏按钮文字改为“继续游戏”，同时将图标旋转，其他不变。',[],false,
  [{id:'q0',question:'当前不支持图标旋转，是否保留现有图标？'}]);await rounds(0);
 pass('partly-satisfied-mixed-request-still-reaches-authored-editor-clarification');
 await edit('shortened-copy','继续游戏按钮文字改为“返回游戏”，其他不变。',[rename('返回')],true);await rounds(0);pass('shortened-copy-rejected-without-round-or-state-change');
 await edit('missing-second','继续游戏按钮文字改为“返回游戏”，设置按钮文字改为“偏好设置”，其他不变。',[rename('返回游戏')],true);await rounds(0);pass('missing-second-copy-rejected-atomically');
 await edit('extra-style','继续游戏按钮文字改为“返回游戏”，其他不变。',[rename('返回游戏'),{op:'set-button-font-size',rowId:'row0',fontSize:20}],true);await rounds(0);pass('unrequested-style-rejected-atomically');
 await edit('edge-space-rejected','继续游戏按钮文字改为“ 返回，Back 🎵 ”，其他不变。',[rename(' 返回，Back 🎵 ')],'STRING_REQUIRED');
 await rounds(0);pass('component-rejects-edge-space-without-trimming-or-changing-panel');
 const exact='返回，Back 🎵';
 await edit('exact-copy','继续游戏按钮文字改为“'+exact+'”，其他不变。',[rename(exact)]);await rounds(1);
 assert.equal((await snapshot()).panel.spec.sections[0].rows[0].buttonLabel,exact);
 assert((await page.evaluate(()=>window.panelWorkbench.inspect())).nodes.flatMap(n=>n.renderedTextBounds??[]).some(t=>t.text===exact));
 await click('row0');assert.equal((await events()).at(-1).name,menu.spec.sections[0].rows[0].event);pass('exact-unicode-copy-renders-and-keeps-original-button-event');
 await openMenu();const download=page.waitForEvent('download');await page.locator('#download-panel').click();
 await(await download).saveAs(resolve(output,'renamed.panel.bundle.json'));await idle();
 const delivered=await validatePanelBundle(await readJson(resolve(output,'renamed.panel.bundle.json')),core);
 assert.deepEqual(delivered,(await snapshot()).panel);pass('actual-json-download-strictly-recompiles');
 await undo();assert.deepEqual((await snapshot()).panel,menu);await rounds(1);pass('undo-restores-original-copy-without-refunding-round');
 await load('renamed');assert.deepEqual((await snapshot()).panel,delivered);await click('row0');
 assert.equal((await events()).at(-1).name,menu.spec.sections[0].rows[0].event);pass('downloaded-copy-reimports-and-keeps-event');
 await load('audio');await rounds(0);
 await edit('changed-reset-scope','恢复默认按钮文字改为“恢复声音”，其他不变。',[
  rename('恢复声音','row2'),{op:'set-button-action',rowId:'row2',action:{kind:'reset-initial',fields:['row0']}}],true);
 await rounds(0);assert.deepEqual(await state(),audio.state);pass('reset-scope-change-rejected-with-played-values-preserved');
 await page.locator('#select-edit-target').click();await page.locator('.selection-target[data-row-id="row2"]').press('Enter');
 await edit('selected-copy','这个按钮文字改为“恢复声音”，其他不变。',[rename('恢复声音','row2')]);await rounds(1);
 const renamed=(await snapshot()).panel;assert.deepEqual(renamed.actions,audio.actions);assert.deepEqual(renamed.bindings,audio.bindings);
 assert.deepEqual(await state(),audio.state);assert(await page.locator('#clear-edit-target').isHidden());await click('row2');
 assert.deepEqual(await state(),{row0:70,row1:false});pass('selected-pronoun-renames-one-button-and-reset-still-resets-both-fields');
 await page.screenshot({path:resolve(output,'audio-renamed.png'),fullPage:true});
 await load('scoped');assert.deepEqual((await snapshot()).panel,scoped);await rounds(0);
 const localCalls=report.fixtureEditorCalls,scopedBefore=await snapshot();
 await page.locator('#edit-request-text').fill('主音量默认值改为70，亮度默认值改为40，其他不变。');
 await page.locator('#generate-edit').click();await idle();assert((await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));
 assert.equal(report.fixtureEditorCalls,localCalls);assert.deepEqual(await snapshot(),scopedBefore);assert.deepEqual(await state(),{row0:35,row2:81});await rounds(0);
 pass('already-satisfied-defaults-keep-different-played-values-without-resetting-them');
 await page.locator('#select-edit-target').click();await page.locator('.selection-target[data-row-id="row3"]').press('Enter');
 await page.locator('#edit-request-text').fill('这个按钮文字改为“恢复默认”，其他不变。');await page.locator('#generate-edit').click();await idle();
 assert((await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));assert(await page.locator('#edit-target').isVisible());
 assert((await page.locator('#edit-target-name').innerText()).includes('显示 · 恢复默认'));assert.equal(report.fixtureEditorCalls,localCalls);assert.deepEqual(await state(),scoped.state);await rounds(0);
 await page.locator('#clear-edit-target').click();assert(!(await page.locator('#edit-plan-status').innerText()).includes('明确要求已满足'));
 pass('selected-already-satisfied-copy-keeps-selection-and-clears-feedback-on-cancel');
 const qualified='声音分组里的恢复默认按钮文字改为“恢复声音”，其他不变。';
 const ambiguous='恢复默认按钮文字改为“恢复声音”，其他不变。',callsBeforeChoice=report.fixtureEditorCalls;
 await page.locator('#edit-request-text').fill(ambiguous);await page.locator('#generate-edit').click();await idle();
 assert(await page.locator('#edit-target-choices').isVisible());
 assert.deepEqual(await page.locator('#edit-target-options button').allTextContents(),['声音 · 恢复默认','显示 · 恢复默认']);
 assert.equal(report.fixtureEditorCalls,callsBeforeChoice);assert.deepEqual((await snapshot()).panel,scoped);assert.deepEqual(await state(),scoped.state);await rounds(0);
 pass('local-duplicate-target-choice-keeps-panel-state-rounds-and-makes-no-editor-request');
 await page.screenshot({path:resolve(output,'local-choices-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await page.locator('#edit-target-options button[data-row-id="row3"]').isVisible());
 await page.screenshot({path:resolve(output,'local-choices-narrow.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1080});pass('local-choice-options-fit-390px-without-horizontal-overflow');
 await page.locator('#edit-target-options button[data-row-id="row3"]').press('Enter');
 assert(await page.locator('#edit-target-choices').isHidden());assert((await page.locator('#edit-target-name').innerText()).includes('显示 · 恢复默认'));
 assert.equal(await page.locator('#edit-request-text').inputValue(),ambiguous);assert.equal(report.fixtureEditorCalls,callsBeforeChoice);await rounds(0);
 pass('keyboard-local-choice-only-selects-displayed-group-without-dispatching-or-editing-text');
 await page.locator('#clear-edit-target').click();await page.locator('#generate-edit').click();await idle();assert(await page.locator('#edit-target-choices').isVisible());
 await page.evaluate(()=>{window.staleTargetChoice=document.querySelector('#edit-target-options button');});
 await page.locator('#edit-request-text').fill(qualified);assert(await page.locator('#edit-target-choices').isHidden());
 await page.evaluate(()=>window.staleTargetChoice.click());assert(await page.locator('#edit-target').isHidden());
 pass('changed-description-clears-choice-and-detached-old-choice-cannot-select');
 await page.locator('#edit-request-text').fill(ambiguous);await page.locator('#generate-edit').click();await idle();
 await page.evaluate(()=>{window.staleTargetChoice=document.querySelector('#edit-target-options button');});
 await load('menu');await page.evaluate(()=>window.staleTargetChoice.click());assert(await page.locator('#edit-target').isHidden());
 assert(await page.locator('#edit-target-choices').isHidden());assert.deepEqual((await snapshot()).panel,menu);await load('scoped');await rounds(0);
 pass('importing-another-panel-clears-local-choice-and-invalidates-detached-old-choice');
 await edit('scoped-wrong-row',qualified,[rename('恢复声音','row3')],true);await rounds(0);pass('qualified-copy-rejects-the-other-group');
 await edit('scoped-changed-reset',qualified,[rename('恢复声音','row1'),
  {op:'set-button-action',rowId:'row1',action:{kind:'reset-initial',fields:['row0','row2']}}],true);
 await rounds(0);pass('qualified-copy-rejects-cross-group-reset-scope-change');
 await page.locator('#edit-request-text').fill('恢复默认按钮文字改为“恢复显示”，其他不变。');await page.locator('#generate-edit').click();await idle();
 await page.locator('#edit-target-options button[data-row-id="row3"]').click();
 await edit('scoped-selected-name','恢复默认按钮文字改为“恢复显示”，其他不变。',[rename('恢复显示','row3')]);
 await rounds(1);assert.equal((await snapshot()).panel.spec.sections[0].rows[1].buttonLabel,'恢复默认');
 await click('row3');assert.deepEqual(await state(),{row0:35,row2:40});
 assert.equal((await events()).at(-1).name,scoped.spec.sections[1].rows[1].event);pass('selected-literal-duplicate-renames-and-resets-display-only');
 await undo();assert.deepEqual((await snapshot()).panel.spec,scoped.spec);await rounds(1);pass('scoped-undo-restores-both-names-without-refunding-round');
 const previousState=await state();await edit('scoped-qualified-name',qualified,[rename('恢复声音','row1')]);await rounds(2);
 assert.deepEqual(await state(),previousState);assert.equal((await snapshot()).panel.spec.sections[1].rows[1].buttonLabel,'恢复默认');
 await click('row1');assert.deepEqual(await state(),{...previousState,row0:70});
 assert.equal((await events()).at(-1).name,scoped.spec.sections[0].rows[1].event);pass('qualified-copy-keeps-other-label-and-resets-sound-only');
 await openMenu();const scopedDownload=page.waitForEvent('download');await page.locator('#download-panel').click();
 await(await scopedDownload).saveAs(resolve(output,'scoped-renamed.panel.bundle.json'));await idle();
 const scopedDelivered=await validatePanelBundle(await readJson(resolve(output,'scoped-renamed.panel.bundle.json')),core);
 assert.deepEqual(scopedDelivered.spec,(await snapshot()).panel.spec);assert.deepEqual(scopedDelivered.state,await state());
 await load('scoped-renamed');assert.deepEqual((await snapshot()).panel,scopedDelivered);await rounds(2);
 pass('scoped-actual-json-download-recompile-and-reimport-keep-state-and-used-rounds');
 await load('scoped');await rounds(2);
 await edit('scoped-missing-second','声音分组里的恢复默认按钮文字改为“恢复声音”，显示分组里的恢复默认按钮文字改为“恢复显示”，其他不变。',
  [rename('恢复声音','row1')],true);await rounds(2);pass('two-qualified-copies-reject-a-partial-result-without-changing-rounds');
 await page.screenshot({path:resolve(output,'scoped-after-tests.png'),fullPage:true});
 await page.locator('#select-edit-target').click();await page.locator('.selection-target[data-row-id="row1"]').press('Enter');
 const scopeBefore=await snapshot(),scopeState=await state(),scopeEvents=await events(),scopeCalls=report.fixtureEditorCalls;
 const scopeMixed='声音分组里的恢复默认按钮文字改为“仅恢复声音”，标题改为“音频偏好”，其他不变。';
 const holdScope=async(id,text)=>{
  stage=id;await page.locator('#edit-request-text').fill(text);await page.locator('#generate-edit').click();await idle();
  assert((await page.locator('#edit-plan-status').innerText()).includes('超出范围'));
  assert((await page.locator('#edit-plan-status').innerText()).includes('本次未调用模型'));
  assert.equal(report.fixtureEditorCalls,scopeCalls);assert.deepEqual(await snapshot(),scopeBefore);
  assert.deepEqual(await state(),scopeState);assert.deepEqual(await events(),scopeEvents);await rounds(2);
  assert.equal(await page.locator('#edit-request-text').inputValue(),text);
  assert((await page.locator('#edit-target-name').innerText()).includes('声音 · 恢复默认'));
  const prepared=await page.evaluate(()=>window.panelWorkbench.editSnapshot());
  assert.equal(prepared.context.request.text,text);assert.deepEqual(prepared.context.selection,{rowId:'row1'});
  assert.equal(prepared.report,null);assert.equal(prepared.proposal,null);pass(id);
 };
 await holdScope('selected-copy-and-title-held-before-partial-edit',scopeMixed);
 await page.locator('#generate-edit').click();await idle();assert.equal(report.fixtureEditorCalls,scopeCalls);
 assert.deepEqual(await snapshot(),scopeBefore);await rounds(2);pass('repeated-scope-conflict-submit-still-makes-no-editor-request');
 await page.screenshot({path:resolve(output,'selected-scope-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await page.locator('#clear-edit-target').isVisible());
 assert((await page.locator('#edit-plan-status').innerText()).includes('取消选择'));
 await page.screenshot({path:resolve(output,'selected-scope-narrow.png'),fullPage:true});await page.setViewportSize({width:1440,height:1080});
 pass('scope-conflict-feedback-and-cancel-selection-fit-390px');
 await holdScope('selected-copy-and-global-width-held','这个按钮文字改为“声音”，面板宽度改为480，其他不变。');
 await holdScope('selected-button-and-another-control-default-held','亮度默认值改为25，其他不变。');
 await holdScope('selected-one-of-two-qualified-renames-held','声音分组里的恢复默认按钮文字改为“声音”，显示分组里的恢复默认按钮文字改为“显示”，其他不变。');
 await holdScope('explicit-scope-conflict-alongside-unknown-prose-held','这个按钮文字改为“声音”，标题改为“设置”，顺便更好看。');
 await page.locator('#edit-request-text').fill('这个按钮文字改为“恢复声音”，其他不变。');
 assert(!(await page.locator('#edit-plan-status').innerText()).includes('超出范围'));assert.equal(report.fixtureEditorCalls,scopeCalls);
 pass('changing-scope-conflicting-description-clears-feedback-without-auto-submit');
 await edit('selected-valid-after-scope-hold','这个按钮文字改为“恢复声音”，其他不变。',[rename('恢复声音','row1')]);await rounds(3);
 assert.deepEqual((await snapshot()).panel.actions,scoped.actions);assert.deepEqual((await snapshot()).panel.bindings,scoped.bindings);
 pass('selected-only-correction-applies-once-with-original-actions-and-bindings');
 await undo();assert.deepEqual((await snapshot()).panel.spec,scoped.spec);await rounds(3);
 await page.locator('#select-edit-target').click();await page.locator('.selection-target[data-row-id="row1"]').press('Enter');
 await page.locator('#edit-request-text').fill(scopeMixed);await page.locator('#generate-edit').click();await idle();
 assert((await page.locator('#edit-plan-status').innerText()).includes('超出范围'));
 const beforeCancel=await snapshot(),beforeCancelCalls=report.fixtureEditorCalls;
 await page.locator('#clear-edit-target').click();assert(!(await page.locator('#edit-plan-status').innerText()).includes('超出范围'));
 assert(await page.locator('#edit-target').isHidden());assert.equal(await page.locator('#edit-request-text').inputValue(),scopeMixed);
 assert.deepEqual(await snapshot(),beforeCancel);assert.equal(report.fixtureEditorCalls,beforeCancelCalls);await rounds(3);
 pass('cancel-selection-clears-scope-notice-but-preserves-original-request-without-dispatch');
 await edit('unselected-full-request-after-cancel',scopeMixed,[rename('仅恢复声音','row1'),{op:'set-panel-title',title:'音频偏好'}]);await rounds(4);
 assert.deepEqual((await snapshot()).panel.actions,scoped.actions);assert.deepEqual((await snapshot()).panel.bindings,scoped.bindings);
 pass('same-complete-request-after-cancel-applies-title-and-copy-together-once');
 await undo();assert.deepEqual((await snapshot()).panel.spec,scoped.spec);await rounds(4);assert.deepEqual(await state(),scopeState);
 pass('undo-after-complete-scope-edit-restores-spec-and-played-values-without-refund');
 assert.equal(report.fixtureEditorCalls,15);assert.equal(report.blockedRequests,0);assert.equal(report.externalRequests,0);assert.deepEqual(report.errors,[]);
 pass('no-unexpected-request-browser-error-or-model-call');report.status='PASS';
}catch(error){report.status='FAIL';report.failure={stage,code:error.code??error.name,message:String(error.message).slice(0,1500)};
 process.exitCode=1;await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});
}finally{await browser?.close();await server?.close();await writeNewJson(output,'browser-report.json',report);
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,fixtureEditorCalls:report.fixtureEditorCalls,modelCalls:0,failure:report.failure??null}));}
