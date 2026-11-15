import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSourceAlphaReview} from '../src/source-alpha-review.mjs';
import {getGenerationResult} from '../src/generation/index.mjs';
import {check,isDigest,hash} from '../src/generation/common.mjs';
import {readSelectedFile,makeFreshDirectory,writeFreshFile,isWithin} from '../src/files.mjs';

const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const help='Usage: node scripts/source-alpha-review.mjs --workflow LOCAL_WORKFLOW --plan PLAN_SHA256 --out NEW_DIRECTORY\n       node scripts/source-alpha-review.mjs --png LOCAL_PNG --out NEW_DIRECTORY\nZero generation. Creates fixed white/dark/checker continuous-Alpha diagnostic previews and a path-free fingerprint report. Never changes source PNG, RGBA, Alpha, QA or artwork acceptance.';
try{
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help')console.log(help);
 else{
  const opts={};
  for(let i=0;i<args.length;i+=2){check(['--workflow','--plan','--png','--out'].includes(args[i])&&args[i+1]&&!Object.hasOwn(opts,args[i]),'SOURCE_ALPHA_REVIEW_ARGUMENTS');opts[args[i]]=args[i+1];}
  const workflow=Object.hasOwn(opts,'--workflow');
  check(opts['--out']&&(workflow?Object.keys(opts).length===3&&opts['--plan']&&isDigest(opts['--plan'])&&!opts['--png']
   :Object.keys(opts).length===2&&opts['--png']&&!opts['--plan']),'SOURCE_ALPHA_REVIEW_ARGUMENTS');
  check(!workflow||!isWithin(resolve(opts['--workflow']),resolve(opts['--out'])),'SOURCE_ALPHA_REVIEW_OUTPUT_OVERLAP');
  const result=workflow?getGenerationResult(opts['--workflow'],opts['--plan']):null,
   raw=result?result.bytes:readSelectedFile(opts['--png'],16777216),before=hash(raw),
   prepared=createSourceAlphaReview(raw,result?{generationResult:result.result}:{}),out=makeFreshDirectory(opts['--out'],sourceRoot);
  for(const [path,bytes]of prepared.files)writeFreshFile(join(out,path),bytes,sourceRoot);
  check(hash(raw)===before,'SOURCE_ALPHA_REVIEW_SOURCE_CHANGED');
  console.log(JSON.stringify({ok:true,reportSha256:prepared.report.sha256,rawSha256:before,
   sourceBinding:prepared.report.sourceBinding,artifacts:[...prepared.files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),
   generationCalls:0,sourceModified:false,originalQaModified:false,sourceArtAcceptance:'not-granted'}));
 }
}catch(error){
 console.error(JSON.stringify({ok:false,code:error.errors?.[0]?.code??'SOURCE_ALPHA_REVIEW_FAILED',message:'Diagnostic stopped; original source and QA remain unchanged. No generation or automatic retry.'}));process.exitCode=1;
}
