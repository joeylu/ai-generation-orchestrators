import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeStudioJson} from '../src/studio/atomic-write.mjs';

test('a transient Windows sharing violation cannot lose the ready state or repeat generation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'studio-atomic-')),file=join(dir,'flow.json');
 try{
  await writeFile(file,JSON.stringify({status:'running'}));let attempts=0,temporary;
  const ready={status:'ready',artifact:{id:'received-once'}};
  await writeStudioJson(file,ready,{pause:async()=>{},replace:async(source,target)=>{
   assert.equal(JSON.parse(await readFile(target)).status,'running');
   assert.deepEqual(JSON.parse(await readFile(source)),ready);
   if(temporary)assert.equal(source,temporary);temporary=source;
   if(++attempts<3)throw Object.assign(Error('File temporarily shared'),{code:'EPERM'});
   await rename(source,target);
  }});
  assert.equal(attempts,3);assert.deepEqual(JSON.parse(await readFile(file)),ready);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a permanent replacement failure keeps the prior committed document and is bounded',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'studio-atomic-fail-')),file=join(dir,'flow.json');
 try{
  const original=Buffer.from('{"status":"prepared"}');await writeFile(file,original);let attempts=0;
  await assert.rejects(()=>writeStudioJson(file,{status:'ready'},{attempts:3,pause:async()=>{},replace:async()=>{attempts++;throw Object.assign(Error('locked'),{code:'EPERM'});}}),{code:'EPERM'});
  assert.equal(attempts,3);assert.deepEqual(await readFile(file),original);
 }finally{await rm(dir,{recursive:true,force:true});}
});
