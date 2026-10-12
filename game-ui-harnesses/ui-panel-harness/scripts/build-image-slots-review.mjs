#!/usr/bin/env node
/** Deterministic fixtures, actual Pixi playback and offline ZIPs. No model transport. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import * as panel from '../src/index.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {conciseRoleSpec} from '../examples/image-slots-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {digestBytes,canonicalJson} from '../src/canonical.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output','IMAGE_REVIEW_ARGUMENTS');
const output=await createOutputDirectory(args[1]),core=await loadWorkspaceCore(),catalog=await readJson(resolve(harnessRoot,'examples/modern-image-slots.catalog.json'));
const pool=await imageAssetPool(),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),panels={},artifacts=[];
for(const mode of ['light','dark'])for(const variant of ['text','slots','bound']){
  const id=variant+'-'+mode,spec=conciseRoleSpec(panel,catalog,{mode});
  if(variant==='text')for(const section of spec.sections)section.rows=section.rows.filter(row=>row.kind!=='image');
  if(variant==='bound'){
    spec.assets={library:{id:pool.index.id,sha256:pool.index.sha256},panelSurface:null,rowIcons:[]};
    spec.sections.forEach((section,index)=>{section.rows[0].source=pool.index.records[index].key;section.rows[0].fit='contain';section.rows[0].label='肖像';});
  }
  spec.provenance={kind:'programmatic-fixture',description:'Static image slot acceptance. Bound geometric textures test PNG resources; they are not character portrait artwork.',assumptions:[]};
  const bundle=await panel.createPanelBundle(spec,catalog,core,undefined,spec.assets?await workbenchAssetInputs(spec,pool):undefined);
  panels[id]=bundle;await writeNewJson(output,id+'.panel.bundle.json',bundle);
  const kit=await createUnityKitFiles(bundle,core,sources),delivery=await panel.createPanelDelivery(bundle,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),decoded=readStoredZip(Buffer.from(zip));
  assert.equal(decoded.size,delivery.contents.size);
  for(const file of delivery.manifest.files){const bytes=decoded.get(file.path);assert.equal(bytes.length,file.bytes);assert.equal(await digestBytes(bytes),file.sha256);}
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decoded.get('pixi/panel.bundle.json'))),bundle);
  for(const [path,bytes] of decoded){const target=resolve(output,'unpacked',id,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
  await writeFile(resolve(output,id+'.zip'),zip,{flag:'wx'});
  artifacts.push({id,panelSha256:bundle.sha256,zipBytes:zip.length,zipSha256:await digestBytes(zip),assetKeys:panel.panelAssetKeys(bundle.spec),fileChecks:delivery.manifest.files.length,unityNative:'NOT_RUN'});
}
const {build}=await loadWorkspaceTool('vite'),built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,lib:{entry:resolve(harnessRoot,'examples/image-slots-v1/review.mjs'),name:'ImageSlotsReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(result=>result.output);assert.equal(chunks.length,1);await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
const cards=Object.keys(panels).map(id=>`<section data-panel="${id}" hidden><div id="${id}" class="canvas"></div></section>`).join('');
await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>角色图片槽 · 确定性对照</title><style>*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:#11171c;color:#f1f5f5;font:15px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif}main{max-width:1200px;margin:auto;padding:28px 24px}h1{font-size:25px;font-weight:500;margin:0 0 8px}p{color:#b8c5c8;margin:8px 0 20px}.toolbar{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}button{font:inherit;color:#bdcbcf;background:transparent;border:1px solid #46555d;border-radius:8px;padding:9px 14px;cursor:pointer}button[aria-pressed=true]{background:#d5e7e0;color:#173b32;border-color:#d5e7e0}button:focus-visible,a:focus-visible{outline:2px solid #9de0cc;outline-offset:4px}.stage{margin-top:20px;background:#0d1216;border-radius:16px;overflow:hidden}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}footer{display:flex;justify-content:space-between;gap:12px;margin-top:16px;color:#b8c5c8}a{color:#9de0cc;text-decoration:none}@media(max-width:600px){main{padding:20px 12px}h1{font-size:21px}button{padding:8px 10px;font-size:13px}}</style><main><h1>角色图片槽 · 确定性对照</h1><p>沿用 Panel / Pixi 生成链路。没有肖像时保留图片槽；绑定页使用程序验证纹理，不代表角色美术成品。三份样本保留相同角色和选择按钮。</p><div class="toolbar"><div role="group" aria-label="对照样本"><button data-option="text">文字内容</button> <button data-option="slots">肖像占位</button> <button data-option="bound">绑定验证纹理</button></div><div role="group" aria-label="颜色模式"><button data-mode="dark">深色</button> <button data-mode="light">浅色</button></div></div><div class="stage">${cards}</div><footer><span id="status" role="status">可点击选择按钮；静态图片不触发动作。</span><a id="download" download>下载当前面板 ZIP</a></footer><p>本地开发样本 · 真实模型调用 0 · Unity 原生导入未验收 · Docker/Web 项目未修改。</p></main><script id="panels" type="application/json">${canonicalJson(panels).replaceAll('<','\\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
await writeNewJson(output,'acceptance.json',{status:'PASS',kind:'DETERMINISTIC_IMAGE_SLOT_FIXTURES',realModelCalls:0,imageGenerationCalls:0,artifacts,runtime:{bytes:new TextEncoder().encode(runtime.code).length,sha256:runtime.sha256},browser:'NOT_RUN',humanVisualApproval:'NOT_RUN',unityNative:'NOT_RUN',productionRelease:false});
console.log(JSON.stringify({status:'PASS',artifacts:artifacts.length,realModelCalls:0,review:resolve(output,'index.html')}));
