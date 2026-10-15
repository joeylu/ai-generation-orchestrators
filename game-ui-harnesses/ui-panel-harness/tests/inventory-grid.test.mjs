import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent,buildNativePanelIntentResponseSchema,validateNativePanelIntentEvidence} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {validatePanelSpec} from '../src/spec.mjs';
import {projectPanelEvent,attachPanelSession} from '../src/state.mjs';
import {controlId} from '../src/compiler.mjs';
import {DEFAULT_GRID,measureUniformGrid,explicitInventoryDimensions} from '../src/uniform-grid.mjs';
import {inventoryCellId,inventoryMarkerId} from '../src/inventory-grid.mjs';
import {request,inventoryIntent} from '../examples/inventory-grid-v1/fixture.mjs';
import {core,nodesOf} from './helpers.mjs';
import {createPanelEditContext,validatePanelEditContext} from '../src/edit-planning.mjs';
import {buildCodexEditResponseSchema} from '../src/codex-edit-schema.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {digestJson} from '../src/canonical.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchRetrieval,workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createPanelIntegrationContract} from '../src/panel-delivery.mjs';
const catalog=await readJson(new URL('../examples/modern-readable-game-grid-layout.catalog.json',import.meta.url));
async function make(options={},text=request.text){const context=await createPlanningContext({...request,text},catalog);const proposal=await materializePanelIntent(context,inventoryIntent(context,options));return {context,proposal,bundle:await createPanelBundle(proposal.spec,catalog,core)};}

test('uniform grid makes exactly 100 distinct rectangles with independent spacing and padding',()=>{
 const measured=measureUniformGrid({...DEFAULT_GRID,rows:10,columns:10});
 assert.equal(measured.count,100);assert.equal(measured.width,808);assert.equal(measured.height,808);
 assert.equal(new Set(measured.cells.map(cell=>cell.x+','+cell.y)).size,100);
 assert.deepEqual(measured.cells[99],{slot:99,row:9,column:9,x:728,y:728,width:72,height:72});
 const vertical=measureUniformGrid({...DEFAULT_GRID,rows:2,columns:3,startAxis:'vertical',startCorner:'lower-right'});
 assert.deepEqual(vertical.cells.map(cell=>[cell.row,cell.column]),[[1,2],[0,2],[1,1],[0,1],[1,0],[0,0]]);
});
test('grid rejects unsafe capacities, unreadable cells and invented properties',()=>{
 for(const change of [{rows:0},{rows:13,columns:13},{cellWidth:20},{rows:1.5},{spacingX:-1},{foo:true}])assert.throws(()=>measureUniformGrid({...DEFAULT_GRID,...change}));
});
test('literal dimensions recognize short aliases and preserve row/column meaning',()=>{
 for(const text of ['帮我生成一个10X10的仓库面板','做个10×10背包','inventory 10 x 10','仓库10行10列'])assert.deepEqual(explicitInventoryDimensions(text),{rows:10,columns:10});
 assert.deepEqual(explicitInventoryDimensions('仓库8列5行'),{rows:5,columns:8});
 assert.equal(explicitInventoryDimensions('仓库标题“10x10”，使用默认格子'),null);
 assert.equal(explicitInventoryDimensions('仓库10x10还是8x8'),null);
});
test('native schema exposes a compact grid declaration; 100 empty slots compile and reopen exactly',async()=>{
 const {context,bundle}=await make();assert.equal(context.planningContextVersion,'0.12');
 const schema=buildNativePanelIntentResponseSchema(context);assert.deepEqual(schema.properties.panelIntentVersion.enum,['0.13']);
 assert(schema.$defs.body.anyOf[0].properties.rows.items.anyOf.some(row=>row.properties.kind.enum.includes('inventory')));
 assert.equal(bundle.spec.panelSpecVersion,'0.17');assert.equal(bundle.panelBundleVersion,'0.17');assert.equal(bundle.compilerVersion,'0.46.0');
 const nodes=nodesOf(bundle.componentBundle.document),id=controlId(bundle.spec.id,'row0');
 assert.equal(nodes.filter(node=>node.type==='Button'&&node.id.startsWith(id+'.slot.')).length,100);
 assert.equal(nodes.filter(node=>node.type==='Panel'&&node.id.startsWith(id+'.slot.')).length,100);
 assert.equal(bundle.spec.sections[0].rows[0].items.length,0);assert.equal(bundle.spec.state.length,1);assert.equal(bundle.spec.state[0].options.length,101);
 assert.deepEqual(await validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
});
test('explicit 10x10 cannot silently become 8x8 or a 64-item text List',async()=>{
 const context=await createPlanningContext(request,catalog);
 await assert.rejects(materializePanelIntent(context,inventoryIntent(context,{rows:8,columns:8})),error=>error.code==='INVENTORY_DIMENSIONS');
  const list=inventoryIntent(context);list.panel.body.children[0].rows=[{kind:'list',label:'仓库',recipeKey:'content.list@0.1.0',enabled:true,sourceRef:'request',icon:null,options:[{label:'物品',initial:true}],itemHeight:40,visibleItems:4}];
  await assert.rejects(materializePanelIntent(context,list),error=>error.code==='INVENTORY_DIMENSIONS');
});
test('first and last slots select independently; disabled cells and programmatic clicks do not emit business events',async()=>{
 const {bundle}=await make(),spec=bundle.spec,id=controlId(spec.id,'row0');
 const first=projectPanelEvent(spec,bundle.state,{id:inventoryCellId(id,0),type:'activate',source:'mouse'});assert.equal(first.state.row0,'slot0');assert.equal(first.event.slot,0);assert.equal(first.event.empty,true);
 const last=projectPanelEvent(spec,first.state,{id:inventoryCellId(id,99),type:'activate',source:'keyboard'});assert.equal(last.state.row0,'slot99');assert.equal(last.event.slot,99);
 assert.equal(projectPanelEvent(spec,last.state,{id:inventoryCellId(id,99),type:'activate',source:'touch'}).event,null);
 assert.equal(projectPanelEvent(spec,bundle.state,{id:inventoryCellId(id,1),type:'activate',source:'control'}).event,null);
 const disabled=structuredClone(spec);disabled.sections[0].rows[0].enabled=false;assert.equal(projectPanelEvent(disabled,bundle.state,{id:inventoryCellId(id,1),type:'activate',source:'mouse'}).event,null);
});
test('session paints selection, restores host state, honors interaction lock and detaches',async()=>{
 const {bundle}=await make(),id=controlId(bundle.spec.id,'row0'),nodes=new Map(nodesOf(bundle.componentBundle.document).map(node=>[node.id,structuredClone(node)])),listeners=new Set(),events=[];
 const runtime={getDocument:()=>bundle.componentBundle.document,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},setValue(id,value){nodes.get(id).props.value=value;},setEnabled(id,value){nodes.get(id).props.enabled=value;}};
 const session=attachPanelSession(bundle.spec,runtime,event=>events.push(event),bundle.state,undefined,catalog);
 const emit=input=>{for(const listener of listeners)listener(input);};
 emit({id:inventoryCellId(id,99),type:'activate',source:'mouse'});assert.equal(session.getState().row0,'slot99');assert.equal(nodes.get(inventoryMarkerId(id,99)).props.value,1);
 session.setState({row0:'slot0'});assert.equal(nodes.get(inventoryMarkerId(id,99)).props.value,0);assert.equal(nodes.get(inventoryMarkerId(id,0)).props.value,1);
 session.setInteractionLocked(true);emit({id:inventoryCellId(id,8),type:'activate',source:'mouse'});assert.equal(session.getState().row0,'slot0');assert.equal(events.length,1);
 session.setInteractionLocked(false);session.destroy();assert.equal(listeners.size,0);
});
test('sparse item indices, selection coverage and quantities are strictly validated',async()=>{
 const {bundle}=await make({items:[{slot:0,name:'治疗药水',quantity:12,icon:null}],selectedSlot:0});
 assert.equal(bundle.state.row0,'slot0');assert.equal(bundle.spec.sections[0].rows[0].items.length,1);
 for(const item of [{slot:100,name:'越界',quantity:1,icon:null},{slot:0,name:'无效数量',quantity:0,icon:null}]){const spec=structuredClone(bundle.spec);spec.sections[0].rows[0].items=[item];assert.throws(()=>validatePanelSpec(spec));}
 const spec=structuredClone(bundle.spec);spec.state[0].options.pop();assert.throws(()=>validatePanelSpec(spec));
});
test('inventory import, native edit schema and grid patch preserve the live selection atomically',async()=>{
 const {bundle}=await make(),model=await createWorkbenchModel({catalog,pool:null},core);
 try{
  await model.importPanel(bundle);const {context}=await model.prepareEdit({...request,text:'把仓库改成8行6列'},{rowId:'row0'});
  assert.equal(context.editContextVersion,'0.17');assert(context.capabilities.operations.includes('set-inventory'));await validatePanelEditContext(context);
  const schema=await buildCodexEditResponseSchema({draft:true,context});assert(Object.values(schema.$defs).some(def=>def.properties?.op?.enum?.includes('set-inventory')));
  const patch={patchVersion:'0.1',baseSpecSha256:await digestJson(bundle.spec),reason:'Explicit grid resize',operations:[{op:'set-inventory',rowId:'row0',grid:{...DEFAULT_GRID,rows:8,columns:6},items:[],selectedSlot:null,assetLibrary:null}]};
  const {spec}=await applyPanelPatch(bundle.spec,patch);assert.equal(spec.state[0].options.length,49);
  await model.patch(patch);const changed=await model.exportPanel();assert.equal(changed.spec.sections[0].rows[0].grid.rows,8);assert.equal(changed.state.row0,'none');
  await model.undo();assert.deepEqual(await model.exportPanel(),bundle);
 }finally{model.dispose();}
});
test('Unity document preserves 100 cells and the selection contract using existing foundation types',async()=>{
 const {bundle}=await make(),native=await createUnityDocument(bundle,core);assert.equal(native.adapterVersion,'0.1.9');assert.equal(native.panelSpecVersion,'0.17');
 assert.equal(native.controls.length,1);assert.equal(native.controls[0].kind,'inventory');assert.equal(native.fields[0].options.length,101);
 assert.equal(native.nodes.filter(node=>node.type==='Button'&&/\.slot\.\d+$/.test(node.id)).length,100);
 assert.equal(native.nodes.filter(node=>node.type==='Panel'&&/\.slot\.\d+\.panel$/.test(node.id)).length,100);
});
test('a full 12x12 collection preserves every sparse item and remains within native component limits',async()=>{
 const items=Array.from({length:144},(_,slot)=>({slot,name:'材料（示例）'+slot,quantity:slot+1,icon:null}));
 const {bundle}=await make({rows:12,columns:12,items},'做个12×12的仓库面板');
 assert.equal(bundle.spec.sections[0].rows[0].items.length,144);assert(nodesOf(bundle.componentBundle.document).length<=1000);
 assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
});

test('the native accepting boundary accepts 0.13 evidence and rejects stale transport headers',async()=>{
 const {context}=await make(),intent=inventoryIntent(context);validateNativePanelIntentEvidence(context,intent);
 assert.throws(()=>validateNativePanelIntentEvidence(context,{...intent,panelIntentVersion:'0.12'}),{code:'INTENT_VERSION'});
});

test('a fixed-height inventory preserves all ten columns after the scroll gutter is reserved',async()=>{
 const {bundle}=await make({layout:{maxHeight:500,canvasHeight:640,overflow:'scroll'}});
 assert.equal(nodesOf(bundle.componentBundle.document).filter(node=>node.type==='Button'&&/\.slot\.\d+$/.test(node.id)).length,100);
 assert(nodesOf(bundle.componentBundle.document).some(node=>node.type==='ScrollView'));
 assert.equal(bundle.spec.layout.maxHeight,500);assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
});

test('inventory item icons use pinned candidates, reopen without a library and publish slot metadata to the game contract',async()=>{
 const pool=await loadBundledCoreAssets(),input={...request,text:'做个2x2仓库，使用确认图标'},context=await createPlanningContext(input,catalog,workbenchRetrieval(input.text,pool,{images:true}));
 const intent=inventoryIntent(context,{rows:2,columns:2,items:[{slot:3,name:'确认图标',quantity:9,icon:'panel-core/confirm@1.0.0'}]}),proposal=await materializePanelIntent(context,intent);
 const bundle=await createPanelBundle(proposal.spec,catalog,core,undefined,await workbenchAssetInputs(proposal.spec,pool));
 assert.equal(bundle.assetClosure.records.length,1);assert(nodesOf(bundle.componentBundle.document).some(node=>node.type==='Image'&&node.id.endsWith('.slot.3.icon')));
 assert.deepEqual(await validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
 const contract=await createPanelIntegrationContract(bundle,core);assert.deepEqual(contract.controls[0].inventory.items,intent.panel.body.children[0].rows[0].items);
 const bad=structuredClone(intent);bad.panel.body.children[0].rows[0].items[0].icon='panel-core/music@1.0.0';await assert.rejects(materializePanelIntent(context,bad),{code:'PLAN_ASSET_CANDIDATE'});
});

test('unsupported three-digit capacities cannot masquerade as a smaller valid grid',async()=>{
 const text='warehouse 100x100';assert.deepEqual(explicitInventoryDimensions(text),{rows:100,columns:100});
 const context=await createPlanningContext({...request,text},catalog);await assert.rejects(materializePanelIntent(context,inventoryIntent(context)),{code:'INVENTORY_DIMENSIONS'});
});

test('public 0.17 schemas advertise the complete inventory catalog and its larger selection domain',async()=>{
 const context=await readJson(new URL('../schemas/panel-edit-context-v0.17.schema.json',import.meta.url)),spec=await readJson(new URL('../schemas/panel-spec-v0.17.schema.json',import.meta.url));
 for(const recipe of catalog.recipes){assert(context.$defs.recipe.properties.kind.enum.includes(recipe.kind));for(const key of Object.keys(recipe))assert(Object.hasOwn(context.$defs.recipe.properties,key),key);}
 for(const theme of catalog.themes)for(const key of Object.keys(theme))assert(Object.hasOwn(context.$defs.theme.properties,key),key);
 assert.equal(spec.$defs.choiceState.properties.options.maxItems,145);assert.equal(spec.$defs.inventoryRow.properties.kind.const,'inventory');
});
