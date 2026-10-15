import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceSlotBox,assertSurfaceSlotChildren,effectiveSurfaceSizes} from '../src/runtime/surface-slots.mjs';
const sides=(left,right=left,top=left,bottom=top)=>({left,right,top,bottom});
const profile={fontSize:16,itemHeight:32,padding:12,palette:{text:'#111827'},geometry:{lineHeight:24,titleGap:8,labelGap:8,scrollbarWidth:10,scrollbarGap:8}};
const geometry={scale:1,roles:[{role:'skin.surface.panel',assetId:'panel'},{role:'skin.surface.content',assetId:'content'}],assets:[{assetId:'panel',width:200,height:200,nineSlice:sides(8),contentInsets:sides(12),minSize:{width:25,height:25}},{assetId:'content',width:200,height:200,nineSlice:sides(15,15,11,12),contentInsets:sides(0),minSize:{width:31,height:24}}]};
const opts=(type='Panel',props={})=>({type,props,size:{width:400,height:200},profile,geometry,surfaceLayer:'content'});

test('explicit surface guard reproduces accepted import/edit mismatch and rejects before changing inputs',()=>{
 const options=opts('Panel',{title:'',contentPadding:sides(40)}),children=[{id:'oversize',size:{width:350,height:48}}],before=structuredClone({options,children});
 assert.equal(children[0].size.width+options.props.contentPadding.left<=options.size.width,true);
 assert.deepEqual(surfaceSlotBox(options),{width:320,height:120,x:40,y:40,allowVerticalOverflow:false,baseRole:'skin.surface.content',insets:sides(40)});
 assert.throws(()=>assertSurfaceSlotChildren(options,children),{code:'panel.slot-bounds',path:'oversize'});
 assert.deepEqual({options,children},before);
 assert.doesNotThrow(()=>assertSurfaceSlotChildren(options,[{id:'exact',size:{width:320,height:120}}]));
 assert.throws(()=>assertSurfaceSlotChildren(options,[{id:'tall',size:{width:320,height:121}}]),{code:'panel.slot-bounds'});
});

test('all five surface slots use actual role and preserve intended vertical scroll allowance',()=>{
 const expected={Panel:[354,161,false],Dialog:[354,154,true],ScrollView:[336,161,true],Tabs:[308,82,false],List:[354,161,true]};
 for(const [type,[width,height,allowVerticalOverflow]]of Object.entries(expected)){
  const options=opts(type),box=surfaceSlotBox(options);
  assert.equal(box.baseRole,'skin.surface.content',type);assert.equal(box.width,width,type);assert.equal(box.height,height,type);assert.equal(box.allowVerticalOverflow,allowVerticalOverflow,type);
  assert.throws(()=>assertSurfaceSlotChildren(options,[{id:type+'-wide',size:{width:width+1,height:1}}]),{code:'panel.slot-bounds'});
  const tall=[{id:type+'-tall',size:{width:1,height:height+1000}}];
  if(allowVerticalOverflow)assert.doesNotThrow(()=>assertSurfaceSlotChildren(options,tall));else assert.throws(()=>assertSurfaceSlotChildren(options,tall),{code:'panel.slot-bounds'});
 }
});

test('legacy layers are opt-out, inventory rejects authored rows, and invalid slots are explicit failures',()=>{
 assert.equal(surfaceSlotBox({...opts(),surfaceLayer:undefined,geometry:undefined}),null);
 assert.equal(assertSurfaceSlotChildren({...opts(),surfaceLayer:undefined},[{id:'historical',size:{width:9999,height:9999}}]),null);
 assert.throws(()=>surfaceSlotBox({...opts(),geometry:undefined}),{code:'panel.slot-bounds'});
 assert.throws(()=>surfaceSlotBox(opts('Panel',{contentPadding:sides(0)})),{code:'panel.slot-bounds'});
 assert.throws(()=>surfaceSlotBox({...opts(),size:{width:30,height:30}}),{code:'panel.slot-bounds'});
 assert.throws(()=>assertSurfaceSlotChildren(opts('List',{inventory:{}}),[{id:'row',size:{width:1,height:1}}]),{code:'panel.slot-bounds'});
});

test('full new effective plan is validated together without stale child sizes or mutations',()=>{
 const parent={id:'parent',size:{width:400,height:200}},child={id:'child',size:{width:354,height:161}},handles=new Map([['parent',parent],['child',child]]),plans=[new Map([['parent',{width:300,height:160}],['child',{width:254,height:121}]])],before=structuredClone({parent,child,plans});
 const sizes=effectiveSurfaceSizes(handles,plans);
 assert.doesNotThrow(()=>assertSurfaceSlotChildren({...opts(),size:sizes.get('parent')},[{id:'child',size:sizes.get('child')}]));
 assert.throws(()=>assertSurfaceSlotChildren({...opts(),size:sizes.get('parent')},[{id:'child',size:child.size}]),{code:'panel.slot-bounds'});
 assert.deepEqual({parent,child,plans},before);
 // runtime.resize temporarily updates requestedSize before resolveLayout;
 // an unmanaged tree has no Yoga plan but must still check that new size.
 parent.requestedSize={width:300,height:160};
 const direct=effectiveSurfaceSizes(handles,[]);assert.equal(direct.get('parent').width,300);
 assert.throws(()=>assertSurfaceSlotChildren({...opts(),size:direct.get('parent')},[{id:'child',size:direct.get('child')}]),{code:'panel.slot-bounds'});
});

