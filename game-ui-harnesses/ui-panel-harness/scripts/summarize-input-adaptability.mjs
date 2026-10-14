#!/usr/bin/env node
/** Read-only audit of original receipts, frozen expectations and actual browser evidence. */
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {digestJson,digestBytes,canonicalJson} from '../src/canonical.mjs';
import {validateCodexReceipt,validateCodexEditReceipt} from '../src/codex-planner.mjs';
import {checkAdaptabilityResult,businessFacts} from './lib/input-adaptability-oracle.mjs';
import {draftReviewRecord} from './lib/open-draft-evaluation.mjs';
import {adaptabilityDesignEvidence,adaptabilityPromptEvidence} from './input-adaptability.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--browser','--output'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[i+1];}
assert.equal(Object.keys(options).length,4);
const prepared=resolve(options['--prepared']),run=resolve(options['--run']),browserPath=resolve(options['--browser']);
const plan=await readJson(join(prepared,'input-adaptability-plan.json')),{sha256,...payload}=plan;
assert.equal(await digestJson(payload),sha256);
assert.deepEqual(await readJson(join(run,'approved-plan.json')),plan);
const claim=await readJson(join(prepared,'dispatch-claim.json'));assert.equal(claim.planSha256,sha256);
assert.deepEqual(claim.caseBindings,plan.cases.map(({id,contextSha256})=>({id,contextSha256})));
assert.equal(claim.maxInvocations,plan.policy.maxInvocations);assert.equal(claim.automaticRetries,0);
for(const source of plan.sourceFiles)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,source.path))),source.sha256,'AUDIT_FROZEN_SOURCE_CHANGED:'+source.path);
const report=await readJson(join(run,'input-adaptability-report.json')),browser=await readJson(join(browserPath,'browser-report.json'));
assert.equal(report.planSha256,sha256);assert.equal(browser.planSha256,sha256);assert.equal(browser.sourceCohortComplete,true);
assert.equal(report.results.length,plan.cases.length);assert.equal(report.automaticRetries,0);assert.equal(browser.realModelCalls,0);
const cases=[];let invocations=0;
function differences(actual,expected,path='$'){
  if(canonicalJson(actual??null)===canonicalJson(expected??null))return [];
  if(!actual||!expected||typeof actual!=='object'||typeof expected!=='object')return [{path,actual:actual??null,expected:expected??null}];
  return [...new Set([...Object.keys(actual),...Object.keys(expected)])].flatMap(key=>differences(actual[key],expected[key],path+'.'+key));
}
for(let i=0;i<plan.cases.length;i++){
  const entry=plan.cases[i],result=report.results[i];assert.equal(result.id,entry.id);
  for(const file of entry.files)assert.equal(await digestBytes(await readFile(join(prepared,file.name))),file.sha256);
  const expectation=await readJson(join(prepared,entry.id+'.expectation.json')),context=await readJson(join(prepared,entry.id+'.context.json'));
  if(entry.designArm&&result.status!=='NOT_RUN'){
    const design=await readJson(join(prepared,entry.id+'.design.json')),evidence=await readJson(join(run,entry.id,'design-evidence.json'));
    assert.deepEqual(evidence,adaptabilityDesignEvidence(expectation.case,design));
    if(result.receipt?.invocationCount===1)assert.deepEqual(await readJson(join(run,entry.id,'prompt-sent.json')),
      await adaptabilityPromptEvidence(expectation.case,design.prompt));
  }
  let nativeReceipt=null,proposal=null,candidate=null,delta=[],knownReview=null;
  if(result.status!=='NOT_RUN'){
    assert.deepEqual(await readJson(join(run,entry.id,'acceptance.json')),result);
    const attempts=(await readdir(join(run,entry.id),{withFileTypes:true})).filter(item=>item.isDirectory()&&/^codex(?:-edit)?-/.test(item.name));
    assert.equal(attempts.length,1,'AUDIT_SINGLE_ATTEMPT');
    const attempt=join(run,entry.id,attempts[0].name);
    nativeReceipt=await readJson(join(attempt,entry.operation==='edit'?'codex-edit-receipt.json':'codex-receipt.json'));
    (entry.operation==='edit'?validateCodexEditReceipt:validateCodexReceipt)(nativeReceipt,{contextSha256:entry.contextSha256});
    assert.deepEqual(nativeReceipt,result.receipt);assert.equal(nativeReceipt.invocationCount,1);assert.equal(nativeReceipt.automaticRetries,0);invocations++;
    try{proposal=await readJson(join(attempt,entry.operation==='edit'?'edit-proposal.json':'proposal.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    try{candidate=await readJson(join(run,entry.id,'candidate.panel.bundle.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(result.status==='PASS'){
      assert(proposal,'AUDIT_PROPOSAL_MISSING');
      const caseReport=await readJson(join(attempt,entry.operation==='edit'?'edit-planning-report.json':'planning-report.json'));
      const before=entry.operation==='edit'?await readJson(join(prepared,entry.id+'.source.panel.bundle.json')):undefined;
      checkAdaptabilityResult(expectation.case,{proposal,report:caseReport},{expectedSpec:expectation.expectedSpec,before,after:candidate});
      if(expectation.case.evaluation)assert.deepEqual(await readJson(join(run,entry.id,'draft-review.json')),draftReviewRecord(expectation.case,{proposal,report:caseReport},proposal.spec?businessFacts(proposal.spec):null),'AUDIT_DRAFT_REVIEW_CHANGED');
      if(expectation.case.stability)knownReview=(await readJson(join(run,entry.id,'draft-review.json'))).knownReview;
    }else if(candidate&&expectation.expectedSpec){
      delta=entry.operation==='generate'?differences(businessFacts(candidate.spec),businessFacts(expectation.expectedSpec)):differences(candidate.spec,expectation.expectedSpec);
    }
  }
  const browserResult=browser.results.find(item=>item.id===entry.id)??null;
  if(result.delivery){assert(browserResult,'AUDIT_BROWSER_CASE_MISSING');const bytes=await readFile(join(run,entry.id,result.delivery.path));assert.equal(bytes.length,result.delivery.bytes);assert.equal(await digestBytes(bytes),result.delivery.sha256);}
  cases.push({id:entry.id,category:entry.category,operation:entry.operation,expected:entry.expectedOutcome,
    status:result.status,observed:result.outcome??nativeReceipt?.status??null,code:result.code??null,diagnostic:result.diagnostic??null,
    contextSha256:entry.contextSha256,request:context.request.text,invocations:nativeReceipt?.invocationCount??0,elapsedMs:nativeReceipt?.elapsedMs??null,
    differences:delta,browser:browserResult?.status??(result.delivery?'NOT_RUN':result.status==='PASS'?'NOT_APPLICABLE':'NOT_RUN'),
    canvas:candidate?.spec.canvas??null,panelSha256:candidate?.sha256??null,zip:result.delivery??null,
    ...(entry.stability?{stability:entry.stability,knownReview,interactionReview:browserResult?.interactionReview??null}: {})});
}
assert.equal(invocations,report.realModelCalls);assert(invocations<=plan.policy.maxInvocations);
const successfulDeliveries=report.results.filter(item=>item.status==='PASS'&&item.delivery).map(item=>item.id).sort();
assert.deepEqual(browser.results.map(item=>item.id).sort(),successfulDeliveries);
const tally=predicate=>({total:cases.filter(predicate).length,pass:cases.filter(item=>predicate(item)&&item.status==='PASS').length,
  fail:cases.filter(item=>predicate(item)&&item.status==='FAIL').length,notRun:cases.filter(item=>predicate(item)&&item.status==='NOT_RUN').length});
const summary={inputAdaptabilityAuditVersion:'0.1',status:report.status==='PASS_BEFORE_BROWSER'&&browser.status==='PASS'&&(!plan.focusedAcceptance?.required||browser.focusedAcceptance?.status==='PASS')&&(!plan.copyAcceptance?.required||browser.copyAcceptance?.status==='PASS')?'PASS':'FAIL',planSha256:sha256,
  ...(plan.evaluation?{evaluation:plan.evaluation,humanReview:'NOT_RECORDED',passMeaning:'Integrity, protocol, explicit constraints and applicable browser checks only. Not relevance, assumption quality or clarification necessity.'}:{}),
  sourceFingerprint:'PASS',singleUseClaim:'VERIFIED',receiptIntegrity:'PASS',realModelCalls:invocations,automaticRetries:0,
  overall:tally(()=>true),generation:tally(item=>item.operation==='generate'&&item.expected==='READY_TO_COMPILE'),
  generationClarification:tally(item=>item.operation==='generate'&&item.expected==='NEEDS_INPUT'),
  editing:tally(item=>item.operation==='edit'&&item.expected==='READY_TO_APPLY'),editingClarification:tally(item=>item.operation==='edit'&&item.expected==='NEEDS_INPUT'),
  browser:{status:browser.status,panels:browser.panels,checks:browser.checks,errors:browser.errors},
  ...(plan.focusedAcceptance?.required?{focusedAcceptance:browser.focusedAcceptance??{status:'NOT_RUN'}}:{}),
  ...(plan.copyAcceptance?.required?{copyAcceptance:browser.copyAcceptance??{status:'NOT_RUN'}}:{}),
  sourceReportSha256:await digestBytes(await readFile(join(run,'input-adaptability-report.json'))),browserReportSha256:await digestBytes(await readFile(join(browserPath,'browser-report.json'))),
  scope:'One frozen cohort. '+(plan.cases.some(item=>item.operation==='edit')?'Editing bases are programmatic fixtures. ':'No editing cases. ')
    +(plan.stabilityEvaluation?'Three repeats and one variant per purpose are finite samples; human semantic review is required and population reliability is not established.':'Not a population success rate or repeated-request stability measurement.'),unityNative:'NOT_RUN_THIS_COHORT',cases};
const output=await createOutputDirectory(options['--output']);await writeNewJson(output,'audit.json',summary);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const blocks=cases.map(item=>'<section><h2>'+item.id+' · '+escape(item.status)+' · '+escape(item.category)+'</h2><p>预期 '+escape(item.expected)+'；实际 '+escape(item.observed)+'；浏览器 '+escape(item.browser)+'</p><p>'+escape(item.request)+'</p>'+
  (item.differences.length?'<pre>'+escape(JSON.stringify(item.differences,null,2))+'</pre>':'')+
  (item.code?'<pre>'+escape(JSON.stringify({code:item.code,diagnostic:item.diagnostic},null,2))+'</pre>':'')+
  (item.zip?'<p><a href="'+escape(relative(output,resolve(run,item.id,'delivery/pixi/index.html')).replaceAll('\\','/'))+'">试玩实际交付</a> · <a href="'+escape(relative(output,resolve(run,item.id,'panel.zip')).replaceAll('\\','/'))+'" download>下载 ZIP</a></p>':'')+'</section>').join('');
await writeFile(join(output,'index.html'),'<!doctype html><meta charset="utf-8"><title>输入适应性真实验收结果</title><style>body{max-width:1100px;margin:30px auto;font:16px/1.65 system-ui}section{border-top:1px solid #ddd;padding:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f4f5;padding:16px}</style><h1>输入适应性真实验收：'+summary.status+'</h1><p>固定'+plan.cases.length+'项：'+summary.overall.pass+'通过、'+summary.overall.fail+'失败、'+summary.overall.notRun+'未执行。真实调用 '+invocations+' 次，自动重试0。</p><p>浏览器 '+browser.panels+' 个实际交付、'+browser.checks+' 项检查，结果 '+browser.status+'。这是本批样本结果；若含编辑，其基准为程序夹具。</p>'+blocks,{flag:'wx'});
process.stdout.write(JSON.stringify({status:summary.status,overall:summary.overall,realModelCalls:invocations,browser:summary.browser})+'\n');
