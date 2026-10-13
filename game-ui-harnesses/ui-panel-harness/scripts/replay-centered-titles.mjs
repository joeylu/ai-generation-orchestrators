/** Rebuild saved accepted bundles under the versioned title default; no inference or authored changes. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {validatePanelBundle,createPanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const source=resolve(args[1]),original=await readJson(join(source,'input-adaptability-report.json'));
assert.equal(original.cohort,'reference-eight-v1');assert.equal(original.pass,8);
const output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore(),runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),results=[];
for(const item of original.results){
  const bytes=await readFile(join(source,item.id,'panel.bundle.json')),before=await validatePanelBundle(JSON.parse(bytes),core);
  const bundle=await createPanelBundle(before.spec,before.catalog,core,before.state,panelBundleAssetInputs(before,core));
  assert.equal(bundle.compilerVersion,'0.32.0');assert.deepEqual(bundle.spec,before.spec);assert.deepEqual(bundle.state,before.state);
  assert.deepEqual(bundle.actions,before.actions);assert.deepEqual(bundle.bindings,before.bindings);assert.deepEqual(bundle.componentBundle,before.componentBundle);
  const directory=await createOutputDirectory(join(output,item.id)),kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
  const zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(directory,'panel.bundle.json',bundle);await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
  for(const [name,value]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(p=>p&&!['.','..'].includes(p)));const path=join(directory,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});}
  await writeNewJson(directory,'replay-evidence.json',{kind:'DETERMINISTIC_CENTERED_TITLE_DEFAULT',originalPanelSha256:before.sha256,originalFileSha256:await digestBytes(bytes),
    originalCompiler:before.compilerVersion,compiler:bundle.compilerVersion,authoredSpecStateActionsBindingsAndTreeUnchanged:'PASS',realModelCalls:0});
  results.push({id:item.id,status:'PASS',outcome:'READY_TO_COMPILE',delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',cohort:original.cohort,status:'PASS_BEFORE_BROWSER',planSha256:original.planSha256,
  realModelCalls:0,originalRealModelCalls:original.realModelCalls,automaticRetries:0,pass:results.length,fail:0,results});
console.log(JSON.stringify({status:'REPLAY_PASS',panels:results.length,realModelCalls:0}));
