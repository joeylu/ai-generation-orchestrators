import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {planningClient} from '../src/panel/planning-client.mjs';
import {settingsFromIntent,validateSettingsResponse} from '../src/panel/settings-intent.mjs';
import {editorData} from '../src/panel/data.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url)));
const catalog=await read('../../ui-panel-harness/examples/modern-mint-layout.catalog.json');
const policy={...await read('../configs/settings-planning-policy.json'),intentVersion:'0.3',themeKey:'modern-mint-light@0.1.0'},layout=await read('../configs/settings-layout.json');
// These protocol regressions intentionally retain the historical row compiler.
layout.presentation.version='1.0';
const ctx=await editorData();ctx.binding={sourceKind:'imported',sha256:'a'.repeat(64)};
const text='设置。音乐开关默认关闭且禁用；音量范围负10到10，步长0.5，默认负2.5；语言下拉框选项中文、English，默认English。';
const session=await planningClient().prepare({request:{requestVersion:'0.1',id:'intent-settings',text,target:'pixi'},catalog});
function fixture(){
  const common=(kind,id,label)=>({kind,id,label,recipeKey:`settings.${kind}@0.1.0`,sourceQuote:text,icon:null,enabled:true});
  return {panelIntentVersion:'0.3',contextSha256:session.context.sha256,unresolved:[],panel:{id:'intent-settings',title:'设置',themeKey:policy.themeKey,panelSurface:null,
    layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'error'},
    body:{kind:'column',children:[{kind:'section',id:'section0',title:'',rows:[
      {...common('switch','row0','音乐'),initial:false,enabled:false},
      {...common('slider','row1','音量'),min:-10,max:10,step:0.5,initial:-2.5,prefix:'',suffix:''},
      {...common('select','row2','语言'),options:[{label:'中文',initial:false},{label:'English',initial:true}]}
    ]}]}}};
}
const run=(intent=fixture(),s=session)=>settingsFromIntent(s,intent,policy,layout,ctx);

test('clarification is validated as data and cannot be mistaken for a compiled panel',async()=>{
  const question={...fixture(),panel:null,unresolved:[{id:'q0',question:'请选择皮肤。'}]};
  assert.deepEqual((await validateSettingsResponse(session,question)).intent,question);
  await assert.rejects(()=>run(question),{code:'panel.intent-unresolved'});
  await assert.rejects(()=>validateSettingsResponse(session,{...question,unresolved:[{id:'q0',question:12}]}),{code:'panel.intent-schema'});
});

test('native planning fixture preserves values, fractional ranges, choices and disabled state in both orientations',async()=>{
  const intent=fixture(),before=structuredClone(intent),result=await run(intent);
  assert.deepEqual(intent,before);assert.deepEqual(await run(),result);
  for(const doc of Object.values(result.documents)){
    const row=id=>doc.nodes.find(n=>n.id===id).props;
    assert.equal(row('row0').checked,false);assert.equal(row('row0').enabled,false);
    for(const [key,value] of Object.entries({min:-10,max:10,step:0.5,value:-2.5}))assert.equal(row('row1')[key],value);
    assert.equal(row('row2').selectedId,'option1');assert.deepEqual(row('row2').options.map(o=>o.label),['中文','English']);
    assert.deepEqual(doc.bindings,ctx.binding);
  }
});

test('adapter rejects unsupported or ambiguous semantics rather than dropping them',async()=>{
  const cases=[
    i=>i.contextSha256='0'.repeat(64),i=>i.panel.extra=true,
    i=>i.panel.body.children[0].rows[0].recipeKey='foreign@1',
    i=>i.panel.body.children[0].rows[0].sourceQuote='不存在的要求',
    i=>i.panel.body.children[0].rows[1].id='row0',
    i=>i.panel.body.children[0].rows[1].step=0,
    i=>i.panel.body.children[0].rows[1].initial=100,
    i=>i.panel.body.children[0].rows[1].suffix='%',
    i=>i.panel.body.children[0].rows[2].options[0].initial=true,
    i=>i.panel.body.children[0].rows[2].options[1].label='中文',
    i=>i.panel.body.kind='grid',i=>i.panel.body.children[0].title='不得丢失的分组',
    i=>i.panel.layout.width=999,i=>i.panel.layout.overflow='clip',
    i=>delete i.panel.body.children[0].rows[1].min,
  ];
  for(const mutate of cases){const intent=fixture();mutate(intent);await assert.rejects(()=>run(intent));}
  await assert.rejects(()=>run({...fixture(),panel:null}),{code:'panel.intent-unresolved'});
  const altered=structuredClone(session);altered.responseSchema.description='drift';await assert.rejects(()=>run(fixture(),altered));
});

const currentPolicy=await read('../configs/settings-planning-policy.json');
const currentCatalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json');
const currentSession=await planningClient().prepare({request:{requestVersion:'0.1',id:'intent-settings',text,target:'pixi'},catalog:currentCatalog});
function modernFixture(){
  const intent=fixture();intent.panelIntentVersion='0.12';intent.contextSha256=currentSession.context.sha256;intent.panel.themeKey=currentPolicy.themeKey;
  const section=intent.panel.body.children[0];delete section.id;section.actionLayout=null;section.title='音频与语言';
  section.rows=section.rows.map(({id,sourceQuote,...row})=>({...row,sourceRef:'request'}));return intent;
}
test('native tabs preserve page labels, selection, disabled state and per-page groups',async()=>{
  const intent=modernFixture(),section=intent.panel.body.children[0];intent.panel.layout.overflow='scroll';
  intent.panel.body={kind:'tabs',enabled:false,sourceRef:'request',pages:[
    {label:'声音',initial:false,sourceRef:'request',body:{kind:'column',children:[{...section,rows:section.rows.slice(0,2)}]}},
    {label:'语言',initial:true,sourceRef:'request',body:{kind:'column',children:[{...section,rows:section.rows.slice(2)}]}}
  ]};
  const context={...ctx,scrollInsets:{left:14,right:14,top:14,bottom:14}};
  const result=await settingsFromIntent(currentSession,intent,currentPolicy,layout,context);
  assert.deepEqual(result.content.tabs.map(t=>t.label),['声音','语言']);
  for(const doc of Object.values(result.documents)){
    const tabs=doc.nodes.find(n=>n.id==='settings-tabs');assert.equal(tabs.props.activeId,'tab1');assert.equal(tabs.props.enabled,false);
    assert.deepEqual(tabs.slots.pages,['settings-scroll-0','settings-scroll-1']);
    assert.deepEqual(doc.nodes.find(n=>n.id==='body').slots.children,['heading','settings-tabs','footer']);
  }
  intent.panel.body.pages[0].initial=true;
  await assert.rejects(()=>settingsFromIntent(currentSession,intent,currentPolicy,layout,context));
});
test('native scroll intent reaches ScrollView without changing field values or the fixed footer',async()=>{
  const intent=modernFixture();intent.panel.layout.overflow='scroll';
  const result=await settingsFromIntent(currentSession,intent,currentPolicy,layout,{...ctx,scrollInsets:{left:14,right:14,top:14,bottom:14}});
  assert.equal(result.content.overflow,'scroll');
  for(const doc of Object.values(result.documents)){
    assert.deepEqual(doc.nodes.find(n=>n.id==='body').slots.children,['heading','settings-scroll','footer']);
    assert.equal(doc.nodes.find(n=>n.id==='row1').props.value,-2.5);
  }
});
test('native 0.12 settings preserves the legacy subset semantics with stable generated row IDs',async()=>{
  const intent=modernFixture(),before=structuredClone(intent);
  const current=await settingsFromIntent(currentSession,intent,currentPolicy,layout,ctx),old=await run();
  assert.equal(current.content.sectionTitle,'音频与语言');const {sectionTitle,...rest}=current.content;assert.deepEqual(rest,old.content);assert.deepEqual(current.documents,old.documents);assert.deepEqual(intent,before);
  assert.equal(current.provenance.intentVersion,'0.12');
});
test('native settings refuses unsupported layout, evidence and mismatched protocol without losing fields',async()=>{
  for(const mutate of [i=>i.panel.body.children[0].rows[0].sourceRef='invented',i=>i.panel.body.children[0].kind='grid',i=>i.panel.body.children[0].actionLayout={direction:'row',align:'center',gap:8,buttonWidth:100,buttonHeight:48,shape:'default',sourceRef:'request'},i=>i.panel.body.children[0].rows[1].suffix='%']){
    const i=modernFixture();mutate(i);await assert.rejects(()=>settingsFromIntent(currentSession,i,currentPolicy,layout,ctx));
  }
  await assert.rejects(()=>settingsFromIntent(currentSession,modernFixture(),policy,layout,ctx),{code:'panel.intent-version'});
});

test('multiple native settings groups retain titles, global row IDs and source order in both orientations',async()=>{
  const i=modernFixture(),section=i.panel.body.children[0];
  i.panel.body.children=[{...section,title:'声音',rows:section.rows.slice(0,2)},{...section,title:'语言',rows:section.rows.slice(2)}];
  const r=await settingsFromIntent(currentSession,i,currentPolicy,layout,ctx);
  assert.deepEqual(r.content.groups,[{id:'group0',title:'声音',fieldIds:['row0','row1']},{id:'group1',title:'语言',fieldIds:['row2']}]);
  for(const doc of Object.values(r.documents)){
    assert.deepEqual(doc.nodes.find(n=>n.id==='body').slots.children,['heading','section-heading-0','row0-row','row1-row','section-heading-1','row2-row','footer']);
    assert.equal(doc.nodes.find(n=>n.id==='row0').props.enabled,false);
    assert.equal(doc.nodes.find(n=>n.id==='row1').props.value,-2.5);
  }
});

test('explicit canvas selection compiles only the chosen ratio and rejects unsupported selections',async()=>{for(const orientation of ['landscape','portrait']){const result=await settingsFromIntent(session,fixture(),policy,layout,{...ctx,orientation});assert.deepEqual(Object.keys(result.documents),[orientation]);}await assert.rejects(()=>settingsFromIntent(session,fixture(),policy,layout,{...ctx,orientation:'square'}),/ORIENTATION_INVALID/);});
