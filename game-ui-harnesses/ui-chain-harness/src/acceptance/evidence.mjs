import {readFile,readdir} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {hash,json,readSafe,verifySkinPackage} from '../skins/package.mjs';
import {panelSkinContracts} from '../panel/skin-contracts.mjs';
export const fail=code=>{throw Object.assign(Error(code),{code});};
export function contained(root,value){const path=resolve(value),r=relative(resolve(root),path);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))fail('ACCEPTANCE_PATH');return path;}
export async function sourceIdentity(root){
 const files=[];
 for(const top of ['src','scripts','configs','prompts','schemas','fixtures']){
  const walk=async dir=>{for(const entry of (await readdir(join(root,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=dir+'/'+entry.name;if(entry.isSymbolicLink())fail('ACCEPTANCE_SOURCE_LINK');if(entry.isDirectory())await walk(name);else if(entry.isFile())files.push({file:name,sha256:hash(await readFile(join(root,name)))});}};
  await walk(top);
 }
 for(const file of ['package.json','package-lock.json'])files.push({file,sha256:hash(await readFile(join(root,file)))});
 const runtime=process.version;return {sha256:hash(Buffer.from(json({runtime,files}))),runtime,files};
}
export async function verifyBatch(directory){
 const bytes=await readSafe(directory,'batch.json'),batch=JSON.parse(bytes),{sha256,...body}=batch;
 if(batch.kind!=='ui_panel_acceptance_batch'||batch.version!=='1.0'||sha256!==hash(Buffer.from(json(body))))fail('ACCEPTANCE_BATCH_CHANGED');
 for(const entry of batch.files)if(hash(await readSafe(directory,entry.file))!==entry.sha256)fail('ACCEPTANCE_INPUT_CHANGED');
 return batch;
}
export async function caseInputs(directory,entry){
 const base=contained(directory,join(directory,entry.directory)),bundle=JSON.parse(await readSafe(base,'plan.json'));
 if(bundle.plan?.sha256!==entry.planSha256||bundle.consumer?.skinSha256!==entry.skinSha256)fail('ACCEPTANCE_PLAN_CHANGED');
 const verified=await verifySkinPackage(entry.packageDirectory);
 if(verified.manifestSha256!==entry.skinSha256)fail('ACCEPTANCE_SKIN_CHANGED');
 const contracts=await panelSkinContracts(verified.pack,join(base,'contracts'));
 return {base,bundle,verified,contracts,aliases:JSON.parse(await readSafe(base,'aliases.json')),expected:JSON.parse(await readSafe(base,'expected.json'))};
}
export async function rawEvidence(directory,plan){
 const names=['plan.json','receipt.json','response.txt','intent.json','dispatch.json'],values=await Promise.all(names.map(name=>readSafe(directory,name))),[saved,receipt,raw,intent]=[JSON.parse(values[0]),JSON.parse(values[1]),values[2],JSON.parse(values[3])],dispatch=JSON.parse(values[4]);
 if(dispatch.kind!=='ui_panel_intent_dispatch'||dispatch.version!=='1.0'||dispatch.planSha256!==plan.sha256||dispatch.automaticRetries!==0||Object.keys(dispatch).sort().join('|')!=='automaticRetries|kind|planSha256|version')fail('ACCEPTANCE_DISPATCH_INVALID');
 if(!isDeepStrictEqual(saved,plan)||receipt.status!=='RESPONSE_RECEIVED'||receipt.planSha256!==plan.sha256||receipt.contextSha256!==plan.session.context.sha256||receipt.model!==plan.model||receipt.effort!==plan.effort||receipt.invocationCount!==1||receipt.automaticRetries!==0||receipt.failureCode!==null||receipt.responseSha256!==hash(raw))fail('ACCEPTANCE_RECEIPT_INVALID');
 let parsed;try{parsed=JSON.parse(raw);}catch{fail('ACCEPTANCE_RESPONSE_INVALID');}
 if(!isDeepStrictEqual(parsed,intent))fail('ACCEPTANCE_RESPONSE_CHANGED');
 return {intent,receipt,files:names.map((file,i)=>({file,bytes:values[i],sha256:hash(values[i])}))};
}
