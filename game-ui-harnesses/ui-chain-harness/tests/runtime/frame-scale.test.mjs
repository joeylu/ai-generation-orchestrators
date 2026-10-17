import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {extendSkinMaterials} from '../../src/skins/materials.mjs';
import {verifySkinPackage,hash} from '../../src/skins/package.mjs';
import {encodePng,decodePng} from '../../src/skins/png.mjs';
import {startHarness} from './harness.mjs';

async function packet(){
 const f=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-frame-scale-'))),directory=(await extendSkinMaterials({...f,output:join(f.directory,'decorated')})).packageDirectory,v=await verifySkinPackage(directory),pack=structuredClone(v.pack),a=pack.assets.find(a=>a.assetId===pack.roles.find(r=>r.role==='skin.surface.panel').assetId),image={width:a.width,height:a.height,pixels:Buffer.alloc(a.width*a.height*4)};
 // A deterministic red corner makes the fixed ornament's actual rendered
 // area measurable without relying on private artwork or model output.
 for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)image.pixels.set(x<4&&y<4?[255,0,0,255]:[30,75,92,255],(y*a.width+x)*4);
 const bytes=encodePng(image);a.sha256=hash(bytes);a.bytes=bytes.length;v.resources.set(a.file,bytes);const manifest=Buffer.from(JSON.stringify(pack));
 return {pack,skinPack:{manifest:manifest.toString('base64'),manifestSha256:hash(manifest),bindings:pack.bindings,resources:Object.fromEntries([...v.resources].map(([f,b])=>[f,b.toString('base64')]))}};
}
function redArea(uri){const im=decodePng(Buffer.from(uri.split(',')[1],'base64'));let count=0;for(let i=0;i<im.pixels.length;i+=4)if(im.pixels[i]>220&&im.pixels[i+1]<25&&im.pixels[i+2]<25&&im.pixels[i+3]>240)count++;return count;}

test('frame scale renders larger fixed corners with unchanged tile scale and atomic safety; absent scale remains pixel-identical to one',async()=>{
 const p=await packet(),h=await startHarness({width:640,height:420,skinPack:p.skinPack,profile:p.pack.theme});
 try{
  const proofs=[];
  for(const scale of [null,1,3]){
   const proof=await h.page.evaluate(async scale=>{
    harness.clear();const r=harness.runtime,body=r.create({id:'body',recipeRef:'text@1.0.0',props:{text:'Body',textStyleRef:'body'},size:{width:300,height:48}}),input={id:'frame',recipeRef:'panel@1.0.0',surfaceLayer:'frame',...(scale===null?{}:{surfaceScale:scale}),props:{title:'',contentPadding:{left:42,right:42,top:42,bottom:42}},size:{width:400,height:240}},n=r.create(input,{content:[body]});r.mount(n);window.scalePanel=n;
    const l=n.adapter.layer,uri=await harness.app.renderer.extract.base64({target:l.view,format:'png'}),snapshot=n.snapshot(),authored=JSON.stringify(snapshot),before={...n.size};let resizeCode;try{n.resize(370,240);}catch(e){resizeCode=e.code;}
    const atomic=JSON.stringify(n.snapshot())===authored&&JSON.stringify(n.size)===JSON.stringify(before);n.resize(440,260);
    return {uri,snapshot,resizeCode,atomic,after:{width:l.background.width,height:l.background.height},scale:l.scaledBase?.scale.x??1,tileScale:l.material.layers[0].item.tileScale.x,clip:l.info.clipInsets,sourceAlive:!harness.skin.texture('skin.surface.panel').source.destroyed};
   },scale);proofs.push(proof);
  }
  assert.equal(proofs[0].uri,proofs[1].uri);assert.equal(Object.hasOwn(proofs[0].snapshot,'surfaceScale'),false);assert.equal(proofs[1].snapshot.surfaceScale,1);assert.equal(proofs[2].snapshot.surfaceScale,3);assert(redArea(proofs[2].uri)>=redArea(proofs[0].uri)*6);assert.equal(proofs[2].scale,3);assert.equal(proofs[2].tileScale,proofs[0].tileScale);
  for(const proof of proofs){assert.equal(proof.resizeCode,'panel.slot-bounds');assert(proof.atomic);assert(proof.sourceAlive);assert(Math.abs(proof.after.width*proof.scale-440)<.001);assert(Math.abs(proof.after.height*proof.scale-260)<.001);}
  const invalid=await h.page.evaluate(()=>{harness.clear();const r=harness.runtime,child=r.create({id:'invalid-child',recipeRef:'text@1.0.0',props:{text:'Body',textStyleRef:'body'},size:{width:200,height:48}}),results=[];for(const [surfaceLayer,surfaceScale]of [['content',1],['inset',3],[undefined,2],['frame',0],['frame',4.1]]){let code;const count=r.handles.size;try{r.create({id:'invalid',recipeRef:'panel@1.0.0',surfaceLayer,surfaceScale,props:{title:''},size:{width:400,height:240}},{content:[child]});}catch(e){code=e.code;}results.push({code,unchanged:r.handles.size===count&&child.parent===null});}return results;});
  assert(invalid.every(r=>r.code==='skin.surface-style'&&r.unchanged));assert.deepEqual(h.errors,[]);
  for(const type of ['Dialog','ScrollView','Tabs','List']){
   const actual=await h.page.evaluate(type=>{harness.clear();const n=harness.make(type,{surfaceLayer:'frame',surfaceScale:3,size:{width:580,height:340}}),l=n.adapter.layer??n.adapter.view.layerSurface;n.resize(600,360);return {scale:n.snapshot().surfaceScale,renderScale:l.scaledBase.scale.x,insets:l.info.insets,localWidth:l.background.width,localHeight:l.background.height};},type);
   assert.equal(actual.scale,3,type);assert.equal(actual.renderScale,3,type);assert(Math.abs(actual.localWidth*3-600)<.001,type);assert(Math.abs(actual.localHeight*3-360)<.001,type);
  }
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
