#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {createOutputDirectory,harnessRoot,readJson,writeNewJson} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {findCodexExecutable} from '../src/codex-planner.mjs';
import {checkCodexLoginVisibility} from '../src/codex-runtime-preflight.mjs';
import {materializeArtSkillResponse} from '../examples/crafted-audio-v1/skill-comparison.mjs';
import {invokeFrozenArtCli,runArtSteps} from './lib/art-skill-transport.mjs';
import {buildArtSkillReview} from './lib/art-skill-review.mjs';
import {validateArtResponseConstraints} from './lib/art-skill-native-schema.mjs';

const argv=process.argv.slice(2);
assert((argv.length===5||argv.length===6)&&argv[0]==='--plan'&&argv[2]==='--output');
const simulated=argv[4]==='--simulate';
assert(simulated?argv.length===5:argv[4]==='--authorize'&&argv.length===6);
const planDirectory=resolve(argv[1]),output=await createOutputDirectory(argv[3]),core=await loadWorkspaceCore();
const report={status:'FAIL',phase:'verify',kind:simulated?'PROGRAMMATIC_FIXTURE':'REAL_SKILL_COMPARISON',modelCalls:0,
  maxInvocations:3,automaticRetries:0,steps:[],nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',humanVisualApproval:'NOT_RUN'};
let current,plan;
const verify=async()=>{
  const {sha256,...payload}=await readJson(resolve(planDirectory,'plan.json'));
  assert.equal(await digestJson(payload),sha256);assert.equal(sha256,plan.sha256);
  for(const fact of plan.files){assert.equal(basename(fact.file),fact.file);const bytes=await readFile(resolve(planDirectory,fact.file));assert.equal(bytes.length,fact.bytes);assert.equal(await digestBytes(bytes),fact.sha256);}
  for(const fact of plan.sourceFingerprints)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,fact.path))),fact.sha256);
};
try{
  plan=await readJson(resolve(planDirectory,'plan.json'));report.planSha256=plan.sha256;
  assert.equal(plan.model,'gpt-6-luna');assert.equal(plan.effort,'xhigh');assert.equal(plan.maxInvocations,3);assert.equal(plan.automaticRetries,0);
  assert.equal(plan.steps.length,3);assert.equal(plan.transport.shell,false);await verify();
  if(!simulated)assert.equal(argv[5],plan.sha256);
  const executorFiles=[];
  for(const path of ['scripts/run-audio-skill-comparison.mjs','scripts/lib/art-skill-transport.mjs','scripts/lib/art-skill-review.mjs','scripts/lib/art-skill-native-schema.mjs','examples/crafted-audio-v1/skill-review.mjs'])
    executorFiles.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
  await writeNewJson(output,'executor-evidence.json',{planSha256:plan.sha256,files:executorFiles,changesFrozenInput:false});
  const baselines={};for(const mode of ['light','dark'])baselines[mode]=await validatePanelBundle(await readJson(resolve(planDirectory,`baseline-${mode}.panel.bundle.json`)),core);
  let executable;
  if(!simulated){
    report.phase='preflight';const preflight=checkCodexLoginVisibility({cwd:harnessRoot});await writeNewJson(output,'preflight-report.json',preflight);
    assert.equal(preflight.status,'PASS');executable=findCodexExecutable();assert(executable);
    // Exclusive creation binds the authorized batch once; no resume or automatic reuse.
    await writeNewJson(planDirectory,'authorization-consumed.json',{kind:'ONE_USE_BATCH_CLAIM',planSha256:plan.sha256,maxInvocations:3,
      steps:plan.steps.map(step=>({number:step.number,sha256:step.sha256,maxInvocations:1})),automaticRetries:0});
  }
  const candidates=[];
  await runArtSteps(plan.steps,{
    invoke:async step=>{
      await verify();const {sha256,...payload}=step;assert.equal(await digestJson(payload),sha256);
      const directory=await createOutputDirectory(resolve(output,`step-${step.number}`));
      current={number:step.number,condition:step.condition,directory:`step-${step.number}`,phase:'dispatch',status:'FAIL',modelCalls:0};report.steps.push(current);
      if(simulated){
        const value={artStudyVersion:'0.1',designNote:'Local driver simulation only. No real Skill/model result.'};
        for(const mode of ['light','dark']){const b=baselines[mode];value[mode]={tokens:b.catalog.themes.find(t=>t.id===b.spec.theme.id).tokens,
          canvas:b.spec.canvas,layout:b.spec.layout,titleBar:null,buttonStyles:b.spec.buttonStyles,actionLayouts:b.spec.actionLayouts};}
        await writeNewJson(directory,'fixture-response.json',value);return{value,directory};
      }
      report.phase=`step-${step.number}-model`;
      const args=plan.transport.argumentTemplate.map(arg=>arg.replaceAll('<step-directory>',directory).replaceAll('<plan-directory>',planDirectory));
      const prompt=await readFile(resolve(planDirectory,step.prompt));assert.equal(await digestBytes(prompt),step.promptSha256);
      await writeNewJson(directory,'dispatch-claim.json',{planSha256:plan.sha256,stepSha256:step.sha256,promptSha256:step.promptSha256,
        invocationCount:1,automaticRetries:0,model:plan.model,effort:plan.effort});
      report.modelCalls++;current.modelCalls=1;
      process.stdout.write(JSON.stringify({phase:'DISPATCH',step:step.number,condition:step.condition,modelCalls:report.modelCalls})+'\n');
      const started=performance.now();
      try{
        const response=await invokeFrozenArtCli({executable,args,prompt,directory,timeoutMs:plan.transport.timeoutMs});
        await writeFile(resolve(directory,'model-response.txt'),response.finalText,{flag:'wx'});
        await writeNewJson(directory,'model-receipt.json',{status:'RETURNED',planSha256:plan.sha256,stepSha256:step.sha256,
          responseSha256:await digestBytes(Buffer.from(response.finalText)),model:plan.model,effort:plan.effort,invocationCount:1,
          automaticRetries:0,elapsedMs:Math.round(performance.now()-started),usage:response.usage});
        return{value:JSON.parse(response.finalText),directory};
      }catch(error){
        await writeNewJson(directory,'model-failure.json',{status:'FAILED_OR_INDETERMINATE',code:error.code??error.message,
          planSha256:plan.sha256,stepSha256:step.sha256,invocationCount:1,automaticRetries:0,elapsedMs:Math.round(performance.now()-started)});throw error;
      }
    },
    accept:async(step,{value,directory})=>{
      report.phase=`step-${step.number}-compile`;current.phase='compile';
      if(plan.localResponseSchema)validateArtResponseConstraints(value,await readJson(resolve(planDirectory,plan.localResponseSchema)));
      const bundles=await materializeArtSkillResponse(value,baselines,core,{conditionId:step.condition,fixture:simulated});
      for(const mode of ['light','dark'])await writeNewJson(directory,`${mode}.panel.bundle.json`,bundles[mode]);
      const candidate={id:`s${step.number}`,label:step.label,bundles};
      report.phase=`step-${step.number}-browser`;current.phase='browser';
      const review=await buildArtSkillReview({baselines,candidates:[candidate],output:resolve(directory,'review'),core,fixture:simulated});
      current.status='PASS';current.phase='complete';current.checks=review.checks.length;current.bundles=Object.fromEntries(Object.entries(bundles).map(([mode,bundle])=>[mode,bundle.sha256]));
      await writeNewJson(directory,'step-report.json',current);candidates.push(candidate);
      process.stdout.write(JSON.stringify({phase:'STEP_PASS',step:step.number,checks:review.checks.length,modelCalls:report.modelCalls})+'\n');return candidate;
    },
  });
  report.phase='combined-browser';
  const combined=await buildArtSkillReview({baselines,candidates,output:resolve(output,'review'),core,fixture:simulated});
  report.status='PASS';report.phase='complete';report.combinedChecks=combined.checks.length;report.review='review/index.html';
  report.realSkillResults=simulated?0:candidates.length;
}catch(error){
  report.failure={code:error.code??error.name,message:error.message,...(error.report?{browserFailure:error.report.failure}:{})};
  if(current)await writeNewJson(resolve(output,current.directory),'terminal-failure.json',{phase:current.phase,failure:report.failure,stopBatch:true}).catch(()=>{});
  process.exitCode=1;
}finally{
  await writeNewJson(output,'batch-report.json',report);
  process.stdout.write(JSON.stringify({status:report.status,phase:report.phase,modelCalls:report.modelCalls,acceptedSteps:report.steps.filter(step=>step.status==='PASS').length,
    failure:report.failure,planSha256:report.planSha256})+'\n');
}
