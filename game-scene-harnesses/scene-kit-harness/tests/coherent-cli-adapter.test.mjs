import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {createCoherentImageAdapter} from '../scripts/coherent-adapter.mjs';

test('the coherent CLI awaits Codex adapter initialization and binds its private workspace to the project',async()=>{
  const calls=[],adapter={preflight:async()=>{},generate:async()=>{throw Error('not called');}};
  const result=await createCoherentImageAdapter('test-project',{adapter:'codex'},{codexFactory:async options=>{
    await Promise.resolve();calls.push(options);return adapter;
  }});
  assert.equal(result,adapter);assert.deepEqual(calls,[{workspace:join(resolve('test-project'),'private-transport')}]);
});
test('explicit host modules must resolve a usable adapter; invalid transport choices invoke nothing',async()=>{
  let loads=0;const adapter={preflight:async()=>{},generate:async()=>{throw Error('not called');}};
  const result=await createCoherentImageAdapter('project',{adapterModule:'host.mjs'},{loadModule:async url=>{
    loads++;assert(url.endsWith('/host.mjs'));return {createAdapter:async()=>adapter};
  }});assert.equal(result,adapter);assert.equal(loads,1);
  for(const options of [{},{adapter:'unselected'},{adapter:'codex',adapterModule:'host.mjs'}])
    await assert.rejects(createCoherentImageAdapter('project',options,{loadModule:async()=>{loads++;}}));
  assert.equal(loads,1);
  await assert.rejects(createCoherentImageAdapter('project',{adapter:'codex'},{codexFactory:async()=>({})}),
    e=>e.errors?.some(v=>v.code==='PIPELINE_ADAPTER_REQUIRED'));
});
