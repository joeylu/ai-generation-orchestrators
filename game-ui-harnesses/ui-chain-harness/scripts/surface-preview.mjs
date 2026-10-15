import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {decodePng,encodePng,cropPng} from '../src/skins/png.mjs';
import {hash,json,readSafe} from '../src/skins/package.mjs';
import {previewHeaders} from '../src/editor/policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const privatePath=value=>{const path=resolve(value),r=relative(join(root,'work'),path);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use work/');return path;};
const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:{config:{type:'string'},out:{type:'string'},port:{type:'string',default:'4177'}}});
if(p[0]==='build'){
  const configPath=privatePath(v.config),configBytes=await readFile(configPath),config=JSON.parse(configBytes),out=privatePath(v.out);
  const raw=await readSafe(root,config.source);
  if(hash(raw)!==config.sha256)throw Error('Source changed');
  const image=decodePng(raw),parts=[],files=[],dir=join(out,randomUUID());await mkdir(dir,{recursive:true});
  for(const part of config.parts){
    if(!/^[a-z][a-z0-9.-]+$/.test(part.id))throw Error('Invalid asset ID');
    const crop=cropPng(image,part.crop),bytes=encodePng(crop),file=part.id+'.png';
    await writeFile(join(dir,file),bytes,{flag:'wx'});files.push({file,sha256:hash(bytes)});
    parts.push({...part,width:crop.width,height:crop.height,data:bytes.toString('base64')});
  }
  const bundle=await build({entryPoints:[join(root,'tests/runtime/surface-preview.mjs')],bundle:true,write:false,format:'esm',minify:true});
  const title=String(config.title??"S01 原图与实际显示对照").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const sizeOptions=(config.sizes??["720x400","420x240","360x640"]).map(s=>{if(!/^[1-9][0-9]{1,3}x[1-9][0-9]{1,3}$/.test(s))throw Error("Invalid preview size");return `<option>${s}</option>`;}).join("");
  const html=`<!doctype html><html lang="zh"><meta charset="utf-8"><title>${title}</title><style>body{font:16px system-ui;background:#17212d;color:#f4e7c9;margin:24px}select{padding:8px;margin:8px}section{margin:20px 0}.backdrop{overflow:auto;padding:24px;border:1px solid #68727e}img{max-width:none;display:block}canvas{display:block}summary{cursor:pointer}h2{font-size:18px}</style><h1>${title}</h1><p>仅裁切完整部件外框，保留原始可见 RGB/alpha；未修边、未重绘。左上光与木纹来自生成图。</p><label>部件<select id="part"></select></label><label>尺寸<select id="size">${sizeOptions}<option value="native">原始像素</option></select></label><label>显示<select id="mode"><option value="slice">九宫格拉伸</option><option value="uniform">等比显示</option></select></label><label>背景<select id="background"><option value="#101c2b">深色</option><option value="#f4eddd">浅色</option><option value="#888888">灰色</option></select></label><p id="info"></p><section><h2>Pixi 实际渲染（超宽可横向滚动，不自动缩小画布）</h2><div id="canvas" class="backdrop"></div></section><details open><summary>同一裁切 PNG：原始像素对照（可横向滚动）</summary><div class="backdrop"><img id="original"></div></details><details><summary>整张生成原图</summary><img style="width:640px;height:auto" src="data:image/png;base64,${raw.toString('base64')}"></details><script>window.SURFACE_DATA=${JSON.stringify({parts}).replaceAll('<','\\u003c')}</script><script type="module">${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></html>`;
  await writeFile(join(dir,'preview.html'),html,{flag:'wx'});files.push({file:'preview.html',sha256:hash(Buffer.from(html))});
  await writeFile(join(dir,'report.json'),json({kind:'surface-visual-comparison',sourceSha256:hash(raw),configSha256:hash(configBytes),config,files,edgeRepair:false,visualAcceptance:'unreviewed',productionReady:false}),{flag:'wx'});
  console.log(dir);
}else if(p[0]==='serve'){
  const out=privatePath(v.out),report=JSON.parse(await readSafe(out,'report.json')),html=await readSafe(out,'preview.html',32*1024*1024);
  if(hash(html)!==report.files.find(f=>f.file==='preview.html').sha256)throw Error('Preview changed');
  const port=Number(v.port);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
  createServer((req,res)=>{if(!['GET','HEAD'].includes(req.method)||req.url!=='/'||req.headers.host!==`127.0.0.1:${port}`){res.writeHead(404);res.end();return;}res.writeHead(200,previewHeaders);res.end(req.method==='HEAD'?undefined:html);}).listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/`));
}else throw Error('Use build --config --out or serve --out [--port]');
