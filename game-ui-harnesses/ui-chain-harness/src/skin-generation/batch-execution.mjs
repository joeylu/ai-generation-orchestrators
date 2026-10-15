import {writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,json,readSafe} from '../skins/package.mjs';
import {readContracts} from '../contracts/validate.mjs';
import {defaults} from '../contracts/build.mjs';
import {inspectGenerationBatch} from './batch-intake.mjs';
import {verifyGenerationPlan} from './plan.mjs';
import {reserveAttempt,receiveAttempt} from './attempt.mjs';

const fail=m=>{throw Error('batch-execution.'+m);};
async function absent(file){try{await lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}fail('already-claimed-no-retry');}
export async function authorizeBatch({skinDirectory,batchSha256,confirmedBatchSha256,contracts=defaults}){
  if(confirmedBatchSha256!==batchSha256)fail('fresh-batch-confirmation-required');
  const source=await readContracts(contracts);
  const checked=await inspectGenerationBatch({skinDirectory,batchSha256,templateSha256:hash(source.bytes.template),sheets:source.template.sheets});
  if(checked.summary.nodes.some(n=>n.status!=='awaiting-authorization'))fail('already-reserved');
  const plans=checked.summary.nodes.map(n=>({sheetId:n.sheetId,sha256:n.planSha256}));
  for(const p of plans){
    await absent(join(skinDirectory,'attempts',p.sha256));
    await verifyGenerationPlan({directory:join(skinDirectory,'plans',p.sha256),planSha256:p.sha256,contracts});
  }
  // Consume the entire confirmation before creating reservations. Partial failure is never replayed.
  const authorization={kind:'ui_skin_batch_authorization',version:'1.0',batchSha256,plans,consumed:true,maxSubmissionsPerPlan:1,automaticRetry:false,createdAt:new Date().toISOString()};
  const bytes=Buffer.from(json(authorization));
  await writeFile(join(skinDirectory,'batches',batchSha256,'authorization.json'),bytes,{flag:'wx'});
  for(const p of plans)await reserveAttempt({planDirectory:join(skinDirectory,'plans',p.sha256),planSha256:p.sha256,output:join(skinDirectory,'attempts'),confirmedPlanSha256:p.sha256,contracts,batchBinding:{batchSha256,authorizationSha256:hash(bytes)}});
  return {status:'authorized-awaiting-external-submission',batchSha256,sheets:plans.length,automaticProviderCalls:false};
}
async function context({skinDirectory,batchSha256,sheetId}){
  if(!/^[a-f0-9]{64}$/.test(batchSha256??''))fail('invalid-digest');
  const batchBytes=await readSafe(skinDirectory,`batches/${batchSha256}/batch.json`);
  if(hash(batchBytes)!==batchSha256)fail('batch-changed');
  const batch=JSON.parse(batchBytes),p=batch.plans.find(p=>p.sheetId===sheetId);
  if(!p||!/^[a-f0-9]{64}$/.test(p.sha256))fail('unknown-sheet');
  const authorizationBytes=await readSafe(skinDirectory,`batches/${batchSha256}/authorization.json`),authorization=JSON.parse(authorizationBytes);
  if(authorization.kind!=='ui_skin_batch_authorization'||authorization.version!=='1.0'||authorization.batchSha256!==batchSha256||authorization.consumed!==true||authorization.maxSubmissionsPerPlan!==1||authorization.automaticRetry!==false||JSON.stringify(authorization.plans)!==JSON.stringify(batch.plans.map(({sheetId,sha256})=>({sheetId,sha256}))))fail('authorization-binding');
  for(const entry of authorization.plans){
    if(!/^[a-f0-9]{64}$/.test(entry.sha256))fail('invalid-plan');
    const r=JSON.parse(await readSafe(skinDirectory,`attempts/${entry.sha256}/reservation.json`));
    if(r.kind!=='ui_skin_external_attempt_reservation'||r.planSha256!==entry.sha256||r.authorization?.consumed!==true||r.authorization?.maxSubmissions!==1||r.batchBinding?.batchSha256!==batchSha256||r.batchBinding?.authorizationSha256!==hash(authorizationBytes))fail('incomplete-batch-reservations');
  }
  const directory=join(skinDirectory,'attempts',p.sha256),reservationBytes=await readSafe(directory,'reservation.json'),reservation=JSON.parse(reservationBytes);
  if(reservation.planSha256!==p.sha256||reservation.batchBinding?.batchSha256!==batchSha256||reservation.batchBinding?.authorizationSha256!==hash(authorizationBytes))fail('reservation-binding');
  return {directory,p,reservationBytes};
}
/** Claim BEFORE the external call. A second claim never permits a second call. */
export async function beginSubmission(args){
  const c=await context(args);
  await verifyGenerationPlan({directory:join(args.skinDirectory,'plans',c.p.sha256),planSha256:c.p.sha256,contracts:args.contracts??defaults});
  await absent(join(c.directory,'external-result.json'));await absent(join(c.directory,'receipt.json'));
  const submission={kind:'ui_skin_external_submission',version:'1.0',batchSha256:args.batchSha256,planSha256:c.p.sha256,reservationSha256:hash(c.reservationBytes),state:'claimed-before-external-call',automaticRetry:false,createdAt:new Date().toISOString()};
  await writeFile(join(c.directory,'submission.json'),json(submission),{flag:'wx'});
  return {status:'claimed-before-external-call',sheetId:c.p.sheetId,planSha256:c.p.sha256,automaticProviderCalls:false,automaticRetry:false};
}
/** Caller reports the observed external outcome; no provider response or secrets are logged. */
export async function finishSubmission(args){
  if(!['failed','indeterminate','returned'].includes(args.status))fail('invalid-outcome');
  const c=await context(args),submissionBytes=await readSafe(c.directory,'submission.json'),submission=JSON.parse(submissionBytes);
  if(submission.kind!=='ui_skin_external_submission'||submission.planSha256!==c.p.sha256||submission.batchSha256!==args.batchSha256||submission.reservationSha256!==hash(c.reservationBytes))fail('submission-binding');
  const raw=args.status==='returned'?await readSafe(args.rawDirectory,args.rawFile):null;
  const outcome={kind:'ui_skin_external_result',version:'1.0',status:args.status,submissionSha256:hash(submissionBytes),...(raw?{rawSha256:hash(raw)}:{}),automaticRetry:false,createdAt:new Date().toISOString()};
  // All terminal outcomes compete for the same exclusive file, including concurrent receptions.
  await writeFile(join(c.directory,'external-result.json'),json(outcome),{flag:'wx'});
  if(raw)return receiveAttempt({planDirectory:join(args.skinDirectory,'plans',c.p.sha256),planSha256:c.p.sha256,directory:c.directory,raw:join(args.rawDirectory,args.rawFile)});
  return {status:args.status,sheetId:c.p.sheetId,automaticRetry:false};
}
