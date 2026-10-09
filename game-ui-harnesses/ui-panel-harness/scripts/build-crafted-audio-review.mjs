#!/usr/bin/env node
/** One authored audio panel, two modes, existing PanelBundle/Pixi/UGUI delivery. No inference. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
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
  humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',detector:'UNAVAILABLE_NOT_INSTALLED'};
let browser,page;
try{
  const sourceReport=await readJson(resolve(source,'asset-usage-browser-report.json'));
  assert.equal(sourceReport.status,'PASS');assert.equal(sourceReport.comparison,'minimal-v1');assert.equal(sourceReport.modelCalls,0);
  const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources();
  for(const mode of ['dark','light']){
    const bytes=await readFile(resolve(source,'sources',`settings-${mode}.after.panel.bundle.json`));
    const before=await validatePanelBundle(JSON.parse(bytes),core);assert.equal(before.compilerVersion,'0.19.0');
    const study=craftedAudioStudy(before),after=await createPanelBundle(study.spec,study.catalog,core,before.state,panelBundleAssetInputs(before,core));
    await validatePanelBundle(after,core);
    for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
    assert.deepEqual(after.spec.sections.flatMap(section=>section.rows),before.spec.sections.flatMap(section=>section.rows));
    panels[`before-${mode}`]=before;panels[`after-${mode}`]=after;
    for(const [side,bundle] of Object.entries({before,after}))await writeNewJson(output,`${side}-${mode}.panel.bundle.json`,bundle);
    references.push({mode,sourceSha256:await digestBytes(bytes),beforeBundle:before.sha256,afterBundle:after.sha256});
    const kit=await createUnityKitFiles(after,core,sources),delivery=await createPanelDelivery(after,core,{runtime,unityKit:kit});
    await writeFile(resolve(output,`audio-${mode}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
    checks.push(`${mode}: contract, business and source assets preserved`);
  }
  const {build}=await loadWorkspaceTool('vite');
  const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
    lib:{entry:resolve(harnessRoot,'examples/crafted-audio-v1/review.mjs'),name:'CraftedAudioReview',formats:['iife'],fileName:()=> 'review.js'}}});
  const chunks=(Array.isArray(built)?built:[built]).flatMap(result=>result.output);assert.equal(chunks.length,1);
  await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
  const cards=['dark','light'].map(mode=>`<section><h2>${mode==='dark'?'深色':'浅色'}</h2><div class="comparison">${['before','after'].map(side=>`<article><header><h3>${side==='before'?'上一版':'本次试稿'}</h3>${side==='after'?`<a href="audio-${mode}.zip" download id="download-${mode}">下载面板</a>`:''}</header><div class="stage ${mode}" id="stage-${side}-${mode}"><div class="canvas" id="${side}-${mode}"></div></div></article>`).join('')}</div></section>`).join('');
  await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>声音设置 · 视觉试稿</title><style>*{box-sizing:border-box}body{margin:0;background:#0C1015;color:#F2F6FA;font:15px/1.65 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1480px;margin:auto;padding:40px 28px}h1{font-size:28px;font-weight:500;margin:0}p{color:#AEB9C5;margin:8px 0 28px}section{margin:32px 0}h2{font-size:16px;font-weight:400;color:#AEB9C5;margin:0 0 12px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{display:flex;flex-direction:column;min-width:0;overflow:hidden;border-radius:16px;background:#151C24}header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px}h3{font-size:14px;font-weight:400;margin:0}a{color:#8FE2C3;text-decoration:none;font-size:13px}a:focus-visible{outline:2px solid #8FE2C3;outline-offset:4px}.stage{display:flex;align-items:center;flex:1;min-height:0;padding-bottom:1px}.stage.dark{background:#11161C}.stage.light{background:#E8EEF0}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}footer{color:#AEB9C5;font-size:12px}@media(max-width:800px){main{padding:24px 16px}.comparison{grid-template-columns:1fr;gap:16px}}</style><main><h1>声音设置 · 视觉试稿</h1><p>更紧凑的比例，清楚的文字层级，轻量操作区。两侧都可以试玩。</p>${cards}<footer><span id="status" role="status">可调整音量、切换静音、恢复默认与触发按钮</span><p>本页为程序夹具；真实模型调用 0 次。美术效果待评审，Unity 原生编辑器未验收。</p></footer></main><script id="panels" type="application/json">${canonicalJson(panels).replaceAll('<','\\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
  const {chromium}=await loadWorkspaceTool('@playwright/test');
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const errors=[],requests=[];page=await browser.newPage({viewport:{width:1600,height:1100},acceptDownloads:true});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  report.phase='initial-render';await page.goto(pathToFileURL(resolve(output,'index.html')).href);
  await page.waitForFunction(()=>document.documentElement.dataset.ready);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');assert.equal(await page.locator('canvas').count(),4);
  await page.screenshot({path:resolve(output,'comparison.png'),fullPage:true});
  for(const mode of ['dark','light'])await page.locator(`#stage-after-${mode}`).screenshot({path:resolve(output,`audio-${mode}.png`)});
  checks.push('four actual Pixi instances rendered');
  for(const mode of ['dark','light']){
    report.phase=`${mode}-interaction`;
    const id=`after-${mode}`,inspect=await page.evaluate(id=>window.audioArtReview.get(id).inspect(),id);
    assert(inspect.nodes.filter(node=>node.visible).every(node=>!(node.renderedTextBounds??[]).some(text=>text.implicitTruncation)));
    const click=async(row,fraction=.5)=>{
      await page.locator(`#${id} canvas`).scrollIntoViewIfNeeded();
      const node=(await page.evaluate(id=>window.audioArtReview.get(id).inspect(),id)).nodes.find(node=>node.id===`usage-settings.row.${row}.control`);
      const box=await page.locator(`#${id} canvas`).boundingBox(),factor=box.width/panels[id].spec.canvas.width;
      await page.mouse.click(box.x+(node.bounds.x+node.bounds.width*fraction)*factor,box.y+(node.bounds.y+node.bounds.height/2)*factor);
    };
    const initial=panels[id].state;
    await click('volume-row',.3);assert.notEqual((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id)).volume,initial.volume);
    await click('mute-row');assert.equal((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id)).muted,!initial.muted);
    await click('save');await click('close');
    const events=await page.evaluate(id=>window.audioArtReview.events().filter(event=>event.instanceId===id),id);
    assert(events.some(event=>event.event.name==='settings.save'));assert(events.some(event=>event.event.name==='settings.close'));
    await click('reset-row');assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id),initial);
    const exported=await page.evaluate(id=>window.audioArtReview.get(id).exportBundle(),id);await validatePanelBundle(exported,core);
    checks.push(`${mode}: real slider, switch, save, close, reset and library-free export`);
    report.phase=`${mode}-download`;
    const downloadPromise=page.waitForEvent('download');await page.locator(`#download-${mode}`).click();const download=await downloadPromise;
    const downloaded=resolve(output,`downloaded-audio-${mode}.zip`);await download.saveAs(downloaded);
    const zip=readStoredZip(await readFile(downloaded)),manifest=JSON.parse(new TextDecoder().decode(zip.get('delivery-manifest.json')));
    for(const file of manifest.files){assert.equal(zip.get(file.path).length,file.bytes);assert.equal(await digestBytes(zip.get(file.path)),file.sha256);}
    const reopened=await validatePanelBundle(JSON.parse(new TextDecoder().decode(zip.get('pixi/panel.bundle.json'))),core);
    assert.equal(reopened.sha256,panels[id].sha256);
    const offline=resolve(output,`offline-${mode}`);
    for(const [path,bytes] of zip){const file=resolve(offline,path);assert(file.startsWith(offline+'/')||file.startsWith(offline+'\\'));await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
    const offlinePage=await browser.newPage();offlinePage.on('pageerror',error=>errors.push(error.message));offlinePage.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
    await offlinePage.goto(pathToFileURL(resolve(offline,'pixi/index.html')).href);
    await offlinePage.waitForFunction(()=>document.querySelector('canvas')?.width>1);
    assert.equal(await offlinePage.locator('canvas').count(),1);await offlinePage.close();
    checks.push(`${mode}: actual download ZIP CRC/checksums, reimport and offline Pixi open`);
  }
  report.phase='narrow-view';await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
  // Viewport fitting runs in the ResizeObserver's next animation frame. A
  // clipped outer card can hide overflow before its canvas has actually fitted.
  await page.waitForFunction(()=>[...document.querySelectorAll('.canvas')].every(host=>{
    const canvas=host.querySelector('canvas').getBoundingClientRect(),stage=host.parentElement.getBoundingClientRect();
    return canvas.width<=stage.width+.1&&canvas.height<=stage.height+.1;
  }));
  for(const id of Object.keys(panels)){
    const stage=await page.locator(`#stage-${id}`).boundingBox(),canvas=await page.locator(`#${id} canvas`).boundingBox();
    assert(canvas.width<=stage.width+.1&&canvas.height<=stage.height+.1);
  }
  await page.screenshot({path:resolve(output,'narrow.png'),fullPage:true});checks.push('390px layout and canvas containment');
  assert.deepEqual(await page.evaluate(()=>window.audioArtReview.errors()),[]);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  report.status='PASS';report.phase='complete';report.references=references;report.browserErrors=errors;report.externalRequests=requests.length;
}catch(error){
  report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;
}finally{
  await browser?.close();await writeNewJson(output,'review-report.json',report);process.stdout.write(JSON.stringify({status:report.status,phase:report.phase,checks:checks.length,failure:report.failure,modelCalls:0})+'\n');
}
