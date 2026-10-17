import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {settingsDocument} from '../src/panel/settings.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {validateDocument} from '../src/panel/document.mjs';

const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url))),data=await editorData(),base=await read('../configs/action-presets.json'),layout=await read('../configs/settings-layout.json'),content=await read('../configs/settings-content.json'),example=(await read('../examples/action-presets.json'))[0],catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json');
const roles=data.usage.bindings.map(({role,assetId})=>({role,assetId})),assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:256,density:1,stretch:'nine-slice',nineSlice:{left:10,right:10,top:10,bottom:10},contentInsets:{left:14,right:14,top:14,bottom:14},minSize:{width:29,height:29}}));
const ctx={...data,profile:{...data.profile,padding:16},skinGeometry:{version:'1.0',scale:1,roles,assets},panelInsets:{left:14,right:14,top:14,bottom:14},scrollInsets:{left:14,right:14,top:14,bottom:14}};
const grouped=()=>{const fields=structuredClone(content.fields.slice(0,2));return {...structuredClone(content),fields,groups:fields.map((f,i)=>({id:'g'+i,title:i?'音效设置':'音乐设置',fieldIds:[f.id]})),tabsEnabled:false,tabs:fields.map((f,i)=>({id:'t'+i,label:i?'音效':'音乐',initial:i===1,groupIds:['g'+i]}))};};
const currentHeading=node=>{assert.equal(node.surfaceBand,'reference-v1');assert.ok(node.surfaceFontSize>=18);assert.equal(Object.hasOwn(node.props,'fontSize'),false);};

test('new tabbed settings use one scaled frame and quiet page surfaces without changing tab selection or fields',()=>{
  for(const canvas of ['landscape','portrait'])for(const scrolling of [false,true]){
    const source={...grouped(),...(scrolling?{overflow:'scroll'}:{})},before=structuredClone(source),doc=settingsDocument(source,layout,canvas,ctx),node=id=>doc.nodes.find(n=>n.id===id),frame=node('settings'),tabs=node('settings-tabs');
    assert.equal(frame.surfaceLayer,'frame');assert.equal(frame.surfaceScale,3);assert.deepEqual(frame.props.contentPadding,{left:42,right:42,top:42,bottom:42});
    assert.deepEqual(doc.nodes.filter(n=>n.surfaceLayer==='frame').map(n=>n.id),['settings']);assert(!doc.nodes.some(n=>n.surfaceLayer==='content'));assert.equal(tabs.surfaceLayer,'inset');
    assert.equal(tabs.props.activeId,'t1');assert.equal(tabs.props.enabled,false);assert.deepEqual(tabs.props.tabs.map(t=>t.label),['音乐','音效']);
    assert.equal(node('music').props.checked,source.fields[0].value);assert.equal(node('effects').props.checked,source.fields[1].value);
    currentHeading(node('heading'));assert.equal(node('heading').surfaceFontSize,28);assert.ok(node('heading').size.height>=64);
    for(const heading of doc.nodes.filter(n=>n.id.startsWith('section-heading-'))){currentHeading(heading);assert.equal(heading.surfaceFontSize,18);assert.ok(heading.size.height>=42);}
    const scrolls=doc.nodes.filter(n=>n.recipeRef==='scroll-view@1.0.0');assert.equal(scrolls.length,scrolling?2:0);assert.ok(scrolls.every(n=>n.surfaceLayer==='inset'));
    assert.deepEqual(validateDocument(doc,ctx),doc);assert.deepEqual(source,before);
  }
});

test('frozen tabbed settings presentation 1 and 2 keep original bounds and never gain reference display fields',()=>{
  for(const version of ['1.0','2.0'])for(const canvas of ['landscape','portrait']){
    const frozen=structuredClone(layout);frozen.presentation.version=version;
    const doc=settingsDocument(grouped(),frozen,canvas,ctx),frame=doc.nodes.find(n=>n.id==='settings'),tabs=doc.nodes.find(n=>n.id==='settings-tabs');
    assert.equal(frame.surfaceLayer,version==='2.0'?'frame':undefined);assert.equal(frame.surfaceScale,undefined);assert.equal(tabs.surfaceLayer,undefined);
    assert.equal(frame.size.width,frozen.orientations[canvas].width);assert.equal(frame.props.contentPadding.left,frozen.padding);
    assert.ok(doc.nodes.every(n=>n.surfaceBand===undefined&&n.surfaceFontSize===undefined&&n.surfaceScale===undefined));
    assert.deepEqual(settingsDocument(grouped(),frozen,canvas,{...ctx,surfaceCompositionEnabled:false}),doc);
  }
});

test('new confirmation dialogs retain modal semantics and exact action targets inside a stronger continuous main frame',async()=>{
  const fixture=await actionFixture(example,catalog,base),before=structuredClone(fixture),result=await actionPresetFromIntent(fixture.session,fixture.intent,base,'confirmation',ctx);
  for(const doc of Object.values(result.documents)){
    const node=id=>doc.nodes.find(n=>n.id===id),frame=node('surface');assert.equal(frame.recipeRef,'dialog@1.0.0');assert.equal(frame.surfaceLayer,'frame');assert.equal(frame.surfaceScale,3);
    assert.equal(frame.props.open,true);assert.equal(frame.props.modal,true);assert.equal(frame.props.closeOnBackdrop,false);assert.deepEqual(frame.props.actions,[]);
    assert.deepEqual(doc.nodes.filter(n=>n.surfaceLayer==='frame').map(n=>n.id),['surface']);assert(!doc.nodes.some(n=>n.recipeRef==='panel@1.0.0'));
    currentHeading(node('heading'));assert.equal(node('heading').surfaceFontSize,28);assert.ok(node('heading').size.height>=64);assert.equal(node('body').size.width,frame.size.width-84);
    assert.equal(node('row0').props.text,example.rows[0].text);assert.deepEqual(doc.nodes.filter(n=>n.recipeRef==='button@1.0.0').map(n=>n.props.label),example.rows.slice(1).map(r=>r.label));
    assert.deepEqual(validateDocument(doc,ctx),doc);
  }
  assert.equal(result.behavior.dismissOnEmit,true);assert.ok(result.behavior.actions.every(a=>a.action==='emit'&&a.targets.length===0));assert.deepEqual(fixture,before);
});

test('confirmation presentation 1 and 2 preserve original geometry and headings without new reference fields',async()=>{
  for(const version of ['1.0','2.0']){
    const frozen=structuredClone(base);frozen.presentation.version=version;frozen.presentation.sectionHeading='show';
    const fixture=await actionFixture(example,catalog,frozen),result=await actionPresetFromIntent(fixture.session,fixture.intent,frozen,'confirmation',ctx);
    for(const [canvas,doc]of Object.entries(result.documents)){
      const frame=doc.nodes.find(n=>n.id==='surface'),body=doc.nodes.find(n=>n.id==='body');
      assert.equal(frame.surfaceLayer,version==='2.0'?'frame':undefined);assert.equal(frame.surfaceScale,undefined);assert.equal(frame.size.width,frozen.presets.confirmation[canvas].width);assert.equal(body.size.width,frame.size.width-ctx.profile.padding*2);
      assert.equal(doc.nodes.find(n=>n.id==='section-heading').props.text,example.sectionTitle);assert.ok(doc.nodes.every(n=>n.surfaceBand===undefined&&n.surfaceFontSize===undefined));
    }
    const disabled=await actionPresetFromIntent(fixture.session,fixture.intent,frozen,'confirmation',{...ctx,surfaceCompositionEnabled:false});assert.deepEqual(disabled,result);
  }
});
