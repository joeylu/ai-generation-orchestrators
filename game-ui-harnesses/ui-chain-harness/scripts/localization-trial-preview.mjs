import {readFile} from 'node:fs/promises';
import {resolve,relative,join,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {inspectConsumer,consumerServer} from '../src/runtime/consumer-tools.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {values:v}=parseArgs({options:{runs:{type:'string'},port:{type:'string',default:'4196'}}});
const local=p=>{const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('preview.work-path');return q;};
const port=Number(v.port);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('preview.port');
const runs=JSON.parse(await readFile(local(v.runs))),files=new Map(),ids=new Set();
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const links=runs.map(r=>{if(!/^[a-z][a-z0-9-]*$/.test(r.id)||ids.has(r.id))throw Error('preview.id');ids.add(r.id);return`<a href="/${r.id}/index.html">${escape(r.label)}</a>`;}).join(' · ');
const nav=`<div style="padding:12px;background:#f6f1df;color:#222;font:16px system-ui">自动定位试验候选 · 尚未验收 · ${links} · <a href="http://127.0.0.1:4194/">原验收版</a></div>`;
for(const entry of runs){
  const dir=local(entry.directory),run=JSON.parse(await readFile(join(dir,'run.json'))),check=JSON.parse(await readFile(join(dir,'evidence/checks.json')));
  if(run.status!=='checked-candidate'||check.status!=='passed')throw Error('preview.unchecked');
  const snapshot=await inspectConsumer(local(run.consumerDirectory),check.manifestSha256);
  for(const [file,bytes] of snapshot.files)files.set(entry.id+'/'+file,file==='index.html'?Buffer.from(bytes.toString().replace('<nav>',nav+'<nav>')):bytes);
}
files.set('index.html',Buffer.from('<!doctype html><meta charset="utf-8"><title>自动定位候选</title>'+nav+'<p>选择上方皮肤查看16类组件；横竖版可在组件页切换。候选素材及切线参数仍需视觉验收，技术检查通过不等于外观已接受。</p>'));
const server=consumerServer({files},port);server.on('error',e=>{console.error(e.message);process.exitCode=1;});server.listen(port,'127.0.0.1',()=>console.log('http://127.0.0.1:'+port+'/'));
