#!/usr/bin/env node
/** Finite authorized real-model acceptance, separate from fixture tests. */
import {writeFile,lstat} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {canonicalJson,digestJson} from '../src/canonical.mjs';
import {evaluationProtocolFingerprint} from '../src/evaluation-protocol.mjs';
import {validatePlanningContext} from '../src/planning-context.mjs';
import {planWithCodex,findCodexExecutable} from '../src/codex-planner.mjs';
import {verifyAssetLibrary} from '../src/asset-library.mjs';
import {loadTextureImageAdapter} from '../src/texture-image-adapter.mjs';
const equal=(a,b)=>{if(canonicalJson(a)!==canonicalJson(b))throw Error('INCOMPLETE_PLAN_MISMATCH');};
const options={},args=process.argv.slice(2);
try{
 for(let i=0;i<args.length;i+=2){if(!['--prepared','--plan-sha256','--assets','--sharp-module','--output'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('INCOMPLETE_ARGUMENTS');options[args[i]]=args[i+1];}
 if(!['--prepared','--plan-sha256','--assets','--output'].every(key=>options[key]))throw Error('INCOMPLETE_ARGUMENTS');
 const prepared=resolve(options['--prepared']),plan=await readJson(resolve(prepared,'evaluation-plan.json')),suite=await readJson(resolve(prepared,'suite.json'));
 const {sha256,...payload}=plan;equal(sha256,options['--plan-sha256']);equal(sha256,await digestJson(payload));equal(plan.suiteSha256,await digestJson(suite));equal(plan.protocol,await evaluationProtocolFingerprint());
 const rel=relative(harnessRoot,prepared);if(!rel||rel.startsWith('..')||resolve(harnessRoot,rel)!==prepared||rel.split(/[\\/]/).some(part=>/^\.(git|codex|agents)$/i.test(part)))throw Error('INCOMPLETE_PREPARED_PATH');
 for(let path=prepared;;path=dirname(path)){if((await lstat(path)).isSymbolicLink())throw Error('INCOMPLETE_PREPARED_PATH');if(path===dirname(path))break;}
 if(plan.panelEvaluationPlanVersion!=='0.2'||plan.cases.length<1||plan.cases.length>64||suite.cases.length!==plan.cases.length)throw Error('INCOMPLETE_PLAN_MISMATCH');
 equal(plan.policy,{model:'gpt-6-luna',effort:'xhigh',maxInvocations:plan.cases.length,attemptsPerCase:1,automaticRetries:0,concurrency:4,timeoutMs:900000,semanticChecks:'explicit-expectations',browser:'SEPARATE_OFFLINE_ACCEPTANCE',nativeEngines:'NOT_RUN'});
 const contexts=[],caseIds=new Set();
 for(let i=0;i<plan.cases.length;i++){
  const item=plan.cases[i],input=suite.cases[i];if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id)||caseIds.has(item.id)||item.id!==input.id||item.contextFile!==item.id+'.context.json'||input.expected.outcome!=='NEEDS_INPUT')throw Error('INCOMPLETE_CASE_MISMATCH');
  caseIds.add(item.id);
  equal(item.expectedSha256,await digestJson(input.expected));const context=await validatePlanningContext(await readJson(resolve(prepared,item.contextFile)));
  equal(context.sha256,item.contextSha256);equal(context.request,input.request);equal(context.catalogSha256,plan.catalogSha256);equal(context.assetRetrieval.library,plan.library);contexts.push(context);
 }
 const executable=findCodexExecutable();if(!executable)throw Error('CODEX_NOT_CONFIGURED');
 const library=await verifyAssetLibrary(options['--assets'],await loadTextureImageAdapter(options['--sharp-module']));equal({id:library.index.id,sha256:library.index.sha256},plan.library);
 const output=await createOutputDirectory(options['--output']);
 await writeFile(resolve(prepared,'dispatch-claim.json'),canonicalJson({planSha256:sha256,maxInvocations:plan.cases.length,automaticRetries:0,output:relative(harnessRoot,output).replaceAll('\\','/')})+'\n',{flag:'wx'});
 await writeNewJson(output,'evaluation-plan.json',plan);await writeNewJson(output,'suite.json',suite);
 const results=[],start=performance.now();
 async function run(i){
  equal(plan.protocol,await evaluationProtocolFingerprint());const source=suite.cases[i],directory=await createOutputDirectory(resolve(output,source.id));
  const result={id:source.id,expected:'NEEDS_INPUT',missingLabel:source.expected.missingLabel,status:'FAIL',model:'NOT_RUN',receipt:null,unresolved:[],failureCode:null,automaticRetries:0};
  console.log(JSON.stringify({event:'START',id:source.id}));
  try{
   const generated=await planWithCodex(contexts[i],{outputRoot:directory,executable,timeoutMs:plan.policy.timeoutMs});
   result.receipt=generated.receipt;result.model=generated.report.status;result.unresolved=generated.report.unresolved;
   result.checks=[{name:'concrete-nonempty-questions',status:result.unresolved.length>0&&result.unresolved.every(q=>typeof q.question==='string'&&q.question.trim().length>0)?'PASS':'FAIL'},
    {name:'no-generated-spec-with-missing-business-facts',status:generated.proposal.spec===null?'PASS':'FAIL'},
    {name:'model-asks-instead-of-inventing-default',status:result.model==='NEEDS_INPUT'?'PASS':'FAIL'}];
   if(result.checks.every(check=>check.status==='PASS'))result.status='PASS';else result.failureCode='EXPECTED_CLARIFICATION';
  }catch(error){result.receipt=error.receipt??null;result.failureCode=error.code??'INCOMPLETE_STAGE_FAILED';result.diagnostic=error.diagnostic??null;}
  await writeNewJson(directory,'case-result.json',result);results[i]=result;console.log(JSON.stringify({event:'COMPLETE',id:source.id,status:result.status,model:result.model,failureCode:result.failureCode,elapsedMs:result.receipt?.elapsedMs??null}));
 }
 for(let i=0;i<plan.cases.length;i+=4){const settled=await Promise.allSettled(Array.from({length:Math.min(4,plan.cases.length-i)},(_,offset)=>run(i+offset)));if(settled.some(r=>r.status==='rejected'))throw Error('INCOMPLETE_SAVE_FAILED_NO_RETRY');}
 const report={incompleteEvaluationVersion:'0.1',planSha256:sha256,status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',cases:results,totals:{cases:results.length,passed:results.filter(r=>r.status==='PASS').length,invocations:results.reduce((n,r)=>n+(r.receipt?.invocationCount??0),0),automaticRetries:0,elapsedMs:Math.round(performance.now()-start)},browser:'NOT_RUN',nativeEngines:'NOT_RUN',scope:'Actual CLI results, typed clarification and null-spec gate; question relevance reviewed separately.'};
 await writeNewJson(output,'incomplete-report.json',report);console.log(JSON.stringify({event:'FINISHED',status:report.status,totals:report.totals}));if(report.status!=='PASS')process.exitCode=1;
}catch(error){const value=error.code??error.message;console.error(JSON.stringify({status:'FAILED',code:/^[A-Z][A-Z0-9_]{0,90}$/.test(value)?value:'INCOMPLETE_SETUP_FAILED'}));process.exitCode=1;}
