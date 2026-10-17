import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generationController} from '../src/studio/generation.mjs';
test('verified historical image blocks a new supplement token and directs the user to zero-compute recovery',async()=>{
 let calls=0;const g=generationController({inspect:async()=>({nodes:[]}),preflight:async()=>{},prepareOne:async()=>{throw Error('GENERATION_RECOVERABLE_IMAGE');},executeOne:async()=>calls++});
 const id=g.register({batchSha256:'batch'});await assert.rejects(g.action('supplement-prepare',{id,sheetId:'S01'}),/RECOVERABLE_IMAGE/);
 await assert.rejects(g.action('supplement-start',{id,sheetId:'S01',token:'made-up',confirmed:'made-up'}),/CONFIRMATION_REQUIRED/);assert.equal(calls,0);
});

test('single-sheet UI confirmation is bound to prepared sheet, digest and single-use token',async()=>{
 let calls=0,finish;const g=generationController({inspect:async()=>({nodes:[]}),preflight:async()=>{},prepareOne:async(_,sheetId)=>({sheetId,planSha256:'new-digest'}),executeOne:async()=>{calls++;await new Promise(r=>finish=r);}});
 const id=g.register({batchSha256:'old'}),p=await g.action('supplement-prepare',{id,sheetId:'S02'});
 assert.equal(calls,0);
 await assert.rejects(g.action('supplement-start',{id,sheetId:'S01',token:p.token,confirmed:p.planSha256}));
 await assert.rejects(g.action('supplement-start',{id,sheetId:'S02',token:p.token,confirmed:'wrong'}));
 await g.action('supplement-start',{id,sheetId:'S02',token:p.token,confirmed:p.planSha256});
 await assert.rejects(g.action('supplement-start',{id,sheetId:'S02',token:p.token,confirmed:p.planSha256}));
 await assert.rejects(g.action('supplement-prepare',{id,sheetId:'S02'}));assert.equal(calls,1);
 finish();await new Promise(r=>setImmediate(r));
 await assert.rejects(g.action('supplement-start',{id,sheetId:'S02',token:p.token,confirmed:p.planSha256}));
});

test('explicit recovery checks unknown sheets only and never invokes compute',async()=>{
 let calls=0;const nodes=[{sheetId:'S01',status:'received'},{sheetId:'S02',status:'indeterminate'},{sheetId:'S04',status:'indeterminate'}];
 const g=generationController({inspect:async()=>({fresh:false,nodes}),preflight:async()=>calls++,execute:async()=>calls++,recover:async(_,sheet)=>{if(sheet==='S02')throw Error('missing');nodes.find(n=>n.sheetId===sheet).status='received';}});
 const id=g.register({batchSha256:'digest'}),r=await g.action('recover',{id});
 assert.equal(calls,0);assert.equal(r.providerCalls,0);assert.deepEqual(r.recoveryResults.map(r=>r.recovered),[false,true]);
 assert.equal(nodes[0].status,'received');assert.equal(nodes[1].status,'indeterminate');assert.equal(nodes[2].status,'received');
 await assert.rejects(g.action('preflight',{id}));assert.equal(calls,0);
});
test('generation requires preflight and exact fresh confirmation; duplicate and unknown outcomes never retry',async()=>{
 let calls=0,fresh=true,finish;
 const g=generationController({inspect:async()=>({fresh,nodes:[]}),preflight:async()=>{},execute:async()=>{calls++;fresh=false;await new Promise(r=>finish=r);throw Error('unknown');}});
 const id=g.register({batchSha256:'digest'});
 assert.equal(g.register({batchSha256:'digest'}),id);
 await assert.rejects(()=>g.action('start',{id,confirmed:'digest'}));assert.equal(calls,0);
 const p=await g.action('preflight',{id});assert.equal(calls,0);
 await assert.rejects(()=>g.action('start',{id,token:p.token,confirmed:'wrong'}));
 await g.action('start',{id,token:p.token,confirmed:'digest'});
 assert.equal(g.register({batchSha256:'digest'}),id);
 await assert.rejects(()=>g.action('start',{id,token:p.token,confirmed:'digest'}));assert.equal(calls,1);
 finish();await new Promise(r=>setImmediate(r));
 assert.equal((await g.action('status',{id})).operation,'stopped-no-retry');
 await assert.rejects(()=>g.action('preflight',{id}));assert.equal(calls,1);
});
test('changed plans after preflight prevent execution',async()=>{
 let fresh=true,calls=0;const g=generationController({inspect:async()=>({fresh}),preflight:async()=>{},execute:async()=>calls++});const id=g.register({batchSha256:'digest'});
 const p=await g.action('preflight',{id});fresh=false;
 await assert.rejects(()=>g.action('start',{id,token:p.token,confirmed:'digest'}));assert.equal(calls,0);
});
test('fresh controller after restart still refuses a consumed batch from disk inspection',async()=>{
 let calls=0;const g=generationController({inspect:async()=>({fresh:false,nodes:[{status:'reserved-outcome-unknown'}]}),preflight:async()=>calls++,execute:async()=>calls++});
 const id=g.register({directory:'saved',batchSha256:'digest'});
 await assert.rejects(()=>g.action('preflight',{id}));assert.equal(calls,0);
 assert.equal((await g.action('status',{id})).nodes[0].status,'reserved-outcome-unknown');
});
