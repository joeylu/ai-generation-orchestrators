import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {hash,json} from '../src/skins/package.mjs';
import {localGeneration} from '../src/studio/generation.mjs';
import {discoverPlans} from '../src/studio/history.mjs';

async function fixture(t,{invalidContracts=false,mixedBindings=false}={}){
 const root=await mkdtemp(join(tmpdir(),'studio-generation-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const projectId=randomUUID(),project='work/studio/projects/'+projectId,skinDirectory=join(root,project);
 const put=async(file,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(json(value));await mkdir(join(skinDirectory,file,'..'),{recursive:true});await writeFile(join(skinDirectory,file),bytes);return hash(bytes);};
 const inputs=await readContracts(defaults),frozen=Object.fromEntries(['registry','usage','template'].map(key=>[key,structuredClone(inputs[key])]));
 // A valid archived revision deliberately differs from the active source.
 frozen.template.revision+=100;frozen.usage.templateRef.revision=frozen.template.revision;
 if(invalidContracts)frozen.template.sheets[0].parts[0].bodyRect[2]=0;
 const bytes=Object.fromEntries(Object.entries(frozen).map(([key,value])=>[key,Buffer.from(json(value))]));
 const bindings=Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key+'Sha256',hash(value)]));
 const reference=Buffer.from('fixture reference'),style=Buffer.from('fixture style'),plans=[];
 await put('project.json',{name:'Original completed skin'});await put('reference.png',reference);
 for(const [index,sheet]of frozen.template.sheets.entries()){
  const resources=new Map([['reference.png',reference],['inputs/style.json',style],...Object.entries(bytes).map(([key,value])=>['inputs/'+key+'.json',value])]);
  const plan={kind:'ui_skin_generation_plan',version:'0.1',computeAuthorized:false,sheetId:sheet.id,assetCount:sheet.parts.length,bindings:{...bindings,...(mixedBindings&&index===1?{registrySha256:'0'.repeat(64)}:{})},tool:{sha256:'0'.repeat(64)},resources:[...resources].map(([file,value])=>({file,bytes:value.length,sha256:hash(value)}))};
  const sha256=hash(json(plan)),prefix='plans/'+sha256+'/';plans.push({sheetId:sheet.id,assets:sheet.parts.length,sha256});
  await put(prefix+'plan.json',plan);for(const [file,value]of resources)await put(prefix+file,value);
  const attempt='attempts/'+sha256+'/',reservationSha256=await put(attempt+'reservation.json',{kind:'ui_skin_external_attempt_reservation',version:'0.1',planSha256:sha256,authorization:{consumed:true,maxSubmissions:1},automaticRetry:false});
  const raw=Buffer.from('retained raw '+sheet.id),rawSha256=await put(attempt+'raw.png',raw);await put(attempt+'receive.claim',{rawSha256,bytes:raw.length});
  const status='pixel-gates-passed-awaiting-visual-review',inspectionSha256=await put(attempt+'inspection.json',{kind:'ui_skin_pilot_inspection',planSha256:sha256,rawSha256,status,issues:[]});
  await put(attempt+'receipt.json',{kind:'ui_skin_external_attempt_receipt',version:'0.1',state:'received',planSha256:sha256,reservationSha256,raw:{file:'raw.png',sha256:rawSha256,bytes:raw.length},inspection:{file:'inspection.json',sha256:inspectionSha256,status},automaticRetry:false});
 }
 const batch={kind:'ui_skin_generation_batch',version:'0.1',computeAuthorized:false,referenceSha256:hash(reference),styleSha256:hash(style),plans,assetCount:plans.reduce((sum,plan)=>sum+plan.assets,0)},batchSha256=hash(json(batch));await put('batches/'+batchSha256+'/batch.json',batch);
 const plan={directory:project+'/batches/'+batchSha256,batchSha256,sheets:plans,assets:batch.assetCount},generation=localGeneration(root,{files:new Map()}),id=generation.register(plan);
 return {root,projectId,skinDirectory,put,plans,plan,generation,id};
}

test('historical completed batches remain readable under frozen contracts without acquiring active freshness',async t=>{
 const f=await fixture(t),status=await f.generation.action('status',{id:f.id});
 assert.equal(status.fresh,false);assert.equal(status.nodes.length,4);assert(status.nodes.every(node=>node.status==='received'));
 const history=await discoverPlans(f.root,f.generation);assert.equal(history.plans.length,1);assert.equal(history.plans[0].status,'readable');assert.equal(history.plans[0].current,false);
 await assert.rejects(f.generation.action('preflight',{id:f.id}),/plan-binding/);
 await assert.rejects(access(join(f.root,f.plan.directory,'authorization.json')),{code:'ENOENT'});
 assert((await f.generation.action('status',{id:f.id})).nodes.every(node=>node.status==='received'));
});

test('historical status rejects changed frozen contract bytes instead of relabeling the archive',async t=>{
 const f=await fixture(t);await f.put('plans/'+f.plans[0].sha256+'/inputs/template.json',Buffer.from('{}'));
 await assert.rejects(f.generation.action('status',{id:f.id}),/GENERATION_ARCHIVE_CONTRACTS/);
 assert.equal((await discoverPlans(f.root,f.generation)).plans[0].status,'invalid');
});

test('historical status rejects inconsistent contract bindings between sibling sheets',async t=>{
 const f=await fixture(t,{mixedBindings:true});await assert.rejects(f.generation.action('status',{id:f.id}),/GENERATION_ARCHIVE_CONTRACTS/);
});

test('historical status validates frozen contracts even when all recorded hashes match',async t=>{
 const f=await fixture(t,{invalidContracts:true});await assert.rejects(f.generation.action('status',{id:f.id}),/GENERATION_ARCHIVE_CONTRACTS/);
});
