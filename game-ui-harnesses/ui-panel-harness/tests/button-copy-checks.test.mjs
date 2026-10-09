import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {core} from './helpers.mjs';
import {menuFixture} from '../examples/menu-defaults-v1/fixture.mjs';
import {coverageIntent,INPUT_COVERAGE_V2} from '../examples/input-coverage-v2/suite.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelEditContext,validatePanelEditContext,checkPanelEditProposal} from '../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {digestJson} from '../src/canonical.mjs';
import {editWithCodex} from '../src/codex-planner.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-menu.catalog.json',import.meta.url),'utf8'));
const {spec}=await menuFixture(catalog);
const request=text=>({requestVersion:'0.1',id:'button-copy-edit',target:'pixi',text});
const text='把“继续游戏”按钮文字改为“返回游戏”，其他保持不变。';
const contextFor=(t=text,s=spec,selection=null,policy='properties-v3')=>createPanelEditContext(s,catalog,request(t),selection,{requestChecks:policy});
const rename=(label='返回游戏',rowId='row0')=>({op:'set-button-label',rowId,buttonLabel:label});
const draft=(c,operations=[rename()])=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,
 patch:{patchVersion:'0.1',baseSpecSha256:c.baseSpecSha256,reason:'Authored button copy fixture.',operations},
 bases:operations.map(()=>({kind:'request-interpretation',quote:c.request.text})),unresolved:[],noChange:null});
const noChange=c=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:null,bases:null,unresolved:[],noChange:{reason:'已经符合',quote:c.request.text}});

test('new copy policy pins a stable button ID and leaves the saved v2 interpretation unchanged',async()=>{
 const c=await contextFor();assert.equal(c.editContextVersion,'0.13');assert.equal(c.capabilities.requestCheckPolicy,'explicit-properties-v3');
 assert.equal(c.requestChecks.items.length,1);assert.equal(c.requestChecks.items[0].field,'buttonLabel');assert.equal(c.requestChecks.items[0].target,'row0');
 assert.equal(c.requestChecks.items[0].expected,'返回游戏');assert(c.requestChecks.preserveRest.enforced);assert.deepEqual(await validatePanelEditContext(c),c);
 const old=await contextFor(text,spec,null,'properties-v2');assert.equal(old.editContextVersion,'0.12');assert.equal(old.requestChecks.items.length,0);
 assert(!old.requestChecks.preserveRest.enforced);assert.deepEqual(await validatePanelEditContext(old),old);
});
for(const t of ['把“继续游戏”按钮文字改为“返回游戏”，其他保持不变。','将继续游戏按钮的文案改成「返回游戏」，其余不变。',
 '继续游戏按钮上的文字设为"返回游戏"，其他不变。',"把'继续游戏'按钮文字改为'返回游戏'，其他不变。"])
 test('bounded wording checks the final copy: '+t,async()=>{
  const c=await contextFor(t);assert.equal(c.requestChecks.items[0]?.expected,'返回游戏');assert(c.requestChecks.preserveRest.enforced);
  const p=await materializeCodexEditDraft(c,draft(c));assert.equal((await checkPanelEditProposal(c,p)).requestCheck.status,'MATCHED');
 });
test('quoted labels retain negation, commas, whitespace, emoji and source offsets',async()=>{
 const s=structuredClone(spec);s.sections[0].rows[0].buttonLabel='不要重置，Save 🎵';
 const t='把“不要重置，Save 🎵”按钮文字改为“ 仅返回，Back 🎵 ”，其他不变。',c=await contextFor(t,s);
 const item=c.requestChecks.items[0];assert.equal(item.expected,' 仅返回，Back 🎵 ');assert.equal(t.slice(item.start,item.end),item.quote);
 await materializeCodexEditDraft(c,draft(c,[rename(item.expected)]));
 await assert.rejects(materializeCodexEditDraft(c,draft(c,[rename('返回，Back 🎵')])),{code:'EDIT_REQUEST_INCOMPLETE'});
});
test('missing, wrong-target and false no-change copy results cannot pass',async()=>{
 const c=await contextFor();
 for(const d of [draft(c,[rename('返回')]),draft(c,[rename('返回游戏','row1')]),noChange(c)])
  await assert.rejects(materializeCodexEditDraft(c,d),{code:'EDIT_REQUEST_INCOMPLETE'});
 const already=structuredClone(spec);already.sections[0].rows[0].buttonLabel='返回游戏';
 const done=await contextFor('返回游戏按钮文字改为“返回游戏”，其他不变。',already);
 assert.equal((await checkPanelEditProposal(done,await materializeCodexEditDraft(done,noChange(done)))).status,'NO_CHANGES');
});
test('two explicitly renamed buttons must both match, anchored to their original IDs',async()=>{
 const c=await contextFor('继续游戏按钮文字改为“返回游戏”，设置按钮文案改为“偏好设置”，其他不变。');
 assert.equal(c.requestChecks.items.length,2);assert(c.requestChecks.preserveRest.enforced);
 await assert.rejects(materializeCodexEditDraft(c,draft(c)),{code:'EDIT_REQUEST_INCOMPLETE'});
 await materializeCodexEditDraft(c,draft(c,[rename(),rename('偏好设置','row1')]));
});
test('copy-only preservation rejects styling and other-row changes atomically',async()=>{
 const m=await createWorkbenchModel({catalog,pool:null},core);const before=await createPanelBundle(spec,catalog,core);await m.importPanel(before);
 try{
  const c=(await m.prepareEdit(request(text))).context;
  for(const extra of [{op:'set-button-font-size',rowId:'row0',fontSize:20},{op:'set-row-enabled',rowId:'row1',enabled:false},rename('退出','row2')]){
   await assert.rejects(materializeCodexEditDraft(c,draft(c,[rename(),extra])),{code:'EDIT_REQUEST_INCOMPLETE'});
   assert.deepEqual(await m.exportPanel(),before);assert.equal(m.getEditBudget().used,0);
  }
  await m.acceptEditProposal(await materializeCodexEditDraft(c,draft(c)));assert.equal(m.getEditBudget().used,1);
  const after=await m.exportPanel();assert.deepEqual({...after.spec,sections:before.spec.sections},before.spec);
  assert.deepEqual(after.actions,before.actions);await m.undo();assert.deepEqual(await m.exportPanel(),before);assert.equal(m.getEditBudget().used,1);
 }finally{m.dispose();}
});
test('duplicate names remain unverified; selected pronouns resolve only the selected stable ID',async()=>{
 const s=structuredClone(spec);s.sections[0].rows[1].buttonLabel='继续游戏';
 const ambiguous=await contextFor(text,s);assert.equal(ambiguous.requestChecks.items.length,0);assert(!ambiguous.requestChecks.preserveRest.enforced);
 const c=await contextFor('这个按钮文字改为“返回游戏”，其他不变。',s,{rowId:'row1'});
 assert.equal(c.requestChecks.items[0].target,'row1');await materializeCodexEditDraft(c,draft(c,[rename('返回游戏','row1')]));
 const outside=await contextFor('返回主菜单按钮文字改为“返回”，其他不变。',s,{rowId:'row1'});assert.equal(outside.requestChecks.items.length,0);
});
test('corrections, examples, repeated assignments, unclosed quotes and unsupported clauses do not claim scope completeness',async()=>{
 for(const t of ['例如继续游戏按钮文字改为“返回游戏”，其他不变。','继续游戏按钮文字改为“返回游戏”，说错了改成“继续”，其他不变。',
 '继续游戏按钮文字改为“甲”，继续游戏按钮文字改为“乙”，其他不变。','继续游戏按钮文字改为“未闭合，其他不变。',
 '继续游戏按钮文字改为“返回游戏”，同时悬停旋转，其他不变。']){
  const c=await contextFor(t);assert(!c.requestChecks.preserveRest.enforced);assert(c.requestChecks.unverified.length);
 }
});
test('joined assignments and nested same-style quotes are not swallowed as one new label',async()=>{
 for(const t of ['继续游戏按钮文字改为“返回游戏”并把设置按钮文字改为“偏好设置”，其他不变。',
  '继续游戏按钮文字改为“返回“游戏””，其他不变。']){
  const c=await contextFor(t);assert.equal(c.requestChecks.items.length,0);assert(!c.requestChecks.preserveRest.enforced);
  assert(c.requestChecks.unverified.length);
 }
});
test('renaming a reset button preserves its action and non-default live state',async()=>{
 const item=INPUT_COVERAGE_V2.cases.find(c=>c.id==='G02');
 const p=await createPlanningContext(request(item.text),catalog,undefined,{actionLayouts:true,textWrap:true});
 const audio=(await materializePanelIntent(p,coverageIntent(p,item))).spec;
 const before=await createPanelBundle(audio,catalog,core,{row0:35,row1:true}),m=await createWorkbenchModel({catalog,pool:null},core);
 try{
  await m.importPanel(before);const c=(await m.prepareEdit(request('恢复默认按钮文字改为“恢复声音”，其他不变。'))).context;
  await assert.rejects(materializeCodexEditDraft(c,draft(c,[rename('恢复声音','row2'),{op:'set-button-action',rowId:'row2',action:{kind:'reset-initial',fields:['row0']}}])),{code:'EDIT_REQUEST_INCOMPLETE'});
  await m.acceptEditProposal(await materializeCodexEditDraft(c,draft(c,[rename('恢复声音','row2')])));
  const after=await m.exportPanel();assert.deepEqual(after.state,before.state);assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.bindings,before.bindings);
  assert.equal(after.spec.sections[0].rows[2].buttonLabel,'恢复声音');
 }finally{m.dispose();}
});
test('rehashed target or preservation tampering cannot bypass the recomputed text policy',async()=>{
 const c=await contextFor();for(const mutate of [v=>{v.requestChecks.items[0].target='row1';},v=>{v.requestChecks.preserveRest.enforced=false;}]){
  const changed=structuredClone(c);mutate(changed);delete changed.sha256;changed.sha256=await digestJson(changed);await assert.rejects(validatePanelEditContext(changed));
 }
});
test('CLI substitute receives text guidance and validates one response without model compute',async()=>{
 const c=await contextFor();let calls=0,prompt='';const outputRoot=await mkdtemp(new URL('../.tmp/button-copy-cli-',import.meta.url));
 const runProcess=()=>{calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
  child.stdin=new Writable({write(chunk,encoding,cb){prompt+=chunk;cb();},final(cb){cb();queueMicrotask(()=>{child.stdout.write([
   {type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},
   {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(draft(c))}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}
  ].map(v=>JSON.stringify(v)).join('\n')+'\n');child.emit('close',0);});}});return child;};
 const result=await editWithCodex(c,{outputRoot,executable:process.execPath,runProcess});assert.equal(calls,1);assert.equal(result.receipt.automaticRetries,0);
 assert(prompt.includes('panel-edit-button-copy-checks.md'));assert.equal(result.report.requestCheck.status,'MATCHED');
});
test('new published context schema extends the property grammar without changing old versions',async()=>{
 const s=JSON.parse(await readFile(new URL('../schemas/panel-edit-context-v0.13.schema.json',import.meta.url),'utf8'));
 assert.equal(s.properties.editContextVersion.const,'0.13');assert(s.properties.requestChecks.properties.items.items.properties.field.enum.includes('buttonLabel'));
 for(const branch of s.properties.capabilities.anyOf)assert.equal(branch.properties.requestCheckPolicy.const,'explicit-properties-v3');
});
