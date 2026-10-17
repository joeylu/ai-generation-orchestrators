import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {readSafe,hash} from '../skins/package.mjs';
import {verifyGenerationPlan} from '../skin-generation/plan.mjs';
// Discovery only. Never creates an authorization, repairs a receipt or submits a model.
export async function discoverPlans(root,generation){
 const base='work/studio/projects',plans=[];let folders;
 try{folders=await readdir(join(root,base),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return {plans:[],truncated:false};throw e;}
 const candidates=folders.filter(f=>f.isDirectory()&&!f.isSymbolicLink()&&/^[a-f0-9-]{36}$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name));
 for(const folder of candidates.slice(0,100)){
  const projectDir=base+'/'+folder.name;
  let batches;
  try{batches=await readdir(join(root,projectDir,'batches'),{withFileTypes:true});}catch(e){if(e.code==='ENOENT'){plans.push({name:'未完成的计划准备',status:'incomplete',projectId:folder.name});continue;}plans.push({name:'无法读取的计划',status:'invalid',projectId:folder.name});continue;}
  for(const batchDir of batches.filter(f=>f.isDirectory()&&!f.isSymbolicLink()&&/^[a-f0-9]{64}$/.test(f.name)).slice(0,100)){
   const directory=projectDir+'/batches/'+batchDir.name;
   try{
    const bytes=await readSafe(root,directory+'/batch.json'),batch=JSON.parse(bytes);
    if(hash(bytes)!==batchDir.name||batch.kind!=='ui_skin_generation_batch')throw Error('CHANGED');
    const project=JSON.parse(await readSafe(root,projectDir+'/project.json'));
    if(typeof project.name!=='string'||project.name.length>80)throw Error('NAME');
    if(hash(await readSafe(root,projectDir+'/reference.png'))!==batch.referenceSha256)throw Error('REFERENCE');
    const plan={directory,batchSha256:batchDir.name,sheets:batch.plans,assets:batch.assetCount};
    const generationId=generation.register(plan),state=await generation.action('status',{id:generationId});
    let current=true;
    try{for(const entry of batch.plans)await verifyGenerationPlan({directory:join(root,projectDir,'plans',entry.sha256),planSha256:entry.sha256});}catch{current=false;}
    plans.push({...plan,generationId,name:project.name,status:'readable',current,state});
   }catch{plans.push({name:'校验失败的批次',status:'invalid',projectId:folder.name,batchSha256:batchDir.name});}
  }
 }
 return {plans,truncated:candidates.length>100};
}
