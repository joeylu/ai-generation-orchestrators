import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData,presetDocument} from '../src/panel/data.mjs';
import {createSession} from '../src/panel/session.mjs';
import {sizeEditDocument,sizeEditTargets,validateSizeEdit,positionEditDocument,rectangleEditDocument,freeLayoutDocument} from '../src/panel/size-edit.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {settingsDocument} from '../src/panel/settings.mjs';

const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url))),ctx=await editorData();
const config=customActionConfig(await read('../configs/action-presets.json')),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json');
const examples=await read('../examples/custom-layout.json');
const fixture=()=>presetDocument(ctx.presets.presets[0],ctx);
const find=(doc,id)=>doc.nodes.find(n=>n.id===id);
const actual=(doc,id,c=ctx)=>sizeEditTargets(doc,c).find(n=>n.id===id);
async function rich(example=examples[0],context=ctx){const f=await actionFixture(example,catalog,config);return (await actionPresetFromIntent(f.session,f.intent,config,'custom',{...context,orientation:'landscape'})).documents.landscape;}

function geometryContext(mutate=()=>{}){
  const roles=ctx.usage.bindings.map(({role,assetId})=>({role,assetId}));
  const assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:512,stretch:'nine-slice',nineSlice:{left:0,right:0,top:0,bottom:0},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:1,height:1}}));
  const pack={scale:1,roles,assets};mutate(pack);return {...ctx,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:'a'.repeat(64)}};
}

test('outer panel resizes its content width and remains centered without changing frozen source',()=>{
  const doc=fixture(),before=structuredClone(doc),next=sizeEditDocument(doc,{nodeId:'settings',width:680},ctx);
  assert.deepEqual(doc,before);assert.equal(find(next,'settings').size.width,680);
  assert.equal(find(next,'settings').position.x,300);assert.equal(find(next,'settings').position.y,48);
  assert.equal(find(next,'settings-body').size.width,656);
  assert.deepEqual(next.bindings,doc.bindings);assert.deepEqual(next.nodes.map(n=>n.props),validateSizeEdit(doc,doc,ctx).nodes.map(n=>n.props));
  assert.throws(()=>sizeEditDocument(doc,{nodeId:'settings',width:1400},ctx));
  assert.throws(()=>sizeEditDocument(doc,{nodeId:'settings',height:100},ctx));
});

test('internal controls and fill dimensions become explicit fixed dimensions with actual solver equality',async()=>{
  const doc=await rich(),row=find(doc,'row4'),original=actual(doc,'row4');
  const next=sizeEditDocument(doc,{nodeId:'row4',width:original.width+20,height:row.size.height+12},ctx);
  assert.equal(actual(next,'row4').width,original.width+20);assert.equal(actual(next,'row4').height,row.size.height+12);
  assert.equal(find(next,'row4').sizing.widthMode??'fixed','fixed');assert.deepEqual(find(next,'row4').props,row.props);
  const flowId='row0',width=actual(doc,flowId).width;
  const fixed=sizeEditDocument(doc,{nodeId:flowId,width:width-10},ctx);
  assert.equal(find(fixed,flowId).sizing.widthMode,'fixed');assert(Math.abs(actual(fixed,flowId).width-(width-10))<.1);
});

test('content containers may explicitly become fixed while remaining subject to descendant overflow',()=>{
  const doc=fixture(),id='settings-body';doc.version='0.3';
  // Exercise content sizing explicitly: an upstream fixture may already emit
  // a fixed group and would no longer test the intended authoring transition.
  const group=find(doc,id);group.sizing={...group.sizing,heightMode:'content'};
  const size=actual(doc,id);
  const next=sizeEditDocument(doc,{nodeId:id,height:size.height+20},ctx);
  assert.equal(find(next,id).sizing.heightMode,'fixed');assert.equal(actual(next,id).height,size.height+20);
  assert.throws(()=>sizeEditDocument(doc,{nodeId:id,height:24},ctx));
});

test('scrolling panel changes viewport capacity while preserving independent scroll content height',async()=>{
  const doc=await rich({...examples[0],overflow:'scroll'}),surface=find(doc,'surface'),scroll=find(doc,'custom-scroll'),content=find(doc,scroll.slots.content[0]);
  const next=sizeEditDocument(doc,{nodeId:'surface',width:surface.size.width+80,height:surface.size.height+40},ctx);
  assert.equal(find(next,'custom-scroll').size.height,scroll.size.height+40);
  assert.equal(find(next,content.id).size.width,content.size.width+80);
  assert.equal(find(next,content.id).sizing.heightMode,'content');
  assert.equal(actual(next,content.id).height,actual(doc,content.id).height);
});

test('fixed grid children expose explicit unavailability and never silently ignore requested dimensions',async()=>{
  const doc=await rich(examples[1]),cell=actual(doc,'layout-0-cell-0');
  assert.equal(cell.editableWidth,false);assert.equal(cell.editableHeight,false);assert.match(cell.reason,/网格/);
  assert.throws(()=>sizeEditDocument(doc,{nodeId:cell.id,width:cell.width+1},ctx),{code:'edit.size-unavailable'});
  const root=actual(doc,doc.rootId);assert.equal(root.editableWidth,false);
});

test('settings Tabs preserve their two safe surfaces and synchronize all page viewports',async()=>{
  const content=await read('../configs/settings-content.json'),layout=await read('../configs/settings-layout.json'),fields=content.fields.slice(0,2);
  const grouped={...content,fields,groups:fields.map((f,i)=>({id:'g'+i,title:'分组'+i,fieldIds:[f.id]})),tabsEnabled:true,tabs:fields.map((f,i)=>({id:'t'+i,label:'页'+i,initial:i===0,groupIds:['g'+i]}))};
  const doc=settingsDocument(grouped,layout,'landscape',ctx),surface=find(doc,'settings'),tabs=find(doc,'settings-tabs');
  const next=sizeEditDocument(doc,{nodeId:'settings',width:surface.size.width+80,height:surface.size.height+40},ctx);
  assert.equal(find(next,'settings-tabs').size.width,tabs.size.width+80);assert.equal(find(next,'settings-tabs').size.height,tabs.size.height+40);
  for(const id of tabs.slots.pages){assert.equal(find(next,id).size.width,find(doc,id).size.width+80);assert.equal(find(next,id).size.height,find(doc,id).size.height+40);}
});

test('server save gate forbids text styles, unrelated layout, bindings, constraints and geometry regressions',()=>{
  const doc=fixture();
  for(const mutate of [d=>find(d,'intro').props.align='right',d=>find(d,'settings-body').layout.gap=0,d=>d.bindings.sha256='b'.repeat(64),d=>find(d,'intro').sizing={minWidth:24},d=>find(d,'intro').name='改名',d=>find(d,'settings').slots.content=[]]){
    const bad=structuredClone(doc);mutate(bad);assert.throws(()=>validateSizeEdit(doc,bad,ctx));
  }
  const text=structuredClone(doc);find(text,'intro').size={width:80,height:52};assert.throws(()=>validateSizeEdit(doc,text,ctx),{code:'edit.text-capacity'});
  const canvas=structuredClone(doc);find(canvas,'artboard').size.width=1200;assert.throws(()=>validateSizeEdit(doc,canvas,ctx));
});

test('outer surfaces and existing free children move in parent-local coordinates inside fixed bounds',()=>{
  const doc=fixture(),before=structuredClone(doc),surface=actual(doc,'settings'),note=actual(doc,'note');
  assert.equal(surface.editablePosition,true);assert.equal(note.editablePosition,true);assert.equal(actual(doc,'intro').editablePosition,false);
  const moved=positionEditDocument(doc,{nodeId:'settings',x:100,y:32},ctx);
  assert.deepEqual(find(moved,'settings').position,{x:100,y:32});assert.deepEqual(doc,before);
  assert.deepEqual(find(sizeEditDocument(moved,{nodeId:'settings',width:640},ctx),'settings').position,{x:100,y:32});
  const internal=positionEditDocument(doc,{nodeId:'note',x:24,y:24},ctx);assert.deepEqual(find(internal,'note').position,{x:24,y:24});
  assert.deepEqual(validateSizeEdit(doc,internal,ctx),internal);
  for(const edit of [{nodeId:'settings',x:1000,y:32},{nodeId:'note',x:400,y:24},{nodeId:'note',x:-1,y:0},{nodeId:'intro',x:10,y:10},{nodeId:'settings-body',x:0,y:0},{nodeId:doc.rootId,x:0,y:0}])assert.throws(()=>positionEditDocument(doc,edit,ctx));
});

test('combined rectangle edit validates only the final moved and resized rectangle',()=>{
  const doc=fixture(),edge=positionEditDocument(doc,{nodeId:'settings',x:680,y:48},ctx);
  assert.throws(()=>sizeEditDocument(edge,{nodeId:'settings',width:650,keepPosition:true},ctx));
  const next=rectangleEditDocument(edge,{nodeId:'settings',width:650,x:630,y:48},ctx);
  assert.equal(find(next,'settings').size.width,650);assert.deepEqual(find(next,'settings').position,{x:630,y:48});
  assert.equal(find(edge,'settings').size.width,600);assert.deepEqual(find(edge,'settings').position,{x:680,y:48});
});

test('explicit legacy flow conversion freezes shared-solver rectangles and preserves every other field',()=>{
  const doc=fixture(),old=sizeEditTargets(doc,ctx),next=freeLayoutDocument(doc,{nodeId:'settings-body'},ctx);
  const group=find(next,'settings-body');assert.equal(group.layout.childrenMode,'free');assert.equal(group.sizing.heightMode,'fixed');
  assert.equal(actual(next,'intro').editablePosition,true);
  for(const id of group.slots.children){const a=old.find(n=>n.id===id),b=actual(next,id);for(const key of ['x','y','width','height'])assert(Math.abs(a[key]-b[key])<.1);assert.deepEqual(find(next,id).props,validateSizeEdit(doc,doc,ctx).nodes.find(n=>n.id===id).props);}
  assert.deepEqual(next.nodes.map(n=>n.slots),doc.nodes.map(n=>n.slots));
  const moved=positionEditDocument(next,{nodeId:'intro',x:8,y:4},ctx);assert.deepEqual(validateSizeEdit(doc,moved,ctx),moved);
  assert.throws(()=>positionEditDocument(doc,{nodeId:'intro',x:8,y:4},ctx),{code:'edit.position-unavailable'});
});

test('nested fill/content and grid groups freeze direct children without replacing nested layouts',async()=>{
  for(const [example,id]of [[examples[0],'layout-1'],[examples[1],'layout-0']]){
    const doc=await rich(example),old=sizeEditTargets(doc,ctx),next=freeLayoutDocument(doc,{nodeId:id},ctx),group=find(next,id);
    assert.equal(group.layout.childrenMode,'free');assert.equal(group.layout.columns,undefined);assert.equal(group.sizing.widthMode,'fixed');assert.equal(group.sizing.heightMode,'fixed');
    for(const child of group.slots.children){const a=old.find(n=>n.id===child),b=actual(next,child);for(const key of ['x','y','width','height'])assert(Math.abs(a[key]-b[key])<.1);assert.equal(find(next,child).sizing.widthMode,'fixed');assert.equal(find(next,child).sizing.heightMode,'fixed');assert.deepEqual(find(next,child).layout,find(doc,child).layout);}
    assert.deepEqual(validateSizeEdit(doc,next,ctx),next);
  }
});

test('free conversion preserves min/max, removes only forbidden alignSelf and rejects hidden or locked children',()=>{
  const doc=fixture();find(doc,'cancel').sizing={widthMode:'fill',minWidth:120,maxWidth:400,alignSelf:'center'};find(doc,'confirm').sizing={widthMode:'fill'};doc.version='0.3';
  const next=freeLayoutDocument(doc,{nodeId:'actions'},ctx);assert.deepEqual(find(next,'cancel').sizing,{widthMode:'fixed',heightMode:'fixed',minWidth:120,maxWidth:400});assert.deepEqual(validateSizeEdit(doc,next,ctx),next);
  for(const patch of [{locked:true},{props:{...find(doc,'cancel').props,visible:false}}]){const blocked=structuredClone(doc);Object.assign(find(blocked,'cancel'),patch);assert.equal(actual(blocked,'actions').canFreeLayout,false);assert.throws(()=>freeLayoutDocument(blocked,{nodeId:'actions'},ctx),{code:'edit.free-layout'});}
  assert.throws(()=>freeLayoutDocument(doc,{nodeId:doc.rootId},ctx),{code:'edit.free-layout'});
  assert.throws(()=>freeLayoutDocument(doc,{nodeId:'cancel'},ctx),{code:'edit.free-layout'});
});

test('save allows only the exact free-layout transition and rejects arbitrary layout or sizing rewrites',()=>{
  const doc=fixture(),next=freeLayoutDocument(doc,{nodeId:'settings-body'},ctx);
  for(const mutate of [d=>find(d,'settings-body').layout.gap=0,d=>find(d,'intro').props.align='right',d=>find(d,'intro').sizing.minWidth=24,d=>find(d,'settings-body').slots.children.reverse(),d=>find(d,'settings-body').layout.direction='row']){const bad=structuredClone(next);mutate(bad);assert.throws(()=>validateSizeEdit(doc,bad,ctx));}
  const undo=structuredClone(next);find(undo,'settings-body').layout.childrenMode='flow';for(const id of find(undo,'settings-body').slots.children)delete find(undo,id).position;assert.throws(()=>validateSizeEdit(next,undo,ctx));
});

test('free conversion and moved rectangles share atomic renderer rollback and session undo',async()=>{
  const doc=fixture();let rejectFree=true;
  const session=createSession(doc,ctx,async d=>{if(rejectFree&&find(d,'settings-body').layout.childrenMode==='free')throw Error('free renderer rejected');return {dispose(){}};});
  await session.initialize();const initial=session.exportDocument();
  await assert.rejects(session.commit(freeLayoutDocument(session.document,{nodeId:'settings-body'},ctx)),/free renderer rejected/);assert.equal(session.exportDocument(),initial);assert.equal(session.canUndo,false);
  rejectFree=false;await session.commit(freeLayoutDocument(session.document,{nodeId:'settings-body'},ctx));
  await session.commit(rectangleEditDocument(session.document,{nodeId:'intro',x:8,y:4,width:560},ctx));
  await session.undo();assert.deepEqual(find(session.document,'intro').position,{x:0,y:0});
  await session.undo();assert.equal(find(session.document,'settings-body').layout.childrenMode,'flow');assert.equal(find(session.document,'intro').position,undefined);
  await session.redo();assert.equal(find(session.document,'settings-body').layout.childrenMode,'free');
});

test('save rejects changed design dimensions that automatic sizing would silently ignore',async()=>{
  const doc=await rich(),bad=structuredClone(doc),child=find(bad,'row0');assert.equal(child.sizing.widthMode,'fill');child.size.width+=1;
  assert.throws(()=>validateSizeEdit(doc,bad,ctx),{code:'edit.size-managed'});
});

test('PNG geometry enforces nine-slice, declared skin minimum and content insets on the resolved size',async()=>{
  const c=geometryContext(pack=>{for(const a of pack.assets)if(a.assetId.startsWith('button.'))a.minSize.width=155;}),doc=await rich(examples[0],c);
  const original=actual(doc,'row4',c);
  assert.throws(()=>sizeEditDocument(doc,{nodeId:'row4',width:150},c),{code:'skin.minimum'});
  assert.equal(actual(doc,'row4',c).width,original.width);
  assert.throws(()=>sizeEditDocument(doc,{nodeId:'surface',width:700},{...c,skinGeometry:undefined}),{code:'edit.skin-geometry'});
  const unsafe=structuredClone(doc);find(unsafe,'body').size.width=find(unsafe,'surface').size.width;
  assert.throws(()=>validateSizeEdit(doc,unsafe,c),{code:'edit.slot-bounds'});
});

test('failed resize and failed renderer preparation retain the prior session and undo history',async()=>{
  const doc=fixture(),session=createSession(doc,ctx,async d=>{if(find(d,'settings').size.width===700)throw Error('renderer rejected');return {dispose(){}};});
  await session.initialize();const before=session.exportDocument();
  assert.throws(()=>sizeEditDocument(session.document,{nodeId:'intro',width:24},ctx));assert.equal(session.exportDocument(),before);assert.equal(session.canUndo,false);
  const bad=sizeEditDocument(session.document,{nodeId:'settings',width:700},ctx);
  await assert.rejects(session.commit(bad),/renderer rejected/);assert.equal(session.exportDocument(),before);assert.equal(session.canUndo,false);
  await session.commit(sizeEditDocument(session.document,{nodeId:'settings',width:680},ctx));assert.equal(session.canUndo,true);
  await session.undo();assert.equal(find(session.document,'settings').size.width,600);await session.redo();assert.equal(find(session.document,'settings').size.width,680);
});
