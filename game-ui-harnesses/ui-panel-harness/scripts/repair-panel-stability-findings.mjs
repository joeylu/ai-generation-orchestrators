/** Explicit post-audit corrections. Never changes an original attempt or grants model compute. */
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,writeNewJson,createOutputDirectory} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {validatePanelProposal} from '../src/proposal.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===8&&args[0]==='--prepared'&&args[2]==='--run'&&args[4]==='--audit'&&args[6]==='--output');
const prepared=resolve(args[1]),run=resolve(args[3]),audit=await readJson(resolve(args[5],'audit.json')),reportBytes=await readFile(join(run,'input-adaptability-report.json')),original=JSON.parse(reportBytes),plan=await readJson(join(prepared,'input-adaptability-plan.json'));
assert.equal(plan.sha256,'56c0c71b17fdbf0919d4334eadef2834511b180fe369aec602279e565b4df5f0');assert.equal(original.planSha256,plan.sha256);assert.equal(original.realModelCalls,32);assert.equal(original.kind,undefined);
assert.equal(audit.sourceReportSha256,await digestBytes(reportBytes));assert.equal(audit.sourceFingerprint,'PASS');assert.equal(audit.receiptIntegrity,'PASS');
const output=await createOutputDirectory(args[7]),core=await loadWorkspaceCore(),runtime=await buildDeliveryRuntime(),unity=await readUnityAdapterSources(),results=[],sourceCases=[];
for(const id of ['S08','S16','S24','S29','S32']){
  const result=original.results.find(row=>row.id===id),audited=audit.cases.find(row=>row.id===id),entry=plan.cases.find(row=>row.id===id);assert(result&&audited&&entry);
  let before=null,spec,catalog,state,assets,operations,reason,sourceFileSha256,sourceProposalSha256=null;
  if(id==='S29'){
    assert.equal(result.status,'FAIL');assert.equal(result.code,'IMAGE_PLACEHOLDER_LABEL');assert.equal(result.indeterminate,false);assert.equal(entry.stability.purpose,'character-select');
    const attempts=(await readdir(join(run,id),{withFileTypes:true})).filter(item=>item.isDirectory()&&item.name.startsWith('codex-'));assert.equal(attempts.length,1);
    const bytes=await readFile(join(run,id,attempts[0].name,'proposal.json')),proposal=JSON.parse(bytes),context=await readJson(join(prepared,id+'.context.json'));assert.equal(context.assetRetrieval,null);
    await validatePanelProposal(context,proposal);sourceProposalSha256=await digestJson(proposal);assert.equal(sourceProposalSha256,result.receipt.proposalSha256);spec=proposal.spec;catalog=context.catalog;sourceFileSha256=await digestBytes(bytes);
    state=Object.fromEntries(spec.state.map(field=>[field.id,field.initial]));
    const images=spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='image');assert.equal(images.length,1);const image=images[0];
    assert.equal(image.source,null);assert.equal(image.width,128);assert.equal(image.height,160);assert.equal(image.label,'角色立绘占位（示例）');
    operations=[{op:'set-image-properties',rowId:image.id,assetLibrary:null,source:image.source,width:'fill',height:image.height,fit:image.fit}];
    reason='Only expand the unprovided-art placeholder to fill its content width so its unchanged label fits. Retain all other proposed data and creation defaults; this is offline recovery of a failed proposal, not model success.';
  }else{
    assert.equal(result.status,'PASS');assert(audited.interactionReview.flags.some(flag=>flag.code==='CONFIRMATION_CHOICE_NOT_INITIALLY_OPERABLE'));assert.equal(entry.stability.purpose,'exit-confirmation');
    const bytes=await readFile(join(run,id,'panel.bundle.json'));before=await validatePanelBundle(JSON.parse(bytes),core);assert.equal(before.sha256,audited.panelSha256);spec=before.spec;catalog=before.catalog;state=before.state;assets=panelBundleAssetInputs(before,core);sourceFileSha256=await digestBytes(bytes);
    assert.equal(spec.sections.length,1);const section=spec.sections[0];assert.equal(section.rows.length,2);
    const dialog=section.rows.find(row=>row.kind==='dialog'),exit=section.rows.find(row=>row.kind==='button');assert(dialog&&exit);assert.equal(state[dialog.bind],true);assert.equal(dialog.modal,false);assert.equal(exit.action.kind,'emit');
    const recipe=id=>{const selected=catalog.recipes.find(row=>row.id===id);assert(selected);return {id:selected.id,version:selected.version};};
    operations=[{op:'remove-row',rowId:dialog.id},{op:'add-row',sectionId:section.id,afterRowId:null,state:null,row:{id:'confirmation-copy',kind:'text',label:'提示',text:dialog.text,recipe:recipe('settings.text')}},
      {op:'add-row',sectionId:section.id,afterRowId:exit.id,state:null,row:{id:'cancel-exit',kind:'button',label:'',buttonLabel:'取消',enabled:true,event:'panel.cancel-exit',action:{kind:'emit'},recipe:recipe('settings.button.secondary')}}];
    reason='Remove the initially open floating Dialog that covers the exit action. Keep the original question and exit action, and present an explicit cancel event in the same panel.';
  }
  const patch={patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason,operations},patched=await applyPanelPatch(spec,patch),retained=new Set(patched.spec.state.map(field=>field.id));state=Object.fromEntries(Object.entries(state).filter(([field])=>retained.has(field)));
  const expected=structuredClone(spec);
  if(id==='S29')expected.sections.flatMap(section=>section.rows).find(row=>row.kind==='image').width='fill';
  else{const section=expected.sections[0],dialog=section.rows.find(row=>row.kind==='dialog');expected.state=expected.state.filter(field=>field.id!==dialog.bind);section.rows=section.rows.filter(row=>row.id!==dialog.id);section.rows.unshift(structuredClone(operations[1].row));section.rows.push(structuredClone(operations[2].row));}
  assert.deepEqual(patched.spec,expected);
  const bundle=await createPanelBundle(patched.spec,catalog,core,state,assets,'0.34.0');await validatePanelBundle(bundle,core);assert.deepEqual(bundle.state,state);if(before)assert.deepEqual(bundle.assetClosure,before.assetClosure);
  const directory=await createOutputDirectory(join(output,id)),kit=await createUnityKitFiles(bundle,core,unity),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(directory,'panel.bundle.json',bundle);await writeNewJson(directory,'patch.json',patch);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
  for(const [name,bytes]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(part=>part&&!['.','..'].includes(part)));const path=join(directory,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes,{flag:'wx'});}
  const evidence={kind:'EXPLICIT_OFFLINE_VARIANT_NOT_ORIGINAL_MODEL_RESULT',id,sourcePlanSha256:plan.sha256,originalStatus:result.status,sourceBundleSha256:before?.sha256??null,sourceProposalSha256,sourceFileSha256,patchedBundleSha256:bundle.sha256,patchSha256:await digestJson(patch),reason,realModelCalls:0,originalAttemptAndStatusPreserved:true,remainingSpecFieldsAndRetainedStatePreserved:true};
  await writeNewJson(directory,'repair-evidence.json',evidence);results.push({id,status:'PASS',outcome:id==='S29'?'OFFLINE_RECOVERY_OF_FAILED_COMPILE':'OFFLINE_CONFIRMATION_FLOW_PATCH',...evidence,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});sourceCases.push({id,stability:entry.stability});
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',treatment:'EXPLICIT_PATCH_OF_AUDITED_STABILITY_FINDINGS',cohort:'panel-stability-v1',status:'PASS_BEFORE_BROWSER',sourcePlanSha256:plan.sha256,sourceReportSha256:audit.sourceReportSha256,
  planSha256:await digestJson({sourceReportSha256:audit.sourceReportSha256,repairs:results.map(row=>({id:row.id,source:row.sourceFileSha256,patch:row.patchSha256}))}),realModelCalls:0,originalRealModelCalls:32,automaticRetries:0,sourceCases,results});
console.log(JSON.stringify({repaired:results.map(row=>row.id),recoveredFailedProposal:'S29',realModelCalls:0,originalStatusesPreserved:true}));
