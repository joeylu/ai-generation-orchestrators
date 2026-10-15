import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {harnessRoot} from '../src/io.mjs';
import {prepareAdaptability,runAdaptability} from '../scripts/input-adaptability.mjs';
import {INVENTORY_GRID_SUITE,inventoryGridFixture} from '../examples/inventory-grid-v1/suite.mjs';
import {buildCodexPlanningPrompt} from '../src/codex-planner.mjs';

test('inventory finite plan runs four unchanged short prompts through the native accepting boundary without a model call or retry',async()=>{
 await mkdir(join(harnessRoot,'.tmp'),{recursive:true});const scratch=await mkdtemp(join(harnessRoot,'.tmp','inventory-batch-')),prepared=join(scratch,'plan');
 const plan=await prepareAdaptability(prepared,{cohort:'inventory-grid-v1'});assert.equal(plan.policy.maxInvocations,4);assert.equal(plan.inventoryEvaluation.expectedDeliveries,3);assert.equal(plan.authorization,'REQUIRED_NOT_GRANTED');
 const executable=join(scratch,process.platform==='win32'?'fixture.exe':'fixture');await writeFile(executable,'Never executed: fake transport owns every call.');let calls=0;const sent=[];
 const runProcess=()=>{
  calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};let prompt='';
  child.stdin=new Writable({write(chunk,encoding,callback){prompt+=chunk.toString();callback();},final(callback){callback();queueMicrotask(async()=>{
   const context=JSON.parse(prompt.split('Complete validated task data:\n')[1]).context,item=INVENTORY_GRID_SUITE.find(item=>item.id===context.request.id);sent.push({prompt,expected:await buildCodexPlanningPrompt(context)});
   const reply=inventoryGridFixture(context,item);child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(reply)}},{type:'turn.completed',usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0}}].map(value=>JSON.stringify(value)).join('\n')+'\n');child.emit('close',0);
  });}});return child;
 };
 const report=await runAdaptability({prepared,approvedDigest:plan.sha256,output:join(scratch,'run'),testTransport:{executable,runProcess}});
 assert.equal(calls,4);assert.equal(report.realModelCalls,0);assert.equal(report.status,'PASS_BEFORE_BROWSER');assert.equal(report.automaticRetries,0);assert.equal(report.results.filter(result=>result.delivery).length,3);
 assert(sent.every(item=>item.prompt===item.expected));await assert.rejects(runAdaptability({prepared,approvedDigest:plan.sha256,output:join(scratch,'second'),testTransport:{executable,runProcess}}));assert.equal(calls,4);
});
