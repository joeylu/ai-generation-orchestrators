#!/usr/bin/env node
/** Offline acceptance of this cohort's actual successful deliveries; never invokes a model. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {controlId} from '../src/compiler.mjs';
import {digestBytes} from '../src/canonical.mjs';

const args=process.argv.slice(2),snapshot=args.at(-1)==='--snapshot';if(snapshot)args.pop();assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const run=resolve(args[1]),output=await createOutputDirectory(args[3]);let report;
if(snapshot){
  const plan=await readJson(resolve(run,'approved-plan.json')),results=[];
  for(const item of plan.cases){try{results.push(await readJson(resolve(run,item.id,'acceptance.json')));}catch(error){if(error.code!=='ENOENT')throw error;}}
  report={planSha256:plan.sha256,results,realModelCalls:results.reduce((sum,item)=>sum+(item.receipt?.invocationCount??0),0),sourceCohortComplete:results.length===plan.cases.length};
}else report={...await readJson(resolve(run,'input-adaptability-report.json')),sourceCohortComplete:true};
const artifacts=report.results.filter(item=>item.status==='PASS'&&item.delivery),results=[],errors=[];
assert(artifacts.length>0||report.evaluation==='TECHNICAL_AND_EXPLICIT_CONSTRAINTS_ONLY_HUMAN_REVIEW_REQUIRED','NO_SUCCESSFUL_DELIVERIES');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const links=report.results.map(item=>'<tr><td>'+escape(item.id)+'</td><td>'+escape(item.status)+'</td><td>'+escape(item.outcome??item.code??item.reason??'')+'</td><td>'+(item.delivery?
  '<a href="'+escape(relative(output,resolve(run,item.id,'delivery/pixi/index.html')).replaceAll('\\','/'))+'">试玩</a> · <a id="download-'+item.id+'" href="'+escape(relative(output,resolve(run,item.id,'panel.zip')).replaceAll('\\','/'))+'" download>下载实际 ZIP</a>':'')+'</td></tr>').join('');
const cohortDescription=report.kind?.startsWith('DETERMINISTIC_')
  ? '原批真实模型调用 '+report.originalRealModelCalls+' 次。本页为原始原生意图的确定性布局重放，新增模型调用0；原失败保留，重放不代表模型复测通过。'
  : '本批实际调用 '+report.realModelCalls+' 次，自动重试0次。案例结果来自原始模型输出与固定独立预期。编辑基准为程序夹具。';
await writeFile(resolve(output,'index.html'),'<!doctype html><meta charset="utf-8"><title>输入适应性验收交付</title><style>body{max-width:1100px;margin:30px auto;font:16px/1.6 system-ui}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style><h1>输入适应性验收交付</h1><p>'+escape(cohortDescription)+' 浏览器检查见 browser-report.json。</p><table><tr><th>案例</th><th>业务结果</th><th>路径</th><th>实际交付</th></tr>'+links+'</table>',{flag:'wx'});
const core=await loadWorkspaceCore(),{chromium}=await loadWorkspaceTool('@playwright/test');
let browser,page;
const state=()=>page.evaluate(()=>window.panelDelivery.getState());
const inspect=()=>page.evaluate(()=>window.panelDelivery.inspect());
const events=()=>page.evaluate(()=>window.panelDelivery.events());
const setState=values=>page.evaluate(values=>window.panelDelivery.panel.setState(values),values);
async function focus(id){
  const canvas=page.locator('canvas');await canvas.focus();
  // A retained canvas marker is not proof that the native Input still owns
  // focus after canvas.focus(). Enter through keyboard navigation first.
  for(let i=0;i<90;i++){await page.keyboard.press('Tab');if(await canvas.getAttribute('data-focused-component')===id)return;}
  throw new Error('FOCUS_UNREACHABLE:'+id);
}
async function closeDialogs(spec){const values=await state();for(const row of spec.sections.flatMap(section=>section.rows))if(row.kind==='dialog')values[row.bind]=false;await setState(values);}
async function checkTitleCenter(bundle){
  if(!['0.32.0','0.33.0'].includes(bundle.compilerVersion)||bundle.spec.titleBar?.horizontalAlign!=null&&bundle.spec.titleBar.horizontalAlign!=='center')return;
  const nodes=(await inspect()).nodes,title=nodes.find(node=>node.id===bundle.spec.id+'.title'),panel=nodes.find(node=>node.id===bundle.spec.id+'.panel');
  const glyph=title?.renderedTextBounds?.[0]?.bounds;assert(glyph&&panel,'TITLE_MEASUREMENT_MISSING');
  assert(Math.abs(glyph.x+glyph.width/2-(panel.bounds.x+panel.bounds.width/2))<1,'MAIN_TITLE_NOT_CENTERED');
}
async function reveal(spec,row){
  await closeDialogs(spec);
  if(spec.tabs){const section=spec.sections.find(section=>section.rows.some(item=>item.id===row.id)),tab=spec.tabs.pages.find(page=>page.sections.includes(section.id));await setState({...await state(),[spec.tabs.bind]:tab.id});}
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1120,height:1150},acceptDownloads:true,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>{if(['file:','data:','blob:'].includes(new URL(route.request().url()).protocol))return route.continue();errors.push('EXTERNAL_NETWORK');return route.abort();});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  for(const artifact of artifacts){
    const checks=[];let phase='download',bundle;
    try{
      await page.goto(pathToFileURL(resolve(output,'index.html')).href);
      const pending=page.waitForEvent('download');await page.locator('#download-'+artifact.id).click();
      const download=await pending,path=resolve(output,artifact.id+'.download.zip');await download.saveAs(path);
      const bytes=await readFile(path);assert.equal(bytes.length,artifact.delivery.bytes);assert.equal(await digestBytes(bytes),artifact.delivery.sha256);checks.push('actual-download');
      phase='mount';bundle=await validatePanelBundle(await readJson(resolve(run,artifact.id,'panel.bundle.json')),core);
      await page.goto(pathToFileURL(resolve(run,artifact.id,'delivery/pixi/index.html')).href);
      await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status')?.dataset.state));
      assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');assert.equal(await page.locator('#panel-title').textContent(),bundle.spec.title);
      assert.deepEqual(await state(),bundle.state);checks.push('mount-exact-saved-state');
      await checkTitleCenter(bundle);if(['0.32.0','0.33.0'].includes(bundle.compilerVersion))checks.push('measured-title-center');
      const spec=bundle.spec,rows=spec.sections.flatMap(section=>section.rows),fields=new Map(spec.state.map(field=>[field.id,field]));
      if(report.kind==='DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS'){
        phase='initial-actions-visible';
        const nodes=(await inspect()).nodes,panel=nodes.find(node=>node.id===spec.id+'.panel');
        assert(panel?.bounds,'PANEL_BOUNDS_MISSING');
        const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
        assert(!flatten(bundle.componentBundle.document.root).some(node=>node.id===spec.id+'.body'&&node.type==='ScrollView'),'INITIAL_BODY_SCROLL');
        for(const row of rows.filter(row=>row.kind==='button')){
          const bounds=nodes.find(node=>node.id===controlId(spec.id,row.id))?.bounds;
          assert(bounds&&bounds.width>0&&bounds.height>0,'ACTION_BOUNDS_MISSING:'+row.id);
          for(const outer of [panel.bounds,{x:0,y:0,width:spec.canvas.width,height:spec.canvas.height}])
            assert(bounds.x>=outer.x-1&&bounds.y>=outer.y-1&&bounds.x+bounds.width<=outer.x+outer.width+1&&bounds.y+bounds.height<=outer.y+outer.height+1,'INITIAL_ACTION_CLIPPED:'+row.id);
        }
        checks.push(phase);
      }
      await page.screenshot({path:resolve(output,artifact.id+'-initial.png'),fullPage:true});
      for(const row of rows){
        if(!row.enabled||!['slider','switch','checkbox','radio','list','select','input','dialog','button'].includes(row.kind))continue;
        phase=row.kind+':'+row.id;await reveal(spec,row);const id=controlId(spec.id,row.id),field=fields.get(row.bind);
        const before=await state(),count=(await events()).length;
        if(row.kind==='slider'){
          await focus(id);await page.keyboard.press(before[row.bind]===field.max?'Home':'End');
          assert.equal((await state())[row.bind],before[row.bind]===field.max?field.min:field.max);
          assert.equal((await events()).length,count+1);
        }else if(['switch','checkbox'].includes(row.kind)){
          await focus(id);await page.keyboard.press(' ');assert.equal((await state())[row.bind],!before[row.bind]);assert.equal((await events()).length,count+1);
        }else if(['radio','list','select'].includes(row.kind)){
          const target=before[row.bind]===field.options.at(-1).id?field.options[0].id:field.options.at(-1).id;
          await focus(id);await page.keyboard.press(target===field.options[0].id?'Home':'End');assert.equal((await state())[row.bind],target);assert.equal((await events()).length,count+1);
          if(row.kind==='list'&&field.options.length>row.visibleItems&&target===field.options.at(-1).id){const viewport=(await inspect()).nodes.find(node=>node.id===id+'.viewport');assert(viewport.value.y>0,'LIST_SELECTION_REVEAL');}
        }else if(row.kind==='input'&&!row.readOnly){
          await focus(id);const editor=page.locator('input');await editor.fill('验收');assert.equal((await state())[row.bind],'验收');assert.equal((await events()).length,count+1);
        }else if(row.kind==='button'){
          await focus(id);await page.keyboard.press('Enter');assert.equal((await events()).length,count+1);
          if(row.action.kind==='reset-initial')for(const bind of row.action.fields)assert.equal((await state())[bind],fields.get(bind).initial);
        }else if(row.kind==='dialog'){
          await focus(id+'.open');await page.keyboard.press('Enter');assert.equal((await state())[row.bind],true);assert.equal((await events()).length,count+1);
          if(row.modal){assert.equal(await page.locator('canvas').getAttribute('data-focused-component'),id+'.close');await page.keyboard.press('Tab');assert.equal(await page.locator('canvas').getAttribute('data-focused-component'),id+'.close');}
          await page.screenshot({path:resolve(output,artifact.id+'-dialog.png'),fullPage:true});
          await focus(id+'.close');await page.keyboard.press('Enter');assert.equal((await state())[row.bind],false);assert.equal((await events()).length,count+2);
          assert.equal(await page.locator('canvas').getAttribute('data-focused-component'),id+'.open');
        }
        checks.push(phase);
      }
      phase='host-state-and-reopen';await closeDialogs(spec);const saved=await state(),count=(await events()).length;
      await setState(saved);assert.equal((await events()).length,count);
      const exported=await page.evaluate(()=>window.panelDelivery.panel.exportBundle());await validatePanelBundle(exported,core);assert.deepEqual(exported.state,saved);
      await page.evaluate(()=>window.panelDelivery.panel.close());await page.evaluate(()=>window.panelDelivery.panel.open());assert.deepEqual(await state(),saved);checks.push(phase);
      await checkTitleCenter(bundle);
      phase='offline-reload';await page.reload();await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');assert.deepEqual(await state(),bundle.state);checks.push(phase);
      await checkTitleCenter(bundle);
      results.push({id:artifact.id,status:'PASS',checks});
    }catch(error){await page.screenshot({path:resolve(output,artifact.id+'-failure.png'),fullPage:true}).catch(()=>{});results.push({id:artifact.id,status:'FAIL',phase,message:error.message,checks});}
    process.stdout.write(JSON.stringify(results.at(-1))+'\n');
  }
}finally{
  await browser?.close();const acceptance={status:results.length===artifacts.length&&results.every(item=>item.status==='PASS')&&!errors.length?'PASS':'FAIL',planSha256:report.planSha256,
    panels:artifacts.length,checks:results.reduce((sum,item)=>sum+item.checks.length,0),results,errors,realModelCalls:0,sourceRealModelCalls:report.realModelCalls,
    sourceKind:report.kind??'REAL_MODEL_COHORT',originalRealModelCalls:report.originalRealModelCalls??report.realModelCalls,sourceCohortComplete:report.sourceCohortComplete,unityNative:'NOT_RUN_THIS_COHORT'};
  await writeNewJson(output,'browser-report.json',acceptance);process.stdout.write(JSON.stringify({status:acceptance.status,panels:acceptance.panels,checks:acceptance.checks,errors})+'\n');if(acceptance.status!=='PASS')process.exitCode=1;
}
