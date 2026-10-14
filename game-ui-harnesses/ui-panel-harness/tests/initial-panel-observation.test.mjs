import test from 'node:test';
import assert from 'node:assert/strict';
import {observeInitialPanel} from '../scripts/lib/initial-panel-observation.mjs';
test('initial observation detects a partly clipped footer despite a button lying inside the outer panel',()=>{
  const bundle={state:{},spec:{id:'p',canvas:{width:500,height:500},sections:[{id:'s',rows:[{id:'r',kind:'button',buttonLabel:'关闭',enabled:true}]}],tabs:null},
    componentBundle:{document:{root:{id:'p.panel',type:'Panel',children:[{id:'p.body',type:'ScrollView',layout:{height:100},props:{contentHeight:108}}]}}}};
  const nodes=[{id:'p.panel',bounds:{x:0,y:0,width:500,height:500}},{id:'p.body',bounds:{x:0,y:0,width:400,height:100}},{id:'p.row.r.control',bounds:{x:20,y:56,width:100,height:52}}];
  const before=structuredClone(bundle),result=observeInitialPanel(bundle,{nodes});
  assert.deepEqual(result.clippedButtons,['p.row.r.control']);assert.deepEqual(result.buttons[0].issues,['CLIPPED_BY:p.body']);assert.deepEqual(bundle,before);
  nodes.at(-1).bounds.y=48;assert.deepEqual(observeInitialPanel(bundle,{nodes}).clippedButtons,[]);
});
test('inactive tab buttons are not misreported as missing first-screen controls',()=>{
  const bundle={state:{page:'a'},spec:{id:'p',canvas:{width:500,height:500},tabs:{bind:'page',pages:[{id:'a',sections:['s1']},{id:'b',sections:['s2']}]},
    sections:[{id:'s1',rows:[{id:'r1',kind:'button',buttonLabel:'确认',enabled:true}]},{id:'s2',rows:[{id:'r2',kind:'button',buttonLabel:'返回',enabled:true}]}]},componentBundle:{document:{root:{type:'Container',id:'p.canvas'}}}};
  const result=observeInitialPanel(bundle,{nodes:[{id:'p.row.r1.control',bounds:{x:20,y:20,width:100,height:52}}]});
  assert.deepEqual(result.buttons.map(button=>button.id),['p.row.r1.control']);assert.deepEqual(result.clippedButtons,[]);
});
