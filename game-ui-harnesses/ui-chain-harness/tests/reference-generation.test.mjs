import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,cp,symlink} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import * as api from '../src/reference-generation/index.mjs';
import {hash,json} from '../src/skins/package.mjs';
import {encodePng,decodePng,crc32} from '../src/skins/png.mjs';
import {buildTemplates} from '../src/templates/build.mjs';
import {defaults} from '../src/contracts/build.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),work=join(root,'work');
function png({width=256,height=256,opaque=true,blank=false}={}){
 const pixels=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;pixels[at]=blank?80:x%256;pixels[at+1]=90;pixels[at+2]=blank?80:y%256;pixels[at+3]=opaque?255:220;}return encodePng({width,height,pixels});
}
function rgbPng(){
 const chunk=(name,bytes)=>{const out=Buffer.alloc(bytes.length+12),type=Buffer.from(name);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([type,bytes])),bytes.length+8);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc(256*(256*3+1));for(let y=0;y<256;y++)for(let x=0;x<256;x++){const at=y*769+1+x*3;rows[at]=x;rows[at+1]=90;rows[at+2]=y;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Comment\0Synthetic metadata')),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function compressedRgbSubPng(){
 const width=4096,height=4096,stride=width*3,scan=Buffer.alloc((stride+1)*height);let state=123456789;
 for(let y=0;y<height;y++){
  scan[y*(stride+1)]=1;
  for(let x=0;x<width;x++)for(let channel=0;channel<3;channel++){
   state^=state<<13;state^=state>>>17;state^=state<<5;
   scan[y*(stride+1)+1+x*3+channel]=(state>>>0)&7;
  }
 }
 const chunk=(name,bytes)=>{const out=Buffer.alloc(bytes.length+12),type=Buffer.from(name);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([type,bytes])),bytes.length+8);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('sRGB',Buffer.from([0])),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t){
 await mkdir(work,{recursive:true});const directory=await mkdtemp(join(work,'reference-generation-test-')),plans=[];
 t.after(async()=>{for(const p of plans){const attempt=join(work,'reference-attempts',p.planSha256);assert.match(p.planSha256,/^[a-f0-9]{64}$/);assert.equal(relative(join(work,'reference-attempts'),attempt),p.planSha256);await rm(attempt,{recursive:true,force:true});}const tail=relative(work,directory);assert(tail.startsWith('reference-generation-test-')&&!tail.includes(sep));await rm(directory,{recursive:true,force:true});});
 const prepare=async extras=>{const p=await api.prepareReferencePlan({description:'Synthetic text preference: warm paper and restrained frame detail.',output:join(directory,'reference-plans'),width:256,height:256,...extras});plans.push(p);return p;};
 return {directory,plans,prepare};
}
const execute=(p,generate,extra={})=>api.executeReference({...p,confirmedReferencePlanSha256:p.planSha256,...extra},{generate});
async function accepted(f,extras){const p=await f.prepare(extras),r=await execute(p,async()=>png());const review=await api.reviewReference({...p,imageSha256:r.imageSha256,confirmedImageSha256:r.imageSha256,decision:'accept',note:'Explicit synthetic human decision for this offline fixture.'});return {p,r,review};}
async function templates(directory){
 const output=join(directory,'templates');await buildTemplates({config:defaults.template,output,render:async({spec,directory})=>{const width=spec.coordinates.width*spec.coordinates.outputScale,height=spec.coordinates.height*spec.coordinates.outputScale,bytes=encodePng({width,height,pixels:Buffer.alloc(width*height*4)}),files=[];for(const sheet of spec.sheets)for(const state of ['clean','review']){const file=sheet.filePrefix+'.'+state+'.png';await writeFile(join(directory,file),bytes);files.push({file});}return {renderer:'reference-generation-offline-fixture',files};}});return output;
}

test('text plan is fresh, immutable, provider neutral and freezes every current base asset without visual analysis',async t=>{
 const f=await fixture(t),p=await f.prepare(),next=await f.prepare();assert.notEqual(next.planSha256,p.planSha256);assert.equal(p.computeAuthorized,false);assert.equal(p.maximumCalls,1);assert.equal((await api.inspectReference(p)).status,'awaiting-reference-confirmation');
 const plan=JSON.parse(await readFile(join(p.directory,'plan.json'))),draft=JSON.parse(await readFile(join(p.directory,'inputs/style.json'))),template=JSON.parse(await readFile(defaults.template));
 assert.equal(hash(await readFile(join(p.directory,'plan.json'))),p.planSha256);assert.deepEqual(draft.partRules.map(r=>r.match.assetId),template.sheets.flatMap(s=>s.parts.map(p=>p.assetId)));assert.equal(draft.status,'draft');assert.equal(draft.palette.basis,'reference-only-no-analysis');assert.equal(draft.palette.colors&&Object.keys(draft.palette.colors).length,0);assert.match(draft.referenceSummary,/No visual analysis/);assert.equal(plan.request.output.transparentBackground,false);assert.equal(plan.request.images.length,0);assert.equal(plan.requestSha256,p.requestSha256);assert.match(await readFile(join(p.directory,'review.md'),'utf8'),/另一份明确确认/);
 await api.verifyReferencePlan(p);await assert.rejects(api.prepareComponentsFromReference({...p,output:join(f.directory,'components'),reviewSha256:'a'.repeat(64)}),/ENOENT/);
});

test('adapter receives the exact request SHA, frozen request shape and copied guide bytes; raw RGB normalizes losslessly',async t=>{
 const f=await fixture(t),guide=join(f.directory,'guide.png'),original=png();await writeFile(guide,original);const p=await f.prepare({guide});let calls=0;
 const raw=rgbPng(),result=await execute(p,async request=>{calls++;assert.equal(request.requestSha256,p.requestSha256);assert.equal(request.planSha256,p.planSha256);assert.equal(request.purpose,'primary-style-reference');assert.equal(request.output.transparentBackground,false);assert.equal(request.resolution,'native');assert(Object.isFrozen(request));assert(Object.isFrozen(request.output));assert(Object.isFrozen(request.images));assert(Object.isFrozen(request.images[0]));assert.equal(hash(request.images[0].bytes),hash(original));request.images[0].bytes.fill(0);assert.throws(()=>{request.output.transparentBackground=true;},TypeError);return raw;});
 assert.equal(calls,1);assert.equal(result.adapterCallsThisRun,1);assert.equal(result.status,'pending-visual-review');assert.equal(result.technicalStatus,'passed');assert.equal(hash(await readFile(result.rawFile)),hash(raw));assert.notEqual(result.rawSha256,result.imageSha256);assert(decodePng(await readFile(result.referenceFile)).pixels.equals(decodePng(raw).pixels));assert((await readFile(guide)).equals(original));assert((await readFile(join(p.directory,'inputs/guide.png'))).equals(original));await api.verifyReferencePlan(p);
 assert.equal(JSON.parse(await readFile(join(result.attemptDirectory,'technical.json'))).normalization,'lossless-rgba-srgb-v1');
});

test('a supported 4K RGB/Sub PNG below 32 MiB stays readable when canonical RGBA encoding exceeds the byte bound',async t=>{
 const f=await fixture(t),p=await f.prepare({width:4096,height:4096,resolution:'exact'}),raw=compressedRgbSubPng(),maximum=32*1024*1024;
 assert(raw.length<=maximum);assert(encodePng(decodePng(raw)).length>maximum,'Fixture must reproduce RGBA byte expansion.');
 let calls=0;const result=await execute(p,async()=>{calls++;return raw;});
 assert.equal(result.status,'pending-visual-review');assert.equal(result.technicalStatus,'passed');assert.equal(calls,1);
 assert.equal(result.rawSha256,hash(raw));assert.equal(result.imageSha256,hash(raw));assert((await readFile(result.referenceFile)).equals(raw));
 const qa=JSON.parse(await readFile(join(result.attemptDirectory,'technical.json')));assert.equal(qa.normalization,'verified-original-png-v1');assert.equal(qa.pixelsUnchanged,true);assert.equal(qa.imageBytes,raw.length);
 await assert.rejects(execute(p,async()=>{calls++;return raw;}),/already-claimed-no-resubmit/);assert.equal(calls,1);
});

test('wrong confirmation, invalid adapter and invalid timeout cannot claim or submit a plan',async t=>{
 const f=await fixture(t),p=await f.prepare();let calls=0;const adapter={generate:async()=>{calls++;return png();}};
 await assert.rejects(api.executeReference({...p,confirmedReferencePlanSha256:'a'.repeat(64)},adapter),/fresh-reference-confirmation-required/);
 await assert.rejects(api.executeReference({...p,confirmedReferencePlanSha256:p.planSha256,timeoutMs:0},adapter),/reference.timeout/);
 await assert.rejects(api.executeReference({...p,confirmedReferencePlanSha256:p.planSha256,timeoutMs:900001},adapter),/reference.timeout/);
 await assert.rejects(api.executeReference({...p,confirmedReferencePlanSha256:p.planSha256},{}),/adapter-required/);assert.equal(calls,0);assert.equal((await api.inspectReference(p)).status,'awaiting-reference-confirmation');
});

test('concurrent confirmation has one durable global claim; copied directory, restart and repeat never resubmit',async t=>{
 const f=await fixture(t),p=await f.prepare();let calls=0,release,entered;const started=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);
 const running=execute(p,async()=>{calls++;entered();await blocked;return png();});await started;assert.equal((await api.inspectReference(p)).status,'reserved-no-resubmit');
 await assert.rejects(execute(p,async()=>{calls++;return png();}),/already-claimed-no-resubmit/);
 await assert.rejects(api.recoverReferenceReception(p),/attempt-active/);
 const copy=join(f.directory,'copied-plan');await cp(p.directory,copy,{recursive:true});await assert.rejects(execute({...p,directory:copy},async()=>{calls++;return png();}),/already-claimed-no-resubmit/);
 release();assert.equal((await running).status,'pending-visual-review');await assert.rejects(execute(p,async()=>{calls++;return png();}),/already-claimed-no-resubmit/);assert.equal(calls,1);
 assert.equal((await api.inspectReference({...p,directory:copy})).imageSha256,(await api.inspectReference(p)).imageSha256);
});

test('provider error and invalid return are terminal indeterminate with redacted evidence',async t=>{
 const f=await fixture(t);for(const generate of [async()=>{throw Error('secret-token https://private.example/?key=secret');},async()=>({png:'not bytes'}),async()=>new Uint8Array()]){
  const p=await f.prepare();let calls=0;const r=await execute(p,async request=>{calls++;return generate(request);});assert.equal(r.status,'indeterminate');assert.equal(calls,1);await assert.rejects(execute(p,async()=>{calls++;return png();}),/already-claimed-no-resubmit/);await assert.rejects(api.recoverReferenceReception(p),/terminal-no-resubmit/);assert.doesNotMatch(await readFile(join(r.attemptDirectory,'terminal.json'),'utf8'),/secret|private\.example/);assert.equal(calls,1);
 }
});

test('bounded timeout is indeterminate and a late response cannot alter persisted outcome or create a receipt',async t=>{
 const f=await fixture(t),p=await f.prepare();let resolveLate,calls=0;const result=await execute(p,()=>{calls++;return new Promise(r=>resolveLate=r);},{timeoutMs:10});assert.equal(result.status,'indeterminate');const before=await readFile(join(result.attemptDirectory,'terminal.json'));resolveLate(png());await new Promise(r=>setTimeout(r,20));assert((await readFile(join(result.attemptDirectory,'terminal.json'))).equals(before));await assert.rejects(readFile(join(result.attemptDirectory,'returned.json')),{code:'ENOENT'});await assert.rejects(execute(p,async()=>{calls++;return png();}),/already-claimed-no-resubmit/);assert.equal(calls,1);
});

test('technical failures preserve returned raw bytes and terminal evidence without accepting or retrying',async t=>{
 const f=await fixture(t);for(const raw of [Buffer.from('not a png'),png({opaque:false}),png({blank:true}),png({width:256,height:300})]){
  const p=await f.prepare(),result=await execute(p,async()=>raw);assert.equal(result.status,'rejected-technical');assert.equal(result.technicalStatus,'rejected');assert((await readFile(result.rawFile)).equals(raw));assert.equal(result.rawSha256,hash(raw));await assert.rejects(api.recoverReferenceReception(p),/terminal-no-resubmit/);await assert.rejects(api.reviewReference({...p,imageSha256:hash(raw),confirmedImageSha256:hash(raw),decision:'accept'}),/terminal-no-resubmit/);await assert.rejects(api.prepareComponentsFromReference({...p,output:join(f.directory,'blocked'),reviewSha256:'a'.repeat(64)}),/terminal-no-resubmit/);
 }
});

test('native policy preserves bounded same-ratio pixels; exact policy rejects alternate native dimensions',async t=>{
 const f=await fixture(t),native=await f.prepare(),result=await execute(native,async()=>png({width:512,height:512}));assert.equal(result.status,'pending-visual-review');assert.equal(result.width,512);assert.equal(result.height,512);
 const exact=await f.prepare({resolution:'exact'});assert.equal((await execute(exact,async()=>png({width:512,height:512}))).status,'rejected-technical');
 const tooSmall=await f.prepare();assert.equal((await execute(tooSmall,async()=>png({width:128,height:128}))).status,'rejected-technical');
});

test('only a persisted returned receipt can finish interrupted local reception, idempotently with zero calls',async t=>{
 const f=await fixture(t),p=await f.prepare();let calls=0,attempt;
 await assert.rejects(execute(p,async()=>{calls++;attempt=join(work,'reference-attempts',p.planSha256);await mkdir(join(attempt,'reference.png'));return png();}),/reception-incomplete-no-resubmit/);
 assert.equal((await api.inspectReference(p)).status,'reception-incomplete');const receipt=await readFile(join(attempt,'returned.json')),raw=await readFile(join(attempt,'raw.png'));await rm(join(attempt,'reference.png'),{recursive:true});
 const finished=await api.recoverReferenceReception(p);assert.equal(finished.adapterCallsThisRun,0);assert.equal(finished.status,'pending-visual-review');assert.equal((await api.recoverReferenceReception(p)).adapterCallsThisRun,0);assert.equal(calls,1);assert((await readFile(join(attempt,'returned.json'))).equals(receipt));assert((await readFile(join(attempt,'raw.png'))).equals(raw));
 const unknown=await f.prepare();let resolveNever;const active=execute(unknown,()=>new Promise(r=>resolveNever=r),{timeoutMs:10});const end=await active;assert.equal(end.status,'indeterminate');await writeFile(join(end.attemptDirectory,'raw.png'),png());await assert.rejects(api.recoverReferenceReception(unknown),/terminal-no-resubmit/);resolveNever(png());
});

test('human review requires final image digest and cannot change a rejected or accepted decision',async t=>{
 const f=await fixture(t),p=await f.prepare(),r=await execute(p,async()=>png());await assert.rejects(api.prepareComponentsFromReference({...p,output:join(f.directory,'blocked'),reviewSha256:'a'.repeat(64)}),/ENOENT/);
 await assert.rejects(api.reviewReference({...p,imageSha256:r.imageSha256,confirmedImageSha256:p.planSha256,decision:'accept'}),/fresh-image-confirmation-required/);
 await assert.rejects(api.reviewReference({...p,imageSha256:'a'.repeat(64),confirmedImageSha256:'a'.repeat(64),decision:'accept'}),/review-image-mismatch/);
 const rejected=await api.reviewReference({...p,imageSha256:r.imageSha256,confirmedImageSha256:r.imageSha256,decision:'reject'});assert.equal(rejected.status,'rejected-visual');assert.equal((await api.inspectReference(p)).status,'rejected-visual');
 await assert.rejects(api.prepareComponentsFromReference({...p,output:join(f.directory,'blocked'),reviewSha256:rejected.reviewSha256}),/human-acceptance-required/);await assert.rejects(api.reviewReference({...p,imageSha256:r.imageSha256,confirmedImageSha256:r.imageSha256,decision:'accept'}),/artifact-changed/);
 const yes=await accepted(f);assert.equal(yes.review.status,'accepted');assert.equal((await api.reviewReference({...yes.p,imageSha256:yes.r.imageSha256,confirmedImageSha256:yes.r.imageSha256,decision:'accept',note:'Explicit synthetic human decision for this offline fixture.'})).reviewSha256,yes.review.reviewSha256);
});

test('plan, guide, style, raw, claim, returned, QA and review tampering is rejected before component preparation',async t=>{
 const f=await fixture(t),guide=join(f.directory,'guide.png');await writeFile(guide,png());const a=await accepted(f,{guide});
 const files=[join(a.p.directory,'plan.json'),join(a.p.directory,'inputs/guide.png'),join(a.p.directory,'inputs/style.json'),...['raw.png','claim.json','returned.json','reference.png','technical.json','review.json'].map(file=>join(a.r.attemptDirectory,file))];
 for(const file of files){const original=await readFile(file);await writeFile(file,Buffer.from('tampered'));await assert.rejects(api.prepareComponentsFromReference({...a.p,reviewSha256:a.review.reviewSha256,output:join(f.directory,'blocked')}));await writeFile(file,original);}
 assert.equal((await api.inspectReference(a.p)).status,'accepted');
});

test('accepted reference freezes a separate materials-on batch and bridge; digests cannot authorize each other',async t=>{
 const f=await fixture(t),a=await accepted(f),templateOutput=await templates(f.directory),output=join(f.directory,'components');const originalStyle=await readFile(a.r.styleFile),reference=await readFile(a.r.referenceFile);
 await assert.rejects(api.prepareComponentsFromReference({...a.p,reviewSha256:'a'.repeat(64),output,templateOutput}),/review-digest-required/);
 const batch=await api.prepareComponentsFromReference({...a.p,reviewSha256:a.review.reviewSha256,output,templateOutput});assert.equal(batch.sheets,5);assert.equal(batch.assets,35);assert.equal(batch.providerCalls,0);assert.equal(batch.directory,a.p.directory);
 const bridge=JSON.parse(await readFile(batch.sourceReferenceFile)),b=JSON.parse(await readFile(join(batch.batchDirectory,'batch.json')));assert.equal(hash(await readFile(batch.sourceReferenceFile)),batch.sourceReferenceSha256);assert.notEqual(batch.sourceReferenceSha256,a.r.imageSha256);assert.equal(bridge.reviewSha256,a.review.reviewSha256);assert.equal(bridge.imageSha256,a.r.imageSha256);assert.equal(bridge.batchSha256,batch.batchSha256);assert.equal(b.referenceSha256,a.r.imageSha256);assert.equal(b.styleSha256,a.r.styleSha256);
 let calls=0;const adapter={generate:async()=>{calls++;return png();}},args={...a.p,...batch,sourceReferenceSha256:batch.sourceReferenceSha256};
 await assert.rejects(api.executeComponentsFromReference({...args,confirmedBatchSha256:a.p.planSha256},adapter),/fresh-batch-confirmation-required/);assert.equal(calls,0);
 await assert.rejects(api.executeComponentsFromReference({...args,confirmedBatchSha256:batch.batchSha256,sourceReferenceSha256:a.r.imageSha256},adapter),/source-reference-digest-required/);assert.equal(calls,0);
 const another=await f.prepare();await assert.rejects(api.executeReference({...another,confirmedReferencePlanSha256:batch.batchSha256},adapter),/fresh-reference-confirmation-required/);assert.equal(calls,0);
 const before=await readFile(batch.sourceReferenceFile);await writeFile(batch.sourceReferenceFile,'tampered');await assert.rejects(api.executeComponentsFromReference({...args,confirmedBatchSha256:batch.batchSha256},adapter));await writeFile(batch.sourceReferenceFile,before);assert.equal(calls,0);
 const result=await api.executeComponentsFromReference({...args,confirmedBatchSha256:batch.batchSha256},adapter);assert.equal(result.generation.adapterCallsThisRun,5);assert.equal(result.task,null);assert.equal(calls,5);
 await assert.rejects(api.executeComponentsFromReference({...args,confirmedBatchSha256:batch.batchSha256},adapter),/already-reserved/);assert.equal(calls,5);assert((await readFile(a.r.styleFile)).equals(originalStyle));assert((await readFile(a.r.referenceFile)).equals(reference));
 const four=await api.prepareComponentsFromReference({...a.p,reviewSha256:a.review.reviewSha256,output:join(f.directory,'four-components'),materials:false,templateOutput});assert.equal(four.sheets,4);assert.equal(four.assets,32);
});

test('output must remain in Harness work and linked output/input/plan paths are rejected',async t=>{
 const f=await fixture(t);for(const output of [work,root,join(work,'..','escaped-reference-output')])await assert.rejects(f.prepare({output}),/output-path/);
 for(const extras of [{description:''},{width:128},{height:4097},{resolution:'stretch'},{guide:'x',reference:'y'}])await assert.rejects(f.prepare(extras));
 const target=join(f.directory,'real'),link=join(f.directory,'linked');await mkdir(target);try{await symlink(target,link,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('Host cannot create a test symlink.');return;}throw error;}
 await assert.rejects(f.prepare({output:join(link,'plans')}),/links|junctions/i);const guide=join(target,'guide.png');await writeFile(guide,png());await assert.rejects(f.prepare({guide:join(link,'guide.png')}),/links|junctions/i);
 const p=await f.prepare();const planLink=join(f.directory,'plan-link');await symlink(p.directory,planLink,process.platform==='win32'?'junction':'dir');await assert.rejects(api.verifyReferencePlan({...p,directory:planLink}),/links|junctions/i);
});
