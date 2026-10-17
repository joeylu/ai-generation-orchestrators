import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateDag,resumeTask,taskStatus} from '../src/skins/task-dag.mjs';
const graph={version:'1.0',automaticProviderCalls:false,nodes:[{id:'a',kind:'source',dependsOn:[]},{id:'b',kind:'source',dependsOn:[]},{id:'join',kind:'locate',dependsOn:['a','b']}]};
async function fixture(fn){const d=await mkdtemp(join(tmpdir(),'skin-dag-'));try{await mkdir(join(d,'receipts'));await writeFile(join(d,'request.json'),JSON.stringify({graph,inputs:[]}));await fn(d);}finally{await rm(d,{recursive:true,force:true});}}
test('rejects cycles, missing dependencies and provider node kinds',()=>{
  assert.throws(()=>validateDag({...graph,nodes:[{id:'a',kind:'source',dependsOn:['a']}]}));
  assert.throws(()=>validateDag({...graph,nodes:[{id:'generate',kind:'provider',dependsOn:[]}]}));
  assert.throws(()=>validateDag({...graph,automaticProviderCalls:true}));
});
test('resume reuses committed independent nodes, joins only after all dependencies and never reruns completion',async()=>fixture(async d=>{
  const calls=[];let fail=true;
  const options={verify:async()=>{},assertTools:async()=>{},execute:async n=>{calls.push(n.id);if(n.id==='b'&&fail)throw Error('interrupted');return{outputs:{id:n.id},files:[]};}};
  await assert.rejects(resumeTask(d,options),/interrupted/);assert.deepEqual(calls,['a','b']);
  assert.equal((await taskStatus(d,options.verify)).status,'failed-retryable');
  fail=false;const r=await resumeTask(d,options);assert.equal(r.status,'awaiting-visual-review');assert.deepEqual(calls,['a','b','b','join']);
  await resumeTask(d,options);assert.deepEqual(calls,['a','b','b','join']);
}));
test('changed input or output evidence and tool versions block resume',async()=>fixture(async d=>{
  const options={verify:async()=>{},assertTools:async()=>{},execute:async()=>({outputs:{},files:[{file:'asset',sha256:'expected'}]})};
  await resumeTask(d,{...options,until:'a'});
  await assert.rejects(taskStatus(d,async f=>{if(f.length)throw Error('changed');}),/changed/);
  await assert.rejects(resumeTask(d,{...options,assertTools:async()=>{throw Error('tools changed');}}),/tools changed/);
}));
test('receipt dependencies cannot be relabeled or bypassed',async()=>fixture(async d=>{
  const options={verify:async()=>{},assertTools:async()=>{},execute:async()=>({outputs:{},files:[]})};await resumeTask(d,options);
  const path=join(d,'receipts/join.json'),r=JSON.parse(await readFile(path));r.dependencies.a='wrong';await writeFile(path,JSON.stringify(r));
  await assert.rejects(taskStatus(d,options.verify),/receipt-binding/);
}));
