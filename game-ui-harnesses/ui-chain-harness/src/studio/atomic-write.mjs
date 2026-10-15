import {writeFile,rename} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {json} from '../skins/package.mjs';

// Windows readers and scanners can briefly deny rename-over-existing. Retry only
// the same local replacement; never delete the committed file or repeat compute.
export async function replaceCommittedFile(source,target,{replace=rename,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=6}={}){
 for(let attempt=0;;attempt++){
  try{await replace(source,target);return;}
  catch(error){
   if(attempt+1>=attempts||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
   await pause(Math.min(25*2**attempt,200));
  }
 }
}

export async function writeStudioJson(file,value,options){
 const temporary=join(dirname(file),'.'+basename(file)+'-'+randomUUID()+'.tmp');
 await writeFile(temporary,json(value),{flag:'wx'});
 await replaceCommittedFile(temporary,file,options);
}
