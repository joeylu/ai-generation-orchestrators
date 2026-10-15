import {join} from 'node:path';
import {hash,readSafe} from '../skins/package.mjs';
import {verifyRecoveredResult} from './recovered-result.mjs';
import {applySupplements} from './supplement-intake.mjs';

const fail=message=>{throw Error('batch-intake.'+message);};
/** Archival verification, not compute authorization or planning-tool freshness. */
export async function inspectGenerationBatch({skinDirectory,batchSha256,templateSha256,sheets}){
  if(!/^[a-f0-9]{64}$/.test(batchSha256??''))fail('digest-required');
  const evidence=[];
  async function read(file,optional=false){
    let bytes;try{bytes=await readSafe(skinDirectory,file);}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}
    const prior=evidence.find(e=>e.file===file);if(prior&&prior.sha256!==hash(bytes))fail('evidence-changed-during-read');
    if(!prior)evidence.push({file,bytes,sha256:hash(bytes)});return bytes;
  }
  const batchBytes=await read('batches/'+batchSha256+'/batch.json');
  if(hash(batchBytes)!==batchSha256)fail('batch-changed');
  const batch=JSON.parse(batchBytes);
  if(batch.kind!=='ui_skin_generation_batch'||batch.version!=='0.1'||batch.computeAuthorized!==false||!Array.isArray(batch.plans)||batch.plans.length!==sheets.length||new Set(batch.plans.map(p=>p.sheetId)).size!==sheets.length)fail('invalid-batch');
  const authorizationBytes=await read('batches/'+batchSha256+'/authorization.json',true);
  if(authorizationBytes){const a=JSON.parse(authorizationBytes);if(a.kind!=='ui_skin_batch_authorization'||a.version!=='1.0'||a.batchSha256!==batchSha256||a.consumed!==true||a.maxSubmissionsPerPlan!==1||a.automaticRetry!==false||JSON.stringify(a.plans)!==JSON.stringify(batch.plans.map(({sheetId,sha256})=>({sheetId,sha256}))))fail('authorization-binding');}
  const nodes=[],sources=[];let total=0;
  for(const entry of batch.plans){
    const expected=sheets.find(s=>s.id===entry.sheetId);
    if(!expected||!/^[a-f0-9]{64}$/.test(entry.sha256)||entry.assets!==expected.parts.length)fail('sheet-coverage');
    const prefix='plans/'+entry.sha256+'/',planBytes=await read(prefix+'plan.json');
    if(hash(planBytes)!==entry.sha256)fail('plan-changed');
    const plan=JSON.parse(planBytes);
    if(plan.kind!=='ui_skin_generation_plan'||plan.version!=='0.1'||plan.sheetId!==entry.sheetId||plan.assetCount!==entry.assets||plan.bindings?.templateSha256!==templateSha256||!Array.isArray(plan.resources))fail('plan-binding');
    if(plan.resources.find(f=>f.file==='reference.png')?.sha256!==batch.referenceSha256||plan.resources.find(f=>f.file==='inputs/style.json')?.sha256!==batch.styleSha256)fail('reference-style-binding');
    for(const f of plan.resources){
      // Validate resource paths against their own plan root before composing an archive path.
      const b=await readSafe(join(skinDirectory,'plans',entry.sha256),f.file);
      if(b.length!==f.bytes||hash(b)!==f.sha256)fail('resource-changed');
      evidence.push({file:prefix+f.file,bytes:b,sha256:hash(b)});
    }
    total+=entry.assets;
    const a='attempts/'+entry.sha256+'/',reservationBytes=await read(a+'reservation.json',true),receiptBytes=await read(a+'receipt.json',true);
    const node={sheetId:entry.sheetId,planSha256:entry.sha256,status:'awaiting-authorization',automaticRetry:false};
    if(!reservationBytes){
      if(receiptBytes||await read(a+'receive.claim',true)||await read(a+'raw.png',true))fail('missing-reservation');
      if(authorizationBytes)node.status='authorization-incomplete';
      nodes.push(node);continue;
    }
    const reservation=JSON.parse(reservationBytes);
    if(reservation.kind!=='ui_skin_external_attempt_reservation'||reservation.version!=='0.1'||reservation.planSha256!==entry.sha256||reservation.authorization?.consumed!==true||reservation.authorization?.maxSubmissions!==1||reservation.automaticRetry!==false)fail('reservation-binding');
    node.status='reserved-outcome-unknown';
    if(reservation.batchBinding){
      if(!authorizationBytes||reservation.batchBinding.batchSha256!==batchSha256||reservation.batchBinding.authorizationSha256!==hash(authorizationBytes))fail('authorization-binding');
      node.status='authorized-awaiting-external-submission';
      const submissionBytes=await read(a+'submission.json',true),resultBytes=await read(a+'external-result.json',true);
      if(submissionBytes){
        const submission=JSON.parse(submissionBytes);
        if(submission.kind!=='ui_skin_external_submission'||submission.version!=='1.0'||submission.batchSha256!==batchSha256||submission.planSha256!==entry.sha256||submission.reservationSha256!==hash(reservationBytes)||submission.automaticRetry!==false)fail('submission-binding');
        node.status='indeterminate';
        node.submittedAt=submission.createdAt;node.outcomeRecorded=Boolean(resultBytes);
        if(resultBytes){
          const result=JSON.parse(resultBytes);
          if(result.kind!=='ui_skin_external_result'||result.version!=='1.0'||result.submissionSha256!==hash(submissionBytes)||result.automaticRetry!==false||!['returned','failed','indeterminate'].includes(result.status))fail('outcome-binding');
          node.status=result.status==='failed'?'failed':'indeterminate';
          node.finishedAt=result.createdAt;
          if(receiptBytes) {
            const rawSha256=JSON.parse(receiptBytes).raw?.sha256;
            if(result.status==='indeterminate') {
              verifyRecoveredResult(await read(a+'recovered-result.json'),{resultBytes,submissionBytes,planSha256:entry.sha256,rawSha256});
              node.recovered=true;
            } else if(result.status!=='returned'||result.rawSha256!==rawSha256)fail('outcome-receipt-conflict');
          }
        }else if(receiptBytes)fail('missing-outcome');
      }else if(resultBytes||receiptBytes)fail('missing-submission');
    }else if(authorizationBytes)fail('unbound-batch-reservation');
    if(receiptBytes){
      const receipt=JSON.parse(receiptBytes);
      if(receipt.kind!=='ui_skin_external_attempt_receipt'||receipt.version!=='0.1'||receipt.state!=='received'||receipt.planSha256!==entry.sha256||receipt.reservationSha256!==hash(reservationBytes)||receipt.raw?.file!=='raw.png'||receipt.inspection?.file!=='inspection.json'||receipt.automaticRetry!==false)fail('receipt-binding');
      const raw=await read(a+'raw.png'),reportBytes=await read(a+'inspection.json'),claim=JSON.parse(await read(a+'receive.claim'));
      if(hash(raw)!==receipt.raw.sha256||raw.length!==receipt.raw.bytes||hash(reportBytes)!==receipt.inspection.sha256||claim.rawSha256!==hash(raw)||claim.bytes!==raw.length)fail('received-bytes-changed');
      const report=JSON.parse(reportBytes);
      if(report.kind!=='ui_skin_pilot_inspection'||report.planSha256!==entry.sha256||report.rawSha256!==hash(raw)||report.status!==receipt.inspection.status||!['rejected','pixel-gates-passed-awaiting-visual-review'].includes(report.status))fail('inspection-binding');
      Object.assign(node,{status:'received',inspection:report.status,issues:report.issues??[],rawSha256:hash(raw),receivedAt:receipt.receivedAt});
      sources.push({sheetId:entry.sheetId,file:a+'raw.png',sha256:hash(raw),raw});
    }
    nodes.push(node);
  }
  if(total!==batch.assetCount)fail('asset-count');
  await applySupplements({read,batchSha256,nodes,sources});
  const complete=sources.length===sheets.length;
  return {summary:{kind:'ui_skin_batch_intake',version:'1.0',batchSha256,referenceSha256:batch.referenceSha256,styleSha256:batch.styleSha256,
    status:complete?'received-awaiting-localization':nodes.some(n=>['reserved-outcome-unknown','indeterminate','authorization-incomplete'].includes(n.status))?'indeterminate':nodes.some(n=>n.status==='failed')?'failed':authorizationBytes?'authorized-awaiting-external-submission':'awaiting-authorization',nodes,
    originalChecksPassed:complete&&nodes.every(n=>n.inspection!=='rejected'),automaticProviderCalls:false,automaticRetry:false,productionReady:false},sources,evidence};
}
