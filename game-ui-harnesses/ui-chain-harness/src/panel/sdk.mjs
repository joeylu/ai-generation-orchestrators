import {readFile,writeFile,mkdir,rename,readdir,lstat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hash,json,readSafe,noLinks} from '../skins/package.mjs';
import {verifySdkArchive,sdkPath} from './sdk-archive.mjs';
export const panelSdkRoot=fileURLToPath(new URL('../../',import.meta.url));
const exportsMap={'.':'./src/index.mjs',sdk:'./src/sdk.mjs','planning/v1':'./src/planning-api-v1.mjs','planning/codex/v1':'./src/planning-codex-v1.mjs'};
const fail=(message,code='panel.sdk-integrity')=>{throw Object.assign(Error(message),{code});};
export async function readPanelSdkLock(root=panelSdkRoot){
 const lock=JSON.parse(await readSafe(root,'configs/panel-sdk-lock.json',128*1024));
 const base=lock.repository+'/releases/download/'+lock.tag+'/';
 if(lock.kind!=='ui_panel_sdk_lock'||lock.version!=='1.0'||lock.name!=='ai-ui-panel-harness'||!/^0\.1\.0-rc\.[1-9][0-9]*$/.test(lock.packageVersion)||lock.tag!=='ui-panel-harness-v'+lock.packageVersion||lock.repository!=='https://github.com/joeylu/ai-generation-orchestrators'||!/^[a-f0-9]{40}$/.test(lock.commit)||![lock.archive,lock.receipt,lock.checksums,lock.manifest].every(r=>r&&sdkPath(r.file)&&!r.file.includes('/')&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=64*1024*1024&&/^[a-f0-9]{64}$/.test(r.sha256))||[lock.archive,lock.receipt,lock.checksums].some(r=>r.url!==base+r.file)||!Number.isInteger(lock.packageFiles)||lock.packageFiles!==lock.manifest.files+2)fail('Invalid Panel SDK lock.');
 return lock;
}
export const panelSdkDirectory=(root,lock)=>join(root,'work/dependencies/panel-sdk',lock.archive.sha256);
async function walk(directory,prefix=''){
 const files=[];for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){
  const file=prefix+entry.name;if(entry.isSymbolicLink())fail('Panel SDK contains a symbolic link.');
  if(entry.isDirectory())files.push(...await walk(directory,file+'/'));else if(entry.isFile())files.push(file);else fail('Panel SDK contains a non-regular file.');
 }return files;
}
async function verifyDirectory(directory,lock){
 const [archive,receipt,checksums]=await Promise.all([readSafe(directory,lock.archive.file),readSafe(directory,lock.receipt.file),readSafe(directory,lock.checksums.file)]),verified=verifySdkArchive({archive,receipt,checksums,lock}),packageDirectory=join(directory,'package');
 const names=await walk(packageDirectory);if(names.length!==verified.files.size||names.some(name=>!verified.files.has(name)))fail('Installed SDK file inventory differs.');
 for(const [name,expected]of verified.files)if(!(await readSafe(packageDirectory,name)).equals(expected))fail('Installed SDK file differs: '+name);
 for(const [api,path]of Object.entries(exportsMap))if(verified.package.exports?.[api==='.'?'.':'./'+api]!==path||!verified.files.has(path.slice(2)))fail('Locked SDK public export differs: '+api);
 return {...verified,lock,directory,packageDirectory,mode:'locked',archiveSha256:lock.archive.sha256,manifestSha256:lock.manifest.sha256,sourceCommit:lock.commit};
}
export async function verifyPanelSdkInstall({root=panelSdkRoot,lock}={}){
 lock??=await readPanelSdkLock(root);
 try{return await verifyDirectory(panelSdkDirectory(root,lock),lock);}catch(error){if(error.code==='ENOENT')fail('Panel SDK is not installed. Run: node scripts/panel-sdk.mjs install --download','panel.sdk-not-installed');throw error;}
}
/** Caller explicitly authorizes setup/download; installation itself runs no hooks. */
export async function installPanelSdk({root=panelSdkRoot,lock,archive,receipt,checksums}){
 lock??=await readPanelSdkLock(root);const verified=verifySdkArchive({archive,receipt,checksums,lock}),directory=panelSdkDirectory(root,lock);
 await noLinks(directory);try{await lstat(directory);return verifyDirectory(directory,lock);}catch(error){if(error.code!=='ENOENT')throw error;}
 const staging=directory+'.installing-'+randomUUID();await mkdir(staging,{recursive:true});
 for(const [name,bytes]of [[lock.archive.file,archive],[lock.receipt.file,receipt],[lock.checksums.file,checksums],...[...verified.files].map(([name,bytes])=>['package/'+name,bytes])]){
  const file=join(staging,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});
 }
 await writeFile(join(staging,'installation.json'),json({kind:'ui_panel_sdk_installation',version:'1.0',mode:'locked',archiveSha256:lock.archive.sha256,manifestSha256:lock.manifest.sha256,sourceCommit:lock.commit,files:verified.files.size,modelCalls:0}),{flag:'wx'});
 await verifyDirectory(staging,lock);
 try{await rename(staging,directory);}catch(error){if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;return verifyDirectory(directory,lock);}
 return verifyDirectory(directory,lock);
}
/** The only Chain entry to Panel code/data. Development is an explicit opt-in. */
export function createPanelSdkLoader({root=panelSdkRoot,mode=process.env.UI_CHAIN_PANEL_SDK_MODE??'locked',lock}={}){
 if(!['locked','development'].includes(mode))fail('Panel SDK mode must be locked or development.','panel.sdk-mode');
 let installed;const modules=new Map(),verified=()=>installed??=verifyPanelSdkInstall({root,lock}).catch(error=>{installed=null;throw error;});
 const sourceRoot=resolve(root,'../ui-panel-harness');
 return {
  mode,
  async identity(){if(mode==='development')return {mode,productionReady:false};const sdk=await verified();return {mode,archiveSha256:sdk.archiveSha256,manifestSha256:sdk.manifestSha256,sourceCommit:sdk.sourceCommit};},
  async api(subpath){
   const path=exportsMap[subpath];if(!path)fail('Unsupported Panel SDK public export.','panel.sdk-export');
   if(!modules.has(subpath))modules.set(subpath,(async()=>{
    let directory=sourceRoot;
    if(mode==='locked'){const sdk=await verified();directory=(await verifyDirectory(sdk.directory,sdk.lock)).packageDirectory;}
    return import(pathToFileURL(join(directory,path.slice(2))).href);
   })().catch(error=>{modules.delete(subpath);throw error;}));
   return modules.get(subpath);
  },
  async json(file){
   if(!sdkPath(file)||!file.endsWith('.json')||!['catalog/','examples/'].some(prefix=>file.startsWith(prefix)))fail('Only published Panel catalog/example JSON resources are supported.','panel.sdk-resource');
   if(mode==='development')return JSON.parse(await readSafe(sourceRoot,file));
   const sdk=await verified(),expected=sdk.files.get(file);if(!expected)fail('Panel JSON resource is not in the locked release.','panel.sdk-resource');
   const bytes=await readSafe(sdk.packageDirectory,file);if(!bytes.equals(expected))fail('Published Panel JSON resource changed.');return JSON.parse(bytes);
  }
 };
}
let current;
const loader=()=>current??=createPanelSdkLoader();
export const loadPanelSdkApi=subpath=>loader().api(subpath);
export const readPanelSdkJson=file=>loader().json(file);
export const panelSdkIdentity=()=>loader().identity();
