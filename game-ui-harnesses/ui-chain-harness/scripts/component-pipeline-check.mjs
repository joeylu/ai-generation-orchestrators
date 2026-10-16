// Fresh, synthetic end-to-end acceptance. This script has no model/provider adapter.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import {parseArgs,promisify} from 'node:util';
import {prepareSkinBatch} from './skin-batch.mjs';
import {buildTemplates} from '../src/templates/build.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {executeBatch,runAuthorizedBatch} from '../src/skin-generation/batch-runner.mjs';
import {inspectGenerationBatch} from '../src/skin-generation/batch-intake.mjs';
import {encodePng} from '../src/skins/png.mjs';
import {hash,json,noLinks,readSafe,verifySkinPackage} from '../src/skins/package.mjs';
import {inventory} from '../src/skins/workflow.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile);
const rel=file=>relative(root,file).replaceAll('\\','/');
export function componentPipelineDirectory(value){
 const directory=resolve(root,value),within=relative(join(root,'work'),directory);
 if(!within||isAbsolute(within)||within==='..'||within.startsWith('..'+sep))throw Error('COMPONENT_PIPELINE_WORK_PATH_REQUIRED');
 return directory;
}
export function componentPipelineBrowser(value=process.env.UI_CHAIN_TEST_BROWSER??'chromium'){
 if(!['chromium','chrome','msedge'].includes(value))throw Error('COMPONENT_PIPELINE_BROWSER_INVALID');
 return value;
}
export async function checkComponentPipeline({output=join(root,'work/component-pipeline-check',randomUUID()),materials=true,browser=componentPipelineBrowser()}={}){
 if(typeof materials!=='boolean')throw Error('COMPONENT_PIPELINE_MATERIALS_INVALID');
 browser=componentPipelineBrowser(browser);
 const directory=componentPipelineDirectory(output);await noLinks(directory);
 await mkdir(dirname(directory),{recursive:true});await mkdir(directory); // Never reuse or overwrite a candidate.
 const progress=async(stage,details={})=>writeFile(join(directory,'progress.json'),json({kind:'ui_component_pipeline_check_progress',stage,realModelCalls:0,...details}));
 let stage='inputs';
 try{
  const contracts=await readContracts(defaults),baseAssets=contracts.template.sheets.flatMap(s=>s.parts).length;
  assert.equal(baseAssets,32,'Current release must contain both square slot states');
  const inputs=join(directory,'inputs');await mkdir(inputs);
  const reference=join(inputs,'reference.png'),style=join(inputs,'style.json'),profile=join(inputs,'profile.json');
  await writeFile(reference,encodePng({width:8,height:8,pixels:Buffer.alloc(8*8*4,255)}),{flag:'wx'});
  await writeFile(style,json({kind:'ui_skin_style_draft',version:'0.1',id:'component-pipeline-synthetic',revision:1,status:'draft',name:'Synthetic component pipeline fixture',referenceSummary:'Locally generated geometry; no model output or artistic acceptance.',palette:{basis:'reference-only-no-analysis',colors:{}},observedRules:['No source art observations are asserted.'],extensionRules:['Retain each geometry template as the explicit synthetic response.'],partRules:[{match:{assetPrefix:'surface.'},appearance:'Use the local geometry placeholders.'}]}),{flag:'wx'});
  await writeFile(profile,await readSafe(root,'configs/studio-metadata-profile.json'),{flag:'wx'});
  stage='templates';await progress(stage);
  const templateOutput=join(directory,'templates'),templates=await buildTemplates({config:defaults.template,output:templateOutput,channel:browser});
  assert.equal(templates.partCount,baseAssets);
  stage='prepare';await progress(stage);
  const skinDirectory=join(directory,'generation'),batch=await prepareSkinBatch({reference,style,output:skinDirectory,materials,templateOutput});
  const batchBytes=await readSafe(batch.directory,'batch.json'),batchDocument=JSON.parse(batchBytes);
  assert.equal(batch.computeAuthorized,false);assert.equal(batch.sheets,materials?5:4);assert.equal(batch.assets,baseAssets+(materials?3:0));
  const seen=[],adapter={async generate(request){
   // Return only the plan's own, program-rendered clean PNG. No sockets, subprocesses or provider SDK.
   const planDirectory=join(skinDirectory,'plans',request.planSha256),plan=JSON.parse(await readSafe(planDirectory,'plan.json'));
   assert.equal(plan.sheetId,request.sheetId);assert.equal(hash(await readSafe(planDirectory,'plan.json')),request.planSha256);
   const bytes=await readSafe(planDirectory,'template.clean.png');
   assert.equal(plan.resources.find(r=>r.file==='template.clean.png')?.sha256,hash(bytes));
   seen.push({sheetId:request.sheetId,planSha256:request.planSha256,rawSha256:hash(bytes)});
   return bytes;
  }};
  const args={skinDirectory,batchSha256:batch.batchSha256,confirmedBatchSha256:batch.batchSha256,maxConcurrentSheets:2};
  stage='synthetic-execution';await progress(stage);
  const generated=await executeBatch(args,adapter);
  assert.equal(generated.postprocessReady,true);assert.equal(generated.adapterCallsThisRun,batch.sheets);assert.equal(seen.length,batch.sheets);
  assert.equal(new Set(seen.map(s=>s.planSha256)).size,batch.sheets);
  const intakeArgs={skinDirectory,batchSha256:batch.batchSha256,templateSha256:hash(contracts.bytes.template),sheets:contracts.template.sheets};
  const intake=await inspectGenerationBatch(intakeArgs);
  assert.equal(intake.sources.length,4);assert.equal(intake.materialSources.length,materials?1:0);
  assert.equal(intake.summary.originalChecksPassed,true);assert(intake.summary.nodes.every(n=>n.status==='received'));
  const generationEvidence=await inventory(skinDirectory);
  const repeated=await runAuthorizedBatch(args,adapter);assert.equal(repeated.adapterCallsThisRun,0);
  await assert.rejects(()=>executeBatch(args,adapter),/already-reserved|already-claimed/);
  assert.equal(seen.length,batch.sheets,'Repeated acceptance must not submit another synthetic call');
  assert.deepEqual(await inventory(skinDirectory),generationEvidence,'Repeated execution changed frozen generation evidence');
  const command=async(script,args)=>{
   try{return JSON.parse((await exec(process.execPath,[join(root,'scripts',script),...args],{cwd:root,env:{...process.env,UI_CHAIN_TEST_BROWSER:browser},windowsHide:true,maxBuffer:8*1024*1024,timeout:900000})).stdout);}
   catch(error){
    let report;for(const text of [error.stdout,error.stderr])try{report=JSON.parse(text);break;}catch{}
    // Only this zero-provider synthetic check records bounded child diagnostics.
    // Keep host paths out of CI logs and artifacts, including JSON-escaped paths.
    const substitutions=[[root,'<harness-root>/'],[process.execPath,'<node>'],[homedir(),'<home>']].flatMap(([path,label])=>[...new Set([path,path.replaceAll('\\','/'),path.replaceAll('\\','\\\\'),path.replaceAll('/','\\')])].filter(Boolean).map(value=>({value,label}))).sort((a,b)=>b.value.length-a.value.length);
    const bounded=(value,limit=65536)=>{
     let text=String(value??'');
     for(const {value:from,label}of substitutions){const expression=from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp(expression,'gi'),label);}
     return text.length<=limit?text:text.slice(0,2048)+'\n<diagnostic truncated>\n'+text.slice(-(limit-2072));
    };
    const nested=[];let current=report;
    for(let depth=0;current&&depth<5;depth++){
     nested.push({code:current.code??null,stage:current.stage??current.failedStage??null,message:bounded(current.message,4096)});
     const detail=current.detail??current.stderr??current.error;
     if(typeof detail==='string'){try{current=JSON.parse(detail);}catch{nested.push({detail:bounded(detail,16384)});break;}}
     else if(detail&&typeof detail==='object')current=detail;
     else break;
    }
    const diagnosticFile='command-failure-'+randomUUID()+'.json',diagnostic={kind:'ui_component_pipeline_command_failure',version:'1.0',stage,script,arguments:args.map(arg=>bounded(arg,2048)),exitCode:error.code??null,killed:error.killed===true,stdout:bounded(error.stdout),stderr:bounded(error.stderr),parsedReport:report?bounded(JSON.stringify(report)):null,nested,realModelCalls:0,providerCalls:0};
    let diagnosticSaved=false;
    try{await writeFile(join(directory,diagnosticFile),json(diagnostic),{flag:'wx'});diagnosticSaved=true;}catch{}
    const detailCode=report?.code??error.code;
    console.error(json({code:'COMPONENT_PIPELINE_COMMAND_FAILED',stage,detailCode,diagnostic:diagnosticSaved?rel(join(directory,diagnosticFile)):null,nested,realModelCalls:0,providerCalls:0}));
    throw Object.assign(Error('COMPONENT_PIPELINE_COMMAND_FAILED'),{stage,detailCode,diagnostic:diagnosticSaved?rel(join(directory,diagnosticFile)):null,nested});
   }
  };
  stage='task-create';await progress(stage);
  const created=await command('skin-task.mjs',['create','--batch',batch.directory,'--sha256',batch.batchSha256,'--profile',profile]);
  const taskDirectory=componentPipelineDirectory(created.directory);
  const request=JSON.parse(await readSafe(taskDirectory,'request.json'));
  assert.equal(request.batch.sha256,batch.batchSha256);assert.equal(Boolean(request.materialAtlas),materials);
  stage='task-resume';await progress(stage,{taskDirectory:rel(taskDirectory)});
  const completed=await command('skin-task.mjs',['resume','--directory',taskDirectory]);
  assert.equal(completed.status,'awaiting-visual-review');assert.equal(completed.productionReady,false);assert(completed.nodes.every(n=>n.status==='passed'));
  const postprocess=completed.nodes.find(n=>n.id==='postprocess').outputs;
  const runDirectory=componentPipelineDirectory(postprocess.directory),run=JSON.parse(await readSafe(runDirectory,'run.json'));
  assert.equal(run.status,'checked-candidate');
  const consumerDirectory=componentPipelineDirectory(run.consumerDirectory),consumer=JSON.parse(await readSafe(consumerDirectory,'manifest.json'));
  assert.equal(consumer.kind,'ui_component_consumer_candidate');assert.equal(consumer.components,16);assert.equal(consumer.productionReady,false);assert.equal(consumer.visualAcceptance,'unreviewed');
  const skin=await verifySkinPackage(join(consumerDirectory,'skin'));
  assert.equal(skin.pack.assets.length,baseAssets);assert.equal(skin.pack.materialAssets?.length??0,materials?3:0);
  for(const id of ['slot.normal','slot.selected'])assert(skin.pack.assets.some(asset=>asset.assetId===id));
  if(materials){assert.deepEqual(Object.keys(skin.pack.surfaceStyles).sort(),['panel','section','title']);assert(run.stages.some(s=>s.stage==='material-extract-and-bind'&&s.status==='passed'));}
  else assert(!run.stages.some(s=>s.stage==='material-extract-and-bind'));
  const checks=JSON.parse(await readSafe(runDirectory,'evidence/checks.json'));
  assert.equal(checks.status,'passed');assert.equal(checks.components,16);assert.equal(checks.publicFactory,'passed');assert.equal(checks.relocatedOutsideRepository,true);assert.deepEqual(checks.errors,[]);
  stage='deterministic-repeat';await progress(stage);
  const attemptsBefore=(await readdir(join(taskDirectory,'attempts'))).sort(),receiptsBefore=await inventory(join(taskDirectory,'receipts'));
  const resumed=await command('skin-task.mjs',['resume','--directory',taskDirectory]);
  assert.equal(resumed.status,'awaiting-visual-review');assert.deepEqual((await readdir(join(taskDirectory,'attempts'))).sort(),attemptsBefore);assert.deepEqual(await inventory(join(taskDirectory,'receipts')),receiptsBefore);
  assert.deepEqual(await inventory(skinDirectory),generationEvidence);assert.deepEqual(await readSafe(batch.directory,'batch.json'),batchBytes);
  const report={kind:'ui_component_pipeline_check',version:'1.0',status:'passed',scope:'reference-to-16-component-output',fixture:'synthetic-clean-template-responses',materials,browser,realModelCalls:0,providerCalls:0,syntheticAdapterCalls:seen.length,repeatedAdapterCalls:repeated.adapterCallsThisRun,batchSha256:batch.batchSha256,sheets:batchDocument.plans.map(p=>({sheetId:p.sheetId,assets:p.assets})),baseAssets,materialAssets:skin.pack.materialAssets?.length??0,components:16,checkedNodes:completed.nodes.map(n=>n.id),checks:checks.checks,publicFactory:checks.publicFactory,relocatedOutsideRepository:true,frozenGenerationEvidenceUnchanged:true,completedTaskReusesReceipts:true,taskDirectory:rel(taskDirectory),consumerDirectory:rel(consumerDirectory),evidenceDirectory:rel(join(runDirectory,'evidence')),skinSha256:skin.manifestSha256,visualAcceptance:'unreviewed',productionReady:false};
  await writeFile(join(directory,'report.json'),json(report),{flag:'wx'});await progress('passed');
  return {directory:rel(directory),...report};
 }catch(error){
  await writeFile(join(directory,'failure.json'),json({kind:'ui_component_pipeline_check_failure',stage,status:'failed',code:typeof error.detailCode==='string'?error.detailCode:error.code??'COMPONENT_PIPELINE_CHECK_FAILED',realModelCalls:0,providerCalls:0}),{flag:'wx'});
  throw Object.assign(Error('Component pipeline check failed at '+stage+'; inspect '+rel(directory)+'/failure.json.'),{cause:error});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{out:{type:'string'},browser:{type:'string'},'no-materials':{type:'boolean',default:false},help:{type:'boolean',default:false}}});
 if(values.help)console.log('node scripts/component-pipeline-check.mjs [--browser chromium|chrome|msedge] [--no-materials] [--out work/<new-directory>] — fresh synthetic inputs, real deterministic pipeline, model calls 0');
 else console.log(json(await checkComponentPipeline({materials:!values['no-materials'],...(values.out?{output:values.out}:{}),...(values.browser?{browser:values.browser}:{})})));
}
