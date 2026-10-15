import test from 'node:test';
import assert from 'node:assert/strict';
import Yoga from 'yoga-layout';
import {solveLayout} from '../src/runtime/layout.mjs';
import {editorData,presetDocument} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {createSession} from '../src/panel/session.mjs';
const box=(id,width=100,height=40,extra={})=>({id,type:'Button',size:{width,height},...extra});
const group=(children,extra={})=>box('group',400,160,{type:'Container',children,layout:{direction:'row',padding:10,gap:10},...extra});
const near=(a,b)=>assert.ok(Math.abs(a-b)<.02,`${a} != ${b}`);
test('remaining width uses weights, clamps maximum, redistributes and preserves authoring',()=>{
  const tree=group([box('fixed'),box('a',100,40,{sizing:{widthMode:'fill',grow:1,maxWidth:80}}),box('b',100,40,{sizing:{widthMode:'fill',grow:2}})]),before=structuredClone(tree);
  const r=solveLayout(Yoga,tree);near(r.get('a').width,80);near(r.get('b').width,180);near(r.get('b').x,210);assert.deepEqual(tree,before);
});
test('shrink respects minima and rejects impossible allocation',()=>{
  const tree=group([box('a',250,40,{sizing:{shrink:1,minWidth:160}}),box('b',250,40,{sizing:{shrink:1,minWidth:160}})]);
  const r=solveLayout(Yoga,tree);near(r.get('a').width,185);near(r.get('b').width,185);
  tree.size.width=300;assert.throws(()=>solveLayout(Yoga,tree),/超出容器/);
});
test('content height composes nested flow, hidden children and padding',()=>{
  const inner=box('inner',200,100,{type:'Container',sizing:{heightMode:'content'},layout:{gap:6,padding:8},children:[box('a'),box('hidden',100,100,{visible:false}),box('b',100,60)]});
  const tree=group([inner],{layout:{padding:10,gap:10},sizing:{heightMode:'content'}});
  const r=solveLayout(Yoga,tree);near(r.get('inner').height,122);near(r.get('group').height,142);near(r.get('b').y,54);assert.equal(r.has('hidden'),false);
});
test('main distribution and cross fill preserve padding',()=>{
  const tree=group([box('a',80,40,{sizing:{heightMode:'fill'}}),box('b',80,40)],{layout:{direction:'row',padding:10,gap:10,justify:'space-between',align:'center'}});
  const r=solveLayout(Yoga,tree);near(r.get('a').height,140);near(r.get('b').x,310);near(r.get('b').y,60);
});
test('grid equal cells retain trailing columns and reflow on width change',()=>{
  const tree=group(['a','b','c','d','e'].map(id=>box(id)),{size:{width:400,height:180},layout:{direction:'grid',columns:3,cellHeight:60,gap:10,padding:10}});
  let r=solveLayout(Yoga,tree);near(r.get('a').width,120);near(r.get('d').x,10);near(r.get('e').x,140);near(r.get('d').y,80);
  tree.size.width=520;r=solveLayout(Yoga,tree);near(r.get('a').width,160);near(r.get('e').x,180);
  tree.children[0].sizing={minWidth:200};assert.throws(()=>solveLayout(Yoga,tree),/格子尺寸/);
});
test('wrap content height uses actual line count',()=>{
  const r=solveLayout(Yoga,group(['a','b','c'].map(id=>box(id,150,40)),{layout:{direction:'wrap',gap:10,padding:10},sizing:{heightMode:'content'}}));
  near(r.get('group').height,110);near(r.get('c').y,60);
});
test('invalid sizing, content/fill cycles, grid and unsupported slot rules reject',()=>{
  for(const tree of [box('x',100,40,{sizing:{widthMode:'fill'}}),box('x',100,40,{sizing:{heightMode:'content'}}),group([box('x',100,40,{sizing:{widthMode:'fill'}})],{sizing:{widthMode:'content'}}),group([],{layout:{direction:'grid'}}),group([],{sizing:{minWidth:500,maxWidth:400}}),group([],{sizing:{grow:-1}})])assert.throws(()=>solveLayout(Yoga,tree));
});
test('schema version, transactional updates, undo and JSON round trip',async()=>{
  const ctx=await editorData(),doc=presetDocument(ctx.presets.presets[0],ctx),s=createSession(doc,ctx);
  await s.mutate({type:'update',id:'settings-body',patch:{layout:{justify:'center'}}});
  assert.equal(s.document.version,'0.3');assert.equal(JSON.parse(s.exportDocument()).nodes.find(n=>n.id==='settings-body').layout.justify,'center');
  const bad=s.document;bad.version='0.2';assert.throws(()=>validateDocument(bad,ctx),/0.3/);
  const before=s.exportDocument();await assert.rejects(s.mutate({type:'update',id:'settings-body',patch:{sizing:{minWidth:99999}}}));assert.equal(s.exportDocument(),before);
  await s.undo();assert.deepEqual(s.document.nodes,validateDocument(doc,ctx).nodes);await s.redo();assert.equal(s.document.version,'0.3');
});
