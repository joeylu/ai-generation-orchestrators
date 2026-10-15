import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCompletedImage} from '../src/skin-generation/codex-recovery.mjs';
import {verifyRecoveredResult} from '../src/skin-generation/recovered-result.mjs';
import {hash,json} from '../src/skins/package.mjs';

test('recovery requires exactly one completed transparent image bound to tool ID and original bytes',()=>{
 const bytes=Buffer.from('synthetic image'),image={toolUseId:'one'},item={type:'Extension',id:'one',savedPath:'fixture.png',status:'completed',failure:null,transparentBackground:true,result:bytes.toString('base64')};
 const wrap=i=>({type:'event_msg',payload:{type:'item_completed',item:i}});
 assert.equal(verifyCompletedImage([wrap(item)],image,bytes).id,'one');
 for(const patch of [{id:'other'},{status:'failed'},{failure:'failed'},{transparentBackground:false},{result:Buffer.from('changed').toString('base64')}])assert.throws(()=>verifyCompletedImage([wrap({...item,...patch})],image,bytes),/output-not-bound/);
 assert.throws(()=>verifyCompletedImage([],image,bytes),/ambiguous/);
 assert.throws(()=>verifyCompletedImage([wrap(item),wrap(item)],image,bytes),/ambiguous/);
});
test('recovery preserves and binds original terminal outcome, submission, plan and raw bytes',()=>{
 const submissionBytes=Buffer.from('submission'),resultBytes=Buffer.from(json({status:'indeterminate',submissionSha256:hash(submissionBytes)}));
 const context={submissionBytes,resultBytes,planSha256:'a'.repeat(64),rawSha256:hash('raw')};
 const r={kind:'ui_skin_recovered_result',version:'1.0',planSha256:context.planSha256,originalResultSha256:hash(resultBytes),submissionSha256:hash(submissionBytes),rawSha256:context.rawSha256,automaticRetry:false,providerCalls:0,audit:{observedRelayCalls:1,transparentBackground:true,postImageGateVerified:true,outputBoundToTranscript:true}};
 assert.equal(verifyRecoveredResult(json(r),context).providerCalls,0);
 for(const patch of [{originalResultSha256:'bad'},{submissionSha256:'bad'},{planSha256:'bad'},{rawSha256:'bad'},{providerCalls:1},{automaticRetry:true},{audit:{...r.audit,postImageGateVerified:false}}])assert.throws(()=>verifyRecoveredResult(json({...r,...patch}),context),/evidence-binding/);
 assert.throws(()=>verifyRecoveredResult(json(r),{...context,resultBytes:Buffer.from(json({status:'failed'}))}),/evidence-binding/);
});
