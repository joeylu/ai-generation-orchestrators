import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
const args=process.argv.slice(2);assert(args.length===6&&args[0]==='--run'&&args[2]==='--browser'&&args[4]==='--output');
const run=resolve(args[1]),browser=resolve(args[3]),report=await readJson(join(run,'input-adaptability-report.json')),checks=await readJson(join(browser,'browser-report.json'));
assert.equal(report.kind,'DETERMINISTIC_HEADING_REPLAY');assert.equal(checks.status,'PASS');assert.equal(checks.panels,report.results.length);
const output=await createOutputDirectory(args[5]);
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const href=p=>esc(relative(output,p).replaceAll('\\','/'));let html='';
for(const auto of report.results.filter(r=>r.mode==='auto')){
  const show=report.results.find(r=>r.id===auto.id.replace(/_auto$/,'_show'));assert(show);
  const oldBrowser=auto.sourceRun==='short-input-real-v1'?'short-input-browser-v1':'heading-short-input-browser-v1';
  const variants=[{label:'原版',image:resolve('output',oldBrowser,auto.sourceId+'-initial.png'),headings:auto.originalHeadings,preview:resolve('output',auto.sourceRun,auto.sourceId,'delivery/pixi/index.html')},
    ...[auto,show].map(r=>({label:r.mode==='auto'?'新规则：自动':'明确要求：显示全部',image:join(browser,r.id+'-initial.png'),headings:r.visibleHeadings,preview:join(run,r.id,'delivery/pixi/index.html')}))];
  html+='<article><h2>'+esc(auto.sourceId+' · '+auto.sourceRun)+'</h2><div class="grid">';
  for(const v of variants){await access(v.image);html+='<section><h3>'+esc(v.label)+'</h3><p>分组标题：'+esc(v.headings.join(' / ')||'无')+'</p><a href="'+href(v.preview)+'">试玩</a><img loading="lazy" src="'+href(v.image)+'" alt="'+esc(v.label)+'"></section>';}
  html+='</div></article>';
}
await writeFile(join(output,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>操作区标题规则对照</title><style>body{margin:28px auto;padding:0 20px;max-width:1600px;font:16px/1.6 system-ui;color:#243b3b;background:#eef3f2}article{background:white;padding:20px;border-radius:14px;margin:24px 0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}img{width:100%;margin-top:10px;border:1px solid #dae4e1}a{color:#067263}h2{font-size:19px}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style><h1>操作区不再额外加小标题</h1><p>6份已保存真实方案 × 自动／显式显示两种模式，共12份离线重放，新增模型调用0。'+checks.checks+'项浏览器检查通过。保留主标题、内容分组、控件、默认值和动作；仅采用新版本标题显示策略。</p><p>自动模式：单组无页签面板隐藏副标题；多组无页签面板隐藏纯按钮分组标题。显式显示模式保留全部标题。页签标题继续保留。原几何参数不变，既有滚动裁切可能仍存在；此页不表示重新调用模型成功，也未切换Studio默认目录。</p>'+html+'</html>',{flag:'wx'});
await writeNewJson(output,'summary.json',{kind:'DETERMINISTIC_HEADING_REVIEW',sourcePanels:report.results.length/2,panels:checks.panels,checks:checks.checks,realModelCalls:0});
console.log(JSON.stringify({sourcePanels:report.results.length/2,panels:checks.panels,checks:checks.checks}));
