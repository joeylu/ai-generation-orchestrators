import {readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {isWithin} from '../files.mjs';
import {initWorkflow,transact} from './store.mjs';
import {replay} from './model.mjs';
import {check,digest,id,seal} from './common.mjs';

// A new journal is produced by the deterministic store from already verified
// records. Spent authorizations stay spent. A live or unused authorization must
// never be duplicated into another workspace.
export function forkCompletedWorkflow(sourceRoot,outputRoot,projectId){
  id(projectId);const source=resolve(sourceRoot),output=resolve(outputRoot);
  check(!isWithin(source,output)&&!isWithin(output,source),'WORKFLOW_FORK_OVERLAP');
  return transact(source,store=>{
    const state=replay(store);
    check(projectId!==store.metadata.projectId,'WORKFLOW_FORK_ID');
    check([...state.plans.values()].every(entry=>['accepted','pending-visual-review','rejected-technical','rejected-visual','failed','indeterminate'].includes(entry.status)),
      'WORKFLOW_FORK_INCOMPLETE','Finish or stop all unspent plans before importing a completed evidence snapshot');
    const records=store.events.map(event=>event.record);
    const blobs=readdirSync(join(source,'blobs')).map(name=>{
      check(/^[a-f0-9]{64}\.bin$/.test(name),'WORKFLOW_FORK_BLOB');
      const sha256=name.slice(0,-4);return {sha256,bytes:store.readBlob(sha256)};
    });
    const metadata=initWorkflow(output,{projectId,purpose:store.metadata.purpose,compiler:store.metadata.compiler});
    let head;
    transact(output,destination=>{
      for(const {bytes}of blobs)destination.storeBlob(bytes);
      for(const record of records)destination.append(record);
      const imported=replay(destination);
      check(imported.plans.size===state.plans.size&&imported.batches.size===state.batches.size,'WORKFLOW_FORK_REPLAY');
      head=destination.events.at(-1)?.sha256??metadata.sha256;
    });
    return seal({format:'ai_scene_completed_workflow_import_v1',sourceProjectId:store.metadata.projectId,projectId,
      sourceMetadataSha256:store.metadata.sha256,sourceHeadSha256:store.events.at(-1)?.sha256??store.metadata.sha256,
      sourceRecordSetSha256:digest(records),metadataSha256:metadata.sha256,headSha256:head,
      importedEventCount:records.length,importedBlobCount:blobs.length,sourceModified:false,
      authorizationPolicy:'only-completed-evidence-no-unspent-authorization',generationCalls:0,visualAcceptance:'not-assessed'});
  });
}
