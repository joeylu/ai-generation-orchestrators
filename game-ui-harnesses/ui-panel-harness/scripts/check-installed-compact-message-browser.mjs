#!/usr/bin/env node
/** Native installed-artifact acceptance; no model calls, repairs or external requests. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {observeCompactMessage} from './lib/compact-message-acceptance.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--acceptance'&&args[2]==='--output');
const input=resolve(args[1]),output=await createOutputDirectory(args[3]);
const reportBytes=await readFile(resolve(input,'compact-message-report.json')),source=JSON.parse(reportBytes);
assert.equal(source.status,'PASS');assert.equal(source.artifacts.length,4);
const {chromium}=await loadWorkspaceTool('@playwright/test'),checks=[],errors=[];let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1100,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
 await context.route('**/*',route=>['file:','data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():(errors.push('EXTERNAL_REQUEST'),route.abort()));
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 for(const artifact of source.artifacts){
  const bundle=JSON.parse(await readFile(resolve(input,artifact.pixiDirectory,'panel.bundle.json')));assert.equal(bundle.sha256,artifact.panelSha256);
  const buttons=bundle.spec.sections[0].rows.filter(row=>row.kind==='button');assert.equal(buttons.length,2);
  for(const width of [1100,390]){
   await page.setViewportSize({width,height:900});
   const open=async()=>{await page.goto(pathToFileURL(resolve(input,artifact.pixiDirectory,'index.html')).href);await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status')?.dataset.state));assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');};
   await open();const observation=await observeCompactMessage(page,bundle);assert.equal(observation.status,'PASS');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
   const imageName=artifact.id+'-'+width+'.png';await page.locator('canvas').screenshot({path:resolve(output,imageName)});
   const imageSha256=await digestBytes(await readFile(resolve(output,imageName)));
   checks.push({id:artifact.id,width,kind:'native-layout',status:'PASS',observation,capture:{path:imageName,sha256:imageSha256}});
   for(const row of buttons){
    await open();const canvas=page.locator('canvas'),id=bundle.spec.id+'.row.'+row.id+'.control';await canvas.focus();let found=false;
    for(let n=0;n<12;n++){await page.keyboard.press('Tab');if(await canvas.getAttribute('data-focused-component')===id){found=true;break;}}
    assert(found,'BUTTON_UNREACHABLE');await page.keyboard.press('Enter');
    const events=await page.evaluate(()=>window.panelDelivery.events());assert.equal(events.length,1);assert.equal(events[0].event.name,row.event);assert.equal(events[0].event.rowId,row.id);assert.equal(events[0].event.action,'emit');
    checks.push({id:artifact.id,width,kind:'actual-choice',rowId:row.id,status:'PASS'});
   }
  }
 }
 assert.deepEqual(errors,[]);
 await writeNewJson(output,'browser-report.json',{status:'PASS',kind:'INSTALLED_COMPACT_FIXTURES_NOT_MODEL_RESULTS',sourceReportSha256:await digestBytes(reportBytes),checks,errors,realModelCalls:0,unityNative:'NOT_RUN'});
 console.log(JSON.stringify({status:'PASS',cases:source.artifacts.length,checks:checks.length,realModelCalls:0}));
}finally{await browser?.close();}
