import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectAssembly} from '../src/skins/postprocess.mjs';
import {encodePng} from '../src/skins/png.mjs';
import {hash} from '../src/skins/package.mjs';

test('postprocess diagnoses delivered padding without editing cuts; changed source and missing parts fail',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'skin-postprocess-'));
  try{
    const image={width:32,height:16,pixels:Buffer.alloc(32*16*4,255)},png=encodePng(image);
    await writeFile(join(dir,'source.png'),png);
    const template={coordinates:{outputScale:1},sheets:[{id:'S01',parts:[{assetId:'panel',bodyRect:[0,0,32,32],stretch:'nine-slice'}]}]},bytes=Buffer.from(JSON.stringify(template));
    const config={templateSha256:hash(bytes),parts:{panel:{file:'source.png',sha256:hash(png),metadata:{density:1,nineSlice:{left:2,top:2,right:2,bottom:2},contentInsets:{left:0,top:0,right:0,bottom:0},minSize:{width:8,height:8}}}}};
    const path=join(dir,'assembly.json'),original=JSON.stringify(config);await writeFile(path,original);
    const inputs={template,bytes:{template:bytes}},result=await inspectAssembly(path,inputs);
    assert.equal(result.automaticCutApplication,false);assert.ok(result.sheets[0].parts[0].warnings.some(s=>s.includes('透明留白')));
    assert.equal(await readFile(path,'utf8'),original);
    await writeFile(join(dir,'source.png'),encodePng({...image,pixels:Buffer.alloc(32*16*4,128)}));
    await assert.rejects(inspectAssembly(path,inputs),/Source digest differs/);
    await writeFile(path,JSON.stringify({...config,parts:{}}));
    await assert.rejects(inspectAssembly(path,inputs),/full asset coverage/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('inspection reuses the gradient fallback for field clearance and fingerprints its policy without rewriting cuts',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'skin-field-contour-'));
  try{
    const width=320,height=96,pixels=Buffer.alloc(width*height*4);
    for(let y=8;y<88;y++)for(let x=8;x<312;x++){
      const frame=x<13||x>=307||y<13||y>=83,shade=Math.round(200*(88-y)/80);
      pixels.set(frame?[160,12,18,255]:[235,30+shade,35+shade,255],(y*width+x)*4);
    }
    const png=encodePng({width,height,pixels});await writeFile(join(dir,'field.png'),png);
    const template={coordinates:{outputScale:1},sheets:[{id:'S02',parts:[{assetId:'field.focused',bodyRect:[0,0,width,height],stretch:'nine-slice'}]}]},bytes=Buffer.from(JSON.stringify(template));
    const config={templateSha256:hash(bytes),parts:{'field.focused':{file:'field.png',sha256:hash(png),metadata:{density:4,nineSlice:{left:7,top:7,right:7,bottom:7},contentInsets:{left:8,top:8,right:8,bottom:8},minSize:{width:17,height:17}}}}};
    const path=join(dir,'assembly.json'),original=JSON.stringify(config);await writeFile(path,original);
    const result=await inspectAssembly(path,{template,bytes:{template:bytes}}),part=result.sheets[0].parts[0];
    assert.equal(part.suggestion.method,'filled-contour-v1');assert.ok(part.suggestion.strictRejection);
    assert.equal(part.contentInsetSuggestion.status,'suggested');assert.equal(part.contentInsetSuggestion.basis,'filled-contour-v1');
    assert.match(result.metadataPolicySha256,/^[a-f0-9]{64}$/);assert.equal(result.visualAcceptance,'unreviewed');
    assert.equal(await readFile(path,'utf8'),original);assert.deepEqual(await readFile(join(dir,'field.png')),png);
  }finally{await rm(dir,{recursive:true,force:true});}
});
