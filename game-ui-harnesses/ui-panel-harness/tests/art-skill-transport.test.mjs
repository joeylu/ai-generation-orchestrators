import test from 'node:test';
import assert from 'node:assert/strict';
import {artEventCollector,runArtSteps} from '../scripts/lib/art-skill-transport.mjs';
const send=(collector,...events)=>events.forEach(event=>collector.accept(JSON.stringify(event)));
const start=collector=>send(collector,{type:'thread.started',thread_id:'fixture'},{type:'turn.started'});
test('one complete message retains exact output and usage',()=>{
  const c=artEventCollector();start(c);send(c,{type:'item.completed',item:{type:'agent_message',text:'{"exact": true}'}},
    {type:'turn.completed',usage:{input_tokens:12,cached_input_tokens:2,output_tokens:3}});
  assert.deepEqual(c.finish(),{finalText:'{"exact": true}',usage:{inputTokens:12,cachedInputTokens:2,outputTokens:3}});
});
test('tool events, duplicate messages, malformed events and incomplete turns terminate',()=>{
  for(const event of [{type:'item.completed',item:{type:'command_execution'}},{type:'turn.failed'}]){
    const c=artEventCollector();start(c);assert.throws(()=>send(c,event));
  }
  const c=artEventCollector();start(c);send(c,{type:'item.completed',item:{type:'agent_message',text:'{}'}});
  assert.throws(()=>send(c,{type:'item.completed',item:{type:'agent_message',text:'{}'}}),/ART_CLI_FINAL_MESSAGE/);
  assert.throws(()=>artEventCollector().accept('invalid'),/ART_CLI_EVENT_JSON/);assert.throws(()=>c.finish(),/ART_CLI_INDETERMINATE/);
});
test('transport failure cannot dispatch the next condition or automatically retry',async()=>{
  const calls=[];await assert.rejects(()=>runArtSteps([1,2,3],{invoke:async step=>{calls.push(step);throw new Error('indeterminate');},accept:async()=>assert.fail()}),/indeterminate/);
  assert.deepEqual(calls,[1]);
});
test('compile or browser failure after returned output stops the remaining conditions',async()=>{
  const calls=[],accepted=[];await assert.rejects(()=>runArtSteps([1,2,3],{invoke:async step=>{calls.push(step);return step;},accept:async(step,value)=>{
    accepted.push(value);if(step===2)throw new Error('gate');return value;
  }}),/gate/);assert.deepEqual(calls,[1,2]);assert.deepEqual(accepted,[1,2]);
});
