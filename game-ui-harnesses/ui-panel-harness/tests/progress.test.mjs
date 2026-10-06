import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, nodesOf } from './helpers.mjs';
import { progressRequest, progressIntent } from '../examples/progress-v1/fixture.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent, buildPanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { validatePanelSpec, validatePanelState } from '../src/spec.mjs';
import { compilePanel, initialPanelState, controlId } from '../src/compiler.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { attachPanelSession, projectPanelEvent } from '../src/state.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { digestJson } from '../src/canonical.mjs';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { createUnityKitFiles } from '../src/unity-kit.mjs';
import { readUnityAdapterSources } from '../src/unity-export-io.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url),'utf8'));
const catalog = await json('../examples/modern-mint-progress.catalog.json');
const context = await createPlanningContext(progressRequest, catalog);
const proposal = await materializePanelIntent(context, progressIntent(context));
const spec = proposal.spec;
function runtime(state = initialPanelState(spec)) {
  const document = compilePanel(spec, catalog, core, state).document, nodes = new Map(nodesOf(document).map(node => [node.id, node]));
  const listeners = new Set(), writes = [];
  return { document, writes, getDocument: () => document,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setValue(id, value) { writes.push({id,value}); nodes.get(id).props.value = value; for (const fn of listeners) fn({id,type:'change',source:'control',value}); },
    emit(value) { for (const fn of listeners) fn(value); }, count: () => listeners.size };
}
test('progress capability is catalog-derived while old catalog contexts remain exact and unsupported', async () => {
  assert.equal(context.planningContextVersion,'0.5'); assert(context.capabilities.rowKinds.includes('progress'));
  assert.deepEqual(await validatePlanningContext(context), context);
  assert(context.candidates.some(recipe => recipe.kind === 'progress-row'));
  const old = await createPlanningContext(progressRequest, await json('../examples/modern-mint-layout.catalog.json'));
  assert.equal(old.planningContextVersion,'0.4'); assert(!old.capabilities.rowKinds.includes('progress'));
  assert.deepEqual(buildPanelIntentResponseSchema(context).properties.panelIntentVersion.enum,['0.4']);
  await assert.rejects(materializePanelIntent(old, { ...progressIntent(old) }), {code:'INTENT_VERSION'});
  await assert.rejects(materializePanelIntent(context, { ...progressIntent(context), panelIntentVersion:'0.3' }), {code:'INTENT_VERSION'});
});
test('progress contract rejects interactivity, malformed continuous ranges and cross-kind binding', () => {
  assert.equal(spec.panelSpecVersion,'0.5'); assert.deepEqual(spec.state[0], {id:'row0',type:'progress',initial:0.2,max:1});
  assert(!Object.hasOwn(spec.sections[0].rows[0],'enabled')); assert(!Object.hasOwn(spec.sections[0].rows[0],'event'));
  for (const mutate of [s => {s.panelSpecVersion='0.4';}, s => {s.state[0].max=0;}, s => {s.state[0].initial=2;},
    s => {s.state[0].step=0.1;}, s => {s.sections[0].rows[0].enabled=true;}, s => {s.sections[0].rows[0].event='load.change';},
    s => {s.sections[0].rows[0].bind='row2';}, s => {s.sections[0].rows[0].format.mode='indeterminate';},
    s => {s.sections[0].rows[0].format.fractionDigits=7;}]) {
    const altered = structuredClone(spec); mutate(altered); assert.throws(() => validatePanelSpec(altered));
  }
  for (const value of [-0.1,1.01,NaN,Infinity,'0.5']) assert.throws(() => validatePanelState(spec,{...initialPanelState(spec),row0:value}));
  assert.equal(validatePanelState(spec,{...initialPanelState(spec),row0:0.376123456789}).row0,0.376123456789);
});
test('compiler emits ProgressBar with live formatted percentage and absolute text, without slider semantics', async () => {
  const state={row0:0.376123456789,row1:123.456789,row2:false};
  const bundle=await createPanelBundle(spec,catalog,core,state); await validatePanelBundle(bundle,core);
  assert.equal(bundle.panelBundleVersion,'0.5'); assert.equal(bundle.compilerVersion,'0.5.1');
  const nodes=nodesOf(bundle.componentBundle.document), bars=nodes.filter(node=>node.type==='ProgressBar');
  assert.equal(bars.length,2); assert(!nodes.some(node=>node.type==='Slider'));
  assert.equal(bars[0].props.value,state.row0*100); assert.equal(bars[0].props.max,100);
  assert.equal(bars[1].props.value,state.row1); assert.equal(bars[1].props.max,250);
  assert.equal(nodes.find(n=>n.id.endsWith('.row.row0.value')).props.text,'37.6%');
  assert.equal(nodes.find(n=>n.id.endsWith('.row.row1.value')).props.text,'123.46');
  assert.deepEqual(bundle.bindings[0],{nodeId:controlId(spec.id,'row0'),fieldId:'row0',type:'progress',readOnly:true});
  await validatePanelBundle(await createPanelBundle(spec,catalog,core,state,undefined,'0.5.0'),core);
});
test('progress session preserves exact host state, ignores input, and validates updates before any writes', () => {
  const state={...initialPanelState(spec),row0:0.376123456789}, r=runtime(state), events=[];
  assert.throws(()=>attachPanelSession(spec,r,()=>{}),/PANEL_PROGRESS_STATE_REQUIRED/);
  const session=attachPanelSession(spec,r,event=>events.push(event),state);
  assert.deepEqual(session.getState(),state);
  for (const source of ['mouse','touch','pen','keyboard','control']) {
    const input={id:controlId(spec.id,'row0'),type:'change',source,value:1}; r.emit(input);
    assert.deepEqual(projectPanelEvent(spec,state,input),{state,event:null});
  }
  for (const value of [0,0.3333333333333333,1]) { session.setProgress('row0',value); assert.equal(session.getState().row0,value); }
  const count=r.writes.length;
  for (const value of [-1,1.001,NaN,'0.5']) assert.throws(()=>session.setProgress('row0',value));
  assert.throws(()=>session.setProgress('row2',1)); assert.equal(r.writes.length,count); assert.equal(events.length,0);
  session.destroy(); assert.equal(r.count(),0); assert.throws(()=>session.setProgress('row0',0),/DESTROYED/);
});
test('absolute progress reserves readable space for large counts and rounded maximums', async () => {
  const intent=progressIntent(context);Object.assign(intent.panel.body.children[0].rows[1],{max:100000000,initial:99999999.995});
  const {spec:large}=await materializePanelIntent(context,intent), compiled=compilePanel(large,catalog,core);
  const value=nodesOf(compiled.document).find(node=>node.id.endsWith('.row.row1.value'));
  assert(value.layout.width>=value.props.text.length*16*0.8);assert.equal(value.props.text,'100000000.00');
});
test('progress session rejects scaled hydration mismatch rather than silently adopting renderer values', () => {
  const r=runtime();
  assert.throws(()=>attachPanelSession(spec,r,()=>{},{...initialPanelState(spec),row0:0.3}),/MISMATCH/);
  nodesOf(r.document).find(node=>node.type==='ProgressBar').props.max=1;
  assert.throws(()=>attachPanelSession(spec,r,()=>{},initialPanelState(spec)),/MISMATCH/);
});
test('progress edits preserve current value, update defaults, support add/remove, and reject enabled changes', async () => {
  const patch=operations=>({patchVersion:'0.1',baseSpecSha256:'',reason:'明确修改加载条',operations});
  const apply=async operations=>applyPanelPatch(spec,{...patch(operations),baseSpecSha256:await digestJson(spec)});
  const changed=(await apply([{op:'set-row-label',rowId:'row0',label:'下载进度'},{op:'set-state-initial',fieldId:'row0',value:0.1}])).spec;
  const saved={row0:0.376123456789,row1:50,row2:true}, bundle=await createPanelBundle(changed,catalog,core,saved);
  assert.deepEqual(bundle.state,saved); assert.equal(bundle.spec.state[0].initial,0.1);
  await assert.rejects(apply([{op:'set-row-enabled',rowId:'row0',enabled:true}]),{code:'unknown-key'});
  const row={...spec.sections[0].rows[0],id:'extra',bind:'extra'}, field={id:'extra',type:'progress',initial:0.75,max:1};
  const added=(await apply([{op:'add-row',sectionId:'section0',afterRowId:'row1',row,state:field}])).spec;
  assert.equal(added.sections[0].rows[2].id,'extra'); await createPanelBundle(added,catalog,core);
  await assert.rejects(apply([{op:'remove-row',rowId:'row0'}]),{code:'action-field'});
  const removed=(await apply([{op:'remove-row',rowId:'row1'}])).spec; assert(!removed.state.some(field=>field.id==='row1'));
});
test('progress reset actions restore only explicitly scoped fields through the renderer', () => {
  const state={row0:0.9,row1:200,row2:false}, r=runtime(state), events=[], session=attachPanelSession(spec,r,e=>events.push(e),state);
  r.emit({id:controlId(spec.id,'row3'),type:'activate',source:'mouse'});
  assert.deepEqual(session.getState(),{row0:0.2,row1:200,row2:false}); assert.equal(events.length,1);
  assert.deepEqual(r.writes,[{id:controlId(spec.id,'row0'),value:20}]); session.destroy();
});
test('two composed progress panels keep separate host state and source-local resets', async () => {
  const a=await createPanelBundle(spec,catalog,core,{row0:0.9,row1:201,row2:false});
  const b=await createPanelBundle({...spec,id:'second-loading'},catalog,core,{row0:0.8,row1:202,row2:true});
  const request={panelCompositionRequestVersion:'0.1',id:'combined-loading',title:'组合加载状态',layout:'grid',width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,surfaceFrom:null,
    sources:[{namespace:'first',bundleSha256:a.sha256},{namespace:'second',bundleSha256:b.sha256}]};
  const result=await composePanelBundles(request,[a,b],core); await validatePanelComposition(result,[a,b],core);
  assert.equal(result.bundle.spec.panelSpecVersion,'0.5'); assert.equal(result.bundle.state.first_f_row0,0.9); assert.equal(result.bundle.state.second_f_row0,0.8);
  const reset=result.bundle.spec.sections[0].rows.find(row=>row.kind==='button');
  assert.deepEqual(reset.action.fields,['first_f_row0']);
});
test('Unity kit preserves continuous values and declares native read-only UGUI progress without extra shared scripts', async () => {
  const bundle=await createPanelBundle(spec,catalog,core,{row0:0.376123456789,row1:123.456789,row2:false});
  const native=await createUnityDocument(bundle,core), fields=native.fields.filter(field=>field.type==='progress');
  assert.equal(native.adapterVersion,'0.1.4'); assert.equal(fields[0].numberValue,0.376123456789); assert.equal(fields[0].step,0);
  assert.equal(native.controls[0].displayMode,'percent'); assert.equal(native.controls[0].enabled,false); assert.equal(native.controls[0].eventName,'');
  const sources=await readUnityAdapterSources(), kit=await createUnityKitFiles(bundle,core,sources);
  assert.equal([...kit.contents.keys()].filter(path=>path.endsWith('.cs')).length,6);
  assert.match(sources['Editor/PanelPrefabBuilder.cs'],/fill\.type = Image\.Type\.Filled/);
  assert.match(sources['Runtime/PanelController.cs'],/public bool SetProgress/);
});
test('new public schema references all resolve and strict native edit transport includes progress additions', async () => {
  const native=await buildCodexEditResponseSchema({draft:true}); assert(JSON.stringify(native).includes('progress'));
  const files=['panel-spec.schema.json','panel-spec-v0.2.schema.json','panel-spec-v0.3.schema.json','panel-spec-v0.4.schema.json','panel-spec-v0.5.schema.json','panel-spec-v0.6.schema.json','panel-spec-v0.7.schema.json',
    'panel-proposal-v0.5.schema.json','panel-patch.schema.json','panel-edit-context.schema.json','panel-request.schema.json'];
  const docs=await Promise.all(files.map(file=>json('../schemas/'+file))), registry=new Map(docs.map(d=>[d.$id,d]));
  function check(value,owner) { if(!value||typeof value!=='object')return;
    if(value.$ref){const [id,pointer='']=value.$ref.split('#');let found=id?registry.get(id):owner;assert(found,value.$ref);
      for(const part of pointer.split('/').slice(1))found=found[part.replaceAll('~1','/').replaceAll('~0','~')]; assert(found,value.$ref);}
    for(const child of Object.values(value))check(child,owner);
  }
  docs.forEach(doc=>check(doc,doc));
});
