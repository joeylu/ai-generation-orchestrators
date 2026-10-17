import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {consumerBrowserChannel,launchConsumerBrowser} from '../src/skins/browser-selection.mjs';
import {hash,json,readSafe,verifySkinPackage} from '../src/skins/package.mjs';
import {runComponentChecks} from '../tests/runtime/checks.mjs';
import {checkTextColors} from '../tests/runtime/text-color-checks.mjs';
const {positionals,values}=parseArgs({allowPositionals:true,options:{browser:{type:'string'}}});
if(positionals.length!==1)throw Error('Use: node scripts/consumer-check.mjs <consumer-directory> [--browser chromium|chrome|msedge]');
const browserChannel=consumerBrowserChannel(values.browser);
const source=resolve(positionals[0]),manifestBytes=await readSafe(source,'manifest.json'),manifest=JSON.parse(manifestBytes);
assert.equal(manifest.kind,'ui_component_consumer_candidate');
const relocated=await mkdtemp(join(tmpdir(),'ui-consumer-'));
const allowed=new Set(manifest.files.map(f=>f.file));assert.equal(allowed.size,manifest.files.length);
for(const f of manifest.files){const bytes=await readSafe(source,f.file);assert.equal(hash(bytes),f.sha256);await mkdir(join(relocated,f.file,'..'),{recursive:true});await writeFile(join(relocated,f.file),bytes,{flag:'wx'});}
assert.equal((await verifySkinPackage(join(relocated,'skin'))).manifestSha256,manifest.manifestSha256);
const browser=await launchConsumerBrowser(chromium,browserChannel);
const errors=[],blocked=[],failedChecks=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async r=>{const u=new URL(r.request().url()),file=u.pathname==='/'?'index.html':u.pathname.slice(1);
    if(u.origin!=='http://127.0.0.1'||!allowed.has(file)){blocked.push(u.pathname);return r.abort();}
    const contentType=file.endsWith('.mjs')?'text/javascript':file.endsWith('.json')?'application/json':'text/html';
    await r.fulfill({body:await readSafe(relocated,file),contentType});
  });
  await page.goto('http://127.0.0.1/');await page.waitForFunction(()=>window.consumerData);
  // Existing pointer fixtures use canvas coordinates; remove example chrome during checks.
  await page.addStyleTag({content:'nav{display:none}canvas{display:block}'});
  const data=await page.evaluate(()=>consumerData),results=await runComponentChecks({page,data,errors},r=>{
    if(r.status!=='passed'&&failedChecks.length<64)failedChecks.push({id:String(r.id??'').slice(0,120),componentType:String(r.componentType??'').slice(0,80),message:String(r.message??'').slice(0,500)});
  });
  assert(results.every(r=>r.status==='passed'),'component checks failed: '+JSON.stringify({failedChecks}));
  assert.equal(await page.evaluate(()=>new Set(harness.cases.map(c=>c.type)).size),16);
  const textColors=await checkTextColors(page);
  await writeFile(join(relocated,'text-colors.json'),json(textColors),{flag:'wx'});
  await page.addStyleTag({content:'nav{display:block}'});
  for(const orientation of ['wide','tall']){await page.locator('#'+orientation).click();await page.locator('canvas').screenshot({path:join(relocated,orientation+'.png')});}
  // Smoke-test the public factory separately from the gallery entry.
  await page.evaluate(async()=>{
    harness.dispose();const {Application,createComponentKit}=await import('./runtime.mjs');const app=new Application();await app.init({width:400,height:200,preference:'webgl',layout:{autoUpdate:true,throttle:0}});
    document.body.append(app.canvas);const kit=await createComponentKit({app,data:consumerData});
    const h=kit.runtime.create({id:'consumer-button',recipeRef:'button@1.0.0',props:{label:'开始',enabled:true,variant:'primary'},size:{width:240,height:56}});kit.runtime.mount(h);kit.runtime.flush();
    if(!h.root.visible)throw Error('Public factory button invisible');kit.dispose();app.destroy({removeView:true},{children:true});
  });
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  const report={kind:'ui_consumer_relocation_check',manifestSha256:hash(manifestBytes),sourceSkinSha256:manifest.manifestSha256,relocatedOutsideRepository:true,network:'only copied package files',components:16,checks:results.length,results,textColors,publicFactory:'passed',errors,status:'passed',productionReady:false};
  await writeFile(join(relocated,'checks.json'),json(report),{flag:'wx'});
  console.log(json({directory:relocated,checks:results.length,publicFactory:'passed',status:'passed'}));
}catch(error){console.error(json({errors,blocked,failedChecks,message:error.message}));throw error;}finally{await browser.close();}
