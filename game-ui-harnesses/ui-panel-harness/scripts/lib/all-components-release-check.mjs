import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {request,intent,expectedTypes} from '../../examples/all-components-v1/fixture.mjs';
import {imageAssetPool} from '../../examples/image-slots-v1/assets.mjs';
import {readStoredZip} from '../../tests/unity-kit-helpers.mjs';
import {digestBytes} from '../../src/canonical.mjs';

/** Installed SDK, exact pinned Component release and fake CLI transports only. */
export async function checkInstalledComponents(sdk,output,options){
 const directory=resolve(output,'all-components');await mkdir(directory,{recursive:true});const artifacts=[],checks=[];
 for(const mode of ['light','dark']){
  const model=await sdk.createWorkbenchModel({catalog:sdk.seed.catalog,pool:await imageAssetPool()},sdk.core);
  try{
   const {context}=await model.prepare(request),planned=await sdk.planner.planWithCodex(context,options(intent(context,{mode})));
   assert.equal(planned.receipt.invocationCount,1);assert.equal(planned.receipt.automaticRetries,0);await model.acceptProposal(planned.proposal);
   const editRequest={...request,text:'把弹窗正文改为“确认后返回面板。”，其他不变。'},editing=(await model.prepareEdit(editRequest,{rowId:'row11'})).context;
   const row=model.getSnapshot().panel.spec.sections.flatMap(section=>section.rows).find(row=>row.id==='row11');
   const draft={codexEditDraftVersion:'0.3',contextSha256:editing.sha256,unresolved:[],noChange:null,
    patch:{patchVersion:'0.1',baseSpecSha256:editing.baseSpecSha256,reason:editRequest.text,operations:[{op:'set-dialog-properties',rowId:row.id,title:row.title,text:'确认后返回面板。',closeLabel:row.closeLabel,modal:row.modal,dialogWidth:row.dialogWidth,dialogHeight:row.dialogHeight}]},bases:[{kind:'request-interpretation',quote:editRequest.text}]};
   const edited=await sdk.planner.editWithCodex(editing,options(draft));await model.acceptEditProposal(edited.proposal);
   const bundle=await model.exportPanel();assert.equal(bundle.spec.sections.flatMap(section=>section.rows).find(row=>row.id==='row11').text,'确认后返回面板。');
   const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];assert.deepEqual([...new Set(flatten(bundle.componentBundle.document.root).map(node=>node.type))].sort(),expectedTypes);
   const native=await sdk.panel.createUnityDocument(bundle,sdk.core);assert.deepEqual([...new Set(native.nodes.map(node=>node.type))].sort(),expectedTypes);
   const kit=await sdk.delivery.createUnityKitFiles(bundle,sdk.core,sdk.delivery.sources),delivery=await sdk.delivery.createPanelDelivery(bundle,sdk.core,{runtime:sdk.delivery.runtime,unityKit:kit});
   const zip=sdk.delivery.createStoredZip(delivery.contents),files=readStoredZip(zip);
   for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
   await writeFile(resolve(directory,mode+'.zip'),zip,{flag:'wx'});
   for(const [name,bytes] of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(part=>part&&!['.','..'].includes(part)));const path=resolve(directory,mode,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}
   artifacts.push({id:mode,panelSha256:bundle.sha256,types:expectedTypes,zipBytes:zip.length,zipSha256:await digestBytes(zip),fileChecks:delivery.manifest.files.length});
   checks.push({name:'installed-all-sixteen-generation-edit-and-delivery-'+mode,status:'PASS'});
  }finally{model.dispose();}
 }
 await writeFile(resolve(directory,'index.html'),'<!doctype html><meta charset="utf-8"><title>16 种组件安装包验收</title><h1>16 种组件安装包验收</h1><p><a href="light/pixi/index.html">浅色试玩</a> · <a href="dark/pixi/index.html">深色试玩</a></p><p><a href="light.zip" download>浅色 ZIP</a> · <a href="dark.zip" download>深色 ZIP</a></p>',{flag:'wx'});
 await writeFile(resolve(directory,'acceptance.json'),JSON.stringify({status:'PASS',kind:'INSTALLED_ALL_16_COMPONENTS_FIXTURE',artifacts,realModelCalls:0,browser:'NOT_RUN',unityNative:'NOT_RUN'},null,2)+'\n',{flag:'wx'});
 return checks;
}
