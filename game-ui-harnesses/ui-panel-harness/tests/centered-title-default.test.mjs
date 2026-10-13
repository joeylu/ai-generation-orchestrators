import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {alignPanelTitle} from '../src/panel-visuals.mjs';
import {effectivePanelTitleStyle} from '../src/title-bar.mjs';
import {REFERENCE_EIGHT_CASES} from '../examples/reference-eight-v1/suite.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
const empty={horizontalAlign:null,verticalAlign:null,backgroundColor:null,textColor:null,cornerRadius:null,fontSize:null,padding:0};
for(const item of REFERENCE_EIGHT_CASES)test(`${item.id}: default main title centers, while controls and business facts remain intact`,async()=>{
  const context=await createPlanningContext(item.request,catalog),{spec}=await materializePanelIntent(context,referenceIntent(context,item));
  const fresh=await createPanelBundle(spec,catalog,core),legacy=await createPanelBundle(spec,catalog,core,undefined,undefined,'0.31.0');
  assert.equal(fresh.compilerVersion,'0.32.0');assert.equal(effectivePanelTitleStyle(fresh).horizontalAlign,'center');
  assert.deepEqual(fresh.spec,legacy.spec);assert.deepEqual(fresh.state,legacy.state);assert.deepEqual(fresh.actions,legacy.actions);
  assert.deepEqual(fresh.componentBundle,legacy.componentBundle);
  assert.deepEqual(await validatePanelBundle(legacy,core),legacy);
  const unity=await createUnityDocument(fresh,core),title=unity.nodes.find(node=>node.id===`${spec.id}.title`);
  assert.equal(title.textAlignment,'MiddleCenter');
  if(!spec.sections.every(section=>section.rows.every(row=>row.kind==='button'))){
    const prior=await createUnityDocument(legacy,core);assert.notEqual(prior.nodes.find(node=>node.id===`${spec.id}.title`).textAlignment,'MiddleCenter');
  }
  const calls=[],box={x:30,y:20,width:400,height:40},glyph={x:30,y:20,width:80,height:26};
  alignPanelTitle(fresh,{inspect:()=>({nodes:[{id:`${spec.id}.title`,bounds:box,renderedTextBounds:[{bounds:glyph}]}]}),applyMotion:(id,value)=>calls.push(value)});
  assert.equal(glyph.x+calls[0].x+glyph.width/2,box.x+box.width/2);
  assert.equal(glyph.y+calls[0].y+glyph.height/2,box.y+box.height/2);
});
test('explicit left/right alignment wins and inherited axes use the versioned default',()=>{
  for(const horizontalAlign of ['left','center','right'])assert.equal(effectivePanelTitleStyle({compilerVersion:'0.32.0',spec:{titleBar:{...empty,horizontalAlign}}}).horizontalAlign,horizontalAlign);
  const b={compilerVersion:'0.32.0',spec:{titleBar:{...empty,textColor:'#123456',verticalAlign:'bottom'}}};
  assert.deepEqual(effectivePanelTitleStyle(b),{...b.spec.titleBar,horizontalAlign:'center'});
  assert.equal(effectivePanelTitleStyle({compilerVersion:'0.31.0',spec:{titleBar:null,sections:[{rows:[{kind:'text'}]}]}}),null);
});
