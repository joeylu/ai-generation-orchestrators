import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {automaticProcessing} from '../src/studio/auto-process.mjs';
import {generationController} from '../src/studio/generation.mjs';
import {sampledTextTheme} from '../src/studio/theme.mjs';
import {encodePng} from '../src/skins/png.mjs';
import {resolveStyle} from '../src/studio/styles.mjs';
import {hash} from '../src/skins/package.mjs';

test('automatic processing coalesces notifications and restores the same binding after restart without generation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-auto-'));
 try{
  const dir=join(root,'work/project');await mkdir(dir,{recursive:true});await writeFile(join(dir,'project.json'),JSON.stringify({automaticProcessing:true}));
  let received=3,calls=0;const generation={resolve:()=>({directory:'work/project/batches/a',batchSha256:'a'}),action:async()=>({nodes:['S01','S02','S03','S04'].map((sheetId,i)=>({sheetId,status:i<received?'received':'failed'}))})};
  const pipeline={processAutomatically:async id=>{assert.equal(id,'id');calls++;return {status:'started'};}};
  const auto=automaticProcessing(root,generation,pipeline);await auto('id');assert.equal(calls,0);
  received=4;await Promise.allSettled([auto('id'),auto('id'),auto('id')]);assert.equal(calls,1);
  await automaticProcessing(root,generation,pipeline)('id');assert.equal(calls,2);
  assert.equal(JSON.parse(await readFile(join(dir,'auto-process.json'))).batchSha256,'a');
  generation.resolve=()=>({directory:'work/project/batches/b',batchSha256:'b'});
  await assert.rejects(auto('id'),/BATCH_CHANGED/);assert.equal(calls,2);auto.close();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('legacy projects do not silently opt into automatic deterministic work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-old-'));try{await mkdir(join(root,'work/project'),{recursive:true});await writeFile(join(root,'work/project/project.json'),'{}');let calls=0;await automaticProcessing(root,{resolve:()=>({directory:'work/project/batches/a'}),action:async()=>{calls++;}},{action:()=>{calls++;}})('id');assert.equal(calls,0);}finally{await rm(root,{recursive:true,force:true});}
});
test('full batch and supplemental completion notify local processing without resubmitting generation',async()=>{
 let generated=0,notified=0;
 const gen=generationController({inspect:async()=>({fresh:!generated,nodes:[]}),preflight:async()=>{},execute:async()=>{generated++;},prepareOne:async()=>({sheetId:'S02',planSha256:'sheet'}),executeOne:async()=>{generated++;}});
 gen.onSettled(async()=>{notified++;});const id=gen.register({batchSha256:'batch'}),token=(await gen.action('preflight',{id})).token;
 await gen.action('start',{id,token,confirmed:'batch'});await new Promise(r=>setImmediate(r));assert.equal(generated,1);assert.equal(notified,1);
 const one=await gen.action('supplement-prepare',{id,sheetId:'S02'});await gen.action('supplement-start',{id,sheetId:'S02',confirmed:'sheet',token:one.token});await new Promise(r=>setImmediate(r));assert.equal(generated,2);assert.equal(notified,2);
 await gen.action('status',{id});assert.equal(notified,2);
});
test('text tone comes from opaque surface sample, ignores transparent RGB and refuses empty samples',()=>{
 const part={assetId:'surface.panel',bodyRect:[0,0,64,64]},canvas={width:64,height:64};
 const raw=(v,a)=>encodePng({width:64,height:64,pixels:Uint8Array.from({length:64*64*4},(_,i)=>i%4===3?a:v)});
 assert.equal(sampledTextTheme(raw(10,255),part,canvas).text,'#F5F7FF');assert.equal(sampledTextTheme(raw(240,255),part,canvas).text,'#151923');
 assert.throws(()=>sampledTextTheme(raw(255,0),part,canvas),/SAMPLE_EMPTY/);
});
test('preset input requires matching revision and exact preview bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-style-'));
 try{await mkdir(join(root,'configs'));await mkdir(join(root,'assets'));const bytes=Buffer.from('fixture');await writeFile(join(root,'assets/ref.png'),bytes);await writeFile(join(root,'configs/studio-styles.json'),JSON.stringify({entries:[{id:'style-a',revision:'1',image:'assets/ref.png',sha256:hash(bytes)}]}));
  const p={style:{id:'style-a',revision:'1'},reference:{sha256:hash(bytes)}};assert.equal((await resolveStyle(root,p)).id,'style-a');await assert.rejects(resolveStyle(root,{...p,reference:{sha256:'changed'}}),/CHANGED/);await assert.rejects(resolveStyle(root,{...p,style:{id:'style-a',revision:'2'}}),/CHANGED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
