import {mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,json,readSafe} from '../skins/package.mjs';
import {defaults} from '../contracts/build.mjs';
import {readContracts} from '../contracts/validate.mjs';
import {inspectGenerationBatch} from './batch-intake.mjs';
import {verifyGenerationPlan} from './plan.mjs';
import {reserveAttempt,receiveAttempt} from './attempt.mjs';
import {requestFor} from './batch-runner.mjs';
async function inspect(args){const c=await readContracts(args.contracts??defaults);return inspectGenerationBatch({...args,templateSha256:hash(c.bytes.template),sheets:c.template.sheets});}
export async function prepareSupplement(args){
 const intake=await inspect(args),node=intake.summary.nodes.find(n=>n.sheetId===args.sheetId);
 if(!node)throw Error('supplement.unknown-sheet');
 if(node.status==='supplement-awaiting-confirmation')return {sheetId:node.sheetId,planSha256:node.planSha256};
 const rejected=node.status==='received'&&node.inspection==='rejected';
 if(!rejected&&!['indeterminate','failed'].includes(node.status))throw Error('supplement.only-missing-or-rejected-terminal-sheet');
 const parent=node.planSha256,oldDir=join(args.skinDirectory,'plans',parent);
 await verifyGenerationPlan({directory:oldDir,planSha256:parent,contracts:args.contracts??defaults});
 const priorBytes=await readSafe(args.skinDirectory,`attempts/${parent}/external-result.json`),prior=JSON.parse(priorBytes);
 if(!['indeterminate','failed',...(rejected?['returned']:[])].includes(prior.status))throw Error('supplement.terminal-outcome-required');
 const parentReceiptSha256=rejected?hash(await readSafe(args.skinDirectory,`attempts/${parent}/receipt.json`)):undefined;
 const original=JSON.parse(await readSafe(oldDir,'plan.json'));
 const plan={...original,supplement:{batchSha256:args.batchSha256,parentPlanSha256:parent,parentResultSha256:hash(priorBytes),...(rejected?{parentReceiptSha256}:{}),nonce:randomUUID()}},bytes=Buffer.from(json(plan)),sha=hash(bytes),dir=join(args.skinDirectory,'plans',sha);
 await mkdir(dir);
 for(const f of plan.resources){const b=await readSafe(oldDir,f.file);if(hash(b)!==f.sha256)throw Error('supplement.changed-input');await mkdir(dirname(join(dir,f.file)),{recursive:true});await writeFile(join(dir,f.file),b,{flag:'wx'});}
 await writeFile(join(dir,'plan.json'),bytes,{flag:'wx'});
 await verifyGenerationPlan({directory:dir,planSha256:sha,contracts:args.contracts??defaults});
 await writeFile(join(args.skinDirectory,'attempts',parent,'replacement.json'),json({kind:'ui_skin_supplement_link',batchSha256:args.batchSha256,parentPlanSha256:parent,parentResultSha256:hash(priorBytes),...(rejected?{parentReceiptSha256}:{}),planSha256:sha}),{flag:'wx'});
 return {sheetId:node.sheetId,planSha256:sha};
}
export async function executeSupplement(args,adapter){
 const intake=await inspect(args),node=intake.summary.nodes.find(n=>n.sheetId===args.sheetId);
 if(!node||node.status!=='supplement-awaiting-confirmation'||args.confirmed!==node.planSha256)throw Error('supplement.fresh-confirmation-required');
 const request=requestFor(intake,node),sha=node.planSha256,planDirectory=join(args.skinDirectory,'plans',sha);
 const reservation=await reserveAttempt({planDirectory,planSha256:sha,confirmedPlanSha256:args.confirmed,output:join(args.skinDirectory,'attempts'),contracts:args.contracts??defaults});
 const directory=reservation.directory,reservationSha256=hash(await readSafe(directory,'reservation.json'));
 let bytes;try{bytes=await adapter.generate(request);if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>32*1024*1024)throw Error('invalid');}catch{
  await writeFile(join(directory,'external-result.json'),json({kind:'ui_skin_supplement_outcome',planSha256:sha,reservationSha256,status:'indeterminate',automaticRetry:false}),{flag:'wx'});
  return {status:'indeterminate',automaticRetry:false};
 }
 await writeFile(join(directory,'adapter-output.png'),bytes,{flag:'wx'});
 await writeFile(join(directory,'external-result.json'),json({kind:'ui_skin_supplement_outcome',planSha256:sha,reservationSha256,status:'returned',rawSha256:hash(bytes),automaticRetry:false}),{flag:'wx'});
 await receiveAttempt({planDirectory,planSha256:sha,directory,raw:join(directory,'adapter-output.png')});
 return {status:'received',sheetId:node.sheetId,adapterCalls:1};
}
