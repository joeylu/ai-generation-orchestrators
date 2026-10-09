#!/usr/bin/env node
/** Three authored options, six real Pixi instances. No inference or Studio migration. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {audioArtOption,AUDIO_ART_OPTIONS} from '../examples/crafted-audio-v1/options.mjs';
import {canonicalJson,digestBytes} from '../src/canonical.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';

assert(process.argv.length===6&&process.argv[2]==='--source'&&process.argv[4]==='--output');
const source=resolve(process.argv[3]),output=await createOutputDirectory(process.argv[5]);
const core=await loadWorkspaceCore(),panels={},checks=[],references=[];
const report={status:'FAIL',phase:'build',sourceKind:'PROGRAMMATIC_FIXTURE',checks,modelCalls:0,imageGenerationCalls:0,
  userFeedback:{a:'IMPROVED_NOT_FINAL',b:'NOT_RUN',c:'NOT_RUN'},nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN'};
let browser,page;
try{
  const sourceReport=await readJson(resolve(source,'review-report.json'));assert.equal(sourceReport.status,'PASS');assert.equal(sourceReport.modelCalls,0);
  const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources();
  for(const mode of ['dark','light']){
    const bytes=await readFile(resolve(source,`after-${mode}.panel.bundle.json`)),a=await validatePanelBundle(JSON.parse(bytes),core);
    assert.equal(a.catalog.id,'crafted-audio-study');assert.equal(a.compilerVersion,'0.20.0');
    for(const {id} of AUDIO_ART_OPTIONS){
      const option=id==='a'?null:audioArtOption(a,id);
      const bundle=option?await createPanelBundle(option.spec,option.catalog,core,a.state,panelBundleAssetInputs(a,core)):a;
      await validatePanelBundle(bundle,core);
      for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(bundle[key],a[key]);
      assert.deepEqual(bundle.spec.sections.flatMap(section=>section.rows),a.spec.sections.flatMap(section=>section.rows));
      const panelId=`${id}-${mode}`;panels[panelId]=bundle;
      if(id==='a')await writeFile(resolve(output,`${panelId}.panel.bundle.json`),bytes,{flag:'wx'});
      else await writeNewJson(output,`${panelId}.panel.bundle.json`,bundle);
      const kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
      await writeFile(resolve(output,`${panelId}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
      references.push({id:panelId,sourceSha256:await digestBytes(bytes),bundleSha256:bundle.sha256,
        ...(id==='a'?{exactSourceBytes:await digestBytes(await readFile(resolve(output,`${panelId}.panel.bundle.json`)))===await digestBytes(bytes)}:{})});
      checks.push(`${panelId}: strict bundle, original business rows/state/assets preserved`);
    }
  }
  const {build}=await loadWorkspaceTool('vite');
  const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
    lib:{entry:resolve(harnessRoot,'examples/crafted-audio-v1/options-review.mjs'),name:'AudioArtOptions',formats:['iife'],fileName:()=> 'review.js'}}});
  const chunks=(Array.isArray(built)?built:[built]).flatMap(result=>result.output);assert.equal(chunks.length,1);
  await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
  const choices=AUDIO_ART_OPTIONS.map(option=>`<button type="button" data-option="${option.id}" aria-pressed="false">${option.label}</button>`).join('');
  const cards=Object.keys(panels).map(id=>`<section data-panel="${id}" aria-label="${AUDIO_ART_OPTIONS.find(option=>option.id===id[0]).label} · ${id.endsWith('dark')?'深色':'浅色'}" hidden><div class="stage" id="stage-${id}"><div class="canvas" id="${id}"></div></div><div class="delivery"><a href="${id}.zip" download id="download-${id}">下载此面板</a></div></section>`).join('');
  await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>声音设置 · 三种方案</title><style>*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#11171C;color:#F1F5F5;font:15px/1.65 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1000px;margin:auto;padding:36px 28px}h1{font-size:26px;font-weight:500;margin:0}p{color:#B5C0C5;margin:8px 0 24px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}.choices,.modes{display:flex;flex-wrap:wrap;gap:6px}button{font:inherit;font-size:14px;color:#BEC9CD;background:transparent;border:1px solid #46555D;border-radius:8px;padding:9px 14px;cursor:pointer}button:hover{background:#27343C}button[aria-pressed=true]{background:#D5E7E0;color:#173B32;border-color:#D5E7E0}button:focus-visible,a:focus-visible{outline:2px solid #9DE0CC;outline-offset:4px}#description{margin:20px 0 12px;min-height:25px}.stage{min-width:0;padding-bottom:1px;background:#0D1216;border-radius:16px;overflow:hidden}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}.delivery{display:flex;justify-content:flex-end;margin-top:12px}a{font-size:14px;color:#9DE0CC;text-decoration:none}footer{font-size:13px;color:#B5C0C5;margin-top:20px}footer p{font-size:12px;margin:8px 0 0}@media(max-width:600px){main{padding:24px 16px}h1{font-size:23px}.toolbar{gap:12px}button{padding:8px 11px;font-size:13px}#description{min-height:50px}}</style><main><h1>声音设置 · 三种方案</h1><p>相同的控件与行为，比较比例、排版和色调。可以直接试玩。</p><div class="toolbar"><div class="choices" role="group" aria-label="视觉方案">${choices}</div><div class="modes" role="group" aria-label="颜色模式"><button type="button" data-mode="dark" aria-pressed="false">深色</button><button type="button" data-mode="light" aria-pressed="false">浅色</button></div></div><p id="description"></p>${cards}<footer><span id="status" role="status">可调整音量、切换静音、恢复默认与触发按钮</span><p>本地试稿，尚未设为默认主题。切换方案会保留各自的试玩值。</p></footer></main><script id="panels" type="application/json">${canonicalJson(panels).replaceAll('<','\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
  const {chromium}=await loadWorkspaceTool('@playwright/test');
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],requests=[];page=await browser.newPage({viewport:{width:1200,height:1000},acceptDownloads:true});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  report.phase='render';await page.goto(pathToFileURL(resolve(output,'index.html')).href);
  await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
  assert.equal(await page.locator('canvas').count(),6);
  const select=async id=>{
    const [option,mode]=id.split('-');await page.locator(`[data-option="${option}"]`).click();await page.locator(`[data-mode="${mode}"]`).click();
    await page.waitForFunction(id=>{
      if(document.documentElement.dataset.active!==id)return false;
      const stage=document.getElementById(`stage-${id}`).getBoundingClientRect(),canvas=document.querySelector(`#${id} canvas`).getBoundingClientRect();
      return canvas.width>0&&canvas.width<=stage.width+.1&&canvas.height<=stage.height+.1;
    },id);
  };
  const click=async(id,row,fraction=.5)=>{
    await page.locator(`#${id} canvas`).scrollIntoViewIfNeeded();
    const node=(await page.evaluate(id=>window.audioArtReview.get(id).inspect(),id)).nodes.find(node=>node.id===`usage-settings.row.${row}.control`);
    const box=await page.locator(`#${id} canvas`).boundingBox(),factor=box.width/panels[id].spec.canvas.width;
    await page.mouse.click(box.x+(node.bounds.x+node.bounds.width*fraction)*factor,box.y+(node.bounds.y+node.bounds.height/2)*factor);
  };
  for(const id of Object.keys(panels)){
    report.phase=`${id}-interaction`;await select(id);
    const inspect=await page.evaluate(id=>window.audioArtReview.get(id).inspect(),id);
    assert(inspect.nodes.filter(node=>node.visible).every(node=>!(node.renderedTextBounds??[]).some(text=>text.implicitTruncation)));
    await page.locator(`#stage-${id}`).screenshot({path:resolve(output,`${id}.png`)});
    await page.screenshot({path:resolve(output,`${id}-page.png`),fullPage:true});
    const initial=panels[id].state;
    await click(id,'volume-row',.3);const played=await page.evaluate(id=>window.audioArtReview.get(id).getState(),id);assert.notEqual(played.volume,initial.volume);
    await click(id,'music-row',.6);assert.notEqual((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id)).music,initial.music);
    await click(id,'mute-row');assert.equal((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id)).muted,!initial.muted);
    await click(id,'save');await click(id,'close');
    const events=await page.evaluate(id=>window.audioArtReview.events().filter(event=>event.instanceId===id),id);
    for(const name of ['audio.volumeChanged','audio.musicChanged','audio.muteChanged','settings.save','settings.close'])assert(events.some(event=>event.event.name===name));
    const exported=await page.evaluate(id=>window.audioArtReview.get(id).exportBundle(),id);await validatePanelBundle(exported,core);
    await select(id.startsWith('a')?`b-${id.split('-')[1]}`:`a-${id.split('-')[1]}`);
    await select(id);assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id),exported.state);
    await click(id,'reset-row');assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id),initial);
    assert((await page.evaluate(()=>window.audioArtReview.events())).some(event=>event.instanceId===id&&event.event.name==='settings.resetRequested'));
    checks.push(`${id}: two sliders, switch, actions, preserved state across option switch, library-free export`);
    report.phase=`${id}-download`;
    const downloadPromise=page.waitForEvent('download');await page.locator(`#download-${id}`).click();const download=await downloadPromise;
    const downloaded=resolve(output,`downloaded-${id}.zip`);await download.saveAs(downloaded);
    const zip=readStoredZip(await readFile(downloaded)),manifest=JSON.parse(new TextDecoder().decode(zip.get('delivery-manifest.json')));
    for(const file of manifest.files){assert.equal(zip.get(file.path).length,file.bytes);assert.equal(await digestBytes(zip.get(file.path)),file.sha256);}
    const reopened=await validatePanelBundle(JSON.parse(new TextDecoder().decode(zip.get('pixi/panel.bundle.json'))),core);assert.equal(reopened.sha256,panels[id].sha256);
    const offline=resolve(output,`offline-${id}`);
    for(const [path,bytes] of zip){const file=resolve(offline,path);assert(file.startsWith(offline+'/')||file.startsWith(offline+'\\'));await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
    const offlinePage=await browser.newPage();offlinePage.on('pageerror',error=>errors.push(error.message));offlinePage.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    await offlinePage.goto(pathToFileURL(resolve(offline,'pixi/index.html')).href);await offlinePage.waitForFunction(()=>document.querySelector('canvas')?.width>1);
    assert.equal(await offlinePage.locator('canvas').count(),1);await offlinePage.close();checks.push(`${id}: actual download ZIP CRC/checksums, reimport, offline Pixi open`);
  }
  report.phase='isolation';
  for(const [id,bundle] of Object.entries(panels))assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id),bundle.state);
  checks.push('six independent instance states and reset scopes');
  report.phase='narrow';await page.setViewportSize({width:390,height:844});
  for(const id of Object.keys(panels)){
    await select(id);await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
    await page.screenshot({path:resolve(output,`${id}-narrow.png`),fullPage:true});checks.push(`${id}: 390px canvas containment and option navigation`);
  }
  await page.setViewportSize({width:1200,height:1000});await select('a-dark');
  assert.deepEqual(await page.evaluate(()=>window.audioArtReview.errors()),[]);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  report.status='PASS';report.phase='complete';report.references=references;report.browserErrors=errors;report.externalRequests=requests.length;
  report.sourceFingerprints=[];
  for(const path of ['examples/crafted-audio-v1/options.mjs','examples/crafted-audio-v1/options-review.mjs','scripts/build-audio-art-options.mjs','src/compiler.mjs','src/crafted-presentation.mjs'])
    report.sourceFingerprints.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
}catch(error){
  report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;
}finally{
  await browser?.close();await writeNewJson(output,'review-report.json',report);
  process.stdout.write(JSON.stringify({status:report.status,phase:report.phase,checks:checks.length,failure:report.failure,modelCalls:0})+'\n');
}
