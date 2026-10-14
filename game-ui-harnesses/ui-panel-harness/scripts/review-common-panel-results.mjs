/** Actual model results and separately labelled offline geometry treatment. No model access. */
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {expectedTypes} from '../examples/all-components-v1/fixture.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--browser','--replay','--replay-browser','--output'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=resolve(args[i+1]);}
assert.equal(Object.keys(options).length,6);
const prepared=options['--prepared'],run=options['--run'],browser=options['--browser'],replay=options['--replay'],replayBrowser=options['--replay-browser'];
const plan=await readJson(join(prepared,'input-adaptability-plan.json')),original=await readJson(join(run,'input-adaptability-report.json'));
const checked=await readJson(join(browser,'browser-report.json')),treatment=await readJson(join(replay,'input-adaptability-report.json')),rechecked=await readJson(join(replayBrowser,'browser-report.json'));
for(const record of [original,checked,treatment,rechecked])assert.equal(record.planSha256,plan.sha256);
assert.equal(treatment.kind,'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS');assert.equal(treatment.realModelCalls,0);assert.equal(rechecked.status,'PASS');
assert.equal(treatment.originalReportSha256,await digestBytes(await readFile(join(run,'input-adaptability-report.json'))));
assert.equal(original.realModelCalls,64);assert.equal(plan.cases.length,64);assert.equal(original.results.length,64);
const output=await createOutputDirectory(options['--output']),esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const href=path=>esc(relative(output,path).replaceAll('\\','/'));
const agentNotes={
  G02:'“游戏大厅”被理解成多人房间，加入房间码、席位和地图；简短请求尚不能保证用途理解一致。',
  G09:'用户只说加载失败，草稿自行断定网络问题。原因未知时应保持中性。',
  G13:'“先完成前置关卡”是草稿添加的解锁条件，用户没有提供这一规则。',
  G18:'角色详情增加了昵称编辑和保存资料，可能超出查看详情的用途。使用的是公共示例图片，并非新生成角色美术。',
  G20:'正文出现“通知游戏宿主处理”的实现说明；不应进入玩家面板。',
  G21:'页签“装备栏”和内容标题“装备栏”重复，标题精简规则还需要覆盖页签内部。',
  G25:'按钮写成“请求购买”；玩家看到的操作名称应更自然。',
  G41:'按钮写成“请求领取示例奖励”；示例标记适用于数据，不必堆进操作名称。',
  G43:'活动详情仍使用“查看活动”按钮，操作意图需要审阅。',
  G45:'邮件详情只有信息，未提供关闭或领取动作；是否由外部导航负责，需要按游戏接入场景判断。',
  G59:'页签“道具”和内容标题“道具”重复，尺寸修复保留了原文，未把该问题掩盖为已解决。',
};
const rows=[],cards=[],typeCases=new Map();
for(const entry of plan.cases){
  const expectation=await readJson(join(prepared,entry.id+'.expectation.json')),item=expectation.case;
  const actual=original.results.find(x=>x.id===entry.id),before=checked.results.find(x=>x.id===entry.id),fitted=treatment.results.find(x=>x.id===entry.id),after=rechecked.results.find(x=>x.id===entry.id);
  assert.equal(fitted.originalStatus,actual.status);assert.equal(Boolean(actual.delivery),Boolean(fitted.delivery));
  const row={id:entry.id,title:item.reference.title,category:item.category,request:item.request.text,modelStatus:actual.status,
    originalBrowser:before?.status??'NOT_APPLICABLE',offlineBrowser:after?.status??'NOT_APPLICABLE',changes:fitted.changes??[],
    originalClippedButtons:before?.initialPresentation?.clippedButtons??[],offlineClippedButtons:after?.initialPresentation?.clippedButtons??[],
    diagnostic:actual.diagnostic??null,agentObservation:agentNotes[entry.id]??null,humanReview:'NOT_RECORDED'};
  rows.push(row);let content='';
  const shot=(directory,label,path)=>'<section><h3>'+esc(label)+'</h3><img loading="lazy" src="'+href(join(directory,path))+'" alt="'+esc(entry.id+' '+label)+'"></section>';
  if(actual.delivery){
    const bundle=await readJson(join(run,entry.id,'panel.bundle.json')),flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
    for(const type of new Set(flatten(bundle.componentBundle.document.root).map(node=>node.type)))typeCases.set(type,[...(typeCases.get(type)??[]),entry.id]);
    content=row.changes.length?'<div class="pair">'+shot(browser,'真实模型原始画面',entry.id+'-initial.png')+shot(replayBrowser,'离线调整尺寸后',entry.id+'-initial.png')+'</div>':shot(browser,'真实模型原始画面',entry.id+'-initial.png');
    content+='<p><a href="'+href(join(run,entry.id,'delivery/pixi/index.html'))+'">试玩原版</a> · <a href="'+href(join(run,entry.id,'panel.zip'))+'" download>下载原版</a>'+
      (row.changes.length?' · <a href="'+href(join(replay,entry.id,'delivery/pixi/index.html'))+'">试玩尺寸调整版</a> · <a href="'+href(join(replay,entry.id,'panel.zip'))+'" download>下载尺寸调整版</a>':'')+'</p>';
    if(row.changes.length)content+='<p>仅改变尺寸：'+esc(row.changes.map(x=>x.dimension+' '+x.before+' → '+x.after).join('；'))+'。原文字、动作、状态和图片保留。</p>';
    if(after?.pagePresentations?.length)content+='<details><summary>其他页签的初始画面</summary>'+after.pagePresentations.filter(x=>x.activePage!==after.initialPresentation.activePage).map(x=>shot(replayBrowser,'尺寸调整版 · '+x.activePage,entry.id+'-'+x.activePage+'-initial.png')).join('')+'</details>';
    const draft=await readJson(join(run,entry.id,'draft-review.json'));
    content+='<details><summary>原始草稿事实</summary><pre>'+esc(JSON.stringify(draft,null,2))+'</pre></details>';
  }else content='<p class="failure">未生成可交付面板；没有用程序夹具补充为模型成功。</p><details><summary>失败证据</summary><pre>'+esc(JSON.stringify({code:actual.code,diagnostic:actual.diagnostic},null,2))+'</pre></details>';
  const design=await readJson(join(prepared,entry.id+'.design.json'));
  cards.push('<article data-group="'+esc(item.category)+'" data-status="'+actual.status+'" data-changed="'+(row.changes.length?'yes':'no')+'"><h2>'+esc(entry.id+' · '+item.reference.title)+'</h2><p class="request">'+esc(item.request.text)+'</p><p>'+esc(actual.delivery?'生成成功 · 原版交互 '+row.originalBrowser+' · 离线重放 '+row.offlineBrowser:'生成失败 · '+actual.code)+'</p>'+
    (row.agentObservation?'<p class="note">审阅观察：'+esc(row.agentObservation)+'</p>':'')+content+
    '<details><summary>首屏检查记录</summary><pre>'+esc(JSON.stringify({before:before?.initialPresentation??null,after:after?.initialPresentation??null,pages:after?.pagePresentations??null},null,2))+'</pre></details>'+
    '<details><summary>本轮实际发送的完整提示</summary><pre>'+esc(design.prompt)+'</pre></details></article>');
}
const groups=[...new Set(rows.map(x=>x.category))],counts=groups.map(category=>({category,total:rows.filter(x=>x.category===category).length,delivered:rows.filter(x=>x.category===category&&x.modelStatus==='PASS').length,failed:rows.filter(x=>x.category===category&&x.modelStatus==='FAIL').length}));
const summary={kind:'REAL_COHORT_WITH_SEPARATE_OFFLINE_LAYOUT_COMPARISON',planSha256:plan.sha256,realModelCalls:64,automaticRetries:0,delivered:rows.filter(x=>x.modelStatus==='PASS').length,
  failed:rows.filter(x=>x.modelStatus==='FAIL').length,clarifications:original.outcomes.clarification,notRun:original.notRun,originalBrowser:{panels:checked.panels,checks:checked.checks,status:checked.status},
  offlineBrowser:{panels:rechecked.panels,checks:rechecked.checks,status:rechecked.status},changed:rows.filter(x=>x.changes.length).map(x=>x.id),
  originalClipping:rows.filter(x=>x.originalClippedButtons.length).map(x=>x.id),offlineClipping:rows.filter(x=>x.offlineClippedButtons.length).map(x=>x.id),groups:counts,rows,
  humanReview:'NOT_RECORDED',contentReview:'AGENT_OBSERVATIONS_NOT_HUMAN_APPROVAL',unityNative:'NOT_RUN_THIS_COHORT',repeatedRequestStability:'NOT_MEASURED'};
summary.componentCoverage={expectedTypes,missing:expectedTypes.filter(type=>!typeCases.has(type)),casesByType:Object.fromEntries(typeCases)};
await writeNewJson(output,'review-summary.json',summary);
await writeFile(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>游戏面板短口令 · 真实结果与排版对照</title><style>body{max-width:1180px;margin:32px auto;padding:0 20px;background:#f0f5f3;color:#203b35;font:16px/1.65 system-ui}article{background:white;border-radius:14px;padding:24px;margin:22px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{min-width:0}img{max-width:100%;max-height:780px;object-fit:contain;object-position:left top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.request{font-size:21px;font-weight:600}.note{background:#fff3d5;padding:12px;border-radius:8px}.failure{color:#a13225}select{padding:9px;margin:6px}a{color:#087769}details{margin:12px 0}td,th{padding:7px 20px 7px 0;text-align:left}h3{font-size:16px}@media(max-width:760px){.pair{grid-template-columns:1fr}}</style><h1>游戏通用面板 · 短口令真实测试</h1><p>56 类常见面板、4 条口语变体、4 条明确约束。真实模型调用 64 次，41 份交付、23 次结构校验失败、0 次澄清、0 次自动重试。</p><p>原版 41 份通过 '+checked.checks+' 项交互检查，但 6 份首屏存在按钮裁切。离线重放仅调整 8 份草稿尺寸，新增模型调用 0 次；41 份通过 '+rechecked.checks+' 项检查，包括各页签初始按钮可见性。23 次生成失败仍保留。</p><p>生成接口的约束和错误定位已修复并通过离线测试，尚未做修复后的真实模型复测。内容观察由 Agent 记录，不是用户验收；原生 Unity 本轮未测。有限样本不能证明所有游戏需求和重复请求都稳定成功。</p><table><tr><th>类别</th><th>请求</th><th>交付</th><th>失败</th></tr>'+counts.map(x=>'<tr><td>'+esc(x.category)+'</td><td>'+x.total+'</td><td>'+x.delivered+'</td><td>'+x.failed+'</td></tr>').join('')+'</table><p><a href="'+href(join(run,'input-adaptability-report.json'))+'">原始调用记录</a> · <a href="'+href(join(browser,'browser-report.json'))+'">原版交互检查</a> · <a href="'+href(join(replayBrowser,'browser-report.json'))+'">尺寸重放检查</a></p><label>类别 <select id="group"><option value="">全部</option>'+groups.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select></label><label>结果 <select id="status"><option value="">全部</option><option value="FAIL">生成失败</option><option value="PASS">生成成功</option><option value="changed">尺寸调整对照</option></select></label>'+cards.join('')+'<script>function filter(){const g=document.getElementById("group").value,s=document.getElementById("status").value;for(const a of document.querySelectorAll("article"))a.hidden=!!((g&&a.dataset.group!==g)||(s&&(s==="changed"?a.dataset.changed!=="yes":a.dataset.status!==s)));}document.getElementById("group").addEventListener("change",filter);document.getElementById("status").addEventListener("change",filter);</script></html>',{flag:'wx'});
console.log(JSON.stringify({calls:64,delivered:summary.delivered,failed:summary.failed,changed:summary.changed,offlineChecks:rechecked.checks}));
