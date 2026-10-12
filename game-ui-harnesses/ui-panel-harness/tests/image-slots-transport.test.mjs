import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import * as panel from '../src/index.mjs';
import {harnessRoot,readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {planWithCodex,editWithCodex} from '../src/codex-planner.mjs';
import {imageRequest,imageIntent} from '../examples/image-slots-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
/** Explicit child-process double. The fixture executable is never executed. */
function fakeTransport(response,inspect){
  const calls=[];
  const runProcess=(command,args,options)=>{
    const child=new EventEmitter(),call={command,args,options,prompt:''};calls.push(call);
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
    child.stdin=new Writable({write(chunk,encoding,callback){call.prompt+=chunk.toString();callback();},final(callback){callback();queueMicrotask(async()=>{
      try{await inspect?.(call);for(const event of [{type:'thread.started',thread_id:'00000000-0000-4000-8000-000000000001'},{type:'turn.started'},
        {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(response)}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}])child.stdout.write(JSON.stringify(event)+'\n');child.emit('close',0);
      }catch(error){child.emit('error',error);}
    });}});return child;
  };
  return {calls,runProcess};
}
await mkdir(join(harnessRoot,'.tmp'),{recursive:true});const work=await mkdtemp(join(harnessRoot,'.tmp','image-transport-')),executable=join(work,process.platform==='win32'?'codex.exe':'codex');
await writeFile(executable,'Non-executable fixture. Every call supplies runProcess test double.');
const catalog=await readJson(new URL('../examples/modern-image-slots.catalog.json',import.meta.url)),core=await loadWorkspaceCore(),pool=await imageAssetPool();
test('native generation and editing each dispatch exactly one fixture child; image fields reach the existing model',async()=>{
  const model=await createWorkbenchModel({catalog,pool},core),prepared=await model.prepare(imageRequest),context=prepared.context;
  const fake=fakeTransport(imageIntent(context,{source:pool.index.records.map(record=>record.key)}),async call=>{
    assert(call.prompt.includes('prompts/panel-intent-v0.11-images.md')||call.prompt.includes('Static image slots'));
    const schema=await readJson(call.args[call.args.indexOf('--output-schema')+1]);assert.deepEqual(schema.properties.panelIntentVersion.enum,['0.11']);
    assert(JSON.stringify(schema).includes('content.image@0.1.0'));assert(JSON.stringify(schema).includes('image-fixtures/image0@1.0.0'));
  });
  const generated=await planWithCodex(context,{outputRoot:join(work,'generation'),executable,runProcess:fake.runProcess});
  assert.equal(fake.calls.length,1);assert.equal(generated.receipt.status,'READY_TO_COMPILE');assert.equal(generated.report.status,'READY_TO_COMPILE');
  await model.acceptProposal(generated.proposal);const before=model.getSnapshot().panel;
  const editRequest={...imageRequest,text:'把战士肖像高度改成200，保持完整显示，其他不变。'},edit=await model.prepareEdit(editRequest,{rowId:'row0'}),editing=edit.context;
  const operations=[{op:'set-image-properties',rowId:'row0',source:pool.index.records[0].key,width:'fill',height:200,fit:'contain',assetLibrary:null}];
  const draft={codexEditDraftVersion:'0.3',contextSha256:editing.sha256,patch:{patchVersion:'0.1',baseSpecSha256:editing.baseSpecSha256,reason:editRequest.text,operations},bases:[{kind:'request-interpretation',quote:editRequest.text}],unresolved:[],noChange:null};
  const editFake=fakeTransport(draft,async call=>{assert(call.prompt.includes('prompts/panel-image-editor.md'));assert(call.prompt.includes('set-image-properties'));const schema=JSON.parse(await readFile(call.args[call.args.indexOf('--output-schema')+1],'utf8'));assert(JSON.stringify(schema).includes('set-image-properties'));});
  const edited=await editWithCodex(editing,{outputRoot:join(work,'editing'),executable,runProcess:editFake.runProcess});assert.equal(editFake.calls.length,1);assert.equal(edited.report.status,'READY_TO_APPLY');
  await model.acceptEditProposal(edited.proposal);const current=model.getSnapshot().panel;assert.equal(current.spec.sections[0].rows[0].height,200);
  assert.deepEqual(current.state,before.state);assert.deepEqual(current.actions,before.actions);assert.deepEqual(current.assetClosure,before.assetClosure);assert.deepEqual(current.spec.sections.slice(1),before.spec.sections.slice(1));model.dispose();
});
test('invalid image intent stops at the first fixture response without retry',async()=>{
  const context=await panel.createPlanningContext(imageRequest,catalog),intent=imageIntent(context);intent.panel.body.children[0].rows[0].source='https://invalid.test/image.png';
  const fake=fakeTransport(intent);
  await assert.rejects(planWithCodex(context,{outputRoot:join(work,'invalid'),executable,runProcess:fake.runProcess}),{code:'CODEX_PROPOSAL_INVALID'});assert.equal(fake.calls.length,1);
});
