import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readContracts} from '../contracts/validate.mjs';
import {defaults} from '../contracts/build.mjs';
import {bindingsOf,hash,readSafe} from '../skins/package.mjs';
import {frozenContractPaths} from '../contracts/frozen.mjs';

const keys=['registry','usage','template'];
const names={registry:'component-registry.draft.json',usage:'skin-usage.draft.json',template:'skin-template-set.draft.json'};
const inDirectory=directory=>Object.fromEntries(keys.map(k=>[k,join(resolve(directory),k+'.json')]));
const matches=(pack,bindings)=>keys.every(k=>pack.bindings?.[k+'Sha256']===bindings[k+'Sha256']);
const fail=()=>{throw Object.assign(Error('SKIN_BINDINGS_CHANGED'),{code:'SKIN_BINDINGS_CHANGED'});};

// Validate the exact original bytes on every prepare/run/preview. A skin digest
// already binds these contract digests into the immutable model consumer plan.
export async function panelSkinContracts(pack,directory,{paths=defaults}={}){
  const inputs=await readContracts(directory?inDirectory(directory):paths);
  if(pack.sourceKind!=='imported'||!matches(pack,bindingsOf(inputs)))fail();
  return inputs;
}

// Freeze a new per-panel copy. Sources are either a parent's verified snapshot,
// matching current files, or the completed task's digest-bound original inputs.
export async function snapshotPanelContracts({root,pack,inputFiles=[],directory,sourceDirectory}){
  let paths;
  if(sourceDirectory)paths=inDirectory(sourceDirectory);
  else{
    const current=Object.fromEntries(keys.map(k=>[k,join(root,'configs',names[k])]));
    const bindings=Object.fromEntries(await Promise.all(keys.map(async k=>[k+'Sha256',hash(await readSafe(root,'configs/'+names[k]))])));
    paths=matches(pack,bindings)?current:Object.fromEntries(Object.entries(frozenContractPaths(inputFiles,pack.bindings)).map(([k,file])=>[k,join(root,file)]));
  }
  const inputs=await panelSkinContracts(pack,undefined,{paths});
  await mkdir(directory);
  for(const key of keys)await writeFile(join(directory,key+'.json'),inputs.bytes[key],{flag:'wx'});
  await panelSkinContracts(pack,directory);
  return directory;
}
