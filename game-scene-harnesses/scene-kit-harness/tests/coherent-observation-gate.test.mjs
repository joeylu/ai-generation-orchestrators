import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {hash} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,referencePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

function fixture(t){
  const parent=mkdtempSync(join(tmpdir(),'scene-observation-gate-')),root=join(parent,'project');
  t.after(()=>{const rel=relative(resolve(tmpdir()),resolve(parent));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('temp path');rmSync(parent,{recursive:true,force:true});});
  const brief=coherentBrief(),initial=pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation'});
  pipeline.reviewCoherentDesign(root,{spec:decision('gate.spec',initial.design.specSha256),style:decision('gate.style',initial.design.styleSha256)});
  const status=pipeline.inspectCoherentPipeline(root),workflow=join(root,'workflow'),plan=flow.getGenerationPlan(workflow,status.reference.planSha256);
  pipeline.authorizeCoherentStage(root,decision('gate.ref.compute',plan.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(workflow,plan.sha256);flow.recordSubmission(workflow,ticket);const bytes=referencePng();flow.receiveResult(workflow,ticket,bytes);
  const analysis=coherentAnalysis(plan,hash(bytes),brief.requirements),packet=pipeline.prepareCoherentReferenceReview(root,analysis,join(parent,'review'));
  return {root,parent,workflow,analysis,receipt:decision('gate.reference.accept',packet.packetSha256)};
}

test('opt-in reference coverage stops advance, authorize and driver before source freezing',{timeout:180000},async t=>{
  const f=fixture(t),analysisPath=join(f.parent,'analysis.json'),receiptPath=join(f.parent,'decision.json'),cli=fileURLToPath(new URL('../scripts/coherent.mjs',import.meta.url));
  writeFileSync(analysisPath,JSON.stringify(f.analysis));writeFileSync(receiptPath,JSON.stringify(f.receipt));
  const reviewed=spawnSync(process.execPath,[cli,'review','--root',f.root,'--analysis',analysisPath,'--decision',receiptPath,'--defer-source-plan','true'],{encoding:'utf8'});
  assert.equal(reviewed.status,0,reviewed.stderr);const status=JSON.parse(reviewed.stdout);
  assert.equal(status.stage,'source-batch-needed');assert.equal(status.batchSha256,null);
  const before=flow.inspectWorkflow(f.workflow);
  assert.throws(()=>pipeline.advanceCoherentPipeline(f.root));assert.throws(()=>pipeline.authorizeCoherentStage(f.root,decision('gate.no.compute','f'.repeat(64),'approve-compute')));
  let invoked=0;const paused=await pipeline.driveCoherentPipeline(f.root,{operator:{approveCompute(){invoked++;}}});
  assert.equal(paused.stage,'awaiting-observation-coverage');assert.equal(invoked,0);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const sourceScopes=JSON.parse(readFileSync(join(f.root,'source-scopes.json'),'utf8')),subject=sourceScopes.subjects.find(s=>s.role==='foreground');
  const observation={observationId:'foreground.visible',description:subject.content,layerId:subject.layerId,parentRole:subject.parentRole};
  const data={requiredObservationIds:[observation.observationId,'missing.rock'],observations:[observation],assignments:[{observationId:observation.observationId,subjectId:subject.subjectId,scopeQuote:subject.content}]};
  const failed=pipeline.checkCoherentObservationCoverage(f.root,data);assert.equal(failed.status,'fail');assert(failed.findings.some(x=>x.code==='REQUIRED_OBSERVATION_MISSING'));
  assert.equal(existsSync(join(f.root,'reference-observation-accepted.json')),false);assert.throws(()=>pipeline.advanceCoherentPipeline(f.root));
  const input=join(f.parent,'coverage.json');
  writeFileSync(input,JSON.stringify(data));let child=spawnSync(process.execPath,[cli,'observation-coverage','--root',f.root,'--observations',input],{encoding:'utf8'});
  assert.equal(child.status,2);assert.equal(JSON.parse(child.stdout).status,'fail');
  data.requiredObservationIds=[observation.observationId];writeFileSync(input,JSON.stringify(data));child=spawnSync(process.execPath,[cli,'observation-coverage','--root',f.root,'--observations',input],{encoding:'utf8'});
  assert.equal(child.status,0);const passed=JSON.parse(child.stdout);
  assert.equal(passed.status,'pass');assert(existsSync(join(f.root,'reference-observation-accepted.json')));
  const gatePath=join(f.root,'reference-observation-accepted.json'),saved=readFileSync(gatePath);
  writeFileSync(gatePath,Buffer.from('{}'));assert.throws(()=>pipeline.advanceCoherentPipeline(f.root));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);writeFileSync(gatePath,saved);
  const after=pipeline.advanceCoherentPipeline(f.root);assert.equal(after.stage,'awaiting-source-compute');assert(after.batchSha256);
});

test('legacy reference review keeps its default and opt-in cannot imply retroactive gating',{timeout:180000},async t=>{
  const f=fixture(t),status=pipeline.reviewCoherentReference(f.root,f.analysis,f.receipt);
  assert.equal(status.stage,'awaiting-source-compute');assert(status.batchSha256);
  assert.equal(existsSync(join(f.root,'reference-observation-required.json')),false);
  const before=flow.inspectWorkflow(f.workflow);
  await assert.rejects(()=>pipeline.driveCoherentPipeline(f.root,{operator:{},deferObservationCoverage:true}));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('deferred mode preserves an explicit rejected reference decision without freezing',{timeout:180000},t=>{
  const f=fixture(t),receipt=decision('gate.reference.reject',f.receipt.targetSha256,'reject');
  const status=pipeline.reviewCoherentReference(f.root,f.analysis,receipt,{deferObservationCoverage:true});
  assert.equal(status.stage,'attention-required');assert.equal(status.batchSha256,null);
  assert.equal(existsSync(join(f.root,'reference-observation-required.json')),false);
});
