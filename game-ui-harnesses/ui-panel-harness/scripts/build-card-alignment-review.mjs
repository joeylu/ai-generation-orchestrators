#!/usr/bin/env node
/** Explicit, deterministic theme adoption. Preserves the original real Bundle and receipt. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import {canonicalJson,digestBytes} from '../src/canonical.mjs';
import * as panel from '../src/index.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {sampleCases,sampleRequest,sampleIntent} from '../examples/panel-samples-v1/fixture.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output','CARD_REVIEW_ARGUMENTS');
const source=resolve(args[1]),raw=await readFile(source),core=await loadWorkspaceCore(),original=await panel.validatePanelBundle(JSON.parse(raw),core);
assert.equal(original.compilerVersion,'0.29.0');assert(original.spec.sections.every(s=>s.rows.some(r=>r.kind==='image')));
const catalog=await readJson(resolve(harnessRoot,'examples/modern-centered-cards.catalog.json')),old=original.catalog,
  output=await createOutputDirectory(args[3]),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),panels={},artifacts=[];
const theme=(catalog,mode)=>catalog.themes.find(t=>t.id===`modern-mint-${mode}`&&t.headingStyle==='concise-v2');
for(const mode of ['light','dark'])for(const kind of ['roles','audio']){
  let before;
  if(kind==='roles'){
    const spec=structuredClone(original.spec),t=theme(old,mode);spec.theme={id:t.id,version:t.version};
    before=mode==='light'?original:await panel.createPanelBundle(spec,old,core,original.state,panel.panelBundleAssetInputs(original,core));
  }else{
    const item=sampleCases.find(item=>item.id==='audio'),model=await createWorkbenchModel({catalog:old,pool:null},core);
    try{const {context}=await model.prepare(sampleRequest(item));before=(await model.acceptProposal(await materializePanelIntent(context,sampleIntent(context,item,mode)))).panel;}finally{model.dispose();}
  }
  const spec=structuredClone(before.spec),t=theme(catalog,mode);spec.theme={id:t.id,version:t.version};
  const after=await panel.createPanelBundle(spec,catalog,core,before.state,panel.panelBundleAssetInputs(before,core));
  assert.deepEqual({...after.spec,theme:before.spec.theme},before.spec);assert.deepEqual(after.state,before.state);assert.deepEqual(after.actions,before.actions);
  assert.deepEqual(after.componentBundle.document,before.componentBundle.document);
  for(const [variant,bundle]of Object.entries({before,after})){
    const id=`${kind}-${mode}-${variant}`;panels[id]=bundle;
    assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);await writeNewJson(output,id+'.panel.bundle.json',bundle);
    const kit=await createUnityKitFiles(bundle,core,sources),delivery=await panel.createPanelDelivery(bundle,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
    for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
    await writeFile(resolve(output,id+'.zip'),zip,{flag:'wx'});
    artifacts.push({id,bundleSha256:bundle.sha256,zipBytes:zip.length,zipSha256:await digestBytes(zip),compilerVersion:bundle.compilerVersion,
      sourceKind:kind==='roles'&&mode==='light'&&variant==='before'?'ORIGINAL_SAVED_REAL_RESULT':kind==='roles'?'DETERMINISTIC_REPLAY_OF_SAVED_SPEC':'PROGRAMMATIC_AUDIO_FIXTURE'});
  }
}
const {build}=await loadWorkspaceTool('vite'),built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,lib:{entry:resolve(harnessRoot,'examples/card-alignment-v1/review.mjs'),name:'CardAlignmentReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(item=>item.output);assert.equal(chunks.length,1);await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
const panes=Object.keys(panels).map(id=>`<section data-panel="${id}" hidden><div id="${id}" class="canvas"></div></section>`).join('');
await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>卡片对齐 · 前后对照</title>
<style>*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#f3f6f4;color:#20332e;font:15px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1180px;margin:auto;padding:28px 24px}h1{font-size:24px;font-weight:600;margin:0 0 8px}p{color:#526a61;margin:0 0 18px}.toolbar,footer,.group{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.toolbar,footer{justify-content:space-between;gap:14px}button,a{font:inherit;border:1px solid #abc2b6;border-radius:8px;background:transparent;color:#254b3e;padding:9px 14px;min-height:44px;cursor:pointer;text-decoration:none}button[aria-pressed=true]{background:#196a53;color:#fff;border-color:#196a53}button:focus-visible,a:focus-visible{outline:3px solid #58a78e;outline-offset:3px}.stage{margin-top:18px;background:#e4ebe6;border-radius:16px;overflow:hidden}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}footer{margin-top:16px}#status{color:#526a61;flex:1 1 300px}.note{font-size:13px;margin:18px 0 0}@media(max-width:600px){main{padding:20px 12px}h1{font-size:21px}button,a{font-size:13px;padding:8px 10px}}</style>
<main><h1>卡片对齐 · 前后对照</h1><p>角色卡片共用中心线，设置字段保留左对齐。</p><div class="toolbar"><div class="group" role="group" aria-label="样本"><button data-kind="roles">角色选择</button><button data-kind="audio">声音设置</button></div><div class="group" role="group" aria-label="排版规则"><button data-variant="before">修改前</button><button data-variant="after">居中规则</button></div><div class="group" role="group" aria-label="颜色模式"><button data-mode="light">浅色</button><button data-mode="dark">深色</button></div></div><div class="stage">${panes}</div>
<footer><span id="status" role="status" aria-live="polite">正在加载预览</span><a id="download" download>下载当前对照 ZIP</a></footer><p class="note">本轮模型调用 0 · 浅色角色修改前为上一轮原始真实结果；其余为程序重放 · 原始结果和回执保留 · Unity 原生及消费方 Web 未验收</p></main>
<script id="panels" type="application/json">${canonicalJson(panels).replaceAll('<','\\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
assert.deepEqual(await readFile(source),raw);
await writeNewJson(output,'acceptance.json',{status:'PASS',kind:'VERSIONED_CARD_ALIGNMENT_DETERMINISTIC_REPLAY',realModelCalls:0,originalFileSha256:await digestBytes(raw),originalBundleSha256:original.sha256,
  originalResultRewritten:false,artifacts,runtime:{bytes:Buffer.byteLength(runtime.code),sha256:runtime.sha256},browser:'NOT_RUN',unityNative:'NOT_RUN',consumerWebAcceptance:'NOT_RUN',productionRelease:false});
console.log(JSON.stringify({status:'PASS',artifacts:artifacts.length,realModelCalls:0,review:resolve(output,'index.html')}));
