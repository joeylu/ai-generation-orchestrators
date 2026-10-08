import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent,buildPanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {validatePanelSpec} from '../src/spec.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {attachPanelSession,projectPanelEvent} from '../src/state.mjs';
import {controlId,choiceId} from '../src/compiler.mjs';
import {tabsRequest,tabsIntent} from '../examples/tabs-v1/fixture.mjs';
import {digestJson} from '../src/canonical.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {createPanelEditContext,validatePanelEditContext} from '../src/edit-planning.mjs';
import {composePanelBundles,validatePanelComposition} from '../src/panel-composition.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {measureTabbedLayout} from '../src/flow-layout.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-mint-tabs.catalog.json',import.meta.url),'utf8'));
const core=await loadWorkspaceCore();
const context=await createPlanningContext(tabsRequest,catalog), proposal=await materializePanelIntent(context,tabsIntent(context));
const spec=proposal.spec,bundle=await createPanelBundle(spec,catalog,core);
test('native tabs materialization uses exact page scopes, enum state, capabilities and reproducible bundle',async()=>{
  assert.equal(context.planningContextVersion,'0.6');assert.equal(spec.panelSpecVersion,'0.6');assert.equal(bundle.compilerVersion,'0.6.0');
  assert.equal(buildPanelIntentResponseSchema(context).properties.panelIntentVersion.enum[0],'0.5');
  assert.deepEqual(spec.tabs.pages.map(p=>p.sections),[['section0'],['section1']]);assert.equal(bundle.state.navigation,'page0');
  assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
});

test('tabs edits update enum labels atomically, retain IDs and report navigation changes',async()=>{
  const ctx=await createPanelEditContext(spec,catalog,{requestVersion:'0.1',id:spec.id,text:'把声音页改名为音频，默认打开显示页，禁止切页。',target:'pixi'});
  assert.equal(ctx.capabilities.operations.length,12);assert.deepEqual(await validatePanelEditContext(ctx),ctx);
  const operations=[{op:'set-tab-label',pageId:'page0',label:'音频'},{op:'set-state-initial',fieldId:'navigation',value:'page1'},{op:'set-tabs-enabled',enabled:false}];
  const edited=await applyPanelPatch(spec,{patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'Explicit request',operations});
  assert.equal(edited.spec.tabs.pages[0].label,'音频');assert.equal(edited.spec.state.find(f=>f.id==='navigation').options[0].label,'音频');
  assert.deepEqual(edited.receipt.changedRowIds,['navigation']);assert.equal(spec.tabs.pages[0].label,'声音');
  await validatePanelBundle(await createPanelBundle(edited.spec,catalog,core,bundle.state),core);
  await assert.rejects(applyPanelPatch(spec,{patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'Invalid duplicate',operations:[operations[0],operations[0]]}),{code:'overlap'});
});

test('composing ordinary panels as tabs preserves namespaces, current state and source reset scope; nested tabs fail explicitly',async()=>{
  const sources=[];
  for(let i=0;i<2;i++){
    const s=structuredClone(spec);s.id='source'+i;s.title=i?'显示':'声音';s.tabs=null;s.state=s.state.filter(f=>f.id!=='navigation');
    const b=await createPanelBundle(s,catalog,core,{row0:10+i,row1:false,row3:90+i,row4:.7+i*.1});sources.push(b);
  }
  const request={panelCompositionRequestVersion:'0.1',id:'composed',title:'分页组合',sources:sources.map((b,i)=>({namespace:'n'+i,bundleSha256:b.sha256})),
    layout:'tabs',width:null,canvasWidth:null,canvasHeight:null,maxHeight:480,surfaceFrom:null};
  const result=await composePanelBundles(request,sources,core);assert.deepEqual(await validatePanelComposition(result,sources,core),result);
  assert.equal(result.bundle.spec.tabs.pages.length,2);assert.equal(result.bundle.state.n1_f_row0,11);
  const reset=projectPanelEvent(result.bundle.spec,result.bundle.state,{id:controlId('composed','n0_r_row2'),type:'activate',source:'mouse'});
  assert.equal(reset.state.n0_f_row0,70);assert.equal(reset.state.n1_f_row0,11);assert.equal(reset.state.navigation,'page0');
  const bad={...request,sources:[{namespace:'n0',bundleSha256:bundle.sha256},request.sources[1]]};
  await assert.rejects(composePanelBundles(bad,[bundle,sources[1]],core),{code:'COMPOSITION_NESTED_TABS_UNSUPPORTED'});
});

test('native Unity lowering declares ordered pages, enum semantics and no replacement controls',async()=>{
  const native=await createUnityDocument(bundle,core), navigation=native.controls.find(c=>c.kind==='tabs');
  assert.equal(native.adapterVersion,'0.1.5');assert.deepEqual(navigation.contentIds,['tabs-settings.page.page0','tabs-settings.page.page1']);
  const node=native.nodes.find(n=>n.id===navigation.nodeId);assert.equal(node.type,'Tabs');
  assert.deepEqual(native.nodes.filter(n=>n.parentId===node.id).map(n=>n.id),navigation.contentIds);
  assert.equal(native.fields.find(f=>f.id==='navigation').stringValue,'page0');
});

test('long page popup clearance shares a fixed viewport without restoring the standalone-button background',async()=>{
  const s=structuredClone(spec),row=s.sections[0].rows[0];
  for(let i=0;i<8;i++){const id='long'+i;s.sections[0].rows.push({...row,id,bind:id,event:'panel.'+id});s.state.push({id,type:'number',min:0,max:100,step:1,initial:50});}
  s.sections[0].rows.push({id:'quality',kind:'select',label:'画质',recipe:{id:'settings.select',version:'0.1.0'},bind:'quality',event:'panel.quality',enabled:true});
  s.state.push({id:'quality',type:'enum',initial:'medium',options:[{id:'low',label:'低'},{id:'medium',label:'中'},{id:'high',label:'高'}]});
  const b=await createPanelBundle(s,catalog,core),layout=measureTabbedLayout(s);assert(layout.pages[0].contentHeight>layout.pages[0].viewportHeight);
  assert.equal(layout.pages[0].viewportHeight,layout.pages[1].viewportHeight);assert(layout.panelY>=0);assert(layout.panelY+layout.panelHeight+122<=s.canvas.height);
  const nodes=[];const visit=n=>{nodes.push(n);for(const c of n.children??[])visit(c);};visit(b.componentBundle.document.root);
  assert(!nodes.some(n=>n.id===s.id+'.row.row2'));assert(nodes.find(n=>n.id===s.id+'.page.page0').type==='ScrollView');
});

test('eight page scopes compile independently; ninth page and missing memberships cannot claim generation support',async()=>{
  const s=structuredClone(spec);s.sections=[];s.state=[];s.tabs.pages=[];
  for(let i=0;i<8;i++){const id='page'+i,section='section'+i,row='row'+i;s.tabs.pages.push({id,label:'分类'+i,sections:[section]});s.sections.push({id:section,title:'设置'+i,rows:[{...spec.sections[0].rows[0],id:row,bind:row,event:'panel.'+row}]});s.state.push({id:row,type:'number',min:0,max:100,step:1,initial:70});}
  s.state.push({id:'navigation',type:'enum',initial:'page7',options:s.tabs.pages.map(({id,label})=>({id,label}))});
  s.layout.width=1100;s.canvas.width=1164;s.layout.body.children=s.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}));
  const b=await createPanelBundle(s,catalog,core);assert.equal(b.state.navigation,'page7');await validatePanelBundle(b,core);
  const ninth=structuredClone(s);ninth.tabs.pages.push({id:'page8',label:'九',sections:['section0']});assert.throws(()=>validatePanelSpec(ninth));
});
test('tabs reject uncovered, repeated, unknown sections, mismatched options, shared field and old contract',()=>{
  const cases=[s=>s.tabs.pages[1].sections.push('section0'),s=>s.tabs.pages[1].sections=['missing'],s=>s.tabs.pages[1].sections=[],
    s=>s.tabs.bind='row0',s=>s.state.find(f=>f.id==='navigation').options[0].label='wrong',s=>s.tabs.id='row0',s=>s.panelSpecVersion='0.5'];
  for(const mutate of cases){const s=structuredClone(spec);mutate(s);assert.throws(()=>validatePanelSpec(s));}
});
test('each page owns real content, header geometry and stable value bindings',()=>{
  const nodes=[];const visit=n=>{nodes.push(n);for(const c of n.children??[])visit(c);};visit(bundle.componentBundle.document.root);
  const tabs=nodes.find(n=>n.type==='Tabs');assert.equal(tabs.props.tabs.length,2);assert.equal(tabs.props.activeId,choiceId(spec.id,'navigation','page0'));
  assert(tabs.children.every(n=>n.layout.y===60));assert.equal(tabs.children[0].children[0].id,spec.id+'.section.section0');
  assert.equal(tabs.children[1].children[0].id,spec.id+'.section.section1');assert.equal(nodes.filter(n=>n.type==='ProgressBar').length,1);
});
test('navigation preserves hidden-page values, supports host state and emits only actual user changes',()=>{
  const nodes=new Map();const visit=n=>{nodes.set(n.id,n);for(const c of n.children??[])visit(c);};const document=structuredClone(bundle.componentBundle.document);visit(document.root);
  let listener;const runtime={getDocument:()=>document,subscribe:f=>{listener=f;return()=>{};},setValue:(id,v)=>{const n=nodes.get(id);n.props[n.type==='Tabs'?'activeId':n.type==='Slider'?'value':n.type==='Switch'?'checked':'value']=v;listener({id,type:'change',source:'control',value:v});}};
  const events=[],session=attachPanelSession(spec,runtime,e=>events.push(e),bundle.state);
  session.setState({...session.getState(),row0:35,row3:85,navigation:'page1'});assert.deepEqual(events,[]);
  session.setProgress('row4',0.376123456789);assert.equal(session.getState().row4,0.376123456789);
  listener({id:controlId(spec.id,'navigation'),type:'change',source:'keyboard',value:choiceId(spec.id,'navigation','page0')});
  assert.equal(session.getState().navigation,'page0');assert.equal(session.getState().row0,35);assert.equal(session.getState().row3,85);assert.equal(events.length,1);
  const reset=projectPanelEvent(spec,session.getState(),{id:controlId(spec.id,'row2'),type:'activate',source:'keyboard'});
  assert.equal(reset.state.row0,70);assert.equal(reset.state.row3,85);assert.equal(reset.state.navigation,'page0');
  session.destroy();assert.throws(()=>session.setState(bundle.state));
});
