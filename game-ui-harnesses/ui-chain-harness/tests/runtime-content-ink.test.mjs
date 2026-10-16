import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Texture,Sprite,Container,Text} from 'pixi.js';
import {prepareRuntimeContentInk,runtimeRoleInk} from '../src/runtime/derived-text-ink.mjs';
import {createLayerSurface} from '../src/runtime/layer-surface.mjs';
import {deriveTextReadability} from '../src/skins/text-readability.mjs';
import {textColorOwner} from '../src/runtime/text-colors.mjs';
const role='skin.surface.content';
function fixture({alpha=255,declared='#F5F7FF',darkCenter=false}={}){
 const asset={assetId:'surface.content',sha256:'a'.repeat(64),width:100,height:100,density:1,contentInsets:{left:0,right:0,top:0,bottom:0},nineSlice:{left:30,right:30,top:30,bottom:30},minSize:{width:61,height:61}};
 const pack={scale:1,roles:[{role,assetId:asset.assetId}],assets:[asset],theme:{palette:{text:'#777777'},textColors:{[role]:declared}}},image={width:100,height:100,pixels:Buffer.alloc(40000)};
 for(let y=0;y<100;y++)for(let x=0;x<100;x++){const center=x>=30&&x<70&&y>=30&&y<70,dark=center?darkCenter:!darkCenter;image.pixels.set([...(dark?[10,20,30]:[235,225,205]),center?alpha:255],(y*100+x)*4);}
 const images=new Map([[asset.assetId,image]]),skin={profile:pack.theme};return {pack,image,images,skin};
}
test('deep frame and light inset center reproduce the wrong whole-role white ink; exact inset region selects readable dark ink',()=>{
 const f=fixture(),before=Buffer.from(f.image.pixels),whole=deriveTextReadability(f.pack,f.images,{preserve:false}),candidate=prepareRuntimeContentInk(f.pack,f.images);
 assert.equal(whole.inks[role],'#F5F7FF');assert.equal(candidate.correction,true);assert.equal(candidate.fill,'#111827');assert(candidate.minimumContrast>10);
 assert.deepEqual(candidate.sourceRect,[30,30,40,40]);assert.equal(candidate.samples,289);assert.equal(candidate.transparentSamples,0);
 const ink=runtimeRoleInk(f.skin,role,{enhanced:true,contentInk:candidate});assert.equal(ink.source,'derived-content-region');assert.equal(ink.fill,'#111827');assert.equal(ink.compositeAcceptance,'unreviewed');
 assert.deepEqual(f.image.pixels,before);assert.equal(f.pack.theme.textColors[role],'#F5F7FF');
});
test('ordinary declared role and mismatched backgrounds keep their prior behavior',()=>{
 const f=fixture(),candidate=prepareRuntimeContentInk(f.pack,f.images);
 assert.deepEqual(runtimeRoleInk(f.skin,role,{contentInk:candidate}),{fill:'#F5F7FF',source:'declared-role'});
 assert.deepEqual(runtimeRoleInk(f.skin,role,{enhanced:true}),{fill:'#F5F7FF',source:'declared-role'});
 f.skin.profile.textColors['skin.surface.popup']='#223344';assert.deepEqual(runtimeRoleInk(f.skin,'skin.surface.popup',{enhanced:true,contentInk:candidate}),{fill:'#223344',source:'declared-role'});
 f.skin.profile.textColors[role]='#334455';assert.deepEqual(runtimeRoleInk(f.skin,role,{enhanced:true,contentInk:candidate}),{fill:'#334455',source:'declared-role'});
});
test('explicit author and surface style inks remain authoritative',()=>{
 const f=fixture(),contentInk=prepareRuntimeContentInk(f.pack,f.images);
 assert.deepEqual(runtimeRoleInk(f.skin,role,{enhanced:true,contentInk,authorColor:'#12AB34',styleColor:'#FFFF00'}),{fill:'#12AB34',source:'author'});
 assert.deepEqual(runtimeRoleInk(f.skin,role,{enhanced:true,contentInk,styleColor:'#FFFF00'}),{fill:'#FFFF00',source:'surface-style'});
 assert.deepEqual(runtimeRoleInk(f.skin,role,{enhanced:true,contentInk,replacement:true}),{fill:'#F5F7FF',source:'declared-role'});
});
test('transparent or too few inset samples cannot invent a backing color',()=>{
 for(const alpha of [0,180,239]){const f=fixture({alpha}),candidate=prepareRuntimeContentInk(f.pack,f.images);assert.equal(candidate.correction,false);assert.equal(candidate.samplingStatus,'needs-review');assert.equal(candidate.transparentSamples,289);assert.deepEqual(runtimeRoleInk(f.skin,role,{enhanced:true,contentInk:candidate}),{fill:'#F5F7FF',source:'declared-role'});}
 const f=fixture();f.pack.assets[0].nineSlice={left:49,right:49,top:49,bottom:49};const few=prepareRuntimeContentInk(f.pack,f.images);assert.equal(few.samples,4);assert.equal(few.correction,false);
});
test('readable declared ink and deep center avoid an unnecessary correction',()=>{
 const readable=fixture({declared:'#111827'}),a=prepareRuntimeContentInk(readable.pack,readable.images);assert.equal(a.correction,false);
 const dark=fixture({darkCenter:true}),b=prepareRuntimeContentInk(dark.pack,dark.images);assert.equal(b.fill,'#F5F7FF');assert.equal(b.correction,false);
});
test('explicit content and inset backgrounds reuse immutable load-time caches across resize',()=>{
 const f=fixture(),cache=prepareRuntimeContentInk(f.pack,f.images),texture=Texture.EMPTY;
 const skin={surfaceGeometry:f.pack,profile:f.pack.theme,runtimeContentInk:cache,texture:()=>texture,assertView(){},view(){return new Sprite({texture});},runtimeRoleInk(role,options){return runtimeRoleInk(this,role,options);}};
 const inset=createLayerSurface(skin,'inset',120,80),content=createLayerSurface(skin,'content',120,80);
 try{assert.strictEqual(inset.background.contentInk,cache);assert.strictEqual(content.background.contentInk,cache);const sample=inset.derivedTexture.frame.clone();
  f.images.clear();f.image.pixels.fill(0);inset.resize(160,100);inset.resize(120,80);
  assert.strictEqual(inset.background.contentInk,cache);assert.deepEqual(inset.derivedTexture.frame,sample);assert.equal(cache.minimumContrast>10,true);assert.equal(Object.isFrozen(cache),true);assert.equal(Object.isFrozen(cache.sourceRect),true);
 }finally{inset.view.destroy({children:true});content.view.destroy({children:true});}
});

test('nested button, field and popup roles retain their own backgrounds instead of ancestor content ink',()=>{
 const f=fixture(),contentInk=prepareRuntimeContentInk(f.pack,f.images);
 for(const role of ['skin.button.primary.normal','skin.field.normal','skin.surface.popup']){f.skin.profile.textColors[role]='#CCAA77';assert.deepEqual(runtimeRoleInk(f.skin,role,{enhanced:true,contentInk}),{fill:'#CCAA77',source:'declared-role'});}
});
test('text owner traversal chooses nested control backgrounds and explicit S05 ink before outer content candidates',()=>{
 const f=fixture(),cache=prepareRuntimeContentInk(f.pack,f.images),stage=new Container(),content=new Container();stage.addChild(content);
 const buttonRole='skin.button.primary.normal',fieldRole='skin.field.normal',barRole='skin.surface.bar';
 f.skin.profile.textColors[buttonRole]='#DDEEFF';f.skin.profile.textColors[fieldRole]='#223344';f.skin.profile.textColors[barRole]='#445566';
 const textures=new Map(['content','button','field'].map(id=>[id,new Texture({source:Texture.EMPTY.source})]));
 const skin={...f.skin,roles:new Map([[role,'content'],[buttonRole,'button'],[fieldRole,'field']]),textures,runtimeRoleInk(role,options){return runtimeRoleInk(this,role,options);}};
 const bounds=(view,box)=>{view.getBounds=()=>({...box});return view;};
 const background=bounds(new Sprite({texture:textures.get('content')}),{x:0,y:0,width:200,height:200});background.contentInk=cache;content.addChild(background);
 const label=(value,box)=>bounds(new Text({text:value,style:{fill:'#000000'}}),box);
 const body=label('content',{x:10,y:5,width:50,height:12});content.addChild(body);
 const button=new Container();button.addChild(bounds(new Sprite({texture:textures.get('button')}),{x:20,y:30,width:100,height:30}));const buttonLabel=label('button',{x:25,y:35,width:50,height:12});button.addChild(buttonLabel);content.addChild(button);
 const field=new Container();field.addChild(bounds(new Sprite({texture:textures.get('field')}),{x:20,y:80,width:100,height:30}));const fieldLabel=label('field',{x:25,y:85,width:50,height:12});field.addChild(fieldLabel);content.addChild(field);
 const title=label('S05 title',{x:20,y:140,width:80,height:12});title.surfaceInk={role:barRole,styleColor:'#F5F7FF',replacement:true};content.addChild(title);
 const author=new Container(),authorLabel=label('author',{x:20,y:165,width:80,height:12});author.addChild(authorLabel);content.addChild(author);
 const app={stage,renderer:{background:{color:{toHex:()=>'#888888'},alpha:1}},ticker:{add(){},remove(){}}};
 const owner=textColorOwner(app,skin,()=>[content],()=>new Map([[author,'#12AB34']]),()=>new Map(),()=>new Map([[content,true]]));
 try{const evidence=owner.refresh();assert.equal(body.style.fill,'#111827');assert.equal(buttonLabel.style.fill,'#DDEEFF');assert.equal(fieldLabel.style.fill,'#223344');assert.equal(title.style.fill,'#F5F7FF');assert.equal(authorLabel.style.fill,'#12AB34');
  assert.equal(evidence.find(e=>e.text==='content').colorSource,'derived-content-region');assert.equal(evidence.find(e=>e.text==='button').role,buttonRole);assert.equal(evidence.find(e=>e.text==='field').role,fieldRole);assert.equal(evidence.find(e=>e.text==='S05 title').role,barRole);assert.equal(evidence.find(e=>e.text==='author').colorSource,'node-override');
 }finally{owner.dispose();stage.destroy({children:true});for(const texture of textures.values())texture.destroy(false);}
});
