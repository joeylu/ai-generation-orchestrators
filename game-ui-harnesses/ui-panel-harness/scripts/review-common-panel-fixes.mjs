/** Read completed audits and actual screenshots; never dispatch, repair, or relabel old failures. */
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {COMMON_GAME_PANEL_FIX_SUITE,PREVIOUS_FAILURE_IDS,SOURCE_COMMON_PLAN_SHA256} from '../examples/common-game-panels-fix-v1/suite.mjs';
import {expectedTypes} from '../examples/all-components-v1/fixture.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--browser','--audit','--output'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=resolve(args[i+1]);}
assert.equal(Object.keys(options).length,5);
const prepared=options['--prepared'],run=options['--run'],browserPath=options['--browser'];
const plan=await readJson(join(prepared,'input-adaptability-plan.json')),report=await readJson(join(run,'input-adaptability-report.json')),
  browser=await readJson(join(browserPath,'browser-report.json')),audit=await readJson(join(options['--audit'],'audit.json'));
assert.equal(plan.cohort,'common-panels-fix-v1');assert.equal(plan.commonPanelEvaluation.sourcePlanSha256,SOURCE_COMMON_PLAN_SHA256);
for(const value of [report,browser,audit])assert.equal(value.planSha256,plan.sha256);
assert.equal(audit.sourceFingerprint,'PASS');assert.equal(audit.receiptIntegrity,'PASS');assert.equal(audit.sourceReportSha256,await digestBytes(await readFile(join(run,'input-adaptability-report.json'))));
assert.equal(audit.browserReportSha256,await digestBytes(await readFile(join(browserPath,'browser-report.json'))));assert.equal(report.automaticRetries,0);
const oldRun=resolve('output/common-game-panels-real-v2'),oldBrowser=resolve('output/common-game-panels-browser-corrected-v2');
const old=await readJson(join(oldRun,'input-adaptability-report.json')),oldAudit=await readJson('output/common-game-panels-audit-v2/audit.json'),oldChecked=await readJson(join(oldBrowser,'browser-report.json'));
const agentObservations=await readJson('output/common-panel-fixes-agent-observations-v1.json').catch(error=>{if(error.code!=='ENOENT')throw error;return {kind:'AGENT_OBSERVATIONS_NOT_HUMAN_ACCEPTANCE',observations:[]};});
assert.equal(agentObservations.kind,'AGENT_OBSERVATIONS_NOT_HUMAN_ACCEPTANCE');
const repairRun=resolve('output/common-panel-fixes-reviewed-patches-v2'),repairBrowserPath=resolve('output/common-panel-fixes-reviewed-patches-browser-v3');
const repairs=await readJson(join(repairRun,'input-adaptability-report.json')).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
const repairBrowser=repairs?await readJson(join(repairBrowserPath,'browser-report.json')):null;
if(repairs){assert.equal(repairs.sourcePlanSha256,plan.sha256);assert.equal(repairs.realModelCalls,0);assert.equal(repairBrowser.status,'PASS');}
assert.equal(old.planSha256,SOURCE_COMMON_PLAN_SHA256);assert.equal(oldAudit.sourceReportSha256,await digestBytes(await readFile(join(oldRun,'input-adaptability-report.json'))));
assert.equal(oldAudit.receiptIntegrity,'PASS');assert.equal(oldChecked.planSha256,old.planSha256);
assert.deepEqual(report.results.map(x=>x.id),COMMON_GAME_PANEL_FIX_SUITE.map(x=>x.id));
const output=await createOutputDirectory(options['--output']),esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const href=path=>esc(relative(output,path).replaceAll('\\','/'));const rows=[],cards=[],typeCases=new Map();
const repairNotes={G45:'删除示例邮件中无法在当前面板执行的附件领取提示，保留原邮件字段和关闭按钮。',G49:'登录改为提交账号、密码两个必填字段；注册动作和其他字段保留。实际认证服务尚未接入。',G54:'去掉阻挡退出按钮的单按钮模态层，在同一确认面板中展示提示、退出游戏和取消。实际游戏逻辑由宿主接入。'};
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
for(const item of COMMON_GAME_PANEL_FIX_SUITE){
  const result=report.results.find(x=>x.id===item.id),previous=old.results.find(x=>x.id===item.id),checked=browser.results.find(x=>x.id===item.id),previousChecked=oldChecked.results.find(x=>x.id===item.id);
  const context=await readJson(join(prepared,item.id+'.context.json'));assert.equal(context.request.text,item.request.text);
  assert.equal(oldAudit.cases.find(x=>x.id===item.id).request,item.request.text);
  let bundle=null,actualFacts=null;
  if(result.delivery){
    bundle=await readJson(join(run,item.id,'panel.bundle.json'));
    for(const type of new Set(flatten(bundle.componentBundle.document.root).map(node=>node.type)))typeCases.set(type,[...(typeCases.get(type)??[]),item.id]);
    actualFacts={title:bundle.spec.title,canvas:bundle.spec.canvas,theme:bundle.spec.theme,compiler:bundle.compilerVersion,
      sections:bundle.spec.sections.map(section=>({id:section.id,title:section.title,rows:section.rows.map(row=>({kind:row.kind,label:row.buttonLabel??row.label,
        ...(row.text===undefined?{}:{text:row.text}),...(row.bind?{initial:bundle.state[row.bind]}:{}),...(row.kind==='button'?{action:row.action}:{})}))})),
      tabs:bundle.spec.tabs?.pages.map(page=>({id:page.id,label:page.label}))??null,
      compiledSectionTitles:flatten(bundle.componentBundle.document.root).filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.props.text)};
  }
  const observed=checked?.initialPresentation??null,pages=checked?.pagePresentations??[];
  const agentObservation=agentObservations.observations.find(observation=>observation.id===item.id)??null;
  if(agentObservation){assert(bundle);assert.equal(agentObservation.bundleSha256,bundle.sha256);}
  const repair=repairs?.results.find(repair=>repair.id===item.id)??null;
  if(repair){assert(bundle);assert.equal(repair.originalBundleSha256,bundle.sha256);assert.equal(repairBrowser.results.find(x=>x.id===item.id)?.status,'PASS');}
  const row={id:item.id,title:item.reference.title,request:item.request.text,reviewReason:item.reviewReason,previousStatus:previous.status,
    status:result.status,outcome:result.outcome??result.code??result.reason,diagnostic:result.diagnostic??null,browser:checked?.status??'NOT_APPLICABLE',
    previousClippedButtons:previousChecked?.initialPresentation?.clippedButtons??[],clippedButtons:observed?.clippedButtons??[],
    otherPageClipping:pages.filter(page=>page.clippedButtons.length).map(page=>({page:page.activePage,buttons:page.clippedButtons})),actualFacts,
    agentObservation,offlineRepair:repair?{patchedBundleSha256:repair.patchedBundleSha256,reason:repair.reason,realModelCalls:0}:null,contentReview:'HUMAN_REVIEW_REQUIRED'};rows.push(row);
  const shot=async(directory,id,label)=>{const image=join(directory,id+'-initial.png');await access(image);return '<section><h3>'+esc(label)+'</h3><img loading="lazy" src="'+href(image)+'" alt="'+esc(item.id+' '+label)+'"></section>';};
  let comparison='<section><h3>原批真实模型</h3><p>'+esc(previous.status+' · '+(previous.outcome??previous.code??''))+'</p></section>';
  if(previous.delivery)comparison=await shot(oldBrowser,item.id,'原批真实模型画面');
  comparison+=result.delivery?await shot(browserPath,item.id,'本次真实模型画面'):'<section><h3>本次真实模型</h3><p>'+esc(row.status+' · '+row.outcome)+'</p><pre>'+esc(JSON.stringify(row.diagnostic,null,2))+'</pre></section>';
  let previews='';if(previous.delivery)previews+='<a href="'+href(join(oldRun,item.id,'delivery/pixi/index.html'))+'">试玩原版</a> · ';
  if(result.delivery)previews+='<a href="'+href(join(run,item.id,'delivery/pixi/index.html'))+'">试玩本次</a> · <a href="'+href(join(run,item.id,'panel.zip'))+'" download>下载实际交付</a>';
  const correction=repair?'<details open><summary>随后离线修正（不计为模型结果）</summary><p>'+esc(repairNotes[item.id]??repair.reason)+'</p><p><a href="'+href(join(repairRun,item.id,'delivery/pixi/index.html'))+'">试玩修正版</a> · <a href="'+href(join(repairRun,item.id,'panel.zip'))+'" download>下载修正版</a> · <a href="'+href(join(repairRun,item.id,'patch.json'))+'">明确补丁</a></p><img loading="lazy" src="'+href(join(repairBrowserPath,item.id+'-initial.png'))+'" alt="'+esc(item.id+' 离线修正')+'"></details>':'';
  const questions=result.outcome==='NEEDS_INPUT'?await readJson(join(run,item.id,'draft-review.json')):null;
  cards.push('<article data-reason="'+esc(item.reviewReason)+'" data-status="'+esc(result.status)+'"><h2>'+esc(item.id+' · '+item.reference.title)+'</h2><p class="request">'+esc(item.request.text)+'</p><p>原批 '+esc(previous.status)+' → 本次 '+esc(row.status)+' · 浏览器 '+esc(row.browser)+'</p><div class="pair">'+comparison+'</div><p>'+previews+'</p>'+
    (agentObservation?'<p class="observation">Agent 内容观察（待用户验收）：'+esc(agentObservation.note)+'</p>':'')+
    correction+
    (row.clippedButtons.length||row.otherPageClipping.length?'<p class="warning">首屏仍有按钮裁切，见下方记录。</p>':'')+
    (pages.length?'<details><summary>其他页签首屏</summary><div class="pair">'+pages.filter(page=>page.activePage!==observed.activePage).map(page=>'<section><h3>'+esc(page.activePage)+'</h3><img loading="lazy" src="'+href(join(browserPath,item.id+'-'+page.activePage+'-initial.png'))+'" alt="'+esc(page.activePage)+'"></section>').join('')+'</div></details>':'')+
    '<details><summary>本次实际控件、文字和默认值</summary><pre>'+esc(JSON.stringify(actualFacts??questions??row.diagnostic,null,2))+'</pre></details>'+
    '<details><summary>首屏测量与失败证据</summary><pre>'+esc(JSON.stringify({before:previousChecked?.initialPresentation??null,after:observed,pages,diagnostic:row.diagnostic},null,2))+'</pre></details></article>');
}
const failedBefore=rows.filter(x=>PREVIOUS_FAILURE_IDS.includes(x.id)),summary={kind:'REAL_COMMON_PANEL_FIX_RETEST_COMPARISON',planSha256:plan.sha256,sourcePlanSha256:SOURCE_COMMON_PLAN_SHA256,
  realModelCalls:report.realModelCalls,automaticRetries:0,delivered:report.results.filter(x=>x.delivery).length,clarifications:report.outcomes.clarification,failed:report.outcomes.failed,notRun:report.notRun,
  previousFailures:{selected:failedBefore.length,delivered:failedBefore.filter(x=>x.outcome==='READY_TO_COMPILE'&&x.status==='PASS').length,clarified:failedBefore.filter(x=>x.outcome==='NEEDS_INPUT').length,
    failed:failedBefore.filter(x=>x.status==='FAIL').length,notRun:failedBefore.filter(x=>x.status==='NOT_RUN').length},
  browser:{status:browser.status,panels:browser.panels,checks:browser.checks,errors:browser.errors},
  initialClipping:rows.filter(x=>x.clippedButtons.length||x.otherPageClipping.length).map(x=>x.id),humanReview:'NOT_RECORDED',unityNative:'NOT_RUN_THIS_COHORT',repeatedInputStability:'NOT_MEASURED',rows};
summary.offlineRepairs=repairs?{cases:repairs.results.map(x=>x.id),realModelCalls:0,browser:{status:repairBrowser.status,panels:repairBrowser.panels,checks:repairBrowser.checks}}:null;
summary.componentCoverage={expectedTypes,missing:expectedTypes.filter(type=>!typeCases.has(type)),casesByType:Object.fromEntries(typeCases)};
await writeNewJson(output,'comparison.json',summary);
const reasons=[...new Set(rows.map(x=>x.reviewReason))];
await writeFile(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>37条短口令 · 真实复测对照</title><style>body{max-width:1400px;margin:30px auto;padding:0 20px;background:#eef4f1;color:#243a32;font:16px/1.65 system-ui}article{background:white;padding:22px;border-radius:14px;margin:22px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}section{min-width:0}img{max-width:100%;max-height:850px;object-fit:contain;object-position:left top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.request{font-size:22px;font-weight:600}h2{font-size:20px}h3{font-size:16px}a{color:#087763}select{padding:9px;margin:6px}details{margin:14px 0}.warning{color:#a04224}@media(max-width:850px){.pair{grid-template-columns:1fr}}</style><h1>简短口令 · 修复后真实复测</h1><p>实际调用 '+summary.realModelCalls+' 次，交付 '+summary.delivered+' 份、澄清 '+summary.clarifications+' 项、失败 '+summary.failed+' 项、未运行 '+summary.notRun+' 项，自动重试 0 次。</p><p>所选原失败 23 项：本次交付 '+summary.previousFailures.delivered+' 份、澄清 '+summary.previousFailures.clarified+' 项、失败 '+summary.previousFailures.failed+' 项、未运行 '+summary.previousFailures.notRun+' 项。原始失败记录保留。</p><p>实际交付浏览器 '+summary.browser.panels+' 份、'+summary.browser.checks+' 项检查：'+esc(summary.browser.status)+'。首屏裁切：'+esc(summary.initialClipping.join('、')||'未记录到按钮裁切')+'。每个请求仅一次，这不是稳定性统计；技术通过不等于用途和文案适合，人工内容验收尚未记录。</p><p>左右两栏均来自各批次实际模型输出；原批成功画面使用原版交付，不使用离线修复伪装原始结果。原生 Unity 本轮未测。</p><p><a href="'+href(join(options['--audit'],'index.html'))+'">完整性审计</a> · <a href="'+href(join(browserPath,'browser-report.json'))+'">浏览器证据</a> · <a href="'+href(join(run,'input-adaptability-report.json'))+'">实际调用记录</a></p><label>选择依据 <select id="reason"><option value="">全部</option>'+reasons.map(reason=>'<option>'+esc(reason)+'</option>').join('')+'</select></label><label>本次结果 <select id="status"><option value="">全部</option><option>PASS</option><option>FAIL</option><option>NOT_RUN</option></select></label>'+cards.join('')+'<script>function filter(){const reason=document.getElementById("reason").value,status=document.getElementById("status").value;for(const card of document.querySelectorAll("article"))card.hidden=!!((reason&&card.dataset.reason!==reason)||(status&&card.dataset.status!==status));}document.getElementById("reason").addEventListener("change",filter);document.getElementById("status").addEventListener("change",filter);</script></html>',{flag:'wx'});
console.log(JSON.stringify({calls:summary.realModelCalls,delivered:summary.delivered,clarifications:summary.clarifications,failed:summary.failed,notRun:summary.notRun,previousFailures:summary.previousFailures,browser:summary.browser,initialClipping:summary.initialClipping}));
