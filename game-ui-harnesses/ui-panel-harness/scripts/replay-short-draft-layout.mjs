/** Explicit offline treatment of this reviewed short-request cohort, not another model attempt. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {validatePanelBundle,createPanelBundle} from '../src/panel-bundle.mjs';
import {fitDraftPanelLayout} from '../src/draft-layout.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {digestBytes,digestJson} from '../src/canonical.mjs';
import {businessFacts} from './lib/input-adaptability-oracle.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===6&&args[0]==='--run'&&args[2]==='--audit'&&args[4]==='--output');
const source=resolve(args[1]),audit=await readJson(resolve(args[3],'audit.json'));
const originalBytes=await readFile(join(source,'input-adaptability-report.json')),original=JSON.parse(originalBytes);
assert.equal(await digestBytes(originalBytes),audit.sourceReportSha256);
assert.equal(original.planSha256,'d16d871a68157910b77eb90b79e49c7b1f30a79aa6d5b8684c537013cc43a6ba');
assert.equal(original.cohort,'short-input-v1');assert.equal(audit.sourceFingerprint,'PASS');
const plan=await readJson(join(source,'approved-plan.json'));
// This exact reviewed dataset contains no user-specified geometry. No inference for other requests.
assert.equal(plan.sha256,original.planSha256);
const output=await createOutputDirectory(args[5]),core=await loadWorkspaceCore(),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),results=[];
for(const item of original.results){
  if(!item.delivery&&item.code!=='CONTROL_WIDTH'){
    const {receipt,...rest}=item;results.push({...rest,originalStatus:item.status});continue;
  }
  let bytes,spec,catalog,state,before;
  if(item.delivery){
    bytes=await readFile(join(source,item.id,'panel.bundle.json'));before=await validatePanelBundle(JSON.parse(bytes),core);
    ({spec,catalog,state}=before);
  }else{
    const attempts=(await readdir(join(source,item.id))).filter(name=>name.startsWith('codex-'));assert.equal(attempts.length,1);
    const attempt=join(source,item.id,attempts[0]);bytes=await readFile(join(attempt,'proposal.json'));
    const proposal=JSON.parse(bytes),context=await readJson(join(attempt,'planning-context.json'));
    assert.equal(await digestJson(proposal),item.receipt.proposalSha256);spec=proposal.spec;catalog=context.catalog;
  }
  const fitted=fitDraftPanelLayout(spec,catalog,core,{mutableDimensions:['width','maxHeight','canvasWidth','canvasHeight']});
  assert.equal(fitted.evidence.status,'CONTENT_VISIBLE');assert.deepEqual(businessFacts(fitted.spec),businessFacts(spec));
  const bundle=await createPanelBundle(fitted.spec,catalog,core,state);await validatePanelBundle(bundle,core);
  if(before){assert.deepEqual(bundle.state,before.state);assert.deepEqual(bundle.actions,before.actions);assert.deepEqual(bundle.bindings,before.bindings);}
  const directory=await createOutputDirectory(join(output,item.id)),kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
  const zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(directory,'panel.bundle.json',bundle);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
  for(const [name,value]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(p=>p&&!['.','..'].includes(p)));const path=join(directory,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});}
  await writeNewJson(directory,'replay-evidence.json',{kind:'DETERMINISTIC_DRAFT_LAYOUT_REPLAY',originalFileSha256:await digestBytes(bytes),originalStatus:item.status,originalCode:item.code??null,
    originalPlanSha256:original.planSha256,...fitted.evidence,businessStateAndActionsPreserved:true});
  results.push({id:item.id,status:'PASS',outcome:'DETERMINISTIC_LAYOUT_REPLAY',originalStatus:item.status,originalCode:item.code??null,changes:fitted.evidence.changes,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',cohort:original.cohort,status:'PARTIAL_REPLAY_ORIGINAL_FAILURES_PRESERVED',planSha256:original.planSha256,
  realModelCalls:0,originalRealModelCalls:original.realModelCalls,automaticRetries:0,results});
console.log(JSON.stringify({replayed:results.filter(item=>item.delivery).length,recoveredWidthFailures:results.filter(item=>item.originalCode==='CONTROL_WIDTH'&&item.delivery).length,changed:results.filter(item=>item.changes?.length).length,realModelCalls:0}));
