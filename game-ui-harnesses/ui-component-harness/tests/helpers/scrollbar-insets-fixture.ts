import { appearanceDocumentSha256 } from '../../src/appearance-binding.ts';
import { applyAppearanceBinding } from '../../src/appearance-apply.ts';
import { createBundle, validateBundle } from '../../src/bundle.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import { fixtureLayeredZip } from './decomposition-fixture.ts';
import { scrollHitArea } from '../../src/scroll-hit-area.ts';
const style = { backgroundColor:'#151515',borderColor:'#555555',borderWidth:0,cornerRadius:0,textColor:'#FFFFFF',fontFamily:'sans-serif',fontSize:16,fontWeight:'normal',opacity:1 };
export async function fixture(scale=1) {
 const document:any={schemaVersion:'0.2',id:'external-track',canvas:{width:300*scale,height:250*scale},root:{id:'root',type:'Container',layout:{x:0,y:0,width:300*scale,height:250*scale},props:{style},children:[{id:'parent',type:'Container',layout:{x:20*scale,y:30*scale,width:250*scale,height:200*scale},props:{style},children:[{id:'scroll',type:'ScrollView',layout:{x:10*scale,y:10*scale,width:100*scale,height:120*scale},props:{style,scrollX:0,scrollY:0,contentWidth:100*scale,contentHeight:240*scale},children:[]}]}]}};
 const f=await fixtureLayeredZip([300,250],[{id:'scene',role:'background',left:0,top:0,width:300,height:250},{id:'viewport',role:'important_component',left:30,top:40,width:100,height:120},{id:'track',role:'important_component',left:140,top:45,width:14,height:110},{id:'thumb',role:'important_component',left:142,top:45,width:10,height:20}]);
 const imported=await importDecompositionZip(f.zip);
 const target=await createBundle(document,[],{kind:'programmatic-fixture',description:'Nested viewport with explicitly external vertical scrollbar; local fixture only.'});
 const binding:any={kind:'ui-appearance-binding',version:'0.2',documentSha256:await appearanceDocumentSha256(document),deliveryDigest:imported.deliveryDigest,sceneSha256:imported.sceneSha256,archiveSha256:imported.archiveSha256,registration:{sourceCanvas:{width:300,height:250},targetCanvas:document.canvas,transform:{scale,offset:{x:0,y:0}}},bindings:[{componentId:'scroll',componentType:'ScrollView',parts:[{role:'viewport',layerId:'viewport'},{role:'scrollbar-track',layerId:'track'},{role:'scrollbar-thumb',layerId:'thumb'}],states:{scrollView:{thumbPositions:{coordinateSpace:'target-component-local',anchor:'top-left',min:{x:112*scale,y:5*scale},max:{x:112*scale,y:95*scale}}}}}]};
 return {target,imported,binding};
}
