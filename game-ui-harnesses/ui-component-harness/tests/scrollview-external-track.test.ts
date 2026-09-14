import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceDocumentSha256 } from '../src/appearance-binding.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { createBundle, validateBundle } from '../src/bundle.ts';
import { importDecompositionZip } from '../src/decomposition-import.ts';
import { fixtureLayeredZip } from './helpers/decomposition-fixture.ts';
import { scrollHitArea } from '../src/scroll-hit-area.ts';
const style = { backgroundColor:'#151515',borderColor:'#555555',borderWidth:0,cornerRadius:0,textColor:'#FFFFFF',fontFamily:'sans-serif',fontSize:16,fontWeight:'normal',opacity:1 };
async function fixture(scale=1) {
 const document:any={schemaVersion:'0.2',id:'external-track',canvas:{width:300*scale,height:250*scale},root:{id:'root',type:'Container',layout:{x:0,y:0,width:300*scale,height:250*scale},props:{style},children:[{id:'parent',type:'Container',layout:{x:20*scale,y:30*scale,width:250*scale,height:200*scale},props:{style},children:[{id:'scroll',type:'ScrollView',layout:{x:10*scale,y:10*scale,width:100*scale,height:120*scale},props:{style,scrollX:0,scrollY:0,contentWidth:100*scale,contentHeight:240*scale},children:[]}]}]}};
 const f=await fixtureLayeredZip([300,250],[{id:'scene',role:'background',left:0,top:0,width:300,height:250},{id:'viewport',role:'important_component',left:30,top:40,width:100,height:120},{id:'track',role:'important_component',left:140,top:45,width:14,height:110},{id:'thumb',role:'important_component',left:142,top:45,width:10,height:20}]);
 const imported=await importDecompositionZip(f.zip);
 const target=await createBundle(document,[],{kind:'programmatic-fixture',description:'Nested viewport with explicitly external vertical scrollbar; local fixture only.'});
 const binding:any={kind:'ui-appearance-binding',version:'0.2',documentSha256:await appearanceDocumentSha256(document),deliveryDigest:imported.deliveryDigest,sceneSha256:imported.sceneSha256,archiveSha256:imported.archiveSha256,registration:{sourceCanvas:{width:300,height:250},targetCanvas:document.canvas,transform:{scale,offset:{x:0,y:0}}},bindings:[{componentId:'scroll',componentType:'ScrollView',parts:[{role:'viewport',layerId:'viewport'},{role:'scrollbar-track',layerId:'track'},{role:'scrollbar-thumb',layerId:'thumb'}],states:{scrollView:{thumbPositions:{coordinateSpace:'target-component-local',anchor:'top-left',min:{x:112*scale,y:5*scale},max:{x:112*scale,y:95*scale}}}}}]};
 return {target,imported,binding};
}
test('nested ScrollView binds an external track at native and registered scale',async()=>{
 for(const scale of [1,2]){const f=await fixture(scale),applied:any=await applyAppearanceBinding(f.target,f.imported,f.binding);const a=applied.document.root.children[0].children[0].props.appearance;assert.deepEqual(a.scrollbarTrack.layout,{x:110,y:5,width:14,height:110});assert.equal(a.sourceCanvas.width,100);}
});
test('external scrollbar endpoints cannot escape the actual track',async()=>{
 for(const [point,axis,value] of [['min','x',111],['min','y',4],['max','x',115],['max','y',96]] as const){const f=await fixture();f.binding.bindings[0].states.scrollView.thumbPositions[point][axis]=value;await assert.rejects(applyAppearanceBinding(f.target,f.imported,f.binding),/THUMB_OUT_OF_BOUNDS|SCROLL_AXIS_MISMATCH/);}
});
test('direct external-track bundles retain track bounds validation',async()=>{
 const f=await fixture(),applied:any=await applyAppearanceBinding(f.target,f.imported,f.binding);
 for(const [axis,value] of [['x',115],['y',96]] as const){const changed=structuredClone(applied);changed.document.root.children[0].children[0].props.appearance.scrollbarThumbPositions.max[axis]=value;await assert.rejects(validateBundle(changed),/THUMB_OUT_OF_BOUNDS|SCROLLBAR_AXIS_MISMATCH/);}
});
test('external scroll hit region includes its track without swallowing the gap',()=>{
 const hit=scrollHitArea({width:100,height:120},{x:110,y:5,width:14,height:110});
 for(const p of [[50,60],[112,60],[124,115]])assert.equal(hit.contains(...p as [number,number]),true);
 for(const p of [[105,60],[112,3],[125,60],[112,116],[-1,60]])assert.equal(hit.contains(...p as [number,number]),false);
});

test('explicit auto and always visibility permit short content without inventing overflow',async()=>{
 for(const height of [60,120]) for(const visibility of ['auto','always']) {
  const f=await fixture(); f.target=structuredClone(f.target); const node:any=f.target.document.root.children![0].children![0];
  node.props.contentHeight=height; node.props.scrollbarVisibility=visibility; node.props.drawBackground=false;
  f.binding.documentSha256=await appearanceDocumentSha256(f.target.document);
  const applied:any=await applyAppearanceBinding(f.target,f.imported,f.binding);
  assert.equal(applied.document.root.children[0].children[0].props.contentHeight,height);
  delete node.props.scrollbarVisibility; f.binding.documentSha256=await appearanceDocumentSha256(f.target.document);
  await assert.rejects(applyAppearanceBinding(f.target,f.imported,f.binding),/VERTICAL_SCROLL_TEMPLATE_REQUIRED/);
 }
});
