import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceLayerInfo} from '../src/skins/surface-styles.mjs';
import {surfaceSlotBox,assertSurfaceSlotChildren} from '../src/runtime/surface-slots.mjs';
import {pngGeometry} from '../src/runtime/png-geometry.mjs';

const insets=n=>({left:n,right:n,top:n,bottom:n});
const profile={fontSize:16,itemHeight:32,padding:14,palette:{text:'#FFFFFF'},geometry:{lineHeight:24,titleGap:8,labelGap:8,minContent:24,scrollbarWidth:10,scrollbarGap:8}};
const geometry={version:'1.0',scale:1,roles:[{role:'skin.surface.panel',assetId:'panel'},{role:'skin.surface.content',assetId:'content'}],assets:[{assetId:'panel',width:896,height:448,density:6,nineSlice:{left:10,right:10,top:11,bottom:11},contentInsets:insets(14),minSize:{width:29,height:29}},{assetId:'content',width:416,height:192,density:4,nineSlice:insets(10),contentInsets:insets(0),minSize:{width:21,height:21}}],surfaceStyles:{panel:{baseRole:'skin.surface.panel',insets:insets(14),clipInsets:{left:10,right:10,top:11,bottom:11},layers:[]}}};

test('explicit frame scale enlarges fixed ornament, safety and minima together without changing frozen pixels or density',()=>{
 const before=structuredClone(geometry),plain=surfaceLayerInfo(geometry,'frame'),scaled=surfaceLayerInfo(geometry,'frame',3);
 assert.deepEqual(surfaceLayerInfo(geometry,'frame',1),plain);assert.equal(scaled.scale,3);assert.deepEqual(scaled.insets,insets(42));assert.deepEqual(scaled.clipInsets,{left:30,right:30,top:33,bottom:33});assert.equal(scaled.minWidth,87);assert.equal(scaled.minHeight,87);assert.equal(scaled.asset.density,6);assert.deepEqual(geometry,before);
 for(const scale of [0,0.9,4.1,NaN,Infinity,'3',null])assert.throws(()=>surfaceLayerInfo(geometry,'frame',scale),{code:'skin.surface-style'});
 for(const layer of ['content','inset'])assert.throws(()=>surfaceLayerInfo(geometry,layer,3),{code:'skin.surface-style'});
});

test('scaled frame slot checks the same safe box for import, runtime and atomic resize',()=>{
 const options={type:'Panel',props:{title:'',contentPadding:insets(42)},size:{width:500,height:300},profile,geometry,surfaceLayer:'frame',surfaceScale:3},before=structuredClone(options),box=surfaceSlotBox(options);
 assert.deepEqual(box,{width:416,height:216,x:42,y:42,allowVerticalOverflow:false,baseRole:'skin.surface.panel',insets:insets(42)});
 assert.doesNotThrow(()=>assertSurfaceSlotChildren(options,[{id:'body',size:{width:416,height:216}}]));assert.throws(()=>assertSurfaceSlotChildren({...options,size:{width:499,height:300}},[{id:'body',size:{width:416,height:216}}]),{code:'panel.slot-bounds'});
 assert.throws(()=>surfaceSlotBox({...options,props:{title:'',contentPadding:insets(14)}}),{code:'panel.slot-bounds'});assert.deepEqual(options,before);
 const skin=pngGeometry(geometry,profile);assert.doesNotThrow(()=>skin.assertComponent('Panel',options.props,500,300,{surfaceLayer:'frame',surfaceScale:3}));assert.throws(()=>skin.assertComponent('Panel',{title:'',contentPadding:insets(14)},500,300,{surfaceLayer:'frame',surfaceScale:3}),{code:'panel.padding'});assert.throws(()=>skin.assertComponent('Panel',options.props,86,300,{surfaceLayer:'frame',surfaceScale:3}),{code:'skin.surface-style'});
});
