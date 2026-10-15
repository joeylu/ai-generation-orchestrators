import { parseArgs } from 'node:util';
import { resolve,relative,join,isAbsolute,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNormalization,normalizationStatus,verifyNormalization,defaultPolicy } from '../src/skin-generation/normalize-build.mjs';
const root=fileURLToPath(new URL('../work/',import.meta.url));
try{
  const {values:v,positionals:p}=parseArgs({allowPositionals:true,options:{plan:{type:'string'},sha256:{type:'string'},attempt:{type:'string'},out:{type:'string'},policy:{type:'string'},package:{type:'string'},manifest:{type:'string'}}});
  if(p.length!==1)throw Error('Expected one command.');
  const privatePath=path=>{const full=resolve(path),r=relative(root,full);if(isAbsolute(r)||r==='..'||r.startsWith('..'+sep))throw Error('Use a private work/ directory.');return full;};
  const output=privatePath(v.out??join(root,'skin-normalization')),policy=v.policy?resolve(v.policy):defaultPolicy;
  let result;
  if(p[0]==='build'&&v.plan&&v.sha256&&v.attempt)result=await buildNormalization({planDirectory:privatePath(v.plan),planSha256:v.sha256,attemptDirectory:privatePath(v.attempt),output,policy});
  else if(p[0]==='status')result=await normalizationStatus(output,policy);
  else if(p[0]==='verify'&&v.package&&v.manifest){const r=await verifyNormalization({directory:privatePath(v.package),manifestSha256:v.manifest});result={status:r.status,assets:r.assets,productionReady:false};}
  else throw Error('Use build --plan dir --sha256 digest --attempt dir, status, or verify --package dir --manifest digest.');
  console.log(JSON.stringify(result,null,2));if(['corrupt','missing','stale'].includes(result.status))process.exitCode=1;
}catch(e){console.error(JSON.stringify({status:'failed',code:e.code??'skin.normalize',message:e.code==='skin.normalize'?e.message:'Normalization failed; no source or current build was replaced.'}));process.exitCode=1;}
