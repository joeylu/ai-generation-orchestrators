/** Native canvas screenshots from the exact saved states, separate from interaction acceptance. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,writeNewJson,createOutputDirectory} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
const args=process.argv.slice(2);assert(args.length===6&&args[0]==='--run'&&args[2]==='--audit'&&args[4]==='--output');
const run=resolve(args[1]),audit=await readJson(resolve(args[3],'audit.json')),bytes=await readFile(join(run,'input-adaptability-report.json')),report=JSON.parse(bytes);
assert.equal(report.cohort,'panel-stability-v1');assert.equal(report.planSha256,audit.planSha256);assert.equal(audit.sourceReportSha256,await digestBytes(bytes));assert.equal(audit.sourceFingerprint,'PASS');assert.equal(audit.receiptIntegrity,'PASS');assert.equal(report.kind,undefined);
const output=await createOutputDirectory(args[5]),{chromium}=await loadWorkspaceTool('@playwright/test'),errors=[],results=[];
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const context=await browser.newContext({viewport:{width:1100,height:2400},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>['file:','data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():(errors.push('EXTERNAL_NETWORK'),route.abort()));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  for(const result of report.results.filter(item=>item.delivery)){
    const bundle=await readJson(join(run,result.id,'panel.bundle.json'));assert.equal(bundle.sha256,audit.cases.find(item=>item.id===result.id).panelSha256);
    await page.goto(pathToFileURL(join(run,result.id,'delivery/pixi/index.html')).href);await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status')?.dataset.state));
    assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),bundle.state);assert.deepEqual(await page.evaluate(()=>window.panelDelivery.events()),[]);
    const filename=result.id+'-canvas.png';await page.locator('canvas').screenshot({path:join(output,filename)});const png=await readFile(join(output,filename));
    results.push({id:result.id,status:'CAPTURED_EXACT_INITIAL_STATE',sourceBundleSha256:bundle.sha256,path:filename,sha256:await digestBytes(png),bytes:png.length});
  }
  assert.deepEqual(errors,[]);await writeNewJson(output,'canvas-captures.json',{kind:'NATIVE_CANVAS_SCREENSHOTS_OF_AUDITED_ORIGINAL_STATES_NOT_NEW_MODEL_RESULTS',planSha256:report.planSha256,sourceReportSha256:audit.sourceReportSha256,status:'PASS',realModelCalls:0,errors,results});
  console.log(JSON.stringify({status:'PASS',captures:results.length,realModelCalls:0,errors}));
}finally{await browser.close();}
