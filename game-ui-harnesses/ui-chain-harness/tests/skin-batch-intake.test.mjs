import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash,json} from '../src/skins/package.mjs';
import {inspectGenerationBatch} from '../src/skin-generation/batch-intake.mjs';

async function fixture(t,received=4){
  const skinDirectory=await mkdtemp(join(tmpdir(),'skin-batch-'));t.after(()=>rm(skinDirectory,{recursive:true,force:true}));
  const put=async(file,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(json(value));await mkdir(join(skinDirectory,file,'..'),{recursive:true});await writeFile(join(skinDirectory,file),bytes);return hash(bytes);};
  const ref=Buffer.from('reference'),style=Buffer.from('style'),templateSha256=hash('template'),sheets=[],plans=[];
  for(let i=1;i<=4;i++){
    const sheetId='S0'+i;sheets.push({id:sheetId,parts:[{}]});
    const resources=[{file:'reference.png',bytes:ref.length,sha256:hash(ref)},{file:'inputs/style.json',bytes:style.length,sha256:hash(style)}];
    const plan={kind:'ui_skin_generation_plan',version:'0.1',sheetId,assetCount:1,bindings:{templateSha256},resources},sha256=hash(json(plan));
    plans.push({sheetId,assets:1,sha256});await put('plans/'+sha256+'/plan.json',plan);await put('plans/'+sha256+'/reference.png',ref);await put('plans/'+sha256+'/inputs/style.json',style);
    if(i>received)continue;
    const a='attempts/'+sha256+'/',reservationSha256=await put(a+'reservation.json',{kind:'ui_skin_external_attempt_reservation',version:'0.1',planSha256:sha256,authorization:{consumed:true,maxSubmissions:1},automaticRetry:false});
    const raw=Buffer.from('fixture-raw-'+i),rawSha256=await put(a+'raw.png',raw);
    await put(a+'receive.claim',{rawSha256,bytes:raw.length});
    const inspectionSha=await put(a+'inspection.json',{kind:'ui_skin_pilot_inspection',planSha256:sha256,rawSha256,status:'rejected',issues:[{code:'dimensions'}]});
    await put(a+'receipt.json',{kind:'ui_skin_external_attempt_receipt',version:'0.1',planSha256:sha256,reservationSha256,state:'received',raw:{file:'raw.png',sha256:rawSha256,bytes:raw.length},inspection:{file:'inspection.json',sha256:inspectionSha,status:'rejected'},automaticRetry:false});
  }
  const batch={kind:'ui_skin_generation_batch',version:'0.1',computeAuthorized:false,referenceSha256:hash(ref),styleSha256:hash(style),plans,assetCount:4},batchSha256=hash(json(batch));
  await put('batches/'+batchSha256+'/batch.json',batch);
  return {args:{skinDirectory,batchSha256,templateSha256,sheets},put,plans,batch};
}
test('four immutable receipts retain rejected status and exact raw bytes',async t=>{
  const f=await fixture(t),r=await inspectGenerationBatch(f.args);
  assert.equal(r.summary.status,'received-awaiting-localization');assert.equal(r.summary.originalChecksPassed,false);assert.equal(r.sources.length,4);
  assert.equal(r.summary.automaticProviderCalls,false);assert.equal(r.summary.nodes[0].inspection,'rejected');
});
test('missing sheet waits; a reservation without receipt is indeterminate, not resumable compute',async t=>{
  const f=await fixture(t,3);let r=await inspectGenerationBatch(f.args);assert.equal(r.summary.status,'awaiting-authorization');assert.equal(r.sources.length,3);
  const p=f.plans[3];await f.put('attempts/'+p.sha256+'/reservation.json',{kind:'ui_skin_external_attempt_reservation',version:'0.1',planSha256:p.sha256,authorization:{consumed:true,maxSubmissions:1},automaticRetry:false});
  r=await inspectGenerationBatch(f.args);assert.equal(r.summary.status,'indeterminate');assert.equal(r.summary.nodes[3].automaticRetry,false);
});
test('tampered raw, frozen input, and receipt binding are rejected',async t=>{
  for(const target of ['raw','resource','receipt']){
    const f=await fixture(t),p=f.plans[0],a='attempts/'+p.sha256+'/';
    if(target==='raw')await f.put(a+'raw.png',Buffer.from('changed'));
    if(target==='resource')await f.put('plans/'+p.sha256+'/reference.png',Buffer.from('changed'));
    if(target==='receipt'){const r=JSON.parse(await readFile(join(f.args.skinDirectory,a,'receipt.json')));r.reservationSha256='0'.repeat(64);await f.put(a+'receipt.json',r);}
    await assert.rejects(inspectGenerationBatch(f.args),/batch-intake\./);
  }
});
test('wrong template and duplicate/missing sheet coverage block intake',async t=>{
  const f=await fixture(t);await assert.rejects(inspectGenerationBatch({...f.args,templateSha256:hash('other')}),/plan-binding/);
  f.batch.plans[3]=f.batch.plans[0];const digest=hash(json(f.batch));await f.put('batches/'+digest+'/batch.json',f.batch);
  await assert.rejects(inspectGenerationBatch({...f.args,batchSha256:digest}),/invalid-batch/);
});
