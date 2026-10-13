/** Saved-output comparison only. No model calls or changes to source evidence. */
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {SHORT_INPUT_CASES,SHORT_INPUT_ARMS} from '../examples/short-input-comparison-v1/suite.mjs';
const args=process.argv.slice(2);
assert(args.length===8&&args[0]==='--run'&&args[2]==='--before-browser'&&args[4]==='--browser'&&args[6]==='--output');
const run=resolve(args[1]),before=resolve(args[3]),browser=resolve(args[5]);
const report=await readJson(resolve(run,'input-adaptability-report.json')),checked=await readJson(resolve(browser,'browser-report.json'));
assert.equal(report.kind,'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS');assert.equal(checked.status,'PASS');assert.equal(checked.planSha256,report.planSha256);
const output=await createOutputDirectory(args[7]),esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const link=path=>esc(relative(output,path).replaceAll('\\','/'));
const cards=[];
for(const result of report.results){
  const sample=SHORT_INPUT_CASES.find(item=>item.id===result.id);assert(sample);
  const oldImage=resolve(before,result.id+'-initial.png'),newImage=resolve(browser,result.id+'-initial.png');
  let original='<p>原结果未生成可交付面板。</p>';
  try{await access(oldImage);original='<img loading="lazy" src="'+link(oldImage)+'" alt="原始首屏">';}catch(error){if(error.code!=='ENOENT')throw error;}
  let current='<p>'+esc(result.outcome??result.code??result.reason??result.status)+'</p>';
  if(result.delivery){
    assert(checked.results.some(item=>item.id===result.id&&item.status==='PASS'&&item.checks.includes('initial-actions-visible')));await access(newImage);
    current='<img loading="lazy" src="'+link(newImage)+'" alt="调整后首屏"><p><a href="'+link(resolve(run,result.id,'delivery/pixi/index.html'))+'">试玩</a> · <a href="'+link(resolve(run,result.id,'panel.zip'))+'">下载</a></p>';
  }
  const changes=(result.changes??[]).map(item=>`${item.dimension}: ${item.before} → ${item.after}`).join('；');
  cards.push('<article><h2>'+esc(result.id+' · '+SHORT_INPUT_ARMS[Number(result.id[1])].designArm)+'</h2><p class="request">'+esc(sample.request.text)+'</p><p>原结果：'+esc(result.originalStatus)+'；本次：'+esc(result.delivery?'离线重放通过（非模型复测）':'保留原结果')+'</p><p>'+esc(changes||'未调整尺寸')+'</p><div class="pair"><section><h3>原始首屏</h3>'+original+'</section><section><h3>调整后</h3>'+current+'</section></div></article>');
}
await writeFile(resolve(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>短输入排版修复对照</title><style>body{max-width:1240px;margin:32px auto;padding:0 20px;background:#f4f7f8;color:#20313b;font:16px/1.6 system-ui}article{background:white;padding:24px;margin:24px 0;border-radius:16px}h2{font-size:20px}.request{font-weight:bold}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}section{min-width:0}img{width:100%;border:1px solid #dde4e8}a{color:#086e67}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>短输入排版修复对照</h1><p>原批真实调用32次；本次新增模型调用0次。22份面板通过177项浏览器检查，包括首次交互前的按钮可见性。仅调整明确允许变化的草稿尺寸，控件、文案、默认值和动作保持不变。</p><p>两份原宽度失败已恢复，六份滚动面板可完整显示；另有一份画布增加4像素边距。未保留原始无效意图的失败、澄清、连接中断及未运行案例保持原结果。此功能为显式启用的草稿布局辅助，尚未切换Studio默认策略。</p><p><a href="'+link(resolve(browser,'browser-report.json'))+'">浏览器证据</a> · <a href="'+link(resolve(run,'input-adaptability-report.json'))+'">重放记录</a></p>'+cards.join('')+'</html>',{flag:'wx'});
await writeNewJson(output,'review-summary.json',{status:'GENERATED',cards:cards.length,panels:checked.panels,checks:checked.checks,realModelCalls:0,planSha256:report.planSha256});
console.log(JSON.stringify({cards:cards.length,panels:checked.panels,checks:checked.checks,realModelCalls:0}));
