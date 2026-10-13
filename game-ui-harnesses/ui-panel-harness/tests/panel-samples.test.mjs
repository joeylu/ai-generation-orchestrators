import test from 'node:test';
import assert from 'node:assert/strict';
import * as panel from '../src/index.mjs';
import {core} from './helpers.mjs';
import {readJson} from '../src/io.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {sampleCases,sampleRequest,sampleIntent,expectedKinds} from '../examples/panel-samples-v1/fixture.mjs';
import {flatten} from '../examples/image-slots-v1/fixture.mjs';
const catalog=await readJson(new URL('../examples/modern-image-slots.catalog.json',import.meta.url));
for(const item of sampleCases)test(`representative fixture ${item.id}: current public generation path and independent facts in both modes`,async()=>{
  for(const mode of ['light','dark']){
    const model=await createWorkbenchModel({catalog,pool:null},core);
    try{
      const {context}=await model.prepare(sampleRequest(item)),proposal=await materializePanelIntent(context,sampleIntent(context,item,mode));
      assert.equal((await panel.checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');
      const result=await model.acceptProposal(proposal),bundle=result.panel,rows=bundle.spec.sections.flatMap(section=>section.rows);
      assert.equal(result.phase,'ready');assert.equal(bundle.compilerVersion,'0.29.0');
      assert.deepEqual(rows.map(row=>row.kind),expectedKinds[item.id]);assert.equal(model.getEditBudget().used,0);
      if(item.id==='audio'){assert.deepEqual(bundle.state,{row0:70,row1:40,row2:false});assert.deepEqual(rows[3].action.fields,['row0','row1','row2']);}
      if(item.id==='form'){assert.deepEqual(bundle.state,{row1:''});assert.deepEqual(rows[3].action,{kind:'submit',fields:['row1']});assert.equal(bundle.spec.state[0].maxLength,12);}
      if(item.id==='roles'){
        const copy=flatten(bundle.componentBundle.document.root).filter(node=>node.type==='Text').map(node=>node.props.text);
        for(const name of ['战士','魔法师','弓箭手'])assert.equal(copy.filter(text=>text.includes(name)).length,1);
        assert.equal(bundle.actions.length,3);assert.deepEqual(bundle.state,{});
      }
      if(item.id==='progress'){assert.deepEqual(bundle.state,{row1:57});assert.equal(bundle.bindings[0].readOnly,true);}
      if(item.id==='tabs'){assert.deepEqual(bundle.state,{navigation:'page0',row1:'',row2:'option0',row5:57,row6:false,row7:57});assert.equal(bundle.spec.tabs.pages.length,2);assert.deepEqual(rows[4].action.fields,['row1']);}
      assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
      assert.equal((await panel.createUnityDocument(bundle,core)).panelSpecVersion,'0.15');
    }finally{model.dispose();}
  }
});
test('representative Tabs keep Select changes separate from the input-only submit contract',async()=>{
  const item=sampleCases.find(item=>item.id==='tabs'),context=await panel.createPlanningContext(sampleRequest(item),catalog),invalid=sampleIntent(context,item);
  invalid.panel.body.pages[0].body.children[0].rows[4].submitRows.push(2);
  await assert.rejects(materializePanelIntent(context,invalid),{code:'INTENT_SUBMIT_REQUIRES_INPUT'});
});
