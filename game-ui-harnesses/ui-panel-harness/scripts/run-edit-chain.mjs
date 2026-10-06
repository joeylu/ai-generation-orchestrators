#!/usr/bin/env node
/** Single-use edit-only CLI. Preflight never invokes inference; no retries or implicit continuation. */
import assert from 'node:assert/strict';
import { readFile,writeFile,appendFile } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
import { createOutputDirectory,writeNewJson,harnessRoot } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { verifyAssetLibrary } from '../src/asset-library.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { findCodexExecutable,editWithCodex } from '../src/codex-planner.mjs';
import { checkCodexLoginVisibility } from '../src/codex-runtime-preflight.mjs';
import { verifyChainPrepared } from './edit-chain-evidence.mjs';
import { executeEditChain } from './edit-chain-driver.mjs';
let dispatched=false,output;
try{
  const opts={},args=process.argv.slice(2);
  for(let i=0;i<args.length;i++){if(args[i]==='--preflight'){assert(!opts.preflight);opts.preflight=true;}
    else{assert(['--prepared','--approve-plan','--output','--sharp-module'].includes(args[i])&&args[i+1]&&!opts[args[i]]);opts[args[i]]=args[++i];}}
  assert(opts['--prepared']);assert(opts.preflight?!opts['--approve-plan']&&!opts['--output']:opts['--approve-plan']&&opts['--output']);
  const {readJson}=await import('../src/io.mjs'),raw=await readJson(resolve(opts['--prepared'],'edit-chain-plan.json'));
  if(!opts.preflight)assert.equal(opts['--approve-plan'],raw.sha256);
  const core=await loadWorkspaceCore(),verified=await verifyChainPrepared(opts['--prepared'],core),{plan,prepared,trial,first}=verified;
  const library=await verifyAssetLibrary(plan.assetRoot,await loadTextureImageAdapter(opts['--sharp-module']));assert.deepEqual(plan.library,{id:library.index.id,sha256:library.index.sha256});
  const runtime=checkCodexLoginVisibility({cwd:harnessRoot,requireProxyEnvironment:true});assert.equal(runtime.status,'PASS');
  const executable=findCodexExecutable();assert(executable);
  if(opts.preflight){console.log(JSON.stringify({status:'PREFLIGHT_PASS',planSha256:plan.sha256,steps:10,maxInvocations:10,modelCalls:0,singleUseClaim:'UNCONSUMED',runtime}));process.exit(0);}
  output=await createOutputDirectory(opts['--output']);
  await writeFile(resolve(prepared,'dispatch-claim.json'),JSON.stringify({editChainDispatchVersion:'0.1',planSha256:plan.sha256,
    output:relative(harnessRoot,output).replaceAll('\\','/'),maxInvocations:10,automaticRetries:0})+'\n',{flag:'wx'});dispatched=true;
  await writeNewJson(output,'approved-plan.json',plan);const directories=new Map();
  const directory=async step=>{if(!directories.has(step.id))directories.set(step.id,await createOutputDirectory(`${output}/${step.id}`));return directories.get(step.id);};
  const report=await executeEditChain({source:trial,core,evidence:'REAL_MODEL_OUTPUT',firstContext:first,
    verifyBeforeStep:async()=>{for(const file of [...plan.sourceFiles,...plan.origin.evidence])assert.equal(await digestBytes(await readFile(resolve(harnessRoot,file.path))),file.sha256);},
    save:async(step,name,value)=>writeNewJson(await directory(step),name,value),
    invoke:async(context,step)=>editWithCodex(context,{outputRoot:await directory(step),executable,timeoutMs:plan.policy.timeoutMs}),
    onProgress:async event=>{console.log(JSON.stringify(event));await appendFile(`${output}/progress.ndjson`,JSON.stringify(event)+'\n');}});
  report.planSha256=plan.sha256;report.runtimePreflight=runtime;await writeNewJson(output,'edit-chain-report.json',report);
  console.log(JSON.stringify({status:report.status,planSha256:plan.sha256,modelCalls:report.modelCalls,totals:report.totals}));if(report.status!=='PASS_BEFORE_BROWSER')process.exitCode=1;
}catch(error){const result={status:dispatched?'FAILED_NO_RETRY':'PREFLIGHT_FAILED',code:error.code??'EDIT_CHAIN_PREFLIGHT_FAILED',modelCalls:dispatched?null:0,
  ...(dispatched?{providerAcceptance:'INDETERMINATE_UNLESS_PRODUCER_RECEIPTS_PROVE_OTHERWISE'}:{})};
  if(dispatched&&output)await writeNewJson(output,'edit-chain-failure.json',result);console.error(JSON.stringify(result));process.exitCode=1;}
