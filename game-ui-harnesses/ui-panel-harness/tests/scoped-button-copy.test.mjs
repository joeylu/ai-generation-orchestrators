import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {core} from './helpers.mjs';
import {scopedCopyFixture} from '../examples/scoped-button-copy-v1/fixture.mjs';
import {createPanelEditContext,validatePanelEditContext,checkPanelEditProposal} from '../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {digestJson} from '../src/canonical.mjs';
import {editWithCodex} from '../src/codex-planner.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-menu.catalog.json',import.meta.url),'utf8'));
const {spec}=await scopedCopyFixture(catalog);
const request=text=>({requestVersion:'0.1',id:'scoped-button-copy-edit',target:'pixi',text});
const text='把“声音”分组里的“恢复默认”按钮文字改为“恢复声音”，其他不变。';
const contextFor=(t=text,s=spec,selection=null,policy='properties-v4')=>createPanelEditContext(s,catalog,request(t),selection,{requestChecks:policy});
const rename=(buttonLabel='恢复声音',rowId='row1')=>({op:'set-button-label',rowId,buttonLabel});
const draft=(c,operations=[rename()])=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,
 patch:{patchVersion:'0.1',baseSpecSha256:c.baseSpecSha256,reason:'Authored scoped copy fixture.',operations},
 bases:operations.map(()=>({kind:'request-interpretation',quote:c.request.text})),unresolved:[],noChange:null});

test('new policy resolves an exact section and button to a stable ID without changing old policies',async()=>{
 const c=await contextFor();assert.equal(c.editContextVersion,'0.14');assert.equal(c.requestChecks.policy,'explicit-properties-v4');
 assert.equal(c.requestChecks.items[0]?.target,'row1');assert(c.requestChecks.preserveRest.enforced);assert.deepEqual(await validatePanelEditContext(c),c);
 for(const policy of ['properties-v2','properties-v3']){
  const old=await contextFor(text,spec,null,policy);assert.equal(old.requestChecks.items.length,0);assert(!old.requestChecks.preserveRest.enforced);
  assert.deepEqual(await validatePanelEditContext(old),old);
 }
});
for(const wording of ['声音分组里的恢复默认按钮文字改为“恢复声音”，其他不变。',
 '将「声音」分组中的「恢复默认」按钮的文案改成「恢复声音」，其余不变。',
 '“声音”分组内的“恢复默认”按钮上的文字设为"恢复声音"，其他不变。',
 "把'声音'分组的'恢复默认'按钮文字改为'恢复声音'，其他不变。"])
 test('section-qualified copy assignment: '+wording,async()=>{
  const c=await contextFor(wording);assert.equal(c.requestChecks.items[0]?.target,'row1');assert(c.requestChecks.preserveRest.enforced);
  const result=await checkPanelEditProposal(c,await materializeCodexEditDraft(c,draft(c)));assert.equal(result.requestCheck.status,'MATCHED');
 });
test('two qualified duplicate buttons must both match; renaming does not switch their identities',async()=>{
 const c=await contextFor('声音分组里的恢复默认按钮文字改为“恢复声音”，显示分组里的恢复默认按钮文字改为“恢复显示”，其他不变。');
 assert.deepEqual(c.requestChecks.items.map(i=>i.target),['row1','row3']);
 await assert.rejects(materializeCodexEditDraft(c,draft(c)),{code:'EDIT_REQUEST_INCOMPLETE'});
 await assert.rejects(materializeCodexEditDraft(c,draft(c,[rename('恢复显示'),rename('恢复声音','row3')])),{code:'EDIT_REQUEST_INCOMPLETE'});
 await materializeCodexEditDraft(c,draft(c,[rename(),rename('恢复显示','row3')]));
});
test('unqualified duplicate buttons stay unverified and never choose the first row',async()=>{
 const c=await contextFor('恢复默认按钮文字改为“恢复声音”，其他不变。');assert.equal(c.requestChecks.items.length,0);
 assert(c.requestChecks.unverified.length);assert(!c.requestChecks.preserveRest.enforced);
});
test('an already selected duplicate button can be named literally; old copy contexts remain unchanged',async()=>{
 const t='恢复默认按钮文字改为“恢复显示”，其他不变。',c=await contextFor(t,spec,{rowId:'row3'});
 assert.equal(c.requestChecks.items[0]?.target,'row3');assert(c.requestChecks.preserveRest.enforced);
 await materializeCodexEditDraft(c,draft(c,[rename('恢复显示','row3')]));
 const old=await contextFor(t,spec,{rowId:'row3'},'properties-v3');assert.equal(old.requestChecks.items.length,0);
});
test('section qualification cannot escape the selected ID',async()=>{
 const c=await contextFor(text,spec,{rowId:'row3'});assert.equal(c.requestChecks.items.length,0);assert(!c.requestChecks.preserveRest.enforced);
 await assert.rejects(materializeCodexEditDraft(c,draft(c)));
});
test('duplicate section titles, duplicate buttons in a section and unknown qualifiers stay unverified',async()=>{
 const sections=structuredClone(spec);sections.sections[1].title='声音';
 const buttons=structuredClone(spec);const extra=structuredClone(buttons.sections[0].rows[1]);extra.id='another-reset';extra.event='panel.another-reset';buttons.sections[0].rows.push(extra);
 for(const [t,s] of [[text,sections],[text,buttons],[text.replace('声音','不存在'),spec],[text.replace('恢复默认','不存在'),spec]]){
  const c=await contextFor(t,s);assert.equal(c.requestChecks.items.length,0);assert(c.requestChecks.unverified.length);assert(!c.requestChecks.preserveRest.enforced);
 }
});
test('quoted literal names containing qualifier words remain literal, including negation and punctuation',async()=>{
 const s=structuredClone(spec);s.sections[0].rows[1].buttonLabel='声音分组里的恢复默认';
 const literal=await contextFor('“声音分组里的恢复默认”按钮文字改为“仅恢复，声音 🎵”，其他不变。',s);
 assert.equal(literal.requestChecks.items[0]?.target,'row1');assert.equal(literal.requestChecks.items[0].expected,'仅恢复，声音 🎵');
 const unicode=structuredClone(spec);unicode.sections[0].title='不要重置，Audio 🎵';
 const t='“不要重置，Audio 🎵”分组里的“恢复默认”按钮文字改为“仅恢复，声音 🎵”，其他不变。',c=await contextFor(t,unicode);
 assert.equal(c.requestChecks.items[0]?.target,'row1');assert.equal(t.slice(c.requestChecks.items[0].start,c.requestChecks.items[0].end),c.requestChecks.items[0].quote);
 const quotedPronoun=await contextFor('“这个”按钮文字改为“恢复显示”，其他不变。',spec,{rowId:'row3'});
 assert.equal(quotedPronoun.requestChecks.items.length,0);assert(!quotedPronoun.requestChecks.preserveRest.enforced);
});
test('scope checks reject the other reset or changed reset fields without mutating values or rounds',async()=>{
 const before=await createPanelBundle(spec,catalog,core,{row0:35,row2:81}),m=await createWorkbenchModel({catalog,pool:null},core);
 try{
  await m.importPanel(before);const c=(await m.prepareEdit(request(text))).context;assert.equal(c.editContextVersion,'0.14');
  for(const ops of [[rename('恢复声音','row3')],[rename(),rename('也改了','row3')],
   [rename(),{op:'set-button-action',rowId:'row1',action:{kind:'reset-initial',fields:['row0','row2']}}]]){
   await assert.rejects(materializeCodexEditDraft(c,draft(c,ops)),{code:'EDIT_REQUEST_INCOMPLETE'});
   assert.deepEqual(await m.exportPanel(),before);assert.equal(m.getEditBudget().used,0);
  }
  await m.acceptEditProposal(await materializeCodexEditDraft(c,draft(c)));const after=await m.exportPanel();
  assert.deepEqual(after.state,before.state);assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.bindings,before.bindings);
  assert.equal(after.spec.sections[1].rows[1].buttonLabel,'恢复默认');assert.equal(m.getEditBudget().used,1);
  await m.undo();assert.deepEqual(await m.exportPanel(),before);assert.equal(m.getEditBudget().used,1);
 }finally{m.dispose();}
});
test('rehashed scoped targets still fail immutable context recomputation',async()=>{
 const c=await contextFor();c.requestChecks.items[0].target='row3';delete c.sha256;c.sha256=await digestJson(c);
 await assert.rejects(validatePanelEditContext(c),{code:'EDIT_CONTEXT_MISMATCH'});
});
test('new schema publishes only the new context version and request policy',async()=>{
 const s=JSON.parse(await readFile(new URL('../schemas/panel-edit-context-v0.14.schema.json',import.meta.url),'utf8'));
 assert.equal(s.properties.editContextVersion.const,'0.14');assert.equal(s.properties.requestChecks.properties.policy.const,'explicit-properties-v4');
 for(const branch of s.properties.capabilities.anyOf)assert.equal(branch.properties.requestCheckPolicy.const,'explicit-properties-v4');
});
test('CLI substitutes receive scoped guidance only for the new policy, with one response and no model calls',async()=>{
 for(const policy of ['properties-v3','properties-v4']){
  const c=await contextFor(text,spec,null,policy);let calls=0,prompt='';
  const outputRoot=await mkdtemp(new URL('../.tmp/scoped-copy-cli-',import.meta.url));
  const runProcess=()=>{calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
   child.stdin=new Writable({write(chunk,encoding,cb){prompt+=chunk;cb();},final(cb){cb();queueMicrotask(()=>{
    child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},
     {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(draft(c))}},
     {type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}].map(v=>JSON.stringify(v)).join('\n')+'\n');
    child.emit('close',0);
   });}});return child;};
  const result=await editWithCodex(c,{outputRoot,executable:process.execPath,runProcess});
  assert.equal(calls,1);assert.equal(result.receipt.automaticRetries,0);
  assert.equal(prompt.includes('prompts/panel-edit-scoped-button-copy.md'),policy==='properties-v4');
  if(policy==='properties-v4')assert.equal(result.report.requestCheck.status,'MATCHED');
 }
});
