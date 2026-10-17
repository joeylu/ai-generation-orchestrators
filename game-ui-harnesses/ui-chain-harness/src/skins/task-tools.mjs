import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {inventory} from './workflow.mjs';
import {hash,json} from './package.mjs';
export async function taskToolIdentity(root){
 const list=[];
 for(const dir of ['src','scripts','configs','schemas','fixtures','tests/runtime','tools/panel-slicer/src'])for(const f of await inventory(join(root,dir)))list.push({...f,file:dir+'/'+f.file});
 list.push({file:'package-lock.json',sha256:hash(await readFile(join(root,'package-lock.json')))});
 return hash(Buffer.from(json(list)));
}
