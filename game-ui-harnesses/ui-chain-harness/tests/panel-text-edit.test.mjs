import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {createSession} from '../src/panel/session.mjs';
import {textEditFields,textEditDocument,validateSizeEdit} from '../src/panel/size-edit.mjs';
import {applyTextChanges,nonTextProps} from '../src/panel/text-edit.mjs';

const ctx=await editorData(),find=(doc,id='subject')=>doc.nodes.find(node=>node.id===id);
const node=(id,type,props={},size={width:600,height:400},slots={})=>({id,name:id,recipeRef:type+'@1.0.0',props,size,slots});
function fixture(type,props={},customRows=false){
  const subject=node('subject',type,props),children=[];
  if(type==='text')subject.props.textStyleRef='body';
  if(['panel','dialog'].includes(type)){subject.slots.content=['body'];children.push(node('body','container',{}, {width:500,height:200},{children:[]}));}
  if(type==='tabs'){
    subject.props.tabs=[{id:'a',label:'第一页',contentNodeId:'page-a'},{id:'b',label:'第二页',contentNodeId:'page-b'}];subject.props.activeId='a';subject.slots.pages=['page-a','page-b'];
    children.push(...subject.slots.pages.map(id=>node(id,'container',{}, {width:500,height:200},{children:[]})));
  }
  if(['radio-group','select'].includes(type)){subject.props.options=[{id:'a',label:'选项甲',enabled:true},{id:'b',label:'选项乙',enabled:false}];subject.props.selectedId='a';}
  if(type==='list'){
    subject.props.items=[{id:'a',label:'条目甲',enabled:true}];subject.props.itemRecipeRef='button@1.0.0';subject.props.selectedId='a';
    if(customRows){subject.slots.items=['custom-row'];children.push(node('custom-row','button',{label:'真正绘制的条目'}, {width:400,height:48}));}
  }
  if(type==='dialog')subject.props.actions=[{id:'confirm',label:'确认',variant:'primary',closeOnActivate:true}];
  subject.position={x:40,y:40};
  const {width,height}=ctx.canvases.presets.landscape,root=node('artboard','container',{}, {width,height},{children:['subject']});root.layout={childrenMode:'free',padding:0};
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:'text-edit-fixture',revision:0,title:'不可变作品标题',canvas:'landscape',bindings:ctx.binding,rootId:root.id,nodes:[root,subject,...children]},ctx);
}

test('scalar display fields are explicit metadata and immutable pure candidates preserve initial values',()=>{
  for(const [type,key,value]of [['text','text','第一行\n第二行'],['panel','title','面板新标题'],['dialog','title','弹窗新标题'],['button','label','继续游戏'],['switch','label','背景音乐'],['check-box','label','保留选择'],['input','placeholder','请输入名字'],['select','placeholder','请选择品质']]){
    const doc=fixture(type,type==='input'?{value:'初始名字'}:{}),before=structuredClone(doc),fields=textEditFields(doc,'subject',ctx),field=fields.find(field=>field.id===key);
    assert(field);assert.equal(field.multiline,type==='text');assert.equal(field.maxLength,type==='text'?32768:4096);
    const next=textEditDocument(doc,{nodeId:'subject',changes:{[key]:value}},ctx);
    assert.equal(find(next).props[key],value);assert.deepEqual(doc,before);assert.deepEqual(nonTextProps(find(next),ctx),nonTextProps(find(doc),ctx));
    assert.deepEqual(validateSizeEdit(doc,next,ctx),next);
  }
  const input=fixture('input',{value:'初始名字'});assert.deepEqual(textEditFields(input,'subject',ctx).map(field=>field.id),['placeholder']);
  assert.equal(find(textEditDocument(input,{nodeId:'subject',changes:{placeholder:''}},ctx)).props.value,'初始名字');
});

test('nested collection labels change without changing IDs ordering enablement selection or actions',()=>{
  for(const [type,id]of [['select','options.0.label'],['radio-group','options.1.label'],['tabs','tabs.0.label'],['list','items.0.label'],['dialog','actions.0.label']]){
    const doc=fixture(type),before=structuredClone(doc),next=textEditDocument(doc,{nodeId:'subject',changes:{[id]:'新显示文案'}},ctx),field=textEditFields(next,'subject',ctx).find(field=>field.id===id);
    assert.equal(field.value,'新显示文案');assert.equal(field.multiline,false);assert.deepEqual(nonTextProps(find(next),ctx),nonTextProps(find(doc),ctx));assert.deepEqual(next.nodes.map(node=>node.slots),doc.nodes.map(node=>node.slots));assert.deepEqual(doc,before);
  }
});

test('non-display fields collection identities initial values styles and validators remain forbidden',()=>{
  const input=fixture('input',{value:'初始名字',placeholder:'请输入'});
  for(const field of ['value','maxLength','inputType','enabled','visible','__proto__','placeholder.text'])assert.throws(()=>textEditDocument(input,{nodeId:'subject',changes:{[field]:'改写'}},ctx),{code:'edit.text-field'});
  assert.throws(()=>textEditDocument(input,{nodeId:'subject',changes:{placeholder:2}},ctx),{code:'edit.text-value'});
  for(const mutate of [n=>n.props.value='改初值',n=>n.props.maxLength=99,n=>n.props.readOnly=true]){const bad=structuredClone(input);mutate(find(bad));assert.throws(()=>validateSizeEdit(input,bad,ctx));}
  const select=fixture('select');for(const mutate of [n=>n.props.options.reverse(),n=>n.props.options[0].id='other',n=>n.props.options.push({id:'new',label:'新增'}),n=>n.props.options[0].enabled=false,n=>n.props.selectedId='b']){const bad=structuredClone(select);mutate(find(bad));assert.throws(()=>validateSizeEdit(select,bad,ctx));}
  const text=fixture('text',{text:'旧文字'}),styled=structuredClone(text);find(styled).props.align='right';assert.throws(()=>validateSizeEdit(text,styled,ctx));
});

test('locked nodes and ancestors expose no text fields and reject candidate and save edits',()=>{
  for(const lockedId of ['subject','artboard']){
    const doc=fixture('button',{label:'原文'});find(doc,lockedId).locked=true;
    assert.deepEqual(textEditFields(doc,'subject',ctx),[]);assert.throws(()=>textEditDocument(doc,{nodeId:'subject',changes:{label:'新文案'}},ctx),{code:'edit.locked'});
    const bad=structuredClone(doc);find(bad).props.label='新文案';assert.throws(()=>validateSizeEdit(doc,bad,ctx),{code:'edit.locked'});
  }
});

test('text changes at unchanged geometry enforce caption capacity slot safety and changed-string limits',()=>{
  for(const [type,id]of [['text','text'],['button','label'],['select','placeholder'],['select','options.0.label'],['radio-group','options.0.label'],['tabs','tabs.0.label'],['list','items.0.label'],['dialog','actions.0.label']]){
    const doc=fixture(type),before=structuredClone(doc);assert.throws(()=>textEditDocument(doc,{nodeId:'subject',changes:{[id]:'长文案'.repeat(300)}},ctx),{code:'edit.text-capacity'});assert.deepEqual(doc,before);
  }
  const button=fixture('button',{label:'原文'});assert.throws(()=>textEditDocument(button,{nodeId:'subject',changes:{label:'x'.repeat(4097)}},ctx),{code:'edit.text-limit'});
  const text=fixture('text',{text:'原文'});assert.throws(()=>textEditDocument(text,{nodeId:'subject',changes:{text:'x'.repeat(32769)}},ctx),{code:'edit.text-limit'});
  const panel=fixture('panel',{title:''});find(panel,'body').size.height=376;assert.throws(()=>textEditDocument(panel,{nodeId:'subject',changes:{title:'新标题'}},ctx),{code:'edit.slot-bounds'});
});

test('explicit List rows never expose or accept unused item labels; edit the actual child instead',()=>{
  const doc=fixture('list',{},true);assert.deepEqual(textEditFields(doc,'subject',ctx),[]);
  assert.throws(()=>textEditDocument(doc,{nodeId:'subject',changes:{'items.0.label':'无可见效果'}},ctx),{code:'edit.text-field'});
  const bad=structuredClone(doc);find(bad).props.items[0].label='无可见效果';assert.throws(()=>validateSizeEdit(doc,bad,ctx),{code:'edit.size-only'});
  const next=textEditDocument(doc,{nodeId:'custom-row',changes:{label:'真正的新文案'}},ctx);assert.equal(find(next,'custom-row').props.label,'真正的新文案');assert.equal(find(next).props.items[0].label,'条目甲');
});

test('HTML-like values stay literal strings and unchanged legacy labels retain compatibility',()=>{
  const doc=fixture('text',{text:'旧文字'}),literal='<script>x</script>',next=textEditDocument(doc,{nodeId:'subject',changes:{text:literal}},ctx);
  assert.equal(find(next).props.text,literal);assert.equal(textEditFields(next,'subject',ctx)[0].value,literal);assert.equal(JSON.parse(JSON.stringify(next)).nodes.find(node=>node.id==='subject').props.text,literal);
  const legacy=fixture('button',{label:'旧标签'.repeat(2000)});assert.deepEqual(validateSizeEdit(legacy,legacy,ctx),legacy);
  assert.deepEqual(textEditDocument(legacy,{nodeId:'subject',changes:{label:find(legacy).props.label}},ctx),legacy);
  assert.equal(find(textEditDocument(legacy,{nodeId:'subject',changes:{label:''}},ctx)).props.label,'');
  const legacySelect=fixture('select');find(legacySelect).props.options[1].label='旧选项'.repeat(2000);
  assert.equal(find(textEditDocument(legacySelect,{nodeId:'subject',changes:{'options.0.label':'新选项'}},ctx)).props.options[1].label,find(legacySelect).props.options[1].label);
  const old=structuredClone(doc);old.version='0.1';assert.deepEqual(validateSizeEdit(old,old,ctx),old);
});

test('candidate or real-render failure is atomic and text changes participate in undo redo',async()=>{
  const doc=fixture('button',{label:'原文'}),session=createSession(doc,ctx,async d=>{if(find(d).props.label==='字体拒绝')throw Error('real font rejected');return {dispose(){}};});
  await session.initialize();const initial=session.exportDocument();
  assert.throws(()=>textEditDocument(session.document,{nodeId:'subject',changes:{label:'过长'.repeat(500)}},ctx));assert.equal(session.exportDocument(),initial);assert.equal(session.canUndo,false);
  await assert.rejects(session.commit(textEditDocument(session.document,{nodeId:'subject',changes:{label:'字体拒绝'}},ctx)),/real font rejected/);assert.equal(session.exportDocument(),initial);assert.equal(session.canUndo,false);
  await session.commit(textEditDocument(session.document,{nodeId:'subject',changes:{label:'新文案'}},ctx));assert.equal(find(session.document).props.label,'新文案');await session.undo();assert.equal(find(session.document).props.label,'原文');await session.redo();assert.equal(find(session.document).props.label,'新文案');
  const applied=applyTextChanges(find(doc),{label:'新文案'},ctx);assert.equal(applied.props.label,'新文案');assert.equal(find(doc).props.label,'原文');
});
