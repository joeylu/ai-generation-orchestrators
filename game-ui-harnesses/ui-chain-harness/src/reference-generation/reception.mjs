import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {decodePng,encodePng} from '../skins/png.mjs';
import {root,digest,maximumBytes,hash,json,readSafe,withinWork,optional,record,seal,exact,requireThat,fail,emit,sameOrNew,attemptDirectory,assertNotActive} from './common.mjs';
import {loadPlan} from './plan.mjs';

const claimKind='ui_primary_reference_claim',returnedKind='ui_primary_reference_returned',terminalKind='ui_primary_reference_terminal',qaKind='ui_primary_reference_technical_qa',reviewKind='ui_primary_reference_review';
async function claimed(v){
 const directory=attemptDirectory(v.planSha256),claim=await record(directory,'claim.json',claimKind);
 exact(claim.value,['kind','version','planSha256','requestSha256','styleSha256','nonce','maximumCalls','consumed','automaticRetry','timeoutMs','createdAt','planDirectory','sha256']);
 requireThat(claim.value.planSha256===v.planSha256&&claim.value.requestSha256===v.plan.requestSha256&&claim.value.styleSha256===v.plan.styleSha256&&claim.value.maximumCalls===1&&claim.value.consumed===true&&claim.value.automaticRetry===false&&Number.isInteger(claim.value.timeoutMs)&&claim.value.timeoutMs>=1&&claim.value.timeoutMs<=900000,'claim-binding');
 await withinWork(join(root,claim.value.planDirectory));
 return {directory,claim};
}
async function returned(v,c){
 const result=await record(c.directory,'returned.json',returnedKind);
 exact(result.value,['kind','version','planSha256','requestSha256','styleSha256','claimSha256','rawSha256','rawBytes','automaticRetry','sha256']);
 requireThat(result.value.planSha256===v.planSha256&&result.value.requestSha256===v.plan.requestSha256&&result.value.styleSha256===v.plan.styleSha256&&result.value.claimSha256===c.claim.value.sha256&&result.value.automaticRetry===false&&digest.test(result.value.rawSha256)&&Number.isInteger(result.value.rawBytes)&&result.value.rawBytes>0&&result.value.rawBytes<=maximumBytes,'returned-binding');
 const raw=await readSafe(c.directory,'raw.png');requireThat(hash(raw)===result.value.rawSha256&&raw.length===result.value.rawBytes,'raw-changed');return {result,raw};
}
function normalize(raw,plan){
 let image;try{image=decodePng(raw);}catch{fail('technical-png-unsupported');}
 const {width,height,pixels}=image,r=plan.request;
 requireThat(width>=256&&height>=256&&width<=4096&&height<=4096,'technical-dimensions');
 requireThat(r.resolution==='exact'?width===r.width&&height===r.height:Math.abs((width/height)/(r.width/r.height)-1)<=.01,'technical-resolution');
 let first,changed=false;for(let i=0;i<pixels.length;i+=4){requireThat(pixels[i+3]===255,'technical-not-opaque');const color=pixels.readUInt32BE(i);if(first===undefined)first=color;else if(color!==first)changed=true;}
 requireThat(changed,'technical-blank');const normalized=encodePng(image),check=decodePng(normalized);
 requireThat(check.width===width&&check.height===height&&check.pixels.equals(pixels),'technical-pixels-changed');
 return {image,normalized};
}
function qaRecord(v,c,r,n){return seal({kind:qaKind,version:'1.0',planSha256:v.planSha256,requestSha256:v.plan.requestSha256,styleSha256:v.plan.styleSha256,claimSha256:c.claim.value.sha256,returnedSha256:r.result.value.sha256,rawSha256:hash(r.raw),imageSha256:hash(n.normalized),imageBytes:n.normalized.length,width:n.image.width,height:n.image.height,resolution:v.plan.request.resolution,normalization:'lossless-rgba-srgb-v1',pixelsUnchanged:true,opaque:true,varied:true,status:'passed',visualAcceptance:'unreviewed'});}
async function verifiedResult(v,c){
 const r=await returned(v,c),n=normalize(r.raw,v.plan),qa=await record(c.directory,'technical.json',qaKind),reference=await readSafe(c.directory,'reference.png');
 requireThat(JSON.stringify(qa.value)===JSON.stringify(qaRecord(v,c,r,n))&&reference.equals(n.normalized),'technical-evidence-changed');
 return {r,n,qa,reference};
}
export async function acceptedReference(args){
 const v=await loadPlan(args),c=await claimed(v);requireThat(!await optional(c.directory,'terminal.json'),'terminal-no-resubmit');
 const result=await verifiedResult(v,c),review=await record(c.directory,'review.json',reviewKind);
 exact(review.value,['kind','version','planSha256','requestSha256','styleSha256','returnedSha256','rawSha256','imageSha256','technicalSha256','confirmedImageSha256','decision','note','sha256']);
 const rv=review.value;requireThat(rv.planSha256===v.planSha256&&rv.requestSha256===v.plan.requestSha256&&rv.styleSha256===v.plan.styleSha256&&rv.returnedSha256===result.r.result.value.sha256&&rv.rawSha256===hash(result.r.raw)&&rv.imageSha256===hash(result.reference)&&rv.confirmedImageSha256===rv.imageSha256&&rv.technicalSha256===result.qa.value.sha256&&['accept','reject'].includes(rv.decision)&&typeof rv.note==='string'&&rv.note.length<=2000,'review-binding');
 requireThat(rv.decision==='accept','human-acceptance-required');return {v,c,result,review};
}
async function finish(v,c){
 requireThat(!await optional(c.directory,'terminal.json'),'terminal-no-resubmit');const r=await returned(v,c);
 let n;try{n=normalize(r.raw,v.plan);}catch(error){if(!String(error.code).startsWith('reference.technical-'))throw error;await sameOrNew(c.directory,'terminal.json',json(seal({kind:terminalKind,version:'1.0',planSha256:v.planSha256,requestSha256:v.plan.requestSha256,claimSha256:c.claim.value.sha256,status:'rejected-technical',issue:error.code,automaticRetry:false})));return;}
 await sameOrNew(c.directory,'reference.png',n.normalized);await sameOrNew(c.directory,'technical.json',json(qaRecord(v,c,r,n)));
 await verifiedResult(v,c);
}
export async function inspectReference(args){
 const v=await loadPlan(args),directory=attemptDirectory(v.planSha256),base={directory:v.directory,planSha256:v.planSha256,requestSha256:v.plan.requestSha256,styleSha256:v.plan.styleSha256,styleFile:join(v.directory,'inputs/style.json'),attemptDirectory:directory,maximumCalls:1,automaticRetry:false,productionReady:false,visualAcceptance:'unreviewed'};
 if(!await optional(directory,'claim.json'))return {...base,status:'awaiting-reference-confirmation',technicalStatus:'not-run'};
 const c=await claimed(v),terminal=await optional(directory,'terminal.json');
 if(terminal){const t=await record(directory,'terminal.json',terminalKind);exact(t.value,['kind','version','planSha256','requestSha256','claimSha256','status','issue','automaticRetry','sha256']);requireThat(t.value.planSha256===v.planSha256&&t.value.requestSha256===v.plan.requestSha256&&t.value.claimSha256===c.claim.value.sha256&&['indeterminate','rejected-technical'].includes(t.value.status)&&t.value.automaticRetry===false,'terminal-binding');if(await optional(directory,'returned.json'))await returned(v,c);return {...base,status:t.value.status,technicalStatus:t.value.status==='rejected-technical'?'rejected':'not-run',issue:t.value.issue,...(await optional(directory,'raw.png')?{rawFile:join(directory,'raw.png'),rawSha256:hash(await readSafe(directory,'raw.png'))}:{})};}
 if(!await optional(directory,'returned.json'))return {...base,status:'reserved-no-resubmit',technicalStatus:'not-run'};
 const r=await returned(v,c);if(!await optional(directory,'technical.json'))return {...base,status:'reception-incomplete',technicalStatus:'incomplete',rawFile:join(directory,'raw.png'),rawSha256:hash(r.raw)};
 const result=await verifiedResult(v,c),complete={...base,status:'pending-visual-review',technicalStatus:'passed',rawFile:join(directory,'raw.png'),rawSha256:hash(result.r.raw),referenceFile:join(directory,'reference.png'),imageSha256:hash(result.reference),width:result.n.image.width,height:result.n.image.height};
 if(await optional(directory,'review.json')){
  const review=await record(directory,'review.json',reviewKind);
  // Validate accepted and rejected review evidence with the same bindings.
  try{const accepted=await acceptedReference(args);return {...complete,status:'accepted',reviewSha256:accepted.review.value.sha256,visualAcceptance:'accepted'};}
  catch(error){if(error.code!=='reference.human-acceptance-required')throw error;return {...complete,status:'rejected-visual',reviewSha256:review.value.sha256,visualAcceptance:'rejected'};}
 }
 return complete;
}
export async function executeReference(args,adapter){
 requireThat(adapter&&typeof adapter.generate==='function','adapter-required');
 const v=await loadPlan(args);requireThat(args.confirmedReferencePlanSha256===v.planSha256,'fresh-reference-confirmation-required');
 const timeoutMs=args.timeoutMs??300000;requireThat(Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=900000,'timeout');
 const directory=await withinWork(attemptDirectory(v.planSha256));await mkdir(join(directory,'..'),{recursive:true});
 try{await mkdir(directory);}catch(error){if(error.code==='EEXIST')fail('already-claimed-no-resubmit');throw error;}
 const claim=seal({kind:claimKind,version:'1.0',planSha256:v.planSha256,requestSha256:v.plan.requestSha256,styleSha256:v.plan.styleSha256,nonce:randomUUID(),maximumCalls:1,consumed:true,automaticRetry:false,timeoutMs,createdAt:new Date().toISOString(),planDirectory:relative(root,v.directory).replaceAll('\\','/')});
 await emit(directory,'claim.json',json(claim));const lockBytes=Buffer.from(json({pid:process.pid,nonce:claim.nonce}));await emit(directory,'active.lock',lockBytes);
 const c={directory,claim:{value:claim}},request=Object.freeze({...v.plan.request,planSha256:v.planSha256,requestSha256:v.plan.requestSha256,output:Object.freeze({...v.plan.request.output}),images:Object.freeze(v.plan.request.images.map(({role,file,sha256})=>Object.freeze({role,sha256,bytes:Buffer.from(v.resources.get(file))})))});
 let timer;
 try{
  let bytes;try{bytes=await Promise.race([Promise.resolve().then(()=>adapter.generate(request)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);}
  catch{await emit(directory,'terminal.json',json(seal({kind:terminalKind,version:'1.0',planSha256:v.planSha256,requestSha256:v.plan.requestSha256,claimSha256:claim.sha256,status:'indeterminate',issue:'reference.adapter-indeterminate-no-resubmit',automaticRetry:false})));return {...await inspectReference(args),adapterCallsThisRun:1};}
  finally{clearTimeout(timer);}
  if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>maximumBytes){await emit(directory,'terminal.json',json(seal({kind:terminalKind,version:'1.0',planSha256:v.planSha256,requestSha256:v.plan.requestSha256,claimSha256:claim.sha256,status:'indeterminate',issue:'reference.adapter-result-invalid-no-resubmit',automaticRetry:false})));return {...await inspectReference(args),adapterCallsThisRun:1};}
  try{
   const raw=Buffer.from(bytes);await emit(directory,'raw.png',raw);
   await emit(directory,'returned.json',json(seal({kind:returnedKind,version:'1.0',planSha256:v.planSha256,requestSha256:v.plan.requestSha256,styleSha256:v.plan.styleSha256,claimSha256:claim.sha256,rawSha256:hash(raw),rawBytes:raw.length,automaticRetry:false})));
   await finish(v,c);
  }catch(error){throw Object.assign(Error('reference.reception-incomplete-no-resubmit'),{code:'reference.reception-incomplete-no-resubmit',cause:error});}
  return {...await inspectReference(args),adapterCallsThisRun:1};
 }finally{clearTimeout(timer);const lock=await optional(directory,'active.lock');if(lock?.equals(lockBytes))await unlink(join(directory,'active.lock'));}
}
export async function recoverReferenceReception(args){
 const v=await loadPlan(args),c=await claimed(v);await assertNotActive(c.directory);
 requireThat(!await optional(c.directory,'terminal.json'),'terminal-no-resubmit');await returned(v,c);await finish(v,c);
 return {...await inspectReference(args),adapterCallsThisRun:0};
}
export async function reviewReference(args){
 requireThat(['accept','reject'].includes(args.decision),'review-decision');requireThat(digest.test(args.imageSha256??'')&&args.confirmedImageSha256===args.imageSha256,'fresh-image-confirmation-required');
 const note=args.note??'';requireThat(typeof note==='string'&&note.length<=2000,'review-note');
 const v=await loadPlan(args),c=await claimed(v);await assertNotActive(c.directory);requireThat(!await optional(c.directory,'terminal.json'),'terminal-no-resubmit');
 const result=await verifiedResult(v,c);requireThat(hash(result.reference)===args.imageSha256,'review-image-mismatch');
 const review=seal({kind:reviewKind,version:'1.0',planSha256:v.planSha256,requestSha256:v.plan.requestSha256,styleSha256:v.plan.styleSha256,returnedSha256:result.r.result.value.sha256,rawSha256:hash(result.r.raw),imageSha256:hash(result.reference),technicalSha256:result.qa.value.sha256,confirmedImageSha256:args.confirmedImageSha256,decision:args.decision,note});
 await sameOrNew(c.directory,'review.json',json(review));return inspectReference(args);
}
