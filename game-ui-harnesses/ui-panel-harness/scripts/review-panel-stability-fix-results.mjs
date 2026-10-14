/** Post-run comparison and exact native canvas capture; no inference, patches or acceptance overrides. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {harnessRoot,readJson,writeNewJson,createOutputDirectory} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {PANEL_STABILITY_FIX_SUITE,STABILITY_FIX_SOURCE_PLAN_SHA256} from '../examples/panel-stability-fix-v1/suite.mjs';
import {PANEL_STABILITY_GROUPS} from '../examples/panel-stability-v1/suite.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--browser','--audit','--output','--observations'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=resolve(args[i+1]);}
assert(['--prepared','--run','--browser','--audit','--output'].every(key=>options[key]));
const prepared=options['--prepared'],run=options['--run'],browserPath=options['--browser'],auditPath=options['--audit'];
const plan=await readJson(join(prepared,'input-adaptability-plan.json')),{sha256,...payload}=plan;
assert.equal(plan.cohort,'panel-stability-fix-v1');assert.equal(await digestJson(payload),sha256);
assert.equal(plan.sha256,'20810fdd77f126e988111a0afd2adea73e9f65e2826ff053b2ad274586cac5fa');
const reportBytes=await readFile(join(run,'input-adaptability-report.json')),report=JSON.parse(reportBytes);
const browserBytes=await readFile(join(browserPath,'browser-report.json')),checked=JSON.parse(browserBytes),audit=await readJson(join(auditPath,'audit.json'));
for(const value of [report,checked,audit])assert.equal(value.planSha256,sha256);
assert.equal(audit.sourceReportSha256,await digestBytes(reportBytes));assert.equal(audit.browserReportSha256,await digestBytes(browserBytes));
assert.equal(audit.sourceFingerprint,'PASS');assert.equal(audit.receiptIntegrity,'PASS');assert.equal(report.kind,undefined);assert.equal(report.automaticRetries,0);
assert.deepEqual(report.results.map(item=>item.id),PANEL_STABILITY_FIX_SUITE.map(item=>item.id));
const observations=options['--observations']?await readJson(join(options['--observations'],'observations.json')):{kind:'AGENT_OBSERVATIONS_NOT_HUMAN_ACCEPTANCE',planSha256:sha256,realModelCalls:0,notes:[]};
assert.equal(observations.kind,'AGENT_OBSERVATIONS_NOT_HUMAN_ACCEPTANCE');assert.equal(observations.planSha256,sha256);assert.equal(observations.realModelCalls,0);
for(const note of observations.notes){
  assert.equal(note.sourceBundleSha256,audit.cases.find(value=>value.id===note.id)?.panelSha256);
  if(note.evidence)assert.equal(note.evidence.sha256,await digestBytes(await readFile(join(options['--observations'],note.evidence.path))));
}
const previousRun=resolve(harnessRoot,'output/panel-stability-real-v1'),previousPrepared=resolve(harnessRoot,'output/panel-stability-plan-v2');
const previousAudit=await readJson(resolve(harnessRoot,'output/panel-stability-audit-v1/audit.json'));
assert.equal(previousAudit.planSha256,STABILITY_FIX_SOURCE_PLAN_SHA256);assert.equal(previousAudit.receiptIntegrity,'PASS');assert.equal(previousAudit.sourceFingerprint,'PASS');
assert.equal(previousAudit.sourceReportSha256,await digestBytes(await readFile(join(previousRun,'input-adaptability-report.json'))));
const previousCapturesPath=resolve(harnessRoot,'output/panel-stability-canvases-v1'),previousCaptures=await readJson(join(previousCapturesPath,'canvas-captures.json'));
assert.equal(previousCaptures.planSha256,STABILITY_FIX_SOURCE_PLAN_SHA256);assert.equal(previousCaptures.sourceReportSha256,previousAudit.sourceReportSha256);assert.equal(previousCaptures.status,'PASS');
const output=await createOutputDirectory(options['--output']),core=await loadWorkspaceCore(),errors=[],rows=[];
const {chromium}=await loadWorkspaceTool('@playwright/test');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const context=await browser.newContext({viewport:{width:1100,height:2400},reducedMotion:'reduce',serviceWorkers:'block'});
  await context.route('**/*',route=>['file:','data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():(errors.push('EXTERNAL_NETWORK'),route.abort()));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  for(const item of PANEL_STABILITY_FIX_SUITE){
    const result=report.results.find(value=>value.id===item.id),audited=audit.cases.find(value=>value.id===item.id),prior=previousAudit.cases.find(value=>value.id===item.id);
    const sourceRequest=(await readJson(join(previousPrepared,item.id+'.context.json'))).request.text;
    assert.equal(sourceRequest,item.request.text);assert.equal(audited.request,item.request.text);
    const row={id:item.id,request:item.request.text,stability:item.stability,status:result.status,outcome:result.outcome??result.code??result.reason,
      focusedAcceptance:checked.focusedAcceptance.results.find(value=>value.id===item.id),browser:checked.results.find(value=>value.id===item.id)??null,
      prior:{status:prior.status,outcome:prior.observed,knownReview:prior.knownReview,interactionReview:prior.interactionReview,panelSha256:prior.panelSha256},capture:null};
    row.agentNotes=observations.notes.filter(note=>note.id===item.id);
    if(result.delivery){
      const bundle=await validatePanelBundle(await readJson(join(run,item.id,'panel.bundle.json')),core);
      assert.equal(bundle.sha256,audited.panelSha256);row.panelSha256=bundle.sha256;row.canvas=bundle.spec.canvas;
      row.content=bundle.spec.sections.flatMap(section=>section.rows).map(value=>({id:value.id,kind:value.kind,label:value.label,...(value.kind==='button'?{buttonLabel:value.buttonLabel,event:value.event}:{}),...(value.kind==='image'?{source:value.source,width:value.width,height:value.height}: {})}));
      row.knownReview=(await readJson(join(run,item.id,'draft-review.json'))).knownReview;
      await page.goto(pathToFileURL(join(run,item.id,'delivery/pixi/index.html')).href);
      await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status')?.dataset.state));assert.equal(await page.locator('#status').getAttribute('data-state'),'ready');
      assert.deepEqual(await page.evaluate(()=>window.panelDelivery.getState()),bundle.state);assert.deepEqual(await page.evaluate(()=>window.panelDelivery.events()),[]);
      const path=item.id+'-canvas.png';await page.locator('canvas').screenshot({path:join(output,path)});const png=await readFile(join(output,path));
      row.capture={path,sha256:await digestBytes(png),bytes:png.length,sourceBundleSha256:bundle.sha256,state:'EXACT_SAVED_INITIAL_STATE',initialEvents:0};
    }
    const oldCapture=previousCaptures.results.find(value=>value.id===item.id);
    if(oldCapture){assert.equal(oldCapture.sourceBundleSha256,prior.panelSha256);assert.equal(oldCapture.sha256,await digestBytes(await readFile(join(previousCapturesPath,oldCapture.path))));row.prior.capture=oldCapture;}
    rows.push(row);
  }
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
const summary={realModelCalls:report.realModelCalls,delivered:report.results.filter(value=>value.delivery).length,
  clarification:report.results.filter(value=>value.outcome==='NEEDS_INPUT').length,failed:report.fail,notRun:report.notRun,automaticRetries:0,
  browser:{status:checked.status,panels:checked.panels,checks:checked.checks,errors:checked.errors},focusedAcceptance:checked.focusedAcceptance.status,
  focusedPass:checked.focusedAcceptance.results.filter(value=>value.status==='PASS').length,focusedFail:checked.focusedAcceptance.results.filter(value=>value.status!=='PASS').map(value=>value.id),
  knownFlagCases:rows.filter(value=>value.knownReview?.flags.length||value.browser?.interactionReview?.flags.length).map(value=>value.id),
  initialClipping:rows.filter(value=>value.browser?.initialPresentation?.clippedButtons.length).map(value=>value.id),agentNoteCases:rows.filter(value=>value.agentNotes.length).map(value=>value.id),agentNoteKinds:[...new Set(observations.notes.map(note=>note.code))],humanReview:'NOT_RECORDED',populationReliability:'NOT_ESTABLISHED'};
await writeNewJson(output,'comparison.json',{kind:'AUDITED_ORIGINAL_REAL_MODEL_FOCUSED_COMPARISON',planSha256:sha256,sourcePlanSha256:STABILITY_FIX_SOURCE_PLAN_SHA256,
  sourceReportSha256:audit.sourceReportSha256,browserReportSha256:audit.browserReportSha256,summary,rows,captureRealModelCalls:0,errors});
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),href=path=>esc(relative(output,path).replaceAll('\\','/'));
const groups=PANEL_STABILITY_GROUPS.filter(group=>rows.some(row=>row.stability.purpose===group.purpose));
const sections=groups.map(group=>'<section data-purpose="'+esc(group.purpose)+'"><h2>'+esc(group.title)+'</h2><div class="grid">'+rows.filter(row=>row.stability.purpose===group.purpose).map(row=>{
  const old=row.prior.capture;
  return '<article data-id="'+row.id+'"><h3>'+row.id+' · '+(row.stability.round===4?'口语改写':'原口令第'+row.stability.round+'次')+'</h3><p class="request">'+esc(row.request)+'</p><p>交付 '+esc(row.status)+' · 专项 <strong>'+esc(row.focusedAcceptance.status)+'</strong></p>'+
    (row.capture?'<img src="'+esc(row.capture.path)+'" alt="'+esc(row.id+'本轮原始保存状态')+'"><p>画布 '+row.canvas.width+'×'+row.canvas.height+' · <a href="'+href(join(run,row.id,'delivery/pixi/index.html'))+'">试玩原始交付</a> · <a href="'+href(join(run,row.id,'panel.zip'))+'">下载</a></p>':'<p class="failure">无交付：'+esc(row.outcome)+'</p>')+
    (row.agentNotes.length?'<details open><summary>代理内容审阅提醒（不冒充人工验收）</summary>'+row.agentNotes.map(note=>'<p>'+esc(note.detail)+'</p>'+(note.evidence?'<a href="'+href(join(options['--observations'],note.evidence.path))+'">查看实际切换后截图</a>':'')).join('')+'</details>':'')+
    '<details><summary>专项验收与实际事件</summary><pre>'+esc(JSON.stringify({focused:row.focusedAcceptance,flow:row.browser?.interactionReview},null,2))+'</pre></details>'+
    '<details><summary>上轮同口令：'+esc(row.prior.status)+'</summary>'+(old?'<img loading="lazy" src="'+href(join(previousCapturesPath,old.path))+'" alt="'+row.id+'上轮原始结果"><a href="'+href(join(previousRun,row.id,'delivery/pixi/index.html'))+'">上轮原始试玩</a>':'<p>上轮未交付，保留原失败记录。</p>')+'<pre>'+esc(JSON.stringify({known:row.prior.knownReview,flow:row.prior.interactionReview},null,2))+'</pre></details></article>';
}).join('')+'</div></section>').join('');
await writeFile(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>角色与退出确认 · 真实复验</title><style>body{max-width:1660px;margin:28px auto;padding:0 20px;color:#163c35;background:#f0f5f3;font:16px/1.6 system-ui}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}article{background:white;padding:16px;border-radius:12px;min-width:0}h3{font-size:18px}.request{font-weight:600}img{width:100%;height:auto;display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}code{overflow-wrap:anywhere}a{color:#057761}details{margin-top:14px}.failure{color:#a02b38}select{padding:8px}@media(max-width:1100px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:650px){.grid{grid-template-columns:1fr}}</style><h1>角色选择与退出确认 · 8次真实复验</h1><p>真实调用 '+summary.realModelCalls+' 次，原始交付 '+summary.delivered+' 份，澄清 '+summary.clarification+' 项，失败 '+summary.failed+' 项，未运行 '+summary.notRun+' 项，自动重试0。</p><p>常规浏览器 '+summary.browser.panels+' 份／'+summary.browser.checks+' 项：'+esc(summary.browser.status)+'；专项 '+summary.focusedPass+'/8：'+esc(summary.focusedAcceptance)+'。已知问题标记 '+summary.knownFlagCases.length+' 份，初始按钮裁切 '+summary.initialClipping.length+' 份。</p><p>四栏为本轮真实模型的原始输出，未使用离线补丁。展开可看上轮同口令的原始结果。每类3次原文＋1条改写是有限抽样；专项通过只验证已声明的结构和操作，文案、视觉、真实业务服务与Unity原生不据此认证。</p><p><a href="'+href(join(auditPath,'index.html'))+'">完整性审计</a> · <a href="'+href(join(browserPath,'browser-report.json'))+'">浏览器报告</a> · <a href="'+href(join(run,'input-adaptability-report.json'))+'">真实调用记录</a></p><p>计划摘要：<code>'+sha256+'</code></p><label>查看面板 <select id="purpose"><option value="">全部2类</option>'+groups.map(group=>'<option value="'+esc(group.purpose)+'">'+esc(group.title)+'</option>').join('')+'</select></label>'+sections+'<script>document.getElementById("purpose").addEventListener("change",event=>{for(const section of document.querySelectorAll("section[data-purpose]"))section.hidden=!!event.target.value&&section.dataset.purpose!==event.target.value;});</script></html>',{flag:'wx'});
console.log(JSON.stringify(summary));
