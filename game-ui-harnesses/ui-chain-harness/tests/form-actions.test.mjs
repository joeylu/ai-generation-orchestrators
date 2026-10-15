import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateFormActions,validateFormActionPolicy} from '../src/panel/form-actions.mjs';
import {actionPlanningFiles} from '../src/panel/action-model.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {editorData} from '../src/panel/data.mjs';
const policy={version:'1.0',defaultScope:'all-value-rows'};
const fields=[{id:'row0',type:'input',label:'昵称'},{id:'row1',type:'select',label:'语言'},{id:'row2',type:'check-box',label:'公开资料'},{id:'row3',type:'text',label:'说明'},{id:'row4',type:'progress-bar',label:'进度'}];
const action=(label,kind,targets)=>({id:'row5',label,action:kind,targets});
const run=(actions,request='资料表单，昵称、语言与公开资料，底部提交和重置。',other={})=>validateFormActions({policy,fields,request,actions,...other});

test('whole form submit/reset cover all value kinds across groups and exclude prose/progress',()=>{
 const values=[...fields,{id:'row6',type:'switch',label:'音乐'},{id:'row7',type:'slider',label:'音量'}],ids=['row0','row1','row2','row6','row7'];
 assert.doesNotThrow(()=>run([action('提交','submit',ids),action('重置全部','reset-initial',[...ids].reverse())],undefined,{fields:values}));
});
test('real incomplete-submit and emit-instead-of-submit failures reject without repairing input',()=>{
 for(const a of [action('提交','submit',['row0']),action('提交全部','emit',[]),action('重置全部','reset-initial',['row0'])]){
  const before=structuredClone(a);assert.throws(()=>run([a]),{code:'panel.action-form-scope'});assert.deepEqual(a,before);
 }
});
test('explicit field names in original request preserve exact partial submission',()=>{
 assert.doesNotThrow(()=>run([action('保存','submit',['row0'])],'左右资料与开关，底部重置指定字段和提交昵称。'));
 assert.doesNotThrow(()=>run([action('保存','submit',['row0','row1'])],'保存按钮只提交昵称和语言。'));
 assert.throws(()=>run([action('保存','submit',['row0','row1','row2'])],'保存按钮只提交昵称和语言。'),{code:'panel.action-form-scope'});
 assert.throws(()=>run([action('提交全部','submit',['row0'])],'提交昵称和语言，另有提交全部。'),{code:'panel.action-form-scope'});
});
test('per-group/limited requests and deliberately data-free events remain supported',()=>{
 const layoutBody={kind:'row',children:[{kind:'section',rowIds:['row0','row5']},{kind:'section',rowIds:['row1','row2']}]};
 assert.doesNotThrow(()=>run([action('保存','submit',['row0'])],'每组各自保存当前字段。',{layoutBody}));
 assert.throws(()=>run([action('保存','submit',['row1'])],'每组各自保存当前字段。',{layoutBody}),{code:'panel.action-form-scope'});
 assert.throws(()=>run([action('重置','reset-initial',['row0'])],'重置指定字段。'),{code:'panel.action-form-scope'});
 assert.doesNotThrow(()=>run([action('提交','emit',[])],'提交按钮只发出不带数据的本地事件。'));
 assert.throws(()=>run([action('提交','emit',[])],'帮助按钮只发出不带数据的本地事件；表单提交全部资料。'),{code:'panel.action-form-scope'});
});
test('separate submit/save instructions retain their own named scope',()=>{
 const actions=[action('提交','submit',['row0']),{...action('保存','submit',['row1']),id:'row6'}];
 assert.doesNotThrow(()=>run(actions,'提交昵称，保存语言。'));
 assert.throws(()=>run(actions.map(a=>({...a,targets:['row0','row1']})),'提交昵称，保存语言。'),{code:'panel.action-form-scope'});
 assert.doesNotThrow(()=>run([action('提交','submit',['row0'])],'底部提交指定的昵称。'));
 assert.throws(()=>run([action('提交','submit',['row1'])],'底部提交指定的昵称。'),{code:'panel.action-form-scope'});
});
test('per-group named fields resolve inside their owner and an unowned footer is not all groups',()=>{
 const duplicate=[{id:'row0',type:'input',label:'昵称'},{id:'row1',type:'input',label:'昵称'}],actions=[{id:'row2',label:'保存',action:'submit',targets:['row0']},{id:'row3',label:'保存',action:'submit',targets:['row1']}];
 const body={kind:'row',children:[{kind:'section',rowIds:['row0','row2']},{kind:'section',rowIds:['row1','row3']}]};
 assert.doesNotThrow(()=>run(actions,'两组都叫昵称，分别保存本组昵称。',{fields:duplicate,layoutBody:body}));
 const footer={kind:'column',children:[{kind:'section',rowIds:['row0']},{kind:'section',rowIds:['row1']},{kind:'section',rowIds:['row2']}]};
 assert.throws(()=>run([{...actions[0],targets:['row0','row1']}],'两个资料组，每组各自保存当前字段。',{fields:duplicate,layoutBody:footer}),{code:'panel.action-form-scope'});
});
test('incidental after-submit prose cannot exempt a form action and information captions are checked',()=>{
 const text='表单提交全部资料，提交后帮助按钮只发出不带数据的本地事件。';
 assert.throws(()=>run([action('提交','emit',[])],text),{code:'panel.action-form-scope'});
 assert.doesNotThrow(()=>run([action('提交','submit',['row0','row1','row2'])],text));
 assert.throws(()=>run([action('提交全部信息','emit',[])],'底部提交全部信息。'),{code:'panel.action-form-scope'});
 assert.throws(()=>run([action('提交全部信息','submit',['row0'])],'底部提交全部信息。'),{code:'panel.action-form-scope'});
});
test('ordinary local emits and value-free panels do not acquire form behavior',()=>{
 assert.doesNotThrow(()=>run([action('查看','emit',[])]));
 assert.doesNotThrow(()=>run([action('保存','emit',[])],'文字说明与保存按钮。',{fields:fields.filter(f=>f.type==='text')}));
});
test('legacy configs remain unchanged; the new policy is digest-bound with a versioned prompt',async()=>{
 assert.doesNotThrow(()=>run([action('提交','submit',['row0'])],undefined,{policy:undefined}));
 assert.throws(()=>validateFormActionPolicy({...policy,version:'future'}),{code:'panel.action-form-policy'});
 const base=JSON.parse(await readFile(new URL('../configs/action-presets.json',import.meta.url))),current=customActionConfig(base),old=structuredClone(current);
 delete old.presets.custom.formActions;
 assert.equal(actionPlanningFiles('custom',old).instructions,'prompts/custom-panel-planner-v3.md');
 assert.equal(actionPlanningFiles('custom',current).instructions,'prompts/custom-panel-planner.md');
 const archived=await readFile(new URL('../prompts/custom-panel-planner-v3.md',import.meta.url),'utf8'),fresh=await readFile(new URL('../prompts/custom-panel-planner.md',import.meta.url),'utf8');
 assert(!archived.includes('ordinary form-level'));assert(fresh.includes('ordinary form-level'));
});
test('the real converter rejects a missing whole-form target before publishing documents',async()=>{
 const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url))),config=customActionConfig(await read('../configs/action-presets.json')),[example]=await read('../examples/custom-panel.json'),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json'),ctx=await editorData();
 const fixture=await actionFixture(example,catalog,config),bad=structuredClone(fixture.intent),save=bad.panel.body.children[0].rows.find(r=>r.kind==='button'&&r.action==='submit');
 save.submitRows=[1];const before=structuredClone(bad);
 await assert.rejects(()=>actionPresetFromIntent(fixture.session,bad,config,'custom',ctx),{code:'panel.action-form-scope'});assert.deepEqual(bad,before);
 const legacy=structuredClone(config);delete legacy.presets.custom.formActions;
 const old=await actionPresetFromIntent(fixture.session,bad,legacy,'custom',ctx);assert.deepEqual(old.behavior.actions.find(a=>a.action==='submit').targets,['row1']);
});
