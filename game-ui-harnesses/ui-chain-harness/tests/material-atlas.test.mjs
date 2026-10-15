import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {encodePng,decodePng,cropPng} from '../src/skins/png.mjs';
import {hash,json,verifySkinPackage} from '../src/skins/package.mjs';
import {extendSkinMaterials} from '../src/skins/materials.mjs';
import {extractMaterialAtlas,materializeMaterialAtlas,verifyMaterialAtlas} from '../src/skins/material-atlas.mjs';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';

const sourceSkinSha256='a'.repeat(64),ids=['material.title-band','material.section-band','material.panel-fill'];
const template={kind:'ui_material_template',version:'1.0',sheetId:'S05',coordinates:{width:32,height:32,outputScale:1},parts:[
 {assetId:ids[0],slotRect:[1,1,30,6],bodyRect:[2,2,28,4],stretch:'horizontal',purpose:'title'},
 {assetId:ids[1],slotRect:[1,9,30,5],bodyRect:[2,10,28,3],stretch:'horizontal',purpose:'section'},
 {assetId:ids[2],slotRect:[1,17,14,14],bodyRect:[2,18,12,12],stretch:'tile',purpose:'panel'}
]};
const pack={roles:[{role:'skin.surface.bar',assetId:'bar'},{role:'skin.surface.panel',assetId:'panel'}],assets:['bar','panel'].map(assetId=>({assetId,contentInsets:{left:20,right:21,top:7,bottom:8},nineSlice:{left:3,right:4,top:2,bottom:3},minSize:{width:42,height:16}})),theme:{textColors:{'skin.surface.bar':'#FFFFFF','skin.surface.panel':'#123456'}},surfaceStyles:{title:{baseRole:'skin.surface.bar',insets:{left:28,right:29,top:9,bottom:10},textColor:'#EEEEEE',layers:[]}}};
function atlas({scale=1,empty,dirty=false,seam=false,outside=false,disconnected=true}={}){
 const image={width:32*scale,height:32*scale,pixels:Buffer.alloc(32*scale*32*scale*4)};
 for(const [i,part]of template.parts.entries()){
  if(part.assetId===empty)continue;
  const [x,y,w,h]=part.bodyRect.map(n=>n*scale);
  for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){
   if(disconnected&&i===0&&col>x+2*scale&&col<x+w-2*scale)continue;
   image.pixels.set([seam&&i===2&&col===x+w-1?255:30,75,92,i===1?128:255],(row*image.width+col)*4);
  }
 }
 if(dirty)image.pixels.set([20,0,0,0],0);
 if(outside)image.pixels.set([20,30,40,255],0);
 const raw=encodePng(image);return {raw,rawSha256:hash(raw),image};
}
const input=(options={})=>({...atlas(options),template,sourceSkinSha256,pack});

test('fixed S05 slots retain disconnected ornaments, opaque fills and fractional alpha with no silhouette inference',()=>{
 const data=input(),{spec,report}=extractMaterialAtlas(data);
 assert.deepEqual(spec.materials.map(m=>m.assetId),ids);
 assert.deepEqual(spec.materials.map(m=>m.crop),template.parts.map(p=>p.bodyRect));
 assert(spec.materials.every(m=>m.sha256===data.rawSha256&&m.file==='source.png'));
 assert.equal(report.parts[1].partialAlphaPixels,28*3);
 assert.equal(report.parts[2].opaquePixels,12*12);
 assert.equal(report.parts[0].visiblePixels,5*4);
 assert.equal(report.modelCalls,0);assert.equal(report.visualAcceptance,'unreviewed');assert.equal(report.productionReady,false);
 assert.equal(report.semanticIdentity,'fixed-template-slot');
 assert.equal(report.inputSha256,hash(Buffer.from(json(spec))));
});
test('bindings replace title bands, tile the panel gently and preserve the base skin text safe area and ink',()=>{
 const {spec}=extractMaterialAtlas(input()),s=spec.surfaceStyles;
 for(const key of ['title','section']){assert.equal(s[key].baseRole,'skin.surface.bar');assert.equal(s[key].baseMode,'replace');assert.equal(s[key].layers[0].mode,'cover');assert.deepEqual(s[key].clipInsets,{left:0,right:0,top:0,bottom:0});}
 assert.deepEqual(s.title.insets,pack.surfaceStyles.title.insets);assert.equal(s.title.textColor,'#EEEEEE');
 assert.deepEqual(s.section.insets,pack.assets[0].contentInsets);assert.equal(s.section.textColor,'#FFFFFF');
 assert.equal(s.panel.baseMode,'overlay');assert.equal(s.panel.layers[0].mode,'tile');assert.equal(s.panel.layers[0].alpha,.14);assert.equal(s.panel.layers[0].blendMode,'multiply');
 assert.deepEqual(s.panel.clipInsets,pack.assets[1].nineSlice);
});
test('higher resolution uses exact source crops without resampling and rejects aspect changes or collapsed slots',()=>{
 const data=input({scale:2}),result=extractMaterialAtlas(data);
 assert.equal(result.report.scale,2);assert.deepEqual(result.spec.materials[0].crop,[4,4,56,8]);
 assert.deepEqual(result.report.warnings.find(w=>w.code==='material.source-resolution').actual,[64,64]);
 const original=cropPng(decodePng(data.raw),result.spec.materials[1].crop);assert.equal(original.pixels[3],128);
 const bad=encodePng({width:32,height:16,pixels:Buffer.alloc(32*16*4)});
 assert.throws(()=>extractMaterialAtlas({...data,raw:bad,rawSha256:hash(bad)}),/aspect ratio/);
 const tiny=encodePng({width:1,height:1,pixels:Buffer.alloc(4)});
 assert.throws(()=>extractMaterialAtlas({...data,raw:tiny,rawSha256:hash(tiny)}),/collapses/);
});
test('immutable raw, template, base skin and source filename identities are required before writing',()=>{
 const data=input();
 for(const changes of [{rawSha256:'0'.repeat(64)},{rawSha256:undefined},{sourceSkinSha256:'bad'},{sourceFile:'../source.png'},{sourceFile:'C:\\source.png'},{sourceFile:'https://example.invalid/source.png'},{sourceFile:'nested/source.png'},{sourceFile:'CON.png'},{pack:{...pack,materialAssets:[{assetId:ids[0]}]}}])assert.throws(()=>extractMaterialAtlas({...data,...changes}));
 assert.throws(()=>extractMaterialAtlas({...data,pack:{pack,manifestSha256:'b'.repeat(64)}}),/base skin/);
 const bytes=Buffer.from(json(template));assert.doesNotThrow(()=>extractMaterialAtlas({...data,template:{spec:template,bytes,sha256:hash(bytes)}}));
 assert.throws(()=>extractMaterialAtlas({...data,template:{spec:template,bytes,sha256:'0'.repeat(64)}}),/template identity/);
 const changed=structuredClone(template);changed.parts[0].bodyRect=[0,0,33,4];assert.throws(()=>extractMaterialAtlas({...data,template:changed}),/rectangle/);
});
test('empty slots fail; seam and excluded-pixel diagnostics do not repair visible source pixels',()=>{
 assert.throws(()=>extractMaterialAtlas(input({empty:ids[1]})),/empty/);
 const data=input({seam:true,outside:true}),{report}=extractMaterialAtlas(data);
 assert.equal(report.outsideBodyPixels,1);assert(report.warnings.some(w=>w.code==='material.tile-seam'));assert(report.warnings.some(w=>w.code==='material.outside-bodies'));
 assert.equal(hash(data.raw),data.rawSha256);
});
test('dirty invisible RGB creates a separate reproducible source while preserving every alpha and visible RGB byte',async()=>{
 const data=input({dirty:true});data.image.pixels.set([31,45,67,0],(3*data.image.width+12)*4);data.raw=encodePng(data.image);data.rawSha256=hash(data.raw);
 const original=Buffer.from(data.raw),directory=await mkdtemp(join(tmpdir(),'ui-material-normalization-')),output=join(directory,'extracted');
 const result=await materializeMaterialAtlas({output,...data}),{spec,report}=result,derivedRaw=await readFile(join(output,'derived-source.png')),derived=decodePng(derivedRaw);
 assert.deepEqual(data.raw,original);assert.deepEqual(await readFile(join(output,'source.png')),original);
 assert.equal(report.source.sha256,data.rawSha256);assert.deepEqual(report.originalSource,report.source);assert.equal(report.derivedSource.sha256,hash(derivedRaw));
 assert.deepEqual(report.normalization,{operation:'zero-rgb-at-alpha-zero',changedInvisibleRgbPixels:2,visibleRgbChanges:0,alphaChanges:0});
 assert.equal(derived.transparentRgbPixels,0);assert(spec.materials.every(m=>m.file==='derived-source.png'&&m.sha256===hash(derivedRaw)));
 let changes=0;
 for(let i=0;i<data.image.pixels.length;i+=4){
  assert.equal(derived.pixels[i+3],data.image.pixels[i+3]);
  if(data.image.pixels[i+3])assert.deepEqual(derived.pixels.subarray(i,i+3),data.image.pixels.subarray(i,i+3));
  else{assert.deepEqual([...derived.pixels.subarray(i,i+3)],[0,0,0]);if(data.image.pixels.subarray(i,i+3).some(n=>n))changes++;}
 }
 assert.equal(changes,report.normalization.changedInvisibleRgbPixels);assert(derived.pixels.some((n,i)=>i%4===3&&n===128));
 await verifyMaterialAtlas({directory:output,...data});
 const tampered=decodePng(derivedRaw);tampered.pixels[(2*derived.width+2)*4]++;
 await writeFile(join(output,'derived-source.png'),encodePng(tampered));await assert.rejects(()=>verifyMaterialAtlas({directory:output,...data}),/normalization replay/);
 await writeFile(join(output,'derived-source.png'),derivedRaw);
 const wrong=structuredClone(report);wrong.normalization.changedInvisibleRgbPixels++;await writeFile(result.reportPath,json(wrong));await assert.rejects(()=>verifyMaterialAtlas({directory:output,...data}),/replay differs/);
});
test('clean original inputs retain their byte identity, manifest source and extraction report shape',async()=>{
 const data=input(),directory=await mkdtemp(join(tmpdir(),'ui-material-clean-')),output=join(directory,'extracted'),result=await materializeMaterialAtlas({output,...data});
 assert(result.spec.materials.every(m=>m.file==='source.png'&&m.sha256===data.rawSha256));
 assert.equal(result.report.originalSource,undefined);assert.equal(result.report.derivedSource,undefined);assert.equal(result.report.normalization,undefined);
 assert.deepEqual((await readdir(output)).sort(),['materials.json','report.json','source.png']);assert.deepEqual(await readFile(join(output,'source.png')),data.raw);
});
test('an opaque whole-canvas return is rejected even through the material candidate extractor',()=>{
 const data=input(),raw=encodePng({width:32,height:32,pixels:Buffer.alloc(32*32*4,255)});
 assert.throws(()=>extractMaterialAtlas({...data,raw,rawSha256:hash(raw)}),/transparent gutter|opaque background/);
 // Fully opaque pixels inside the assigned fill slot are still valid material.
 assert.equal(extractMaterialAtlas(data).report.parts[2].opaquePixels,12*12);
});
test('exclusive materialization retains raw bytes and replay detects changed input, report or source',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ui-material-atlas-')),data=input(),output=join(directory,'extracted'),result=await materializeMaterialAtlas({output,...data});
 assert.equal(result.configPath,join(output,'materials.json'));assert.deepEqual(await readFile(join(output,'source.png')),data.raw);
 await assert.rejects(()=>materializeMaterialAtlas({output,...data}),{code:'EEXIST'});
 await verifyMaterialAtlas({directory:output,...data});
 const report=await readFile(result.reportPath);await writeFile(result.reportPath,json({...result.report,modelCalls:1}));
 await assert.rejects(()=>verifyMaterialAtlas({directory:output,...data}),/replay differs/);await writeFile(result.reportPath,report);
 const config=await readFile(result.configPath);await writeFile(result.configPath,json({...result.spec,sourceSkinSha256:'c'.repeat(64)}));
 await assert.rejects(()=>verifyMaterialAtlas({directory:output,...data}),/replay differs/);await writeFile(result.configPath,config);
 await writeFile(join(output,'source.png'),atlas({scale:2}).raw);await assert.rejects(()=>verifyMaterialAtlas({directory:output,...data}),/digest differs/);
});
test('material producer output imports through the existing skin extension and verifies byte-exact S05 provenance',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ui-material-atlas-pack-')),fixture=await materialSkinFixture(join(directory,'base')),base=await verifySkinPackage(fixture.packageDirectory),data=atlas({disconnected:false});
 const extracted=await materializeMaterialAtlas({raw:data.raw,rawSha256:data.rawSha256,template,sourceSkinSha256:base.manifestSha256,pack:base,output:join(directory,'extracted')});
 const result=await extendSkinMaterials({packageDirectory:fixture.packageDirectory,configPath:extracted.configPath,output:join(directory,'decorated')}),verified=await verifySkinPackage(result.packageDirectory);
 assert.equal(verified.pack.materialAssets.length,3);assert.equal(verified.pack.assets.length,base.pack.assets.length);
 for(const material of verified.pack.materialAssets){assert.equal(material.source.sha256,data.rawSha256);assert.deepEqual(verified.resources.get(material.source.file),data.raw);assert.deepEqual(decodePng(verified.resources.get(material.file)).pixels,cropPng(data.image,material.source.crop).pixels);}
 for(const [file,bytes]of base.resources)assert.deepEqual(verified.resources.get(file),bytes);
 assert.equal(result.modelCalls,0);assert.equal(verified.pack.surfaceStyles.title.baseMode,'replace');assert.equal(verified.pack.surfaceStyles.panel.layers[0].assetId,ids[2]);
});
