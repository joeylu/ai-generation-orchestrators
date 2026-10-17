import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {assertCompiledChildBounds} from '../src/panel/compiler.mjs';
import {componentContentBox} from '../src/runtime/content-bounds.mjs';

const {profile}=await editorData(),options=(type='Dialog',extra={})=>({type,props:{title:'',actions:[]},size:{width:500,height:300},profile,...extra}),child=(extra={})=>({id:'body',origin:{x:profile.padding,y:profile.padding},size:{width:400,height:800},visible:true,...extra});
const pad=value=>({left:value,right:value,top:value,bottom:value}),geometry={version:'1.0',scale:1,roles:[{role:'skin.surface.panel',assetId:'panel'},{role:'skin.surface.content',assetId:'content'}],assets:['panel','content'].map(assetId=>({assetId,width:512,height:512,nineSlice:pad(4),contentInsets:pad(12),minSize:{width:25,height:25}}))};

test('legacy Dialog accepts its scrollable long body while enforcing the actual horizontal viewport',()=>{
  const owner=options(),body=child(),before=structuredClone({owner,body}),slot=componentContentBox(owner);
  assert.equal(slot.width,500-profile.padding*2);assert.equal(slot.height,300-profile.padding*2);assert.ok(body.origin.y+body.size.height>owner.size.height);
  assert.doesNotThrow(()=>assertCompiledChildBounds(owner,body));
  assert.doesNotThrow(()=>assertCompiledChildBounds(owner,child({size:{width:slot.width,height:800}})));
  for(const invalid of [child({origin:{x:profile.padding-1,y:profile.padding}}),child({size:{width:slot.width+1,height:800}}),child({origin:{x:profile.padding+1,y:profile.padding},size:{width:slot.width,height:800}})])assert.throws(()=>assertCompiledChildBounds(owner,invalid),{code:'panel.bounds'});
  assert.deepEqual({owner,body},before);
});

test('title actions and font overrides use the same Dialog body contract without imposing a vertical content cap',()=>{
  const owner=options('Dialog',{props:{title:'提示',actions:[{id:'ok'}],fontSize:32}}),slot=componentContentBox(owner),body=child({origin:{x:slot.x,y:slot.y},size:{width:slot.width,height:1000}});
  assert.ok(slot.y>profile.padding);assert.ok(slot.height<300-profile.padding*2);assert.equal(slot.allowVerticalOverflow,true);
  assert.doesNotThrow(()=>assertCompiledChildBounds(owner,body));assert.throws(()=>assertCompiledChildBounds(owner,{...body,size:{width:slot.width+1,height:1000}}),{code:'panel.bounds'});
});

test('explicit Dialog retains its prior scaled surface bounds and the same vertical scrolling exception',()=>{
  const owner=options('Dialog',{geometry,surfaceLayer:'frame',surfaceScale:2}),slot=componentContentBox(owner),body=child({origin:{x:slot.x,y:slot.y},size:{width:slot.width,height:1000}});
  assert.equal(slot.x,24);assert.equal(slot.width,452);assert.doesNotThrow(()=>assertCompiledChildBounds(owner,body));
  assert.throws(()=>assertCompiledChildBounds(owner,{...body,size:{width:slot.width+1,height:1000}}),{code:'panel.bounds'});
});

test('non-scrolling Panel Container and Tabs retain their vertical bounds and existing hidden/scroll owners stay unchanged',()=>{
  for(const type of ['Panel','Container','Tabs']){
    assert.throws(()=>assertCompiledChildBounds(options(type),child()),{code:'panel.bounds'});
    assert.throws(()=>assertCompiledChildBounds(options(type,{geometry,surfaceLayer:type==='Container'?undefined:'content'}),child()),{code:'panel.bounds'});
  }
  assert.doesNotThrow(()=>assertCompiledChildBounds(options('Panel'),child({visible:false})));
  for(const type of ['ScrollView','List']){
    const owner=options(type),slot=componentContentBox(owner);
    assert.doesNotThrow(()=>assertCompiledChildBounds(owner,child({origin:{x:slot.x,y:slot.y-300},size:{width:slot.width,height:2000}})));
    assert.throws(()=>assertCompiledChildBounds(owner,child({origin:{x:slot.x,y:slot.y},size:{width:slot.width+1,height:2000}})),{code:'panel.bounds'});
  }
});
