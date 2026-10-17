import {hash} from '../skins/package.mjs';

/** Ancestors are supplied only by verified batch intake, never by a UI request. */
export async function verifySupplementRecovery(bytes,{read,node,batchSha256,resultBytes,reservationBytes,rawSha256}){
 const r=JSON.parse(bytes),old=JSON.parse(resultBytes),fail=()=>{throw Error('recovery.supplement-evidence-binding');};
 if(old.status!=='indeterminate'||old.kind!=='ui_skin_supplement_outcome'||
  r.kind!=='ui_skin_supplement_recovery'||r.version!=='1.0'||r.batchSha256!==batchSha256||
  r.planSha256!==node.planSha256||r.originalResultSha256!==hash(resultBytes)||
  r.reservationSha256!==hash(reservationBytes)||old.reservationSha256!==hash(reservationBytes)||
  r.rawSha256!==rawSha256||r.providerCalls!==0||r.automaticRetry!==false||
  ![node.planSha256,...(node.previousPlanSha256s??[])].includes(r.sourcePlanSha256)||
  r.audit?.observedRelayCalls!==1||r.audit?.exactRelayProgram!==true||r.audit?.nestedImageGateVerified!==true||
  r.audit?.postImageGateVerified!==true||r.audit?.transparentBackground!==true||r.audit?.outputBoundToTranscript!==true)fail();
 const prefix=`attempts/${r.sourcePlanSha256}/`,sourceResult=await read(prefix+'external-result.json'),sourceReservation=await read(prefix+'reservation.json');
 if(hash(sourceResult)!==r.sourceResultSha256||hash(sourceReservation)!==r.sourceReservationSha256||JSON.parse(sourceResult).status!=='indeterminate')fail();
 return r;
}

export const recoveryCandidates=node=>[node.planSha256,...(node.previousPlanSha256s??[]).toReversed()];
