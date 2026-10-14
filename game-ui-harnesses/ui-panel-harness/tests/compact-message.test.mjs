import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {centeredMessageTextIds,alignCompactMessageText} from '../src/compact-message.mjs';
import {attachPanelSession} from '../src/state.mjs';
import {observeCompactMessage} from '../scripts/lib/compact-message-acceptance.mjs';
import {canonicalJson} from '../src/canonical.mjs';
const {catalog:old,records}=await readJson(new URL('./fixtures/compact-message-regressions-v1.json',import.meta.url));
const catalog=await readJson(new URL('../examples/modern-compact-message.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
const adopt=record=>{const spec=structuredClone(record.spec);for(const row of spec.sections.flatMap(section=>section.rows))if(row.kind==='text')row.recipe.version='0.2.0';return spec;};
for(const record of records)test(`${record.id}: preserve the original 0.35 digest and actions while tightening the explicit compact variant`,async()=>{
  const before=await createPanelBundle(record.spec,old,core,record.state);assert.equal(before.sha256,record.originalBundleSha256);
  const spec=adopt(record),after=await createPanelBundle(spec,catalog,core,record.state),previous=flatten(before.componentBundle.document.root),nodes=flatten(after.componentBundle.document.root);
  assert.equal(after.compilerVersion,'0.36.0');await validatePanelBundle(after,core);await validatePanelBundle(before,core);
  assert.equal(after.spec.sections[0].rows[0].text,record.spec.sections[0].rows[0].text);assert.equal(after.spec.sections[0].rows[0].label,record.spec.sections[0].rows[0].label);
  for(const key of ['actions','bindings','state','assetClosure'])assert.deepEqual(after[key],before[key]);
  const panel=nodes.find(node=>node.id===spec.id+'.panel'),oldPanel=previous.find(node=>node.id===spec.id+'.panel');assert(panel.layout.height<oldPanel.layout.height);
  const buttons=nodes.filter(node=>node.type==='Button'),parent=nodes.find(node=>node.children?.some(child=>child.id===buttons[0].id));
  const left=Math.min(...buttons.map(button=>button.layout.x)),right=Math.max(...buttons.map(button=>button.layout.x+button.layout.width));
  assert.equal((left+right)/2,parent.layout.width/2);
  const ids=centeredMessageTextIds(after);assert.equal(ids.length,1);
  const native=await createUnityDocument(after,core);assert.equal(native.nodes.find(node=>node.id===ids[0]).textAlignment,'MiddleCenter');
  assert(!nodes.some(node=>node.id===`${spec.id}.row.row0.label`));
  await assert.rejects(createPanelBundle(spec,catalog,core,record.state,undefined,'0.35.0'),error=>error.code==='COMPILER_VERSION');
});
test('labeled data beside an explicit message keeps its labels and existing geometry; no word-based centering',async()=>{
  const spec=adopt(records[0]),row=spec.sections[0].rows[0];spec.sections[0].rows.splice(1,0,{...row,id:'coins',recipe:{id:'settings.text',version:'0.1.0'},label:'金币',text:'100'});
  const bundle=await createPanelBundle(spec,catalog,core),nodes=flatten(bundle.componentBundle.document.root);assert.deepEqual(centeredMessageTextIds(bundle),[]);
  assert(nodes.some(node=>node.id===spec.id+'.row.coins.label'&&node.props.text==='金币'));assert(nodes.some(node=>node.props.text==='100'));
});
test('long prose and explicit paragraphs preserve every line and stay left aligned',async()=>{
  for(const copy of ['这是一段完整的游戏说明，用来确认长段落不会被截断，也不会被强行逐行居中。'.repeat(7),'确定退出吗？\n\n退出后返回开始界面。','  保留明确缩进的正文']){
    const spec=adopt(records[0]);spec.sections[0].rows[0].text=copy;spec.canvas.height=1400;spec.layout.maxHeight=1300;
    const bundle=await createPanelBundle(spec,catalog,core);assert.equal(bundle.spec.sections[0].rows[0].text,copy);assert.deepEqual(centeredMessageTextIds(bundle),[]);
    let document=bundle.componentBundle.document;const runtime={getDocument:()=>document,subscribe:()=>()=>{},setValue:()=>{},setVisible:()=>{},setEnabled:()=>{}};
    attachPanelSession(spec,runtime,()=>{},bundle.state,'minimal-v1',catalog).destroy();
    document=structuredClone(document);flatten(document.root).find(node=>node.id===spec.id+'.row.row0.control').layout.y++;
    assert.throws(()=>attachPanelSession(spec,runtime,()=>{},bundle.state,'minimal-v1',catalog),/PANEL_RUNTIME_MISMATCH/);
  }
});
test('a fixed frame and explicit button sizes retain their requested geometry and action order',async()=>{
  const spec=adopt(records[0]);spec.frame={width:480,height:400};spec.layout.width=480;spec.layout.maxHeight=400;spec.canvas.height=464;
  const button=spec.sections[0].rows.find(row=>row.kind==='button');spec.buttonStyles=[{rowId:button.id,style:{shape:'default',width:160,height:52,cornerRadius:null,backgroundColor:null,textColor:null,borderColor:null,borderWidth:null}}];
  const bundle=await createPanelBundle(spec,catalog,core),nodes=flatten(bundle.componentBundle.document.root);
  assert.equal(nodes.find(node=>node.id===spec.id+'.panel').layout.height,400);
  assert.equal(nodes.find(node=>node.id===`${spec.id}.row.${button.id}.control`).layout.width,160);assert.equal(bundle.spec.sections[0].rows[1].id,button.id);
});
test('oversized button groups become centered vertical actions without clipping or changing order',async()=>{
  const spec=adopt(records[0]);spec.buttonStyles=spec.sections[0].rows.filter(row=>row.kind==='button').map(row=>({rowId:row.id,style:{shape:null,width:300,height:null,cornerRadius:null,backgroundColor:null,textColor:null,borderColor:null,borderWidth:null}}));
  const bundle=await createPanelBundle(spec,catalog,core),nodes=flatten(bundle.componentBundle.document.root),buttons=nodes.filter(node=>node.type==='Button');
  assert.equal(buttons[0].layout.x,buttons[1].layout.x);assert.equal(buttons[0].layout.width,300);
  assert(buttons[1].layout.y>buttons[0].layout.y);
});
test('compact metadata is strict and only applies to a hidden-label Text recipe',()=>{
  for(const change of [recipe=>recipe.messageLayout='auto',recipe=>delete recipe.labelDisplay]){const bad=structuredClone(catalog);change(bad.recipes.find(recipe=>recipe.id==='message.text'));assert.throws(()=>validateCatalog(bad),/messageLayout/);}
  const bad=structuredClone(catalog);bad.recipes.find(recipe=>recipe.kind==='button-row').messageLayout='compact-centered-v1';assert.throws(()=>validateCatalog(bad),/messageLayout/);
});
test('repeating native glyph alignment does not accumulate horizontal drift',async()=>{
  const bundle=await createPanelBundle(adopt(records[0]),catalog,core),id=centeredMessageTextIds(bundle)[0];let offset=0;
  const runtime={applyMotion:(target,motion)=>{assert.equal(target,id);offset=motion.x;},inspect:()=>({nodes:[{id,bounds:{x:10+offset,width:416},renderedTextBounds:[{bounds:{x:14+offset,width:160}}]}]})};
  alignCompactMessageText(bundle,runtime);assert.equal(14+offset+80,10+208);const previous=offset;alignCompactMessageText(bundle,runtime);assert.equal(offset,previous);
});
test('native compact acceptance remains strict canonical JSON when a check has no optional evidence',async()=>{
  const bundle=await createPanelBundle(adopt(records[0]),catalog,core),id=bundle.spec.id;
  const nodes=[{id:id+'.section.section0',bounds:{x:0,width:416}},
    {id:id+'.row.row0.control',renderedTextBounds:[{bounds:{x:128,y:0,width:160,height:18}}]},
    {id:id+'.row.row1.control',bounds:{x:88,y:55,width:112,height:44}},
    {id:id+'.row.row2.control',bounds:{x:216,y:55,width:112,height:44}}];
  const observed=await observeCompactMessage({evaluate:async()=>({nodes})},bundle);
  assert.equal(observed.status,'PASS');assert.doesNotThrow(()=>canonicalJson(observed));
});
test('native acceptance allows supported left aligned paragraphs, and rejects shifted prose',async()=>{
  const spec=adopt(records[0]);spec.sections[0].rows[0].text='确定退出吗？\n\n退出后返回开始界面。';spec.canvas.height=1400;spec.layout.maxHeight=1300;
  const bundle=await createPanelBundle(spec,catalog,core),id=spec.id,source=flatten(bundle.componentBundle.document.root),row=source.find(node=>node.id===id+'.row.row0');
  const nodes=[{id:id+'.section.section0',bounds:{x:0,width:416}},{id:row.id,bounds:{x:0,y:row.layout.y,width:416,height:row.layout.height}}];
  for(const node of source.filter(node=>node.type==='Text'&&node.id.startsWith(id+'.row.row0.control')))nodes.push({id:node.id,bounds:{x:node.layout.x},renderedTextBounds:node.props.text?[{bounds:{x:node.layout.x,y:node.layout.y,width:160,height:18}}]:[]});
  for(const node of source.filter(node=>node.type==='Button'))nodes.push({id:node.id,bounds:{...node.layout}});
  const page={evaluate:async()=>({nodes})};let observed=await observeCompactMessage(page,bundle);assert.equal(observed.status,'PASS');assert.doesNotThrow(()=>canonicalJson(observed));
  nodes.find(node=>node.id===id+'.row.row0.control').bounds.x+=20;observed=await observeCompactMessage(page,bundle);assert.equal(observed.status,'FAIL');
});
