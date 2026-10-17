import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {encodePng} from '../src/skins/png.mjs';
import {hash,json} from '../src/skins/package.mjs';
import {extractMaterialAtlas,materializeMaterialAtlas,verifyMaterialAtlas} from '../src/skins/material-atlas.mjs';
const template={kind:'ui_material_template',version:'1.0',sheetId:'S05',coordinates:{width:32,height:32,outputScale:1},parts:[
 {assetId:'material.title-band',slotRect:[1,1,30,6],bodyRect:[2,2,28,4],stretch:'horizontal',purpose:'title'},
 {assetId:'material.section-band',slotRect:[1,9,30,5],bodyRect:[2,10,28,3],stretch:'horizontal',purpose:'section'},
 {assetId:'material.panel-fill',slotRect:[1,17,14,14],bodyRect:[2,18,12,12],stretch:'tile',purpose:'panel'}]};
function input({mismatch=false,transparent=false}={}){
 const image={width:32,height:32,pixels:Buffer.alloc(32*32*4)};
 for(const part of template.parts){const [x,y,w,h]=part.bodyRect;
  for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)image.pixels.set([30,75,92,255],(py*32+px)*4);
 }
 for(let y=18;y<30;y++){
  if(mismatch)image.pixels.set([240,230,210,255],(y*32+13)*4);
  if(transparent)image.pixels.set([0,0,0,0],(y*32+2)*4);
 }
 const raw=encodePng(image),pack={roles:[{role:'skin.surface.bar',assetId:'bar'},{role:'skin.surface.panel',assetId:'panel'}],
  assets:['bar','panel'].map(assetId=>({assetId,contentInsets:{left:12,right:12,top:4,bottom:4},nineSlice:{left:3,right:3,top:3,bottom:3},minSize:{width:25,height:9}})),
  theme:{textColors:{'skin.surface.bar':'#111827','skin.surface.panel':'#123456'}}};
 return {raw,rawSha256:hash(raw),template,sourceSkinSha256:'a'.repeat(64),pack};
}
test('repeat-compatible opaque material keeps native tiling and its existing overlay recipe',()=>{
 const {spec,report}=extractMaterialAtlas(input());
 assert.equal(report.version,'1.2');assert.equal(report.panelPresentation.mode,'tile');
 assert.equal(report.panelPresentation.reason,'repeat-compatible-edges');
 assert.deepEqual(spec.surfaceStyles.panel.layers[0],{assetId:'material.panel-fill',mode:'tile',scale:1,alpha:.14,blendMode:'multiply'});
 assert.equal(spec.surfaceStyles.panel.textColor,'#123456');
});
test('a whole illustration with incompatible opposite edges uses one cover without editing its source or crop',()=>{
 const data=input({mismatch:true}),before=Buffer.from(data.raw),modern=extractMaterialAtlas(data),old=extractMaterialAtlas({...data,extractionVersion:'1.1'});
 assert.equal(modern.spec.surfaceStyles.panel.layers[0].mode,'cover');assert.equal(modern.report.panelPresentation.reason,'opposite-edges-differ');
 assert.equal(old.spec.surfaceStyles.panel.layers[0].mode,'tile');assert.equal(old.report.panelPresentation,undefined);
 assert.deepEqual(modern.spec.materials,old.spec.materials);assert.deepEqual(data.raw,before);
 const expected=structuredClone(old.spec);expected.surfaceStyles.panel.layers[0].mode='cover';assert.deepEqual(modern.spec,expected);
 assert.equal(modern.report.visualAcceptance,'unreviewed');assert.equal(modern.report.productionReady,false);
});
test('transparent edges select cover even when their opposite edge differences are small',()=>{
 const data=input();const image={width:32,height:32,pixels:Buffer.alloc(32*32*4)};
 for(const part of template.parts){const [x,y,w,h]=part.bodyRect;for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)image.pixels.set([30,75,92,255],(py*32+px)*4);}
 for(let y=18;y<30;y++)for(const x of [2,13])image.pixels.set([0,0,0,0],(y*32+x)*4);
 const raw=encodePng(image),{spec,report}=extractMaterialAtlas({...data,raw,rawSha256:hash(raw)});
 assert.equal(spec.surfaceStyles.panel.layers[0].mode,'cover');assert.equal(report.panelPresentation.reason,'transparent-edge');assert(report.panelPresentation.transparentEdgePixels>0);
});
test('historical 1.0 and 1.1 reports replay unchanged; 1.2 presentation evidence cannot be forged',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'ui-material-presentation-')),data=input({mismatch:true});
 for(const extractionVersion of ['1.0','1.1','1.2']){
  const directory=join(parent,extractionVersion),saved=await materializeMaterialAtlas({output:directory,...data,extractionVersion});
  const before=await readFile(saved.reportPath);await verifyMaterialAtlas({directory,...data});assert.deepEqual(await readFile(saved.reportPath),before);
  if(extractionVersion==='1.2'){
   const wrong=structuredClone(saved.report);wrong.panelPresentation.mode='tile';await writeFile(saved.reportPath,json(wrong));
   await assert.rejects(()=>verifyMaterialAtlas({directory,...data}),/replay differs/);
  }else assert.equal(saved.report.panelPresentation,undefined);
 }
});
