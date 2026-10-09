import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOutputDirectory,harnessRoot,writeNewJson} from '../../src/io.mjs';
import {canonicalJson,digestBytes} from '../../src/canonical.mjs';
import {validatePanelBundle} from '../../src/panel-bundle.mjs';
import {createUnityKitFiles} from '../../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../../src/unity-export-io.mjs';
import {createPanelDelivery} from '../../src/panel-delivery.mjs';
import {createStoredZip} from '../../src/zip-store.mjs';
import {readStoredZip} from '../../tests/unity-kit-helpers.mjs';
import {buildDeliveryRuntime} from '../build-delivery-runtime.mjs';
import {loadWorkspaceTool} from './workspace-tools.mjs';
import {assertRowIconStudy} from './row-icon-study.mjs';
import {assertSliderClarityStudy} from './slider-clarity-study.mjs';
import {assertAudioFlowStudy} from './audio-flow-study.mjs';

const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
/** Saved bundle playback only. Model dispatch is not reachable from this module. */
export async function buildArtSkillReview({baselines,candidates,output:input,core,fixture=false,study=null}){
  const output=await createOutputDirectory(input),panels={},checks=[],choices=[{id:'baseline',label:'当前稿',name:'当前稿'}];
  const report={status:'FAIL',phase:'build',kind:fixture?'PROGRAMMATIC_FIXTURE':'SAVED_REAL_SKILL_RESULTS',checks,modelCalls:0,
    imageGenerationCalls:0,humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',references:[]};
  let browser,page;
  try{
    for(const mode of ['dark','light'])panels[`baseline-${mode}`]=baselines[mode];
    for(const [index,candidate] of candidates.entries()){
      assert(/^s[1-3]$/.test(candidate.id));choices.push({id:candidate.id,label:study?candidate.label:`方案${['一','二','三'][index]}`,name:candidate.label});
      for(const mode of ['dark','light'])panels[`${candidate.id}-${mode}`]=candidate.bundles[mode];
    }
    const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources();
    for(const [id,bundle] of Object.entries(panels)){
      await validatePanelBundle(bundle,core);await writeNewJson(output,`${id}.panel.bundle.json`,bundle);
      if(id.startsWith('baseline-'))continue;
      const before=baselines[id.split('-')[1]];
      for(const key of ['state','bindings','actions'])assert.deepEqual(bundle[key],before[key]);
      if(study?.rowIconReplacements)assertRowIconStudy(before,bundle,study.rowIconReplacements[id.split('-')[1]]);
      else assert.deepEqual(bundle.assetClosure,before.assetClosure);
      if(study?.sliderRefinement)assertSliderClarityStudy(before,bundle);
      if(study?.audioFlow)assertAudioFlowStudy(before,bundle,core);
      if(study)assert.deepEqual(bundle.spec.sections.flatMap(section=>section.rows),before.spec.sections.flatMap(section=>section.rows));
      else assert.deepEqual(bundle.spec.sections,before.spec.sections);
      const kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
      await writeFile(resolve(output,`${id}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
      report.references.push({id,bundleSha256:bundle.sha256,baselineSha256:before.sha256});checks.push(`${id}: strict bundle, state/business exact, ${study?.rowIconReplacements?'explicit row icon replacement; layout/tokens exact':study?.sliderRefinement?'slider artwork only; layout/assets/tokens exact':study?.audioFlow?'declared regrouping; fonts/palette/all resource bytes exact':'assets exact'}`);
    }
    const {build}=await loadWorkspaceTool('vite');
    const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
      lib:{entry:resolve(harnessRoot,'examples/crafted-audio-v1/skill-review.mjs'),name:'SkillArtReview',formats:['iife'],fileName:()=> 'review.js'}}});
    const chunks=(Array.isArray(built)?built:[built]).flatMap(result=>result.output);assert.equal(chunks.length,1);
    await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
    const buttons=choices.map(choice=>`<button type="button" data-option="${choice.id}" aria-pressed="false">${escape(choice.label)}</button>`).join('');
    const cards=Object.keys(panels).map(id=>`<section data-panel="${id}" hidden><div class="stage" id="stage-${id}"><div class="canvas" id="${id}"></div></div>${id.startsWith('baseline-')?'':`<div class="delivery"><a href="${id}.zip" id="download-${id}" download>下载此面板</a></div>`}</section>`).join('');
    const title=study?.title??'声音设置 · Skill 对照';
    const caption=study?.caption??(fixture?'本地流程预演，不是 Skill 生成结果。':'相同需求、素材和模型，分别读取不同 Skill 的设计指导。先比较效果，再查看名称。');
    await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escape(title)}</title><style>*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#11171C;color:#F1F5F5;font:15px/1.65 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1000px;margin:auto;padding:36px 28px}h1{font-size:26px;font-weight:500;margin:0}p{color:#B5C0C5;margin:8px 0 24px}.toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px}.choices,.modes{display:flex;flex-wrap:wrap;gap:6px}button{font:inherit;font-size:14px;color:#BEC9CD;background:transparent;border:1px solid #46555D;border-radius:8px;padding:9px 14px;cursor:pointer}button:hover{background:#27343C}button[aria-pressed=true]{background:#D5E7E0;color:#173B32;border-color:#D5E7E0}button:focus-visible,a:focus-visible{outline:2px solid #9DE0CC;outline-offset:4px}.stage{min-width:0;padding-bottom:1px;background:#0D1216;border-radius:16px;overflow:hidden;margin-top:20px}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}.delivery{display:flex;justify-content:flex-end;margin-top:12px}a{font-size:14px;color:#9DE0CC;text-decoration:none}footer{font-size:13px;color:#B5C0C5;margin-top:20px}footer p{font-size:12px;margin:8px 0 12px}#reveal{padding:7px 12px;font-size:12px}@media(max-width:600px){main{padding:24px 16px}h1{font-size:23px}.toolbar{gap:12px}button{padding:8px 11px;font-size:13px}}</style><main><h1>${escape(title)}</h1><p>${escape(caption)}</p><div class="toolbar"><div class="choices" role="group" aria-label="对照方案">${buttons}</div><div class="modes" role="group" aria-label="颜色模式"><button type="button" data-mode="dark" aria-pressed="false">深色</button><button type="button" data-mode="light" aria-pressed="false">浅色</button></div></div>${cards}<footer><span id="status" role="status">可调整音量、切换静音、恢复默认与触发按钮</span><p>每个方案独立保留试玩值。本页用于比较，尚未设为默认主题。</p><button type="button" id="reveal" aria-pressed="false"${study?' hidden':''}>显示 Skill 名称</button></footer></main><script id="panels" type="application/json">${canonicalJson({panels,choices}).replaceAll('<','\\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
    const {chromium}=await loadWorkspaceTool('@playwright/test');
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const errors=[],requests=[];page=await browser.newPage({viewport:{width:1200,height:1000},acceptDownloads:true});
    const watch=target=>{target.on('pageerror',error=>errors.push(error.message));target.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});};watch(page);
    report.phase='render';await page.goto(pathToFileURL(resolve(output,'index.html')).href);
    await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
    assert.equal(await page.locator('canvas').count(),Object.keys(panels).length);
    const select=async id=>{
      const [option,mode]=id.split('-');await page.locator(`[data-option="${option}"]`).click();await page.locator(`[data-mode="${mode}"]`).click();
      await page.waitForFunction(({id,width})=>{
        if(document.documentElement.dataset.active!==id)return false;
        const stage=document.getElementById(`stage-${id}`).getBoundingClientRect(),canvas=document.querySelector(`#${id} canvas`).getBoundingClientRect();
        return Math.abs(canvas.width-Math.min(width,stage.width))<1.1&&canvas.width<=stage.width+.1&&canvas.height<=stage.height+.1;
      },{id,width:panels[id].spec.canvas.width});
    };
    const click=async(id,row,fraction=.5)=>{
      await page.locator(`#${id} canvas`).scrollIntoViewIfNeeded();
      const node=(await page.evaluate(id=>window.audioArtReview.get(id).inspect(),id)).nodes.find(node=>node.id===`usage-settings.row.${row}.control`);
      const box=await page.locator(`#${id} canvas`).boundingBox(),factor=box.width/panels[id].spec.canvas.width;
      await page.mouse.click(box.x+(node.bounds.x+node.bounds.width*fraction)*factor,box.y+(node.bounds.y+node.bounds.height/2)*factor);
    };
    const exerciseSliders=async(id,narrow=false)=>{
      for(const row of panels[id].spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='slider')){
        const field=panels[id].spec.state.find(field=>field.id===row.bind);
        await click(id,row.id,.01);assert.equal((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id))[row.bind],field.min);
        if(!narrow)await page.locator(`#stage-${id}`).screenshot({path:resolve(output,`${id}-${row.id}-min.png`)});
        await click(id,row.id,.99);assert.equal((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id))[row.bind],field.max);
        if(!narrow)await page.locator(`#stage-${id}`).screenshot({path:resolve(output,`${id}-${row.id}-max.png`)});
        await click(id,row.id,.5);
        const middle=(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id))[row.bind];
        const node=(await page.evaluate(id=>window.audioArtReview.get(id).inspect(),id)).nodes.find(node=>node.id===`usage-settings.row.${row.id}.control`);
        const box=await page.locator(`#${id} canvas`).boundingBox(),factor=box.width/panels[id].spec.canvas.width;
        await page.mouse.move(box.x+(node.bounds.x+node.bounds.width*.5)*factor,box.y+(node.bounds.y+node.bounds.height/2)*factor);
        await page.mouse.down();await page.mouse.move(box.x+(node.bounds.x+node.bounds.width*.8)*factor,box.y+(node.bounds.y+node.bounds.height/2)*factor,{steps:8});await page.mouse.up();
        const value=(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id))[row.bind];assert(value>middle&&value<=field.max);
      }
      await click(id,'reset-row');assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id),panels[id].state);
      checks.push(`${id}: ${narrow?'390px':'desktop'} slider endpoints, thumb drag and reset`);
    };
    for(const id of Object.keys(panels).filter(id=>!id.startsWith('baseline-'))){
      report.phase=`${id}-interaction`;await select(id);
      const inspect=await page.evaluate(id=>window.audioArtReview.get(id).inspect(),id);
      assert(inspect.nodes.filter(node=>node.visible).every(node=>!(node.renderedTextBounds??[]).some(text=>text.implicitTruncation)));
      await page.locator(`#stage-${id}`).screenshot({path:resolve(output,`${id}.png`)});await page.screenshot({path:resolve(output,`${id}-page.png`),fullPage:true});
      const initial=panels[id].state;
      await click(id,'volume-row',.3);assert.notEqual((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id)).volume,initial.volume);
      await click(id,'music-row',.6);assert.notEqual((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id)).music,initial.music);
      await click(id,'mute-row');assert.equal((await page.evaluate(id=>window.audioArtReview.get(id).getState(),id)).muted,!initial.muted);
      await click(id,'save');await click(id,'close');
      const events=await page.evaluate(id=>window.audioArtReview.events().filter(event=>event.instanceId===id),id);
      for(const name of ['audio.volumeChanged','audio.musicChanged','audio.muteChanged','settings.save','settings.close'])assert(events.some(event=>event.event.name===name));
      const exported=await page.evaluate(id=>window.audioArtReview.get(id).exportBundle(),id);await validatePanelBundle(exported,core);
      await select(`baseline-${id.split('-')[1]}`);assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),`baseline-${id.split('-')[1]}`),initial);
      await select(id);assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id),exported.state);
      await click(id,'reset-row');assert.deepEqual(await page.evaluate(id=>window.audioArtReview.get(id).getState(),id),initial);
      assert((await page.evaluate(()=>window.audioArtReview.events())).some(event=>event.instanceId===id&&event.event.name==='settings.resetRequested'));
      checks.push(`${id}: real controls/events, isolated state, reset, no text truncation, library-free export`);
      if(study?.sliderRefinement||study?.sliderInteractionChecks)await exerciseSliders(id);
      report.phase=`${id}-download`;
      const pending=page.waitForEvent('download');await page.locator(`#download-${id}`).click();const download=await pending;
      const downloaded=resolve(output,`downloaded-${id}.zip`);await download.saveAs(downloaded);
      const zip=readStoredZip(await readFile(downloaded)),manifest=JSON.parse(new TextDecoder().decode(zip.get('delivery-manifest.json')));
      for(const file of manifest.files){assert.equal(zip.get(file.path).length,file.bytes);assert.equal(await digestBytes(zip.get(file.path)),file.sha256);}
      const reopened=await validatePanelBundle(JSON.parse(new TextDecoder().decode(zip.get('pixi/panel.bundle.json'))),core);assert.equal(reopened.sha256,panels[id].sha256);
      const offline=resolve(output,`offline-${id}`);
      for(const [path,bytes] of zip){const file=resolve(offline,path);assert(file.startsWith(offline+'/')||file.startsWith(offline+'\\'));await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
      const offlinePage=await browser.newPage();watch(offlinePage);await offlinePage.goto(pathToFileURL(resolve(offline,'pixi/index.html')).href);
      await offlinePage.waitForFunction(()=>document.querySelector('canvas')?.width>1);assert.equal(await offlinePage.locator('canvas').count(),1);await offlinePage.close();
      checks.push(`${id}: actual download ZIP CRC/checksums, strict reimport and offline open`);
    }
    report.phase='narrow';await page.setViewportSize({width:390,height:844});
    for(const id of Object.keys(panels)){
      await select(id);await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
      if((study?.sliderRefinement||study?.sliderInteractionChecks)&&!id.startsWith('baseline-'))await exerciseSliders(id,true);
      await page.screenshot({path:resolve(output,`${id}-narrow.png`),fullPage:true});
    }
    checks.push('390px option navigation and canvas containment; scaling only');
    await page.setViewportSize({width:1200,height:1000});await select(`${choices[1].id}-dark`);
    if(!study)assert((await page.locator(`[data-option="${choices[1].id}"]`).textContent()).startsWith('方案'));
    if(!study){await page.locator('#reveal').click();assert.equal(await page.locator(`[data-option="${choices[1].id}"]`).textContent(),choices[1].name);
    await page.locator('#reveal').click();checks.push('anonymous labels and explicit Skill reveal');}
    else checks.push('named layout study and current source navigation');
    assert.deepEqual(await page.evaluate(()=>window.audioArtReview.errors()),[]);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    report.status='PASS';report.phase='complete';report.browserErrors=errors;report.externalRequests=requests.length;
  }catch(error){report.failure={code:error.code??error.name,message:error.message};await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});}
  finally{await browser?.close();await writeNewJson(output,'review-report.json',report);}
  if(report.status!=='PASS'){const error=new Error('ART_REVIEW_GATE_FAILED');error.report=report;throw error;}
  return report;
}
