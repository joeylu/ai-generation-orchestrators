import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Writable,PassThrough} from 'node:stream';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {harnessRoot,readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {buildCodexPlanningPrompt,planWithCodex} from '../src/codex-planner.mjs';
import {buildCommonGamePanelPrompt} from '../scripts/lib/common-game-panel-prompt.mjs';
import {COMMON_GAME_PANEL_SUITE,commonGamePanelFixture} from '../examples/common-game-panels-v1/suite.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {frozenPromptTransport} from '../scripts/lib/design-comparison.mjs';
const catalog=await readJson(new URL('../examples/modern-action-headings.catalog.json',import.meta.url));catalog.themes=catalog.themes.filter(t=>t.id==='modern-mint-light');
await mkdir(join(harnessRoot,'.tmp'),{recursive:true});
const scratch=await mkdtemp(join(harnessRoot,'.tmp','common-panel-transport-')),executable=join(scratch,process.platform==='win32'?'codex.exe':'codex');
await writeFile(executable,'Non-executable test specimen; only fake transport can run.');
for(const index of [2,35,48,62])test(`${COMMON_GAME_PANEL_SUITE[index].id}: exact short-input prompt crosses the CLI boundary once with a test double`,async()=>{
  const item=COMMON_GAME_PANEL_SUITE[index],context=await createPlanningContext(item.request,catalog),base=await buildCodexPlanningPrompt(context),prompt=buildCommonGamePanelPrompt(context);
  const intent=commonGamePanelFixture(context,item,referenceIntent);let calls=0,sent='',observed;
  const fake=()=>{
    calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
    child.stdin=new Writable({write(chunk,encoding,callback){sent+=chunk.toString();callback();},final(callback){callback();queueMicrotask(()=>{
      child.stdout.write([{type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'},{type:'turn.started'},
        {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(intent)}},{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:0,output_tokens:10}}].map(value=>JSON.stringify(value)).join('\n')+'\n');
      child.emit('close',0);
    });}});return child;
  };
  const result=await planWithCodex(context,{outputRoot:join(scratch,item.id),executable,runProcess:frozenPromptTransport(base,prompt,fake,value=>{observed=value;})});
  assert.equal(calls,1);assert.equal(sent,prompt);assert.equal(observed,prompt);
  assert.equal(JSON.parse(sent.split('Complete validated task data:\n')[1]).context.request.text,item.request.text);
  assert.equal(result.report.status,'READY_TO_COMPILE');assert.equal(result.receipt.invocationCount,1);assert.equal(result.receipt.automaticRetries,0);
});
