#!/usr/bin/env node
/** A gallery of accepted, authored Pixi fixtures; never calls a planner. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {createOutputDirectory,readJson,writeNewJson,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {canonicalJson,digestBytes} from '../src/canonical.mjs';
assert(process.argv.length===6&&process.argv[2]==='--source'&&process.argv[4]==='--output');
const source=resolve(process.argv[3]),output=await createOutputDirectory(process.argv[5]);
const report=await readJson(resolve(source,'asset-usage-browser-report.json'));
assert.equal(report.status,'PASS');assert.equal(report.comparison,'minimal-v1');assert.equal(report.modelCalls,0);
const core=await loadWorkspaceCore(),panels={},references=[];
const purposes={settings:'声音设置',role:'角色命名',dialog:'确认弹窗',pause:'暂停菜单',menu:'主菜单',loading:'加载进度'};
let cards='';
for(const [purpose,label] of Object.entries(purposes))for(const mode of ['light','dark']) {
  const id=`${purpose}-${mode}`,file=resolve(source,'sources',`${id}.after.panel.bundle.json`),bytes=await readFile(file);
  const bundle=await validatePanelBundle(JSON.parse(bytes),core);assert.equal(bundle.compilerVersion,'0.19.0');panels[id]=bundle;
  references.push({id,sha256:await digestBytes(bytes),bundleSha256:bundle.sha256});
  const zip=relative(output,resolve(source,'delivery',`${id}.panel-delivery.zip`)).split(sep).map(part=>encodeURIComponent(part)).join('/');
  cards+=`<article id="case-${id}"><header><h2>${label}</h2><span>${mode==='light'?'浅色':'深色'}</span><a href="${zip}" download>下载</a></header><div class="stage ${mode}"><div class="canvas" id="${id}"></div></div></article>`;
}
const {build}=await loadWorkspaceTool('vite');
const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
  lib:{entry:resolve(harnessRoot,'examples/minimal-art-v1/overview.mjs'),name:'MinimalArtReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(r=>r.output);assert.equal(chunks.length,1);
await writeFile(resolve(output,'review.js'),chunks[0].code,{flag:'wx'});
await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>简约面板 · 美术预览</title><style>*{box-sizing:border-box}body{margin:0;background:#0E1517;color:#EDF5F3;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1440px;padding:36px 24px;margin:auto}.intro{display:flex;align-items:end;justify-content:space-between;gap:24px;flex-wrap:wrap}h1{font-size:28px;font-weight:500;letter-spacing:1px;margin:0}.intro p{color:#A5B9B4;margin:8px 0 0}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}a{color:#90E6CF;text-decoration:none}nav a{padding:8px 16px;border:1px solid #35494A;border-radius:8px}a:focus-visible{outline:2px solid #90E6CF;outline-offset:3px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}article{display:flex;flex-direction:column;min-width:0;border:1px solid #293B3B;border-radius:16px;overflow:hidden;scroll-margin-top:24px}header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:#162023}h2{font-size:14px;font-weight:500;margin:0}header span{color:#A5B9B4;font-size:12px}header a{margin-left:auto;font-size:12px}.stage{display:flex;align-items:center;justify-content:center;min-height:0;flex:1;padding:0 8px}.stage.light{background:#EDF2F0}.stage.dark{background:#101719}.canvas{width:100%;min-width:0}.panel-instance-surface{margin:auto}footer{color:#A5B9B4;font-size:12px;margin-top:24px}@media(max-width:800px){main{padding:24px 16px}.grid{grid-template-columns:1fr}.intro{gap:8px}}</style><main><div class="intro"><div><h1>简约面板</h1><p>薄荷色强调 · 清晰排版 · 统一控件美术</p></div><span id="status" role="status">可直接试玩输入、滑杆、开关和按钮</span></div><nav>${Object.entries(purposes).map(([id,label])=>`<a href="#case-${id}-light">${label}</a>`).join('')}</nav><div class="grid">${cards}</div><footer>程序夹具 · minimal-v1 / compiler 0.19 · 模型调用 0 次 · Unity 导出数据已检查，原生编辑器未验收</footer></main><script id="panels" type="application/json">${canonicalJson(panels).replaceAll('<','\\u003c')}</script><script src="review.js"></script></html>`,{flag:'wx'});
const {chromium}=await loadWorkspaceTool('@playwright/test');const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],requests=[];
try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>errors.push(e.name));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(resolve(output,'index.html')).href);await page.waitForFunction(()=>document.documentElement.dataset.ready);assert.equal(await page.evaluate(()=>document.documentElement.dataset.ready),'true');
  assert.deepEqual(await page.evaluate(()=>window.minimalArtReview.errors()),[]);assert.equal(await page.locator('canvas').count(),12);
  for(const id of Object.keys(panels)){assert((await page.evaluate(id=>window.minimalArtReview.get(id).inspect().nodes.length,id))>0);const stage=await page.locator(`#case-${id} .stage`).boundingBox(),card=await page.locator(`#case-${id}`).boundingBox();assert(stage.y+stage.height<=card.y+card.height,'stage must stay inside its visible card');}
  await page.screenshot({path:resolve(output,'overview.png'),fullPage:true});
  for(const id of ['settings-dark','role-dark','role-light','menu-dark'])await page.locator(`#case-${id} .stage`).screenshot({path:resolve(output,`${id}.png`)});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await writeNewJson(output,'review-report.json',{status:'PASS',sourceKind:'PROGRAMMATIC_FIXTURE',references,panels:12,narrowViewport:390,modelCalls:0,browserErrors:errors,externalRequests:requests.length,humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN'});
}finally{await browser.close();}
process.stdout.write(JSON.stringify({status:'PASS',panels:12,modelCalls:0})+'\n');
