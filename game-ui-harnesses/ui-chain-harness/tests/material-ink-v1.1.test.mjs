import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {encodePng} from '../src/skins/png.mjs';
import {hash,json} from '../src/skins/package.mjs';
import {textReadabilityPolicy} from '../src/skins/text-readability.mjs';
import {extractMaterialAtlas,materializeMaterialAtlas,verifyMaterialAtlas} from '../src/skins/material-atlas.mjs';

const ids=['material.title-band','material.section-band','material.panel-fill'];
const template={kind:'ui_material_template',version:'1.0',sheetId:'S05',coordinates:{width:32,height:32,outputScale:1},parts:[
 {assetId:ids[0],slotRect:[1,1,30,6],bodyRect:[2,2,28,4],stretch:'horizontal',purpose:'title'},
 {assetId:ids[1],slotRect:[1,9,30,5],bodyRect:[2,10,28,3],stretch:'horizontal',purpose:'section'},
 {assetId:ids[2],slotRect:[1,17,14,14],bodyRect:[2,18,12,12],stretch:'tile',purpose:'panel'}]};
function input({centerAlpha=255,mixed=false}={}){
 const image={width:32,height:32,pixels:Buffer.alloc(32*32*4)};
 for(const [i,part]of template.parts.entries()){
  const [x,y,w,h]=part.bodyRect;
  for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++){
   let rgba=i===0?[30,75,92,255]:[244,235,210,255];
   if(i===0&&px>=x+Math.floor(w*.3)&&px<=x+Math.floor(w*.7)){rgba=[...rgba.slice(0,3),centerAlpha];if(mixed)rgba=px%2?[0,0,0,255]:[255,255,255,255];}
   image.pixels.set(rgba,(py*image.width+px)*4);
  }
 }
 const raw=encodePng(image),pack={roles:[{role:'skin.surface.bar',assetId:'bar'},{role:'skin.surface.panel',assetId:'panel'}],
  assets:['bar','panel'].map(assetId=>({assetId,contentInsets:{left:12,right:12,top:4,bottom:4},nineSlice:{left:3,right:4,top:2,bottom:3},minSize:{width:25,height:9}})),
  theme:{textColors:{'skin.surface.bar':'#111827','skin.surface.panel':'#123456'}}};
 return {raw,rawSha256:hash(raw),template,sourceSkinSha256:'a'.repeat(64),pack};
}
test('new S05 defaults choose each actual replacement material ink while panel overlay keeps its original role ink',()=>{
 const data=input(),before=json(data.pack),result=extractMaterialAtlas(data),styles=result.spec.surfaceStyles;
 assert.equal(result.report.version,'1.1');assert.equal(styles.title.textColor,'#F5F7FF');assert.equal(styles.section.textColor,'#111827');
 assert.equal(styles.panel.textColor,'#123456');assert.equal(styles.panel.layers[0].alpha,.14);assert.equal(styles.panel.layers[0].blendMode,'multiply');
 assert.equal(json(data.pack),before);assert.equal(result.report.textReadability.status,'needs-review');assert.equal(result.report.textReadability.sourceSamplingStatus,'passed');
 const checks=result.report.textReadability.checks;assert.equal(checks.length,2);assert(checks.every(c=>c.colorSource==='derived-material'&&c.status==='passed'));
 assert.deepEqual(checks[0].sourceCrop,template.parts[0].bodyRect);assert.equal(checks[0].sourceSha256,data.rawSha256);
 assert.equal(hash(data.raw),data.rawSha256);assert.equal(result.spec.version,'1.0');
});
test('explicit existing surface recipe colors are preserved and assessed independently from automatic role defaults',()=>{
 const data=input();data.pack.surfaceStyles={title:{baseRole:'skin.surface.bar',textColor:'#123456',layers:[]},section:{baseRole:'skin.surface.bar',textColor:'#FEDCBA',layers:[]}};
 const {spec,report}=extractMaterialAtlas(data);assert.equal(spec.surfaceStyles.title.textColor,'#123456');assert.equal(spec.surfaceStyles.section.textColor,'#FEDCBA');
 assert(report.textReadability.checks.every(c=>c.colorSource==='explicit-surface-style'));assert.equal(report.textReadability.sourceSamplingStatus,'needs-review');
});
test('a transparent central text zone cannot claim a sampled color or a passing material check',()=>{
 const data=input({centerAlpha:100}),{spec,report}=extractMaterialAtlas(data),title=report.textReadability.checks[0];
 assert.equal(spec.surfaceStyles.title.textColor,'#111827');assert.equal(title.colorSource,'base-role-fallback');assert.equal(title.samples,0);assert(title.transparentSamples>0);
 assert.equal(title.status,'needs-review');assert.equal(report.textReadability.sourceSamplingStatus,'needs-review');
});
test('mixed bright and dark material evidence stays needs-review without synthesizing outlines or editing pixels',()=>{
 const data=input({mixed:true}),before=Buffer.from(data.raw),{spec,report}=extractMaterialAtlas(data),title=report.textReadability.checks[0];
 assert.equal(title.status,'needs-review');assert(title.minimumContrast<4.5);assert.equal(report.visualAcceptance,'unreviewed');assert.equal(report.productionReady,false);
 assert.equal(spec.surfaceStyles.title.stroke,undefined);assert.equal(title.stroke,undefined);assert.deepEqual(data.raw,before);
});
test('legacy explicit version retains inherited role ink and exact historical readability report shape',()=>{
 const {spec,report}=extractMaterialAtlas({...input(),extractionVersion:'1.0'});
 assert.equal(report.version,'1.0');assert.equal(spec.surfaceStyles.title.textColor,'#111827');assert.equal(spec.surfaceStyles.section.textColor,'#111827');
 assert.deepEqual(Object.keys(report.textReadability),['status','reason','insets']);assert.equal(report.textReadability.reason,'Base skin text insets and ink are preserved; material composites require visual acceptance.');
 assert.throws(()=>extractMaterialAtlas({...input(),extractionVersion:'9.0'}),/Unsupported material extraction version/);
});
test('verification selects legacy or current extraction from its frozen report and detects version/check tampering',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ui-material-ink-'));
 for(const extractionVersion of ['1.0','1.1']){
  const data=input(),output=join(directory,extractionVersion),saved=await materializeMaterialAtlas({output,...data,extractionVersion});
  // A caller cannot reinterpret an existing report using a different default.
  await verifyMaterialAtlas({directory:output,...data});
  const bytes=await readFile(saved.reportPath),wrong=structuredClone(saved.report);wrong.version=extractionVersion==='1.0'?'1.1':'1.0';
  await writeFile(saved.reportPath,json(wrong));await assert.rejects(()=>verifyMaterialAtlas({directory:output,...data}),/replay differs/);await writeFile(saved.reportPath,bytes);
  if(extractionVersion==='1.1'){
   const wrongCheck=structuredClone(saved.report);wrongCheck.textReadability.checks[0].minimumContrast++;
   await writeFile(saved.reportPath,json(wrongCheck));await assert.rejects(()=>verifyMaterialAtlas({directory:output,...data}),/replay differs/);await writeFile(saved.reportPath,bytes);
  }
 }
});
test('version 1.1 replays after current role-ink policy values change',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'ui-material-ink-policy-')),data=input(),output=join(directory,'retained');
 const saved=await materializeMaterialAtlas({output,...data}),before=json(saved.report),prior=structuredClone(textReadabilityPolicy);
 try{
  Object.assign(textReadabilityPolicy,{light:'#FFFFFF',dark:'#000000',sampleGrid:3,minimumContrast:21,minimumOpaqueSamples:99,minimumAlpha:255});
  const replay=extractMaterialAtlas(data);assert.equal(json(replay.report),before);
  await verifyMaterialAtlas({directory:output,...data});
 }finally{Object.assign(textReadabilityPolicy,prior);}
});
