import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {verifySkinPackage,hash,json} from '../src/skins/package.mjs';
import {startHarness} from '../tests/runtime/harness.mjs';
import {runComponentChecks} from '../tests/runtime/checks.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {values:v}=parseArgs({options:{package:{type:'string'},out:{type:'string'}}});
const out=resolve(v.out),rel=relative(join(root,'work'),out);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Use work/');
const packDir=resolve(v.package),{pack,resources,manifestSha256}=await verifySkinPackage(packDir);
if(pack.sourceKind!=='imported')throw Error('Expected imported artwork');
const packet={manifest:(await readFile(join(packDir,'skin-pack.json'))).toString('base64'),manifestSha256,bindings:pack.bindings,resources:Object.fromEntries([...resources].filter(([f])=>!f.startsWith('sources/')).map(([f,b])=>[f,b.toString('base64')]))};
const dir=join(out,randomUUID());await mkdir(dir,{recursive:true});const h=await startHarness({skinPack:packet});
try{
  // Real panel safe areas need a taller sample than the minimal neutral fixture.
  h.data.cases.cases.find(c=>c.type==='Dialog').size.height=180;
  await h.page.evaluate(()=>{harness.cases.find(c=>c.type==='Dialog').size.height=180;});
  const results=await runComponentChecks(h,r=>console.log(r.id+': '+r.status+(r.message?' '+r.message:'')));
  const identity=await h.page.evaluate(()=>({kind:harness.skin.sourceKind,count:harness.skin.textures.size,types:new Set(harness.cases.map(c=>c.type)).size}));
  if(identity.kind!=='imported'||identity.count!==pack.assets.length||identity.types!==16)throw Error('Incomplete real skin binding');
  await writeFile(join(dir,'checks.json'),json({identity,results,errors:h.errors,scope:'existing offline component tests with imported skin'}),{flag:'wx'});
  if(results.some(r=>r.status!=='passed')||h.errors.length)throw Error('Real skin checks failed: '+dir);
  for(const[name,width,height]of[['landscape',1280,720],['portrait',720,1280]]){await h.page.setViewportSize({width,height});await h.page.evaluate(({width,height})=>{harness.app.renderer.resize(width,height);harness.gallery();},{width,height});await h.page.screenshot({path:join(dir,name+'.png')});}
  const bundle=await build({entryPoints:[join(root,'tests/runtime/browser-entry.mjs')],bundle:true,write:false,format:'esm',outdir:'virtual',loader:{'.woff': 'dataurl','.woff2':'dataurl'}}),js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const html=`<!doctype html><meta charset="utf-8"><title>林野皮肤 · 全部16类组件</title><style>${css}body{margin:0;background:#101b2b;color:#fff;font:16px system-ui}nav{padding:12px}button{padding:8px;margin-right:8px}canvas{display:block}</style><nav><button id="wide">横版 16:9</button><button id="tall">竖版 9:16</button><span>30 个真实 PNG · 16 类组件 · 可交互验收</span></nav><script type="module">${js}\nconst data=${JSON.stringify(h.data).replaceAll('<','\\u003c')};await initializeComponents(data,1280,720);const draw=(w,h)=>{harness.app.renderer.resize(w,h);harness.gallery();};document.getElementById('wide').onclick=()=>draw(1280,720);document.getElementById('tall').onclick=()=>draw(720,1280);draw(1280,720);</script>`;
  await writeFile(join(dir,'preview.html'),html,{flag:'wx'});
  const files=[];for(const file of ['checks.json','preview.html','landscape.png','portrait.png'])files.push({file,sha256:hash(await readFile(join(dir,file)))});
  await writeFile(join(dir,'report.json'),json({kind:'imported-skin-component-preview',manifestSha256,identity,checks:results.length,files,visualAcceptance:'unreviewed',productionReady:false}),{flag:'wx'});
  console.log(json({directory:dir,assets:identity.count,components:identity.types,checks:results.length}));
}finally{await h.close();}
