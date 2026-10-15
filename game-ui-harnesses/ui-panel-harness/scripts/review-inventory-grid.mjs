#!/usr/bin/env node
/** Deterministic specimens only. No model dispatch or hand-authored delivery manifest. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchRetrieval,workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {request,inventoryIntent} from '../examples/inventory-grid-v1/fixture.mjs';
const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output','INVENTORY_REVIEW_ARGUMENTS');
const output=await createOutputDirectory(args[1]),core=await loadWorkspaceCore();
const catalog=await readJson(new URL('../examples/modern-readable-game-grid-layout.catalog.json',import.meta.url));
const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),pool=await loadBundledCoreAssets();
const specimens=[
 {id:'empty-10x10',text:request.text,options:{}},
 {id:'items-8x6',text:'做个8行6列的背包面板',options:{rows:8,columns:6,selectedSlot:47,items:[{slot:0,name:'药水',quantity:12,icon:null},{slot:8,name:'矿石',quantity:99,icon:null},{slot:47,name:'钥匙',quantity:1,icon:null}]}},
 {id:'scroll-10x10',text:'做个10x10仓库，高度限制500',options:{layout:{maxHeight:500,canvasHeight:640,overflow:'scroll'}}},
 {id:'full-12x12',text:'做个12x12仓库面板',options:{rows:12,columns:12,items:Array.from({length:144},(_,slot)=>({slot,name:'材料',quantity:slot+1,icon:null}))}},
 {id:'icon-2x2',text:'做个2x2仓库，用确认图标测试资源',options:{rows:2,columns:2,items:[{slot:0,name:'确认图标',quantity:9,icon:'panel-core/confirm@1.0.0'}]}}
];
const cases=[];
for(const item of specimens){
 const input={...request,id:item.id,text:item.text},retrieval=workbenchRetrieval(input.text,pool,{images:true});
 const context=await createPlanningContext(input,catalog,retrieval),proposal=await materializePanelIntent(context,inventoryIntent(context,item.options));
 const bundle=await createPanelBundle(proposal.spec,catalog,core,undefined,await workbenchAssetInputs(proposal.spec,pool));
 const kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
 const root=resolve(output,item.id);await mkdir(root);await writeNewJson(root,'panel.bundle.json',bundle);
 for(const [path,bytes]of delivery.contents){const target=resolve(root,'delivery',path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
 await writeFile(resolve(root,'delivery.zip'),createStoredZip(delivery.contents),{flag:'wx'});
 cases.push({id:item.id,request:item.text,rows:item.options.rows??10,columns:item.options.columns??10,panelSha256:bundle.sha256,delivery:item.id+'/delivery/pixi/index.html',kind:'PROGRAMMATIC_FIXTURE'});
}
await writeNewJson(output,'review.json',{kind:'PROGRAMMATIC_FIXTURE',cases,realModelCalls:0,nativeUnity:'NOT_RUN',browser:'NOT_RUN'});
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>仓库网格验收</title><style>body{margin:0;background:#edf3f0;color:#203d35;font:16px/1.7 system-ui}main{max-width:1080px;margin:auto;padding:24px}h1{font-size:28px}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#087c65}article{margin:28px 0;padding:20px;background:white;border:1px solid #d1e2da;border-radius:12px}iframe{width:100%;height:1180px;border:0}h2{font-size:20px}</style><main><h1>仓库网格验收</h1><p>按新默认规则编译的程序样本，尚未调用真实模型。每格都有独立底板；小屏幕保留尺寸并横向滚动。物品名称和数量是交互验收示例。</p><nav>${cases.map(c=>`<a href="#${c.id}">${c.rows}×${c.columns} · ${c.id}</a>`).join('')}</nav>${cases.map(c=>`<article id="${c.id}"><h2>${escape(c.request)}</h2><p><a href="${c.delivery}" target="_blank">独立试玩</a>　<a href="${c.id}/delivery.zip">下载交付包</a></p><iframe loading="lazy" title="${escape(c.request)}" src="${c.delivery}"></iframe></article>`).join('')}</main></html>`,{flag:'wx'});
console.log(JSON.stringify({status:'COMPLETE',cases:cases.length,realModelCalls:0}));
