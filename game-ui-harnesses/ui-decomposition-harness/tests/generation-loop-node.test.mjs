import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createLoopJournal,verifyBuiltinResult} from '../src/ai_ui_decomposition/generation-loop-node.mjs';
const bytes=Buffer.from([137,80,78,71,13,10,26,10,0]);
test('megabyte response batch survives file transport without truncation',()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-large-'));
  const bridge=fileURLToPath(new URL('../src/ai_ui_decomposition/generation-loop-bridge.mjs',import.meta.url));
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[bridge,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  try {
    // Transport fixture only; full PNG decoding belongs to official receive.
    const large=Buffer.concat([bytes,Buffer.alloc(1024*1024,173)]);
    const source=join(root,'large.png'),input=join(root,'0001.json'),journal=join(root,'journal');
    writeFileSync(source,large);
    const payload={kind:'ui_generation_loop_events_v1',events:[{event:'tool-returned',response:{
      image_url:'data:image/png;base64,'+large.toString('base64'),output_hint:`Saved as ${source} by default.`}}]};
    writeFileSync(input,JSON.stringify(payload));call('init',journal);call('persist',journal,input);
    assert.deepEqual(JSON.parse(readFileSync(join(journal,'0001.json'),'utf8')),payload);
    assert.equal(call('resolve',root,join(journal,'0001.json')).source,source);
    payload.events[0].response.image_url=payload.events[0].response.image_url.slice(0,-4);
    writeFileSync(input,JSON.stringify(payload));assert.throws(()=>call('resolve',root,input));
  } finally {rmSync(root,{recursive:true});}
});
test('file bridge transports complete response and refuses duplicate journal events',()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-bridge-'));
  const bridge=fileURLToPath(new URL('../src/ai_ui_decomposition/generation-loop-bridge.mjs',import.meta.url));
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[bridge,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  try {
    const journal=join(root,'journal'),input=join(root,'0001.json'),source=join(root,'image.png');
    writeFileSync(source,bytes);
    const event={event:'tool-returned',response:{image_url:'data:image/png;base64,'+bytes.toString('base64'),output_hint:`Saved as ${source} by default.`}};
    writeFileSync(input,JSON.stringify(event));
    assert.equal(call('init',journal).ready,true);
    assert.equal(call('persist',journal,input).persisted,true);
    assert.deepEqual(JSON.parse(readFileSync(join(journal,'0001.json'),'utf8')),event);
    assert.equal(call('resolve',root,join(journal,'0001.json')).source,source);
    assert.throws(()=>call('persist',journal,input));
    assert.throws(()=>call('init',journal));
    writeFileSync(source,'changed');assert.throws(()=>call('resolve',root,input));
  } finally {rmSync(root,{recursive:true});}
});
test('physical result binding rejects replaced, missing and invalid inline files',()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-binding-'));
  try {
    const source=join(root,'result.png');writeFileSync(source,bytes);
    const response={image_url:'data:image/png;base64,'+bytes.toString('base64'),output_hint:`Saved as ${source} by default.`};
    assert.equal(verifyBuiltinResult(response,root),source);
    writeFileSync(source,Buffer.concat([bytes,Buffer.from([1])]));
    assert.throws(()=>verifyBuiltinResult(response,root),/BYTES_MISMATCH/);
    assert.throws(()=>verifyBuiltinResult({...response,image_url:'data:image/png;base64,invalid!'},root),/INLINE_PNG_INVALID/);
    rmSync(source);assert.throws(()=>verifyBuiltinResult(response,root),/ENOENT/);
  } finally {rmSync(root,{recursive:true});}
});
test('journal persists full response exclusively and refuses implicit restart',async()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-journal-'));
  try {
    const directory=join(root,'events'),persist=createLoopJournal(directory);
    const event={event:'tool-returned',response:{image_url:'data:image/png;base64,'+bytes.toString('base64')}};
    await persist(event);
    assert.deepEqual(JSON.parse(readFileSync(join(directory,'0001.json'),'utf8')),event);
    assert.throws(()=>createLoopJournal(directory),/EEXIST/);
    writeFileSync(join(directory,'0002.json'),'retained');
    await assert.rejects(persist({event:'next'}),/EEXIST/);
    assert.equal(readFileSync(join(directory,'0002.json'),'utf8'),'retained');
  } finally {rmSync(root,{recursive:true});}
});
