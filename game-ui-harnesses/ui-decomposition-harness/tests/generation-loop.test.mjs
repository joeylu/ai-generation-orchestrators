import test from 'node:test';
import assert from 'node:assert/strict';
import {builtinResultPath, runGenerationLoop} from '../src/ai_ui_decomposition/generation-loop.mjs';

const output = {image_url:'data:image/png;base64,aGVsbG8=',
  output_hint:'Generated images are saved as /fixture/output/result.png by default.'};
const request = n => ({asset:`asset-${n}`, requestDigest:n.toString(16).padStart(64,'0'),
  arguments:{prompt:`frozen-${n}`,referenced_image_paths:['/fixture/reference.png']}});
function host(count=9) {
  const journal=[], calls=[], received=[];
  let dispatched=0;
  return {journal,calls,received,maxCalls:count,
    async exchange(previous) {
      if (previous) received.push(previous);
      return dispatched<count ? {status:{status:'awaiting_external'},nextRequest:request(++dispatched)} :
        {status:{status:'ready',nextNode:'process'},nextRequest:null};
    },
    async generate(args) { calls.push(args);return output; },
    async resolveResult(raw) {return builtinResultPath(raw,'/fixture/output');},
    async persist(event) {journal.push(event);}
  };
}

test('nine serial calls finish in one loop; exact arguments and receive evidence retained',async()=>{
  const h=host();let active=0,maxActive=0;
  const generate=h.generate;
  h.generate=async args=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();
    const result=await generate(args);active--;return result;};
  const result=await runGenerationLoop(h);
  assert.equal(result.calls,9);assert.equal(h.received.length,9);assert.equal(maxActive,1);
  assert.equal(result.status.nextNode,'process');
  assert.equal(h.journal.filter(e=>e.event==='invocation-intent').length,9);
  assert.equal(h.journal.filter(e=>e.event==='tool-returned').length,9);
  for (let i=0;i<9;i++) assert.deepEqual(h.calls[i],request(i+1).arguments);
});

test('unknown provider failure stops without retry or next dispatch',async()=>{
  const h=host();h.generate=async()=>{h.calls.push('attempt');throw new Error('unknown outcome');};
  await assert.rejects(runGenerationLoop(h),/unknown outcome/);
  assert.equal(h.calls.length,1);assert.equal(h.received.length,0);
  assert.equal(h.journal.at(-1).automaticResubmit,false);
});

test('unrecognized returned path preserves response and stops before next request',async()=>{
  const h=host();h.resolveResult=async()=>{throw new Error('unrecognized response');};
  await assert.rejects(runGenerationLoop(h),/unrecognized response/);
  assert.equal(h.calls.length,1);assert.equal(h.received.length,0);
  assert.ok(h.journal.find(e=>e.event==='tool-returned'));
});

test('duplicate request and exceeded local budget never trigger another call',async()=>{
  const h=host();h.exchange=async()=>({nextRequest:request(1)});
  await assert.rejects(runGenerationLoop(h),/DUPLICATE_REQUEST/);assert.equal(h.calls.length,1);
  const b=host(2);b.maxCalls=1;
  await assert.rejects(runGenerationLoop(b),/BUDGET_EXHAUSTED/);assert.equal(b.calls.length,1);
});

test('cancellation before dispatch and after return never generates the next image',async()=>{
  const h=host();h.cancelled=()=>true;
  await assert.rejects(runGenerationLoop(h),/CANCELLED/);assert.equal(h.calls.length,0);
  const b=host();let cancel=false;b.cancelled=()=>cancel;
  b.generate=async args=>{b.calls.push(args);cancel=true;return output;};
  await assert.rejects(runGenerationLoop(b),/CANCELLED/);
  assert.equal(b.calls.length,1);assert.equal(b.received.length,0);
  assert.ok(b.journal.find(e=>e.event==='result-ready'));
});

test('intent persistence failure cannot trigger a provider call',async()=>{
  const h=host();h.persist=async e=>{if(e.event==='invocation-intent')throw new Error('disk unavailable');};
  await assert.rejects(runGenerationLoop(h),/disk unavailable/);assert.equal(h.calls.length,0);
});

test('long call emits scheduled progress and clears its timer',async()=>{
  const h=host(1),events=[];let tick,cleared=false;
  h.schedule=(fn,ms)=>{assert.equal(ms,30000);tick=fn;return 1;};
  h.unschedule=id=>{assert.equal(id,1);cleared=true;};h.progress=async e=>events.push(e);
  h.generate=async()=>{tick();return output;};
  await runGenerationLoop(h);
  assert.ok(cleared);assert.ok(events.some(e=>e.event==='generation-wait'));
});

test('strict local path extraction rejects ambiguous, remote and escaped locations',()=>{
  assert.equal(builtinResultPath(output,'/fixture/output'),'/fixture/output/result.png');
  const win={...output,output_hint:'Saved as D:\\images\\one.png by default.'};
  assert.equal(builtinResultPath(win,'D:\\images'),'D:\\images\\one.png');
  for (const path of ['/fixture/output/../one.png','/other/one.png','https://host/one.png',
      '//host/share/one.png','/fixture/output/sub/one.png']) {
    assert.throws(()=>builtinResultPath({...output,output_hint:`Saved as ${path} by default.`},'/fixture/output'));
  }
  assert.throws(()=>builtinResultPath({...output,output_hint:output.output_hint.repeat(2)},'/fixture/output'));
  assert.throws(()=>builtinResultPath({...output,output_hint:'Format changed'},'/fixture/output'));
  assert.throws(()=>builtinResultPath({...output,image_url:'https://host/image.png'},'/fixture/output'));
});
