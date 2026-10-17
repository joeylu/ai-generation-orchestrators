import {hash} from '../skins/package.mjs';
import {verifySupplementRecovery} from './supplement-recovery.mjs';

/** Follow append-only replacement links; original attempts remain archive evidence. */
export async function applySupplements({read,batchSha256,nodes,sources}) {
 for(const node of nodes){
  const seen=new Set();
  for(let depth=0;;depth++){
   const parent=node.planSha256,linkBytes=await read(`attempts/${parent}/replacement.json`,true);
   if(!linkBytes)break;
   const fail=()=>{throw Error('supplement.invalid-evidence');};
   const rejected=node.status==='received'&&node.inspection==='rejected';
   if(depth>=32||seen.has(parent)||(node.status==='received'&&!rejected))fail();seen.add(parent);
   const priorBytes=await read(`attempts/${parent}/external-result.json`),prior=JSON.parse(priorBytes);
   if(!['failed','indeterminate',...(rejected?['returned']:[])].includes(prior.status))fail();
   const link=JSON.parse(linkBytes),sha=link.planSha256;
   if(link.kind!=='ui_skin_supplement_link'||link.batchSha256!==batchSha256||link.parentPlanSha256!==parent||link.parentResultSha256!==hash(priorBytes)||!/^[a-f0-9]{64}$/.test(sha??''))fail();
   const p=`plans/${sha}/`,planBytes=await read(p+'plan.json'),plan=JSON.parse(planBytes),old=JSON.parse(await read(`plans/${parent}/plan.json`));
   if(hash(planBytes)!==sha||plan.supplement?.parentPlanSha256!==parent||plan.supplement?.batchSha256!==batchSha256||plan.supplement?.parentResultSha256!==hash(priorBytes))fail();
   if(rejected){
    const receiptSha256=hash(await read(`attempts/${parent}/receipt.json`));
    if(link.parentReceiptSha256!==receiptSha256||plan.supplement.parentReceiptSha256!==receiptSha256)fail();
   }else if(link.parentReceiptSha256!==undefined||plan.supplement.parentReceiptSha256!==undefined)fail();
   const {supplement,...base}=plan,{supplement:oldSupplement,...oldBase}=old;
   if(jsonStable(base)!==jsonStable(oldBase))fail();
   for(const f of plan.resources){const b=await read(p+f.file);if(hash(b)!==f.sha256||b.length!==f.bytes)fail();}
   // Superseded rejected bytes remain archive evidence, never an active source.
   if(rejected){const source=sources.findIndex(s=>s.sheetId===node.sheetId);if(source<0)fail();sources.splice(source,1);}
   (node.previousPlanSha256s??=[]).push(parent);
   Object.assign(node,{planSha256:sha,parentPlanSha256:parent,supplement:true,status:'supplement-awaiting-confirmation'});
   delete node.submittedAt;delete node.finishedAt;delete node.receivedAt;delete node.outcomeRecorded;
   delete node.inspection;delete node.issues;delete node.rawSha256;delete node.recovered;delete node.recoveredFromPlanSha256;
   delete node.receptionPending;
   const a=`attempts/${sha}/`,reservationBytes=await read(a+'reservation.json',true),receiptBytes=await read(a+'receipt.json',true),outcomeBytes=await read(a+'external-result.json',true);
   if(!reservationBytes){if(receiptBytes||outcomeBytes)fail();break;}
   const r=JSON.parse(reservationBytes);
   if(r.kind!=='ui_skin_external_attempt_reservation'||r.planSha256!==sha||r.authorization?.consumed!==true||r.authorization?.maxSubmissions!==1||r.automaticRetry!==false||r.batchBinding)fail();
   node.status='indeterminate';
   node.submittedAt=r.createdAt;node.outcomeRecorded=Boolean(outcomeBytes);
   if(!outcomeBytes){if(receiptBytes)fail();break;}
   const outcome=JSON.parse(outcomeBytes);
   if(outcome.kind!=='ui_skin_supplement_outcome'||outcome.planSha256!==sha||outcome.reservationSha256!==hash(reservationBytes)||outcome.automaticRetry!==false||!['returned','indeterminate','failed'].includes(outcome.status))fail();
   node.status=outcome.status==='failed'?'failed':'indeterminate';
   if(outcome.status==='returned'&&!receiptBytes)node.receptionPending=true;
   node.finishedAt=outcome.createdAt;
   if(receiptBytes){
    const r=JSON.parse(receiptBytes),raw=await read(a+'raw.png'),inspectionBytes=await read(a+'inspection.json'),report=JSON.parse(inspectionBytes),claim=JSON.parse(await read(a+'receive.claim'));
    if(outcome.status==='indeterminate'){
     const recovered=await verifySupplementRecovery(await read(a+'recovered-result.json'),{read,node,batchSha256,resultBytes:outcomeBytes,reservationBytes,rawSha256:hash(raw)});
     node.recovered=true;node.recoveredFromPlanSha256=recovered.sourcePlanSha256;
    }else if(outcome.status!=='returned'||outcome.rawSha256!==hash(raw))fail();
    if(r.kind!=='ui_skin_external_attempt_receipt'||r.planSha256!==sha||r.reservationSha256!==hash(reservationBytes)||r.state!=='received'||r.raw?.sha256!==hash(raw)||r.raw.bytes!==raw.length||r.inspection?.sha256!==hash(inspectionBytes)||r.inspection.status!==report.status||report.planSha256!==sha||report.rawSha256!==hash(raw)||!['rejected','pixel-gates-passed-awaiting-visual-review'].includes(report.status)||claim.rawSha256!==hash(raw)||claim.bytes!==raw.length)fail();
    Object.assign(node,{status:'received',inspection:report.status,issues:report.issues??[],rawSha256:hash(raw),receivedAt:r.receivedAt});
    sources.push({sheetId:node.sheetId,file:a+'raw.png',sha256:hash(raw),raw});
   }
  }
 }
}
function jsonStable(value){return JSON.stringify(value);}
