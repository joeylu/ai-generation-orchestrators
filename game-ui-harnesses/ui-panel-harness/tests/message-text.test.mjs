import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {effectivePanelTitleStyle} from '../src/title-bar.mjs';
import {nativeMessageLabelMismatch} from '../src/message-text.mjs';
import {staticPlaceholderChoiceNames,assessPanelCopy} from '../scripts/lib/panel-copy-acceptance.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {digestJson} from '../src/canonical.mjs';
import {attachPanelSession} from '../src/state.mjs';
const core=await loadWorkspaceCore(),old=await readJson(new URL('../examples/modern-tab-headings.catalog.json',import.meta.url));
const catalog=await readJson(new URL('../examples/modern-message-copy.catalog.json',import.meta.url));
const {records}=await readJson(new URL('./fixtures/panel-copy-regressions-v1.json',import.meta.url));
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],message={id:'message.text',version:'0.1.0'};
for(const record of records.filter(record=>record.id!=='S21'))test(`${record.id}: message adoption removes only the rendered label, retains copy/events/state and legacy replay`,async()=>{
  const before=await createPanelBundle(record.spec,old,core,record.state),spec=structuredClone(record.spec),copy=spec.sections.flatMap(section=>section.rows).find(row=>row.kind==='text');
  const saved=structuredClone(spec);copy.recipe=message;
  const after=await createPanelBundle(spec,catalog,core,record.state),nodes=flatten(after.componentBundle.document.root);
  assert.equal(before.compilerVersion,'0.34.0');assert.equal(after.compilerVersion,'0.35.0');
  assert(flatten(before.componentBundle.document.root).some(node=>node.id===`${spec.id}.row.${copy.id}.label`));
  assert(!nodes.some(node=>node.id===`${spec.id}.row.${copy.id}.label`));assert(nodes.some(node=>node.props?.text===copy.text));
  assert.deepEqual({...copy,recipe:saved.sections.flatMap(section=>section.rows).find(row=>row.id===copy.id).recipe},saved.sections.flatMap(section=>section.rows).find(row=>row.id===copy.id));
  for(const key of ['actions','bindings','state','assetClosure'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(await validatePanelBundle(before,core),before);assert.deepEqual(await validatePanelBundle(after,core),after);
  assert.equal(effectivePanelTitleStyle(after).horizontalAlign,'center');
  const native=await createUnityDocument(after,core);assert(!native.nodes.some(node=>node.id===`${spec.id}.row.${copy.id}.label`));
  assert.equal(assessPanelCopy({purpose:'exit-confirmation',bundle:before,browserStatus:'PASS'}).status,'FAIL');
  assert.equal(assessPanelCopy({purpose:'exit-confirmation',bundle:after,browserStatus:'PASS'}).status,'PASS');
  await assert.rejects(createPanelBundle(spec,catalog,core,record.state,undefined,'0.34.0'),error=>error.code==='COMPILER_VERSION');
});
test('meaningful labeled data remains visible beside a message, without guessing label words',async()=>{
  const spec=structuredClone(records[0].spec),section=spec.sections[0],copy=section.rows.find(row=>row.kind==='text');copy.recipe=message;
  section.rows.splice(1,0,{...copy,id:'coins',recipe:{id:'settings.text',version:'0.1.0'},label:'金币',text:'100'});
  const bundle=await createPanelBundle(spec,catalog,core),nodes=flatten(bundle.componentBundle.document.root);
  assert(nodes.some(node=>node.id===`${spec.id}.row.coins.label`&&node.props.text==='金币'));assert(nodes.some(node=>node.props?.text==='100'));
  assert(!nodes.some(node=>node.id===`${spec.id}.row.${copy.id}.label`));
});
test('message wrapping preserves paragraphs while its hidden semantic label cannot force width expansion',async()=>{
  const spec=structuredClone(records[0].spec),copy=spec.sections[0].rows.find(row=>row.kind==='text');
  copy.recipe=message;copy.label='完整语义标签'.repeat(15);copy.text='确定退出当前游戏吗？\n\n退出后将返回游戏开始界面。';spec.textLayouts=[{rowId:copy.id,wrap:'word'}];
  const bundle=await createPanelBundle(spec,catalog,core);assert.equal(bundle.spec.sections[0].rows[0].text,copy.text);
  assert.equal(bundle.spec.sections[0].rows[0].label,copy.label);assert.equal(bundle.compilerVersion,'0.35.0');await validatePanelBundle(bundle,core);
});
test('message recipe is limited to Text and cannot hide editable controls or icon labels',async()=>{
  const invalid=structuredClone(catalog);invalid.recipes.find(recipe=>recipe.kind==='button-row').labelDisplay='hidden';assert.throws(()=>validateCatalog(invalid),/text-row/);
  const bad=structuredClone(catalog);bad.recipes.find(recipe=>recipe.id==='message.text').labelDisplay='auto';assert.throws(()=>validateCatalog(bad),/text-row/);
  const spec=structuredClone(records[0].spec);spec.sections[0].rows[0].recipe=message;
  const control={id:'extra',kind:'switch',recipe:{id:'settings.switch',version:'0.1.0'},label:'声音',bind:'sound',enabled:true,event:'panel.sound'};
  spec.sections[0].rows.push(control);spec.state.push({id:'sound',type:'boolean',initial:true});
  await assert.rejects(createPanelBundle(spec,catalog,core),error=>error.code==='MESSAGE_TEXT_SCOPE');
});
test('native boundary rejects hiding a definite requested data label while ordinary messages stay eligible',()=>{
  const context={catalog,request:{text:'只读文本，标签为“金币”，显示“100”'}},body={kind:'section',rows:[{kind:'text',label:'金币',text:'100',recipeKey:'message.text@0.1.0'}]};
  assert.equal(nativeMessageLabelMismatch(context,body),'$.panel.body.rows[0].recipeKey');
  body.rows[0].recipeKey='settings.text@0.1.0';assert.equal(nativeMessageLabelMismatch(context,body),null);
  assert.equal(nativeMessageLabelMismatch({...context,request:{text:'做个退出确认框'}},body),null);
});
test('wrapped message runtime accepts the declared zero label band and still rejects changed coordinates',async()=>{
  const record=records[0],spec=structuredClone(record.spec);spec.sections[0].rows[0].recipe=message;
  const bundle=await createPanelBundle(spec,catalog,core,record.state);let document=bundle.componentBundle.document;
  const runtime={getDocument:()=>document,subscribe:()=>()=>{},setValue:()=>{},setVisible:()=>{},setEnabled:()=>{}};
  attachPanelSession(spec,runtime,()=>{},bundle.state,'minimal-v1',catalog).destroy();
  document=structuredClone(document);flatten(document.root).find(node=>node.type==='Text'&&node.props.text===spec.sections[0].rows[0].text).layout.y+=1;
  assert.throws(()=>attachPanelSession(spec,runtime,()=>{},bundle.state,'minimal-v1',catalog),/PANEL_RUNTIME_MISMATCH/);
});
test('named default character placeholder reproduces a review warning; public label patch preserves all choices and state',async()=>{
  const record=records.find(record=>record.id==='S21'),before=await createPanelBundle(record.spec,old,core,record.state),image=record.spec.sections.flatMap(section=>section.rows).find(row=>row.kind==='image');
  assert.equal(staticPlaceholderChoiceNames(record.spec)[0].matches[0].name,'风语');
  assert.equal(assessPanelCopy({purpose:'character-select',bundle:before,browserStatus:'PASS'}).status,'REVIEW_REQUIRED');
  const changed=await applyPanelPatch(record.spec,{patchVersion:'0.1',baseSpecSha256:await digestJson(record.spec),reason:'Use neutral unbound character placeholder copy',operations:[{op:'set-row-label',rowId:image.id,label:'角色立绘占位'}]});
  const after=await createPanelBundle(changed.spec,old,core,record.state);assert.deepEqual(staticPlaceholderChoiceNames(after.spec),[]);
  assert.equal(assessPanelCopy({purpose:'character-select',bundle:after,browserStatus:'PASS'}).status,'PASS');
  for(const key of ['actions','bindings','state','assetClosure'])assert.deepEqual(after[key],before[key]);
});
