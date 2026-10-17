import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareReferencePlan,verifyReferencePlan,executeReference,inspectReference,recoverReferenceReception,reviewReference,prepareComponentsFromReference,executeComponentsFromReference} from '../src/components-api.mjs';

const commands={
 prepare:['description','out','style','guide','width','height','resolution'],
 verify:['directory','plan-sha256'],
 status:['directory','plan-sha256'],
 execute:['directory','plan-sha256','confirm-reference','adapter','timeout-ms'],
 review:['directory','plan-sha256','image-sha256','confirm-image','decision'],
 recover:['directory','plan-sha256'],
 'batch-prepare':['directory','plan-sha256','review-sha256','out','no-materials'],
 'batch-execute':['directory','plan-sha256','batch-directory','batch-sha256','source-reference-sha256','skin-directory','confirm-batch','adapter','profile']
};
const help={kind:'ui_reference_generation_cli',commands,adapter:'Explicit host module exporting {generate(frozenRequest)} as default or named generate. No provider configuration is stored in the plan.',confirmations:'Reference-plan SHA-256 and component-batch SHA-256 are separate. Image acceptance grants no compute permission.',modelCalls:0};
const fail=(code)=>{const error=Error(code);error.code=code;throw error;};
const requireValue=(v,key)=>typeof v[key]==='string'&&v[key].trim()?v[key]:fail('reference-cli.missing-'+key);
const number=(v,key)=>{if(v[key]===undefined)return undefined;const n=Number(v[key]);return Number.isSafeInteger(n)&&n>0?n:fail('reference-cli.invalid-'+key);};
async function loadAdapter(file){
 const mod=await import(pathToFileURL(resolve(file)).href),adapter=mod.default??mod.adapter??mod;
 if(!adapter||typeof adapter.generate!=='function')fail('reference-cli.invalid-adapter');
 return adapter;
}
let providerInvocationStarted=false;
try{
 const options=Object.fromEntries([...new Set(Object.values(commands).flat())].map(key=>[key,{type:key==='no-materials'?'boolean':'string'}]));
 options.help={type:'boolean'};
 const {positionals,values:v}=parseArgs({allowPositionals:true,options});
 if(v.help&&positionals.length===0)console.log(JSON.stringify(help,null,2));
 else{
  const command=positionals[0];if(positionals.length!==1||!commands[command]||Object.keys(v).some(key=>!commands[command].includes(key)))fail('reference-cli.usage');
  const base=command==='prepare'?null:{directory:requireValue(v,'directory'),planSha256:requireValue(v,'plan-sha256')};
  let result;
  if(command==='prepare')result=await prepareReferencePlan({description:requireValue(v,'description'),output:requireValue(v,'out'),...(v.style?{style:v.style}:{}),...(v.guide?{guide:v.guide}:{}),...(v.width?{width:number(v,'width')}:{}),...(v.height?{height:number(v,'height')}:{}),...(v.resolution?{resolution:v.resolution}:{})});
  else if(command==='verify')result=await verifyReferencePlan(base);
  else if(command==='status')result=await inspectReference(base);
  else if(command==='recover')result=await recoverReferenceReception(base);
  else if(command==='review')result=await reviewReference({...base,imageSha256:requireValue(v,'image-sha256'),confirmedImageSha256:requireValue(v,'confirm-image'),decision:requireValue(v,'decision')});
  else if(command==='batch-prepare')result=await prepareComponentsFromReference({...base,reviewSha256:requireValue(v,'review-sha256'),output:requireValue(v,'out'),materials:!v['no-materials']});
  else if(command==='execute'){
   const confirmedReferencePlanSha256=requireValue(v,'confirm-reference');
   if(confirmedReferencePlanSha256!==base.planSha256)fail('reference-cli.confirmation-mismatch');
   const timeoutMs=number(v,'timeout-ms');
   await verifyReferencePlan(base);
   const adapter=await loadAdapter(requireValue(v,'adapter'));
   providerInvocationStarted=true;
   result=await executeReference({...base,confirmedReferencePlanSha256,...(timeoutMs===undefined?{}:{timeoutMs})},adapter);
  }else{
   const batchSha256=requireValue(v,'batch-sha256'),confirmedBatchSha256=requireValue(v,'confirm-batch');
   if(batchSha256!==confirmedBatchSha256||confirmedBatchSha256===base.planSha256)fail('reference-cli.confirmation-mismatch');
   await verifyReferencePlan(base);
   const args={...base,batchDirectory:requireValue(v,'batch-directory'),batchSha256,sourceReferenceSha256:requireValue(v,'source-reference-sha256'),skinDirectory:requireValue(v,'skin-directory'),confirmedBatchSha256,...(v.profile?{profile:v.profile}:{})};
   const adapter=await loadAdapter(requireValue(v,'adapter'));providerInvocationStarted=true;
   result=await executeComponentsFromReference(args,adapter);
  }
  console.log(JSON.stringify(result,null,2));
 }
}catch(error){
 // Adapter errors can contain credentials and private endpoints. Emit codes only.
 const code=/^(?:reference|reference-cli)\.[a-z0-9.-]{1,100}$/.test(error.code??'')?error.code:'reference-cli.failed';
 console.error(JSON.stringify({status:'failed',code,modelMayHaveBeenSubmitted:providerInvocationStarted,...(!providerInvocationStarted?{modelCalls:0}:{})}));
 process.exitCode=1;
}
