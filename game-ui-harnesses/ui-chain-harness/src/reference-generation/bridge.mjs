import {join,relative,resolve} from 'node:path';
import {prepareSkinBatch,verifySkinBatch} from '../../scripts/skin-batch.mjs';
import {executeBatchPipeline} from '../skin-generation/batch-runner.mjs';
import {root,hash,json,readSafe,withinWork,record,seal,exact,requireThat,emit,defaults} from './common.mjs';
import {acceptedReference} from './reception.mjs';

const kind='ui_component_source_reference';
function bridgeRecord(accepted,batchSha256){return seal({kind,version:'1.0',planDirectory:relative(root,accepted.v.directory).replaceAll('\\','/'),planSha256:accepted.v.planSha256,requestSha256:accepted.v.plan.requestSha256,rawSha256:hash(accepted.result.r.raw),imageSha256:hash(accepted.result.reference),styleSha256:accepted.v.plan.styleSha256,reviewSha256:accepted.review.value.sha256,batchSha256});}
export async function prepareComponentsFromReference(args){
 const accepted=await acceptedReference(args);requireThat(args.reviewSha256===accepted.review.value.sha256,'review-digest-required');
 const output=await withinWork(args.output),materials=args.materials??true;requireThat(typeof materials==='boolean','materials');
 const batch=await prepareSkinBatch({reference:join(accepted.c.directory,'reference.png'),style:join(accepted.v.directory,'inputs/style.json'),output,materials,contracts:args.contracts??defaults,...(args.templateOutput?{templateOutput:args.templateOutput}:{})});
 const b=JSON.parse(await readSafe(batch.directory,'batch.json'));
 requireThat(b.referenceSha256===hash(accepted.result.reference)&&b.styleSha256===accepted.v.plan.styleSha256,'batch-source-mismatch');
 const bridge=bridgeRecord(accepted,batch.batchSha256),bytes=Buffer.from(json(bridge));await emit(batch.directory,'source-reference.json',bytes);
 return {...batch,directory:accepted.v.directory,planSha256:accepted.v.planSha256,referenceDirectory:accepted.v.directory,skinDirectory:output,batchDirectory:batch.directory,sourceReferenceFile:join(batch.directory,'source-reference.json'),sourceReferenceSha256:hash(bytes),reviewSha256:accepted.review.value.sha256,imageSha256:hash(accepted.result.reference),styleSha256:accepted.v.plan.styleSha256,providerCalls:0};
}
export async function executeComponentsFromReference(args,adapter){
 const accepted=await acceptedReference(args),skinDirectory=await withinWork(args.skinDirectory);
 const directory=join(skinDirectory,'batches',args.batchSha256??'');await withinWork(directory);
 requireThat(args.batchDirectory===undefined||resolve(args.batchDirectory)===directory,'batch-directory-mismatch');
 const source=await record(directory,'source-reference.json',kind);exact(source.value,['kind','version','planDirectory','planSha256','requestSha256','rawSha256','imageSha256','styleSha256','reviewSha256','batchSha256','sha256']);
 requireThat(args.sourceReferenceSha256===hash(source.bytes),'source-reference-digest-required');
 requireThat(JSON.stringify(source.value)===JSON.stringify(bridgeRecord(accepted,args.batchSha256)),'source-reference-mismatch');
 await verifySkinBatch({directory,batchSha256:args.batchSha256,contracts:args.contracts??defaults});
 const batch=JSON.parse(await readSafe(directory,'batch.json'));requireThat(batch.referenceSha256===source.value.imageSha256&&batch.styleSha256===source.value.styleSha256,'batch-source-mismatch');
 requireThat(args.confirmedBatchSha256===args.batchSha256&&args.confirmedBatchSha256!==args.planSha256,'fresh-batch-confirmation-required');
 return executeBatchPipeline({...args,skinDirectory},adapter);
}
