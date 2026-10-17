import test from 'node:test';
import assert from 'node:assert/strict';
import {Text} from 'pixi.js';
import {scopedTextSkin} from '../src/runtime/text-skin.mjs';
import {textColorOwner} from '../src/runtime/text-colors.mjs';

const makeSkin=()=>{
  const profile={fontSize:16,itemHeight:32,padding:12,fontFamily:'fixture-font',geometry:{lineHeight:24},palette:{text:'#EEEEEE',active:'#123456'}};
  const skin={profile,textures:new Map(),roles:new Map(),
    // Match the real loader's captured profile, rather than a this.profile
    // implementation which would conceal the scoping regression.
    textStyle(extra={}){return {fontFamily:profile.fontFamily,fontSize:profile.fontSize,fill:profile.palette.text,...extra};},
    label(value,width,extra){return {value,width,style:this.textStyle(extra)};},
    assertComponent(){return this.profile;},dispose(){throw Error('shared textures must remain owned by source');},
  };
  return skin;
};
test('node text scopes override captured producers and preserve shared skin ownership and defaults',()=>{
  const skin=makeSkin(),before=structuredClone(skin.profile);
  assert.equal(scopedTextSkin(skin,{}),skin);
  const size=scopedTextSkin(skin,{fontSize:32}),color=scopedTextSkin(skin,{textColor:'#aB1234'}),both=scopedTextSkin(skin,{fontSize:24,textColor:'#FF4400'});
  assert.equal(Object.getPrototypeOf(size),skin);assert.equal(size.textures,skin.textures);
  assert.equal(size.profile.fontSize,32);assert.equal(size.profile.geometry.lineHeight,48);assert.equal(size.profile.itemHeight,56);
  assert.deepEqual(size.label('size',80).style,{fontFamily:'fixture-font',fontSize:32,fill:'#EEEEEE'});
  assert.equal(color.textStyle().fontSize,16);assert.equal(color.textStyle().fill,'#aB1234');
  assert.equal(both.label('both',80,{align:'right',fill:'#000000'}).style.fill,'#FF4400');
  assert.equal(both.textStyle({fontSize:1}).fontSize,24);
  assert.equal(size.assertComponent(),skin.profile);assert.equal(size.dispose,skin.dispose);
  assert.deepEqual(skin.profile,before);assert.equal(skin.textStyle().fontSize,16);assert.equal(skin.textStyle().fill,'#EEEEEE');
  assert.equal(scopedTextSkin(skin,{}).label('child',80).style.fontSize,16);
});

const bounds={x:0,y:0,width:100,height:40};
const container=(children=[])=>({visible:true,alpha:1,tint:0xffffff,children,getBounds:()=>({...bounds})});
const label=value=>{
  const valueObject=Object.create(Text.prototype);
  for(const [key,entry]of Object.entries({...container(),text:value,style:{fill:'#EEEEEE'}}))Object.defineProperty(valueObject,key,{value:entry,writable:true,configurable:true});
  return valueObject;
};

test('program slot surfaces choose readable automatic ink without recoloring unrelated legacy text',()=>{
  const skin=makeSkin(),quantity=label('12'),legacy=label('legacy'),root=container([quantity,legacy]),stage=container([root]);
  const app={stage,renderer:{background:{color:{toHex:()=>'#000000'},alpha:1}},ticker:{add(){},remove(){}}};
  const boundaries=new Map([[root,null]]),backings=new Map([[quantity,'#FFFFFF']]);
  const owner=textColorOwner(app,skin,()=>[root],()=>boundaries,()=>backings);
  owner.refresh();assert.equal(quantity.style.fill,'#111827');assert.equal(legacy.style.fill,'#EEEEEE');
  assert.equal(owner.evidence.find(entry=>entry.text==='12').colorSource,'program-surface');
  boundaries.set(root,'#AABBCC');owner.refresh();assert.equal(quantity.style.fill,'#AABBCC');
  assert.equal(owner.evidence.find(entry=>entry.text==='12').colorSource,'node-override');owner.dispose();
});

test('program slot backing outranks an outer skin role while untouched text retains that role',()=>{
  const skin=makeSkin(),texture={};skin.roles.set('skin.surface.panel','panel');skin.textures.set('panel',texture);skin.profile.textColors={'skin.surface.panel':'#F5F7FF'};
  const quantity=label('99'),heading=label('header'),root=container([quantity,heading]),stage=container([{...container(),texture},root]);
  const app={stage,renderer:{background:{color:{toHex:()=>'#000000'},alpha:1}},ticker:{add(){},remove(){}}};
  const owner=textColorOwner(app,skin,()=>[root],()=>new Map(),()=>new Map([[quantity,'#FFFFFF']]));
  owner.refresh();assert.equal(quantity.style.fill,'#111827');assert.equal(heading.style.fill,'#F5F7FF');owner.dispose();
});
test('explicit colors remain node-local through refresh, nested controls and detached overlays',()=>{
  const skin=makeSkin(),texture={};skin.roles.set('skin.surface.panel','panel');skin.textures.set('panel',texture);skin.profile.textColors={'skin.surface.panel':'#222222'};
  const own=label('own'),child=label('child'),popup=label('popup'),host=label('host'),childRoot=container([child]),parentRoot=container([own,childRoot]),popupRoot=container([popup]),overlay=container([popupRoot]);
  const background={...container(),texture},stage=container([background,parentRoot,overlay,host]);
  let added,removed;
  const app={stage,renderer:{background:{color:{toHex:()=>'#FFFFFF'},alpha:1}},ticker:{add:fn=>{added=fn;},remove:fn=>{removed=fn;}}};
  const boundaries=new Map([[parentRoot,'#Ab0011'],[childRoot,null],[popupRoot,'#FF3300']]);
  const owner=textColorOwner(app,skin,()=>[parentRoot,childRoot,overlay],()=>boundaries);
  const evidence=owner.refresh();
  assert.equal(own.style.fill,'#Ab0011');assert.equal(child.style.fill,'#222222');assert.equal(popup.style.fill,'#FF3300');assert.equal(host.style.fill,'#EEEEEE');
  assert.deepEqual(evidence.filter(entry=>entry.colorSource==='node-override').map(entry=>entry.text),['own','popup']);
  assert.ok(evidence.filter(entry=>entry.colorSource==='node-override').every(entry=>entry.compositingReview));
  boundaries.set(childRoot,'#0044CC');added();assert.equal(child.style.fill,'#0044CC');assert.equal(own.style.fill,'#Ab0011');
  boundaries.set(parentRoot,null);added();assert.equal(own.style.fill,'#222222');assert.equal(child.style.fill,'#0044CC');
  assert.equal(skin.profile.palette.text,'#EEEEEE');assert.equal(skin.profile.textColors['skin.surface.panel'],'#222222');
  owner.dispose();assert.equal(removed,added);
});
