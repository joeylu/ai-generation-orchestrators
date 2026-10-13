/** Objective layout comparison plus a label-blinded gallery; no model/human scores invented. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestJson,digestBytes} from '../src/canonical.mjs';
const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){assert(['--prepared','--run','--browser','--output'].includes(args[i])&&args[i+1]);options[args[i]]=args[i+1];}
assert.equal(Object.keys(options).length,4);
const prepared=resolve(options['--prepared']),run=resolve(options['--run']),browser=resolve(options['--browser']);
const plan=await readJson(join(prepared,'input-adaptability-plan.json')),report=await readJson(join(run,'input-adaptability-report.json')),checks=await readJson(join(browser,'browser-report.json'));
assert(['skill-layout-v1','skill-layout-v2','short-input-v1'].includes(plan.cohort));assert.equal(report.planSha256,plan.sha256);assert.equal(checks.planSha256,plan.sha256);
assert.equal(report.results.length,plan.cases.length);assert(checks.sourceCohortComplete);
const output=await createOutputDirectory(options['--output']),arms=plan.designComparison.arms;
const shuffled=await Promise.all(arms.map(async arm=>({arm,key:await digestJson({plan:plan.sha256,arm})})));
shuffled.sort((a,b)=>a.key.localeCompare(b.key));const aliases=Object.fromEntries(shuffled.map(({arm},i)=>[arm,String.fromCharCode(65+i)]));
await writeNewJson(output,'unblind.json',{warning:'Open after rating screenshots; labels are hidden in the gallery, not a cryptographic blind.',aliases});
const href=path=>relative(output,path).replaceAll('\\','/'),escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const rows=[],blocks=[];
for(const panelCaseId of [...new Set(plan.cases.map(item=>item.panelCaseId))]){
  const entries=plan.cases.filter(item=>item.panelCaseId===panelCaseId),cards=[],layouts=[];
  for(const entry of entries.sort((a,b)=>aliases[a.designArm].localeCompare(aliases[b.designArm]))){
    const result=report.results.find(item=>item.id===entry.id),checked=checks.results.find(item=>item.id===entry.id),alias=aliases[entry.designArm];
    const detail={caseId:entry.id,panelCaseId,arm:entry.designArm,alias,business:result.status,browser:checked?.status??'NOT_APPLICABLE',code:result.code??null};
    let content='<p>本项未产生业务通过的交付，保留失败，不以其他结果补位。</p>';
    let draftReview=null;
    if(plan.evaluation&&result.status==='PASS'){
      draftReview=await readJson(join(run,entry.id,'draft-review.json'));
      content='<p>本项返回澄清；问题是否必要待人工评价。</p>';
      detail.outcome=result.outcome;detail.humanReview='NOT_RECORDED';
    }
    if(result.status==='PASS'&&result.delivery){
      const bundle=await readJson(join(run,entry.id,'panel.bundle.json'));
      detail.layoutSha256=await digestJson(bundle.componentBundle.document);layouts.push(detail.layoutSha256);
      detail.canvas=bundle.spec.canvas;detail.panelWidth=bundle.spec.layout.width;detail.sections=bundle.spec.sections.length;
      detail.theme=bundle.spec.theme;detail.compilerVersion=bundle.compilerVersion;
      const screenshot=await readFile(join(browser,entry.id+'-initial.png')),name=panelCaseId+'-'+alias+'.png';await writeFile(join(output,name),screenshot,{flag:'wx'});
      detail.screenshotSha256=await digestBytes(screenshot);
      content=`<img loading="lazy" src="${name}" alt="${panelCaseId}方案${alias}截图"><p><a href="${href(join(run,entry.id,'delivery/pixi/index.html'))}">试玩</a> · <a href="${href(join(run,entry.id,'panel.zip'))}" download>下载ZIP</a></p>`;
    }
    if(draftReview)content+='<details open><summary>原始需求、草稿内容与澄清（未通过人工合理性评价）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+escape(JSON.stringify(draftReview,null,2))+'</pre></details>';
    rows.push(detail);cards.push(`<article><h3>方案 ${alias}</h3><p>${plan.evaluation?'协议与明确约束':'业务'} ${escape(detail.business)} · 浏览器 ${escape(detail.browser)}</p>${content}<label>视觉评分（1—5，留在本机）<input type="number" min="1" max="5" data-rating="${panelCaseId}-${alias}"></label><label>观察<textarea data-note="${panelCaseId}-${alias}" placeholder="内容是否合理、澄清是否必要、假设是否合适、层级与布局"></textarea></label></article>`);
  }
  blocks.push(`<section><h2>${panelCaseId}</h2><p>业务通过结果中，组件文档共有 ${new Set(layouts).size} 种。相同文档不代表所有像素相同；分组文案差异也会计入文档摘要。</p><div class="grid">${cards.join('')}</div></section>`);
}
const summary={status:report.status==='PASS_BEFORE_BROWSER'&&checks.status==='PASS'?'TECHNICAL_PASS_VISUAL_PENDING':'TECHNICAL_FAILURES_VISUAL_PENDING',
  ...(plan.evaluation?{evaluation:plan.evaluation,contentAndClarificationReview:'NOT_RECORDED'}:{}),
  planSha256:plan.sha256,realModelCalls:report.realModelCalls,automaticRetries:report.automaticRetries,humanVisualReview:'NOT_RECORDED',
  repetitionsPerCase:1,populationRanking:'NOT_ESTABLISHED',rows};
await writeNewJson(output,'comparison.json',summary);
const storageKey='skill-layout-review-'+plan.sha256;
await writeFile(join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>游戏UI规则与提示对照</title><style>body{margin:28px auto;padding:0 20px;max-width:1800px;font:16px/1.6 system-ui;background:#f2f6f4;color:#20332e}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}article{background:white;padding:16px;border:1px solid #c4d3cd;border-radius:12px}img{width:100%}h3{text-align:center}label{display:block;margin:12px 0}textarea{display:block;width:95%;min-height:80px}input{width:55px}button{padding:12px;font:inherit}a{color:#157c64}</style><h1>游戏UI规则与提示对照</h1><p>同一组用户输入、同一模型/主题/编译器；具体提示实验条件见冻结计划。每组合每案例一次；本轮不证明稳定性。候选名称隐藏为匿名字母，技术失败全部展示。不要把技术通过当作内容合理、澄清必要或美术通过。</p><p>先检查内容和澄清是否符合原始需求，再按用途匹配、标题正文层级、留白、主次操作和一致性判断。评分只保存在当前浏览器，也可由你主动导出JSON；不发送给服务。</p><button id="export">导出我的评分</button><p id="storage-status" role="status"></p>${blocks.join('')}<p><a href="unblind.json">完成评价后查看候选对应表</a></p><script>const key=${JSON.stringify(storageKey)},status=document.getElementById('storage-status');let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')}catch{status.textContent='本地保存不可用，仍可主动导出评分。'}document.querySelectorAll('input,textarea').forEach(el=>{const id=el.dataset.rating||el.dataset.note,kind=el.dataset.rating?'rating':'note';el.value=saved[id]?.[kind]||'';el.addEventListener('input',()=>{saved[id]={...saved[id],[kind]:el.value};try{localStorage.setItem(key,JSON.stringify(saved))}catch{status.textContent='本地保存不可用，请主动导出评分。'}})});document.getElementById('export').onclick=()=>{const blob=new Blob([JSON.stringify({planSha256:${JSON.stringify(plan.sha256)},kind:'USER_ENTERED_VISUAL_RATINGS',ratings:saved},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='game-ui-layout-ratings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};</script></html>`,{flag:'wx'});
console.log(JSON.stringify({status:summary.status,cases:rows.length,realModelCalls:summary.realModelCalls,humanVisualReview:'NOT_RECORDED'}));
