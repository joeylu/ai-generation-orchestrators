#!/usr/bin/env node
/** Actual Pixi controls and actual offline downloads; fixture input only, no model transport. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {controlId} from '../src/compiler.mjs';
import {formErrorId} from '../src/forms.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--review'&&args[2]==='--output','SAMPLE_BROWSER_ARGUMENTS');
const input=resolve(args[1]),output=await createOutputDirectory(args[3]),acceptance=await readJson(resolve(input,'acceptance.json'));
assert.equal(acceptance.status,'PASS');const core=await loadWorkspaceCore(),{chromium}=await loadWorkspaceTool('@playwright/test');
const bundles=new Map(await Promise.all(acceptance.artifacts.map(async artifact=>[artifact.id,await readJson(resolve(input,artifact.id+'.panel.bundle.json'))])));
const checks=[],errors=[],observations=[],screenshots=[],pass=name=>checks.push({name,status:'PASS'});
let browser,page,phase='open',report;
const inspect=id=>page.evaluate(id=>window.panelSamples.get(id).inspect(),id),state=id=>page.evaluate(id=>window.panelSamples.get(id).getState(),id);
const events=id=>page.evaluate(id=>window.panelSamples.events().filter(envelope=>envelope.instanceId===id),id);
async function select(id){const index=id.lastIndexOf('-');await page.locator(`[data-option="${id.slice(0,index)}"]`).click();await page.locator(`[data-mode="${id.slice(index+1)}"]`).click();await page.waitForFunction(id=>document.documentElement.dataset.active===id,id);}
async function click(id,nodeId,fraction=.5){
  const canvas=page.locator(`#${id} canvas`);await canvas.scrollIntoViewIfNeeded();
  const node=(await inspect(id)).nodes.find(node=>node.id===nodeId);assert(node?.visible,`Invisible or missing ${nodeId}`);
  const box=await canvas.boundingBox(),scale=box.width/bundles.get(id).spec.canvas.width;
  await page.mouse.click(box.x+(node.bounds.x+node.bounds.width*fraction)*scale,box.y+(node.bounds.y+node.bounds.height/2)*scale);
}
async function focus(id,nodeId){
  const canvas=page.locator(`#${id} canvas`);await canvas.scrollIntoViewIfNeeded();await canvas.focus();
  for(let count=0;count<24;count++){if(await canvas.getAttribute('data-focused-component')===nodeId)return;await page.keyboard.press('Tab');}
  throw Error('UNREACHABLE_KEYBOARD_FOCUS:'+nodeId);
}
async function type(id,rowId,value){const nodeId=controlId(bundles.get(id).spec.id,rowId);await focus(id,nodeId);await click(id,nodeId);await page.keyboard.press('Control+A');await page.keyboard.insertText(value);}
async function choosePage(id,index){
  const bundle=bundles.get(id),tabs=(await inspect(id)).nodes.find(node=>node.type==='Tabs');
  await focus(id,tabs.id);await page.keyboard.press(index===0?'Home':'End');assert.equal((await state(id))[bundle.spec.tabs.bind],bundle.spec.tabs.pages[index].id);
}
async function focusedControlFitsViewport(id,nodeId){
  const nodes=(await inspect(id)).nodes,control=nodes.find(node=>node.id===nodeId),viewport=nodes.find(node=>node.type==='ScrollView'&&node.visible);
  assert(control?.visible&&viewport,`${id}: focused control and viewport required`);
  assert(control.bounds.y>=viewport.bounds.y-1&&control.bounds.y+control.bounds.height<=viewport.bounds.y+viewport.bounds.height+1,`${id}: focused ${nodeId} is clipped`);
}
async function exercise(id){
  const bundle=bundles.get(id),spec=bundle.spec,cid=row=>controlId(spec.id,row),kind=id.split('-')[0];
  await page.locator('#reset').click();assert.deepEqual(await state(id),bundle.state);
  if(kind==='audio'){
    await click(id,cid('row0'),.01);assert.equal((await state(id)).row0,0);
    await click(id,cid('row0'),.99);assert.equal((await state(id)).row0,100);
    await click(id,cid('row2'));assert.equal((await state(id)).row2,true);
    await focus(id,cid('row3'));await page.keyboard.press('Enter');assert.deepEqual(await state(id),bundle.state);
    const before=(await events(id)).length;await focus(id,cid('row4'));await page.keyboard.press('Enter');
    assert.equal((await events(id)).length,before+1);assert.equal((await events(id)).at(-1).event.action,'emit');
  }else if(kind==='form'){
    assert.equal((await inspect(id)).nodes.find(node=>node.id===cid('row3')).enabled,false);
    await type(id,'row1','蓝');assert.equal((await state(id)).row1,'蓝');
    assert.equal((await inspect(id)).nodes.find(node=>node.id===formErrorId(spec.id,'row1','min-length')).visible,true);
    assert.equal((await inspect(id)).nodes.find(node=>node.id===cid('row3')).enabled,false);
    await type(id,'row1','小蓝莓');await focus(id,cid('row3'));await page.keyboard.press('Enter');
    assert.deepEqual((await events(id)).at(-1).event.values,{row1:'小蓝莓'});assert((await page.locator('#status').textContent()).includes('小蓝莓'));
    const other='form-'+(id.endsWith('dark')?'light':'dark');await select(other);await select(id);assert.equal((await state(id)).row1,'小蓝莓');
  }else if(kind==='roles'){
    const names=['战士','魔法师','弓箭手'];
    for(let index=0;index<3;index++){
      const before=(await events(id)).length;await click(id,cid('row'+index*2));assert.equal((await events(id)).length,before);
      await click(id,cid('row'+(index*2+1)));assert.equal((await events(id)).length,before+1);
      assert.equal((await events(id)).at(-1).event.name,'panel.row'+(index*2+1));assert.equal(await page.locator('#status').textContent(),'已选择'+names[index]);
    }
  }else if(kind==='progress'){
    const before=(await events(id)).length;await click(id,cid('row1'));assert.equal((await events(id)).length,before);
    for(const value of [100,0,57]){await page.locator('#advance').click();assert.equal((await state(id)).row1,value);}
    assert.equal((await events(id)).length,before);
    assert((await inspect(id)).nodes.find(node=>node.id===`${spec.id}.row.row1.value`).renderedTextBounds.some(text=>text.text==='57%'));
    await focus(id,cid('row2'));await page.keyboard.press('Enter');assert.equal((await events(id)).at(-1).event.action,'emit');
  }else if(kind==='tabs'){
    await type(id,'row1','新角色');await focus(id,cid('row2'));await page.keyboard.press('End');await page.keyboard.press('Escape');assert.equal((await state(id)).row2,'option1');
    await focus(id,cid('row4'));await focusedControlFitsViewport(id,cid('row4'));await page.keyboard.press('Enter');assert.deepEqual((await events(id)).at(-1).event.values,{row1:'新角色'});
    await page.screenshot({path:resolve(output,id+'-role-complete.png'),fullPage:true});screenshots.push(id+'-role-complete.png');
    await choosePage(id,1);assert.equal((await inspect(id)).nodes.find(node=>node.id===cid('row1')).visible,false);
    await focus(id,cid('row5'));await page.keyboard.press('End');assert.equal((await state(id)).row5,100);
    await focus(id,cid('row6'));await page.keyboard.press(' ');assert.equal((await state(id)).row6,true);
    await page.locator('#advance').click();assert.equal((await state(id)).row7,100);
    await focus(id,cid('row8'));await focusedControlFitsViewport(id,cid('row8'));
    const beforeSave=(await events(id)).length;await click(id,cid('row8'));assert.equal((await events(id)).length,beforeSave+1);assert.equal((await events(id)).at(-1).event.rowId,'row8');
    await page.screenshot({path:resolve(output,id+'-preferences.png'),fullPage:true});screenshots.push(id+'-preferences.png');
    await choosePage(id,0);assert.equal((await state(id)).row1,'新角色');assert.equal((await state(id)).row2,'option1');
    await choosePage(id,1);assert.equal((await state(id)).row5,100);assert.equal((await state(id)).row6,true);await choosePage(id,0);
  }
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:1080},acceptDownloads:true,reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',async route=>{if(['file:','data:','blob:'].includes(new URL(route.request().url()).protocol))await route.continue();else{errors.push('UNEXPECTED_NETWORK');await route.abort();}});
  context.on('page',target=>{target.on('pageerror',error=>errors.push(error.message));target.on('console',message=>{if(message.type()==='error')errors.push(message.text());});});
  page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(pathToFileURL(resolve(input,'index.html')).href);
  await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
  assert.deepEqual(await page.evaluate(()=>window.panelSamples.errors()),[]);pass('ten-actual-pixi-fixtures-mount-without-model-transport');
  for(const artifact of acceptance.artifacts){
    const id=artifact.id;phase=id+'-visual';await select(id);await page.locator('#reset').click();
    const nodes=(await inspect(id)).nodes.filter(node=>node.visible),texts=nodes.filter(node=>node.type==='Text').flatMap(node=>node.renderedTextBounds??[]);
    assert(texts.length>0);for(const node of nodes)for(const text of node.renderedTextBounds??[])assert(!text.implicitTruncation,`${id}: ${node.id} text truncated`);
    // These are Pixi desktop control contracts, not native mobile touch acceptance.
    for(const node of nodes.filter(node=>['Button','Input','Select','Slider'].includes(node.type)))assert(node.bounds.width>=44&&node.bounds.height>=(node.type==='Button'?44:40),`${id}: ${node.id} desktop control geometry`);
    if(id.startsWith('roles'))for(const name of ['战士','魔法师','弓箭手'])assert.equal(texts.filter(text=>text.text.includes(name)).length,1);
    observations.push({id,initialState:await state(id),visibleCopy:texts.map(text=>text.text)});
    await page.screenshot({path:resolve(output,id+'.png'),fullPage:true});screenshots.push(id+'.png');pass('desktop-visible-copy-and-control-geometry-'+id);
    phase=id+'-interaction';await exercise(id);pass('actual-pointer-keyboard-validation-and-state-'+id);
    const exported=await page.evaluate(id=>window.panelSamples.get(id).exportBundle(),id);await validatePanelBundle(exported,core);assert.deepEqual(exported.state,await state(id));
    const model=await createWorkbenchModel({catalog:exported.catalog,pool:null},core);
    try{await model.importPanel(exported);assert.deepEqual(await model.exportPanel(),exported);}finally{model.dispose();}
    pass('live-state-export-and-library-free-reimport-'+id);
    if(id.endsWith('dark')){
      phase=id+'-download';const pending=page.waitForEvent('download');await page.locator('#download').click();const download=await pending,path=resolve(output,id+'.zip');await download.saveAs(path);
      const bytes=await readFile(path);assert.equal(bytes.length,artifact.zipBytes);assert.equal(await digestBytes(bytes),artifact.zipSha256);
      const files=readStoredZip(bytes),manifest=JSON.parse(files.get('delivery-manifest.json').toString('utf8'));
      for(const file of manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
      assert.equal(JSON.parse(files.get('pixi/panel.bundle.json').toString('utf8')).sha256,artifact.panelSha256);
      for(const [name,contents]of files){const target=resolve(output,'downloaded',id,name),rel=relative(resolve(output,'downloaded',id),target);assert(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../'));await mkdir(dirname(target),{recursive:true});await writeFile(target,contents,{flag:'wx'});}
      pass('actual-download-zip-and-every-file-bytes-sha256-'+id);
    }
  }
  for(const viewport of [{width:375,height:812},{width:812,height:375}]){
    await page.setViewportSize(viewport);
    for(const artifact of acceptance.artifacts){phase=artifact.id+'-contained-'+viewport.width;await select(artifact.id);const box=await page.locator(`#${artifact.id} canvas`).boundingBox();assert(box.x>=0&&box.x+box.width<=viewport.width+1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.screenshot({path:resolve(output,'contained-'+viewport.width+'.png'),fullPage:true});screenshots.push('contained-'+viewport.width+'.png');pass('all-ten-previews-and-toolbar-contained-'+viewport.width);
  }
  for(const artifact of acceptance.artifacts.filter(artifact=>artifact.id.endsWith('dark'))){
    phase=artifact.id+'-offline';await page.setViewportSize({width:1280,height:1080});
    await page.goto(pathToFileURL(resolve(output,'downloaded',artifact.id,'pixi/index.html')).href);await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');
    assert.equal(await page.evaluate(()=>window.panelDelivery.bundle.sha256),artifact.panelSha256);
    assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),bundles.get(artifact.id).state);
    await page.reload();await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');assert.equal(await page.evaluate(()=>window.panelDelivery.events().length),0);
    pass('actual-downloaded-offline-reopen-'+artifact.id);
  }
  assert.deepEqual(errors,[]);pass('no-browser-errors-or-network');
  report={status:'PASS',browser:browser.version(),checks,observations,screenshots,errors,realModelCalls:0,imageGenerationCalls:0,reducedMotion:'reduce',smallViewportCheck:'CONTAINMENT_ONLY_NOT_REFLOW_OR_TOUCH_ACCEPTANCE',humanVisualApproval:'NOT_RUN',unityNative:'NOT_RUN',consumerWebAcceptance:'NOT_RUN'};
}catch(error){report={status:'FAIL',phase,checks,observations,screenshots,errors,message:error.message,realModelCalls:0,unityNative:'NOT_RUN'};await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();await writeNewJson(output,'browser-report.json',report);console.log(JSON.stringify({status:report.status,checks:checks.length,phase:report.phase,message:report.message,errors,realModelCalls:0}));}
