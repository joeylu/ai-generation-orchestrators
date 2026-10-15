import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasTextMetrics} from 'pixi.js';
import {assertEditedTextLabels} from '../src/studio/panel-text-labels.mjs';

// Geometry/metadata tests use deterministic metrics. Actual bundled fonts and
// Pixi adapters are covered by the offline Studio browser regression.
const profile={fontSize:16,palette:{text:'#222222'},padding:4,markSize:20,thumbSize:20,trackHeight:8,gap:4,itemHeight:32,geometry:{labelGap:4,lineHeight:20,indicatorWidth:12}};
const pad={left:4,right:4,top:2,bottom:2};
const style={unit:6,lineHeight:12};
const text=(value,extra={})=>({text:value,style:{...style,...extra}});
const button=(value,width=100,height=32)=>({labelView:text(value),skinRoles:['normal','pressed'],defaultView:{width,height}});
function metrics(t){
  const measured=[];
  t.mock.method(CanvasTextMetrics,'measureText',(value,style)=>{
    measured.push({value,style});
    const lines=value.split(/\r\n|\r|\n/).flatMap(line=>{
      if(!style.wordWrap)return [line.length*style.unit];
      const width=line.length*style.unit,count=Math.max(1,Math.ceil(width/style.wordWrapWidth));
      return Array.from({length:count},(_,index)=>Math.min(style.wordWrapWidth,Math.max(0,width-index*style.wordWrapWidth)));
    });
    return {width:Math.max(...lines),height:lines.length*style.lineHeight};
  });
  return measured;
}
function fixture(type,originalProps,props,adapter,{width=100,height=40,slots={}}={}){
  const node={id:'control',recipeRef:'test@1.0.0',props,slots},original={...node,props:originalProps};
  const ctx={registry:{recipes:[{recipeId:'test',recipeVersion:'1.0.0',type}]}};
  const handle={recipe:{type},props,size:{width,height},adapter,readState:()=>({selectedId:props.selectedId})};
  const scene={document:{nodes:[node]},runtime:{skin:{profile,insets:()=>({...pad})},handles:new Map([[node.id,handle]])}};
  return {scene,base:{nodes:[original]},ctx,run(){return assertEditedTextLabels(scene,this.base,ctx);}};
}
const fails=f=>assert.throws(()=>f.run(),error=>error.code==='edit.text-render'&&error.nodeId==='control'&&error.message.includes('请缩短文案或扩大控件'));

test('unchanged frozen copy does not inspect old ellipses or add new font rules',t=>{
  const measured=metrics(t),f=fixture('Button',{label:'old long copy'},{label:'old long copy'},{view:button('old…')});
  f.run();assert.deepEqual(measured,[]);
});

test('inventory names use the real scrollable details font without changing item selection',t=>{
  const measured=metrics(t),items=[{id:'first',label:'First item'},{id:'second',label:'A long second item'}];
  const before={items:structuredClone(items),inventory:{columns:10,rows:10},selectedId:'first'};
  const after=structuredClone(before);after.items[1].label='A much longer name that wraps in details';
  const adapter={view:{},detailName:text('First item',{wordWrap:true,wordWrapWidth:80}),geometry:{detailName:{width:80}}};
  const f=fixture('List',before,after,adapter);f.run();
  assert.equal(measured[0].value,after.items[1].label);assert.equal(adapter.detailName.text,'First item');
  assert.equal(f.scene.runtime.handles.get('control').readState().selectedId,'first');
});

test('selected inventory name must match the full saved text in details',t=>{
  metrics(t);
  const props={items:[{id:'first',label:'Edited name'}],inventory:{columns:10,rows:10},selectedId:'first'};
  const f=fixture('List',{...props,items:[{id:'first',label:'Old name'}]},props,{view:{},detailName:text('Edited…',{wordWrap:true,wordWrapWidth:80}),geometry:{detailName:{width:80}}});
  fails(f);
});

test('inventory font changes check quantity and description styles as well as item names',t=>{
  metrics(t);
  const item={id:'first',label:'药水',quantity:12,description:'完整说明'},before={items:[item],inventory:{},selectedId:'first'},after={...before,fontSize:18};
  const actual=value=>text(value,{fontSize:18,wordWrap:true,wordWrapWidth:80});
  const adapter={view:{},cells:[{slotIndex:0,item,quantity:actual('12')}],detailName:actual('药水'),detailDescription:actual('完整说明'),detailTitle:actual('物品详情'),detailQuantity:actual('数量：12'),detailSlot:actual('格子：1'),geometry:{details:{contentWidth:80},detailName:{width:80},quantityBox:{width:30,height:30}}};
  const f=fixture('List',before,after,adapter);f.run();
  adapter.cells[0].quantity.style.fontSize=16;fails(f);
  adapter.cells[0].quantity.style.fontSize=18;adapter.detailDescription.style.fontSize=16;fails(f);
});

test('edited button checks full literal label and actual font safe area without mutations',t=>{
  const measured=metrics(t),f=fixture('Button',{label:'old'},{label:'new\n copy'},{view:button('new copy')});
  const before=structuredClone(f.scene.document),viewBefore=structuredClone(f.scene.runtime.handles.get('control').adapter.view);
  f.run();assert.equal(measured[0].value,'new copy');
  assert.deepEqual(f.scene.document,before);assert.deepEqual(f.scene.runtime.handles.get('control').adapter.view,viewBefore);
  f.scene.runtime.handles.get('control').adapter.view.labelView.text='new…';fails(f);
  f.scene.runtime.handles.get('control').adapter.view.labelView.text='new copy';
  f.scene.runtime.handles.get('control').adapter.view.defaultView.width=48;fails(f);
});

test('Text preserves multiline wrapping and rejects clipped height or ellipses',t=>{
  metrics(t);
  const view={},f=fixture('Text',{text:'old'},{text:'line one\nline two'},{view,text:text('line one\nline two',{wordWrap:true,wordWrapWidth:48})},{width:48,height:30});
  f.run();f.scene.runtime.handles.get('control').size.height=20;fails(f);
  f.scene.runtime.handles.get('control').size.height=30;f.scene.runtime.handles.get('control').adapter.text.text='line…';fails(f);
  const clip=fixture('Text',{text:'old'},{text:'too wide text'},{view:{},text:text('too wide text')},{width:48,height:30});
  fails(clip);
});

test('Select measures changed unselected options in both closed states without selecting them',t=>{
  const measured=metrics(t),props={placeholder:'pick',selectedId:'a',options:[{id:'a',label:'a'},{id:'b',label:'long label'}]};
  const view={rows:[button('a'),button('long label')],openButton:button('a'),closeButton:button('a')};
  const f=fixture('Select',{...props,options:[props.options[0],{id:'b',label:'b'}]},props,{view},{width:100});
  // Popup text fits 92px, but the closed field has only 60px after its arrow.
  // 10*6 exactly fits; adding one more glyph is rejected even while unselected.
  f.run();assert.equal(measured.length,3);assert.ok(measured.every(entry=>entry.value==='long label'));
  props.options[1].label+='x';view.rows[1].labelView.text+='x';fails(f);
  assert.equal(props.selectedId,'a');assert.equal(view.openButton.labelView.text,'a');
});

test('Select hidden placeholder and Input placeholder with a nonempty value are checked',t=>{
  metrics(t);
  const props={placeholder:'placeholder',selectedId:'a',options:[{id:'a',label:'a'}]},view={rows:[button('a')],openButton:button('a'),closeButton:button('a')};
  fails(fixture('Select',{...props,placeholder:'old'},props,{view},{width:100}));
  const input=fixture('Input',{placeholder:'old',value:'kept'},{placeholder:'a long placeholder',value:'kept'},{view:{placeholder:text('a long placeholder'),value:'kept'}},{width:100});
  fails(input);assert.equal(input.scene.runtime.handles.get('control').adapter.view.value,'kept');
});

test('Switch validates both states, including the currently hidden label',t=>{
  metrics(t);
  const states=['new','new'].map(value=>({children:[{}, {},text(value)]}));
  const f=fixture('Switch',{label:'old'},{label:'new'},{view:{views:states}},{width:100});
  f.run();states[1].children[2].text='ne…';fails(f);
});

test('collection, panel and dialog checks use the actual child label objects',t=>{
  metrics(t);
  const cases=[
    fixture('CheckBox',{label:'old'},{label:'new'},{view:{labelText:text('new')}}),
    fixture('RadioGroup',{direction:'column',options:[{id:'a',label:'old'}]},{direction:'column',options:[{id:'a',label:'new'}]},{view:{},items:[{labelText:text('new')}]}),
    fixture('Panel',{title:'old'},{title:'new'},{view:{children:[{},text('new')]}}),
    fixture('Dialog',{title:'old',actions:[]},{title:'new',actions:[]},{view:{titleText:text('new'),dialogPadding:4}}),
    fixture('Dialog',{title:'',actions:[{id:'a',label:'old'}]},{title:'',actions:[{id:'a',label:'new'}]},{view:{},buttons:[button('new')]}),
    fixture('Tabs',{tabs:[{id:'a',label:'old'}]},{tabs:[{id:'a',label:'new'}]},{view:{},rows:[button('new')]}),
    fixture('List',{items:[{id:'a',label:'old'}]},{items:[{id:'a',label:'new'}]},{view:{},rows:[button('new')]}),
  ];
  for(const f of cases)f.run();
  for(const f of cases){const h=f.scene.runtime.handles.get('control');h.size.width=1;if(h.adapter.rows)h.adapter.rows[0].defaultView.width=1;if(h.adapter.buttons)h.adapter.buttons[0].defaultView.width=1;fails(f);}
});

test('explicit List data labels remain outside the visible copy API',t=>{
  const measured=metrics(t),f=fixture('List',{items:[{id:'a',label:'old'}]},{items:[{id:'a',label:'ignored'}]},{view:{}},{slots:{items:['child']}});
  f.run();assert.deepEqual(measured,[]);
});

test('font-only changes recheck unchanged copy and require the actual requested font size',t=>{
  const measured=metrics(t),view=button('same',120,40);view.labelView.style={...style,fontSize:24};
  const f=fixture('Button',{label:'same'},{label:'same',fontSize:24},{view});f.run();assert.equal(measured.length,1);
  view.labelView.style.fontSize=16;fails(f);view.labelView.style.fontSize=24;view.labelView.text='sam…';fails(f);
});

test('color-only edits do not reclassify unchanged old copy as a font edit',t=>{
  const measured=metrics(t),f=fixture('Button',{label:'old long copy'},{label:'old long copy',textColor:'#2266AA'},{view:button('old…')});
  f.run();assert.deepEqual(measured,[]);
});

test('value captions are measured for font changes without mutating their play values',t=>{
  metrics(t);
  for(const type of ['Slider','ProgressBar']){
    const props={showValue:true,min:0,max:100,value:50},value=text('50%',{fontSize:20}),view=type==='Slider'?{value1Text:value}:{children:[{},value]},f=fixture(type,props,{...props,fontSize:20},{view},{height:80});
    f.scene.runtime.handles.get('control').readState=()=>({value:50});f.run();
    assert.equal(f.scene.runtime.handles.get('control').readState().value,50);value.text='5…';fails(f);
  }
});
