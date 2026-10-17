import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, rename, readdir, open, unlink } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSkinPackage, verifySkinPackage, skinPackageStatus, readSafe, json, hash, bindingsOf } from '../src/skins/package.mjs';
import { prepareRasterFixture } from '../fixtures/raster-skin.mjs';
import { startHarness } from '../tests/runtime/harness.mjs';
import { runComponentChecks } from '../tests/runtime/checks.mjs';
import { runSkinChecks } from '../tests/runtime/skin-checks.mjs';
import { readContracts } from '../src/contracts/validate.mjs';
import { defaults } from '../src/contracts/build.mjs';
import { deriveModelProjection } from '../src/templates/catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
async function identity(){
  const files=['package.json','package-lock.json','scripts/skins.mjs','fixtures/raster-skin.mjs','fixtures/neutral.skin.json','fixtures/component-cases.json','fixtures/component-matrix.json'];
  for(const dir of ['src/skins','src/runtime','src/slicing','tools/panel-slicer/src','src/templates','src/contracts','schemas','configs','tests/runtime'])
    for(const f of await readdir(join(root,dir)))if(/\.(mjs|json)$/.test(f))files.push(dir+'/'+f);
  const entries=[];for(const file of files.sort())entries.push({file,sha256:hash(await readFile(join(root,file)))});
  return {sha256:hash(Buffer.from(json(entries))),files:entries};
}
async function check(output,channel){
  const source=await identity(), id=randomUUID(), dir=join(output,'.staging',id);
  await mkdir(dir,{recursive:true});
  const input=await prepareRasterFixture(join(dir,'fixture-source'),channel);
  const built=await buildSkinPackage({input,output:join(dir,'import')});
  const {pack,resources,manifestSha256}=await verifySkinPackage(join(built.directory,'pack'));
  const manifest=await readFile(join(built.directory,'pack/skin-pack.json'));
  const packet={manifest:manifest.toString('base64'),manifestSha256,bindings:pack.bindings,resources:Object.fromEntries([...resources].filter(([file])=>!file.startsWith('sources/')).map(([file,b])=>[file,b.toString('base64')]))};
  const h=await startHarness({channel,skinPack:packet});
  try{
    const results=[...await runComponentChecks(h,r=>console.log(`${r.id}: ${r.status}`)),...await runSkinChecks(h,packet)];
    const report={kind:'ui_png_skin_fixture_check',version:'0.1',sourceKind:'fixture',productionReady:false,visualAcceptance:'unreviewed',source,manifestSha256,assetCount:pack.assets.length,fontCount:pack.fonts.length,browser:h.browser.version(),network:'blocked',results,errors:h.errors};
    await writeFile(join(dir,'report.json'),json(report),{flag:'wx'});
    if(results.some(r=>r.status!=='passed')||h.errors.length)throw Object.assign(Error('PNG fixture checks failed; see retained staging report.'),{code:'skin.check'});
    for(const [name,width,height] of [['landscape',1280,720],['portrait',720,1280]]){
      await h.page.setViewportSize({width,height});
      const png=await h.page.evaluate(({width,height})=>{harness.app.renderer.resize(width,height);harness.gallery();return harness.app.canvas.toDataURL('image/png');},{width,height});
      await writeFile(join(dir,`${name}.png`),Buffer.from(png.split(',')[1],'base64'),{flag:'wx'});
    }
    await writeFile(join(dir,'overview.md'),`# 独立 PNG 皮肤消费验收\n\n程序夹具，非真实生成或已接受美术。${pack.assets.length} 个 PNG，16 类组件，${results.length} 项检查。\n\n[报告](report.json) · [资产包](import/builds/${built.buildId}/pack/skin-pack.json)\n\n![横版](landscape.png)\n\n![竖版](portrait.png)\n`);
    if((await identity()).sha256!==source.sha256)throw Error('Source changed during checks.');
    const files=[];for(const file of ['report.json','overview.md','landscape.png','portrait.png']){const b=await readFile(join(dir,file));files.push({file,sha256:hash(b),bytes:b.length});}
    const record=json({kind:'ui_png_skin_fixture_build',version:'0.1',source,files,packDirectory:`import/builds/${built.buildId}/pack`,manifestSha256});
    await writeFile(join(dir,'build-record.json'),record,{flag:'wx'});
    await mkdir(join(output,'builds'),{recursive:true});
    for(let i=0;;i++){try{await rename(dir,join(output,'builds',id));break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||i===5)throw e;await delay(100*(i+1));}}
    const pending=join(output,id+'.tmp');
    await writeFile(pending,json({kind:'ui_png_skin_fixture_current',buildId:id,recordSha256:hash(Buffer.from(record))}),{flag:'wx'});
    await rename(pending,join(output,'current.json'));
    return {status:'png-fixture-checks-passed',buildId:id,assets:pack.assets.length,components:16,checks:results.length,overview:`builds/${id}/overview.md`,productionReady:false};
  }finally{await h.close();}
}
async function previewStatus(output){
  try{
    const c=JSON.parse(await readSafe(output,'current.json',4096));
    if(c.kind!=='ui_png_skin_fixture_current'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.buildId))throw Error('Invalid pointer.');
    const dir=join(output,'builds',c.buildId),bytes=await readSafe(dir,'build-record.json');
    if(hash(bytes)!==c.recordSha256)throw Error('Record changed.');
    const record=JSON.parse(bytes);
    for(const f of record.files){const b=await readSafe(dir,f.file);if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error('Artifact changed.');}
    if(!/^import\/builds\/[a-f0-9-]{36}\/pack$/.test(record.packDirectory))throw Error('Invalid package directory.');
    const pack=await verifySkinPackage(join(dir,record.packDirectory));if(pack.manifestSha256!==record.manifestSha256)throw Error('Package changed.');
    return {status:(await identity()).sha256===record.source.sha256?'current':'stale',buildId:c.buildId,overview:`builds/${c.buildId}/overview.md`,sourceKind:'fixture',productionReady:false};
  }catch(e){return {status:e.code==='ENOENT'?'missing':'corrupt'};}
}
async function lockedCheck(output,channel){
  await mkdir(output,{recursive:true});const path=join(output,'.build.lock');let lock;
  try{lock=await open(path,'wx');}catch(e){if(e.code==='EEXIST')throw Object.assign(Error('Skin fixture check already in progress.'),{code:'skin.busy'});throw e;}
  try{return await check(output,channel);}finally{await lock.close();await unlink(path);}
}
async function plan(output){
  const inputs=await readContracts(defaults), projection=deriveModelProjection(inputs.template,hash(inputs.bytes.template));
  const ranked=[...inputs.template.sheets].sort((a,b)=>new Set(b.parts.map(p=>p.stretch)).size-new Set(a.parts.map(p=>p.stretch)).size||b.parts.length-a.parts.length);
  const draft={kind:'ui_skin_generation_plan_draft',version:'0.1',status:'missing-inputs',computeAuthorized:false,bindings:bindingsOf(inputs),referenceImage:null,styleRules:null,providerCapabilities:null,pilotSheetId:ranked[0].id,
    missing:['reference image and fingerprint','reviewed style JSON revision','provider resolution/alpha capability','reviewed per-skin slices/content insets','immutable request plan and per-attempt authorization'],
    sequence:['validate reference/style/template inputs','compile one pilot sheet request with reference image, clean template PNG and geometry projection','receive raw output with provenance','validate dimensions/alpha/slot geometry without inferred recropping','review pilot style and stretch behavior','complete remaining required sheets under separate request decisions','import, split and validate all assets','bind all 16 component types and review'],
    constraints:{functionalIcons:false,textInAssets:false,silentResampling:false,automaticGenerationRetry:false,acceptedArtwork:false},geometry:projection};
  await mkdir(output,{recursive:true});const file=`generation-plan-${randomUUID()}.json`;await writeFile(join(output,file),json(draft),{flag:'wx'});return {status:'draft-missing-inputs',file,pilotSheetId:draft.pilotSheetId,computeAuthorized:false};
}
try{
  const {values,positionals}=parseArgs({allowPositionals:true,options:{input:{type:'string'},out:{type:'string'},package:{type:'string'},browser:{type:'string',default:'chrome'},reference:{type:'string'},style:{type:'string'},sheet:{type:'string'},sha256:{type:'string'}}});
  const command=positionals[0];if(positionals.length!==1)throw Error('Expected one command.');
  const boundPlan=command==='plan'&&(values.reference||values.style||values.sheet);
  const output=resolve(values.out??join(root,['check','preview-status'].includes(command)?'previews/skin-packs':command==='plan'?(boundPlan?'work/skin-plans':'generated/skin-plans'):'generated/skin-packs'));
  let result;
  if(command==='import'&&values.input)result=await buildSkinPackage({input:values.input,output});
  else if(command==='verify'&&values.package){const r=await verifySkinPackage(resolve(values.package),bindingsOf(await readContracts(defaults)));result={status:'technically-valid',sourceKind:r.pack.sourceKind,assets:r.pack.assets.length,manifestSha256:r.manifestSha256,visualAcceptance:r.pack.visualAcceptance,productionReady:false};}
  else if(command==='status')result=await skinPackageStatus(output);
  else if(command==='preview-status')result=await previewStatus(output);
  else if(command==='check'&&['chrome','msedge','chromium'].includes(values.browser))result=await lockedCheck(output,values.browser);
  else if(boundPlan){
    if(!values.reference||!values.style)throw Object.assign(Error('A bound plan requires both --reference and --style.'),{code:'skin.plan'});
    const rel=relative(join(root,'work'),output);
    if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Object.assign(Error('Reference-bound plans must be written under this Harness work/ directory.'),{code:'skin.plan'});
    const {prepareGenerationPlan}=await import('../src/skin-generation/plan.mjs');
    result=await prepareGenerationPlan({reference:resolve(values.reference),style:resolve(values.style),sheetId:values.sheet??'S03',output});
  }
  else if(command==='plan')result=await plan(output);
  else if(command==='plan-verify'&&values.package&&values.sha256){
    const {verifyGenerationPlan}=await import('../src/skin-generation/plan.mjs');
    result=await verifyGenerationPlan({directory:resolve(values.package),planSha256:values.sha256});
  }
  else throw Error('Use import --input path, verify --package path, status, check [--browser chrome], plan [--reference PNG --style JSON --sheet ID], or plan-verify --package directory --sha256 digest.');
  console.log(json(result));if(['corrupt','stale','missing'].includes(result.status))process.exitCode=1;
}catch(e){console.error(json({status:'failed',code:e.code??'skin.failed',message:e.code?.startsWith('skin.')?e.message:'Skin command failed; inspect inputs/environment.',issues:e.issues}));process.exitCode=1;}
