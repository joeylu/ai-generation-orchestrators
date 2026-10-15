import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {request,inventoryIntent} from '../../examples/inventory-grid-v1/fixture.mjs';
import {digestBytes} from '../../src/canonical.mjs';
import {readStoredZip} from '../../tests/unity-kit-helpers.mjs';

/** Exercise the installed portable SDK only; supplied transport is always a test double. */
export async function checkInstalledInventory(sdk,output,options){
 const model=await sdk.createWorkbenchModel(sdk.seed,sdk.core);
 try{
  const {context}=await model.prepare(request),planned=await sdk.planner.planWithCodex(context,options(inventoryIntent(context)));
  assert.equal(planned.receipt.invocationCount,1);assert.equal(planned.receipt.automaticRetries,0);
  await model.acceptProposal(planned.proposal);const original=await model.exportPanel();assert.equal(original.compilerVersion,'0.46.0');assert.equal(original.panelBundleVersion,'0.17');
  const flat=node=>[node,...(node.children??[]).flatMap(flat)];assert.equal(flat(original.componentBundle.document.root).filter(node=>node.type==='Button'&&/\.slot\.\d+$/.test(node.id)).length,100);
  const editing=(await model.prepareEdit({...request,text:'把仓库改成8行6列'},{rowId:'row0'})).context;
  const operation={op:'set-inventory',rowId:'row0',grid:{...sdk.panel.DEFAULT_GRID,rows:8,columns:6},items:[],selectedSlot:null,assetLibrary:null};
  const draft={codexEditDraftVersion:'0.3',contextSha256:editing.sha256,patch:{patchVersion:'0.1',baseSpecSha256:editing.baseSpecSha256,reason:editing.request.text,operations:[operation]},bases:[{kind:'request-interpretation',quote:editing.request.text}],unresolved:[],noChange:null};
  const edited=await sdk.planner.editWithCodex(editing,options(draft));await model.acceptEditProposal(edited.proposal);assert.equal((await model.exportPanel()).spec.state[0].options.length,49);await model.undo();assert.deepEqual(await model.exportPanel(),original);
  const native=await sdk.panel.createUnityDocument(original,sdk.core);assert.equal(native.adapterVersion,'0.1.9');assert.equal(native.controls[0].kind,'inventory');assert.equal(native.fields[0].options.length,101);
  const kit=await sdk.delivery.createUnityKitFiles(original,sdk.core,sdk.delivery.sources),delivery=await sdk.delivery.createPanelDelivery(original,sdk.core,{runtime:sdk.delivery.runtime,unityKit:kit});
  const bytes=sdk.delivery.createStoredZip(delivery.contents),files=readStoredZip(bytes);for(const file of delivery.manifest.files)assert.equal(await digestBytes(files.get(file.path)),file.sha256);
  await writeFile(resolve(output,'inventory-delivery.zip'),bytes,{flag:'wx'});
  for(const [name,data]of files)if(name.startsWith('pixi/')){const target=resolve(output,'inventory',name);await mkdir(dirname(target),{recursive:true});await writeFile(target,data,{flag:'wx'});}
  assert.equal(delivery.manifest.verification.unityImport,'NOT_RUN');await sdk.panel.validatePanelBundle(JSON.parse(new TextDecoder().decode(files.get('pixi/panel.bundle.json'))),sdk.core);
  return[{name:'installed-inventory-native-generation-edit-undo-100-slots-and-hashed-web-ugui-delivery',status:'PASS'}];
 }finally{model.dispose();}
}
