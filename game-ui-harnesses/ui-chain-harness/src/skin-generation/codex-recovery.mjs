import {join,resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {hash,json,readSafe} from '../skins/package.mjs';
import {defaults} from '../contracts/build.mjs';
import {readContracts} from '../contracts/validate.mjs';
import {inspectGenerationBatch} from './batch-intake.mjs';
import {requestFor} from './batch-runner.mjs';
import {receiveAttempt} from './attempt.mjs';
import {recoveryCandidates,verifySupplementRecovery} from './supplement-recovery.mjs';
import {loadRelayRequest} from '../../../ui-reference-harness/web/adapters/codex-relay-contract.mjs';
import {findRelayLog,readRelayWindow,relayOutputs,verifyRelayAudit} from '../../../ui-reference-harness/web/adapters/codex-relay-session.mjs';

export function verifyCompletedImage(entries, image, bytes) {
  const images=entries.filter(e=>e.type==='event_msg'&&e.payload?.type==='item_completed')
    .map(e=>e.payload.item).filter(i=>i?.type==='Extension'&&i.savedPath);
  if(images.length!==1)throw Error('recovery.output-ambiguous');
  const output=images[0];
  if(output.id!==image.toolUseId||output.status!=='completed'||output.failure||
    output.transparentBackground!==true||typeof output.result!=='string'||
    hash(Buffer.from(output.result,'base64'))!==hash(bytes))throw Error('recovery.output-not-bound');
  return output;
}

/** Read-only verification of a single exact attempt, including a completed image after a failed CLI tail. */
async function verifyCandidate({intake,planSha256,sheetId,relayRoot,home}) {
  const frozen=requestFor(intake,{planSha256,sheetId}),job=join(relayRoot,planSha256);
  const read=async file=>JSON.parse(await readSafe(job,file));
  const dispatch=await read('dispatch.json'),session=await read('session-result.json');
  if(dispatch.resumingSession!==false||dispatch.attemptSha256!==planSha256||dispatch.requestSha256!==frozen.requestSha256||dispatch.automaticResubmissions!==0||session.automaticResubmissions!==0)throw Error('recovery.dispatch-binding');
  const request=loadRelayRequest(job,dispatch.payloadSha256);
  if(request.requestSha256!==frozen.requestSha256||request.attemptSha256!==planSha256||request.arguments.prompt!==frozen.prompt||request.arguments.transparent_background!==true||request.images.length!==frozen.images.length||request.images.some((im,i)=>im.sha256!==frozen.images[i].sha256))throw Error('recovery.request-binding');
  const entries=readRelayWindow(findRelayLog(home,session.sessionId));
  const audit=verifyRelayAudit(job,request,dispatch.payloadSha256,session.sessionId,entries,{model:dispatch.model,effort:dispatch.effort});
  const bytes=await readSafe(job,'original-output-1.png'),output=verifyCompletedImage(entries,await read('image-call.json'),bytes);
  const outputs=relayOutputs(home,session.sessionId);
  if(outputs.size!==1||outputs.get(resolve(output.savedPath))!==hash(bytes))throw Error('recovery.saved-output-binding');
  return {bytes,audit:{...audit,outputBoundToTranscript:true},planSha256,raw:join(job,'original-output-1.png')};
}

/** The validated replacement lineage proves identical frozen inputs; latest usable image wins. */
export async function findRecoverableCodexImage({intake,node,relayRoot,home}){
 if(node.status!=='indeterminate'||!node.outcomeRecorded)return null;
 for(const planSha256 of recoveryCandidates(node)){
  const outcome=intake.evidence.find(e=>e.file===`attempts/${planSha256}/external-result.json`);
  if(!outcome||JSON.parse(outcome.bytes).status!=='indeterminate')continue;
  try{return await verifyCandidate({intake,planSha256,sheetId:node.sheetId,relayRoot,home});}catch{/* Try only verified ancestors, never another batch or sheet. */}
 }
 return null;
}

/** Explicit local-only recovery. No runner, generation adapter, network or resubmission. */
export async function recoverCodexSheet({skinDirectory,batchSha256,sheetId,relayRoot,home,contracts=defaults}) {
  const c=await readContracts(contracts),inspectArgs={skinDirectory,batchSha256,templateSha256:hash(c.bytes.template),sheets:c.template.sheets},intake=await inspectGenerationBatch(inspectArgs);
  const node=intake.summary.nodes.find(n=>n.sheetId===sheetId);
  if(!node||node.status!=='indeterminate'||!node.outcomeRecorded)throw Error('recovery.indeterminate-sheet-required');
  const candidate=await findRecoverableCodexImage({intake,node,relayRoot,home});
  if(!candidate)throw Error('recovery.no-verified-image');
  // A new replacement or receipt created during verification invalidates this operation.
  const latest=(await inspectGenerationBatch(inspectArgs)).summary.nodes.find(n=>n.sheetId===sheetId);
  if(latest.planSha256!==node.planSha256||latest.status!=='indeterminate'||!latest.outcomeRecorded)throw Error('recovery.state-changed');
  const {bytes,audit}=candidate,directory=join(skinDirectory,'attempts',node.planSha256);
  if(node.supplement){
   const read=file=>readSafe(skinDirectory,file),resultBytes=await read(`attempts/${node.planSha256}/external-result.json`),reservationBytes=await read(`attempts/${node.planSha256}/reservation.json`);
   const recovery={kind:'ui_skin_supplement_recovery',version:'1.0',batchSha256,planSha256:node.planSha256,
    originalResultSha256:hash(resultBytes),reservationSha256:hash(reservationBytes),rawSha256:hash(bytes),
    sourcePlanSha256:candidate.planSha256,sourceResultSha256:hash(await read(`attempts/${candidate.planSha256}/external-result.json`)),sourceReservationSha256:hash(await read(`attempts/${candidate.planSha256}/reservation.json`)),
    audit,providerCalls:0,automaticRetry:false,createdAt:new Date().toISOString()};
   await verifySupplementRecovery(json(recovery),{read,node,batchSha256,resultBytes,reservationBytes,rawSha256:hash(bytes)});
   await writeFile(join(directory,'recovered-result.json'),json(recovery),{flag:'wx'});
   const received=await receiveAttempt({planDirectory:join(skinDirectory,'plans',node.planSha256),planSha256:node.planSha256,directory,raw:candidate.raw});
   return {sheetId,recovered:true,recoveredFromPlanSha256:candidate.planSha256,providerCalls:0,automaticRetry:false,...received};
  }
  const resultBytes=await readSafe(directory,'external-result.json'),submissionBytes=await readSafe(directory,'submission.json');
  const previous=JSON.parse(resultBytes),submission=JSON.parse(submissionBytes);
  if(previous.status!=='indeterminate'||previous.submissionSha256!==hash(submissionBytes)||submission.planSha256!==node.planSha256)throw Error('recovery.outcome-binding');
  const recovery={kind:'ui_skin_recovered_result',version:'1.0',planSha256:node.planSha256,
    originalResultSha256:hash(resultBytes),submissionSha256:hash(submissionBytes),rawSha256:hash(bytes),
    audit,providerCalls:0,automaticRetry:false,createdAt:new Date().toISOString()};
  await writeFile(join(directory,'recovered-result.json'),json(recovery),{flag:'wx'});
  const received=await receiveAttempt({planDirectory:join(skinDirectory,'plans',node.planSha256),planSha256:node.planSha256,directory,raw:candidate.raw});
  return {sheetId,recovered:true,providerCalls:0,automaticRetry:false,...received};
}
