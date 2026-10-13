#!/usr/bin/env node
/** Deterministic revalidation of saved native outputs. Never invokes a model. */
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {validateCodexReceipt} from '../src/codex-planner.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {checkPanelProposal} from '../src/proposal.mjs';
import {businessFacts} from './lib/input-adaptability-oracle.mjs';

const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const run=resolve(args[1]),output=await createOutputDirectory(args[3]);
const original=await readJson(join(run,'input-adaptability-report.json'));
assert.equal(original.cohort,'repair-v1');assert.equal(original.realModelCalls,8);
const results=[];
for(const item of original.results){
  const directory=join(run,item.id),names=(await readdir(directory)).filter(name=>name.startsWith('codex-'));
  assert.equal(names.length,1);const attempt=join(directory,names[0]);
  const context=await readJson(join(attempt,'planning-context.json')),receipt=await readJson(join(attempt,'codex-receipt.json'));
  validateCodexReceipt(receipt,{contextSha256:context.sha256});assert.deepEqual(receipt,item.receipt);
  const oldProposal=await readJson(join(attempt,'proposal.json'));
  assert.equal(await digestJson(oldProposal),receipt.proposalSha256);
  const raw=await readFile(join(attempt,'panel-intent.json')),intent=JSON.parse(raw);
  const proposal=await materializePanelIntent(context,intent),report=await checkPanelProposal(context,proposal);
  if(item.id==='R03'){
    assert.equal(report.status,'NEEDS_INPUT');assert.equal(proposal.spec,null);
    assert.match(proposal.unresolved[0].question,/玩家名.*玩家名单/u);
  }else{
    assert.equal(item.status,'PASS');assert.equal(report.status,'READY_TO_COMPILE');
    assert.deepEqual(businessFacts(proposal.spec),businessFacts(oldProposal.spec));
  }
  await writeNewJson(output,item.id+'.proposal.json',proposal);
  results.push({id:item.id,originalBusinessStatus:item.status,status:report.status,rawIntentSha256:await digestBytes(raw),
    originalProposalSha256:receipt.proposalSha256,replayedProposalSha256:await digestJson(proposal),questions:proposal.unresolved});
}
const sourceSha256={};for(const file of ['src/input-interpretation.mjs','src/panel-intent.mjs','src/proposal.mjs'])sourceSha256[file]=await digestBytes(await readFile(file));
const result={status:'PASS',kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',realModelCalls:0,originalRealModelCalls:8,
  originalReportSha256:await digestBytes(await readFile(join(run,'input-adaptability-report.json'))),sourceSha256,results};
await writeNewJson(output,'replay-report.json',result);
process.stdout.write(JSON.stringify({status:result.status,realModelCalls:0,ready:results.filter(item=>item.status==='READY_TO_COMPILE').length,needsInput:results.filter(item=>item.status==='NEEDS_INPUT').length})+'\n');
