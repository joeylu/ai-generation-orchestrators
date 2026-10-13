#!/usr/bin/env node
/** Full-component fixture through public planning, compilation and offline packaging. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import * as panel from '../src/index.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {request,intent,expectedTypes} from '../examples/all-components-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
import {digestBytes} from '../src/canonical.mjs';
const args=process.argv.slice(2);assert(args.length===2&&args[0]==='--output','ALL_COMPONENTS_ARGUMENTS');
const output=await createOutputDirectory(args[1]),core=await loadWorkspaceCore(),catalog=await readJson(resolve(harnessRoot,'examples/modern-all-components.catalog.json'));
const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),artifacts=[];
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
for(const mode of ['light','dark']){
 const model=await createWorkbenchModel({catalog,pool:await imageAssetPool()},core);
 try{
  const {context}=await model.prepare(request),authored=intent(context,{mode}),proposal=await materializePanelIntent(context,authored);
  const {panel:bundle}=await model.acceptProposal(proposal);assert.deepEqual([...new Set(flatten(bundle.componentBundle.document.root).map(node=>node.type))].sort(),expectedTypes);
  const kit=await createUnityKitFiles(bundle,core,sources),delivery=await panel.createPanelDelivery(bundle,core,{runtime,unityKit:kit});
  const zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeFile(resolve(output,mode+'.zip'),zip,{flag:'wx'});
  // Extract the actual ZIP, so browser acceptance exercises the delivered bytes.
  for(const [name,bytes]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(part=>part&&!['.','..'].includes(part)));const file=resolve(output,mode,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
  await writeNewJson(output,mode+'.fixture.intent.json',authored);
  artifacts.push({id:mode,panelSha256:bundle.sha256,types:expectedTypes,zipBytes:zip.length,zipSha256:await digestBytes(zip),fileChecks:delivery.manifest.files.length});
 }finally{model.dispose();}
}
await writeFile(resolve(output,'index.html'),'<!doctype html><meta charset="utf-8"><title>16 种组件验收</title><h1>16 种组件验收</h1><p>确定性输入，真实 Pixi 运行时。切换页签体验基础控件、选择控件和模态弹窗。</p><p><a href="light/pixi/index.html">浅色试玩</a> · <a href="dark/pixi/index.html">深色试玩</a></p><p><a href="light.zip" download>浅色交付 ZIP</a> · <a href="dark.zip" download>深色交付 ZIP</a></p><p>程序夹具，模型调用 0。Unity 原生导入尚未运行。</p>',{flag:'wx'});
await writeNewJson(output,'acceptance.json',{status:'PASS',kind:'ALL_16_COMPONENTS_FIXTURE',artifacts,realModelCalls:0,browser:'NOT_RUN',unityNative:'NOT_RUN',productionRelease:false});
console.log(JSON.stringify({status:'PASS',types:expectedTypes.length,output}));
