import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLoopJournal,verifyBuiltinResult} from '../src/ai_ui_decomposition/generation-loop-node.mjs';
const bytes=Buffer.from([137,80,78,71,13,10,26,10,0]);

test('completion handoff binds durable journal and never overwrites an earlier completion',()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-completion-'));
  const bridge=fileURLToPath(new URL('../src/ai_ui_decomposition/generation-loop-bridge.mjs',import.meta.url));
  const call=(...args)=>JSON.parse(execFileSync(process.execPath,[bridge,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  try {
    const journal=join(root,'journal'),input=join(root,'0001.json');
    call('init',journal);
    const report={kind:'ui_generation_loop_execution_v1',result:{status:{status:'generation_complete',nextNode:'process',assignedCalls:1,planDigest:'plan',jobDigest:'job'}},
      startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:04Z',elapsedMs:4000,automaticRetries:0,
      timings:[{phase:'generation',ms:2000},{phase:'persist',ms:1000}]};
    writeFileSync(input,JSON.stringify({kind:'ui_generation_loop_events_v1',events:[{event:'execution-summary',report}]}));
    call('persist',journal,input);
    const original=readFileSync(join(root,'completion.json'));
    const summary=JSON.parse(original);
    assert.equal(summary.status,'generation_complete');
    assert.equal(summary.nextNode,'process');
    assert.equal(summary.generationMs,2000);
    assert.equal(summary.elapsedMs,4000);
    assert.equal(summary.requiresOfficialStatusCheck,true);
    assert.equal(summary.journalSha256,createHash('sha256').update(readFileSync(join(journal,'0001.json'))).digest('hex'));
    const second=join(root,'0002.json');writeFileSync(second,readFileSync(input));
    assert.throws(()=>call('persist',journal,second));
    assert.deepEqual(readFileSync(join(root,'completion.json')),original);
  } finally {rmSync(root,{recursive:true});}
});
test('explicit session-child roots accept agent output but reject siblings and deeper paths',()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-session-'));
  const response=source=>({image_url:'data:image/png;base64,'+bytes.toString('base64'),output_hint:`Saved as ${source} by default.`});
  try {
    for(const session of ['agent-one','agent-two']){
      const dir=join(root,session);mkdirSync(dir);const source=join(dir,'result.png');writeFileSync(source,bytes);
      assert.equal(verifyBuiltinResult(response(source),root,'session-child'),realpathSync.native(source));
      assert.throws(()=>verifyBuiltinResult(response(source),root),/OUTSIDE_ROOT/);
    }
    const nested=join(root,'agent-one','nested');mkdirSync(nested);
    const deep=join(nested,'result.png');writeFileSync(deep,bytes);
    assert.throws(()=>verifyBuiltinResult(response(deep),root,'session-child'),/OUTSIDE_ROOT/);
    assert.throws(()=>verifyBuiltinResult(response(join(root+'-sibling','agent','result.png')),root,'session-child'),/OUTSIDE_ROOT/);
    const changed=join(root,'agent-one','result.png');writeFileSync(changed,'changed');
    assert.throws(()=>verifyBuiltinResult(response(changed),root,'session-child'),/BYTES_MISMATCH/);
  } finally {rmSync(root,{recursive:true});}
});
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
    assert.equal(call('resolve',root,join(journal,'0001.json')).source,realpathSync.native(source));
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
    assert.equal(call('resolve',root,join(journal,'0001.json')).source,realpathSync.native(source));
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
    assert.equal(verifyBuiltinResult(response,root),realpathSync.native(source));
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

// Canonical directory comparison must not turn a linked session into an allowed result.
test('physical binding still rejects linked session directories',()=>{
  const root=mkdtempSync(join(tmpdir(),'loop-linked-'));
  const response=source=>({image_url:'data:image/png;base64,'+bytes.toString('base64'),output_hint:`Saved as ${source} by default.`});
  try {
    const target=join(root,'target');mkdirSync(target);writeFileSync(join(target,'result.png'),bytes);
    const link=join(root,'linked');symlinkSync(target,link,'junction');
    assert.throws(()=>verifyBuiltinResult(response(join(link,'result.png')),root,'session-child'),/PHYSICAL_PATH_INVALID/);
  } finally {rmSync(root,{recursive:true});}
});
