/** Explicit offline patches of reviewed drafts. Original model attempts stay immutable. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===6&&args[0]==='--run'&&args[2]==='--audit'&&args[4]==='--output');
const run=resolve(args[1]),audit=await readJson(resolve(args[3],'audit.json')),reportBytes=await readFile(join(run,'input-adaptability-report.json')),original=JSON.parse(reportBytes);
assert.equal(original.planSha256,'fea352a19cbe57d0e1b3647b118e1abebd247bcd7e13b3859f8eecc1d14b5ecd');
assert.equal(audit.sourceReportSha256,await digestBytes(reportBytes));assert.equal(audit.receiptIntegrity,'PASS');assert.equal(audit.sourceFingerprint,'PASS');
const output=await createOutputDirectory(args[5]),core=await loadWorkspaceCore(),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),results=[];
for(const id of ['G45','G49','G54']){
  const sourceBytes=await readFile(join(run,id,'panel.bundle.json')),before=await validatePanelBundle(JSON.parse(sourceBytes),core),audited=audit.cases.find(x=>x.id===id);
  assert.equal(audited.panelSha256,before.sha256);assert.equal(audited.request,id==='G45'?'做个邮件详情面板':id==='G49'?'做个游戏登录面板':'做个退出游戏确认框');
  const rows=before.spec.sections.flatMap(s=>s.rows);let operations,reason;
  if(id==='G45'){
    const text=rows.find(row=>row.kind==='text'&&row.label==='邮件内容');assert(text);assert.equal(text.text,'【示例邮件】感谢你参与边境巡逻。请查看邮件附件，并及时领取。');
    assert(rows.some(row=>row.kind==='button'&&row.buttonLabel==='关闭'));assert(!rows.some(row=>row.kind==='button'&&/领取/.test(row.buttonLabel)));
    operations=[{op:'set-text',rowId:text.id,text:'【示例邮件】感谢你参与边境巡逻。祝你冒险顺利。'}];
    reason='Remove the unsupported attachment instruction from this unspecified sample copy. Preserve the read-only mail fields and close action.';
  }else if(id==='G49'){
    const inputs=rows.filter(row=>row.kind==='input'),login=rows.find(row=>row.kind==='button'&&row.buttonLabel==='登录');
    assert.equal(inputs.length,2);assert.deepEqual(inputs.map(row=>row.label),['账号','密码']);assert(inputs.every(row=>row.validation.required));assert.equal(login.action.kind,'emit');
    const observation=await readJson('output/common-panel-fixes-login-observation-v1/observation.json');assert.equal(observation.sourceBundleSha256,before.sha256);assert.equal(observation.observed,'EMPTY_REQUIRED_FIELDS_STILL_EMIT_LOGIN_EVENT');
    operations=[{op:'set-button-action',rowId:login.id,action:{kind:'submit',fields:inputs.map(row=>row.bind)}}];
    reason='Make login submit the two existing required Input fields, retaining all other actions and data. No actual authentication is connected.';
  }else{
    const dialog=rows.find(row=>row.kind==='dialog'),exit=rows.find(row=>row.kind==='button'&&row.buttonLabel==='退出游戏');
    assert.equal(rows.length,2);assert(dialog&&exit);assert.equal(dialog.modal,true);assert.equal(before.state[dialog.bind],true);assert.equal(dialog.closeLabel,'继续游戏');
    const section=before.spec.sections.find(section=>section.rows.some(row=>row.id===dialog.id));
    const reference=id=>{const recipe=before.catalog.recipes.find(recipe=>recipe.id===id);assert(recipe);return {id:recipe.id,version:recipe.version};};
    operations=[{op:'remove-row',rowId:dialog.id},
      {op:'add-row',sectionId:section.id,afterRowId:null,state:null,row:{id:'confirmation-copy',kind:'text',label:'提示',recipe:reference('settings.text'),text:dialog.text}},
      {op:'add-row',sectionId:section.id,afterRowId:exit.id,state:null,row:{id:'cancel-exit',kind:'button',label:'',buttonLabel:'取消',recipe:reference('settings.button.secondary'),enabled:true,event:'panel.cancel-exit',action:{kind:'emit'}}}];
    reason='Keep the original exit message and exit action, remove the blocking one-action Dialog and present an explicit cancel action in the same confirmation panel.';
  }
  const patch={patchVersion:'0.1',baseSpecSha256:await digestJson(before.spec),reason,operations},patched=await applyPanelPatch(before.spec,patch);
  const retained=new Set(patched.spec.state.map(field=>field.id)),state=Object.fromEntries(Object.entries(before.state).filter(([field])=>retained.has(field)));
  const after=await createPanelBundle(patched.spec,before.catalog,core,state,panelBundleAssetInputs(before,core),before.compilerVersion);await validatePanelBundle(after,core);
  const expected=structuredClone(before.spec);for(const operation of operations){
    if(operation.op==='remove-row'){const group=expected.sections.find(group=>group.rows.some(row=>row.id===operation.rowId)),row=group.rows.find(row=>row.id===operation.rowId);group.rows=group.rows.filter(row=>row.id!==operation.rowId);expected.state=expected.state.filter(field=>field.id!==row.bind);}
    else if(operation.op==='add-row'){const group=expected.sections.find(group=>group.id===operation.sectionId),at=operation.afterRowId===null?-1:group.rows.findIndex(row=>row.id===operation.afterRowId);group.rows.splice(at+1,0,structuredClone(operation.row));}
    else{const target=expected.sections.flatMap(s=>s.rows).find(row=>row.id===operation.rowId);target[operation.op==='set-text'?'text':'action']=structuredClone(operation.op==='set-text'?operation.text:operation.action);}
  }
  assert.deepEqual(after.spec,expected);assert.deepEqual(after.state,state);if(id!=='G54')assert.deepEqual(after.bindings,before.bindings);assert.deepEqual(after.assetClosure,before.assetClosure);
  const directory=await createOutputDirectory(join(output,id)),kit=await createUnityKitFiles(after,core,sources),delivery=await createPanelDelivery(after,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(directory,'panel.bundle.json',after);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});await writeNewJson(directory,'patch.json',patch);
  for(const [name,value]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(p=>p&&!['.','..'].includes(p)));const path=join(directory,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});}
  const evidence={kind:'EXPLICIT_OFFLINE_PATCH_OF_REVIEWED_REAL_DRAFT_NOT_MODEL_RESULT',id,originalFileSha256:await digestBytes(sourceBytes),originalBundleSha256:before.sha256,patchedBundleSha256:after.sha256,patchSha256:await digestJson(patch),reason,
    originalPlanSha256:original.planSha256,realModelCalls:0,originalAttemptPreserved:true,remainingStateBindingsAssetsAndUnchangedSpecFieldsPreserved:true,
    removedStateFields:before.spec.state.filter(field=>!retained.has(field.id)).map(field=>field.id)};
  await writeNewJson(directory,'repair-evidence.json',evidence);
  results.push({id,status:'PASS',outcome:'OFFLINE_REVIEW_FINDING_PATCH',originalStatus:'PASS',...evidence,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',treatment:'EXPLICIT_PATCH_OF_REVIEWED_COPY_SUBMIT_AND_CONFIRMATION',cohort:'common-panels-fix-v1',status:'PASS_BEFORE_BROWSER',
  planSha256:await digestJson({sourceReportSha256:audit.sourceReportSha256,repairs:results.map(x=>({id:x.id,source:x.originalBundleSha256,patch:x.patchSha256}))}),sourcePlanSha256:original.planSha256,realModelCalls:0,originalRealModelCalls:original.realModelCalls,automaticRetries:0,results});
console.log(JSON.stringify({patched:results.map(x=>x.id),realModelCalls:0,originalAttemptsPreserved:true}));
