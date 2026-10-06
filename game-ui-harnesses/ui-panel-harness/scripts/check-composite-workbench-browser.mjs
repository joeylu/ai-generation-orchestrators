#!/usr/bin/env node
/** Replay previously validated composite bundles. All model requests are blocked. */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {chromium} from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {createWorkbenchServer} from '../src/workbench-server.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {controlId} from '../src/compiler.mjs';
import {createCompositeAcceptanceCases} from '../examples/composite-v1/acceptance.mjs';
import {composePanelBundles,validatePanelComposition} from '../src/panel-composition.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--workbench','--bundles','--output'].includes(args[i])&&args[i+1]&&!options[args[i]],'EXPECTED_WORKBENCH_BUNDLES_OUTPUT');options[args[i]]=args[i+1];}
assert(Object.keys(options).length===3,'EXPECTED_WORKBENCH_BUNDLES_OUTPUT');
const output=await createOutputDirectory(options['--output']),core=await loadWorkspaceCore();
const flat=b=>b.spec.sections.flatMap(s=>s.rows),field=(b,r)=>b.spec.state.find(f=>f.id===r.bind),find=(b,label)=>flat(b).find(r=>r.label===label),button=(b,label)=>flat(b).find(r=>r.kind==='button'&&(r.buttonLabel===label||r.label===label));
const report={version:'0.1',status:'RUNNING',modelRequests:0,blockedRequests:0,cases:[],viewports:[{width:1440,height:1080},{width:390,height:844}],nativeEngines:'NOT_RUN',driver:'Playwright',browserPlugin:'Unavailable in this session'};
let server,browser;
const cases=createCompositeAcceptanceCases({flat,field,find,button,generate:async a=>{const b=await validatePanelBundle(await readJson(resolve(options['--bundles'],a.item.id,'generated-panel.bundle.json')),core);await a.upload(b);assert.equal(b.spec.panelSpecVersion,'0.7');a.pass('validated-bundle-import-zero-model');return b;}});
cases.COM04=async a=>{
 const source=await validatePanelBundle(await readJson(resolve(options['--bundles'],'COM03/generated-panel.bundle.json')),core);
 const request={panelCompositionRequestVersion:'0.1',id:'composite-loading-pair',title:'双实例加载验收',sources:[{namespace:'first',bundleSha256:source.sha256},{namespace:'second',bundleSha256:source.sha256}],layout:'tabs',width:null,canvasWidth:null,canvasHeight:null,maxHeight:320,surfaceFrom:null};
 const composition=await composePanelBundles(request,[source,source],core);await validatePanelComposition(composition,[source,source],core);await a.save('composition.json',composition);await a.save('generated-panel.bundle.json',composition.bundle);await a.upload(composition.bundle);const b=composition.bundle;
 const rowAt=(index,original)=>flat(b).find(r=>r.id===composition.receipt.mappings[index].rows.find(m=>m.source===original.id).target),bar=flat(source).find(r=>r.kind==='progress'),reset=button(source,'重新开始'),sound=find(source,'提示音');
 const first=rowAt(0,bar),second=rowAt(1,bar),firstReset=rowAt(0,reset),secondReset=rowAt(1,reset);
 await a.page.evaluate(({a,b})=>{window.panelHost.setProgress(a,63.75);window.panelHost.setProgress(b,88.25);},{a:first.bind,b:second.bind});await a.click(b,rowAt(0,sound));const before=await a.state();await a.click(b,firstReset);assert.equal((await a.state())[first.bind],field(b,first).initial);assert.equal((await a.state())[second.bind],88.25);assert.equal((await a.state())[rowAt(0,sound).bind],false);assert.equal((await a.state())[rowAt(1,sound).bind],true);a.pass('duplicate-source-namespaced-progress-and-first-reset-isolation');
 await a.choosePage(b,1);assert.equal((await a.state())[second.bind],88.25);await a.click(b,secondReset);assert.equal((await a.state())[second.bind],field(b,second).initial);assert.equal((await a.state())[rowAt(0,sound).bind],before[rowAt(0,sound).bind]);a.pass('second-page-reset-and-state-preservation');await a.exportCheck();
 const tabbed=await readJson(resolve(options['--bundles'],'COM01/generated-panel.bundle.json'));await assert.rejects(composePanelBundles({...request,id:'invalid-nested-tabs',sources:[{namespace:'first',bundleSha256:tabbed.sha256},{namespace:'second',bundleSha256:source.sha256}]},[tabbed,source],core),error=>error.code==='COMPOSITION_NESTED_TABS_UNSUPPORTED');a.pass('unsupported-nested-tabs-rejected-explicitly');
};
try{
 server=await createWorkbenchServer({workbench:resolve(options['--workbench']),outputRoot:resolve(output,'blocked-model-output'),port:0,planner:async()=>{throw Error('MODEL_FORBIDDEN');},editor:async()=>{throw Error('MODEL_FORBIDDEN');}});
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],proxy:{server:'http://127.0.0.1:1',bypass:'127.0.0.1'}});report.browser=browser.version();
 for(const id of Object.keys(cases)){
  const item={id,status:'RUNNING',checks:[],consoleErrors:[],pageErrors:[],screenshots:[],directory:await createOutputDirectory(resolve(output,id))};report.cases.push(item);const page=await browser.newPage({viewport:{width:1440,height:1080},acceptDownloads:true});page.setDefaultTimeout(20000);
  page.on('console',m=>{if(m.type()==='error')item.consoleErrors.push(m.text());});page.on('pageerror',e=>item.pageErrors.push(e.message));
  await page.route(u=>/^\/api\/panel\/(plan|edit)$/.test(u.pathname),async route=>{report.blockedRequests++;await route.abort();});
  const idle=()=>page.waitForFunction(()=>window.panelWorkbench&&!window.panelWorkbench.busy),snap=()=>page.evaluate(()=>window.panelWorkbench.snapshot()),state=()=>page.evaluate(()=>window.panelWorkbench.getState()),events=()=>page.evaluate(()=>window.panelWorkbench.events()),inspect=()=>page.evaluate(()=>window.panelWorkbench.inspect());
  const pass=name=>item.checks.push({name,status:'PASS'}),save=(name,value)=>writeNewJson(item.directory,name,value);
  const menu=async()=>{if(!await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();};
  const advanced=async()=>{await menu();if(await page.locator('#prepare-edit-context').isHidden())await page.locator('#advanced-tools').click();};
  const upload=async b=>{await menu();await page.locator('#panel-file').setInputFiles({name:'panel.bundle.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(b))});await idle();assert.equal((await snap()).panel.sha256,b.sha256);};
  const panel=async()=>validatePanelBundle((await snap()).panel,core);
  const focus=async(b,row)=>{const canvas=page.locator('#canvas-host canvas'),target=controlId(b.spec.id,row.id),focusedInput=async()=>(await inspect()).nodes.some(n=>n.id===target&&n.inputEditing?.focused);await canvas.scrollIntoViewIfNeeded();if(row.kind==='input'&&await focusedInput()){await page.locator('#canvas-host input').focus();return;}await canvas.focus();for(let n=0;n<flat(b).length+20;n++){if(await canvas.getAttribute('data-focused-component')===target&&(row.kind!=='input'||await focusedInput()))return;await page.keyboard.press('Tab');}throw Error('FOCUS_UNREACHABLE:'+row.id);};
  const click=async(b,row)=>{await focus(b,row);await page.keyboard.press('Enter');};
  const type=async(b,row,text)=>{await focus(b,row);const input=page.locator('#canvas-host input');await input.focus();assert(await input.evaluate(n=>document.activeElement===n));await page.keyboard.press('Control+A');if(!text)await page.keyboard.press('Backspace');else await page.keyboard.insertText(text);assert.equal((await state())[row.bind],text);};
  const choosePage=async(b,index)=>{const node=(await inspect()).nodes.find(n=>n.type==='Tabs'),canvas=page.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const rect=await canvas.boundingBox(),x=node.bounds.x+(index+.5)*node.bounds.width/b.spec.tabs.pages.length,y=node.bounds.y+24;await page.mouse.click(rect.x+x*rect.width/b.spec.canvas.width,rect.y+y*rect.height/b.spec.canvas.height);assert.equal((await state())[b.spec.tabs.bind],b.spec.tabs.pages[index].id);};
  const undo=async()=>{await advanced();await page.locator('#undo').click();await idle();};
  const exportCheck=async()=>{const before=await state(),spec=(await panel()).spec;await menu();const download=page.waitForEvent('download');await page.locator('#download-panel').click();await(await download).saveAs(resolve(item.directory,'exported-panel.bundle.json'));await idle();const exported=await validatePanelBundle(await readJson(resolve(item.directory,'exported-panel.bundle.json')),core);assert.deepEqual(exported.state,before);assert.deepEqual(exported.spec,spec);await upload(exported);assert.deepEqual(await state(),before);assert.equal((await snap()).history.length,0);pass('export-reopen-state-and-empty-import-history');return exported;};
  const a={item,page,idle,snap,state,events,inspect,pass,save,menu,advanced,upload,panel,focus,click,type,choosePage,undo,exportCheck};
  try{
   await page.goto(server.url);await idle();assert.match(await page.title(),/Panel Studio/);assert(await page.getByRole('heading',{name:'Panel Studio',exact:true}).isVisible());assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(),0);pass('page-identity-visible-nonblank-no-overlay');
   await cases[id](a);if(await page.locator('#advanced-tools').getAttribute('aria-expanded')==='true'){await menu();await page.locator('#advanced-tools').click();}if(await page.locator('#panel-menu').evaluate(n=>n.open))await page.locator('#panel-menu > summary').click();
   await save('panel.bundle.json',await panel());await page.locator('#canvas-host').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(item.directory,'desktop.png'),fullPage:true});item.screenshots.push('desktop.png');await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:resolve(item.directory,'mobile.png'),fullPage:true});item.screenshots.push('mobile.png');pass('responsive-no-horizontal-overflow');assert.deepEqual(item.pageErrors,[]);assert.deepEqual(item.consoleErrors,[]);pass('no-browser-runtime-errors');item.status='PASS';
  }catch(error){item.status='FAIL';item.failure=String(error.code??error.message).slice(0,1500);try{await page.screenshot({path:resolve(item.directory,'failure.png'),fullPage:true});}catch{}}
  finally{await page.close();await writeNewJson(item.directory,'case-report.json',item);console.log(JSON.stringify({id,status:item.status,checks:item.checks.length,failure:item.failure}));}
 }
 assert.equal(report.blockedRequests,0);report.status=report.cases.every(c=>c.status==='PASS')?'PASS':'COMPLETE_WITH_FINDINGS';
}catch(error){report.status='FAIL';report.failure=String(error.code??error.message).slice(0,1200);}
finally{await browser?.close();await server?.close();report.totals={passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length,checks:report.cases.reduce((n,c)=>n+c.checks.length,0)};await writeNewJson(output,'composite-browser.json',report);console.log(JSON.stringify({status:report.status,...report.totals,modelRequests:0,blockedRequests:report.blockedRequests}));if(report.status!=='PASS')process.exitCode=1;}
