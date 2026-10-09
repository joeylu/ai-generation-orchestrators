#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import {canonicalJson,digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createApplePanelSample,panelSamples} from '../examples/apple-panel-samples-v1/fixture.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {checkApplePanelSamples} from './lib/apple-panel-samples-browser.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output');
const output=await createOutputDirectory(args[3]),review=await createOutputDirectory(resolve(output,'review')),source=resolve(args[1]),core=await loadWorkspaceCore();
const catalog=await readJson(resolve(harnessRoot,'examples/modern-minimal.catalog.json')),entries={},checks=[],references=[];
const runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources();
for(const mode of ['light','dark']){
  const original=await validatePanelBundle(await readJson(resolve(source,`s1-${mode}.panel.bundle.json`)),core);
  for(const sample of panelSamples){
    const pair=createApplePanelSample(sample.id,mode,original,catalog),key=`${sample.id}-${mode}`;
    const before=await createPanelBundle(pair.before.spec,pair.before.catalog,core),after=await createPanelBundle(pair.after.spec,pair.after.catalog,core);
    await validatePanelBundle(before,core);await validatePanelBundle(after,core);
    for(const field of ['state','bindings','actions','assetClosure'])assert.deepEqual(before[field],after[field]);assert.deepEqual(before.spec.sections,after.spec.sections);
    entries[key]={...sample,mode,before,after};
    for(const [id,bundle] of Object.entries({before,after}))await writeNewJson(review,`${key}-${id}.panel.bundle.json`,bundle);
    const unityKit=await createUnityKitFiles(after,core,unitySources),delivery=await createPanelDelivery(after,core,{runtime,unityKit});
    await writeFile(resolve(review,`${key}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
    references.push({key,beforeSha256:before.sha256,afterSha256:after.sha256,themeSourceSha256:original.sha256});checks.push(`${key}: strict bundles; identical content/state/events/assets; UGUI source kit and delivery`);
  }
}
const {build}=await loadWorkspaceTool('vite');
const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
  lib:{entry:resolve(harnessRoot,'examples/apple-panel-samples-v1/review.mjs'),name:'ApplePanelReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(item=>item.output);assert.equal(chunks.length,1);
await writeFile(resolve(review,'review.js'),chunks[0].code,{flag:'wx'});
await writeFile(resolve(review,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Apple 风格 · 面板样本</title>
<style>*{box-sizing:border-box}body{margin:0;background:#11161B;color:#F4F5F6;font:15px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1260px;margin:auto;padding:32px 28px}h1{font-size:26px;font-weight:500;margin:0}p{color:#B8C2C9;margin:8px 0 22px}.toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}nav{display:flex;flex-wrap:wrap;gap:6px}a{color:#BBC9D3;text-decoration:none}nav a{padding:8px 13px;border:1px solid #3C4852;border-radius:8px;font-size:14px}nav a[aria-current=true]{background:#E5EDF4;border-color:#E5EDF4;color:#17222D}a:focus-visible{outline:2px solid #75B8FF;outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:22px}.grid>section{min-width:0}h2{font-size:15px;font-weight:400;margin:0 0 10px;color:#C9D2DA}.stage{min-width:0;background:#0D1216;border-radius:16px;overflow:hidden}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}.delivery{margin-top:16px;text-align:right}.delivery a{color:#8AC0F7}footer{font-size:13px;color:#A1ADB8;margin-top:20px}footer p{font-size:12px;margin:7px 0}#caption{margin-bottom:0}@media(max-width:800px){main{padding:22px 16px}.grid{grid-template-columns:minmax(0,1fr);gap:24px}h1{font-size:23px}nav a{padding:7px 10px;font-size:13px}}</style>
<main><h1>Apple 风格 · 面板样本对比</h1><p>同样的内容与操作，比较布局、留白和视觉层级。</p><div class="toolbar"><nav aria-label="面板类型">${panelSamples.map(item=>`<a data-purpose="${item.id}" href="?panel=${item.id}-light">${item.title}</a>`).join('')}</nav><nav aria-label="颜色模式"><a data-mode="light" href="?panel=menu-light">浅色</a><a data-mode="dark" href="?panel=menu-dark">深色</a></nav></div><p id="caption"></p><span id="name" hidden></span><div class="grid"><section><h2>原简约版</h2><div class="stage" id="before-stage"><div class="canvas" id="before"></div></div></section><section><h2>Apple 风格样本</h2><div class="stage" id="after-stage"><div class="canvas" id="after"></div></div></section></div><div class="delivery"><a id="download" download>下载此样本</a></div><footer><span id="feedback" role="status">可点击按钮和调整设置，左右两份独立试玩。</span><p>本地编写的对比样本，尚未设为默认。使用系统字体，不包含 Apple 专有字体或图标。</p></footer></main><script id="review-seed" type="application/json">${canonicalJson(entries).replaceAll('<','\\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
await writeNewJson(review,'samples.json',entries);
const browser=await checkApplePanelSamples(review,entries,core);
const files=[];for(const path of ['examples/apple-panel-samples-v1/fixture.mjs','examples/apple-panel-samples-v1/review.mjs','scripts/build-apple-panel-samples.mjs','scripts/lib/apple-panel-samples-browser.mjs','src/compiler.mjs','src/state.mjs','src/catalog.mjs','src/grouped-presentation.mjs','src/panel-presentation.mjs','src/panel-bundle.mjs','src/pixi-panel-instance.mjs','src/panel-visuals.mjs','src/preview.mjs','src/unity-export.mjs','src/workbench-renderer.mjs','src/panel-intent.mjs'])
  files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
await writeNewJson(output,'study-report.json',{status:'PASS',kind:'LOCAL_APPLE_PANEL_SAMPLES',compilerVersion:'0.24.0',modelCalls:0,imageGenerationCalls:0,panelTypes:5,modes:2,
  checks,browserChecks:browser.checks.length,references,files,humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',productionDefaultChanged:false,review:'review/index.html'});
process.stdout.write(JSON.stringify({status:'PASS',samples:10,browserChecks:browser.checks.length,modelCalls:0,review:'review/index.html'})+'\n');
