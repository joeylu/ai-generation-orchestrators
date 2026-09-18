import test from 'node:test';
import assert from 'node:assert/strict';
import {batchedLoopPersistence,runGenerationLoop} from '../src/ai_ui_decomposition/generation-loop.mjs';
test('batching preserves order and critical durable boundaries',async()=>{
  const batches=[],persist=batchedLoopPersistence(async b=>batches.push(b));
  await persist({event:'exchange'});assert.equal(batches.length,0);
  await persist({event:'invocation-intent'});
  assert.deepEqual(batches[0].events.map(e=>e.event),['exchange','invocation-intent']);
  await persist({event:'tool-returned',response:{complete:true}});
  assert.equal(batches.length,2);
  await persist({event:'result-ready'});await persist({event:'exchange'});
  await persist({event:'stopped'});
  assert.deepEqual(batches[2].events.map(e=>e.event),['result-ready','exchange','stopped']);
});
test('failed batch storage stops before generation and is never retried',async()=>{
  let writes=0,calls=0;
  const persist=batchedLoopPersistence(async()=>{writes++;throw Error('disk');});
  await assert.rejects(runGenerationLoop({maxCalls:1,persist,
    exchange:async()=>({nextRequest:{requestDigest:'a'.repeat(64),arguments:{prompt:'fixture'}}}),
    generate:async()=>{calls++;},resolveResult:async()=>'/fixture.png'}));
  assert.equal(calls,0);assert.equal(writes,1);
});
test('interrupt flushes buffered diagnostics',async()=>{
  const batches=[],persist=batchedLoopPersistence(async b=>batches.push(b));
  await persist({event:'result-ready'});await persist({event:'interrupted',automaticResubmit:false});
  assert.deepEqual(batches[0].events.map(e=>e.event),['result-ready','interrupted']);
});
