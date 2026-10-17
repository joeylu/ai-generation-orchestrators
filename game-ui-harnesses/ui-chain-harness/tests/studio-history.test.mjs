import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverPlans} from '../src/studio/history.mjs';
test('history handles absent, incomplete and changed batches without execution or repair',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-history-'));let called=0;
 const generation={register(){called++;throw Error('invalid batch must not register');}};
 try{
  assert.deepEqual(await discoverPlans(root,generation),{plans:[],truncated:false});
  const dir=join(root,'work/studio/projects','a'.repeat(36));await mkdir(dir,{recursive:true});
  assert.equal((await discoverPlans(root,generation)).plans[0].status,'incomplete');
  const batch=join(dir,'batches','b'.repeat(64));await mkdir(batch,{recursive:true});await writeFile(join(batch,'batch.json'),'{}');
  assert.equal((await discoverPlans(root,generation)).plans[0].status,'invalid');assert.equal(called,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
