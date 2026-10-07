#!/usr/bin/env node
/** Real Pixi acceptance. --real invokes one model request per scenario, without resubmission. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {checkPanelProposal} from '../src/proposal.mjs';
import {checkPanelEditProposal} from '../src/edit-planning.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {composePanelBundles} from '../src/panel-composition.mjs';
import {tabsRequest,tabsIntent} from '../examples/tabs-v1/fixture.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {controlId} from '../src/compiler.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {digestBytes} from '../src/canonical.mjs';
const options={},args=process.argv.slice(2);
for(let i=0;i<args.length;i++){if(args[i]==='--real')options.real=true;else{assert(['--workbench','--output','--url'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[++i];}}
assert(options['--workbench']&&options['--output']);assert(!options['--url']||!options.real,'live checks must not submit models');
const output=await createOutputDirectory(options['--output']),core=await loadWorkspaceCore();
const fixtureCatalog=await readJson(new URL('../examples/modern-mint-tabs.catalog.json',import.meta.url));
const fixtureContext=await createPlanningContext(tabsRequest,fixtureCatalog);
const base=await createPanelBundle((await materializePanelIntent(fixtureContext,tabsIntent(fixtureContext))).spec,fixtureCatalog,core);
const report={version:'0.1',status:'RUNNING',mode:options.real?'real':options['--url']?'live-replay':'fixture',checks:[],cases:[],modelRequests:0,fixtureCalls:0,automaticRetries:0,
 browserPlugin:'NOT_AVAILABLE',humanVisualReview:'NOT_RUN',nativeEngines:'NOT_RUN',consoleErrors:[],pageErrors:[],screenshots:[]};
const pass=name=>report.checks.push({name,status:'PASS'}),rows=s=>s.sections.flatMap(g=>g.rows);
const editText='把声音页签名称改为音频，主音量创作默认值改为50；在显示页的亮度后面增加音效音量滑条，范围0～100，步长1，默认40。保留原有ID、分页、当前试玩值和恢复声音按钮的重置范围。';
function receipt(context,checked,editing=false){return {[editing?'codexEditingReceiptVersion':'codexPlanningReceiptVersion']:'0.1',model:'gpt-6-luna',effort:'xhigh',status:checked.status,contextSha256:context.sha256,proposalSha256:checked.proposalSha256,failureCode:null,invocationCount:1,automaticRetries:0,elapsedMs:0,usage:null};}
async function planner(context){report.fixtureCalls++;const intent=tabsIntent(context);if(context.request.text.includes('默认打开显示页')){intent.panel.body.pages[0].initial=false;intent.panel.body.pages[1].initial=true;}const proposal=await materializePanelIntent(context,intent),checked=await checkPanelProposal(context,proposal);return{proposal,report:checked,receipt:receipt(context,checked)};}
async function editor(context){report.fixtureCalls++;const list=rows(context.spec),volume=list.find(r=>r.label==='主音量'),brightness=list.find(r=>r.label==='亮度'),page=context.spec.tabs.pages[0];
 const operations=[{op:'set-tab-label',pageId:page.id,label:'音频'},{op:'set-state-initial',fieldId:volume.bind,value:50},{op:'add-row',sectionId:context.spec.sections.find(s=>s.rows.some(r=>r.id===brightness.id)).id,afterRowId:brightness.id,
 row:{...volume,id:'effects',label:'音效音量',bind:'effects',event:'panel.effects'},state:{id:'effects',type:'number',min:0,max:100,step:1,initial:40}}];
 const proposal={editProposalVersion:'0.1',contextSha256:context.sha256,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Explicit fixture rehearsal.',operations},decisions:operations.map((_,operationIndex)=>({operationIndex,basis:{kind:'request-interpretation',quote:editText,start:0,end:editText.length}})),unresolved:[]};
 const checked=await checkPanelEditProposal(context,proposal);return{proposal,report:checked,receipt:receipt(context,checked,true)};}
let server,browser,context,page,stage='initialize';
try{
 if(!options['--url'])server=await createWorkbenchServer({workbench:resolve(options['--workbench']),outputRoot:resolve(output,'codex-calls'),port:0,...(options.real?{}:{planner,editor})});
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});
 report.browser={channel:'msedge',version:browser.version()};context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('request',r=>{if(options.real&&r.method()==='POST'&&/\/api\/panel\/(plan|edit)$/.test(new URL(r.url()).pathname))report.modelRequests++;});
 const idle=()=>page.waitForFunction(()=>window.panelWorkbench?.snapshot()&&!window.panelWorkbench.busy);
 const state=()=>page.evaluate(()=>window.panelWorkbench.getState()),snapshot=()=>page.evaluate(()=>window.panelWorkbench.snapshot()),inspect=()=>page.evaluate(()=>window.panelWorkbench.inspect());
 const shot=async name=>{await page.screenshot({path:resolve(output,name),fullPage:true});report.screenshots.push(name);};
 const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
 const upload=async bundle=>{await menu();await page.locator('#panel-file').setInputFiles({name:'panel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});await idle();};
 const point=async(spec,x,y)=>{const canvas=page.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();return{x:b.x+x*b.width/spec.canvas.width,y:b.y+y*b.height/spec.canvas.height};};
 const choose=async(spec,index)=>{const n=(await inspect()).nodes.find(n=>n.type==='Tabs'),p=await point(spec,n.bounds.x+(index+.5)*n.bounds.width/spec.tabs.pages.length,n.bounds.y+24);await page.mouse.click(p.x,p.y);assert.equal((await state())[spec.tabs.bind],spec.tabs.pages[index].id);};
 const focus=async(spec,id)=>{const c=page.locator('#canvas-host canvas');await c.scrollIntoViewIfNeeded();await c.focus();for(let i=0;i<rows(spec).length+10;i++){if(await c.getAttribute('data-focused-component')===id)return;await page.keyboard.press('Tab');}throw Error('FOCUS_UNREACHABLE');};
 const texts=options['--url']?[]:[tabsRequest.text,tabsRequest.text.replace('默认打开声音页','默认打开显示页')];
 let accepted;
 for(const [index,text]of texts.entries()){
  stage=`generate-${index}`;await page.goto(server.url);await idle();await page.waitForFunction(()=>document.getElementById('model-status').textContent.includes('本地 Codex CLI'));
  await page.locator('#request-text').fill(text);const waiting=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/panel/plan',{timeout:900000});await page.locator('#generate-plan').click();const response=await waiting,result=await response.json();await writeNewJson(output,`generation-${index}-response.json`,result);
  assert(response.ok(),JSON.stringify(result));await idle();accepted=(await snapshot()).panel;assert(accepted);await validatePanelBundle(accepted,core);assert.equal(accepted.spec.tabs.pages.length,2);
  const spec=accepted.spec,fields=rows(spec),volume=fields.find(r=>r.label==='主音量'),brightness=fields.find(r=>r.label==='亮度'),bar=fields.find(r=>r.kind==='progress');
  assert.equal((await state())[spec.tabs.bind],spec.tabs.pages[index].id);assert.equal(spec.state.find(f=>f.id===volume.bind).initial,70);assert.equal(spec.state.find(f=>f.id===brightness.bind).initial,60);
  report.cases.push({request:text,status:'PASS',contextSha256:result.receipt.contextSha256,bundleSha256:accepted.sha256});pass(stage);await shot(`generated-${index}.png`);
  stage='page-state-and-keyboard';await choose(spec,0);await focus(spec,controlId(spec.id,volume.id));await page.keyboard.press('ArrowLeft');assert.equal((await state())[volume.bind],69);
  await page.evaluate(({field,value})=>window.panelHost.setProgress(field,value),{field:bar.bind,value:.376123456789});
  await choose(spec,1);let nodes=(await inspect()).nodes;assert(!nodes.find(n=>n.id===controlId(spec.id,volume.id)).visible);assert(nodes.find(n=>n.id===controlId(spec.id,brightness.id)).visible);
  await focus(spec,controlId(spec.id,brightness.id));await page.keyboard.press('ArrowRight');assert.equal((await state())[brightness.bind],61);
  await focus(spec,controlId(spec.id,spec.tabs.id));await page.keyboard.press('Home');assert.equal((await state())[spec.tabs.bind],spec.tabs.pages[0].id);assert.equal((await state())[volume.bind],69);
  const focusIDs=[];for(let i=0;i<fields.length+5;i++){await page.keyboard.press('Tab');focusIDs.push(await page.locator('#canvas-host canvas').getAttribute('data-focused-component'));}
  assert(!focusIDs.includes(controlId(spec.id,brightness.id)));assert.equal((await state())[bar.bind],.376123456789);pass(stage);
  if(index===0)continue;
  stage='edit-tabs';await page.locator('#edit-request-text').fill(editText);const wait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/panel/edit',{timeout:900000});await page.locator('#generate-edit').click();const res=await wait,data=await res.json();await writeNewJson(output,'edit-response.json',data);assert(res.ok(),JSON.stringify(data));await idle();
  const edited=(await snapshot()).panel;assert(edited);await validatePanelBundle(edited,core);assert.equal(edited.spec.tabs.pages[0].label,'音频');assert.equal(edited.spec.state.find(f=>f.id===volume.bind).initial,50);
  const effects=rows(edited.spec).find(r=>r.label==='音效音量');assert(effects);assert.equal((await state())[effects.bind],40);assert.equal((await state())[volume.bind],69);assert.equal((await state())[brightness.bind],61);
  assert.deepEqual(edited.spec.tabs.pages.map(p=>p.sections),spec.tabs.pages.map(p=>p.sections));const reset=rows(edited.spec).find(r=>r.kind==='button');assert.deepEqual(reset.action,fields.find(r=>r.kind==='button').action);
  await choose(edited.spec,0);await focus(edited.spec,controlId(spec.id,reset.id));await page.keyboard.press('Enter');assert.equal((await state())[volume.bind],50);assert.equal((await state())[brightness.bind],61);pass(stage);await shot('edited-reset.png');
  stage='export-state-and-native-kit';await choose(edited.spec,1);await menu();let download=page.waitForEvent('download');await page.locator('#download-panel').click();await(await download).saveAs(resolve(output,'panel.bundle.json'));await idle();const exported=await validatePanelBundle(await readJson(resolve(output,'panel.bundle.json')),core);assert.deepEqual(exported.state,await state());
  await menu();download=page.waitForEvent('download');await page.locator('#download-unity').click();await(await download).saveAs(resolve(output,'unity-kit.zip'));await idle();const files=readStoredZip(await readFile(resolve(output,'unity-kit.zip')));assert.deepEqual(JSON.parse(files.get('panel.unity.json')),await createUnityDocument(exported,core));pass(stage);
  stage='undo-and-restore';await menu();await page.locator('#undo').click();await idle();assert.deepEqual((await snapshot()).panel.spec,spec);assert.equal((await state())[volume.bind],69);await upload(exported);assert.deepEqual(await state(),exported.state);pass(stage);
  stage='mobile';await page.setViewportSize({width:390,height:844});if(await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();await page.locator('#canvas-host canvas').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));await choose(edited.spec,0);await shot('mobile.png');pass(stage);
 }
 if(options['--url']){
  stage='live-build-bytes';const manifest=await readJson(resolve(options['--workbench'],'workbench-build.json'));
  for(const file of manifest.files){const response=await fetch(new URL(file.path,options['--url']));assert(response.ok);const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(bytes.length,file.bytes);assert.equal(await digestBytes(bytes),file.sha256);}pass(stage);
  stage='live-generation-capability';await page.goto(options['--url']);await idle();await page.waitForFunction(()=>document.getElementById('model-status').textContent.includes('本地 Codex CLI'));
  await page.locator('#request-text').fill(tabsRequest.text);await menu();await page.locator('#advanced-tools').click();await page.locator('#prepare').click();await idle();
  const prepared=(await snapshot()).context;assert.equal(prepared.planningContextVersion,'0.6');assert.equal(prepared.capabilities.navigation,'horizontal-tabs-v1');assert(prepared.candidates.some(c=>c.kind==='tabs'));await writeNewJson(output,'live-planning-context.json',prepared);pass(stage);
  stage='live-build-replay';accepted=base;await upload(accepted);await choose(accepted.spec,1);assert(!(await inspect()).nodes.find(n=>n.id===controlId(accepted.spec.id,'row0')).visible);pass(stage);await shot('live-tabs.png');
 }
 // Programmatic long-page fixture exercises actual Pixi scrolling and popup closure without a model.
 stage='independent-page-scroll-and-popup';await page.setViewportSize({width:1440,height:1080});const s=structuredClone(base.spec);
 const template=s.sections[0].rows[0];for(let i=0;i<8;i++){const id='extra'+i;s.sections[0].rows.push({...template,id,label:'扩展'+i,bind:id,event:'panel.'+id});s.state.push({id,type:'number',min:0,max:100,step:1,initial:50});}
 s.sections[0].rows.push({id:'quality',kind:'select',label:'画质',recipe:{id:'settings.select',version:'0.1.0'},bind:'quality',event:'panel.quality',enabled:true});s.state.push({id:'quality',type:'enum',initial:'medium',options:[{id:'low',label:'低'},{id:'medium',label:'中'},{id:'high',label:'高'}]});
 const long=await createPanelBundle(s,base.catalog,core);await upload(long);await choose(s,0);await focus(s,controlId(s.id,'quality'));await page.keyboard.press('Enter');let nodes=(await inspect()).nodes;assert(nodes.find(n=>n.id===controlId(s.id,'quality')).popupOpen);const scroll=nodes.find(n=>n.id===s.id+'.page.page0');assert(scroll.type==='ScrollView'&&scroll.value.y>0);
 await choose(s,1);assert(!(await inspect()).nodes.find(n=>n.id===controlId(s.id,'quality')).popupOpen);await choose(s,0);assert.equal((await inspect()).nodes.find(n=>n.id===scroll.id).value.y,scroll.value.y);pass(stage);await shot('long-page.png');
 stage='composed-tabs-with-source-local-resets';const sources=[];
 for(let i=0;i<2;i++){const source=structuredClone(base.spec);source.id='source'+i;source.title=i?'画面设置':'声音设置';source.tabs=null;source.state=source.state.filter(f=>f.id!=='navigation');sources.push(await createPanelBundle(source,base.catalog,core,{row0:35-i*10,row1:true,row3:90+i,row4:.8+i*.1}));}
 const composition=await composePanelBundles({panelCompositionRequestVersion:'0.1',id:'composed-tabs',title:'组合分页',sources:sources.map((b,i)=>({namespace:'n'+i,bundleSha256:b.sha256})),layout:'tabs',width:null,canvasWidth:null,canvasHeight:null,maxHeight:480,surfaceFrom:null},sources,core);
 await writeNewJson(output,'composition.json',composition);await writeNewJson(output,'composition.bundle.json',composition.bundle);await upload(composition.bundle);
 await choose(composition.bundle.spec,0);await focus(composition.bundle.spec,controlId('composed-tabs','n0_r_row2'));await page.keyboard.press('Enter');assert.equal((await state()).n0_f_row0,70);assert.equal((await state()).n1_f_row0,25);assert.equal((await state()).n1_f_row4,.9);
 await choose(composition.bundle.spec,1);assert.equal((await state()).n1_f_row0,25);pass(stage);await shot('composed-tabs.png');
 assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.pageErrors,[]);report.status='PASS';pass('no-browser-errors');
}catch(error){report.status='FAIL';report.failedStage=stage;report.error={code:error.code??'TABS_BROWSER_FAILED',message:String(error.message).slice(0,1600)};if(page)try{await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});}catch{}}
finally{await browser?.close();await server?.close();await writeNewJson(output,'tabs-workbench-browser-report.json',report);}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,modelRequests:report.modelRequests,automaticRetries:report.automaticRetries,failedStage:report.failedStage}));if(report.status!=='PASS')process.exitCode=1;
