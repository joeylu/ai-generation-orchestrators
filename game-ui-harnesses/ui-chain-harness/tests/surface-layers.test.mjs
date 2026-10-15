import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {extendSkinMaterials} from '../src/skins/materials.mjs';
import {verifySkinPackage} from '../src/skins/package.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {surfaceLayerInfo,surfaceTextBox} from '../src/skins/surface-styles.mjs';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument,resourceClosure} from '../src/panel/document.mjs';
import {validateSizeEdit} from '../src/panel/size-edit.mjs';
import {inventoryLayout} from '../src/runtime/inventory-geometry.mjs';
import {inventoryScrollMode,upgradeInventoryRegistry} from '../src/runtime/inventory-policy.mjs';
import {surfaceSlotBox,surfaceGeometryForContext} from '../src/runtime/surface-slots.mjs';

const fixture=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-surface-layers-'))),extended=await extendSkinMaterials({...fixture,output:join(fixture.directory,'decorated')}),verified=await verifySkinPackage(extended.packageDirectory),ctx={...await editorData(),...settingsSkinGeometry(verified.pack),profile:verified.pack.theme,binding:{sourceKind:'imported',sha256:verified.manifestSha256}};
function document(layer){return {kind:'ui_panel_document',version:'0.3',id:'surfaces',revision:0,title:'Surfaces',canvas:'landscape',bindings:ctx.binding,rootId:'board',nodes:[{id:'board',name:'Board',recipeRef:'container@1.0.0',props:{},size:{width:1280,height:720},slots:{children:['panel']},layout:{childrenMode:'free',padding:0}},{id:'panel',name:'Panel',recipeRef:'panel@1.0.0',props:{title:'',contentPadding:{left:24,right:24,top:24,bottom:24}},size:{width:600,height:400},position:{x:30,y:30},slots:{content:['copy']},...(layer?{surfaceLayer:layer}:{})},{id:'copy',name:'Copy',recipeRef:'text@1.0.0',props:{text:'Body',textStyleRef:'body',overflow:'error'},size:{width:240,height:48},slots:{}}]};}

test('explicit layers preserve immutable skin bytes and select complete resource closure without changing legacy documents',async()=>{
 const before=await readFile(join(extended.packageDirectory,'skin-pack.json'));
 for(const layer of ['frame','content','inset']){
  const doc=validateDocument(document(layer),ctx),closure=resourceClosure(doc,ctx);
  assert.equal(doc.nodes[1].surfaceLayer,layer);assert(closure.roles.includes(layer==='frame'?'skin.surface.panel':'skin.surface.content'));
  assert.equal(closure.assets.includes('material.paper'),layer==='frame');assert.deepEqual(validateSizeEdit(doc,doc,ctx),doc);
  const smaller=structuredClone(doc);smaller.nodes[1].size.width=500;smaller.nodes[1].size.height=300;assert.equal(validateSizeEdit(doc,smaller,ctx).nodes[1].surfaceLayer,layer);
 }
 const old=document();assert.equal(validateDocument(old,ctx).nodes[1].surfaceLayer,undefined);assert(resourceClosure(old,ctx).assets.includes('material.paper'));
 assert.deepEqual(await readFile(join(extended.packageDirectory,'skin-pack.json')),before);
});

test('surface layers reject conflicting backgrounds, legacy versions, unsupported components and unsafe actual padding',()=>{
 for(const change of [d=>d.version='0.2',d=>d.nodes[1].surfaceLayer='unknown',d=>d.nodes[1].surfaceStyle='panel',d=>d.nodes[0].surfaceLayer='content']){
  const doc=document('content');change(doc);assert.throws(()=>validateDocument(doc,ctx));
 }
 const context=structuredClone(ctx),id=context.skinGeometry.roles.find(r=>r.role==='skin.surface.content').assetId;
 context.skinGeometry.assets.find(a=>a.assetId===id).contentInsets.left=32;
 assert.throws(()=>validateDocument(document('content'),context),{code:'panel.padding'});
 const safe=document('content');safe.nodes[1].props.contentPadding.left=32;assert.doesNotThrow(()=>validateDocument(safe,context));
});

test('new layered panels explicitly require multiplier one without changing legacy multipliers or submitted objects',()=>{
 for(const layer of ['frame','content','inset']){
  const implicit=document(layer),before=structuredClone(implicit);assert.equal(validateDocument(implicit,ctx).nodes[1].props.pixelsPerUnitMultiplier,1);assert.deepEqual(implicit,before);
  const explicit=document(layer);explicit.nodes[1].props.pixelsPerUnitMultiplier=1;assert.doesNotThrow(()=>validateDocument(explicit,ctx));
  const bad=document(layer);bad.nodes[1].props.pixelsPerUnitMultiplier=2;const original=structuredClone(bad);assert.throws(()=>validateDocument(bad,ctx),{code:'panel.surface-layer'});assert.deepEqual(bad,original);
 }
 const old=document();old.nodes[1].props.pixelsPerUnitMultiplier=2;const before=structuredClone(old);assert.equal(validateDocument(old,ctx).nodes[1].props.pixelsPerUnitMultiplier,2);assert.deepEqual(old,before);
});

test('inset samples the full safe body in logical coordinates at scale and density two, and rejects one-pixel bodies',()=>{
 for(const [scale,density]of [[1,1],[2,1],[1,2]]){
  const geometry={scale,roles:[{role:'skin.surface.content',assetId:'content'}],assets:[{assetId:'content',width:120*scale*density,height:90*scale*density,density,nineSlice:{left:8,right:10,top:6,bottom:8},contentInsets:{left:12,right:14,top:10,bottom:11},minSize:{width:27,height:22}}]};
  const info=surfaceLayerInfo(geometry,'inset');assert.deepEqual(info.sample,{x:12,y:10,width:94,height:69,sourceWidth:120,sourceHeight:90});
  assert.equal(info.baseRole,'skin.surface.content');assert.equal(info.materialStyle,null);
  geometry.assets[0].contentInsets.right=107;assert.throws(()=>surfaceLayerInfo(geometry,'inset'),{code:'skin.surface-style'});
 }
});

test('layered inventory reserves real content borders without changing fixed cells, axes or frozen legacy geometry',()=>{
 const g=structuredClone(ctx.skinGeometry),asset=g.assets.find(a=>a.assetId===g.roles.find(r=>r.role==='skin.surface.content').assetId);asset.contentInsets={left:12,right:14,top:10,bottom:11};
 const props={items:[],selectedId:null,selection:'single',itemRecipeRef:'button@1.0.0',inventory:{columns:12,rows:12,gap:10,details:'below',appearance:'slots',cellSize:80,scrollMode:inventoryScrollMode}};
 const old=inventoryLayout(ctx.profile,props,340,600,g),next=inventoryLayout(ctx.profile,props,340,600,g,{surfaceLayer:'content'});
 assert.equal(next.cell.width,80);assert.equal(next.grid.contentWidth,old.grid.contentWidth);assert.equal(next.grid.contentHeight,old.grid.contentHeight);assert.equal(next.grid.x-next.grid.surface.x,12);assert.equal(next.grid.y,12);assert.equal(next.grid.surface.width-next.grid.width,26);assert.equal(next.grid.surface.height-next.grid.height,24);assert(next.grid.scrollableX&&next.grid.scrollableY);assert.equal(Object.hasOwn(old.grid,'surface'),false);
});

test('new heading text insets remain explicit immutable authoring fields and never weaken frozen skin safety',()=>{
 const oldStyle=structuredClone(ctx.skinGeometry.surfaceStyles.title),pad={left:48,right:32,top:10,bottom:10},doc=document();
 doc.nodes=doc.nodes.slice(0,2);doc.nodes[1]={id:'panel',name:'Heading',recipeRef:'text@1.0.0',surfaceStyle:'title',surfaceTextInsets:pad,props:{text:'Heading',textStyleRef:'body',overflow:'error'},size:{width:600,height:64},position:{x:30,y:30},slots:{}};
 const valid=validateDocument(doc,ctx),box=surfaceTextBox(ctx.skinGeometry,'title',600,64,pad);assert.equal(box.x,48);assert.equal(box.width,520);assert.deepEqual(box.insets,pad);assert.deepEqual(validateSizeEdit(valid,valid,ctx),valid);assert.deepEqual(ctx.skinGeometry.surfaceStyles.title,oldStyle);
 for(const mutate of [d=>d.nodes[1].surfaceTextInsets.left=0,d=>delete d.nodes[1].surfaceTextInsets.bottom,d=>d.nodes[1].surfaceTextInsets.top=513,d=>d.nodes[1].surfaceTextInsets.top=60,d=>delete d.nodes[1].surfaceStyle,d=>d.version='0.2']){const bad=structuredClone(doc);mutate(bad);assert.throws(()=>validateDocument(bad,ctx));}
 const changed=structuredClone(doc);changed.nodes[1].surfaceTextInsets.left++;assert.throws(()=>validateSizeEdit(doc,changed,ctx),{code:'edit.size-only'});
});

test('import and unchanged size-copy use the same actual surface slot and reject masked oversized children atomically',()=>{
 const bad=document('content');bad.nodes[1].props.contentPadding={left:40,right:40,top:40,bottom:40};bad.nodes[1].size={width:400,height:200};bad.nodes[2].size={width:350,height:48};
 const original=structuredClone(bad);assert.throws(()=>validateDocument(bad,ctx),{code:'panel.slot-bounds'});assert.deepEqual(bad,original);
 const good=structuredClone(bad);good.nodes[2].size={width:320,height:120};const valid=validateDocument(good,ctx);assert.deepEqual(validateSizeEdit(valid,valid,ctx),valid);
 const smaller=structuredClone(valid);smaller.nodes[1].size.width=399;assert.throws(()=>validateSizeEdit(valid,smaller,ctx),{code:'panel.slot-bounds'});assert.deepEqual(valid,validateDocument(good,ctx));
 const old=structuredClone(bad);delete old.nodes[1].surfaceLayer;assert.doesNotThrow(()=>validateDocument(old,ctx));
});

test('generic List explicit rows respect real horizontal safe padding while vertical rows keep their clip contract',()=>{
 const doc=document('content');doc.nodes[1]={...doc.nodes[1],recipeRef:'list@1.0.0',props:{items:[{id:'row',label:'Row',enabled:true}],itemRecipeRef:'button@1.0.0',selectedId:null,selection:'none'},slots:{items:['copy']},size:{width:400,height:240}};
 doc.nodes[2]={...doc.nodes[2],recipeRef:'button@1.0.0',props:{label:'Row'},size:{width:390,height:300}};
 assert.throws(()=>validateDocument(doc,ctx),{code:'panel.slot-bounds'});
 const box=surfaceSlotBox({type:'List',props:doc.nodes[1].props,size:doc.nodes[1].size,profile:ctx.profile,geometry:ctx.skinGeometry,surfaceLayer:'content'});
 doc.nodes[2].size.width=box.width;assert.doesNotThrow(()=>validateDocument(doc,ctx));
 const old=structuredClone(doc);delete old.nodes[1].surfaceLayer;old.nodes[2].size.width=390;assert.doesNotThrow(()=>validateDocument(old,ctx));
});

test('fixture layer slot metadata matches the renderer and inventory portable closure includes both real bar roles without rewriting authoring',async()=>{
 const fixtureCtx=await editorData(),geometry=surfaceGeometryForContext(fixtureCtx),assetId=geometry.roles.get('skin.surface.content'),part=fixtureCtx.template.sheets.flatMap(s=>s.parts).find(p=>p.assetId===assetId),[,,width,height]=part.bodyRect;
 assert.equal(geometry.metadata.get(assetId).slice,Math.max(1,Math.min(fixtureCtx.profile.slice,Math.floor(width/4),Math.floor(height/4))));assert.deepEqual(geometry.insets('skin.surface.content'),{left:fixtureCtx.profile.padding,right:fixtureCtx.profile.padding,top:0,bottom:0});
 const fixtureDocument=document('content');fixtureDocument.bindings=fixtureCtx.binding;assert(resourceClosure(validateDocument(fixtureDocument,fixtureCtx),fixtureCtx).roles.includes('skin.surface.content'));
 const doc=document('content');doc.nodes=doc.nodes.slice(0,2);doc.nodes[1].recipeRef='list@1.0.0';doc.nodes[1].slots={items:[]};doc.nodes[1].props={items:[],selectedId:null,selection:'single',itemRecipeRef:'button@1.0.0',inventory:{columns:5,rows:4,cellSize:80,gap:10,details:'below',appearance:'slots',scrollMode:inventoryScrollMode}};doc.nodes[1].size={width:600,height:650};
 const inventoryCtx={...ctx,registry:upgradeInventoryRegistry(ctx.registry)},before=structuredClone(doc),closure=resourceClosure(validateDocument(doc,inventoryCtx),inventoryCtx);for(const role of ['skin.scrollbar.track','skin.scrollbar.thumb']){assert(closure.roles.includes(role));assert(closure.assets.includes(ctx.usage.bindings.find(b=>b.role===role).assetId));}assert.deepEqual(doc,before);
});

