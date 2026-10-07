#!/usr/bin/env node
/** Background Studio acceptance. Models run only with an explicit --real switch, once per scenario, never retried. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { progressRequest, progressIntent } from '../examples/progress-v1/fixture.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { controlId } from '../src/compiler.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';
const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i++) { if(args[i]==='--real')options.real=true; else {assert(['--workbench','--output','--combined','--replay'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[++i];} }
assert(options['--workbench']&&options['--output']);
const output=await createOutputDirectory(options['--output']), core=await loadWorkspaceCore();
const report={version:'0.1',status:'RUNNING',mode:options.real?'real':'fixture',checks:[],cases:[],modelRequests:0,fixtureCalls:0,automaticRetries:0,
  browserPlugin:'NOT_AVAILABLE',humanVisualReview:'NOT_RUN',nativeEngines:'NOT_RUN',consoleErrors:[],pageErrors:[],requestFailures:[],screenshots:[]};
const pass=name=>report.checks.push({name,status:'PASS'});
const rows=spec=>spec.sections.flatMap(section=>section.rows);
const editText='把加载进度的标签改为“下载进度”，创作初始值改为0.1；在已下载之后、声音之前增加阶段进度条，范围0～10，初始2.5，显示实际数值保留一位小数；重新开始按钮仅重置下载进度和阶段进度。保留当前试玩进度、其它默认值、原有ID和布局。';
function receipt(context,checked,editing=false) {return {[editing?'codexEditingReceiptVersion':'codexPlanningReceiptVersion']:'0.1',model:'gpt-6-luna',effort:'xhigh',status:checked.status,
  contextSha256:context.sha256,proposalSha256:checked.proposalSha256,failureCode:null,invocationCount:1,automaticRetries:0,elapsedMs:0,usage:null};}
async function planner(context) {
  report.fixtureCalls++;let intent=progressIntent(context);
  if(context.request.text==='生成一个加载条') {const row=intent.panel.body.children[0].rows[0];Object.assign(row,{max:100,initial:0,display:'percent',fractionDigits:0});intent.panel.body.children[0].rows=[row];}
  const proposal=await materializePanelIntent(context,intent), checked=await checkPanelProposal(context,proposal);
  return {proposal,report:checked,receipt:receipt(context,checked)};
}
async function editor(context) {
  report.fixtureCalls++;assert.equal(context.request.text,editText);
  const list=rows(context.spec), progress=list.find(row=>row.label==='加载进度'), downloaded=list.find(row=>row.label==='已下载'), reset=list.find(row=>row.kind==='button');
  const operations=[{op:'set-row-label',rowId:progress.id,label:'下载进度'},{op:'set-state-initial',fieldId:progress.bind,value:0.1},
    {op:'add-row',sectionId:context.spec.sections.find(section=>section.rows.some(row=>row.id===downloaded.id)).id,afterRowId:downloaded.id,
      row:{id:'phase',kind:'progress',label:'阶段进度',recipe:progress.recipe,bind:'phase',format:{mode:'value',fractionDigits:1}},state:{id:'phase',type:'progress',max:10,initial:2.5}},
    {op:'set-button-action',rowId:reset.id,action:{kind:'reset-initial',fields:[progress.bind,'phase']}}];
  const proposal={editProposalVersion:'0.1',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Explicit fixture rehearsal, no provider call.',operations},
    decisions:operations.map((_,operationIndex)=>({operationIndex,basis:{kind:'request-interpretation',quote:editText,start:0,end:editText.length}})),unresolved:[]};
  const checked=await checkPanelEditProposal(context,proposal);return {proposal,report:checked,receipt:receipt(context,checked,true)};
}
let server,browser,context,page,stage='initialize';
try {
  server=await createWorkbenchServer({workbench:resolve(options['--workbench']),outputRoot:resolve(output,'codex-calls'),port:0,...(options.real?{}:{planner,editor})});
  browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
  report.browser={channel:'msedge',version:browser.version()};
  context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('pageerror',e=>report.pageErrors.push(e.message));
  page.on('requestfailed',r=>report.requestFailures.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}));
  page.on('request',r=>{if(options.real&&r.method()==='POST'&&/\/api\/panel\/(plan|edit)$/.test(new URL(r.url()).pathname))report.modelRequests++;});
  const idle=()=>page.waitForFunction(()=>window.panelWorkbench&&!window.panelWorkbench.busy);
  const state=()=>page.evaluate(()=>window.panelWorkbench.getState());
  const snapshot=()=>page.evaluate(()=>window.panelWorkbench.snapshot());
  const inspect=()=>page.evaluate(()=>window.panelWorkbench.inspect());
  const shot=async name=>{await page.screenshot({path:resolve(output,name),fullPage:true});report.screenshots.push(name);};
  const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
  const focus=async(spec,row)=>{const canvas=page.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();await canvas.focus();
    for(let i=0;i<rows(spec).length+5;i++){if(await canvas.getAttribute('data-focused-component')===controlId(spec.id,row.id))return;await page.keyboard.press('Tab');}throw new Error('FOCUS_UNREACHABLE');};
  for(const [index,text] of ['生成一个加载条',progressRequest.text].entries()) {
    stage=`generate-${index}`;await page.goto(server.url);await idle();
    await page.waitForFunction(()=>document.getElementById('model-status').textContent.includes('本地 Codex CLI'));
    await page.locator('#request-text').fill(text);
    const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/panel/plan',{timeout:900000});
    await page.locator('#generate-plan').click(); const response=await responsePromise,result=await response.json();
    await writeNewJson(output,`generation-${index}-response.json`,result); assert(response.ok(),JSON.stringify(result));await idle();
    const panel=(await snapshot()).panel;assert(panel,'generation must publish an actual panel');await validatePanelBundle(panel,core);
    const list=rows(panel.spec), bars=list.filter(row=>row.kind==='progress');assert.equal(bars.length,index===0?1:2);assert.equal(panel.spec.panelSpecVersion,'0.5');
    report.cases.push({request:text,status:'PASS',panelSha256:panel.sha256,contextSha256:result.receipt.contextSha256});
    const bar=bars[0], field=panel.spec.state.find(f=>f.id===bar.bind);assert.equal(field.max,index===0?100:1);assert.equal(field.initial,index===0?0:0.2);
    assert.equal(bar.format.mode,'percent');assert.equal(bar.format.fractionDigits,index===0?0:1);pass(stage);await shot(`generated-${index}.png`);
    stage=`host-progress-${index}`;const hostValue=index===0?37.6123456789:0.376123456789;
    await page.evaluate(({field,value})=>window.panelHost.setProgress(field,value),{field:bar.bind,value:hostValue});assert.equal((await state())[bar.bind],hostValue);
    let inspected=await inspect(),node=inspected.nodes.find(n=>n.id===controlId(panel.spec.id,bar.id));assert.equal(node.type,'ProgressBar');assert(node.visible);assert.equal(node.enabled,null);
    assert(inspected.nodes.flatMap(n=>n.renderedTextBounds??[]).some(t=>t.text===(index===0?'38%':'37.6%')));assert(!(await page.evaluate(()=>window.panelWorkbench.events())).length);
    const values=await state();const rejects=await page.evaluate(field=>{const output=[];for(const value of [-1,Infinity,'20']){try{window.panelHost.setProgress(field,value);output.push(false);}catch{output.push(true);}}return output;},bar.bind);
    assert(rejects.every(Boolean));assert.deepEqual(await state(),values);pass(stage);
    stage=`readonly-input-${index}`;const canvas=page.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
    const x=box.x+(node.bounds.x+node.bounds.width/2)*box.width/panel.spec.canvas.width,y=box.y+(node.bounds.y+node.bounds.height/2)*box.height/panel.spec.canvas.height;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+35,y);await page.mouse.up();assert.deepEqual(await state(),values);
    await canvas.focus();for(let i=0;i<list.length+3;i++){await page.keyboard.press('Tab');assert.notEqual(await canvas.getAttribute('data-focused-component'),node.id);}
    assert.deepEqual(await state(),values);pass(stage);
    if(index===0) {await shot('single-progress-updated.png');continue;}
    stage='edit-progress';await page.locator('#edit-request-text').fill(editText);
    const editResponsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/panel/edit',{timeout:900000});
    await page.locator('#generate-edit').click();const editResponse=await editResponsePromise,editResult=await editResponse.json();await writeNewJson(output,'edit-response.json',editResult);
    assert(editResponse.ok(),JSON.stringify(editResult));await idle();const edited=(await snapshot()).panel;await validatePanelBundle(edited,core);
    assert.equal(edited.spec.id,panel.spec.id);assert.equal(rows(edited.spec)[0].id,bar.id);assert.equal(rows(edited.spec)[0].label,'下载进度');
    assert.equal(edited.spec.state.find(f=>f.id===bar.bind).initial,0.1);assert.equal((await state())[bar.bind],hostValue);
    const phase=rows(edited.spec).find(row=>row.label==='阶段进度');assert(phase&&phase.kind==='progress');assert.equal((await state())[phase.bind],2.5);
    assert.deepEqual(rows(edited.spec).map(row=>row.kind==='button'?row.buttonLabel:row.label),['下载进度','已下载','阶段进度','声音','重新开始']);pass(stage);await shot('edited-preserved-progress.png');
    stage='reset-and-export';await page.evaluate(field=>window.panelHost.setProgress(field,9.75),phase.bind);
    const beforeReset=await state(),reset=rows(edited.spec).find(row=>row.kind==='button');await focus(edited.spec,reset);await page.keyboard.press('Enter');
    const live=await state();assert.deepEqual(live,{...beforeReset,[bar.bind]:0.1,[phase.bind]:2.5});assert.equal((await page.evaluate(()=>window.panelWorkbench.events())).at(-1).action,'reset-initial');
    await menu();let download=page.waitForEvent('download');await page.locator('#download-panel').click();await(await download).saveAs(resolve(output,'panel.bundle.json'));await idle();
    const exported=await validatePanelBundle(await readJson(resolve(output,'panel.bundle.json')),core);assert.deepEqual(exported.state,live);assert.deepEqual(exported.spec,edited.spec);
    await menu();download=page.waitForEvent('download');await page.locator('#download-unity').click();await(await download).saveAs(resolve(output,'unity-kit.zip'));await idle();
    const files=readStoredZip(await readFile(resolve(output,'unity-kit.zip')));assert.deepEqual(JSON.parse(files.get('panel.unity.json')),await createUnityDocument(exported,core));
    assert([...files.keys()].filter(name=>name.endsWith('.cs')).every(name=>name.startsWith('Assets/PanelHarness/')));pass(stage);
    stage='undo-preserves-host-progress';await menu();await page.locator('#undo').click();await idle();const undone=(await snapshot()).panel;assert.deepEqual(undone.spec,panel.spec);
    assert.equal((await state())[bar.bind],hostValue);pass(stage);await shot('undone.png');
    stage='mobile-render';await page.setViewportSize({width:390,height:844});
    if(await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();await page.locator('#canvas-host canvas').scrollIntoViewIfNeeded();
    assert(await page.locator('#canvas-host canvas').isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    assert((await inspect()).nodes.filter(n=>n.type==='ProgressBar').every(n=>n.visible));pass(stage);await shot('mobile.png');
  }
  if(options['--replay']) {
    stage='replay-real-result-in-final-build';await page.setViewportSize({width:1440,height:1080});await page.goto(server.url);await idle();await menu();
    const accepted=await readJson(options['--replay']);await page.locator('#panel-file').setInputFiles({name:'accepted.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(accepted))});await idle();
    assert.deepEqual((await snapshot()).panel.spec,accepted.spec);assert.deepEqual(await state(),accepted.state);
    const progress=rows(accepted.spec).filter(row=>row.kind==='progress');assert.equal(progress.length,3);
    assert.equal((await inspect()).nodes.filter(node=>node.type==='ProgressBar').length,3);
    await shot('real-result-final-build.png');await page.setViewportSize({width:390,height:844});await page.locator('#canvas-host canvas').scrollIntoViewIfNeeded();
    assert(!(await page.locator('#panel-menu').evaluate(n=>n.open)));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    await shot('real-result-mobile-final-build.png');pass(stage);
  }
  if(options['--combined']) {
    stage='combined-progress-state';await page.setViewportSize({width:1440,height:1080});await page.goto(server.url);await idle();await menu();
    const combined=await readJson(options['--combined']);await page.locator('#panel-file').setInputFiles({name:'combined.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(combined))});await idle();
    assert.deepEqual((await snapshot()).panel.spec,combined.spec);assert.equal((await inspect()).nodes.filter(n=>n.type==='ProgressBar').length,4);
    await page.evaluate(()=>window.panelHost.setProgress('first_f_row0',0.9));await page.evaluate(()=>window.panelHost.setProgress('second_f_row0',0.8));
    const reset=rows(combined.spec).find(row=>row.id==='first_r_row3');await focus(combined.spec,reset);await page.keyboard.press('Enter');
    assert.equal((await state()).first_f_row0,0.2);assert.equal((await state()).second_f_row0,0.8);pass(stage);await shot('combined-progress.png');
  }
  assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.requestFailures,[]);pass('no-browser-errors');
  assert.equal(report.modelRequests,options.real?3:0);assert.equal(report.fixtureCalls,options.real?0:3);report.status='PASS';
}catch(error){report.status='FAIL';report.failedStage=stage;report.error=String(error.message).slice(0,1600);process.exitCode=1;}
finally{await context?.close();await browser?.close();await server?.close();await writeNewJson(output,'progress-browser-report.json',report);console.log(JSON.stringify({status:report.status,mode:report.mode,checks:report.checks.length,modelRequests:report.modelRequests,failedStage:report.failedStage,error:report.error}));}
