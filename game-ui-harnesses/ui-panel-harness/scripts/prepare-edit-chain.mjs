#!/usr/bin/env node
/** Zero-model fixture/browser preparation before freezing a 10-call edit-only plan. */
import assert from 'node:assert/strict';
import { readFile,readdir,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createOutputDirectory,writeNewJson,readJson,harnessRoot } from '../src/io.mjs';
import { digestJson,digestBytes } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle,panelBundleAssetInputs } from '../src/panel-bundle.mjs';
import { verifyAssetLibrary } from '../src/asset-library.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { EDIT_CHAIN_STEPS,EDIT_CHAIN_POLICY } from '../examples/edit-chain-v1/suite.mjs';
import { chainFixturePatch,stressFixtureProposal,findStressRow } from './edit-chain-contract.mjs';
import { executeEditChain } from './edit-chain-driver.mjs';
import { readChainOrigin,verifyChainBuild } from './edit-chain-evidence.mjs';
let stage='arguments';
try{
  const opts={},args=process.argv.slice(2);
  for(let i=0;i<args.length;i+=2){assert(['--output','--assets','--sharp-module','--source-run','--source-acceptance','--build','--tests'].includes(args[i])&&args[i+1]&&!opts[args[i]]);opts[args[i]]=args[i+1];}
  assert(opts['--output']&&opts['--assets']&&opts['--source-run']&&opts['--source-acceptance']&&opts['--build']&&opts['--tests']);
  for(const name of ['--assets','--source-run','--source-acceptance','--build','--tests'])assert(/^[a-zA-Z0-9._/-]+$/.test(opts[name])&&!opts[name].split('/').includes('..'));
  stage='library';const core=await loadWorkspaceCore(),adapter=await loadTextureImageAdapter(opts['--sharp-module']),library=await verifyAssetLibrary(opts['--assets'],adapter);
  stage='origin';
  const {bundle:source,origin}=await readChainOrigin({run:opts['--source-run'],acceptance:opts['--source-acceptance']},core);
  assert.deepEqual(source.spec.assets.library,{id:library.index.id,sha256:library.index.sha256});
  stage='build';const buildFile=`${opts['--build']}/workbench-build.json`,build=await readJson(buildFile),buildReference={file:buildFile,sha256:await digestJson(build)};
  await verifyChainBuild(buildReference);assert.deepEqual(build.library,source.spec.assets.library);
  stage='tests';const testText=await readFile(opts['--tests'],'utf8'),testCount=Number(testText.match(/(?:#|ℹ) tests (\d+)/)?.[1]),testPass=Number(testText.match(/(?:#|ℹ) pass (\d+)/)?.[1]);
  assert(Number.isSafeInteger(testCount)&&testCount>0);assert.equal(testPass,testCount);assert.match(testText,/(?:#|ℹ) fail 0/);
  const main=findStressRow(source.spec,'主音量'),mute=findStressRow(source.spec,'静音');
  assert.equal(main.kind,'slider');assert.equal(mute.kind,'switch');
  const trial=await createPanelBundle(source.spec,source.catalog,core,{...source.state,[main.bind]:83,[mute.bind]:true},panelBundleAssetInputs(source,core),source.compilerVersion);
  stage='fixture';const output=await createOutputDirectory(opts['--output']);await writeNewJson(output,'edit-source.panel.bundle.json',source);await writeNewJson(output,'edit-trial.panel.bundle.json',trial);
  const fixture=await createOutputDirectory(`${output}/driver-fixtures`),directories=new Map();let first,firstSchema;
  const simulation=await executeEditChain({source:trial,core,evidence:'DRIVER_FIXTURE',
    save:async(step,name,value)=>{let dir=directories.get(step.id);if(!dir){dir=await createOutputDirectory(`${fixture}/${step.id}`);directories.set(step.id,dir);}await writeNewJson(dir,name,value);
      if(step.id==='edit01'&&name==='dispatch-context.json')first=value;if(step.id==='edit01'&&name==='dispatch-response-schema.json')firstSchema=value;},
    invoke:async(context,step)=>{const proposal=stressFixtureProposal(context,await chainFixturePatch(context.spec,step));return{proposal,report:await checkPanelEditProposal(context,proposal),receipt:null};}});
  assert.equal(simulation.status,'FIXTURE_PASS');await writeNewJson(output,'driver-simulation.json',simulation);
  await writeNewJson(output,'edit01.context.json',first);await writeNewJson(output,'edit01.response-schema.json',firstSchema);
  const driverPayload={editChainDriverVersion:'0.1',evidence:'DRIVER_FIXTURE_INPUT_NOT_COMPUTE_PLAN',
    edit:{steps:EDIT_CHAIN_STEPS,trialFile:'edit-trial.panel.bundle.json'},build:buildReference,modelCalls:0};
  await writeNewJson(output,'edit-chain-driver.json',{...driverPayload,sha256:await digestJson(driverPayload)});
  stage='browser';await new Promise((done,reject)=>{const child=spawn(process.execPath,['scripts/check-edit-chain-browser.mjs','--prepared',opts['--output'],'--mode','fixture','--output',`${opts['--output']}/fixture-browser`],
    {cwd:harnessRoot,shell:false,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error('EDIT_CHAIN_BROWSER_FIXTURE_FAILED')));});
  const qa=await readJson(`${output}/fixture-browser/browser-report.json`);assert.equal(qa.status,'FIXTURE_PASS');assert.equal(qa.deliveries.length,10);assert.equal(qa.modelCalls,0);
  stage='freeze';const files=[];
  async function scan(path){for(const entry of await readdir(path,{withFileTypes:true})){const child=`${path}/${entry.name}`;assert(!entry.isSymbolicLink());if(entry.isDirectory())await scan(child);else if(/\.(mjs|ts|json|md|cs|meta)$/.test(entry.name))files.push(child);}}
  for(const path of ['src','schemas','prompts','adapters/unity','../ui-component-harness/src'])await scan(path);
  files.push(...['scripts/prepare-edit-chain.mjs','scripts/run-edit-chain.mjs','scripts/check-edit-chain-browser.mjs','scripts/edit-chain-driver.mjs','scripts/edit-chain-contract.mjs','scripts/edit-chain-evidence.mjs',
    'scripts/input-stress-contract.mjs','scripts/export-panel-delivery.mjs','scripts/build-delivery-runtime.mjs','examples/edit-chain-v1/suite.mjs','examples/input-stress-v1/suite.mjs','tests/edit-chain-driver.test.mjs','tests/unity-kit-helpers.mjs']);
  const sourceFiles=await Promise.all([...new Set(files)].sort().map(async path=>({path,sha256:await digestBytes(await readFile(path))})));
  const fixturePaths=[];
  async function all(path){for(const entry of await readdir(path,{withFileTypes:true})){const child=`${path}/${entry.name}`;if(entry.isDirectory())await all(child);else fixturePaths.push(child);}}
  await all(`${opts['--output']}/driver-fixtures`);await all(`${opts['--output']}/fixture-browser`);
  fixturePaths.push(opts['--tests'],`${opts['--output']}/driver-simulation.json`,`${opts['--output']}/edit-chain-driver.json`);
  const fixtureEvidence=await Promise.all(fixturePaths.map(async path=>({path,sha256:await digestBytes(await readFile(path))})));
  const payload={editChainPlanVersion:'0.1',status:'PREPARED',authorization:'REQUIRED_NOT_GRANTED',policy:EDIT_CHAIN_POLICY,protocol:await evaluationProtocolFingerprint(),sourceFiles,origin,build:buildReference,
    library:source.spec.assets.library,assetRoot:opts['--assets'],edit:{steps:EDIT_CHAIN_STEPS,maxInvocations:10,sourceFile:'edit-source.panel.bundle.json',sourceSha256:source.sha256,
      trialFile:'edit-trial.panel.bundle.json',trialSha256:trial.sha256,firstContextFile:'edit01.context.json',firstContextSha256:first.sha256,
      firstResponseSchemaFile:'edit01.response-schema.json',firstResponseSchemaSha256:await digestJson(firstSchema)},
    fixtureEvidence,driverSimulation:{status:'FIXTURE_PASS',steps:10,browserChecks:qa.totals.checks,actualFixtureDownloads:10,modelCalls:0},
    acceptance:{business:'10/10 dependent real edits, exact unmentioned properties/IDs/events/assets and surviving live values.',
      browser:'Each real step replayed through visible Studio edit and undo; actual ZIP download/offline/reimport. All inference blocked during replay.',
      provenance:'Every context/schema is persisted before that step, and every producer receipt and unmodified raw proposal is independently verified.',
      scope:'One current audio source, ten fixed edits. No new generation, arbitrary-input, multiple chains, native engine or human visual certification.'},
    localTests:{tests:testCount,pass:testPass,fail:0,file:opts['--tests']},modelCalls:0,nativeEngines:'NOT_RUN',humanVisualReview:'NOT_RUN'};
  await writeNewJson(output,'edit-chain-plan.json',{...payload,sha256:await digestJson(payload)});
  console.log(JSON.stringify({status:'PREPARED',sha256:await digestJson(payload),steps:10,maxInvocations:10,sourceFiles:sourceFiles.length,fixtureBrowserChecks:qa.totals.checks,fixtureDownloads:10,modelCalls:0}));
}catch(error){console.error(JSON.stringify({status:'FAIL',stage,code:error.code??'EDIT_CHAIN_PREPARATION_FAILED',modelCalls:0}));process.exitCode=1;}
