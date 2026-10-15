import {writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readContracts} from '../contracts/validate.mjs';
import {defaults} from '../contracts/build.mjs';
import {hash,json} from '../skins/package.mjs';
import {inspectGenerationBatch} from './batch-intake.mjs';
import {authorizeBatch,beginSubmission,finishSubmission} from './batch-execution.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),exec=promisify(execFile);
function concurrencyFor(args){const value=args.maxConcurrentSheets===undefined?1:args.maxConcurrentSheets;if(![1,2].includes(value))throw Error('batch-runner.invalid-concurrency');return value;}
async function inspect(args){const c=await readContracts(args.contracts??defaults);return inspectGenerationBatch({...args,templateSha256:hash(c.bytes.template),sheets:c.template.sheets});}
export function requestFor(intake,node){
  const prefix='plans/'+node.planSha256+'/',bytes=file=>{
    const f=intake.evidence.find(f=>f.file===prefix+file);if(!f)throw Error('batch-runner.missing-frozen-resource');return Buffer.from(f.bytes);
  };
  const plan=JSON.parse(bytes('plan.json'));
  const images=[{role:'style-reference',bytes:bytes('reference.png')},{role:'geometry-template',bytes:bytes('template.clean.png')}].map(i=>({...i,sha256:hash(i.bytes)}));
  const request={prompt:bytes('prompt.txt').toString('utf8'),images,width:plan.request.width,height:plan.request.height,output:{format:'png',transparentBackground:true},sheetId:node.sheetId,planSha256:node.planSha256};
  request.requestSha256=hash(json({...request,images:images.map(({role,sha256})=>({role,sha256}))}));
  return request;
}
/** Optional adapter contract: generate(frozenRequest) -> Uint8Array. Parallel calls require explicit opt-in; no retries. */
export async function runAuthorizedBatch(args,adapter){
  if(!adapter||typeof adapter.generate!=='function')throw Error('batch-runner.adapter-required');
  const maxConcurrentSheets=concurrencyFor(args);
  const initial=await inspect(args),requests=new Map(initial.summary.nodes.map(n=>[n.sheetId,requestFor(initial,n)]));
  if(initial.summary.nodes.some(n=>['awaiting-authorization','authorization-incomplete'].includes(n.status)))throw Error('batch-runner.complete-authorization-required');
  let calls=0;
  // Received and terminal/unknown sheets are never submitted again. Untouched siblings may proceed.
  const pending=initial.summary.nodes.filter(n=>n.status==='authorized-awaiting-external-submission');
  const runOne=async node=>{
    const one={...args,sheetId:node.sheetId};
    await beginSubmission(one);
    let bytes;
    try{calls++;bytes=await adapter.generate(requests.get(node.sheetId));}
    catch{await finishSubmission({...one,status:'indeterminate'});return;}
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>32*1024*1024){await finishSubmission({...one,status:'indeterminate'});return;}
    // Preserve even an invalid PNG. Existing receive/inspection owns the quality decision.
    const directory=join(args.skinDirectory,'attempts',node.planSha256);
    try{
      await writeFile(join(directory,'adapter-output.png'),Buffer.from(bytes),{flag:'wx'});
      await finishSubmission({...one,status:'returned',rawDirectory:directory,rawFile:'adapter-output.png'});
    }catch{throw Error('batch-runner.reception-incomplete-no-resubmit');}
  };
  let cursor=0,fatal=null;
  const worker=async()=>{
    while(!fatal){
      const node=pending[cursor++];if(!node)return;
      try{await runOne(node);}catch(error){fatal??=error;return;}
    }
  };
  // A local claim/receipt failure stops scheduling, but wait for every started call to settle.
  // Otherwise Studio could release its busy guard while a sibling still consumes compute.
  await Promise.all(Array.from({length:Math.min(maxConcurrentSheets,pending.length)},()=>worker()));
  if(fatal)throw fatal;
  const result=await inspect(args);
  const {automaticProviderCalls,...summary}=result.summary;
  return {...summary,execution:'caller-supplied-adapter',adapterCallsThisRun:calls,maxConcurrentSheets,postprocessReady:result.sources.length===result.summary.nodes.length};
}
/** One fresh human confirmation, then all sheets, without per-sheet confirmation. */
export async function executeBatch(args,adapter){
  if(!adapter||typeof adapter.generate!=='function')throw Error('batch-runner.adapter-required');
  const maxConcurrentSheets=concurrencyFor(args);
  const intake=await inspect(args);for(const n of intake.summary.nodes)requestFor(intake,n);
  await authorizeBatch(args);
  return runAuthorizedBatch({...args,maxConcurrentSheets},adapter);
}
/** Deterministic handoff: no adapter or model call, safe to retry as a new candidate task. */
export async function postprocessBatch({skinDirectory,batchSha256,profile,allowRejectedLocalization=false}){
  const batch=relative(root,join(skinDirectory,'batches',batchSha256));
  const command=async args=>{
    try{return JSON.parse((await exec(process.execPath,[join(root,'scripts/skin-task.mjs'),...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:300000})).stdout);}
    catch{throw Error('batch-runner.postprocess-failed-see-task-evidence');}
  };
  const task=await command(['create','--batch',batch,'--sha256',batchSha256,'--profile',profile,...(allowRejectedLocalization?['--allow-rejected-localization']:[])]);
  try{return await command(['resume','--directory',task.directory]);}
  catch{throw Object.assign(Error('batch-runner.postprocess-failed-resume-task'),{taskDirectory:task.directory});}
}
export async function executeBatchPipeline(args,adapter){
  const generation=await executeBatch(args,adapter);
  if(!generation.postprocessReady||!args.profile)return {generation,task:null};
  // Raw quality failures require the same explicit candidate policy as manual intake.
  const task=await postprocessBatch(args);return {generation,task};
}
