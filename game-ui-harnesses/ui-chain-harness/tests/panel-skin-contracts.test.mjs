import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {hash,json,bindingsOf} from '../src/skins/package.mjs';
import {panelSkinContracts,snapshotPanelContracts} from '../src/panel/skin-contracts.mjs';
import {editorData} from '../src/panel/data.mjs';
const keys=['registry','usage','template'],names={registry:'component-registry.draft.json',usage:'skin-usage.draft.json',template:'skin-template-set.draft.json'};
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'panel-contracts-'));
 try{
  const current=await readContracts(defaults),old=structuredClone(current.registry);old.revision++;
  const bytes={...current.bytes,registry:Buffer.from(json(old)+'\n')},inputFiles=[],paths={};
  await mkdir(join(root,'configs'));await mkdir(join(root,'work/task/inputs'),{recursive:true});
  for(const key of keys){
   paths[key]=join(root,'configs',names[key]);await writeFile(paths[key],current.bytes[key]);
   const file='work/task/inputs/'+key+'.json';await writeFile(join(root,file),bytes[key]);inputFiles.push({file,sha256:hash(bytes[key])});
  }
  const pack={sourceKind:'imported',bindings:Object.fromEntries(keys.map(k=>[k+'Sha256',hash(bytes[k])]))};
  await fn({root,current,old,bytes,paths,inputFiles,pack,directory:join(root,'snapshot')});
 }finally{await rm(root,{recursive:true,force:true});}
}
test('a previous skin freezes exact contract bytes and ignores later current-config changes',async()=>fixture(async f=>{
 await assert.rejects(panelSkinContracts(f.pack,undefined,{paths:f.paths}),{code:'SKIN_BINDINGS_CHANGED'});
 await snapshotPanelContracts(f);
 for(const k of keys)assert.deepEqual(await readFile(join(f.directory,k+'.json')),f.bytes[k]);
 const loaded=await panelSkinContracts(f.pack,f.directory);assert.deepEqual(bindingsOf(loaded),f.pack.bindings);
 assert.equal((await editorData(loaded)).registry.revision,f.old.revision);
 await writeFile(f.paths.registry,'changed current registry');
 assert.equal((await panelSkinContracts(f.pack,f.directory)).registry.revision,f.old.revision);
 await assert.rejects(snapshotPanelContracts(f),{code:'EEXIST'});
}));
test('matching current contracts can be frozen without generation evidence',async()=>fixture(async f=>{
 const pack={sourceKind:'imported',bindings:bindingsOf(f.current)};
 await snapshotPanelContracts({...f,pack,inputFiles:[]});
 assert.deepEqual(bindingsOf(await panelSkinContracts(pack,f.directory)),pack.bindings);
}));
test('clarification copies the parent snapshot after original source files are removed',async()=>fixture(async f=>{
 await snapshotPanelContracts(f);await rm(join(f.root,'work'),{recursive:true});
 const next=join(f.root,'next');await snapshotPanelContracts({...f,directory:next,sourceDirectory:f.directory});
 assert.deepEqual(bindingsOf(await panelSkinContracts(f.pack,next)),f.pack.bindings);
 await writeFile(join(f.directory,'registry.json'),json(f.old));
 await assert.rejects(snapshotPanelContracts({...f,directory:join(f.root,'tampered-parent'),sourceDirectory:f.directory}),{code:'SKIN_BINDINGS_CHANGED'});
}));
test('changed bytes, missing evidence and a different skin binding cannot bypass validation',async()=>fixture(async f=>{
 await assert.rejects(snapshotPanelContracts({...f,inputFiles:[]}),/CONTRACTS/);
 await snapshotPanelContracts(f);
 await writeFile(join(f.directory,'registry.json'),json(f.old));
 await assert.rejects(panelSkinContracts(f.pack,f.directory),{code:'SKIN_BINDINGS_CHANGED'});
 await assert.rejects(panelSkinContracts({...f.pack,sourceKind:'fixture'},f.directory),{code:'SKIN_BINDINGS_CHANGED'});
}));
