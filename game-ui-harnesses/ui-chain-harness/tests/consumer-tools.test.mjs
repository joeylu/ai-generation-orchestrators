import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {inspectConsumer,consumerServer} from '../src/runtime/consumer-tools.mjs';
import {hash,json} from '../src/skins/package.mjs';
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'consumer-tools-')),files=[];for(const file of ['index.html','runtime.mjs','kit.json']){const data=file;await writeFile(join(dir,file),data);files.push({file,sha256:hash(Buffer.from(data))});}const manifest={kind:'ui_component_consumer_candidate',version:'0.1',components:16,files};await writeFile(join(dir,'manifest.json'),json(manifest));return {dir,manifest};}
test('inspection rejects modified files, unsafe paths, duplicate paths and changed pinned manifests',async()=>{
  const {dir,manifest}=await fixture(),snapshot=await inspectConsumer(dir);
  await assert.rejects(()=>inspectConsumer(dir,'0'.repeat(64)),/MANIFEST_CHANGED/);
  await writeFile(join(dir,'kit.json'),'changed');await assert.rejects(()=>inspectConsumer(dir),/FILE_CHANGED/);
  await writeFile(join(dir,'kit.json'),'kit.json');
  await writeFile(join(dir,'manifest.json'),json({...manifest,files:[...manifest.files,manifest.files[0]]}));await assert.rejects(()=>inspectConsumer(dir),/MANIFEST_INVALID/);
  await writeFile(join(dir,'manifest.json'),json({...manifest,files:[{file:'../outside',sha256:snapshot.manifestSha256}]}));await assert.rejects(()=>inspectConsumer(dir),/relative package path/);
});
test('preview serves verified snapshot only, correct module MIME, strict host/method/path',async()=>{
  const {dir}=await fixture(),snapshot=await inspectConsumer(dir);
  // Port zero is reserved here only for a test-selected port.
  const server=consumerServer(snapshot,0);await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const get=(path,host='127.0.0.1:0',method='GET')=>new Promise((resolve,reject)=>{const q=request({host:'127.0.0.1',port,path,method,headers:{Host:host}},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve({status:r.statusCode,type:r.headers['content-type'],body}));});q.on('error',reject);q.end();});
  try{
    await writeFile(join(dir,'runtime.mjs'),'mutated after startup');
    const module=await get('/runtime.mjs');assert.equal(module.status,200);assert.match(module.type,/javascript/);assert.equal(module.body,'runtime.mjs');
    assert.equal((await get('/','evil.example')).status,404);assert.equal((await get('/','127.0.0.1:0','POST')).status,404);
    for(const path of ['/../manifest.json','/%2e%2e/manifest.json','/kit.json?x=1','/missing'])assert.equal((await get(path)).status,404);
    assert.equal((await get('/','127.0.0.1:0','HEAD')).body,'');
  }finally{await new Promise(r=>server.close(r));}
});
