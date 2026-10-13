#!/usr/bin/env node
/** Actual glyph geometry, interaction and downloaded offline delivery. No model calls. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--review'&&args[2]==='--output','CARD_BROWSER_ARGUMENTS');
const input=resolve(args[1]),output=await createOutputDirectory(args[3]),acceptance=JSON.parse(await readFile(resolve(input,'acceptance.json'),'utf8'));
assert.equal(acceptance.status,'PASS');
const bundles=Object.fromEntries(await Promise.all(acceptance.artifacts.map(async item=>[item.id,JSON.parse(await readFile(resolve(input,item.id+'.panel.bundle.json'),'utf8'))])));
const {chromium}=await loadWorkspaceTool('@playwright/test'),checks=[],errors=[],observations=[];
let browser,page,report;
const pass=name=>checks.push({name,status:'PASS'}),center=b=>b.x+b.width/2;
async function select(kind,mode,variant){
  for(const [key,value]of Object.entries({kind,mode,variant}))await page.locator(`[data-${key}="${value}"]`).click();
  const id=`${kind}-${mode}-${variant}`;await page.waitForFunction(id=>document.documentElement.dataset.active===id,id);return id;
}
const inspect=id=>page.evaluate(id=>window.cardAlignmentReview.get(id).inspect(),id);
function cardGeometry(nodes,bundle,centered){
  const found=[];
  for(const section of bundle.spec.sections){
    const image=section.rows.find(row=>row.kind==='image'),button=section.rows.find(row=>row.kind==='button');
    const prefix=bundle.spec.id,plate=nodes.find(node=>node.id===`${prefix}.row.${image.id}.control`);
    for(const id of [`${prefix}.section.${section.id}.title`,`${plate.id}.placeholder`,`${prefix}.row.${button.id}.control.center-label`]){
      const node=nodes.find(node=>node.id===id),glyph=node?.renderedTextBounds?.[0];assert(glyph,`missing glyph: ${id}`);
      assert(!glyph.implicitTruncation,`truncated: ${id}`);
      const offset=center(glyph.bounds)-center(plate.bounds),isButton=id.endsWith('.center-label');
      if(centered||isButton)assert(Math.abs(offset)<1,`${id}: center offset ${offset}`);
      else assert(offset < -20,`${id}: old layout must stay left`);
      found.push({id,text:glyph.text,centerOffset:offset});
    }
  }
  return found;
}
async function clickNode(id,nodeId){
  const node=(await inspect(id)).nodes.find(node=>node.id===nodeId);assert(node);
  const box=await page.locator(`#${id} canvas`).boundingBox(),scale=box.width/bundles[id].spec.canvas.width;
  await page.mouse.click(box.x+center(node.bounds)*scale,box.y+(node.bounds.y+node.bounds.height/2)*scale);
}
async function focusNode(id,nodeId){
  const canvas=page.locator(`#${id} canvas`);await canvas.scrollIntoViewIfNeeded();await canvas.focus();
  for(let count=0;count<24;count++){if(await canvas.getAttribute('data-focused-component')===nodeId)return;await page.keyboard.press('Tab');}
  throw Error('UNREACHABLE_KEYBOARD_FOCUS:'+nodeId);
}
try{
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  page=await browser.newPage({viewport:{width:1280,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',async route=>{if(['file:','data:','blob:'].includes(new URL(route.request().url()).protocol))await route.continue();else{errors.push('UNEXPECTED_NETWORK');await route.abort();}});
  await page.goto(pathToFileURL(resolve(input,'index.html')).href);await page.waitForFunction(()=>document.documentElement.dataset.ready);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');assert.deepEqual(await page.evaluate(()=>window.cardAlignmentReview.errors()),[]);pass('all-eight-real-pixi-instances-mount');
  for(const mode of ['light','dark'])for(const variant of ['before','after']){
    const id=await select('roles',mode,variant),bundle=bundles[id],actual=await inspect(id);
    observations.push({id,geometry:cardGeometry(actual.nodes,bundle,variant==='after')});
    const copy=actual.nodes.filter(node=>node.visible).flatMap(node=>node.renderedTextBounds?.map(text=>text.text)??[]);
    for(const name of ['战士','魔法师','弓箭手'])assert.equal(copy.filter(text=>text===name).length,1);
    pass('actual-card-glyph-alignment-and-single-name-'+id);await page.screenshot({path:resolve(output,id+'.png'),fullPage:true});
    const before=await page.evaluate(()=>window.cardAlignmentReview.events().length);
    await clickNode(id,`${bundle.spec.id}.row.${bundle.spec.sections[0].rows[0].id}.control`);
    assert.equal(await page.evaluate(()=>window.cardAlignmentReview.events().length),before);pass('static-image-has-no-action-'+id);
    for(const [i,section]of bundle.spec.sections.entries()){
      const row=section.rows.find(row=>row.kind==='button');await clickNode(id,`${bundle.spec.id}.row.${row.id}.control`);
      const events=await page.evaluate(()=>window.cardAlignmentReview.events());assert.equal(events.length,before+i+1);assert.equal(events.at(-1).event.name,row.event);
      assert.deepEqual(await page.evaluate(id=>window.cardAlignmentReview.get(id).getState(),id),bundle.state);
    }
    cardGeometry((await inspect(id)).nodes,bundle,variant==='after');pass('three-choices-emit-once-with-stable-text-alignment-'+id);
    if(variant==='after'){
      await page.evaluate(async id=>{const instance=window.cardAlignmentReview.get(id);instance.close();await instance.open();},id);
      cardGeometry((await inspect(id)).nodes,bundle,true);pass('host-close-reopen-keeps-center-'+id);
      const download=page.waitForEvent('download');await page.locator('#download').click();const actual=await download,path=resolve(output,id+'.zip');await actual.saveAs(path);
      const bytes=await readFile(path),item=acceptance.artifacts.find(item=>item.id===id);assert.equal(bytes.length,item.zipBytes);assert.equal(await digestBytes(bytes),item.zipSha256);
      const files=readStoredZip(bytes),manifest=JSON.parse(files.get('delivery-manifest.json'));
      for(const file of manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
      for(const [file,contents]of files){assert(!file.split('/').some(part=>!part||part==='.'||part==='..'),'ZIP_PATH');const target=resolve(output,'downloaded',id,file);assert(target.startsWith(resolve(output,'downloaded',id)+'/')||target.startsWith(resolve(output,'downloaded',id)+'\\'));await mkdir(dirname(target),{recursive:true});await writeFile(target,contents,{flag:'wx'});}
      pass('actual-download-byte-count-sha256-and-every-file-'+id);
    }
  }
  for(const mode of ['light','dark']){
    const before=await select('audio',mode,'before'),old=(await inspect(before)).nodes;
    const after=await select('audio',mode,'after'),nodes=(await inspect(after)).nodes,bundle=bundles[after];
    for(const row of bundle.spec.sections[0].rows.filter(row=>['slider','switch'].includes(row.kind))){
      const id=`${bundle.spec.id}.row.${row.id}.label`,a=old.find(node=>node.id===id),b=nodes.find(node=>node.id===id);
      assert(a&&b);assert.deepEqual(b.renderedTextBounds,a.renderedTextBounds);
    }
    pass('setting-label-glyphs-stay-identical-and-left-'+mode);
    const slider=bundle.spec.sections[0].rows[0];await focusNode(after,`${bundle.spec.id}.row.${slider.id}.control`);await page.keyboard.press('End');
    assert.equal((await page.evaluate(id=>window.cardAlignmentReview.get(id).getState(),after))[slider.bind],100);
    const toggle=bundle.spec.sections[0].rows.find(row=>row.kind==='switch');await clickNode(after,`${bundle.spec.id}.row.${toggle.id}.control`);
    assert.equal((await page.evaluate(id=>window.cardAlignmentReview.get(id).getState(),after))[toggle.bind],true);
    pass('settings-slider-keyboard-and-switch-interaction-'+mode);await page.screenshot({path:resolve(output,after+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:390,height:760});
  for(const mode of ['light','dark']){const id=await select('roles',mode,'after'),box=await page.locator(`#${id} canvas`).boundingBox();assert(box.x>=0&&box.x+box.width<=390.1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));cardGeometry((await inspect(id)).nodes,bundles[id],true);pass('390px-preview-contained-and-centered-'+mode);}
  await page.setViewportSize({width:1280,height:1000});
  for(const mode of ['light','dark']){
    const id=`roles-${mode}-after`,bundle=bundles[id];await page.goto(pathToFileURL(resolve(output,'downloaded',id,'pixi/index.html')).href);await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');
    const actual=await page.evaluate(()=>({sha256:window.panelDelivery.bundle.sha256,nodes:window.panelDelivery.inspect().nodes,events:window.panelDelivery.events()}));assert.equal(actual.sha256,bundle.sha256);assert.equal(actual.events.length,0);cardGeometry(actual.nodes,bundle,true);
    await page.keyboard.press('Tab');await page.keyboard.press('Enter');await page.waitForFunction(()=>window.panelDelivery.events().length===1);assert.equal(await page.evaluate(()=>window.panelDelivery.events()[0].event.name),bundle.spec.sections[0].rows.find(row=>row.kind==='button').event);
    await page.reload();await page.waitForFunction(()=>document.getElementById('status')?.dataset.state==='ready');cardGeometry(await page.evaluate(()=>window.panelDelivery.inspect().nodes),bundle,true);assert.equal(await page.evaluate(()=>window.panelDelivery.events().length),0);pass('actual-offline-zip-centered-keyboard-and-reload-'+mode);
  }
  assert.deepEqual(errors,[]);pass('no-browser-errors-or-network');report={status:'PASS',browser:browser.version(),checks,observations,errors,realModelCalls:0,unityNative:'NOT_RUN',consumerWebAcceptance:'NOT_RUN',humanVisualApproval:'NOT_RUN'};
}catch(error){report={status:'FAIL',checks,observations,errors,message:String(error.stack),realModelCalls:0,unityNative:'NOT_RUN'};if(page)await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();await writeNewJson(output,'browser-report.json',report);console.log(JSON.stringify({status:report.status,checks:checks.length,errors,message:report.message,realModelCalls:0}));}
