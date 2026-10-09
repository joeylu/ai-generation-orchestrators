#!/usr/bin/env node
/** Fixture-only visual regression. Builds offline deliveries; never starts a model or Unity. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {readJson,createOutputDirectory,harnessRoot,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {semanticSettingsFixture} from '../examples/semantic-controls-v1/fixture.mjs';
const args=process.argv.slice(2);let browser,output;
const report={status:'NOT_RUN',sourceKind:'PROGRAMMATIC_FIXTURE',modelCalls:0,checks:[],consoleErrors:[],networkRequests:0,nativeUnity:'NOT_RUN',humanVisualReview:'NOT_RUN'};
try{
  assert(args.length===2&&args[0]==='--output','SEMANTIC_BROWSER_ARGUMENTS');output=await createOutputDirectory(args[1]);
  const core=await loadWorkspaceCore(),catalog=await readJson(resolve(harnessRoot,'examples/modern-controls.catalog.json')),base=await readJson(resolve(harnessRoot,'examples/settings-controls.panel.json'));
  report.catalogSha256=await digestJson(catalog);
  const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),{chromium}=await loadWorkspaceTool('@playwright/test');
  browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  page.on('pageerror',error=>report.consoleErrors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))report.networkRequests++;});
  const pass=(theme,name)=>report.checks.push({theme:theme.id,name,status:'PASS'});
  const clickControl=async rowId=>{const p=await page.evaluate(rowId=>{const d=window.panelDelivery,n=d.inspect().nodes.find(n=>n.id===`${d.bundle.spec.id}.row.${rowId}.control`),c=document.querySelector('#canvas-host canvas').getBoundingClientRect();return{x:c.x+(n.bounds.x+n.bounds.width/2)*c.width/d.bundle.spec.canvas.width,y:c.y+(n.bounds.y+n.bounds.height/2)*c.height/d.bundle.spec.canvas.height};},rowId);await page.mouse.click(p.x,p.y);};
  for(const theme of catalog.themes){
    const spec=semanticSettingsFixture(catalog,base);spec.theme={id:theme.id,version:theme.version};
    const bundle=await createPanelBundle(spec,catalog,core,{volume:65,muted:false,quality:'medium'}),kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
    const folder=resolve(output,theme.id);
    for(const [path,bytes]of delivery.contents){const full=resolve(folder,path);await mkdir(dirname(full),{recursive:true});await writeFile(full,bytes,{flag:'wx'});}
    await writeFile(resolve(folder,'panel-delivery.zip'),createStoredZip(delivery.contents),{flag:'wx'});
    for(const file of delivery.manifest.files){const bytes=await readFile(resolve(folder,file.path));assert.equal(bytes.length,file.bytes);assert.equal(await digestBytes(bytes),file.sha256);}pass(theme,'delivery-checksums');
    const model=await createWorkbenchModel({catalog,pool:null},core);try{await model.importPanel(await validatePanelBundle(await readJson(resolve(folder,'pixi/panel.bundle.json')),core));assert.deepEqual(await model.exportPanel(),bundle);}finally{model.dispose();}pass(theme,'portable-bundle-reimport');
    await page.goto(pathToFileURL(resolve(folder,'pixi/index.html')).href);await page.waitForFunction(()=>window.panelDelivery&&document.getElementById('status').dataset.state==='ready');
    assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),bundle.state);pass(theme,'played-state-load');
    await clickControl('quality-row');assert.equal(await page.evaluate(()=>window.panelDelivery.inspect().nodes.find(n=>n.type==='Select').popupOpen),true);
    await page.screenshot({path:resolve(folder,'select-open.png')});
    const point=await page.evaluate(()=>{const d=window.panelDelivery,n=d.inspect().nodes.find(n=>n.type==='Select'),r=n.popupItems[0].textBounds[0].bounds,c=document.querySelector('#canvas-host canvas').getBoundingClientRect();return{x:c.x+(r.x+r.width/2)*c.width/d.bundle.spec.canvas.width,y:c.y+(r.y+r.height/2)*c.height/d.bundle.spec.canvas.height};});
    await page.mouse.click(point.x,point.y);assert.equal(await page.evaluate(()=>window.panelDelivery.getState().quality),'low');pass(theme,'popup-select-and-change-event');
    assert.equal(await page.evaluate(()=>window.panelDelivery.events().at(-1).event.name),spec.sections[0].rows[2].event);
    await clickControl('quality-row');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.panelDelivery.inspect().nodes.find(n=>n.type==='Select').popupOpen),false);assert.equal(await page.evaluate(()=>window.panelDelivery.getState().quality),'low');pass(theme,'escape-retains-value');
    await clickControl('save');assert.equal(await page.evaluate(()=>window.panelDelivery.events().at(-1).event.action),'emit');assert.equal(await page.evaluate(()=>window.panelDelivery.getState().volume),65);pass(theme,'primary-button-business-event');
    await clickControl('reset-row');assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),{volume:80,muted:true,quality:'high'});pass(theme,'secondary-button-reset-scope');
    await page.screenshot({path:resolve(folder,'closed.png')});
  }
  assert.deepEqual(report.consoleErrors,[]);assert.equal(report.networkRequests,0);report.status='PASS';
  await writeNewJson(output,'semantic-controls-browser-report.json',report);console.log(JSON.stringify({status:report.status,checks:report.checks.length,themes:catalog.themes.length,modelCalls:0,nativeUnity:'NOT_RUN'}));
}catch(error){report.status='FAIL';const code=error?.code??error?.message;report.failureCode=/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'SEMANTIC_BROWSER_FAILED';if(output)await writeNewJson(output,'semantic-controls-browser-report.json',report);console.error(JSON.stringify({status:'FAIL',code:report.failureCode,completedChecks:report.checks.length}));process.exitCode=1;}
finally{await browser?.close();}
