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
