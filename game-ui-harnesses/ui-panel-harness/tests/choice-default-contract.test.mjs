import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {harnessRoot,readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {planWithCodex,buildCodexPlanningPrompt} from '../src/codex-planner.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
const catalog=await readJson(new URL('../examples/modern-compact-message.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
await mkdir(join(harnessRoot,'.tmp'),{recursive:true});const scratch=await mkdtemp(join(harnessRoot,'.tmp','choice-default-')),executable=join(scratch,process.platform==='win32'?'fixture.exe':'fixture');await writeFile(executable,'Test specimen; never executed.');
const kinds={select:'select-row',radio:'radio-row',list:'list-row'};
for(const [kind,recipeKind]of Object.entries(kinds))for(const defaults of [0,1,2])test(`${kind}: ${defaults} initial options preserve the strict one-default gate and one-invocation lifecycle`,async()=>{
 const context=await createPlanningContext({requestVersion:'0.1',id:`choice-${kind}-${defaults}`,target:'pixi',text:'做个背包面板'},catalog),recipe=catalog.recipes.find(recipe=>recipe.kind===recipeKind),theme=catalog.themes[0];
 const row={kind,label:'示例物品',recipeKey:recipe.id+'@'+recipe.version,sourceRef:'request',icon:null,enabled:true,
  options:['示例物品一','示例物品二','示例物品三'].map((label,index)=>({label,initial:defaults===1?index===1:index<defaults})),...(kind==='list'?{itemHeight:48,visibleItems:3}:{})};
 const reply={panelIntentVersion:'0.12',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'背包',themeKey:theme.id+'@'+theme.version,panelSurface:null,
  layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto'},body:{kind:'column',children:[{kind:'section',title:'背包',actionLayout:null,rows:[row]}]}}};
 let calls=0,sent='';const runProcess=()=>{
  calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
  child.stdin=new Writable({write(chunk,encoding,callback){sent+=chunk.toString();callback();},final(callback){callback();queueMicrotask(()=>{
   child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(reply)}},{type:'turn.completed',usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0}}].map(event=>JSON.stringify(event)).join('\n')+'\n');child.emit('close',0);
  });}});return child;
 };
 const options={executable,outputRoot:join(scratch,context.request.id),runProcess};
 if(defaults===1){
  const result=await planWithCodex(context,options),model=await createWorkbenchModel({catalog,pool:null},core);
  try{await model.prepare(context.request);const ready=await model.acceptProposal(result.proposal);assert.equal(ready.phase,'ready');const field=ready.panel.spec.state.find(field=>field.type==='enum');assert.equal(field.options.find(option=>option.id===field.initial).label,'示例物品二');assert.equal(ready.panel.state[field.id],field.initial);assert.equal(result.receipt.automaticRetries,0);}finally{model.dispose();}
 }else await assert.rejects(planWithCodex(context,options),error=>error.code==='CODEX_PROPOSAL_INVALID'&&error.diagnostic?.validatorCode==='INTENT_DEFAULT'&&error.receipt?.invocationCount===1&&error.receipt?.automaticRetries===0);
 assert.equal(calls,1);assert.equal(sent,await buildCodexPlanningPrompt(context));
});
