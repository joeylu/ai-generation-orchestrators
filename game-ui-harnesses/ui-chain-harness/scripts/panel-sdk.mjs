import {readFile,mkdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {readPanelSdkLock,panelSdkRoot,installPanelSdk,verifyPanelSdkInstall} from '../src/panel/sdk.mjs';
const exec=promisify(execFile),{positionals,values}=parseArgs({allowPositionals:true,options:{download:{type:'boolean'},archive:{type:'string'},receipt:{type:'string'},checksums:{type:'string'}}});
const summary=sdk=>({status:'verified',mode:'locked',packageDirectory:sdk.packageDirectory,archiveSha256:sdk.archiveSha256,manifestSha256:sdk.manifestSha256,sourceCommit:sdk.sourceCommit,files:sdk.files.size,modelCalls:0});
try{
 if(positionals.length!==1||!['install','verify'].includes(positionals[0]))throw Error('Use: node scripts/panel-sdk.mjs install --download | install --archive <zip> --receipt <release-receipt.json> --checksums <SHA256SUMS> | verify');
 const lock=await readPanelSdkLock();
 if(positionals[0]==='verify'){
  if(Object.keys(values).length)throw Error('Verify is read-only and takes no download/source options.');console.log(JSON.stringify(summary(await verifyPanelSdkInstall({lock})),null,2));
 }else{
  let paths;if(values.download){
   if(values.archive||values.receipt||values.checksums)throw Error('Choose official download or explicit local files.');
   const directory=join(panelSdkRoot,'work/dependencies/panel-sdk/downloads',lock.archive.sha256);await mkdir(directory,{recursive:true});
   const records=[lock.archive,lock.receipt,lock.checksums],missing=[];for(const record of records){try{await lstat(join(directory,record.file));}catch(error){if(error.code!=='ENOENT')throw error;missing.push(record.file);}}
   if(missing.length)await exec('gh',['release','download',lock.tag,'--repo','joeylu/ai-generation-orchestrators',...missing.flatMap(file=>['--pattern',file]),'--dir',directory],{windowsHide:true,maxBuffer:1024*1024});
   paths=Object.fromEntries(['archive','receipt','checksums'].map(key=>[key,join(directory,lock[key].file)]));
  }else{
   if(!values.archive||!values.receipt||!values.checksums)throw Error('Install requires --download or all three official local files.');paths=Object.fromEntries(['archive','receipt','checksums'].map(key=>[key,resolve(values[key])]));
  }
  const bytes=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,file])=>[key,await readFile(file)])));
  console.log(JSON.stringify(summary(await installPanelSdk({lock,...bytes})),null,2));
 }
}catch(error){console.error(JSON.stringify({status:'failed',code:error.code??'panel.sdk-install',message:error.message,modelCalls:0}));process.exitCode=1;}
