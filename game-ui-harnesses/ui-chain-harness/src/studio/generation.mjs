import {randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {recoverCodexSheet,findRecoverableCodexImage} from '../skin-generation/codex-recovery.mjs';
import {recoveryCandidates} from '../skin-generation/supplement-recovery.mjs';
import {prepareSupplement,executeSupplement} from '../skin-generation/supplement.mjs';
import {readContracts} from '../contracts/validate.mjs';
import {defaults} from '../contracts/build.mjs';
import {hash} from '../skins/package.mjs';
import {inspectGenerationBatch} from '../skin-generation/batch-intake.mjs';
import {verifyGenerationPlan} from '../skin-generation/plan.mjs';
import {executeBatch,requestFor} from '../skin-generation/batch-runner.mjs';
import {codexFailureReader} from '../skin-generation/codex-diagnostics.mjs';
import {createSkinCodexAdapter} from '../skin-generation/codex-adapter.mjs';
import {generationExecutionPolicy} from '../skin-generation/execution-policy.mjs';
export function generationController({inspect,preflight,execute,recover,prepareOne,executeOne}){
 const entries=new Map(),identities=new Map(),listeners=new Set();let busy=false;
 const settled=async id=>{for(const fn of listeners)try{await fn(id);}catch{console.error('Automatic local processing needs attention; generation was not retried.');}};
 return {
  onSettled(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
  resolve(id){const entry=entries.get(id);if(!entry)throw Error('GENERATION_UNKNOWN_PLAN');return entry.plan;},
  register(plan){const key=JSON.stringify([plan.directory,plan.batchSha256]);if(identities.has(key))return identities.get(key);const id=randomUUID();entries.set(id,{plan,operation:'idle'});identities.set(key,id);return id;},
  async action(action,data){
   const entry=entries.get(data.id);if(!entry)throw Error('GENERATION_UNKNOWN_PLAN');
   if(action==='status')return {...await inspect(entry.plan,false),operation:entry.operation};
   if(action==='supplement-prepare'){
    if(busy||!prepareOne)throw Error('GENERATION_ALREADY_STARTED');busy=true;
    try{entry.supplementToken=null;await preflight();const prepared=await prepareOne(entry.plan,data.sheetId);entry.supplementToken=randomUUID();entry.supplement=prepared;return {...prepared,token:entry.supplementToken};}finally{busy=false;}
   }
   if(action==='supplement-start'){
    if(busy||!executeOne||!entry.supplementToken||data.token!==entry.supplementToken||data.confirmed!==entry.supplement?.planSha256||data.sheetId!==entry.supplement?.sheetId)throw Error('GENERATION_CONFIRMATION_REQUIRED');
    busy=true;entry.supplementToken=null;entry.operation='running';
    Promise.resolve().then(()=>executeOne(entry.plan,data.sheetId,data.confirmed)).then(()=>entry.operation='finished',()=>entry.operation='stopped-no-retry').finally(async()=>{busy=false;await settled(data.id);});
    return {operation:'running',sheetId:data.sheetId,automaticRetry:false};
   }
   if(action==='recover'){
    if(busy||!recover)throw Error('GENERATION_RECOVERY_UNAVAILABLE');
    busy=true;
    try{
     const state=await inspect(entry.plan,false),results=[];
     for(const node of state.nodes.filter(n=>n.status==='indeterminate')){
      try{await recover(entry.plan,node.sheetId);results.push({sheetId:node.sheetId,recovered:true});}
      catch{results.push({sheetId:node.sheetId,recovered:false,message:'未找到可通过校验的已返回图片，保留原记录；未重新生成。'});}
     }
     return {...await inspect(entry.plan,false),operation:entry.operation,recoveryResults:results,providerCalls:0};
    }finally{busy=false;await settled(data.id);}
   }
   if(action==='preflight'){
    if(busy||entry.operation!=='idle')throw Error('GENERATION_ALREADY_STARTED');
    entry.token=null;
    const state=await inspect(entry.plan,true);if(!state.fresh)throw Error('GENERATION_NOT_FRESH');
    await preflight();
    if(busy||entry.operation!=='idle')throw Error('GENERATION_ALREADY_STARTED');
    entry.token=randomUUID();return {...state,token:entry.token,batchSha256:entry.plan.batchSha256};
   }
   if(action!=='start'||busy||entry.operation!=='idle'||!entry.token||data.token!==entry.token||data.confirmed!==entry.plan.batchSha256)throw Error('GENERATION_CONFIRMATION_REQUIRED');
   busy=true;entry.token=null;entry.operation='checking';
   try{const state=await inspect(entry.plan,true);if(!state.fresh)throw Error('GENERATION_NOT_FRESH');}
   catch(e){busy=false;entry.operation='blocked';throw e;}
   entry.operation='running';
   Promise.resolve().then(()=>execute(entry.plan)).then(()=>entry.operation='finished',()=>entry.operation='stopped-no-retry').finally(async()=>{busy=false;await settled(data.id);});
   return {operation:'running',automaticRetry:false};
  }
 };
}
export function localGeneration(root,snapshot){
 const adapter=createSkinCodexAdapter({workspace:join(root,'work/skin-codex-relay')});
 const diagnose=codexFailureReader({relayRoot:join(root,'work/skin-codex-relay'),home:process.env.CODEX_HOME??join(homedir(),'.codex')});
 const relayContext={relayRoot:join(root,'work/skin-codex-relay'),home:process.env.CODEX_HOME??join(homedir(),'.codex')};
 const diagnoseHistory=async(intake,node)=>{
  let latest;
  for(const planSha256 of recoveryCandidates(node)){
   const d=await diagnose({...node,planSha256,requestSha256:requestFor(intake,{...node,planSha256}).requestSha256});
   if(planSha256===node.planSha256)latest=d;
   if(d?.code==='returned-image-needs-check')return planSha256===node.planSha256?d:{...d,label:'历史图片待核验',detail:'此前补图已保存图片，请先检查并恢复，无需再次生成。'};
  }
  return latest;
 };
 const args=plan=>({skinDirectory:dirname(dirname(join(root,plan.directory))),batchSha256:plan.batchSha256});
 return generationController({
  async inspect(plan,freshness){
   const source=await readContracts(defaults),input=args(plan),result=await inspectGenerationBatch({...input,templateSha256:hash(source.bytes.template),sheets:source.template.sheets});
   if(freshness)for(const node of result.summary.nodes)await verifyGenerationPlan({directory:join(input.skinDirectory,'plans',node.planSha256),planSha256:node.planSha256});
   const previews=new Map();
   for(const s of result.sources){const url='atlas-previews/'+s.sha256+'.png';snapshot?.files.set(url,s.raw);previews.set(s.sheetId,'/'+url);}
   const nodes=await Promise.all(result.summary.nodes.map(async n=>({sheetId:n.sheetId,status:n.status,recovered:n.recovered===true,inspection:n.inspection,issues:n.issues,preview:previews.get(n.sheetId),submittedAt:n.submittedAt,finishedAt:n.finishedAt,receivedAt:n.receivedAt,outcomeRecorded:n.outcomeRecorded,
    diagnostic:n.outcomeRecorded&&['indeterminate','failed'].includes(n.status)?await diagnoseHistory(result,n):undefined})));
   return {fresh:result.summary.nodes.every(n=>n.status==='awaiting-authorization'),nodes,automaticRetry:false};
  },preflight:()=>adapter.preflight(),execute:plan=>executeBatch({...args(plan),confirmedBatchSha256:plan.batchSha256,maxConcurrentSheets:generationExecutionPolicy.maxConcurrentSheets},adapter),
  recover:(plan,sheetId)=>recoverCodexSheet({...args(plan),sheetId,relayRoot:join(root,'work/skin-codex-relay'),home:process.env.CODEX_HOME??join(homedir(),'.codex')}),
  prepareOne:async(plan,sheetId)=>{
   const source=await readContracts(defaults),intake=await inspectGenerationBatch({...args(plan),templateSha256:hash(source.bytes.template),sheets:source.template.sheets}),node=intake.summary.nodes.find(n=>n.sheetId===sheetId);
   if(node&&await findRecoverableCodexImage({intake,node,...relayContext}))throw Error('GENERATION_RECOVERABLE_IMAGE');
   return prepareSupplement({...args(plan),sheetId});
  },
  executeOne:(plan,sheetId,confirmed)=>executeSupplement({...args(plan),sheetId,confirmed},adapter)
 });
}
