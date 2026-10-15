import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectStudioTasks,validateTasks} from '../src/studio/tasks.mjs';
test('Studio task reads do not create receipts; tool changes and corrupt records block recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-tasks-')),directory=join(root,'work/skin-tasks/demo');
 try{
  await mkdir(directory,{recursive:true});
  const req={graph:{version:'1.0',automaticProviderCalls:false,nodes:[{id:'source',kind:'source',dependsOn:[]}]},inputs:[],toolSha256:'same'};
  await writeFile(join(directory,'request.json'),JSON.stringify(req));
  const entries=[{id:'demo',name:'Demo',directory:'work/skin-tasks/demo'}];
  assert.equal((await inspectStudioTasks(root,entries,async()=>'same'))[0].recovery,'available');
  assert.equal((await inspectStudioTasks(root,entries,async()=>'changed'))[0].recovery,'tools-changed');
  assert.deepEqual(await readdir(directory),['request.json']);
  await writeFile(join(directory,'request.json'),'{}');
  assert.equal((await inspectStudioTasks(root,entries,async()=>'same'))[0].recovery,'blocked');
  assert.throws(()=>validateTasks([{...entries[0],directory:'work/skin-tasks/../../private'}]),/INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
