import test from 'node:test';
import assert from 'node:assert/strict';
import {readStudioState} from '../src/studio/panel-completion.mjs';

test('a job becoming ready during library verification is present in the matching navigation catalog',async()=>{
 const artifact={id:'panel-finished',type:'panel',url:'/artifacts/panel-finished/preview.html'},items=[],calls=[];
 const get=async url=>{
  calls.push(url);
  if(url==='/library.json'){
   // The server publishes the verified artifact while assembling this response.
   await new Promise(resolve=>setImmediate(resolve));items.push(artifact);
   return {projects:[{id:'project',panels:[{id:'finished',status:'ready',artifact}]}]};
  }
  return {items:structuredClone(items)};
 };
 const {library,catalog}=await readStudioState(get);
 assert.deepEqual(calls,['/library.json','/catalog.json']);
 for(const job of library.projects[0].panels)assert(catalog.items.some(item=>item.id===job.artifact.id));
});

test('failed library verification does not fetch a catalog detached from the project state',async()=>{
 const calls=[];
 await assert.rejects(()=>readStudioState(async url=>{calls.push(url);throw Error('library unavailable');}),/library unavailable/);
 assert.deepEqual(calls,['/library.json']);
});
