import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {prepareAcceptance,runAcceptance} from '../src/acceptance/batch.mjs';
import {checkAcceptance,replayAcceptance,acceptanceReport} from '../src/acceptance/check.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try{
 const {positionals,values}=parseArgs({allowPositionals:true,options:{batch:{type:'string'},package:{type:'string'},contracts:{type:'string'},skins:{type:'string'},cases:{type:'string'},out:{type:'string'},evidence:{type:'string'},authorize:{type:'string'},concurrency:{type:'string'},case:{type:'string'},mode:{type:'string'},style:{type:'string'}}});
 const [mode]=positionals;if(positionals.length!==1||!['prepare','run','check','replay','report'].includes(mode))throw Object.assign(Error('ACCEPTANCE_ARGUMENTS'),{code:'ACCEPTANCE_ARGUMENTS'});
 if(mode!=='run'&&values.authorize)throw Object.assign(Error('ACCEPTANCE_ARGUMENTS'),{code:'ACCEPTANCE_ARGUMENTS'});
 if(values.case&&!['check','replay'].includes(mode)||values.concurrency&&mode!=='run')throw Object.assign(Error('ACCEPTANCE_ARGUMENTS'),{code:'ACCEPTANCE_ARGUMENTS'});
 if(mode!=='prepare'&&(values.mode||values.style))throw Object.assign(Error('ACCEPTANCE_ARGUMENTS'),{code:'ACCEPTANCE_ARGUMENTS'});
 let result;
 if(mode==='prepare'){
  if((!values.package&&!values.skins)||!values.evidence||values.batch)throw Object.assign(Error('ACCEPTANCE_ARGUMENTS'),{code:'ACCEPTANCE_ARGUMENTS'});
  const spec=JSON.parse(await readFile(resolve(values.cases??join(root,'configs/panel-acceptance-cases.json'))));
  result=await prepareAcceptance({root,spec,mode:values.mode,styleId:values.style,...(values.skins?{skins:JSON.parse(await readFile(resolve(values.skins)))}:{packageDirectory:resolve(values.package),contractsDirectory:values.contracts?resolve(values.contracts):undefined}),evidenceDirectory:resolve(values.evidence),...(values.out?{outputRoot:resolve(values.out)}:{})});
 }else{
  if(!values.batch)throw Object.assign(Error('ACCEPTANCE_ARGUMENTS'),{code:'ACCEPTANCE_ARGUMENTS'});const args={root,directory:resolve(values.batch),caseId:values.case};
  if(mode==='run')result=await runAcceptance({...args,authorizationSha256:values.authorize,maxConcurrency:values.concurrency===undefined?2:Number(values.concurrency)});
  if(mode==='check')result=await checkAcceptance(args);if(mode==='replay')result=await replayAcceptance(args);if(mode==='report')result=await acceptanceReport(args);
 }
 console.log(JSON.stringify(result));if(result.status==='failed'||result.status==='incomplete')process.exitCode=2;
}catch(e){console.error(JSON.stringify({status:'FAILED',code:e.code??'ACCEPTANCE_FAILED',automaticRetries:0}));process.exitCode=1;}
