import {motionSelection} from '../panel/motion-profile.mjs';
import {panelOrientations} from '../panel/orientation.mjs';
import {readFile,writeFile,rename,mkdir,readdir} from 'node:fs/promises';
import {join,dirname,relative,isAbsolute,sep,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readSafe,hash,json,verifySkinPackage} from '../skins/package.mjs';
import {taskStatus} from '../skins/task-dag.mjs';
import {inspectStudioTasks} from './tasks.mjs';
import {studioSnapshot} from './catalog.mjs';
import {archiveFiles} from './archive.mjs';
import {sampledTextTheme} from './theme.mjs';
import {inspectGenerationBatch} from '../skin-generation/batch-intake.mjs';
import {referencePreset,referencePresetList,referenceRequest} from '../panel/reference-presets.mjs';
import {acquireLocalLock,localLockState} from '../skins/local-lock.mjs';
import {automaticRecoveryDecision,localFailure,localRecoveryPolicy} from './local-recovery.mjs';
import {upgradedConsumer} from './component-upgrade.mjs';
const exec=promisify(execFile);
export function pipelineController(root,generation,snapshot,{inspectTasks=inspectStudioTasks,policy=localRecoveryPolicy,verifyPanelSkin=verifySkinPackage,resolveComponentSkin}={}){
 const running=new Set(),archives=new Map(),processed=new Set(),recoveryPending=new Set();
 const rel=path=>relative(root,resolve(root,path)).replaceAll('\\','/');
 const local=path=>{const absolute=resolve(root,path),r=relative(join(root,'work'),absolute);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('PIPELINE_PATH');return absolute;};
 const directory=id=>dirname(dirname(local(generation.resolve(id).directory)));
 const read=async(dir,file)=>JSON.parse(await readSafe(dir,file));
 async function load(dir){try{return await read(dir,'flow.json');}catch(e){if(e.code==='ENOENT')return {version:'1.0',panels:[]};throw e;}}
 async function save(dir,flow){const temp=join(dir,'.flow-'+randomUUID()+'.json');await writeFile(temp,json(flow),{flag:'wx'});await rename(temp,join(dir,'flow.json'));}
 async function command(script,args,{text=false}={}){
  try{const result=await exec(process.execPath,[join(root,'scripts',script),...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:900000});return text?result.stdout.trim():JSON.parse(result.stdout);}
  catch(e){let parsed;for(const output of [e.stdout,e.stderr]){try{parsed=JSON.parse(output);break;}catch{}}if(parsed?.status==='NEEDS_INPUT')return parsed;throw Object.assign(Error(parsed?.code||'PIPELINE_COMMAND_FAILED'),{code:e.killed?'LOCAL_COMMAND_TIMEOUT':e.code,detail:parsed});}
 }
 async function publish(item){
  const loaded=await studioSnapshot(root,{version:'0.1',name:'Studio',artifacts:[item]});
  const prefix='artifacts/'+item.id+'/';const exportFiles=new Map([...loaded.files].filter(([name])=>name.startsWith(prefix)).map(([name,bytes])=>[name.slice(prefix.length),bytes]));
  for(const [name,bytes]of loaded.files)if(name.startsWith(prefix))snapshot.files.set(name,bytes);
  const url='/'+prefix+'download',digest=hash(json([...exportFiles].map(([name,bytes])=>[name,hash(bytes)])));
  if(archives.get(item.id)!==digest){const bytes=archiveFiles(exportFiles);snapshot.files.set(prefix+'download',Buffer.from(json({kind:'ui_studio_export',format:'zip',size:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')})));archives.set(item.id,digest);}
  const entry=loaded.items[0];entry.downloads.unshift({name:'完整交付包.zip',url});
  const index=snapshot.items.findIndex(x=>x.id===item.id);if(index<0)snapshot.items.push(entry);else snapshot.items[index]=entry;
  const catalog=JSON.parse(snapshot.files.get('catalog.json'));snapshot.files.set('catalog.json',Buffer.from(json({...catalog,items:snapshot.items})));
  return entry;
 }
 async function skinFromFlow(flow){
  if(!flow.taskDirectory)throw Error('PIPELINE_NO_SKIN');
  const state=await taskStatus(local(flow.taskDirectory),async files=>{for(const f of files)if(hash(await readSafe(root,f.file))!==f.sha256)throw Error('PIPELINE_ARTIFACT_CHANGED');});
  if(state.status!=='awaiting-visual-review')throw Error('PIPELINE_SKIN_NOT_READY');
  const output=state.nodes.find(n=>n.id==='postprocess').outputs;
  const run=await read(local(output.directory),'run.json');if(run.status!=='checked-candidate')throw Error('PIPELINE_SKIN_NOT_CHECKED');
  const selected=await upgradedConsumer(root,local(run.consumerDirectory),flow.componentRuntime);
  const consumer=selected.directory,packDirectory=join(consumer,'skin');
  const {pack,manifestSha256}=await verifySkinPackage(packDirectory);
  return {consumer,packDirectory,pack,manifestSha256,consumerSha256:selected.consumerSha256};
 }
 async function view(id){
  const dir=directory(id),flow=await load(dir),project=await read(dir,'project.json');
  const batch=await generation.action('status',{id});
  const lock=await localLockState(dir,'.processing.lock');
  const result={name:project.name,busy:running.has(dir)||lock.status==='busy',recovering:recoveryPending.has(id),batchReady:batch.nodes.length===4&&batch.nodes.every(n=>n.status==='received'),generationRunning:batch.operation==='running',phase:flow.phase??'not-started',message:flow.message??'',errorCode:flow.errorCode??null,localRecovery:flow.localRecovery??null,panels:flow.panels??[],task:null,skin:null};
  result.processingStartedAt=flow.processingStartedAt;result.processingFinishedAt=flow.processingFinishedAt;
  if(lock.status==='unknown'){const failure=localFailure({code:'LOCAL_LOCK_UNKNOWN'});result.message=failure.message;result.errorCode=failure.code;result.phase='processing-failed';}
  if(flow.taskDirectory){const [task]=await inspectStudioTasks(root,[{id:'task',name:project.name,directory:flow.taskDirectory}]);result.task=task;
   if(task.status==='awaiting-visual-review'){
    const skin=await skinFromFlow(flow),artifact=await publish({id:'skin-'+dirname(generation.resolve(id).directory).split(/[\\/]/).at(-2).slice(0,8)+'-'+hash(skin.manifestSha256+(skin.consumerSha256??'')).slice(0,8),name:project.name+' · 组件',type:'components',directory:rel(skin.consumer)});
    const prefix='/artifacts/'+artifact.id+'/skin/';
    result.skin={...(flow.componentMotion?.skinSha256===skin.manifestSha256?{motion:flow.componentMotion}:{}),artifactId:artifact.id,url:artifact.url,version:skin.manifestSha256,downloads:artifact.downloads,thumbnails:skin.pack.assets.filter(a=>['surface.panel','button.primary.normal','field.normal','switch.track.on'].includes(a.assetId)).slice(0,4).map(a=>({url:prefix+a.file,name:a.assetId}))};
   }
  }
  result.panels=await Promise.all(result.panels.map(async p=>{
   if(p.deletedAt)return p;
   if(p.artifact){try{const entry=await publish(p.artifact);return {...p,url:entry.url,downloads:entry.downloads};}catch{return {...p,status:'invalid',message:'面板产物校验失败'};}}
   // A claim without a finished record after restart is never automatically resubmitted.
   return {...p,status:p.status==='running'&&!running.has(dir)?'interrupted-no-retry':p.status};
  }));
  return result;
 }
 async function processSkin(id,allowCandidate,automatic=false){
  const dir=directory(id);if(running.has(dir)){if(automatic)return {status:'busy'};throw Error('PIPELINE_BUSY');}running.add(dir);
  let release,launched=false,flow;
  try{
   release=await acquireLocalLock(dir,'.processing.lock');
   const plan=generation.resolve(id),state=await generation.action('status',{id});
   if(state.nodes.length!==4||state.nodes.some(n=>n.status!=='received'))throw Error('PIPELINE_BATCH_NOT_RECEIVED');
   flow=await load(dir);
   let reuse=false;
   if(flow.taskDirectory){
    const taskLock=await localLockState(local(flow.taskDirectory));
    if(taskLock.status==='busy')return {status:'busy'};
    if(taskLock.status==='unknown')throw Error('LOCAL_LOCK_UNKNOWN');
    const [task]=await inspectTasks(root,[{id:'task',name:'task',directory:flow.taskDirectory}]);
    if(task.status==='invalid')throw Error('LOCAL_INVALID_TASK');
    // Completed packages are immutable; a later tool version never rebuilds them.
    if(task.status==='awaiting-visual-review')return {status:'complete'};
    reuse=task.toolsMatch===true;
    if(automatic&&!reuse)throw Error('LOCAL_TOOLS_CHANGED');
    // A crash between a failed node receipt and the flow summary must not turn
    // a quality rejection into a fresh automatic attempt.
    if(automatic&&flow.phase==='processing'){
     const failed=(task.attempts??[]).find(a=>a.status==='failed'&&task.nodes?.some(n=>n.id===a.node&&n.status!=='passed')&&!localFailure(a.failure).retryable);
     if(failed)throw Object.assign(Error('LOCAL_PREVIOUS_FAILURE'),{detail:failed.failure});
    }
   }
   if(automatic){
    const decision=automaticRecoveryDecision(flow,plan.batchSha256,policy);
    if(decision==='batch-changed')throw Error('LOCAL_BATCH_CHANGED');
    if(decision==='limit'){
     flow.phase='processing-failed';flow.errorCode='LOCAL_RECOVERY_LIMIT';flow.message='本地自动恢复已达到上限，原始结果已保留；请查看任务记录后手动继续。';
     flow.localRecovery.failure={code:flow.errorCode,message:flow.message,retryable:false};await save(dir,flow);return {status:'stopped'};
    }
    if(decision!=='continue')return {status:decision};
   }
   flow.localRecovery={batchSha256:plan.batchSha256,automaticStarts:automatic?(flow.localRecovery?.automaticStarts??0)+1:0,mode:automatic?'automatic':'manual',failure:null};
   flow.phase='processing';flow.processingStartedAt=new Date().toISOString();delete flow.processingFinishedAt;flow.message=automatic&&flow.taskDirectory?'正在从已通过的步骤恢复本地处理':'正在定位、拆分并检查组件';delete flow.errorCode;await save(dir,flow);
   launched=true;
   Promise.resolve().then(async()=>{
    if(!reuse){
     const profile=JSON.parse(await readSafe(root,'configs/studio-metadata-profile.json'));profile.id='studio-'+hash(plan.directory).slice(0,12);
     // New Studio projects opt into source-bound theme sampling; old frozen builds remain intact.
     const project=await read(dir,'project.json');
     if(project.automaticProcessing){
      let preset;try{preset=await read(dir,'preset.json');}catch(e){if(e.code!=='ENOENT')throw e;}
      if(preset?.palette)Object.assign(profile.theme.palette,{base:preset.palette.surface,active:preset.palette.primary,mark:preset.palette.secondary,stroke:preset.palette.secondary,text:preset.palette.text});
      const template=JSON.parse(await readSafe(root,'configs/skin-template-set.draft.json'));
      const sheet=template.sheets.find(s=>s.parts.some(p=>p.assetId==='surface.panel'));
      const intake=await inspectGenerationBatch({skinDirectory:dir,batchSha256:plan.batchSha256,templateSha256:hash(await readSafe(root,'configs/skin-template-set.draft.json')),sheets:template.sheets});
      const source=intake.sources.find(s=>s.sheetId===sheet.id),theme=sampledTextTheme(source.raw,sheet.parts.find(p=>p.assetId==='surface.panel'),template.coordinates);
      profile.theme.palette.text=theme.text;
      await writeFile(join(dir,'theme-evidence-'+randomUUID()+'.json'),json({...theme.evidence,sourceSha256:source.sha256,profileSha256:hash(json(profile)),presetId:preset?.id??null}),{flag:'wx'});
     }
     const profilePath=join(dir,'profile-'+randomUUID()+'.json');await writeFile(profilePath,json(profile),{flag:'wx'});
     const task=await command('skin-task.mjs',['create','--batch',plan.directory,'--sha256',plan.batchSha256,'--profile',rel(profilePath),...(allowCandidate?['--allow-rejected-localization']:[])]);
     flow.taskDirectory=task.directory;await save(dir,flow);
    }
    await command('skin-task.mjs',['resume','--directory',flow.taskDirectory]);flow.phase='components-ready';flow.processingFinishedAt=new Date().toISOString();flow.message='16 类组件已完成程序检查，等待外观验收';await save(dir,flow);
   }).catch(async e=>{
    if(e.detail?.code==='LOCAL_LOCK_BUSY'){
     if(automatic)flow.localRecovery.automaticStarts--;flow.phase='processing';flow.message='已有本地处理仍在运行，等待完成。';
    }else{
     const failure=localFailure(e);flow.phase='processing-failed';flow.processingFinishedAt=new Date().toISOString();flow.message=failure.message;flow.errorCode=failure.code;flow.localRecovery.failure=failure;
    }
    await save(dir,flow);
   }).finally(async()=>{
    running.delete(dir);await release();
    for(const listener of processed)Promise.resolve().then(()=>listener(id,{phase:flow.phase,retryable:flow.localRecovery?.failure?.retryable===true})).catch(()=>console.error('Local processing recovery needs review.'));
   }).catch(()=>console.error('Local processing state could not be saved; original task records were retained.'));
   return {status:'started'};
  }catch(e){
   if(e.code==='LOCAL_LOCK_BUSY'){if(automatic)return {status:'busy'};throw Error('PIPELINE_BUSY');}
   if(flow){const failure=localFailure(e);flow.phase='processing-failed';flow.message=failure.message;flow.errorCode=failure.code;flow.localRecovery={...flow.localRecovery,failure};await save(dir,flow);if(automatic)return {status:'stopped'};}
   throw e;
  }finally{if(!launched){running.delete(dir);if(release)await release();}}
 }
 async function preparePanel(data){
  const dir=directory(data.id);if(running.has(dir))throw Error('PIPELINE_BUSY');
  const reference=referencePresetList().some(p=>p.id===data.kind);
  if(!reference&&!['settings','confirmation','form','custom'].includes(data.kind)||typeof data.text!=='string'||(!reference&&!data.text.trim())||data.text.length>4000)throw Error('PANEL_REQUEST_INVALID');
  running.add(dir);
  try{
   const flow=await load(dir),parent=data.panelId?flow.panels.find(p=>p.id===data.panelId):null;
   if(data.panelId&&(!parent||parent.deletedAt||parent.status!=='needs-input'||parent.sha256!==data.parentSha256||!data.text.trim()||parent.kind!==data.kind))throw Error('PANEL_CLARIFICATION_STALE');
   const parentBundle=parent?JSON.parse(await readSafe(root,rel(local(parent.plan)))):null;
   if(parent&&(parentBundle.plan?.sha256!==parent.sha256||typeof parentBundle.plan?.session?.context?.request?.text!=='string'||!parentBundle.consumer?.skinSha256))throw Error('PANEL_PARENT_PLAN_INVALID');
   const skin=parent?.skinDirectory?{packDirectory:local(parent.skinDirectory),...await verifyPanelSkin(local(parent.skinDirectory))}:await skinFromFlow(flow),project=await read(dir,'project.json'),id=randomUUID();
   if(parent&&(parent.skinVersion??parentBundle.consumer.skinSha256)!==skin.manifestSha256)throw Error('PANEL_SKIN_CHANGED');
   const orientation=parent?.orientation??data.orientation;
   if(!orientation)throw Error('PANEL_ORIENTATION_REQUIRED');panelOrientations(orientation);
   const inputs=join(dir,'panels',id);await mkdir(inputs,{recursive:true});
   const aliases={version:'1.0',skins:{[skin.pack.id]:[project.name,'当前选定皮肤','当前皮肤']}};
   const request=reference?referenceRequest(data.kind,data.text):{text:data.text};
   if(parent){
    const previous=parentBundle.plan.session.context.request;
    request.text=previous.text+'\n\n模型待澄清问题：\n'+(parent.questions??[]).map(q=>q.question??String(q)).join('\n')+'\n\n用户本轮补充回答（针对上述问题修订原需求，以本轮明确回答为准）：\n'+data.text.trim();
   }
   if(reference)await writeFile(join(inputs,'reference-preset.json'),json(referencePreset(data.kind)),{flag:'wx'});
   await writeFile(join(inputs,'aliases.json'),json(aliases),{flag:'wx'});await writeFile(join(inputs,'request.json'),json({requestVersion:'0.1',id:'studio-'+id,target:'pixi',text:request.text}),{flag:'wx'});
   const settings=['settings','sdk-settings'].includes(data.kind),script=settings?'settings-model.mjs':'action-model.mjs';
   const prepared=await command(script,['prepare','--package',skin.packDirectory,'--request',join(inputs,'request.json'),'--aliases',join(inputs,'aliases.json'),...(data.kind==='settings'?[]:['--preset',data.kind]),'--orientation',orientation]);
   const panel={id:parent?.id??id,kind:data.kind,...(request.source?{referencePreset:request.source,presetName:referencePreset(data.kind).name}:data.kind==='custom'?{presetName:'自定义面板'}:{}),text:parent?parent.text+'\n补充：'+data.text.trim():data.text||'使用预设默认内容',status:'prepared',sha256:prepared.sha256,plan:rel(prepared.plan),inputs:rel(inputs),skinVersion:skin.manifestSha256,skinDirectory:rel(skin.packDirectory),orientation,canvasSelection:true};
   if(parent){const {history=[],...previous}=parent;panel.revision=(parent.revision??1)+1;panel.history=[...history,previous];flow.panels[flow.panels.indexOf(parent)]=panel;}else flow.panels.push(panel);
   await save(dir,flow);return panel;
  }finally{running.delete(dir);}
 }
 async function startPanel(data){
  const dir=directory(data.id);if(running.has(dir))throw Error('PIPELINE_BUSY');running.add(dir);
  try{
   const flow=await load(dir),panel=flow.panels.find(p=>p.id===data.panelId);if(!panel||panel.deletedAt||panel.status!=='prepared'||panel.sha256!==data.confirmed)throw Error('PANEL_CONFIRMATION_REQUIRED');
   const skin=panel.skinDirectory?{packDirectory:local(panel.skinDirectory),...await verifyPanelSkin(local(panel.skinDirectory))}:await skinFromFlow(flow);
   if(panel.skinVersion&&skin.manifestSha256!==panel.skinVersion)throw Error('PANEL_SKIN_CHANGED');
   panel.status='running';panel.stage='planning';panel.startedAt=new Date().toISOString();await save(dir,flow);
   Promise.resolve().then(async()=>{
    const settings=['settings','sdk-settings'].includes(panel.kind),alias=join(local(panel.inputs),'aliases.json'),script=settings?'settings-model.mjs':'action-model.mjs';
    const output=await command(script,['run','--package',skin.packDirectory,'--plan',local(panel.plan),'--authorize',panel.sha256,'--aliases',alias]);
    panel.runDirectory=rel(output.directory);
    if(output.status==='NEEDS_INPUT'){panel.status='needs-input';panel.finishedAt=new Date().toISOString();panel.questions=output.questions;await save(dir,flow);return;}
    if(output.status!=='COMPILED')throw Error('PANEL_NOT_COMPILED');
    panel.stage='rendering';await save(dir,flow);
    const args=['--package',skin.packDirectory,'--out',join(local(panel.inputs),'previews'),...(panel.canvasSelection?['--orientation',panel.orientation]:[])];
    if(settings)args.push('--content',join(output.directory,'content.json'),'--layout',join(output.directory,'layout.json'));
    else args.push('--run',output.directory,'--aliases',alias);
    const preview=await command(settings?'settings-preview.mjs':'action-preview.mjs',args,{text:true});
    panel.stage='publishing';await save(dir,flow);
    panel.artifact={id:'panel-'+panel.id,name:(await read(dir,'project.json')).name+' · '+(panel.presetName??{settings:'设置',confirmation:'确认弹窗',form:'简单表单'}[panel.kind]),type:'panel',directory:rel(preview)};
    await publish(panel.artifact);panel.status='ready';panel.stage='ready';panel.finishedAt=new Date().toISOString();await save(dir,flow);
   }).catch(async e=>{panel.status='failed-no-retry';panel.finishedAt=new Date().toISOString();panel.message='本次面板调用或转换未完成，未自动重试；请查看本地运行证据。';panel.code=e.message;await save(dir,flow);}).finally(()=>running.delete(dir));
   return {status:'started'};
  }catch(e){running.delete(dir);throw e;}
 }
 async function setComponentMotion(data){
  const motion=motionSelection(data.style,'components'),dir=directory(data.id);if(running.has(dir))throw Error('PIPELINE_BUSY');running.add(dir);let release;
  try{
   release=await acquireLocalLock(dir,'.processing.lock');const flow=await load(dir),skin=await (resolveComponentSkin??skinFromFlow)(flow);
   if(skin.manifestSha256!==data.expectedSkinSha256)throw Error('COMPONENT_SKIN_CHANGED');
   flow.componentMotion={...motion,skinSha256:skin.manifestSha256};await save(dir,flow);return {status:'saved',motion:flow.componentMotion};
  }finally{running.delete(dir);if(release)await release();}
 }
 async function setPanelMotion(data){
  const motion=motionSelection(data.style),dir=directory(data.id);if(running.has(dir))throw Error('PIPELINE_BUSY');running.add(dir);let release;
  try{
   release=await acquireLocalLock(dir,'.processing.lock');const flow=await load(dir),panel=flow.panels.find(p=>p.id===data.panelId);
   if(!panel||panel.deletedAt||panel.status!=='ready'||!panel.artifact)throw Error('PANEL_NOT_READY');
   if(panel.sha256!==data.expectedSha256)throw Error('PANEL_CHANGED');
   await publish(panel.artifact);
   panel.motion=motion;await save(dir,flow);return {status:'saved',motion};
  }finally{running.delete(dir);if(release)await release();}
 }
 async function changePanelVisibility(data,deleted){
  const dir=directory(data.id);if(running.has(dir))throw Error('PIPELINE_BUSY');running.add(dir);let release;
  try{
   release=await acquireLocalLock(dir,'.processing.lock');
   const flow=await load(dir),panel=flow.panels.find(p=>p.id===data.panelId);
   if(!panel)throw Error('PANEL_NOT_FOUND');
   if(panel.status==='running')throw Error('PANEL_RUNNING');
   if(panel.sha256!==data.expectedSha256)throw Error('PANEL_CHANGED');
   if(Boolean(panel.deletedAt)===deleted)return {status:deleted?'deleted':'restored',panelId:panel.id};
   if(deleted)panel.deletedAt=new Date().toISOString();else delete panel.deletedAt;
   await save(dir,flow);return {status:deleted?'deleted':'restored',panelId:panel.id};
  }finally{running.delete(dir);if(release)await release();}
 }
 return {
  processAutomatically:id=>processSkin(id,true,true),
  recoveryPending(id,value){if(value)recoveryPending.add(id);else recoveryPending.delete(id);},
  onProcessed(listener){processed.add(listener);return()=>processed.delete(listener);},
  async action(action,data){if(action==='status')return view(data.id);if(action==='process')return processSkin(data.id,data.allowCandidate===true);if(action==='panel-prepare')return preparePanel(data);if(action==='panel-start')return startPanel(data);if(action==='component-motion')return setComponentMotion(data);if(action==='panel-motion')return setPanelMotion(data);if(action==='panel-delete'||action==='panel-restore')return changePanelVisibility(data,action==='panel-delete');throw Error('PIPELINE_ACTION');}
 };
}
