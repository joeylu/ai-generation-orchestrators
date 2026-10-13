#!/usr/bin/env node
/** Actual Pixi and downloaded/offline ZIP acceptance. All inputs are deterministic fixtures. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--review'&&args[2]==='--output','IMAGE_BROWSER_ARGUMENTS');
const input=resolve(args[1]),output=await createOutputDirectory(args[3]),acceptance=JSON.parse(await readFile(resolve(input,'acceptance.json'),'utf8'));
assert.equal(acceptance.status,'PASS');
const {chromium}=await loadWorkspaceTool('@playwright/test'),checks=[],errors=[],observations=[];
let browser,page,report;
const pass=name=>checks.push({name,status:'PASS'}),ready=()=>page.waitForFunction(()=>document.documentElement.dataset.ready);
async function select(variant,mode){await page.locator(`[data-option="${variant}"]`).click();await page.locator(`[data-mode="${mode}"]`).click();await page.waitForFunction(id=>document.documentElement.dataset.active===id,variant+'-'+mode);}
async function clickNode(id,suffix){
  const node=await page.evaluate(({id,suffix})=>window.imageSlotReview.get(id).inspect().nodes.find(node=>node.id.endsWith(suffix)),{id,suffix});
  const box=await page.locator(`#${id} canvas`).boundingBox(),scale=box.width/1120;
  await page.mouse.click(box.x+(node.bounds.x+node.bounds.width/2)*scale,box.y+(node.bounds.y+node.bounds.height/2)*scale);
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true});
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',async route=>{if(['file:','data:','blob:'].includes(new URL(route.request().url()).protocol))await route.continue();else{errors.push('UNEXPECTED_NETWORK');await route.abort();}});
  await page.goto(pathToFileURL(resolve(input,'index.html')).href);await ready();assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
  assert.deepEqual(await page.evaluate(()=>window.imageSlotReview.errors()),[]);pass('all-six-real-pixi-instances-mount');
  for(const mode of ['light','dark'])for(const variant of ['text','slots','bound']){
    const id=variant+'-'+mode;await select(variant,mode);
    const inspection=await page.evaluate(id=>window.imageSlotReview.get(id).inspect(),id),images=inspection.nodes.filter(node=>node.id.endsWith('.control')&&node.id.includes('.portrait'));
    assert.equal(images.length,variant==='text'?0:3);assert(images.every(node=>node.visible));
    const buttons=inspection.nodes.filter(node=>node.type==='Button');assert.equal(buttons.length,3);
    if(variant==='bound')assert(images.every(node=>node.type==='Image'));else if(variant==='slots')assert(images.every(node=>node.type==='Container'));
    const texts=inspection.nodes.filter(node=>node.type==='Text'&&node.visible);assert(texts.length>=6);assert(texts.every(node=>node.renderedTextBounds));
    const visibleCopy=texts.flatMap(node=>node.renderedTextBounds.map(text=>text.text));
    for(const name of ['战士','魔法师','弓箭手'])assert.equal(visibleCopy.filter(text=>text.includes(name)).length,1,`${id}: ${name} must appear only in its card title`);
    assert(!visibleCopy.includes('角色'));assert(buttons.every(button=>texts.find(node=>node.id===button.id+'.center-label')?.renderedTextBounds.some(text=>text.text==='选择')));
    assert.equal(visibleCopy.filter(text=>text==='待添加肖像').length,variant==='slots'?3:0);
    pass('one-visible-name-per-card-'+id);
    for(const button of buttons)assert(button.bounds.width>=44&&button.bounds.height>=40);
    observations.push({id,visibleCopy,images:images.map(node=>({id:node.id,type:node.type,bounds:node.bounds})),buttons:buttons.map(node=>node.id)});
    await page.screenshot({path:resolve(output,id+'.png'),fullPage:true});pass('visible-image-and-button-geometry-'+id);
    const before=await page.evaluate(()=>window.imageSlotReview.events().length);
    if(variant!=='text'){await clickNode(id,'.portrait0.control');assert.equal(await page.evaluate(()=>window.imageSlotReview.events().length),before);pass('static-image-has-no-action-'+id);}
    await clickNode(id,'.choose0.control');assert.equal(await page.evaluate(()=>window.imageSlotReview.events().length),before+1);assert.equal(await page.locator('#status').textContent(),'已选择战士');pass('choice-button-emits-once-'+id);
    if(variant!=='text'){
      const download=page.waitForEvent('download');await page.locator('#download').click();const actual=await download,path=resolve(output,id+'.zip');await actual.saveAs(path);
      const bytes=await readFile(path),entry=acceptance.artifacts.find(artifact=>artifact.id===id);assert.equal(bytes.length,entry.zipBytes);assert.equal(await digestBytes(bytes),entry.zipSha256);
      const files=readStoredZip(bytes),bundle=JSON.parse(files.get('pixi/panel.bundle.json').toString('utf8'));assert.equal(bundle.sha256,entry.panelSha256);
      const manifest=JSON.parse(files.get('delivery-manifest.json').toString('utf8'));
      for(const file of manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
      for(const [file,contents] of files){const target=resolve(output,'downloaded',id,file);await mkdir(dirname(target),{recursive:true});await writeFile(target,contents,{flag:'wx'});}
      pass('actual-download-zip-bytes-and-every-file-sha256-'+id);
    }
  }
  await page.setViewportSize({width:390,height:760});
  for(const mode of ['light','dark'])for(const variant of ['slots','bound']){
    await select(variant,mode);const box=await page.locator(`#${variant}-${mode} canvas`).boundingBox();assert(box.x>=0&&box.x+box.width<=390.1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));pass('390px-contained-preview-'+variant+'-'+mode);
  }
  await page.setViewportSize({width:1280,height:1000});
  for(const id of ['slots-light','slots-dark','bound-light','bound-dark']){
    await page.goto(pathToFileURL(resolve(output,'downloaded',id,'pixi/index.html')).href);
    await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');
    const actual=await page.evaluate(()=>({sha256:window.panelDelivery.bundle.sha256,nodes:window.panelDelivery.inspect().nodes,events:window.panelDelivery.events()}));
    assert.equal(actual.sha256,acceptance.artifacts.find(artifact=>artifact.id===id).panelSha256);assert.equal(actual.events.length,0);
    assert.equal(actual.nodes.filter(node=>node.id.includes('.portrait')&&node.id.endsWith('.control')).length,3);
    await page.keyboard.press('Tab');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.panelDelivery.events().length===1);
    assert.equal(await page.evaluate(()=>window.panelDelivery.events()[0].event.name),'panel.choose0');
    await page.reload();await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');assert.equal(await page.evaluate(()=>window.panelDelivery.events().length),0);
    pass('actual-downloaded-offline-zip-keyboard-and-reopen-'+id);
  }
  assert.deepEqual(errors,[]);pass('no-browser-errors-or-network');
  report={status:'PASS',browser:browser.version(),checks,observations,errors,realModelCalls:0,imageGenerationCalls:0,unityNative:'NOT_RUN',consumerWebAcceptance:'NOT_RUN',humanVisualApproval:'NOT_RUN'};
}catch(error){report={status:'FAIL',checks,observations,errors,message:String(error.message),realModelCalls:0,unityNative:'NOT_RUN'};if(page)await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();await writeNewJson(output,'browser-report.json',report);console.log(JSON.stringify({status:report.status,checks:checks.length,errors,message:report.message,realModelCalls:0}));}
