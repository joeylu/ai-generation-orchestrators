#!/usr/bin/env node
/** Reevaluate saved sources with an explicit fixed-request oracle correction.
 * Does not dispatch, recompile, repair, or overwrite any real-generation record. */
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readJson,writeNewJson,createOutputDirectory,harnessRoot } from '../src/io.mjs';
import { digestBytes,digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { materializePanelIntent,validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { QUOTE_RECHECK_SUITE } from '../examples/quote-recheck-v1/suite.mjs';
import { quoteRecheckExpectationVariants,QUOTE_LABEL_CORRECTION } from '../examples/quote-recheck-v2/expectations.mjs';

try {
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--accepted','--output'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[i+1];}
  for(const key of ['--prepared','--run','--accepted','--output'])assert(options[key]&&/^[A-Za-z0-9._/-]+$/.test(options[key])&&!options[key].split('/').some(part=>['','.','..'].includes(part)));
  const original=await readJson(`${options['--prepared']}/quote-recheck-plan.json`),{sha256,...payload}=original;
  assert.equal(await digestJson(payload),sha256);assert.equal(sha256,'b7a3800116d56698a83f5518736698f3cea800e2f8ed830f923eb2e9e7347a40');
  for(const file of original.sourceFiles)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,file.path))),file.sha256);
  const audit=await readJson(options['--accepted']);assert.equal(audit.status,'FAIL');assert.equal(audit.audit,'PASS');assert.equal(audit.planSha256,sha256);assert.equal(audit.actualInvocations,3);assert.equal(audit.automaticRetries,0);
  for(const file of audit.evidence)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,file.path))),file.sha256);
  const core=await loadWorkspaceCore(),source=await readPanelEvaluationRun(options['--run'],core);
  assert.equal(source.plan.sha256,original.generation.sha256);assert.equal(source.report.status,'FAIL');assert.deepEqual(source.suite,QUOTE_RECHECK_SUITE);assert.equal(source.bundles.size,3);
  const correctedSuite=structuredClone(source.suite),cases=[];
  for(let i=0;i<3;i++){
    const item=source.cases[i],bundle=source.bundles.get(item.id);assert.equal(item.model,'READY_TO_COMPILE');assert.equal(item.compile,'PASS');assert.equal(item.receipt.invocationCount,1);assert.equal(item.receipt.automaticRetries,0);
    if(item.id===QUOTE_LABEL_CORRECTION.caseId){assert.equal(item.semantic,'FAIL');assert.deepEqual(item.semanticFailures.map(check=>check.name),['row-order-and-labels','tabs:page-membership','row:加载进度:unique']);}
    else assert.equal(item.semantic,'PASS');
    const directory=`${options['--run']}/${item.id}`,attempts=(await readdir(directory)).filter(name=>/^codex-[a-f0-9-]{36}$/.test(name));assert.equal(attempts.length,1);
    const context=await readJson(`${directory}/${attempts[0]}/planning-context.json`),intent=await readJson(`${directory}/${attempts[0]}/panel-intent.json`);
    assert.equal(intent.panelIntentVersion,'0.8');validateNativePanelIntentEvidence(context,intent);
    assert.deepEqual((await materializePanelIntent(context,intent)).spec,bundle.spec);
    const variants=quoteRecheckExpectationVariants(source.suite.cases[i]),reports=variants.map(expected=>evaluatePanelSemantics(bundle.spec,expected));
    const selectedVariant=reports.findIndex(report=>report.status==='PASS');assert(selectedVariant>=0,'Corrected business expectation still failed');
    correctedSuite.cases[i].expected=variants[selectedVariant];
    cases.push({id:item.id,status:'PASS',originalSemantic:item.semantic,selectedVariant,expectedSha256:await digestJson(variants[selectedVariant]),
      sourceBundleSha256:bundle.sha256,sourceBundleFile:`${directory}/panel.bundle.json`,semantic:reports[selectedVariant]});
  }
  correctedSuite.scope='Saved 0.8 real sources reevaluated under one explicit generic-label oracle correction. Original production FAIL is preserved; no new model requests.';
  const output=await createOutputDirectory(options['--output']);
  await writeNewJson(output,'suite.json',correctedSuite);
  const programSources=['scripts/prepare-request-reference-evidence-recheck.mjs','examples/quote-recheck-v2/expectations.mjs','src/panel-evaluation.mjs','src/panel-evaluation-io.mjs','src/panel-intent.mjs'];
  const sourceFiles=await Promise.all(programSources.map(async path=>({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))})));
  const proofPayload={requestReferenceEvidencePlanVersion:'0.1',status:'SAVED_REAL_BUSINESS_PASS',additionalModelCalls:0,automaticRetries:0,
    originalPlanSha256:sha256,sourceGenerationPlanSha256:source.plan.sha256,sourceRun:options['--run'],sourceAcceptance:options['--accepted'],
    sourceAcceptanceSha256:await digestBytes(await readFile(options['--accepted'])),originalStatus:'FAIL',correction:QUOTE_LABEL_CORRECTION,
    suiteSha256:await digestJson(correctedSuite),cases,sourceFiles,sourceEvidence:audit.evidence,nativeEngines:'NOT_RUN',humanVisualReview:'NOT_RUN',
    scope:'Three original accepted 0.8 responses and bundles remain unchanged. Complete exact oracle alternatives differ only in the generic progress label; other requirements remain strict.'};
  const proof={...proofPayload,sha256:await digestJson(proofPayload)};await writeNewJson(output,'evidence-plan.json',proof);
  console.log(JSON.stringify({status:proof.status,cases:3,additionalModelCalls:0,originalStatus:'FAIL',sha256:proof.sha256,selectedVariants:cases.map(item=>item.selectedVariant)}));
}catch(error){console.error(JSON.stringify({status:'FAIL',code:'SAVED_EVIDENCE_RECHECK_FAILED',additionalModelCalls:0}));process.exitCode=1;}
