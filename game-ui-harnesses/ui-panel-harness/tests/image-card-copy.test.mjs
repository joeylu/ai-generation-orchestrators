import test from 'node:test';
import assert from 'node:assert/strict';
import * as panel from '../src/index.mjs';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {imageSpec,conciseRoleSpec,conciseRoleIntent,imageRequest,flatten} from '../examples/image-slots-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {workbenchAssetInputs,workbenchRetrieval} from '../src/workbench-assets.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {digestJson} from '../src/canonical.mjs';

const catalog=await readJson(new URL('../examples/modern-image-slots.catalog.json',import.meta.url));
const core=await loadWorkspaceCore(),pool=await imageAssetPool(),names=['战士','魔法师','弓箭手'];
const copy=bundle=>flatten(bundle.componentBundle.document.root).filter(node=>node.type==='Text').map(node=>node.props.text);

test('concise role cards show one name each; both modes retain three actions with or without PNGs',async()=>{
  for(const mode of ['light','dark'])for(const bound of [false,true]){
    const spec=conciseRoleSpec(panel,catalog,{mode});
    if(bound){
      spec.assets={library:{id:pool.index.id,sha256:pool.index.sha256},panelSurface:null,rowIcons:[]};
      spec.sections.forEach((section,index)=>{section.rows[0].source=pool.index.records[index].key;section.rows[0].label='肖像';});
    }
    const bundle=await panel.createPanelBundle(spec,catalog,core,undefined,bound?await workbenchAssetInputs(spec,pool):undefined);
    const old=await panel.createPanelBundle(imageSpec(panel,catalog,{mode,cards:true}),catalog,core);
    for(const name of names)assert.equal(copy(bundle).filter(text=>text.includes(name)).length,1);
    assert(!copy(bundle).includes('角色'));assert.deepEqual(bundle.state,{});assert.deepEqual(bundle.actions,old.actions);
    assert.deepEqual(spec.sections.map(section=>section.rows[1].buttonLabel),['选择','选择','选择']);
    assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
    const native=await panel.createUnityDocument(bundle,core);
    for(const name of names)assert.equal(native.nodes.filter(node=>node.text.includes(name)).length,1);
    assert.equal(native.controls.length,3);
  }
});

test('native concise intent compiles directly and preserves every role identity without duplicate Text rows',async()=>{
  for(const bound of [false,true]){
    const retrieval=bound?workbenchRetrieval(imageRequest.text,pool,{images:true}):null;
    const context=await panel.createPlanningContext(imageRequest,catalog,retrieval);
    const proposal=await materializePanelIntent(context,conciseRoleIntent(context,{source:bound?pool.index.records.map(record=>record.key):null}));
    assert.equal((await panel.checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');
    assert.deepEqual(proposal.spec.sections.map(section=>section.title),names);
    assert(proposal.spec.sections.every(section=>section.rows.length===2&&section.rows[0].kind==='image'&&section.rows[1].kind==='button'));
    const bundle=await panel.createPanelBundle(proposal.spec,catalog,core,undefined,bound?await workbenchAssetInputs(proposal.spec,pool):undefined);
    for(const name of names)assert.equal(copy(bundle).filter(text=>text.includes(name)).length,1);
    assert.equal(bundle.actions.length,3);
  }
});

test('ordinary image edits retain existing explicit repeated copy instead of silently enforcing the new default',async()=>{
  const before=await panel.createPanelBundle(imageSpec(panel,catalog,{cards:true}),catalog,core);
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(before);
  await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(before.spec),reason:'只改战士肖像高度',operations:[{op:'set-image-properties',rowId:'portrait0',source:null,width:'fill',height:200,fit:'contain',assetLibrary:null}]});
  const after=model.getSnapshot().panel;
  assert.deepEqual(copy(after),copy(before));assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.state,before.state);
  assert.deepEqual(after.spec.sections.slice(1),before.spec.sections.slice(1));model.dispose();
});
