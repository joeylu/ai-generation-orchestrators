/** Full short-request coverage review. Planned specimens never appear as real-model results. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestJson,digestBytes} from '../src/canonical.mjs';
import {summarizeStabilitySamples} from './lib/panel-stability-review.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--browser','--output'].includes(args[i])&&args[i+1]);options[args[i]]=resolve(args[i+1]);}
assert(options['--prepared']&&options['--output']);assert(Boolean(options['--run'])===Boolean(options['--browser']));
const prepared=options['--prepared'],plan=await readJson(join(prepared,'input-adaptability-plan.json')),{sha256,...payload}=plan;
assert.equal(await digestJson(payload),sha256);assert(['daily-choice-fix-v1','daily-defaults-v1','common-panels-v1','common-panels-fix-v1','panel-stability-v1','panel-stability-fix-v1','panel-copy-fix-v1','panel-compact-message-v1'].includes(plan.cohort));
const report=options['--run']?await readJson(join(options['--run'],'input-adaptability-report.json')):null;
const browser=options['--browser']?await readJson(join(options['--browser'],'browser-report.json')):null;
if(report){assert.equal(report.planSha256,sha256);assert.equal(browser.planSha256,sha256);assert.equal(report.results.length,plan.cases.length);}
const introduction=plan.cohort==='daily-choice-fix-v1'?'选择控件默认项复测：背包、设置、角色、商店4条原短口令。补齐Select、Radio、List每组恰一个默认选项及Tabs初始页的内部规则；不修改旧失败，不自动补选。最多4次，各一次，0重试，当前真实调用0。':plan.cohort==='daily-defaults-v1'?'最后一批日常默认验收：设置、暂停、结算、角色、背包、商店、登录、退出8条原短口令。采用完整日常目录与12个自有图标，生产共享提示逐字相同，无skill摘录或图片生成，每项一次，最多8次，0自动重试。当前计划不代表生成成功。':plan.cohort==='panel-compact-message-v1'?'紧凑确认框及角色回归：两类各3次原短口令＋1条改写，最多8次。新message.text@0.2.0显式启用正文实际高度、短问句和按钮组居中；长正文左对齐，明确尺寸和数据标签保留。不改用户原输入、无图片库、不注入skill，每项一次、0自动重试；计划页不展示程序夹具为模型结果。':plan.cohort==='panel-copy-fix-v1'?'正文标签与中性角色占位复验：两类各3次原短口令＋1条改写，最多8次。新message.text显式排版隐藏语义标签的显示；数据字段仍显示标签。静态角色占位不用当前角色名字。原输入不改，每项一次，串行、0自动重试，无图片库，不注入skill；效果等待真实测试。':plan.cohort==='panel-stability-fix-v1'?'集中复验角色选择和退出确认：每类原短口令3次＋口语改写1次，最多8次。保留历史案例ID和用户原文，使用新计划和新授权；每项独立一次，无自动重试。验证角色占位文字容纳、选择控件，以及退出／取消两个选择从初始状态直接点击并分别发出事件。当前修正提示、0.34标题规则；无图片库，不注入skill。3次重复仅为初步抽样。':plan.cohort==='panel-stability-v1'?'8类面板 ×（同一短口令独立生成3次＋口语改写1次），共32次上限。三轮交错、每个案例独立一次，无自动重试；案例ID和上下文摘要不同，用户文字相同。使用后续修正提示与0.34标题规则，无测试图片库，不注入skill。3次重复仅是初步抽样，不保证普遍稳定。':plan.cohort==='common-panels-fix-v1'?'集中复测37条原始短口令：23条旧失败、8条尺寸问题、5条内容问题、1条明确设置要求。新独立计划，每项一次，最多37次，无自动重试。统一草稿优先、标题策略0.34，不加入skill摘录。':'56类面板＋4条口语变体＋4条明确约束。每项一次，最多64次，无自动重试。统一草稿优先与标题策略0.33，不加入skill摘录。';
const output=await createOutputDirectory(options['--output']),esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const href=path=>esc(relative(output,path).replaceAll('\\','/'));const rows=[],items=[];let html='';
for(const entry of plan.cases){
  const expectation=await readJson(join(prepared,entry.id+'.expectation.json'));assert.equal(expectation.expectedSpec,null);
  const item=expectation.case,context=await readJson(join(prepared,entry.id+'.context.json')),design=await readJson(join(prepared,entry.id+'.design.json'));
  assert.equal(await digestBytes(new TextEncoder().encode(design.prompt)),design.promptSha256);
  const result=report?.results.find(result=>result.id===entry.id),checked=browser?.results.find(result=>result.id===entry.id);
  items.push(item);
  const row={id:item.id,category:item.category,request:item.request.text,status:result?.status??'NOT_RUN',outcome:result?.outcome??result?.code??'NOT_RUN',browser:checked?.status??'NOT_APPLICABLE',contentReview:'NOT_RECORDED',...(item.stability?{stability:item.stability,interactionReview:checked?.interactionReview??null}: {})};
  if(plan.copyAcceptance?.required)row.copyAcceptance=browser?.copyAcceptance?.results.find(value=>value.id===item.id)??{status:'NOT_RUN'};
  if(plan.focusedAcceptance?.required)row.focusedAcceptance=browser?.focusedAcceptance?.results.find(value=>value.id===item.id)??{status:'NOT_RUN'};
  let image='',facts='';
  if(result?.delivery){
    const b=await readJson(join(options['--run'],item.id,'panel.bundle.json'));
    const flatten=n=>[n,...(n.children??[]).flatMap(flatten)];
    row.visibleHeadings=flatten(b.componentBundle.document.root).filter(n=>/\.section\.[^.]+\.title$/.test(n.id)).map(n=>n.props.text);
    row.initialPresentation=checked?.initialPresentation??null;
    if(checked?.status==='PASS')image='<img loading="lazy" src="'+href(join(options['--browser'],item.id+'-initial.png'))+'" alt="'+esc(item.request.text)+'首屏">';
    image+='<p><a href="'+href(join(options['--run'],item.id,'delivery/pixi/index.html'))+'">试玩</a> · <a href="'+href(join(options['--run'],item.id,'panel.zip'))+'">下载</a></p>';
  }
  if(result?.status==='PASS'){const review=await readJson(join(options['--run'],item.id,'draft-review.json'));if(item.stability)row.knownReview=review.knownReview;facts='<details open><summary>原始草稿与澄清</summary><pre>'+esc(JSON.stringify(review,null,2))+'</pre></details>';}
  rows.push(row);
  html+='<article data-group="'+esc(item.category)+'"><h2>'+esc(item.id+' · '+item.reference.title)+'</h2><p class="request">'+esc(item.request.text)+'</p>'+(item.stability?'<p>第'+item.stability.round+'轮 · '+esc(item.stability.inputKind==='EXACT_TEXT_REPEAT'?'原短口令独立重复':'口语改写')+'</p>':'')+'<p>类别：'+esc(item.category)+' · '+esc(row.status)+' · '+esc(row.outcome)+' · 浏览器 '+esc(row.browser)+'</p>'+image+facts+
    (row.interactionReview?'<details open><summary>实际关键流程观察（与技术PASS分别记录）</summary><pre>'+esc(JSON.stringify(row.interactionReview,null,2))+'</pre></details>':'')+
    (row.focusedAcceptance?'<details open><summary>两个已知问题的专项验收</summary><pre>'+esc(JSON.stringify(row.focusedAcceptance,null,2))+'</pre></details>':'')+
    (row.copyAcceptance?'<details open><summary>正文标签及静态占位专项</summary><pre>'+esc(JSON.stringify(row.copyAcceptance,null,2))+'</pre></details>':'')+
    (row.initialPresentation?'<details><summary>首屏尺寸、裁切和标题</summary><pre>'+esc(JSON.stringify({visibleHeadings:row.visibleHeadings,...row.initialPresentation},null,2))+'</pre></details>':'')+
    '<details><summary>完整模型提示（用户输入保持原样）</summary><pre>'+esc(design.prompt)+'</pre></details>'+
    '<details><summary>评价依据</summary><p>贴合用途；未指定内容是否适度；关键操作清楚；示例信息诚实；无冗余副标题；内容与按钮是否首屏可见；明确约束保持；澄清是否确有必要。开放需求无唯一答案，技术PASS不自动认证这些内容。</p><pre>'+esc(JSON.stringify(item.evaluation,null,2))+'</pre></details></article>';
  assert.equal(context.request.text,item.request.text);
}
const groups=[...new Set(rows.map(row=>row.category))];
const totals={cases:rows.length,realModelCalls:report?.realModelCalls??0,delivered:report?.results.filter(result=>result.delivery).length??0,
  clarification:report?.results.filter(result=>result.outcome==='NEEDS_INPUT').length??0,fail:rows.filter(row=>row.status==='FAIL').length,notRun:rows.filter(row=>row.status==='NOT_RUN').length,
  initialClipping:rows.filter(row=>row.initialPresentation?.clippedButtons.length).map(row=>row.id)};
const stability=plan.stabilityEvaluation?summarizeStabilitySamples(items,rows):null;
await writeNewJson(output,'coverage-review.json',{kind:report?(report.kind==='OFFLINE_BATCH_DRIVER_NOT_MODEL_RESULTS'?'OFFLINE_DRIVER_REVIEW_NOT_MODEL_RESULTS':'COMMON_GAME_PANEL_REAL_REVIEW'):'FROZEN_COMMON_PANEL_PLAN_NOT_MODEL_RESULTS',planSha256:sha256,totals,groups,rows,humanReview:'NOT_RECORDED',...(stability?{stability}: {}),...(plan.focusedAcceptance?{focusedAcceptance:browser?.focusedAcceptance??{status:'NOT_RUN',criteria:plan.focusedAcceptance}}: {}),...(plan.copyAcceptance?{copyAcceptance:browser?.copyAcceptance??{status:'NOT_RUN',criteria:plan.copyAcceptance}}: {})});
await writeFile(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>游戏通用面板短口令测试</title><style>body{max-width:1160px;margin:32px auto;padding:0 20px;font:16px/1.65 system-ui;color:#1c3530;background:#f0f5f3}article{padding:22px;margin:18px 0;background:white;border-radius:14px}.request{font-size:20px;font-weight:600}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}img{max-width:100%;max-height:900px;object-fit:contain;object-position:left top}details{margin:14px 0}select{padding:10px}h2{font-size:19px}a{color:#067466}</style><h1>游戏通用面板 · 简短口令</h1><p>'+esc(introduction)+'</p><p>'+esc(report?'真实调用'+totals.realModelCalls+'次，交付'+totals.delivered+'份，澄清'+totals.clarification+'项，失败'+totals.fail+'项，未运行'+totals.notRun+'项。内容审阅未记录。':'尚未调用模型。当前页面展示冻结请求与真实会发送的系统提示；不展示程序夹具为模型结果。')+'</p><p>这是有限覆盖集，并不穷尽所有游戏类型；复杂HUD、聊天服务、地图交互、支付／认证等能力须按实际支持澄清或通过宿主接入。仅输入适合程度与界面交互评价，不能据此声称游戏业务服务已实现。</p><p>计划摘要：<code>'+sha256+'</code></p><label>查看类别 <select id="group"><option value="">全部</option>'+groups.map(group=>'<option>'+esc(group)+'</option>').join('')+'</select></label>'+html+'<script>document.getElementById("group").addEventListener("change",event=>{document.querySelectorAll("article").forEach(card=>card.hidden=event.target.value&&card.dataset.group!==event.target.value);});</script></html>',{flag:'wx'});
console.log(JSON.stringify(totals));
