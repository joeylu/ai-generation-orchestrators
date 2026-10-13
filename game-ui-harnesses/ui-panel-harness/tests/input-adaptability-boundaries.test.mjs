import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {explicitComponentRequirements} from '../src/component-capabilities.mjs';
import {newRows,oldRows} from '../examples/all-components-v1/fixture.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';

const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
async function compile(rows,{text='程序化默认布局边界检查。',canvasHeight=null,legacy=false}={}){
  const selected=legacy?await readJson(new URL('../examples/modern-centered-cards.catalog.json',import.meta.url)):catalog;
  const request={requestVersion:'0.1',id:'layout-boundary',target:'pixi',text},context=await createPlanningContext(request,selected);
  const intent=referenceIntent(context,{reference:{title:'默认布局检查',rows}});
  if(legacy)intent.panelIntentVersion='0.11';
  for(const key of ['width','canvasWidth','canvasHeight','maxHeight'])intent.panel.layout[key]=null;
  intent.panel.layout.canvasHeight=canvasHeight;
  const proposal=await materializePanelIntent(context,intent),bundle=await createPanelBundle(proposal.spec,selected,core);
  await validatePanelBundle(bundle,core);return bundle;
}
const choice=(kind,count)=>({...structuredClone(newRows.find(row=>row.kind===kind)),options:Array.from({length:count},(_,i)=>({label:'条目'+i,initial:i===0}))});

test('12 and 64 item Lists share their viewport-based default canvas and compile without popup allowance',async()=>{
  const shorter=await compile([choice('list',12)]),longer=await compile([choice('list',64)]);
  assert.deepEqual(shorter.spec.canvas,longer.spec.canvas);assert(longer.spec.canvas.height<700);
  assert.equal(longer.spec.state[0].options.length,64);
  const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],list=flatten(longer.componentBundle.document.root).find(node=>node.type==='List');
  assert.equal(list.layout.height,64*40);
});

test('visible RadioGroup choices do not reserve dropdown whitespace',async()=>{
  const bundle=await compile([choice('radio',8)]);assert(bundle.spec.canvas.height<700);assert.equal(bundle.spec.state[0].options.length,8);
});

for(const height of [1024,2048])test(`a ${height}px Dialog sizes an unspecified canvas before the fit gate`,async()=>{
  const bundle=await compile([{...newRows[3],dialogHeight:height}]);assert(bundle.spec.canvas.height>=height+64);
  await assert.rejects(compile([{...newRows[3],dialogHeight:height}],{canvasHeight:800}),{code:'dialog-fit'});
});

test('Select keeps popup space and legacy default sizing remains identical',async()=>{
  const row=structuredClone(oldRows.find(row=>row.kind==='select'));row.options=Array.from({length:8},(_,i)=>({label:'条目'+i,initial:i===0}));
  const modern=await compile([row]),legacy=await compile([row],{legacy:true});
  assert.deepEqual(modern.spec.canvas,legacy.spec.canvas);assert(modern.spec.canvas.height>700);
});

for(const [name,text,row] of [
  ['Dialog as checkbox label','生成标题“默认布局检查”的面板，只有 CheckBox，标签逐字为“Dialog”，默认不勾选、启用，不添加其他业务控件。',{...newRows[0],label:'Dialog'}],
  ['List as static copy','生成标题“默认布局检查”的面板，只有只读 Text，标签“术语”，正文逐字为“List”，不要其他业务内容。',{...oldRows.find(row=>row.kind==='text'),label:'术语',text:'List'}],
  ['excluded earlier List','原先说要 List 背包。更正：不需要 List，也不要背包，只有 CheckBox 提示，默认不勾选、启用。',newRows[0]],
])test(`literal requirement guard accepts ${name}`,async()=>{await compile([row],{text});});

test('quoted component references are enforced while quoted instructions remain literal data',()=>{
  assert.deepEqual(explicitComponentRequirements('使用“Dialog”组件，新增“List”控件。'),['list','dialog']);
  assert.deepEqual(explicitComponentRequirements('不要“Dialog”组件。'),[]);
  assert.deepEqual(explicitComponentRequirements('CheckBox 标签“Dialog”。'),['checkbox']);
  assert.deepEqual(explicitComponentRequirements('正文“请使用 List 和 RadioGroup 组件”。'),[]);
  assert.deepEqual(explicitComponentRequirements('原先需要 List。更正：不需要 List；只用 CheckBox。'),['checkbox']);
  assert.deepEqual(explicitComponentRequirements('需要 List，但不要修改 List 的文字；需要 CheckBox，但不能修改 CheckBox 的标题。'),['checkbox','list']);
});
