import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {createTextWrapFixture,wrapBody} from '../examples/text-wrap-v1/fixture.mjs';
import {wrapStaticText,staticTextWidth} from '../src/text-wrap.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {digestJson} from '../src/canonical.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {validatePanelSpec} from '../src/spec.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createPanelEditContext,validatePanelEditContext,checkPanelEditProposal} from '../src/edit-planning.mjs';
import {buildCodexEditResponseSchema,codexEditOperationContracts} from '../src/codex-edit-schema.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {composePanelBundles,validatePanelComposition} from '../src/panel-composition.mjs';
import {attachPanelSession,projectPanelEvent} from '../src/state.mjs';
import {controlId} from '../src/compiler.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json',import.meta.url),'utf8'));
const {before,context,proposal}=await createTextWrapFixture(catalog,core);
const patch=async(s,operations)=>({patchVersion:'0.1',baseSpecSha256:await digestJson(s),reason:'Authored wrapping fixture.',operations});
const wrap=word=>({op:'set-text-wrap',rowId:'intro',wrap:word});
const text=value=>({op:'set-text',rowId:'intro',text:value});
async function change(operations,b=before){const r=await applyPanelPatch(b.spec,await patch(b.spec,operations));return validatePanelBundle(await createPanelBundle(r.spec,b.catalog,core,b.state),core);}
const after=await change(proposal.patch.operations);
const bodyLines=b=>nodesOf(b.componentBundle.document).filter(n=>n.id===controlId(b.spec.id,'intro')||n.id.startsWith(controlId(b.spec.id,'intro')+'.line'));
const node=(b,id)=>nodesOf(b.componentBundle.document).find(n=>n.id===id);

for(const value of ['中文标点，自动换行。'.repeat(4),'English words keep readable spaces. ', 'https://example.test/'+'a'.repeat(100), '👩‍👩‍👧‍👦 e\u0301 🙂  ', 'first\r\n\r\n最后\n', '一\u2028二\u2029三'])test('wrapping preserves source characters: '+JSON.stringify(value.slice(0,25)),()=>{
  const normalized=value.replace(/\r\n|\u2028|\u2029/gu,'\n'),result=wrapStaticText(value,180,14);
  assert.equal(result.lines.join('').replace(/\s/gu,''),normalized.replace(/\s/gu,''));
  assert(result.lines.every(line=>staticTextWidth(line)*14<=180+1e-8));
  assert.equal(result.height,result.lines.length*result.lineHeight+4);
  const cuts=new Set([0]);let index=0;for(const {segment} of new Intl.Segmenter('und',{granularity:'grapheme'}).segment(normalized.replaceAll('\n',''))){index+=segment.length;cuts.add(index);}
  let offset=0;for(const line of result.lines){offset+=line.length;assert(cuts.has(offset),'never split a complete grapheme');}
});
test('English words prefer whole tokens; explicit blank paragraphs stay blank',()=>{
  assert.deepEqual(wrapStaticText('hello world',60,14).lines,['hello','world']);
  assert.deepEqual(wrapStaticText('a\n\nb',180,14).lines,['a','','b']);
  for(const width of [0,-1,1,NaN])assert.throws(()=>wrapStaticText('👩‍👩‍👧‍👦',width,14),{code:'TEXT_WRAP_WIDTH'});
});
test('Chinese closing punctuation stays with the previous character and opening punctuation with the next',()=>{
  for(const value of ['中文，正文。结束！','打开（设置）然后继续。','阅读“说明”再确认。']) {
    const lines=wrapStaticText(value,48,14).lines;
    assert.equal(lines.join(''),value);
    assert(lines.every(line=>!(/^[，。！？：；、）》】」』”’]/u.test(line)||/[（《【「『“‘]$/u.test(line))));
  }
});
test('wrapped body raises row height and following controls without changing stable IDs, state or behavior',async()=>{
  assert.equal(after.spec.panelSpecVersion,'0.13');assert.equal(after.compilerVersion,'0.13.0');assert.deepEqual(after.spec.textLayouts,[{rowId:'intro',wrap:'word'}]);
  assert.equal(after.spec.sections[0].rows[0].text,wrapBody);assert.deepEqual(after.state,before.state);assert.deepEqual(after.actions,before.actions);assert.deepEqual(after.bindings,before.bindings);
  assert.deepEqual(after.spec.sections[0].rows.slice(1),before.spec.sections[0].rows.slice(1));
  const lines=bodyLines(after);assert(lines.length>4);assert.equal(lines.map(n=>n.props.text).join('').replaceAll(' ',''),wrapBody.replaceAll(' ',''));
  assert(lines.every(n=>n.props.wrap==='none'&&n.props.overflow==='error'));
  const relativeY=(b,row)=>node(b,`${b.spec.id}.row.${row.id}`)?.layout.y ?? node(b,controlId(b.spec.id,row.id)).layout.y;
  for(const row of before.spec.sections[0].rows.slice(1))assert(relativeY(after,row)>relativeY(before,row));
  const result=await applyPanelPatch(before.spec,await patch(before.spec,[wrap('word')]));assert.deepEqual(result.receipt.changedRowIds,['intro']);
});
test('shortening recomputes height; clearing restores the original tree; old bundles replay exactly',async()=>{
  const short=await change([text('请输入角色名')],after),cleared=await change([wrap(null)],short);
  assert(bodyLines(short).length<bodyLines(after).length);
  assert.deepEqual(cleared.componentBundle.document,before.componentBundle.document);
  assert.deepEqual(await validatePanelBundle(before,core),before);
  assert.deepEqual(await change([wrap(null)]),before);
});
test('clear wrap and invalid overflow reject the complete edit without consuming a round or changing state',async()=>{
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(after);
  for(const operations of [[wrap(null)],[{op:'set-panel-title',title:'不应部分应用'},wrap(null)],[{op:'set-layout',layout:{...after.spec.layout,maxHeight:240,overflow:'error'}}]]){
    await assert.rejects(model.patch(await patch(after.spec,operations)));assert.deepEqual(model.getSnapshot().panel,after);assert.equal(model.getEditBudget().used,0);
  }model.dispose();
});
test('very long content scrolls rather than requiring its entire row in one viewport',async()=>{
  const long=await change([text('长正文需要完整保留，超出高度时滚动。'.repeat(40))],after);
  assert(bodyLines(long).length>20);assert.equal(bodyLines(long).map(n=>n.props.text).join(''),long.spec.sections[0].rows[0].text);
  assert(nodesOf(long.componentBundle.document).some(n=>n.type==='ScrollView'));
  await assert.rejects(change([{op:'set-layout',layout:{...long.spec.layout,overflow:'error'}}],long),/exceeds/);
});
for(const value of ['x'.repeat(1001),'a\tb','a\rb','a\u0000b','a\ud800b','  \n  '])test('wrapped source rejects malformed or unbounded text '+JSON.stringify(value.slice(0,12)),async()=>{
  await assert.rejects(change([text(value)],after));
});
test('multiline source is opt-in, newlines are preserved, and adding a long Text plus wrapping is one atomic edit',async()=>{
  await assert.rejects(change([text('第一段\n第二段')]));
  const multiline=await change([text('第一段\r\n\r\n第二段')],after);assert.deepEqual(bodyLines(multiline).map(n=>n.props.text),['第一段','','第二段']);
  assert.equal(multiline.spec.sections[0].rows[0].text,'第一段\r\n\r\n第二段');
  const operations=[{op:'add-row',sectionId:before.spec.sections[0].id,afterRowId:'intro',row:{...before.spec.sections[0].rows[0],id:'more',text:wrapBody},state:null},{op:'set-text-wrap',rowId:'more',wrap:'word'}];
  // add-row and its layout write intentionally target different properties.
  const result=await change(operations);assert(result.spec.textLayouts.some(v=>v.rowId==='more'));
});
test('layout entries are exact, unique, and target only Text; removal cleans them',async()=>{
  for(const textLayouts of [null,[{rowId:'missing',wrap:'word'}],[{rowId:'row0',wrap:'word'}],[{rowId:'intro',wrap:'clip'}],[{rowId:'intro',wrap:'word',height:80}],[...after.spec.textLayouts,...after.spec.textLayouts]])assert.throws(()=>validatePanelSpec({...after.spec,textLayouts}));
  await assert.rejects(change([{...wrap('word'),rowId:'row0'}]));
  const removed=await change([{op:'remove-row',rowId:'intro'}],after);assert.deepEqual(removed.spec.textLayouts,[]);
});
test('Context 0.8 offers Text-only wrapping while saved 0.7 keeps its exact original capabilities',async()=>{
  assert.equal(context.editContextVersion,'0.8');assert.equal(context.capabilities.textWrapPolicy,'static-text-wrap-v1');assert.equal(context.capabilities.titleBarPolicy,'panel-title-bar-v1');assert.deepEqual(await validatePanelEditContext(context),context);
  for(const selection of [null,{rowId:'intro'},{rowId:'row0'}]){
    const c=await createPanelEditContext(before.spec,catalog,context.request,selection),schema=await buildCodexEditResponseSchema({draft:true,context:c});
    assert.equal(codexEditOperationContracts(schema,c).some(o=>o.operation==='set-text-wrap'),selection?.rowId!=='row0');
  }
  const old=structuredClone(context);old.editContextVersion='0.7';delete old.capabilities.textWrapPolicy;old.capabilities.operations=old.capabilities.operations.filter(o=>o!=='set-text-wrap');delete old.sha256;old.sha256=await digestJson(old);
  assert.deepEqual(await validatePanelEditContext(old),old);assert(!JSON.stringify(await buildCodexEditResponseSchema({draft:true,context:old})).includes('set-text-wrap'));
  const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:proposal.patch,bases:proposal.patch.operations.map(()=>({kind:'request-interpretation',quote:context.request.text})),unresolved:[],noChange:null};
  assert.equal((await checkPanelEditProposal(context,await materializeCodexEditDraft(context,draft))).status,'READY_TO_APPLY');
  await assert.rejects(materializeCodexEditDraft(old,{...draft,contextSha256:old.sha256}),/EDIT_PATCH/);
});
test('Unity emits the same complete lines and slots with native Text nodes',async()=>{
  const unity=await createUnityDocument(after,core),original=await createUnityDocument(before,core);
  for(const line of bodyLines(after)){const native=unity.nodes.find(n=>n.id===line.id);assert.equal(native.type,'Text');assert.equal(native.text,line.props.text);assert.equal(native.width,line.layout.width);assert.equal(native.height,line.layout.height);assert.equal(native.fontSize,line.props.style.fontSize);}
  assert.deepEqual(unity.controls,original.controls);assert.deepEqual(unity.fields,original.fields);
});
test('composition namespaces wrapping targets and retains entered values',async()=>{
  const second=await createPanelBundle({...after.spec,id:'second-wrap'},catalog,core,after.state);
  const request={panelCompositionRequestVersion:'0.1',id:'wrapped-composite',title:'组合',sources:[{namespace:'one',bundleSha256:after.sha256},{namespace:'two',bundleSha256:second.sha256}],layout:'tabs',width:420,canvasWidth:484,canvasHeight:640,maxHeight:560,surfaceFrom:null};
  const result=await composePanelBundles(request,[after,second],core);await validatePanelComposition(result,[after,second],core);
  assert.equal(result.bundle.spec.panelSpecVersion,'0.13');assert.deepEqual(result.bundle.spec.textLayouts.map(v=>v.rowId),['one_r_intro','two_r_intro']);assert(Object.values(result.bundle.state).includes('小蓝莓😀'));
});
test('session verifies every derived line and existing submit values, ten rounds and undo remain unchanged',async()=>{
  let document=after.componentBundle.document;
  const runtime={getDocument:()=>document,subscribe:()=>()=>{},setValue:()=>{},setVisible:()=>{},setEnabled:()=>{}};
  attachPanelSession(after.spec,runtime,()=>{},after.state).destroy();
  document=structuredClone(document);nodesOf(document).find(n=>n.id.endsWith('.line1')).props.text='被篡改';assert.throws(()=>attachPanelSession(after.spec,runtime,()=>{},after.state),/PANEL_RUNTIME_MISMATCH/);
  assert.equal(projectPanelEvent(after.spec,after.state,{id:controlId(after.spec.id,'row1'),type:'activate',source:'keyboard'}).event.values.row0,'小蓝莓😀');
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(after);
  for(let i=0;i<10;i++)await model.patch(await patch(model.getSnapshot().panel.spec,[text('新说明'.repeat(i+1))]));
  assert.equal(model.getEditBudget().used,10);assert.deepEqual(model.getSnapshot().panel.state,after.state);await model.undo();await assert.rejects(model.patch(await patch(model.getSnapshot().panel.spec,[text('更多说明')])),/WORKBENCH_EDIT_LIMIT/);model.dispose();
});
