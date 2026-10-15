import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Writable,PassThrough} from 'node:stream';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {harnessRoot,readJson} from '../src/io.mjs';
import {DEFAULT_PANEL_CATALOG} from '../src/default-catalog.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {buildCodexPlanningPrompt,planWithCodex} from '../src/codex-planner.mjs';
import {buildCommonGamePanelPrompt,usesGamePanelDraftPolicy} from '../src/game-panel-prompt.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {COMPACT_MESSAGE_SUITE,compactMessageFixture} from '../examples/compact-message-v1/suite.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
const catalog=await readJson(new URL('../'+DEFAULT_PANEL_CATALOG,import.meta.url));
const pool=await loadBundledCoreAssets(),core=await loadWorkspaceCore();
await mkdir(join(harnessRoot,'.tmp'),{recursive:true});
const scratch=await mkdtemp(join(harnessRoot,'.tmp','daily-panel-')),executable=join(scratch,process.platform==='win32'?'fixture.exe':'fixture');
await writeFile(executable,'Test specimen. Only the injected transport can execute.');
for(const item of COMPACT_MESSAGE_SUITE)test(`${item.id}: daily default sends the shared short-input policy without a prompt-replacing adapter`,async()=>{
 const model=await createWorkbenchModel({catalog,pool},core);
 try{
  const {context}=await model.prepare(item.request),prompt=await buildCodexPlanningPrompt(context);
  assert(usesGamePanelDraftPolicy(context));assert.equal(context.request.text,item.request.text);
  assert.equal(prompt,buildCommonGamePanelPrompt(context));assert.equal(context.catalog.id,'modern-readable-game-card-layout');
  const reply=compactMessageFixture(context,item,referenceIntent);let calls=0,sent='';
  const runProcess=()=>{
   calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
   child.stdin=new Writable({write(chunk,encoding,callback){sent+=chunk.toString();callback();},final(callback){callback();queueMicrotask(()=>{
    child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},
     {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(reply)}},{type:'turn.completed',usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0}}].map(value=>JSON.stringify(value)).join('\n')+'\n');child.emit('close',0);
   });}});return child;
  };
  const result=await planWithCodex(context,{executable,outputRoot:join(scratch,item.id),runProcess});
  assert.equal(calls,1);assert.equal(sent,prompt);assert.equal(result.receipt.automaticRetries,0);
  const ready=await model.acceptProposal(result.proposal);assert.equal(ready.phase,'ready');
  assert.equal(ready.panel.compilerVersion,'0.45.0');
 }finally{model.dispose();}
});
for(const [name,sha]of [['modern-all-components','54270493c0323f33b8aa7e1cf0108c0f0708cb027d59a0d890204f4e2cb0333c'],['modern-message-copy','e9546bd77e93a20811ddf5eb20c4ac69931a78b06826666ecebd06bcc57426e6']])test(`${name}: explicitly selected older catalog keeps its exact planning prompt`,async()=>{
 const old=await readJson(new URL(`../examples/${name}.catalog.json`,import.meta.url));
 const context=await createPlanningContext({requestVersion:'0.1',id:'legacy-default-proof',target:'pixi',text:'帮我做一个设置面板'},old);
 assert.equal(usesGamePanelDraftPolicy(context),false);
 assert.equal(await digestBytes(new TextEncoder().encode(await buildCodexPlanningPrompt(context))),sha);
});
