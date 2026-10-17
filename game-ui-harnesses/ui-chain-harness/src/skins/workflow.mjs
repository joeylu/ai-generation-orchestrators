import {readFile,writeFile,mkdir,readdir,open,unlink} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readSafe,hash,json} from './package.mjs';
import {safePath} from './contract.mjs';
export const workflowStages=['inspect','assemble','consumer','check'];
export async function inventory(directory,prefix=''){
  const entries=[];
  for(const item of await readdir(join(directory,prefix),{withFileTypes:true})){
    const file=prefix+item.name;if(item.isDirectory())entries.push(...await inventory(directory,file+'/'));
    else{const bytes=await readSafe(directory,file);entries.push({file,sha256:hash(bytes)});}
  }
  return entries.sort((a,b)=>a.file.localeCompare(b.file));
}
export async function verifyFiles(directory,files){
  for(const f of files)if(hash(await readSafe(directory,f.file))!==f.sha256)throw Error('workflow.artifact-changed');
}
export async function workflowStatus(directory){
  const request=JSON.parse(await readSafe(directory,'request.json'));await verifyFiles(directory,request.inputs);
  const stages=[];let previous=hash(await readSafe(directory,'request.json'));
  for(const stage of workflowStages){
    let bytes;try{bytes=await readSafe(directory,'receipts/'+stage+'.json');}catch(e){if(e.code==='ENOENT')break;throw e;}
    const receipt=JSON.parse(bytes);
    if(receipt.stage!==stage||receipt.previousSha256!==previous)throw Error('workflow.receipt-chain');
    await verifyFiles(directory,receipt.files);previous=hash(bytes);stages.push(receipt);
  }
  const attempts=[];
  try{for(const item of await readdir(join(directory,'attempts'),{withFileTypes:true})){if(!item.isDirectory())continue;const started=JSON.parse(await readSafe(directory,'attempts/'+item.name+'/started.json'));let failed=false;try{await readSafe(directory,'attempts/'+item.name+'/failure.json');failed=true;}catch(e){if(e.code!=='ENOENT')throw e;}attempts.push({directory:'attempts/'+item.name,stage:started.stage,status:failed?'failed':stages.some(s=>s.files.some(f=>f.file.startsWith('attempts/'+item.name+'/')))?'passed':'incomplete'});}}catch(e){if(e.code!=='ENOENT')throw e;}
  const nextStage=workflowStages[stages.length]??null,pending=attempts.filter(a=>a.stage===nextStage);
  return{kind:'ui_skin_workflow_status',version:'1.0',id:request.id,status:stages.length===workflowStages.length?'awaiting-visual-review':pending.some(a=>a.status==='failed')?'failed-retryable':pending.length?'incomplete':'ready-to-continue',nextStage,stages,attempts,productionReady:false,visualReview:{status:'pending',mode:'external'},generation:{status:'not-invoked',scope:'existing-assets-only'}};
}
// Local, single-writer checkpoint runner. No provider calls or background workers.
export async function continueWorkflow(directory,{toolSha256,until='check',execute,assertTools=async()=>{}}){
  if(!workflowStages.includes(until))throw Error('workflow.stage');
  const request=JSON.parse(await readSafe(directory,'request.json'));
  if(request.toolSha256!==toolSha256)throw Error('workflow.tools-changed-create-new-run');
  let lock;try{lock=await open(join(directory,'.run.lock'),'wx');}catch(e){if(e.code==='EEXIST')throw Error('workflow.busy-or-interrupted-lock');throw e;}
  try{
    const status=await workflowStatus(directory);let previous=status.stages.length?hash(await readSafe(directory,'receipts/'+status.stages.at(-1).stage+'.json')):hash(await readSafe(directory,'request.json'));
    for(const stage of workflowStages.slice(status.stages.length)){
      if(workflowStages.indexOf(stage)>workflowStages.indexOf(until))break;
      const attempt='attempts/'+stage+'-'+randomUUID();await mkdir(join(directory,attempt),{recursive:true});
      await writeFile(join(directory,attempt,'started.json'),json({stage,status:'started'}),{flag:'wx'});
      try{
        const outputs=await execute(stage,join(directory,attempt),status.stages);
        for(const file of Object.values(outputs))if(typeof file==='string'&&(!safePath(file)||!file.startsWith(attempt+'/')))throw Error('workflow.output-path');
        await verifyFiles(directory,request.inputs);
        await assertTools();
        const files=(await inventory(join(directory,attempt))).map(f=>({...f,file:attempt+'/'+f.file}));
        const receipt={stage,status:'passed',previousSha256:previous,outputs,files};
        const temp=join(directory,'receipts',stage+'.'+randomUUID()+'.tmp');await writeFile(temp,json(receipt),{flag:'wx'});
        // Hard link publishes complete receipts without overwriting existing ones.
        const {link}=await import('node:fs/promises');await link(temp,join(directory,'receipts',stage+'.json'));await unlink(temp);
        previous=hash(Buffer.from(json(receipt)));status.stages.push(receipt);
      }catch(e){await writeFile(join(directory,attempt,'failure.json'),json({stage,status:'failed',code:typeof e.code==='string'?e.code:'workflow.stage-failed'}),{flag:'wx'});throw e;}
    }
    return workflowStatus(directory);
  }finally{await lock.close();await unlink(join(directory,'.run.lock'));}
}
