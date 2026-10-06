/** Source and preparation verification for finite edit-chain execution; no inference. */
import assert from 'node:assert/strict';
import { readFile,readdir,lstat } from 'node:fs/promises';
import { resolve,dirname,relative } from 'node:path';
import { readJson,harnessRoot } from '../src/io.mjs';
import { digestJson,digestBytes } from '../src/canonical.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { materializePanelIntent,validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePanelEditContext } from '../src/edit-planning.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { EDIT_CHAIN_STEPS,EDIT_CHAIN_POLICY } from '../examples/edit-chain-v1/suite.mjs';

export async function readChainOrigin({run,acceptance},core) {
  const source=await readPanelEvaluationRun(run,core),item=source.cases.find(value=>value.id==='eval-audio');
  assert.equal(item.status,'PASS_BEFORE_BROWSER');assert.equal(item.receipt.invocationCount,1);assert.equal(item.receipt.automaticRetries,0);
  const bundle=await validatePanelBundle(source.bundles.get(item.id),core),review=await readJson(acceptance);
  assert.equal(review.status,'PASS');assert.equal(review.audit,'PASS');assert.equal(review.acceptanceKind,'saved-real-source-two-round-recheck');
  const roundId=run.split('/').at(-2),round=review.rounds.find(value=>value.id===roundId);
  assert(round);assert.equal(round.sourceGenerationPlanSha256,source.plan.sha256);
  assert.equal(round.cases.find(value=>value.id===item.id).sourceBundleSha256,bundle.sha256);
  const parent=`${run}/${item.id}`,names=(await readdir(parent)).filter(name=>/^codex-[a-f0-9-]{36}$/.test(name));assert.equal(names.length,1);
  const producer=`${parent}/${names[0]}`,context=await readJson(`${producer}/planning-context.json`),intent=await readJson(`${producer}/panel-intent.json`);
  assert.equal(intent.panelIntentVersion,'0.8');validateNativePanelIntentEvidence(context,intent);
  const proposal=await materializePanelIntent(context,intent);assert.deepEqual(proposal,await readJson(`${producer}/proposal.json`));assert.deepEqual(proposal.spec,bundle.spec);
  const paths=[acceptance,`${run}/evaluation-plan.json`,`${run}/evaluation-report.json`,`${run}/suite.json`,
    `${parent}/case-result.json`,`${parent}/semantic-report.json`,`${parent}/panel.bundle.json`,
    ...['planning-context.json','panel-intent.json','proposal.json','planning-report.json','codex-receipt.json'].map(name=>`${producer}/${name}`)];
  const evidence=await Promise.all(paths.map(async path=>({path,sha256:await digestBytes(await readFile(path))})));
  return {bundle,origin:{run,acceptance,roundId,caseId:item.id,generationPlanSha256:source.plan.sha256,
    sourceBundleSha256:bundle.sha256,receiptSha256:await digestJson(item.receipt),contextSha256:context.sha256,intentSha256:await digestJson(intent),evidence}};
}
export async function verifyChainBuild(reference) {
  const build=await readJson(reference.file);assert.equal(await digestJson(build),reference.sha256);
  for(const file of build.files){const bytes=await readFile(resolve(dirname(reference.file),file.path));assert.equal(bytes.length,file.bytes);assert.equal(await digestBytes(bytes),file.sha256);}
  return build;
}
export async function verifyChainPrepared(input,core) {
  const prepared=resolve(input),rel=relative(resolve(harnessRoot),prepared);assert(rel&&!rel.startsWith('..'));
  for(let path=prepared;;path=dirname(path)){assert(!(await lstat(path)).isSymbolicLink());if(dirname(path)===path)break;}
  const plan=await readJson(resolve(prepared,'edit-chain-plan.json')),{sha256,...payload}=plan;
  assert.equal(await digestJson(payload),sha256);assert.equal(plan.editChainPlanVersion,'0.1');assert.equal(plan.status,'PREPARED');
  assert.equal(plan.authorization,'REQUIRED_NOT_GRANTED');assert.deepEqual(plan.policy,EDIT_CHAIN_POLICY);assert.deepEqual(plan.edit.steps,EDIT_CHAIN_STEPS);
  assert.equal(plan.modelCalls,0);assert.equal(plan.edit.maxInvocations,10);assert.deepEqual(plan.protocol,await evaluationProtocolFingerprint());
  for(const file of [...plan.sourceFiles,...plan.origin.evidence,...plan.fixtureEvidence])assert.equal(await digestBytes(await readFile(resolve(harnessRoot,file.path))),file.sha256);
  const current=await readChainOrigin(plan.origin,core);assert.deepEqual(current.origin,plan.origin);
  const source=await validatePanelBundle(await readJson(resolve(prepared,plan.edit.sourceFile)),core),trial=await validatePanelBundle(await readJson(resolve(prepared,plan.edit.trialFile)),core);
  assert.deepEqual(source,current.bundle);assert.equal(source.sha256,plan.edit.sourceSha256);assert.equal(trial.sha256,plan.edit.trialSha256);assert.deepEqual(source.spec,trial.spec);
  const first=await validatePanelEditContext(await readJson(resolve(prepared,plan.edit.firstContextFile)));
  assert.equal(first.sha256,plan.edit.firstContextSha256);assert.deepEqual(first.request,EDIT_CHAIN_STEPS[0].request);assert.deepEqual(first.spec,trial.spec);
  const schema=await buildCodexEditResponseSchema({draft:true,context:first});assert.deepEqual(schema,await readJson(resolve(prepared,plan.edit.firstResponseSchemaFile)));
  assert.equal(await digestJson(schema),plan.edit.firstResponseSchemaSha256);
  const simulation=await readJson(resolve(prepared,'driver-simulation.json')),qa=await readJson(resolve(prepared,'fixture-browser/browser-report.json'));
  assert.equal(simulation.status,'FIXTURE_PASS');assert.equal(simulation.modelCalls,0);assert.equal(simulation.totals.passed,10);assert.equal(simulation.fullUndo,'PASS');
  assert.equal(qa.status,'FIXTURE_PASS');assert.equal(qa.evidence,'DRIVER_FIXTURE');assert.equal(qa.modelCalls,0);assert.equal(qa.totals.passed,10);assert.equal(qa.deliveries.length,10);
  const build=await verifyChainBuild(plan.build);await assert.rejects(lstat(resolve(prepared,'dispatch-claim.json')),{code:'ENOENT'});
  return {prepared,plan,source,trial,first,build};
}
