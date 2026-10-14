/** Offline treatment of this exact audited cohort. Never dispatches or rewrites original attempts. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {fitDraftPanelLayout} from '../src/draft-layout.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {COMMON_GAME_PANEL_SUITE} from '../examples/common-game-panels-v1/suite.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===6&&args[0]==='--run'&&args[2]==='--audit'&&args[4]==='--output');
const source=resolve(args[1]),audit=await readJson(resolve(args[3],'audit.json'));
const bytes=await readFile(join(source,'input-adaptability-report.json')),original=JSON.parse(bytes);
assert.equal(await digestBytes(bytes),audit.sourceReportSha256);assert.equal(audit.sourceFingerprint,'PASS');assert.equal(audit.receiptIntegrity,'PASS');
assert.equal(original.planSha256,'2d00b6eeac00a058b27896d26189ea72682317e5300eb9728b11e24c78ff6e61');
assert.equal(original.cohort,'common-panels-v1');assert.equal(original.results.length,64);
const plan=await readJson(join(source,'approved-plan.json'));assert.equal(plan.sha256,original.planSha256);
const {sha256,...planPayload}=plan;assert.equal(await digestJson(planPayload),sha256);
// No inference for arbitrary requests: these exact reviewed 64 requests contain no dimensions.
assert.deepEqual(plan.cases.map(x=>x.id),COMMON_GAME_PANEL_SUITE.map(x=>x.id));
for(const item of COMMON_GAME_PANEL_SUITE){
  const audited=audit.cases.find(x=>x.id===item.id),planned=plan.cases.find(x=>x.id===item.id),result=original.results.find(x=>x.id===item.id);
  assert.equal(audited.request,item.request.text);assert.equal(audited.contextSha256,planned.contextSha256);
  assert.equal(result.receipt.contextSha256,planned.contextSha256);assert.equal(audited.invocations,1);
}
const output=await createOutputDirectory(args[5]),core=await loadWorkspaceCore(),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),results=[];
for(const item of original.results){
  if(!item.delivery){const {receipt,...rest}=item;results.push({...rest,originalStatus:item.status});continue;}
  const originalBytes=await readFile(join(source,item.id,'panel.bundle.json')),before=await validatePanelBundle(JSON.parse(originalBytes),core);
  assert.equal(before.sha256,audit.cases.find(x=>x.id===item.id).panelSha256);
  const assets=panelBundleAssetInputs(before,core),fitted=fitDraftPanelLayout(before.spec,before.catalog,core,
    {policy:'draft-content-fit-v2',assetClosure:assets?.closure,mutableDimensions:['width','maxHeight','canvasWidth','canvasHeight']});
  assert.equal(fitted.evidence.status,'CONTENT_VISIBLE');
  const scrub=spec=>{const result=structuredClone(spec);delete result.canvas;delete result.layout.width;delete result.layout.maxHeight;return result;};
  assert.deepEqual(scrub(fitted.spec),scrub(before.spec));
  const bundle=await createPanelBundle(fitted.spec,before.catalog,core,before.state,assets,before.compilerVersion);await validatePanelBundle(bundle,core);
  for(const field of ['state','actions','bindings','assetClosure'])assert.deepEqual(bundle[field],before[field]);
  const directory=await createOutputDirectory(join(output,item.id)),kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
  const zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(directory,'panel.bundle.json',bundle);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
  for(const [name,value]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(p=>p&&!['.','..'].includes(p)));const path=join(directory,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});}
  await writeNewJson(directory,'replay-evidence.json',{kind:'DETERMINISTIC_COMMON_LAYOUT_REPLAY',originalFileSha256:await digestBytes(originalBytes),originalBundleSha256:before.sha256,
    originalPlanSha256:original.planSha256,...fitted.evidence,businessStateActionsAndAssetsPreserved:true});
  results.push({id:item.id,status:'PASS',outcome:'DETERMINISTIC_LAYOUT_REPLAY',originalStatus:item.status,changes:fitted.evidence.changes,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',cohort:original.cohort,status:'PARTIAL_REPLAY_ORIGINAL_FAILURES_PRESERVED',planSha256:original.planSha256,
  realModelCalls:0,originalRealModelCalls:original.realModelCalls,originalReportSha256:audit.sourceReportSha256,automaticRetries:0,results});
console.log(JSON.stringify({replayed:results.filter(x=>x.delivery).length,changed:results.filter(x=>x.changes?.length).length,preservedFailures:results.filter(x=>x.status==='FAIL').length,realModelCalls:0}));
