import test from 'node:test';
import assert from 'node:assert/strict';
import {panelDocumentFingerprint,createPanelEditorDraftStore} from '../src/studio/panel-editor-drafts.mjs';

const document=()=>({kind:'ui_panel_document',revision:0,canvas:'landscape',bindings:{sha256:'source'},nodes:[{id:'title',props:{text:'仓库',revision:2},size:{width:300,height:40},slots:{children:[]}}]});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};

test('document fingerprint returns to the saved checkpoint after undo advances only top-level revision',()=>{
  const saved=document(),edited=structuredClone(saved),undone=structuredClone(saved);
  edited.nodes[0].size.width=320;edited.revision=1;undone.revision=2;
  assert.notEqual(panelDocumentFingerprint(saved),panelDocumentFingerprint(edited));
  assert.equal(panelDocumentFingerprint(saved),panelDocumentFingerprint(undone));
  const withoutRevision=structuredClone(saved);delete withoutRevision.revision;
  assert.equal(panelDocumentFingerprint(saved),panelDocumentFingerprint(withoutRevision));
});

test('fingerprint ignores object key order while retaining every other field, nested revision and array order',()=>{
  const saved=document(),reordered={nodes:saved.nodes,bindings:{sha256:'source'},canvas:'landscape',revision:8,kind:'ui_panel_document'};
  assert.equal(panelDocumentFingerprint(saved),panelDocumentFingerprint(reordered));
  for(const mutate of [doc=>doc.nodes[0].props.revision++,doc=>doc.nodes[0].props.text='仓库 ',doc=>doc.bindings.sha256='other',doc=>doc.canvas='portrait',doc=>doc.extra=null]){
    const changed=structuredClone(saved);mutate(changed);assert.notEqual(panelDocumentFingerprint(saved),panelDocumentFingerprint(changed));
  }
  const ordered={revision:0,values:['left','right']},reversed={revision:1,values:['right','left']};
  assert.notEqual(panelDocumentFingerprint(ordered),panelDocumentFingerprint(reversed));
});

test('fingerprint reads frozen documents without mutating or normalizing author values',()=>{
  const value=freeze(document()),before=JSON.stringify(value);
  assert.equal(panelDocumentFingerprint(value),panelDocumentFingerprint(structuredClone(value)));
  assert.equal(JSON.stringify(value),before);assert.equal(value.revision,0);
});

test('raw form drafts restore equivalent numeric spellings, empty partial inputs and literal copy unchanged',()=>{
  const store=createPanelEditorDraftStore(),values={rectangle:{x:'001.00',y:'-0',width:'0300.00',height:''},text:{text:'  保留原文\n<示例>  '},fontSize:'1e',fontDefault:false,textColor:'#aAbB00',colorDefault:false};
  store.set('inventory-landscape','title',values);
  assert.deepEqual(store.get('inventory-landscape','title'),values);
  assert.equal(Number(store.get('inventory-landscape','title').rectangle.width),300);
  assert.equal(store.get('inventory-landscape','title').rectangle.width,'0300.00');
});

test('drafts isolate nodes and variants without concatenated-key collisions',()=>{
  const store=createPanelEditorDraftStore();
  store.set('wide','a',{width:'10'}).set('wide','b',{width:'20'}).set('tall','a',{width:'30'});
  store.set('a/b','c',{text:'one'}).set('a','b/c',{text:'two'});
  assert.equal(store.size,5);assert.deepEqual(store.get('wide','a'),{width:'10'});assert.deepEqual(store.get('tall','a'),{width:'30'});
  assert.deepEqual(store.get('a/b','c'),{text:'one'});assert.deepEqual(store.get('a','b/c'),{text:'two'});
  store.set('wide','a',{width:'40'});assert.equal(store.size,5);assert.deepEqual(store.get('wide','b'),{width:'20'});
});

test('writes, reads and enumeration cannot mutate stored drafts or their caller input',()=>{
  const store=createPanelEditorDraftStore(),input={fields:{text:'原文'},values:['300']};
  store.set('wide','title',input);input.fields.text='outside';input.values.push('bad');
  const read=store.get('wide','title');read.fields.text='read';read.values.push('bad');
  const entries=store.entries();entries[0].values.fields.text='entry';entries.splice(0);
  assert.deepEqual(store.get('wide','title'),{fields:{text:'原文'},values:['300']});
  const frozen=freeze({fields:{label:'冻结'}});store.set('wide','button',frozen);assert.deepEqual(frozen,{fields:{label:'冻结'}});
});

test('delete and clear remove only the requested scope and keep accurate draft counts',()=>{
  const store=createPanelEditorDraftStore();store.set('wide','title',{text:'a'}).set('wide','body',{text:'b'}).set('tall','title',{text:'c'});
  assert.deepEqual(store.entries('wide').map(entry=>entry.nodeId),['title','body']);assert.deepEqual(store.entries('missing'),[]);
  assert.equal(store.delete('wide','title'),true);assert.equal(store.delete('wide','title'),false);assert.equal(store.size,2);assert.equal(store.get('wide','title'),undefined);
  store.clear('wide');assert.equal(store.size,1);assert.equal(store.get('tall','title').text,'c');
  store.clear();assert.equal(store.size,0);assert.deepEqual(store.entries(),[]);
});

test('invalid state fails before replacing an existing draft',()=>{
  const store=createPanelEditorDraftStore();store.set('wide','title',{text:'safe'});
  const cyclic={};cyclic.self=cyclic;
  for(const value of [undefined,{value:NaN},{value:undefined},new Date(),cyclic])assert.throws(()=>store.set('wide','title',value),TypeError);
  assert.deepEqual(store.get('wide','title'),{text:'safe'});assert.equal(store.size,1);
  for(const value of [null,[],undefined])assert.throws(()=>panelDocumentFingerprint(value),TypeError);
  assert.throws(()=>store.set('','title',{}),TypeError);assert.throws(()=>store.get('wide',''),TypeError);
});
