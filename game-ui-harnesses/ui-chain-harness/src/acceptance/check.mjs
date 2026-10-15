import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {json,hash} from '../skins/package.mjs';
import {verifyBatch,caseInputs,fail} from './evidence.mjs';
import {command,originalRun} from './batch.mjs';
import {replayCase} from './replay.mjs';
import {semanticIssues} from './semantics.mjs';
import {checkPreview} from './browser.mjs';
async function callState(root,directory,entry){
 const source=await originalRun(root,directory,entry);
 try{const receipt=JSON.parse(await readFile(join(source,'receipt.json')));if(receipt.planSha256!==entry.planSha256||![0,1].includes(receipt.invocationCount)||receipt.automaticRetries!==0)fail('ACCEPTANCE_RECEIPT_INVALID');return {status:receipt.status,code:receipt.failureCode??null,invocationCount:receipt.invocationCount,automaticRetries:0,directory:source};}
 catch(e){if(e.code!=='ENOENT')throw e;try{await readFile(join(source,'dispatch.json'));return {status:'INDETERMINATE_NO_RETRY',code:'ACCEPTANCE_RESULT_INDETERMINATE',directory:source};}catch(missing){if(missing.code!=='ENOENT')throw missing;
   try{const result=JSON.parse(await readFile(join(directory,'dispatches',entry.id+'.result.json')));return {status:result.status,code:result.code??null,directory:source,receiptAvailable:false};}catch(resultMissing){if(resultMissing.code!=='ENOENT')throw resultMissing;try{await readFile(join(directory,'dispatches',entry.id+'.json'));return {status:'INDETERMINATE_NO_RETRY',code:'ACCEPTANCE_RESULT_INDETERMINATE',directory:source};}catch(claimMissing){if(claimMissing.code!=='ENOENT')throw claimMissing;return {status:'NOT_SUBMITTED',directory:source};}}
  }}
}
export async function checkAcceptance({root,directory,caseId,runCommand=command,browserCheck=checkPreview,replay=replayCase}){
 const batch=await verifyBatch(directory),entries=caseId?batch.cases.filter(c=>c.id===caseId):batch.cases;if(!entries.length)fail('ACCEPTANCE_CASE_UNKNOWN');
 const output=join(batch.evidenceDirectory,randomUUID());await mkdir(output,{recursive:true});const results=[];
 for(const entry of entries){const evidenceDirectory=join(output,entry.id);await mkdir(evidenceDirectory);let stage='replay';try{
  const inputs=await caseInputs(directory,entry),derived=await replay({root,directory,entry}),issues=semanticIssues(inputs.expected,derived.compiled.content,derived.compiled.documents);stage='preview';
  const settings=entry.kind==='sdk-settings',args=['--package',entry.packageDirectory,'--out',join(root,'work/panel-acceptance-previews'),'--orientation',entry.orientation,'--contracts',join(inputs.base,'contracts')];
  if(settings)args.push('--content',join(derived.directory,'content.json'),'--layout',join(derived.directory,'layout.json'));else args.push('--run',derived.directory,'--aliases',join(inputs.base,'aliases.json'));
  const built=await runCommand(root,settings?'settings-preview.mjs':'action-preview.mjs',args);if(built.exitCode!==0)fail('ACCEPTANCE_PREVIEW_FAILED');const previewDirectory=resolve(built.stdout.trim());stage='browser';
  const browser=await browserCheck({directory:previewDirectory,evidenceDirectory,orientation:entry.orientation}),result={id:entry.id,status:issues.length||browser.status!=='passed'?'failed':'passed',stage:'complete',planSha256:entry.planSha256,responseSha256:derived.origin.responseSha256,replayDirectory:derived.directory,previewDirectory,semanticIssues:issues,browser,modelCalls:0};results.push(result);await writeFile(join(evidenceDirectory,'report.json'),json(result),{flag:'wx'});
 }catch(e){let original;try{original=await callState(root,directory,entry);}catch{}const code=stage==='replay'&&e.code==='ENOENT'&&original?.code?original.code:e.code??'ACCEPTANCE_CHECK_FAILED';const result={id:entry.id,status:'failed',stage,code,planSha256:entry.planSha256,...(original?{original}:{}),modelCalls:0};results.push(result);await writeFile(join(evidenceDirectory,'report.json'),json(result),{flag:'wx'});}}
 const report={kind:'ui_panel_acceptance_check',version:'1.0',batchSha256:batch.sha256,batchDirectory:resolve(directory),createdAt:new Date().toISOString(),status:results.every(r=>r.status==='passed')?'passed':'failed',results,modelCalls:0};await writeFile(join(output,'report.json'),json(report),{flag:'wx'});return {status:report.status,directory:output,passed:results.filter(r=>r.status==='passed').length,total:results.length};
}
export async function replayAcceptance({root,directory,caseId}){
 const batch=await verifyBatch(directory),entries=caseId?batch.cases.filter(c=>c.id===caseId):batch.cases;if(!entries.length)fail('ACCEPTANCE_CASE_UNKNOWN');const results=[];
 for(const entry of entries)try{const result=await replayCase({root,directory,entry});results.push({id:entry.id,status:result.status,directory:result.directory,responseSha256:result.origin.responseSha256});}catch(e){results.push({id:entry.id,status:'failed',code:e.code??'ACCEPTANCE_REPLAY_FAILED'});}
 return {status:results.every(r=>r.status==='REPLAYED')?'REPLAYED':'failed',results,modelCalls:0};
}
export async function acceptanceReport({root,directory}){
 const batch=await verifyBatch(directory),reports=[];
 try{for(const item of await readdir(batch.evidenceDirectory,{withFileTypes:true})){if(!item.isDirectory()||item.isSymbolicLink())continue;try{const bytes=await readFile(join(batch.evidenceDirectory,item.name,'report.json')),report=JSON.parse(bytes);if(report.kind==='ui_panel_acceptance_check'&&report.batchSha256===batch.sha256)reports.push({...report,reportSha256:hash(bytes),directory:join(batch.evidenceDirectory,item.name)});}catch(e){if(e.code!=='ENOENT')throw e;}}}catch(e){if(e.code!=='ENOENT')throw e;}
 reports.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));const latest=new Map();for(const report of reports)for(const result of report.results)latest.set(result.id,{...result,checkDirectory:report.directory});
 const cases=[];for(const c of batch.cases){let original;try{original=await callState(root,directory,c);}catch(e){original={status:'INVALID',code:e.code??'ACCEPTANCE_RECEIPT_INVALID'};}cases.push({...(latest.get(c.id)??{id:c.id,status:'unchecked',planSha256:c.planSha256}),original});}
 return {kind:'ui_panel_acceptance_summary',batchSha256:batch.sha256,status:cases.every(c=>c.status==='passed')?'passed':'incomplete',passed:cases.filter(c=>c.status==='passed').length,total:cases.length,counts:{passed:cases.filter(c=>c.status==='passed').length,failed:cases.filter(c=>c.status==='failed').length,unchecked:cases.filter(c=>c.status==='unchecked').length,transportFailed:cases.filter(c=>c.original?.status==='FAILED').length,indeterminate:cases.filter(c=>c.original?.status==='INDETERMINATE_NO_RETRY').length},cases,history:reports.map(r=>({directory:r.directory,createdAt:r.createdAt,status:r.status,reportSha256:r.reportSha256})),modelCalls:0};
}
