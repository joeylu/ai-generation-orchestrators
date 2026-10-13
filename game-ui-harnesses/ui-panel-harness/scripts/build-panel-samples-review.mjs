#!/usr/bin/env node
/** Current public planning/workbench path, explicit fixtures, actual Pixi and offline delivery. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import * as panel from '../src/index.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {sampleCases,sampleRequest,sampleIntent,expectedKinds} from '../examples/panel-samples-v1/fixture.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {digestBytes,canonicalJson} from '../src/canonical.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output','SAMPLE_REVIEW_ARGUMENTS');
const output=await createOutputDirectory(args[1]),core=await loadWorkspaceCore(),catalog=await readJson(resolve(harnessRoot,'examples/modern-image-slots.catalog.json'));
const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),panels={},artifacts=[];
for(const item of sampleCases)for(const mode of ['light','dark']){
  const id=item.id+'-'+mode,model=await createWorkbenchModel({catalog,pool:null},core);
  try{
    const {context}=await model.prepare(sampleRequest(item)),intent=sampleIntent(context,item,mode),proposal=await materializePanelIntent(context,intent);
    assert.equal((await panel.checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');
    const snapshot=await model.acceptProposal(proposal),bundle=snapshot.panel;
    assert.equal(snapshot.phase,'ready');assert.deepEqual(bundle.spec.sections.flatMap(section=>section.rows.map(row=>row.kind)),expectedKinds[item.id]);
    assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);assert.equal(model.getEditBudget().used,0);
    panels[id]=bundle;await writeNewJson(output,id+'.panel.bundle.json',bundle);await writeNewJson(output,id+'.fixture.intent.json',intent);
    const kit=await createUnityKitFiles(bundle,core,sources),delivery=await panel.createPanelDelivery(bundle,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),decoded=readStoredZip(Buffer.from(zip));
    assert.equal(decoded.size,delivery.contents.size);
    for(const file of delivery.manifest.files){const bytes=decoded.get(file.path);assert.equal(bytes.length,file.bytes);assert.equal(await digestBytes(bytes),file.sha256);}
    assert.deepEqual(JSON.parse(decoded.get('pixi/panel.bundle.json').toString('utf8')),bundle);
    await writeFile(resolve(output,id+'.zip'),zip,{flag:'wx'});
    artifacts.push({id,sourceKind:'PROGRAMMATIC_INTENT_FIXTURE',contextSha256:context.sha256,panelSha256:bundle.sha256,zipBytes:zip.length,zipSha256:await digestBytes(zip),fileChecks:delivery.manifest.files.length,unityNative:'NOT_RUN'});
  }finally{model.dispose();}
}
const {build}=await loadWorkspaceTool('vite'),built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,lib:{entry:resolve(harnessRoot,'examples/panel-samples-v1/review.mjs'),name:'PanelSamplesReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(result=>result.output);assert.equal(chunks.length,1);await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
const cards=Object.keys(panels).map(id=>`<section data-panel="${id}" hidden><div id="${id}" class="canvas"></div></section>`).join('');
const options=sampleCases.map(item=>`<button data-option="${item.id}" aria-pressed="false">${item.label}</button>`).join('');
await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>控件与布局对照</title>
<style>*{box-sizing:border-box}[hidden]{display:none!important}:root{--page:#101719;--text:#edf4f2;--muted:#b0c4bf;--line:#435950;--active:#d5e9e1;--ink:#143a2e;--stage:#0e1515}html[data-mode=light]{--page:#f2f5f4;--text:#1c3028;--muted:#496358;--line:#a7b9b0;--active:#196a53;--ink:#fff;--stage:#e8eeeb}body{margin:0;background:var(--page);color:var(--text);font:15px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1180px;margin:auto;padding:28px 24px}h1{font-size:24px;font-weight:600;margin:0 0 6px}p{color:var(--muted);margin:0 0 20px}.toolbar,.modes,.samples,footer{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.toolbar{justify-content:space-between;gap:16px}button,a{font:inherit;color:var(--text);background:transparent;border:1px solid var(--line);border-radius:8px;padding:9px 14px;min-height:44px;cursor:pointer;text-decoration:none}button[aria-pressed=true]{background:var(--active);color:var(--ink);border-color:var(--active)}button:focus-visible,a:focus-visible{outline:3px solid var(--active);outline-offset:3px}.stage{margin-top:20px;background:var(--stage);border-radius:16px;overflow:hidden}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}footer{margin-top:16px;justify-content:space-between}#status{color:var(--muted);flex:1 1 330px}footer .tools{display:flex;gap:8px;flex-wrap:wrap}.note{font-size:13px;margin:18px 0 0}@media(max-width:600px){main{padding:20px 12px}h1{font-size:21px}button,a{padding:8px 10px;font-size:13px}}</style>
<main><h1>控件与布局对照</h1><p>五类面板，同一默认链路。切换浅深色，直接操作面板查看反馈。</p><div class="toolbar"><div class="samples" role="group" aria-label="代表面板">${options}</div><div class="modes" role="group" aria-label="颜色模式"><button data-mode="light">浅色</button><button data-mode="dark">深色</button></div></div><div class="stage">${cards}</div>
<footer><span id="status" role="status" aria-live="polite">正在加载预览</span><div class="tools"><button id="advance" hidden>演示进度</button><button id="reset">恢复初始状态</button><a id="download" download>下载初始样本 ZIP</a></div></footer><p class="note">程序夹具 · 真实模型调用 0 · 本地事件演示 · Unity 原生导入及消费方 Web 未验收</p></main>
<script id="panels" type="application/json">${canonicalJson(panels).replaceAll('<','\\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
await writeNewJson(output,'acceptance.json',{status:'PASS',kind:'DETERMINISTIC_CURRENT_PANEL_SAMPLES',realModelCalls:0,imageGenerationCalls:0,artifacts,runtime:{bytes:new TextEncoder().encode(runtime.code).length,sha256:runtime.sha256},browser:'NOT_RUN',humanVisualApproval:'NOT_RUN',unityNative:'NOT_RUN',consumerWebAcceptance:'NOT_RUN',productionRelease:false});
console.log(JSON.stringify({status:'PASS',artifacts:artifacts.length,realModelCalls:0,review:resolve(output,'index.html')}));
