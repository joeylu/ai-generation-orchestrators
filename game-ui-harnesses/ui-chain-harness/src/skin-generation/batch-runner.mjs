import {writeFile} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute,sep} from 'node:path';
import Ajv from 'ajv';
import themeSchema from '../../schemas/runtime-theme.schema.json' with {type:'json'};
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readContracts} from '../contracts/validate.mjs';
import {defaults} from '../contracts/build.mjs';
import {hash,json,readSafe} from '../skins/package.mjs';
import {inspectGenerationBatch} from './batch-intake.mjs';
import {authorizeBatch,beginSubmission,finishSubmission} from './batch-execution.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),exec=promisify(execFile);
const checkTheme=new Ajv({allErrors:true,strict:true}).compile(themeSchema);
// Reject invalid local postprocessing inputs before consuming batch authorization.
// Pixel-dependent slice checks still belong to the deterministic processing stage.
async function preflightProfile(profile){
  try{
    if(typeof profile!=='string'||!profile)throw Error();
    const work=join(root,'work'),file=relative(work,resolve(root,profile));
    if(!file||isAbsolute(file)||file==='..'||file.startsWith('..'+sep))throw Error();
    const value=JSON.parse(await readSafe(work,file.replaceAll('\\','/')));
    if(value?.kind!=='ui_skin_metadata_profile'||value.version!=='1.0'||typeof value.id!=='string'||!value.id||!Number.isInteger(value.revision)||value.revision<1||!checkTheme(value.theme))throw Error();
    if(value.allowedProposalIssues!==undefined&&(!Array.isArray(value.allowedProposalIssues)||value.allowedProposalIssues.some(i=>i!=='foreign-component-in-slot')))throw Error();
  }catch{throw Error('batch-runner.invalid-profile-before-generation');}
}
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
  return {...summary,execution:'caller-supplied-adapter',adapterCallsThisRun:calls,maxConcurrentSheets,postprocessReady:result.summary.nodes.every(n=>n.status==='received')&&result.sources.length+(result.materialSources?.length??0)===result.summary.nodes.length};
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
  if(args.profile!==undefined)await preflightProfile(args.profile);
  const generation=await executeBatch(args,adapter);
  if(!generation.postprocessReady||!args.profile)return {generation,task:null};
  // Raw quality failures require the same explicit candidate policy as manual intake.
  const task=await postprocessBatch(args);return {generation,task};
}
