import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {forkCompletedWorkflow} from '../src/generation/workflow-fork.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {hash} from '../src/generation/common.mjs';

const code=(operation,wanted)=>assert.throws(operation,e=>e.errors?.[0]?.code===wanted);
const originalFiles=workflow=>new Map(['workflow.json',...readdirSync(join(workflow,'events')).map(name=>'events/'+name),
  ...readdirSync(join(workflow,'blobs')).map(name=>'blobs/'+name)].map(name=>[name,hash(readFileSync(join(workflow,name)))]));

test('completed workflow import produces a new verified journal and preserves spent reference authorization',t=>{
  const fixture=setupCoherent(t),before=originalFiles(fixture.workflow),destination=join(fixture.parent,'edge-workflow');
  const proof=forkCompletedWorkflow(fixture.workflow,destination,'edge.fixture');
  const after=flow.inspectWorkflow(destination),original=flow.inspectWorkflow(fixture.workflow);
  assert.equal(proof.sourceModified,false);assert.equal(proof.generationCalls,0);
  assert.equal(proof.importedEventCount,original.eventCount);assert.equal(after.projectId,'edge.fixture');
  assert.notEqual(proof.metadataSha256,proof.sourceMetadataSha256);assert.notEqual(proof.headSha256,proof.sourceHeadSha256);
  assert.deepEqual(after.plans,original.plans);assert.deepEqual(originalFiles(fixture.workflow),before);
  assert.deepEqual(flow.getGenerationResult(destination,fixture.plan.sha256).bytes,fixture.raw);
  code(()=>flow.reservePlan(destination,fixture.plan.sha256),'RESERVATION_STATE');
});

test('planned or authorized unused requests block evidence fork before creating destination',t=>{
  const fixture=setupCoherent(t),batch=flow.freezeCoherentSources(fixture.workflow,fixture.options),destination=join(fixture.parent,'unspent');
  code(()=>forkCompletedWorkflow(fixture.workflow,destination,'edge.unspent'),'WORKFLOW_FORK_INCOMPLETE');
  assert.equal(existsSync(destination),false);
  flow.authorizeReferenceAssetBatch(fixture.workflow,batch.sha256,{decisionId:'fresh.compute',decision:'approve-compute',targetSha256:batch.sha256,notes:'Synthetic exact batch approval.'});
  code(()=>forkCompletedWorkflow(fixture.workflow,destination,'edge.unspent'),'WORKFLOW_FORK_INCOMPLETE');
  assert.equal(existsSync(destination),false);
});

test('corrupt source evidence blocks import before creating destination',t=>{
  const fixture=setupCoherent(t),destination=join(fixture.parent,'corrupt');
  const blob=join(fixture.workflow,'blobs',hash(fixture.raw)+'.bin');writeFileSync(blob,Buffer.from('corrupt'));
  code(()=>forkCompletedWorkflow(fixture.workflow,destination,'edge.corrupt'),'BLOB_INTEGRITY');
  assert.equal(existsSync(destination),false);
});

test('workflow fork rejects nested targets and reused project identity',t=>{
  const fixture=setupCoherent(t);
  code(()=>forkCompletedWorkflow(fixture.workflow,join(fixture.workflow,'nested'),'edge.nested'),'WORKFLOW_FORK_OVERLAP');
  const destination=join(fixture.parent,'identity');
  code(()=>forkCompletedWorkflow(fixture.workflow,destination,flow.inspectWorkflow(fixture.workflow).projectId),'WORKFLOW_FORK_ID');
  assert.equal(existsSync(destination),false);
});
