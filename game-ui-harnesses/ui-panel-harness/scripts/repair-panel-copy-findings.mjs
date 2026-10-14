/** Explicit post-audit presentation/copy variants. Original attempts and deliveries are read-only. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,writeNewJson,createOutputDirectory,harnessRoot} from '../src/io.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {isMessageText} from '../src/message-text.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===8&&args[0]==='--prepared'&&args[2]==='--run'&&args[4]==='--audit'&&args[6]==='--output');
const plan=await readJson(resolve(args[1],'input-adaptability-plan.json')),run=resolve(args[3]),audit=await readJson(resolve(args[5],'audit.json'));
const reportBytes=await readFile(join(run,'input-adaptability-report.json')),original=JSON.parse(reportBytes);
assert.equal(plan.sha256,'20810fdd77f126e988111a0afd2adea73e9f65e2826ff053b2ad274586cac5fa');assert.equal(original.planSha256,plan.sha256);
assert.equal(original.realModelCalls,8);assert.equal(original.kind,undefined);assert.equal(audit.sourceReportSha256,await digestBytes(reportBytes));
assert.equal(audit.sourceFingerprint,'PASS');assert.equal(audit.receiptIntegrity,'PASS');
const output=await createOutputDirectory(args[7]),core=await loadWorkspaceCore(),runtime=await buildDeliveryRuntime(),unity=await readUnityAdapterSources();
const messageCatalog=await readJson(resolve(harnessRoot,'examples/modern-message-copy.catalog.json')),results=[],sourceCases=[];
for(const entry of plan.cases){
  const id=entry.id,parent=original.results.find(value=>value.id===id),bytes=await readFile(join(run,id,'panel.bundle.json'));
  assert.equal(parent.status,'PASS');const before=await validatePanelBundle(JSON.parse(bytes),core);assert.equal(before.sha256,audit.cases.find(value=>value.id===id).panelSha256);
  let spec=structuredClone(before.spec),catalog=before.catalog,adoption=null,patch=null;
  if(entry.stability.purpose==='exit-confirmation'){
    const copy=spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='text');assert.equal(copy.length,1);
    adoption={kind:'EXPLICIT_MESSAGE_TEXT_RECIPE_ADOPTION',rowId:copy[0].id,from:copy[0].recipe,to:{id:'message.text',version:'0.1.0'}};
    copy[0].recipe=adoption.to;catalog={...messageCatalog,themes:before.catalog.themes};assert(isMessageText(copy[0],catalog));
  }else if(id==='S21'){
    const image=spec.sections.flatMap(section=>section.rows).find(row=>row.kind==='image');assert(image&&image.source===null&&image.label.includes('风语'));
    patch={patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'Keep unbound character placeholder copy neutral after selection changes',operations:[{op:'set-row-label',rowId:image.id,label:'角色立绘占位'}]};
    spec=(await applyPanelPatch(spec,patch)).spec;
  }
  const expected=structuredClone(before.spec);
  if(adoption)expected.sections.flatMap(section=>section.rows).find(row=>row.id===adoption.rowId).recipe=adoption.to;
  if(patch)expected.sections.flatMap(section=>section.rows).find(row=>row.id===patch.operations[0].rowId).label=patch.operations[0].label;
  assert.deepEqual(spec,expected);
  const bundle=await createPanelBundle(spec,catalog,core,before.state,panelBundleAssetInputs(before,core));await validatePanelBundle(bundle,core);
  for(const key of ['actions','bindings','state','assetClosure'])assert.deepEqual(bundle[key],before[key]);if(!adoption&&!patch)assert.deepEqual(bundle,before);
  const directory=await createOutputDirectory(join(output,id)),kit=await createUnityKitFiles(bundle,core,unity),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit}),zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(directory,'panel.bundle.json',bundle);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
  for(const [name,data] of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(part=>part&&!['.','..'].includes(part)));const target=join(directory,'delivery',name);await mkdir(dirname(target),{recursive:true});await writeFile(target,data,{flag:'wx'});}
  const evidence={kind:'EXPLICIT_OFFLINE_COPY_VARIANT_NOT_ORIGINAL_MODEL_RESULT',id,sourcePlanSha256:plan.sha256,sourceBundleSha256:before.sha256,sourceFileSha256:await digestBytes(bytes),
    bundleSha256:bundle.sha256,adoption,patch,changed:Boolean(adoption||patch),originalAttemptsAndStatusesPreserved:true,retainedStateActionsBindingsPreserved:true,realModelCalls:0};
  await writeNewJson(directory,'copy-evidence.json',evidence);
  results.push({id,status:'PASS',outcome:'OFFLINE_EXPLICIT_COPY_VARIANT',...evidence,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});sourceCases.push({id,stability:entry.stability});
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',treatment:'EXPLICIT_PATCH_OF_AUDITED_STABILITY_FINDINGS',cohort:'panel-copy-fix-v1',status:'PASS_BEFORE_BROWSER',sourcePlanSha256:plan.sha256,sourceReportSha256:audit.sourceReportSha256,
  planSha256:await digestJson({parent:audit.sourceReportSha256,variants:results.map(value=>({id:value.id,parent:value.sourceBundleSha256,bundle:value.bundleSha256,adoption:value.adoption,patch:value.patch}))}),
  realModelCalls:0,originalRealModelCalls:8,automaticRetries:0,sourceCases,results});
console.log(JSON.stringify({panels:results.length,changed:results.filter(value=>value.changed).length,realModelCalls:0,originalStatusesPreserved:true}));
