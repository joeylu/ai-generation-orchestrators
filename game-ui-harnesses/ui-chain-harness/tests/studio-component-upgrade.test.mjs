import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash,json} from '../src/skins/package.mjs';
import {upgradedConsumer,frozenUpgradeContracts} from '../src/studio/component-upgrade.mjs';

test('runtime upgrades select complete frozen contracts by exact original skin digests',()=>{
 const keys=['registry','usage','template'],bindings=Object.fromEntries(keys.map((k,i)=>[k+'Sha256',String(i+1).repeat(64)]));
 const inputs=keys.map(k=>({file:'work/task/input/generation/plans/frozen/inputs/'+k+'.json',sha256:bindings[k+'Sha256']}));
 const selected=frozenUpgradeContracts(inputs,bindings);
 for(const key of keys)assert.equal(selected[key],inputs.find(f=>f.file.endsWith('/'+key+'.json')).file);
 assert.throws(()=>frozenUpgradeContracts(inputs.slice(1),bindings),/CONTRACTS/);
 assert.throws(()=>frozenUpgradeContracts(inputs.map(f=>({...f,sha256:'0'.repeat(64)})),bindings),/CONTRACTS/);
 assert.throws(()=>frozenUpgradeContracts(inputs.map(f=>({...f,file:'work/../private/inputs/registry.json'})),bindings),/CONTRACTS/);
});

test('runtime selection requires unchanged source, same skin and a check bound to the new consumer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-upgrade-')),skinSha256='a'.repeat(64);
 try{
  const consumer=async(name)=>{const dir=join(root,'work',name);await mkdir(dir,{recursive:true});const files=[];for(const file of ['index.html','runtime.mjs','kit.json']){const data=Buffer.from(name+' '+file);await writeFile(join(dir,file),data);files.push({file,sha256:hash(data)});}const bytes=Buffer.from(json({kind:'ui_component_consumer_candidate',version:'0.1',components:16,manifestSha256:skinSha256,files}));await writeFile(join(dir,'manifest.json'),bytes);return {dir,sha256:hash(bytes)};};
  const old=await consumer('old'),next=await consumer('new');
  await mkdir(join(root,'work/revision'),{recursive:true});
  const record={kind:'ui_component_runtime_upgrade',version:'1.0',directory:'work/new',sourceConsumerSha256:old.sha256,skinSha256,consumerSha256:next.sha256,checkFile:'work/revision/checks.json',modelCalls:0};
  const report={kind:'ui_consumer_relocation_check',status:'passed',manifestSha256:next.sha256,sourceSkinSha256:skinSha256,components:16,publicFactory:'passed',results:[{status:'passed'}],errors:[]};
  const save=async()=>{const checks=Buffer.from(json(report));await writeFile(join(root,record.checkFile),checks);record.checkSha256=hash(checks);const bytes=Buffer.from(json(record));await writeFile(join(root,'work/revision/upgrade.json'),bytes);return {file:'work/revision/upgrade.json',sha256:hash(bytes)};};
  const options={verifySkin:async()=>({manifestSha256:skinSha256})};
  assert.deepEqual(await upgradedConsumer(root,old.dir,null),{directory:old.dir});
  let selection=await save();assert.deepEqual(await upgradedConsumer(root,old.dir,selection,options),{directory:next.dir,consumerSha256:next.sha256});
  await assert.rejects(()=>upgradedConsumer(root,old.dir,{...selection,file:'work/../private.json'},options),/REFERENCE/);
  await assert.rejects(()=>upgradedConsumer(root,old.dir,{...selection,sha256:'b'.repeat(64)},options),/CHANGED/);
  record.sourceConsumerSha256='b'.repeat(64);selection=await save();await assert.rejects(()=>upgradedConsumer(root,old.dir,selection,options),/SOURCE/);record.sourceConsumerSha256=old.sha256;
  for(const mutate of [r=>r.status='failed',r=>r.results[0].status='failed',r=>r.manifestSha256=old.sha256,r=>r.sourceSkinSha256='b'.repeat(64),r=>r.publicFactory='failed',r=>r.errors.push('runtime failure')]){
   const original=structuredClone(report);mutate(report);selection=await save();await assert.rejects(()=>upgradedConsumer(root,old.dir,selection,options),/CHECK/);Object.assign(report,original);
  }
  selection=await save();await assert.rejects(()=>upgradedConsumer(root,old.dir,selection,{verifySkin:async()=>({manifestSha256:'b'.repeat(64)})}),/SKIN/);
  await writeFile(join(next.dir,'runtime.mjs'),'corrupt');await assert.rejects(()=>upgradedConsumer(root,old.dir,selection,options),/FILE_CHANGED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
