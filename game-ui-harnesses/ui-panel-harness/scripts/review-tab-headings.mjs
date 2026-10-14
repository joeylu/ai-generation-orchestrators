/** Review only saved model source plus program-owned versioned heading replays. */
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--source','--source-browser','--run','--browser','--output'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=resolve(args[i+1]);}
assert.equal(Object.keys(options).length,5);
const source=options['--source'],sourceBrowser=options['--source-browser'],run=options['--run'],browser=options['--browser'];
const report=await readJson(join(run,'input-adaptability-report.json')),checks=await readJson(join(browser,'browser-report.json'));
assert.equal(report.treatment,'TAB_HEADING_V4_AUTO_AND_EXPLICIT_SHOW');assert.equal(report.realModelCalls,0);assert.equal(checks.status,'PASS');assert.equal(checks.panels,82);
assert.equal(checks.planSha256,report.planSha256);
const original=await readJson(join(source,'input-adaptability-report.json'));assert.equal(original.planSha256,report.sourcePlanSha256);
const output=await createOutputDirectory(options['--output']),esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const href=path=>esc(relative(output,path).replaceAll('\\','/'));const rows=[],cards=[];
for(const auto of report.results.filter(x=>x.mode==='auto')){
  const show=report.results.find(x=>x.sourceId===auto.sourceId&&x.mode==='show');assert(show);
  const bundle=await readJson(join(run,auto.id,'panel.bundle.json')),changed=JSON.stringify(auto.originalHeadings)!==JSON.stringify(auto.visibleHeadings);
  for(const item of [auto,show])assert.equal(checks.results.find(x=>x.id===item.id)?.status,'PASS');
  rows.push({id:auto.sourceId,title:bundle.spec.title,tabs:Boolean(bundle.spec.tabs),headingChanged:changed,before:auto.originalHeadings,auto:auto.visibleHeadings,show:show.visibleHeadings});
  const variants=[{label:'此前版本 0.33',heads:auto.originalHeadings,image:join(sourceBrowser,auto.sourceId+'-initial.png'),preview:join(source,auto.sourceId,'delivery/pixi/index.html')},
    ...[auto,show].map(x=>({label:x.mode==='auto'?'新规则 0.34 · 自动精简':'新规则 0.34 · 明确显示',heads:x.visibleHeadings,image:join(browser,x.id+'-initial.png'),preview:join(run,x.id,'delivery/pixi/index.html')}))];
  let grid='';for(const v of variants){await access(v.image);grid+='<section><h3>'+esc(v.label)+'</h3><p>分组标题：'+esc(v.heads.join(' / ')||'无')+'</p><a href="'+href(v.preview)+'">试玩</a><img loading="lazy" src="'+href(v.image)+'" alt="'+esc(auto.sourceId+' '+v.label)+'"></section>';}
  const pages=checks.results.find(x=>x.id===auto.id)?.pagePresentations??[];
  cards.push('<article data-changed="'+(changed?'yes':'no')+'" data-tabs="'+(bundle.spec.tabs?'yes':'no')+'"><h2>'+esc(auto.sourceId+' · '+bundle.spec.title)+'</h2><div class="grid">'+grid+'</div>'+
    (pages.length?'<details><summary>其他页签（自动模式）</summary><div class="pages">'+pages.filter(x=>x.activePage!==bundle.state[bundle.spec.tabs.bind]).map(x=>'<img loading="lazy" src="'+href(join(browser,auto.id+'-'+x.activePage+'-initial.png'))+'" alt="'+esc(x.activePage)+'">').join('')+'</div></details>':'')+
    '<details><summary>程序重放证据</summary><pre>'+esc(JSON.stringify({auto,show},null,2))+'</pre></details></article>');
}
const summary={kind:'DETERMINISTIC_TAB_HEADING_REVIEW',realModelCalls:0,originalRealModelCalls:64,sourcePanels:rows.length,panels:checks.panels,checks:checks.checks,
  changed:rows.filter(x=>x.headingChanged).map(x=>x.id),preservedOriginalFailures:report.results.filter(x=>x.status==='FAIL').map(x=>x.id),
  humanReview:'NOT_RECORDED',nativeUnity:'NOT_RUN',rows};
await writeNewJson(output,'summary.json',summary);
await writeFile(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>页签重复标题修复对照</title><style>body{margin:28px auto;padding:0 20px;max-width:1600px;background:#eef3f2;color:#243b36;font:16px/1.65 system-ui}article{background:white;padding:22px;margin:24px 0;border-radius:14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}section{min-width:0}img{max-width:100%;border:1px solid #dbe4e0}.pages{display:grid;grid-template-columns:1fr 1fr;gap:16px}h2{font-size:20px}h3{font-size:16px}a{color:#087363}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}select{padding:10px}details{margin:12px 0}@media(max-width:850px){.grid,.pages{grid-template-columns:1fr}}</style><h1>页签内重复标题 · 修复对照</h1><p>41 份已保存真实方案 × 自动精简／明确显示，两组共 82 份离线重放，新增模型调用 0 次，'+checks.checks+' 项浏览器检查通过。原 23 次生成失败仍保留，不能据此计为复测成功。</p><p>自动模式隐藏页签内的单一内容组标题、重复页签名称及纯按钮操作区标题，保留有区分作用的多个内容组。明确显示模式保留所有分组标题。文字、控件、状态、动作和资源保持；只采用新主题，并在需要时扩大建议尺寸。旧版本回放保持原规则。</p><p>实际标题变化：'+esc(summary.changed.join('、'))+'。生成接口的约束修复与内容提示调整仍待新的真实模型测试，尚未发布。</p><label>筛选 <select id="filter"><option value="changed">标题有变化</option><option value="tabs">有页签</option><option value="all">全部41份</option></select></label>'+cards.join('')+'<script>function filter(){const value=document.getElementById("filter").value;for(const card of document.querySelectorAll("article"))card.hidden=value==="changed"?card.dataset.changed!=="yes":value==="tabs"?card.dataset.tabs!=="yes":false;}document.getElementById("filter").addEventListener("change",filter);filter();</script></html>',{flag:'wx'});
console.log(JSON.stringify({sourcePanels:rows.length,panels:checks.panels,checks:checks.checks,changed:summary.changed,realModelCalls:0}));
