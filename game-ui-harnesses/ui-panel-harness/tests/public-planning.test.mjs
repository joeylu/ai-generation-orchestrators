import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {preparePlanning,verifyPlanning,PLANNING_API_VERSION} from 'ai-ui-panel-harness/planning/v1';
const catalog=JSON.parse(await readFile(new URL('../catalog/modern-core.json',import.meta.url)));
const input=()=>({request:{requestVersion:'0.1',id:'settings',text:'音乐开关默认开启；音量范围0到100，步长1，默认65。',target:'pixi'},catalog});
test('public planning delegates deterministically and preserves the exact request without model execution',async()=>{
  const a=await preparePlanning(input()),b=await preparePlanning(input());assert.equal(PLANNING_API_VERSION,'1.0');assert.deepEqual(a,b);assert.deepEqual(await verifyPlanning(JSON.parse(JSON.stringify(a))),a);assert.equal(a.context.request.text,input().request.text);
});

test('public verification rejects getters and cycles without executing caller code',async()=>{
  let reads=0;const getter={get context(){reads++;return {};}};
  await assert.rejects(()=>verifyPlanning(getter));assert.equal(reads,0);
  const cyclic={};cyclic.context=cyclic;await assert.rejects(()=>verifyPlanning(cyclic));
});
test('public planning refuses changed versions, context and schemas without overwriting the snapshot',async()=>{
  const source=await preparePlanning(input());
  for(const edit of [s=>s.apiVersion='2.0',s=>s.responseSchema.description='changed',s=>s.context.request.text='other request',s=>s.sha256='0'.repeat(64)]){
    const s=structuredClone(source);edit(s);const before=structuredClone(s);await assert.rejects(()=>verifyPlanning(s));assert.deepEqual(s,before);
  }
});
