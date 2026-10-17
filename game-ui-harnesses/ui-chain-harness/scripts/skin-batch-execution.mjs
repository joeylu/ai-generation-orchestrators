import {parseArgs} from 'node:util';
import {resolve,relative,join,dirname,basename,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorizeBatch,beginSubmission,finishSubmission} from '../src/skin-generation/batch-execution.mjs';
const work=fileURLToPath(new URL('../work/',import.meta.url));
try{
  const {positionals:p,values:v}=parseArgs({allowPositionals:true,options:{batch:{type:'string'},sha256:{type:'string'},confirmed:{type:'string'},sheet:{type:'string'},status:{type:'string'},raw:{type:'string'}}});
  if(p.length!==1||!v.batch||!v.sha256)throw Error('Expected authorize/begin/finish with --batch --sha256');
  const batch=resolve(v.batch),r=relative(work,batch);
  if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep)||batch!==join(dirname(dirname(batch)),'batches',v.sha256))throw Error('Expected a digest batch directory under Harness work');
  const args={skinDirectory:dirname(dirname(batch)),batchSha256:v.sha256,sheetId:v.sheet};let result;
  if(p[0]==='authorize')result=await authorizeBatch({...args,confirmedBatchSha256:v.confirmed});
  else if(p[0]==='begin')result=await beginSubmission(args);
  else if(p[0]==='finish'){
    if((v.status==='returned')!==Boolean(v.raw))throw Error('Only returned requires --raw');
    result=await finishSubmission({...args,status:v.status,...(v.raw?{rawDirectory:dirname(resolve(v.raw)),rawFile:basename(resolve(v.raw))}:{})});
  }else throw Error('Unknown action');
  console.log(JSON.stringify(result,null,2));
}catch(e){console.error(JSON.stringify({status:'failed',message:e.message,automaticProviderCalls:false,automaticRetry:false}));process.exitCode=1;}
