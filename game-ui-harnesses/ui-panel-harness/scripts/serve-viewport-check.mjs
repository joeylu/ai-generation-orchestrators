import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createOutputDirectory,readJson,harnessRoot,writeNewJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {buildDeliveryRuntime} from '../scripts/build-delivery-runtime.mjs';
import {roleRequest,roleIntent} from '../examples/adaptive-v1/fixture.mjs';
const args=process.argv.slice(2);
assert(args.length===2&&args[0]==='--output','VIEWPORT_CHECK_ARGUMENTS');
const output=await createOutputDirectory(args[1]);
const core=await loadWorkspaceCore(),catalog=await readJson(join(harnessRoot,'examples/modern-adaptive.catalog.json'));
const context=await createPlanningContext(roleRequest,catalog),proposal=await materializePanelIntent(context,roleIntent(context));
const bundle=await createPanelBundle(proposal.spec,catalog,core),runtime=await buildDeliveryRuntime();
const delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:await createUnityKitFiles(bundle,core,await readUnityAdapterSources())});
const html=new TextDecoder().decode(delivery.contents.get('pixi/index.html'));
await writeFile(join(output,'panel.bundle.json'),JSON.stringify(bundle)+'\n',{flag:'wx'});
const instrument=`<script>
const metrics={notifications:0,bufferWrites:0,draws:0,errors:[]};window.addEventListener('error',event=>metrics.errors.push(event.message));window.addEventListener('unhandledrejection',()=>metrics.errors.push('UNHANDLED_REJECTION'));
const Observer=ResizeObserver;window.ResizeObserver=class extends Observer{constructor(callback){super((entries,observer)=>{metrics.notifications++;callback(entries,observer);});}};
for(const key of ['width','height']){const d=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);Object.defineProperty(HTMLCanvasElement.prototype,key,{...d,set(value){metrics.bufferWrites++;d.set.call(this,value);}});}
for(const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext])if(Type)for(const key of ['drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced']){const original=Type.prototype[key];if(original)Type.prototype[key]=function(...args){metrics.draws++;return original.apply(this,args);};}
window.addEventListener('message',event=>{if(event.data!=='sample')return;parent.postMessage({metrics:{...metrics},status:document.getElementById('status')?.dataset.state,width:document.getElementById('canvas-host').clientWidth,height:document.documentElement.scrollHeight,state:window.panelDelivery?.getState()},'*');});
<\/script>`;
const fixed=html.replace('<main>',instrument+'<main>');
// A DOM-only historical algorithm reproduces the layout fault independently
// from saved file previews. Its rectangle has the exact authored canvas size.
const old=html.replace('html{scrollbar-gutter:stable}@supports not (scrollbar-gutter:stable){html{overflow-y:scroll}}','')
 .replace(/<script id="panel-seed"[\s\S]*$/,'')+`<script>
const host=document.getElementById('canvas-host'),surface=document.createElement('div');host.append(surface);let count=0;
function resize(){const fit=Math.min(1,Math.max(.1,host.clientWidth/${bundle.spec.canvas.width})),zoom=Math.max(.5,fit);count++;surface.style.transform='scale('+fit/zoom+')';surface.style.transformOrigin='top left';surface.style.width=${bundle.spec.canvas.width}*zoom+'px';surface.style.height=${bundle.spec.canvas.height}*zoom+'px';host.style.height=${bundle.spec.canvas.height}*fit+'px';}new ResizeObserver(resize).observe(host);resize();document.getElementById('panel-title').textContent='角色命名界面';document.getElementById('status').textContent='可交互预览';window.addEventListener('message',event=>{if(event.data==='sample')parent.postMessage({metrics:{notifications:count,bufferWrites:count,draws:count},width:host.clientWidth,height:document.documentElement.scrollHeight},'*');});
<\/script></html>`;
const parent=`<!doctype html><meta charset="utf-8"><title>尺寸循环修复验收</title><style>body{font:14px/1.6 system-ui;background:#10252d;color:white;margin:20px}iframe{height:550px;border:1px solid #aaa}main{display:flex;gap:16px}pre{max-width:100%;white-space:pre-wrap}h1{font-size:22px}</style><h1>尺寸循环修复验收</h1><p>独立夹具：左侧复现旧尺寸算法；右侧运行修复后的真实 Pixi 交付。自动检查静止时画布写入与绘制次数。</p><main><section><h2>旧算法（仅 DOM）</h2><iframe id="old" src="/old"></iframe></section><section><h2>修复后的 Pixi</h2><iframe id="fixed" src="/fixed"></iframe></section></main><pre id="result">运行中</pre><script>
const frames=[document.getElementById('old'),document.getElementById('fixed')],pending=new Map(),samples=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
window.addEventListener('message',event=>{const resolve=pending.get(event.source);if(resolve){pending.delete(event.source);resolve(event.data);}});
const sample=frame=>new Promise(resolve=>{pending.set(frame.contentWindow,resolve);frame.contentWindow.postMessage('sample','*');});
window.addEventListener('load',async()=>{try{await pause(500);for(const width of[390,440,458,460,464,470,480,488,490,496,500,550,599,600,601,768]){for(const frame of frames)frame.style.width=width+'px';await pause(120);const before=await Promise.all(frames.map(sample));await pause(180);const after=await Promise.all(frames.map(sample));samples.push({width,old:{...after[0],delta:after[0].metrics.notifications-before[0].metrics.notifications},fixed:{...after[1],notifications:after[1].metrics.notifications-before[1].metrics.notifications,bufferWrites:after[1].metrics.bufferWrites-before[1].metrics.bufferWrites,draws:after[1].metrics.draws-before[1].metrics.draws}});document.getElementById('result').textContent=JSON.stringify({status:'RUNNING',latest:samples.at(-1)},null,2);}for(const frame of frames)frame.style.width='460px';const report={samples};const response=await fetch('/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});document.getElementById('result').textContent=JSON.stringify(await response.json(),null,2);}catch(error){document.getElementById('result').textContent=error.message;}});
<\/script>`;
const server=createServer(async(req,res)=>{let receivedReport;try{
 const path=new URL(req.url,'http://localhost').pathname;
 if(req.method==='POST'&&path==='/report'){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000)throw Error('REPORT_LIMIT');chunks.push(chunk);}
  const report=JSON.parse(Buffer.concat(chunks).toString());receivedReport=report;assert.equal(report.samples.length,16);assert(report.samples.some(s=>s.old.delta>5),'OLD_FAULT_NOT_REPRODUCED');
  assert.deepEqual(report.samples.map(s=>s.width),[390,440,458,460,464,470,480,488,490,496,500,550,599,600,601,768]);
  for(const s of report.samples){assert.deepEqual(s.fixed.metrics.errors,[]);assert.equal(s.fixed.status,'ready');assert.equal(s.fixed.bufferWrites,0);assert.equal(s.fixed.draws,0);assert.equal(s.fixed.notifications,0);}
  const result={status:'PASS',modelCalls:0,runtimeSha256:runtime.sha256,panelSha256:bundle.sha256,oldLoopWidths:report.samples.filter(s=>s.old.delta>5).map(s=>s.width),...report};
  await writeNewJson(output,'browser-report.json',result);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));console.log(JSON.stringify({status:'PASS',samples:report.samples.length,oldLoopWidths:result.oldLoopWidths,modelCalls:0}));return;
 }
 const content=path==='/'?parent:path==='/old'?old:path==='/fixed'?fixed:path==='/panel-runtime.js'?runtime.code:null;
 if(content===null){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(content);
 }catch(error){if(receivedReport)await writeNewJson(output,'browser-failure.json',{status:'FAIL',code:error.message,modelCalls:0,runtimeSha256:runtime.sha256,...receivedReport});res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'FAIL',code:error.message}));console.error(error.message);}});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,modelCalls:0,output})));
