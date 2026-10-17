import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {hash,json,readSafe} from '../src/skins/package.mjs';
import {inspectConsumer,consumerServer} from '../src/runtime/consumer-tools.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const {positionals,values}=parseArgs({allowPositionals:true,options:{runs:{type:'string'}}});
const local=p=>{const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use work/');return q;};
const config=JSON.parse(await readFile(join(root,'configs/skin-review.json'))),out=join(root,'work/skin-review'),pointer=join(out,'current.json');
async function inspect(dir,digest){
  const bytes=await readSafe(dir,'manifest.json');if(hash(bytes)!==digest)throw Error('Review manifest changed');
  const m=JSON.parse(bytes),files=new Map();
  for(const f of m.files){if(files.has(f.file))throw Error('Duplicate review file');const b=await readSafe(dir,f.file);if(hash(b)!==f.sha256)throw Error('Review file changed');files.set(f.file,b);}
  return{files};
}
async function check(files,dir){
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}),errors=[],checks=[];
  try{
    const page=await browser.newPage({viewport:{width:1400,height:1000},serviceWorkers:'block'});page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{const u=new URL(route.request().url()),f=u.pathname==='/'?'index.html':u.pathname.slice(1);if(u.origin!=='http://127.0.0.1'||!files.has(f)){errors.push('Unexpected request '+f);return route.abort();}return route.fulfill({body:files.get(f),contentType:f.endsWith('.mjs')?'text/javascript':f.endsWith('.json')?'application/json':'text/html'});});
    await page.goto('http://127.0.0.1/');
    const ready=async()=>{await page.waitForFunction(()=>window.reviewReady||window.reviewError);const e=await page.evaluate(()=>window.reviewError);if(e)throw Error(e);};await ready();
    const select=async(id,value)=>{await page.selectOption('#'+id,value);await ready();};
    for(const skin of config.skins){
      await select('skin',skin.id);
      for(const orientation of ['wide','tall']){await select('component','all');await select('orientation',orientation);if(await page.locator('canvas').count()!==1)throw Error('Canvas leak');await page.locator('canvas').screenshot({path:join(dir,skin.id+'-'+orientation+'.png')});checks.push(skin.id+'/'+orientation+'/all');}
      await select('orientation','wide');
      const types=await page.evaluate(()=>harness.cases.map(c=>c.type));
      for(const type of types){await select('component',type);for(const width of ['180','276','420']){await select('size',width);const actual=await page.evaluate(()=>reviewNode.size.width);if(actual!==Number(width))throw Error('Wrong component width');checks.push(skin.id+'/'+type+'/'+width);}}
      for(const state of ['value','disabled','initial']){await select('state',state);checks.push(skin.id+'/state/'+state);}
    }
    // Repeat switching to catch leaked/destroyed renderer resources.
    await select('skin',config.skins[0].id);await select('component','all');
    if(errors.length)throw Error(errors.join('\n'));
    const report={status:'passed',checks:checks.length,scenarios:checks,errors};await writeFile(join(dir,'checks.json'),json(report));return report;
  }finally{await browser.close();}
}
try{
  if(positionals[0]==='serve'){
    const current=JSON.parse(await readFile(pointer)),snapshot=await inspect(local(current.directory),current.sha256);
    const server=consumerServer(snapshot,config.port);server.on('error',e=>{console.error(e.message);process.exitCode=1;});server.listen(config.port,'127.0.0.1',()=>console.log('http://127.0.0.1:'+config.port+'/'));
  }else if(positionals[0]==='build'){
    if(config.version!=='1.0'||!config.skins.length||new Set(config.skins.map(s=>s.id)).size!==config.skins.length||config.skins.some(s=>!/^[a-z][a-z0-9-]*$/.test(s.id)))throw Error('Invalid review config');
    const dir=join(out,randomUUID());await mkdir(join(dir,'kits'),{recursive:true});
    const reuse=values.runs?JSON.parse(await readFile(local(values.runs))):null,sources=[],files=new Map();
    for(const skin of config.skins){
      let runDir=reuse?.[skin.id];
      if(!runDir){const result=await run(process.execPath,[join(root,'scripts/skin-postprocess.mjs'),'build','--config',local(skin.assembly)],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:240000});runDir=JSON.parse(result.stdout).directory;}
      runDir=local(runDir);const report=JSON.parse(await readFile(join(runDir,'run.json'))),checked=JSON.parse(await readFile(join(runDir,'evidence/checks.json')));
      if(report.status!=='checked-candidate'||checked.status!=='passed'||report.stages[0].inputSha256!==hash(await readFile(local(skin.assembly))))throw Error('Stale or failed skin run');
      const snap=await inspectConsumer(local(report.consumerDirectory),checked.manifestSha256);
      const provenance=JSON.parse(snap.files.get('source.json'));
      for(const f of provenance.inputs)if(hash(await readFile(resolve(root,f.file)))!==f.sha256)throw Error('Runtime source changed; rebuild '+skin.id);
      if(provenance.lockSha256!==hash(await readFile(join(root,'package-lock.json'))))throw Error('Dependencies changed');
      for(const f of ['runtime.mjs','gallery.mjs','examples.json']){if(files.has(f)&&hash(files.get(f))!==hash(snap.files.get(f)))throw Error('Skins have different runtime or fixtures');files.set(f,snap.files.get(f));}
      files.set('kits/'+skin.id+'.json',snap.files.get('kit.json'));sources.push({id:skin.id,runDirectory:relative(root,runDir),consumerSha256:snap.manifestSha256,checks:checked.checks});
    }
    files.set('index.html',await readFile(join(root,'web/skin-review.html')));files.set('review.mjs',await readFile(join(root,'web/skin-review.mjs')));files.set('review.json',Buffer.from(json({skins:config.skins.map(({id,label})=>({id,label}))})));
    for(const [f,b]of files)await writeFile(join(dir,f),b,{flag:'wx'});
    const result=await check(files,dir),manifest=Buffer.from(json({kind:'ui_skin_review',productionReady:false,sources,checks:result.checks,files:[...files].map(([file,b])=>({file,sha256:hash(b)}))}));
    await writeFile(join(dir,'manifest.json'),manifest,{flag:'wx'});
    const temp=pointer+'.'+randomUUID()+'.tmp';await writeFile(temp,json({directory:relative(root,dir),sha256:hash(manifest)}));await rename(temp,pointer);
    console.log(json({directory:dir,skins:sources,reviewChecks:result.checks,status:'passed'}));
  }else throw Error('Use npm run skins:review -- build|serve [--runs work/.../runs.json]');
}catch(e){console.error(e.message);process.exitCode=1;}
