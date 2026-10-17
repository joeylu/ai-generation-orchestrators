import {hash} from '../skins/package.mjs';

/** An appended recovery never replaces the original terminal outcome. */
export function verifyRecoveredResult(bytes,{resultBytes,submissionBytes,planSha256,rawSha256}) {
  const r=JSON.parse(bytes), old=JSON.parse(resultBytes);
  if(old.status!=='indeterminate'||r.kind!=='ui_skin_recovered_result'||r.version!=='1.0'||
    r.planSha256!==planSha256||r.originalResultSha256!==hash(resultBytes)||
    r.submissionSha256!==hash(submissionBytes)||old.submissionSha256!==hash(submissionBytes)||
    r.rawSha256!==rawSha256||r.automaticRetry!==false||r.providerCalls!==0||
    r.audit?.observedRelayCalls!==1||r.audit?.transparentBackground!==true||
    r.audit?.postImageGateVerified!==true||r.audit?.outputBoundToTranscript!==true)
    throw Error('recovery.evidence-binding');
  return r;
}
