import {readFile,writeFile,mkdir,lstat,readdir,unlink} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,json,readSafe,noLinks,bindingsOf} from '../skins/package.mjs';
import {defaults} from '../contracts/build.mjs';
import {readContracts} from '../contracts/validate.mjs';

export {hash,json,readSafe,noLinks,defaults,readContracts,bindingsOf};
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const work=join(root,'work'),digest=/^[a-f0-9]{64}$/;
export const maximumBytes=32*1024*1024;
export function fail(code){throw Object.assign(Error('reference.'+code),{code:'reference.'+code});}
export function requireThat(value,code){if(!value)fail(code);}
export function exact(value,keys,code='record-fields'){
 requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort()),code);
}
export const seal=value=>({...value,sha256:hash(json(value))});
export function unseal(record,kind){
 requireThat(record?.kind===kind&&record.version==='1.0'&&digest.test(record.sha256??''),'record-integrity');
 const {sha256,...value}=record;requireThat(hash(json(value))===sha256,'record-integrity');return record;
}
export function text(value,limit,code){requireThat(typeof value==='string'&&value.trim().length>0&&value.length<=limit,code);return value;}
export async function withinWork(value){
 requireThat(typeof value==='string'&&value.length>0,'output-path');
 const path=resolve(value),part=relative(work,path);
 requireThat(part!==''&&!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep),'output-path');
 await noLinks(path);return path;
}
export async function inputBytes(path,limit=maximumBytes){
 requireThat(typeof path==='string'&&path.length>0,'input-path');await noLinks(path);
 const stat=await lstat(path);requireThat(stat.isFile()&&stat.size>0&&stat.size<=limit,'input-file');return readFile(path);
}
export async function optional(directory,file){try{return await readSafe(directory,file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function record(directory,file,kind){const bytes=await readSafe(directory,file);let value;try{value=JSON.parse(bytes);}catch{fail('record-json');}unseal(value,kind);return {bytes,value};}
export async function emit(directory,file,bytes){await noLinks(directory);await mkdir(join(directory,file,'..'),{recursive:true});await noLinks(join(directory,file));await writeFile(join(directory,file),bytes,{flag:'wx'});}
export async function sameOrNew(directory,file,bytes){
 try{await emit(directory,file,bytes);}catch(error){if(error.code!=='EEXIST')throw error;requireThat((await readSafe(directory,file)).equals(Buffer.from(bytes)),'artifact-changed');}
}
export function attemptDirectory(planSha256){requireThat(digest.test(planSha256??''),'plan-digest');return join(work,'reference-attempts',planSha256);}
export async function toolIdentity(){
 const files=['package-lock.json','schemas/skin-style.schema.json','schemas/skin-template-set.schema.json','schemas/component-registry.schema.json','schemas/skin-usage.schema.json'];
 for(const dir of ['src/reference-generation','src/skins','src/contracts','src/templates'])for(const f of await readdir(join(root,dir)))if(f.endsWith('.mjs'))files.push(dir+'/'+f);
 const inputs=[];for(const file of files.sort())inputs.push({file,sha256:hash(await readFile(join(root,file)))});
 return {sha256:hash(json(inputs)),files:inputs};
}
export async function assertNotActive(directory){
 const bytes=await optional(directory,'active.lock');if(!bytes)return;
 let lock;try{lock=JSON.parse(bytes);}catch{fail('active-lock-invalid');}
 requireThat(Number.isInteger(lock.pid)&&lock.pid>0&&typeof lock.nonce==='string','active-lock-invalid');
 try{process.kill(lock.pid,0);fail('attempt-active');}catch(error){if(error.code!=='ESRCH')throw error;}
 // Only a demonstrably dead owner may leave an interrupted local reception.
 requireThat((await readSafe(directory,'active.lock')).equals(bytes),'active-lock-changed');await unlink(join(directory,'active.lock'));
}
