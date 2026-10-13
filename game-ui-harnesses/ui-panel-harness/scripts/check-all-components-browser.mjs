#!/usr/bin/env node
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {digestBytes} from '../src/canonical.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--review'&&args[2]==='--output');
const input=resolve(args[1]),output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore(),acceptance=await readJson(resolve(input,'acceptance.json'));
const {chromium}=await loadWorkspaceTool('@playwright/test'),checks=[],errors=[],pass=name=>checks.push(name);
let browser,page,phase='start',report;
const inspect=()=>page.evaluate(()=>window.panelDelivery.inspect()),state=()=>page.evaluate(()=>window.panelDelivery.getState());
const id=row=>'all-components.row.'+row+'.control';
async function focus(nodeId){const canvas=page.locator('canvas');await canvas.focus();for(let i=0;i<35;i++){if(await canvas.getAttribute('data-focused-component')===nodeId)return;await page.keyboard.press('Tab');}throw Error('FOCUS_UNREACHABLE:'+nodeId);}
async function click(nodeId,y=.5){const node=(await inspect()).nodes.find(node=>node.id===nodeId);assert(node?.visible,'MISSING:'+nodeId);const box=await page.locator('canvas').boundingBox(),scale=box.width/720;await page.mouse.click(box.x+(node.bounds.x+node.bounds.width*.5)*scale,box.y+(node.bounds.y+node.bounds.height*y)*scale);}
async function tab(index){const node=(await inspect()).nodes.find(node=>node.type==='Tabs');await focus(node.id);await page.keyboard.press('Home');for(let i=0;i<index;i++)await page.keyboard.press('ArrowRight');}
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1120,height:1100},acceptDownloads:true,reducedMotion:'reduce',serviceWorkers:'block'});
 await context.route('**/*',route=>{if(['file:','data:','blob:'].includes(new URL(route.request().url()).protocol))return route.continue();errors.push('NETWORK');return route.abort();});
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 for(const artifact of acceptance.artifacts){
  phase=artifact.id+'-download';await page.goto(pathToFileURL(resolve(input,'index.html')).href);const pending=page.waitForEvent('download');await page.locator(`a[href="${artifact.id}.zip"]`).click();const download=await pending,file=resolve(output,artifact.id+'.zip');await download.saveAs(file);assert.equal(await digestBytes(await readFile(file)),artifact.zipSha256);pass(phase);
  phase=artifact.id+'-mount';await page.goto(pathToFileURL(resolve(input,artifact.id,'pixi/index.html')).href);await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status')?.dataset.state));assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');
  assert.deepEqual([...new Set((await inspect()).nodes.map(node=>node.type))].sort(),artifact.types);pass(phase);
  await page.screenshot({path:resolve(output,artifact.id+'-basic.png'),fullPage:true});
  phase=artifact.id+'-choices';await tab(1);await focus(id('row8'));await page.keyboard.press(' ');assert.equal((await state()).row8,true);
  await focus(id('row9'));await page.keyboard.press('Home');assert.equal((await state()).row9,'option0');await page.keyboard.press('End');assert.equal((await state()).row9,'option1');
  await focus(id('row10'));await page.keyboard.press('End');assert.equal((await state()).row10,'option11');
  const viewport=(await inspect()).nodes.find(node=>node.id===id('row10')+'.viewport');assert(viewport.value.y>0,'LIST_END_MUST_SCROLL');
  await click(viewport.id,.15);assert.equal((await state()).row10,'option8');pass(phase);
  await page.screenshot({path:resolve(output,artifact.id+'-choices.png'),fullPage:true});
  phase=artifact.id+'-dialog';await tab(2);await focus(id('row11')+'.open');await page.keyboard.press('Enter');assert.equal((await state()).row11,true);
  assert.equal(await page.locator('canvas').getAttribute('data-focused-component'),id('row11')+'.close');
  const before=await state();const tabs=(await inspect()).nodes.find(node=>node.type==='Tabs');await click(tabs.id,.04);assert.deepEqual(await state(),before);
  await page.keyboard.press('Tab');assert.equal(await page.locator('canvas').getAttribute('data-focused-component'),id('row11')+'.close');
  await page.screenshot({path:resolve(output,artifact.id+'-dialog.png'),fullPage:true});await page.keyboard.press('Enter');assert.equal((await state()).row11,false);assert.equal(await page.locator('canvas').getAttribute('data-focused-component'),id('row11')+'.open');pass(phase);
  phase=artifact.id+'-host-state';const count=await page.evaluate(()=>window.panelDelivery.events().length);await page.evaluate(()=>window.panelDelivery.panel.setDialog('row11',true));assert.equal((await state()).row11,true);await page.evaluate(()=>window.panelDelivery.panel.setDialog('row11',false));assert.equal(await page.evaluate(()=>window.panelDelivery.events().length),count);
  const exported=await page.evaluate(()=>window.panelDelivery.panel.exportBundle());await validatePanelBundle(exported,core);assert.deepEqual(exported.state,await state());
  await page.evaluate(()=>{window.panelDelivery.panel.close();});await page.evaluate(()=>window.panelDelivery.panel.open());assert.deepEqual(await state(),exported.state);pass(phase);
  await page.reload();await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');assert.equal((await state()).row8,false);pass(artifact.id+'-offline-reload');
 }
 assert.deepEqual(errors,[]);report={status:'PASS',checks,errors,browser:browser.version(),realModelCalls:0,unityNative:'NOT_RUN'};
}catch(error){report={status:'FAIL',phase,message:error.message,checks,errors,realModelCalls:0,unityNative:'NOT_RUN'};await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();await writeNewJson(output,'browser-report.json',report);console.log(JSON.stringify(report));}
