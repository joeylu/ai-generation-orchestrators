import {readFile,writeFile,mkdir,readdir,access} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {hash,json,readSafe,verifySkinPackage} from '../skins/package.mjs';
import {panelSkinContracts} from '../panel/skin-contracts.mjs';
import {panelSdkIdentity} from '../panel/sdk.mjs';
import {referencePresetList,referenceRequest,referenceExample} from '../panel/reference-presets.mjs';
import {inventoryModelRequest} from '../panel/inventory-model-request.mjs';
import {fail,contained,sourceIdentity,verifyBatch,caseInputs,rawEvidence} from './evidence.mjs';
const exec=promisify(execFile),exists=async path=>{try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
export async function command(root,script,args){
 try{const r=await exec(process.execPath,[join(root,'scripts',script),...args],{cwd:root,windowsHide:true,timeout:1020000,maxBuffer:8*1024*1024});return {exitCode:0,stdout:r.stdout,stderr:r.stderr};}
 catch(e){return {exitCode:typeof e.code==='number'?e.code:1,stdout:e.stdout??'',stderr:e.stderr??'',code:e.killed?'ACCEPTANCE_COMMAND_TIMEOUT':typeof e.code==='string'?e.code:'ACCEPTANCE_COMMAND_FAILED'};}
}
const output=result=>{try{return JSON.parse(result.stdout);}catch{try{return JSON.parse(result.stderr);}catch{return {status:'FAILED',code:result.code??'ACCEPTANCE_COMMAND_FAILED'};}}};
export function acceptanceRequestId(batchId,caseId){
 const id='acceptance-'+batchId.slice(0,8)+'-'+caseId;
 if(!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(id))fail('ACCEPTANCE_REQUEST_ID');return id;
}
function presetExpected(id){
 if(id==='inventory')return {fieldCount:0,actionCount:0,inventory:{columns:5,rows:4,items:[],selectedSlot:null}};
 const example=referenceExample(id),fields=[],actions=[],literals=[example.title];
 for(const r of example.rows){
  if(r.kind==='button')actions.push({label:r.label,action:r.action,enabled:r.enabled});
  else if(r.kind==='text')literals.push(r.text);
  else if(r.kind==='switch')fields.push({type:'switch',label:r.label,value:r.initial,enabled:r.enabled});
  else if(r.kind==='select')fields.push({type:'select',label:r.label,options:r.options.map(o=>o.label),selectedLabel:r.options.find(o=>o.initial)?.label,enabled:r.enabled});
  else if(r.kind==='progress')fields.push({type:'progress-bar',label:r.label,value:r.initial,max:r.max});
 }
 return {title:example.title,literals,fields,actions,fieldCount:example.rows.filter(r=>r.kind!=='button').length,...(id==='sdk-settings'?{}:{actionCount:actions.length})};
}
export function expandCases(spec){
 if(spec?.version!=='1.0'||!Array.isArray(spec.custom)||!Array.isArray(spec.presets))fail('ACCEPTANCE_CASES_INVALID');
 const known=new Set([...referencePresetList().map(p=>p.id),'inventory']);
 const cases=spec.presets.flatMap(kind=>{if(!known.has(kind))fail('ACCEPTANCE_PRESET_INVALID');return ['landscape','portrait'].map(orientation=>({id:kind+'-'+orientation,kind,skin:spec.presetSkin??'pixel',orientation,text:kind==='inventory'?inventoryModelRequest('',{columns:5,rows:4}).text:referenceRequest(kind,'').text,expected:presetExpected(kind),...(kind==='inventory'?{grid:{columns:5,rows:4}}:{})}));});
 for(const item of spec.custom){if(!/^[A-Z][0-9]{2}$/.test(item.id)||!['landscape','portrait'].includes(item.orientation)||typeof item.text!=='string'||!item.expected)fail('ACCEPTANCE_CASES_INVALID');cases.push({...structuredClone(item),kind:'custom'});}
 if(new Set(cases.map(c=>c.id)).size!==cases.length)fail('ACCEPTANCE_CASES_INVALID');return cases;
}
export async function prepareAcceptance({root,spec,packageDirectory,contractsDirectory,skins,evidenceDirectory,referenceImages,outputRoot=join(root,'work/panel-acceptance'),runCommand=command,sdkIdentity=panelSdkIdentity,identity=sourceIdentity}){
 root=resolve(root);const out=contained(join(root,'work'),outputRoot),external=resolve(evidenceDirectory);try{contained(resolve(root,'../..'),external);fail('ACCEPTANCE_EVIDENCE_MUST_BE_EXTERNAL');}catch(e){if(e.code!=='ACCEPTANCE_PATH')throw e;}
 const sdk=await sdkIdentity();if(sdk.mode!=='locked')fail('ACCEPTANCE_LOCKED_SDK_REQUIRED');
 const skinCache=new Map(),skinFor=async key=>{if(skinCache.has(key))return skinCache.get(key);const selected=skins?skins[key]:{packageDirectory,contractsDirectory};if(!selected?.packageDirectory)fail('ACCEPTANCE_SKIN_REQUIRED');const packagePath=resolve(root,selected.packageDirectory),verified=await verifySkinPackage(packagePath),contracts=await panelSkinContracts(verified.pack,selected.contractsDirectory?resolve(root,selected.contractsDirectory):undefined);const value={verified,contracts,packagePath};skinCache.set(key,value);return value;};
 const source=await identity(root),cases=expandCases(spec),directory=join(out,randomUUID());await mkdir(directory,{recursive:true});
 const entries=[],files=[];
 const save=async(file,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(json(value));await writeFile(join(directory,file),bytes,{flag:'wx'});files.push({file,sha256:hash(bytes)});};
 const styleEntries=referenceImages??JSON.parse(await readSafe(root,'configs/studio-styles.json')).entries,styleReferences=[];
 if(styleEntries.length)await mkdir(join(directory,'references'));
 for(const style of styleEntries){if(!/^[a-z][a-z0-9-]+$/.test(style.id))fail('ACCEPTANCE_STYLE_INVALID');const bytes=await readFile(contained(root,join(root,style.image)));if(hash(bytes)!==style.sha256)fail('ACCEPTANCE_STYLE_CHANGED');const file='references/'+style.id+'.png';await save(file,bytes);styleReferences.push({id:style.id,name:style.name,file,sha256:style.sha256,scope:'visual-reference-only-not-a-generated-skin'});}
 for(const item of cases){
  const {verified,contracts,packagePath}=await skinFor(item.skin??'pixel');
  const name='cases/'+item.id,base=join(directory,name);await mkdir(join(base,'contracts'),{recursive:true});
  const aliases={version:'1.0',skins:{[verified.pack.id]:['当前选定皮肤','当前皮肤',verified.pack.id]}};
  await save(name+'/request.json',{requestVersion:'0.1',id:acceptanceRequestId(directory.split(/[\\/]/).at(-1),item.id),target:'pixi',text:item.text});await save(name+'/expected.json',item.expected);await save(name+'/aliases.json',aliases);
  for(const key of ['registry','usage','template'])await save(name+'/contracts/'+key+'.json',contracts.bytes[key]);
  const script=item.kind==='sdk-settings'?'settings-model.mjs':'action-model.mjs';
  const result=await runCommand(root,script,['prepare','--package',packagePath,'--request',join(base,'request.json'),'--aliases',join(base,'aliases.json'),'--contracts',join(base,'contracts'),'--preset',item.kind,'--orientation',item.orientation,...(item.grid?['--columns',String(item.grid.columns),'--rows',String(item.grid.rows)]:[])]),prepared=output(result);
  if(result.exitCode!==0||prepared.status!=='PREPARED'||!/^[a-f0-9]{64}$/.test(prepared.sha256??''))fail(prepared.code??'ACCEPTANCE_PREPARE_FAILED');
  const planBytes=await readFile(contained(join(root,'work'),prepared.plan)),bundle=JSON.parse(planBytes);
  if(bundle.plan.sha256!==prepared.sha256||bundle.consumer.skinSha256!==verified.manifestSha256||bundle.consumer.orientation!==item.orientation)fail('ACCEPTANCE_PLAN_CHANGED');
  await save(name+'/plan.json',planBytes);
  entries.push({id:item.id,kind:item.kind,skin:item.skin??'pixel',orientation:item.orientation,directory:name,planSha256:prepared.sha256,skinSha256:verified.manifestSha256,packageDirectory:packagePath,model:bundle.plan.model,effort:bundle.plan.effort});
 }
 await save('source.json',source);await save('cases.json',spec);
 if((await identity(root)).sha256!==source.sha256)fail('ACCEPTANCE_SOURCE_CHANGED');
 const body={kind:'ui_panel_acceptance_batch',version:'1.0',createdAt:new Date().toISOString(),sdk,sourceSha256:source.sha256,evidenceDirectory:external,styleReferences,cases:entries,files,automaticRetries:0},batch={...body,sha256:hash(Buffer.from(json(body)))};
 await writeFile(join(directory,'batch.json'),json(batch),{flag:'wx'});return {status:'PREPARED',directory,sha256:batch.sha256,cases:entries.length,modelCalls:0};
}
export async function runAcceptance({root,directory,authorizationSha256,maxConcurrency=2,runCommand=command,sdkIdentity=panelSdkIdentity}){
 const batch=await verifyBatch(directory);if(authorizationSha256!==batch.sha256)fail('ACCEPTANCE_AUTHORIZATION_REQUIRED');if(![1,2,3].includes(maxConcurrency))fail('ACCEPTANCE_CONCURRENCY');if(!isDeepStrictEqual(await sdkIdentity(),batch.sdk))fail('ACCEPTANCE_SDK_CHANGED');
 if((await sourceIdentity(root)).sha256!==batch.sourceSha256)fail('ACCEPTANCE_SOURCE_CHANGED');
 const dispatches=join(directory,'dispatches'),results=[];await mkdir(dispatches,{recursive:true});
 const execute=async entry=>{
  const claim=join(dispatches,entry.id+'.json'),rawDirectory=join(root,'work/panels',entry.kind==='sdk-settings'?'model-runs':'action-model-runs','intent-'+entry.planSha256);
  if(await exists(claim)||await exists(rawDirectory)){results.push({id:entry.id,status:'EXISTING_NO_RETRY',directory:rawDirectory});return;}
  const {base}=await caseInputs(directory,entry);
  try{await writeFile(claim,json({kind:'ui_panel_acceptance_dispatch',batchSha256:batch.sha256,planSha256:entry.planSha256,authorizationSha256,automaticRetries:0}),{flag:'wx'});}catch(e){if(e.code==='EEXIST'){results.push({id:entry.id,status:'EXISTING_NO_RETRY',directory:rawDirectory});return;}throw e;}
  const result=await runCommand(root,entry.kind==='sdk-settings'?'settings-model.mjs':'action-model.mjs',['run','--package',entry.packageDirectory,'--plan',join(base,'plan.json'),'--authorize',entry.planSha256,'--aliases',join(base,'aliases.json'),'--contracts',join(base,'contracts')]);
  const detail=output(result),record={id:entry.id,status:detail.status??'FAILED',code:detail.code??result.code??null,directory:detail.directory??rawDirectory,exitCode:result.exitCode,automaticRetries:0};
  await writeFile(join(dispatches,entry.id+'.result.json'),json(record),{flag:'wx'});results.push(record);
 };
 let next=0;await Promise.all(Array.from({length:maxConcurrency},async()=>{while(next<batch.cases.length){const entry=batch.cases[next++];try{await execute(entry);}catch(e){results.push({id:entry.id,status:'FAILED_LOCAL_NO_RETRY',code:e.code??'ACCEPTANCE_LOCAL_FAILED'});}}}));
 return {status:'FINISHED',batchSha256:batch.sha256,results};
}
export async function originalRun(root,directory,entry){
 const resultPath=join(directory,'dispatches',entry.id+'.result.json');
 if(await exists(resultPath)){const result=JSON.parse(await readFile(resultPath));const expected=join(root,'work/panels',entry.kind==='sdk-settings'?'model-runs':'action-model-runs','intent-'+entry.planSha256);if(resolve(result.directory)!==resolve(expected))fail('ACCEPTANCE_RESULT_PATH');return expected;}
 return join(root,'work/panels',entry.kind==='sdk-settings'?'model-runs':'action-model-runs','intent-'+entry.planSha256);
}
