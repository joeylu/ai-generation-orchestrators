import {taskToolIdentity} from '../src/skins/task-tools.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseArgs,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {readSafe,hash,json} from '../src/skins/package.mjs';
import {inventory} from '../src/skins/workflow.mjs';
import {validateDag,taskStatus,resumeTask} from '../src/skins/task-dag.mjs';
import {inspectGenerationBatch} from '../src/skin-generation/batch-intake.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=promisify(execFile);
const {positionals,values:v}=parseArgs({allowPositionals:true,options:{input:{type:'string'},profile:{type:'string'},directory:{type:'string'},until:{type:'string'},batch:{type:'string'},sha256:{type:'string'},'allow-rejected-localization':{type:'boolean'}}});
const rel=p=>relative(root,p).replaceAll('\\','/');
const local=p=>{if(!p)throw Error('task.path-required');const q=resolve(root,p),r=relative(join(root,'work'),q);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('task.work-path');return q;};
const verify=async files=>{for(const f of files)if(hash(await readSafe(root,f.file))!==f.sha256)throw Error('task.artifact-changed');};
const identity=()=>taskToolIdentity(root);
const output=s=>({status:s.status,nodes:s.nodes,attempts:s.attempts,batch:s.request.batch??null,productionReady:false,generation:'not-invoked',externalStages:s.request.graph.externalStages});
let directory;
try{
  const action=positionals[0];if(positionals.length!==1||!['create','resume','status','batch-status'].includes(action))throw Error('Use create --input OR --batch --sha256 --profile | batch-status --batch --sha256 | resume --directory [--until node] | status --directory');
  let intake,batchContracts;
  if(v.batch){
    if(!['create','batch-status'].includes(action)||v.input)throw Error('task.exclusive-entry');
    const {readContracts}=await import('../src/contracts/validate.mjs'),{defaults}=await import('../src/contracts/build.mjs');
    batchContracts=await readContracts(defaults);
    const batchPath=local(v.batch);
    if(batchPath!==join(dirname(dirname(batchPath)),'batches',v.sha256??''))throw Error('task.batch-path-digest');
    intake=await inspectGenerationBatch({skinDirectory:dirname(dirname(batchPath)),batchSha256:v.sha256,templateSha256:hash(batchContracts.bytes.template),sheets:batchContracts.template.sheets});
  }else if(action==='batch-status'||v.sha256||v['allow-rejected-localization'])throw Error('task.batch-required');
  if(action==='batch-status'){console.log(json(intake.summary));process.exit(0);}
  if(action==='create'){
    if(intake&&intake.sources.length!==batchContracts.template.sheets.length)throw Error('task.batch-incomplete-no-resubmission');
    if(intake&&!intake.summary.originalChecksPassed&&!v['allow-rejected-localization'])throw Error('task.rejected-requires-explicit-localization-candidate');
    const ip=intake?null:local(v.input),pp=local(v.profile),pb=await readFile(pp),input=intake?{kind:'ui_skin_localization_input',version:'1.0',templateSha256:hash(batchContracts.bytes.template),sheets:intake.sources.map(({raw,...s})=>s)}:JSON.parse(await readFile(ip)),profile=JSON.parse(pb);
    const graph=validateDag(JSON.parse(await readFile(join(root,'configs/skin-task-dag.json'))));
    const {readContracts}=await import('../src/contracts/validate.mjs'),{defaults}=await import('../src/contracts/build.mjs');
    const contracts=await readContracts(defaults),sheetIds=contracts.template.sheets.map(s=>s.id);
    if(input.kind!=='ui_skin_localization_input'||input.version!=='1.0'||input.templateSha256!==hash(contracts.bytes.template)||input.sheets.length!==sheetIds.length||new Set(input.sheets.map(s=>s.sheetId)).size!==sheetIds.length||input.sheets.some(s=>!sheetIds.includes(s.sheetId))||profile.kind!=='ui_skin_metadata_profile'||profile.version!=='1.0')throw Error('task.invalid-input');
    if(JSON.stringify(graph.nodes.filter(n=>n.kind==='source').map(n=>n.sheetId).sort())!==JSON.stringify([...sheetIds].sort()))throw Error('task.graph-sheet-mismatch');
    const sources=[];for(const s of input.sheets){const raw=intake?intake.sources.find(f=>f.sheetId===s.sheetId).raw:await readSafe(dirname(ip),s.file);if(hash(raw)!==s.sha256)throw Error('task.source-digest');sources.push({...s,raw});}
    directory=join(root,'work/skin-tasks',randomUUID());await mkdir(join(directory,'input/sources'),{recursive:true});await mkdir(join(directory,'receipts'));
    for(const s of sources)await writeFile(join(directory,'input/sources',s.sheetId+'.png'),s.raw,{flag:'wx'});
    const snapshot={...input,sheets:input.sheets.map(s=>({...s,file:'sources/'+s.sheetId+'.png'}))};
    await writeFile(join(directory,'input/localization.json'),json(snapshot),{flag:'wx'});await writeFile(join(directory,'input/profile.json'),pb,{flag:'wx'});
    if(intake){
      for(const f of intake.evidence){const dest=join(directory,'input/generation',f.file);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,f.bytes,{flag:'wx'});}
      await writeFile(join(directory,'input/batch-intake.json'),json({...intake.summary,rejectedLocalizationCandidate:v['allow-rejected-localization']===true}),{flag:'wx'});
      graph.externalStages=['reference-and-style','human-compute-confirmation','external-model-submissions'];
    }
    const inputs=(await inventory(join(directory,'input'))).map(f=>({...f,file:rel(join(directory,'input',f.file))}));
    await writeFile(join(directory,'request.json'),json({kind:'ui_skin_task',version:'1.0',graph,entry:intake?'received-generation-batch':'received-assets',batch:intake?{sha256:intake.summary.batchSha256,evidence:rel(join(directory,'input/batch-intake.json')),originalChecksPassed:intake.summary.originalChecksPassed}:null,input:rel(join(directory,'input/localization.json')),profile:rel(join(directory,'input/profile.json')),inputs,toolSha256:await identity(),generation:'not-invoked'}),{flag:'wx'});
  }else directory=local(v.directory);
  let state;
  if(action==='resume'){
    const request=JSON.parse(await readSafe(directory,'request.json'));
    const assertTools=async()=>{if(await identity()!==request.toolSha256)throw Error('task.tools-changed-create-new-task');};
    const command=async(script,args)=>{
      try{return JSON.parse((await run(process.execPath,[join(root,'scripts',script),...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:300000})).stdout);}
      catch(e){
        let report;for(const output of [e.stdout,e.stderr]){try{report=JSON.parse(output);break;}catch{}}
        const code=e.killed?'LOCAL_COMMAND_TIMEOUT':typeof report?.code==='string'?report.code:typeof e.code==='string'?e.code:report?.message??'task.command-failed';
        throw Object.assign(Error(code),{code,stderr:e.stderr});
      }
    };
    const files=async dir=>(await inventory(local(dir))).map(f=>({...f,file:rel(join(local(dir),f.file))}));
    state=await resumeTask(directory,{verify,assertTools,until:v.until,execute:async(n,prior,req)=>{
      if(n.kind==='source'){
        const input=JSON.parse(await readSafe(root,req.input)),s=input.sheets.find(s=>s.sheetId===n.sheetId),path=join(dirname(local(req.input)),s.file);
        const f={file:rel(path),sha256:s.sha256};await verify([f]);return{outputs:{sheetId:n.sheetId,source:f.file},files:[f]};
      }
      let r,dir;
      if(n.kind==='locate'){r=await command('skin-locate.mjs',['--input',req.input]);dir=r.directory;}
      else if(n.kind==='metadata'){r=await command('skin-metadata-draft.mjs',['--report',prior.locate.directory+'/report.json','--input',req.input,'--profile',req.profile]);dir=r.directory;}
      else if(n.kind==='content-insets'){
        const config=prior.metadata.assembly,out=config.replace(/\.json$/,'-content-insets-'+randomUUID()+'.json');
        r=await command('skin-content-insets.mjs',['--config',config,'--out',out]);
        const refs=[out,out+'.insets.json'];return{outputs:{assembly:rel(local(r.directory))},files:await Promise.all(refs.map(async f=>({file:rel(local(f)),sha256:hash(await readFile(local(f)))})))};
      }else {r=await command('skin-postprocess.mjs',['build','--config',prior['content-insets'].assembly]);if(r.status!=='checked-candidate')throw Error('task.check-failed');dir=r.directory;}
      return{outputs:{...r,directory:rel(local(dir))},files:await files(dir)};
    }});
  }else state=await taskStatus(directory,verify);
  if(state.status==='awaiting-visual-review'){
    const last=state.nodes.find(n=>n.id==='postprocess').outputs;
    const runs=[{id:'candidate',label:'任务候选',directory:last.directory}];
    // Derived result index only, not a receipt or release manifest.
    await writeFile(join(directory,'preview-runs.json'),json(runs));
    await writeFile(join(directory,'result.md'),'# 皮肤任务结果\n\n状态：待视觉验收；无模型调用。\n\n[参数与警告](../../'+state.nodes.find(n=>n.id==='metadata').outputs.directory.replace(/^work\//,'')+'/trial.json)\n\n[组件检查](../../'+last.directory.replace(/^work\//,'')+'/evidence/checks.json) · [横版](../../'+last.directory.replace(/^work\//,'')+'/evidence/wide.png) · [竖版](../../'+last.directory.replace(/^work\//,'')+'/evidence/tall.png)\n');
  }
  console.log(json({directory:rel(directory),...output(state),toolsMatch:state.request.toolSha256===await identity()}));
}catch(e){console.error(json({status:'failed',directory:directory?rel(directory):null,code:e.killed?'LOCAL_COMMAND_TIMEOUT':e.code??null,message:e.message,detail:e.stderr??null}));process.exitCode=1;}
