import {parseArgs} from 'node:util';
import {resolve,relative,join,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSkinCodexAdapter} from '../src/skin-generation/codex-adapter.mjs';
import {executeBatchPipeline} from '../src/skin-generation/batch-runner.mjs';
import {generationExecutionPolicy} from '../src/skin-generation/execution-policy.mjs';
const work=fileURLToPath(new URL('../work/',import.meta.url));
try{
  const {positionals:p,values:v}=parseArgs({allowPositionals:true,options:{batch:{type:'string'},sha256:{type:'string'},confirmed:{type:'string'},profile:{type:'string'},'allow-rejected-localization':{type:'boolean'}}});
  if(p.length!==1||!['preflight','run'].includes(p[0]))throw Error('CODEX_ACTION_INVALID');
  const adapter=createSkinCodexAdapter({workspace:join(work,'skin-codex-relay')});
  if(p[0]==='preflight')console.log(JSON.stringify({status:'available',metadata:await adapter.preflight(),generation:'not-invoked'}));
  else{
    if(!/^[a-f0-9]{64}$/.test(v.sha256??'')||v.confirmed!==v.sha256||!v.batch)throw Error('CODEX_FRESH_BATCH_CONFIRMATION_REQUIRED');
    const batch=resolve(v.batch),r=relative(work,batch);
    if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep)||batch!==join(dirname(dirname(batch)),'batches',v.sha256))throw Error('CODEX_BATCH_PATH_INVALID');
    await adapter.preflight();
    const result=await executeBatchPipeline({skinDirectory:dirname(dirname(batch)),batchSha256:v.sha256,confirmedBatchSha256:v.confirmed,profile:v.profile,allowRejectedLocalization:v['allow-rejected-localization']===true,maxConcurrentSheets:generationExecutionPolicy.maxConcurrentSheets},adapter);
    console.log(JSON.stringify(result,null,2));
  }
}catch(e){console.error(JSON.stringify({status:'failed',code:/^(CODEX_[A-Z_]+|batch-runner\.[a-z-]+|batch-execution\.[a-z-]+)$/.test(e.message)?e.message:'CODEX_OPERATION_FAILED_NO_RETRY',...(e.taskDirectory?{taskDirectory:e.taskDirectory}:{}),automaticRetry:false}));process.exitCode=1;}
