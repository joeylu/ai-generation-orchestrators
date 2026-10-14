/** Re-run saved accepted native data through current deterministic defaults. No provider access. */
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {readJson,createOutputDirectory,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {validatePanelBundle,createPanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const run=resolve(args[1]),original=await readJson(join(run,'input-adaptability-report.json'));
assert.equal(original.planSha256,'2d00b6eeac00a058b27896d26189ea72682317e5300eb9728b11e24c78ff6e61');
const output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore(),results=[],deliveries=[];
const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources();
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)];
const scrub=spec=>{const copy=structuredClone(spec);delete copy.canvas;delete copy.layout.width;delete copy.layout.maxHeight;return copy;};
for(const item of original.results.filter(x=>x.delivery)){
  const directory=join(run,item.id),attempts=(await readdir(directory)).filter(name=>name.startsWith('codex-'));assert.equal(attempts.length,1);
  const attempt=join(directory,attempts[0]),context=await readJson(join(attempt,'planning-context.json')),nativeBytes=await readFile(join(attempt,'panel-intent.json')),intent=JSON.parse(nativeBytes);
  assert.equal(context.sha256,item.receipt.contextSha256);
  const before=await validatePanelBundle(await readJson(join(directory,'panel.bundle.json')),core),proposal=await materializePanelIntent(context,intent);
  const after=await createPanelBundle(proposal.spec,before.catalog,core,before.state,panelBundleAssetInputs(before,core),before.compilerVersion);await validatePanelBundle(after,core);
  assert.deepEqual(scrub(after.spec),scrub(before.spec));
  for(const field of ['state','actions','bindings','assetClosure'])assert.deepEqual(after[field],before[field]);
  const bodies=new Set(after.spec.tabs?after.spec.tabs.pages.map(p=>item.id+'.page.'+p.id):[item.id+'.body']);
  const bodyScroll=flatten(after.componentBundle.document.root).filter(n=>bodies.has(n.id)&&n.type==='ScrollView').map(n=>n.id);
  const dimensions=b=>({width:b.spec.layout.width,maxHeight:b.spec.layout.maxHeight,canvasWidth:b.spec.canvas.width,canvasHeight:b.spec.canvas.height});
  results.push({id:item.id,status:'PASS',sourceNativeSha256:await digestBytes(nativeBytes),originalBundleSha256:before.sha256,currentBundleSha256:after.sha256,
    requestedDimensions:intent.panel.layout,before:dimensions(before),after:dimensions(after),bodyScroll,businessStateActionsAndAssetsPreserved:true});
  const directoryOut=await createOutputDirectory(join(output,item.id)),kit=await createUnityKitFiles(after,core,sources),delivery=await createPanelDelivery(after,core,{runtime,unityKit:kit});
  const zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
  for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
  await writeNewJson(directoryOut,'panel.bundle.json',after);await writeFile(join(directoryOut,'panel.zip'),zip,{flag:'wx'});
  for(const [name,value]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(p=>p&&!['.','..'].includes(p)));const path=join(directoryOut,'delivery',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,value,{flag:'wx'});}
  const changes=Object.keys(dimensions(before)).filter(key=>dimensions(before)[key]!==dimensions(after)[key]).map(dimension=>({dimension,before:dimensions(before)[dimension],after:dimensions(after)[dimension]}));
  await writeNewJson(directoryOut,'replay-evidence.json',results.at(-1));
  deliveries.push({id:item.id,status:'PASS',outcome:'CURRENT_DEFAULTS_FROM_SAVED_NATIVE_INTENT',originalStatus:item.status,changes,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)}});
}
await writeNewJson(output,'report.json',{kind:'DETERMINISTIC_REVALIDATION_OF_ACCEPTED_NATIVE_INTENTS_NOT_MODEL_RESULTS',realModelCalls:0,sourceRealModelCalls:original.realModelCalls,
  sourcePlanSha256:original.planSha256,status:'PASS',panels:results.length,remainingBodyScroll:results.filter(x=>x.bodyScroll.length).map(x=>x.id),results});
const deliveryResults=original.results.map(item=>deliveries.find(x=>x.id===item.id)??((({receipt,...rest})=>({...rest,originalStatus:item.status}))(item)));
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',treatment:'CURRENT_GENERATION_DEFAULTS_FROM_SAVED_NATIVE_INTENTS',
  cohort:original.cohort,status:'PARTIAL_REPLAY_ORIGINAL_FAILURES_PRESERVED',planSha256:original.planSha256,realModelCalls:0,originalRealModelCalls:original.realModelCalls,
  originalReportSha256:await digestBytes(await readFile(join(run,'input-adaptability-report.json'))),automaticRetries:0,results:deliveryResults});
console.log(JSON.stringify({panels:results.length,changed:results.filter(x=>JSON.stringify(x.before)!==JSON.stringify(x.after)).map(x=>x.id),remainingBodyScroll:results.filter(x=>x.bodyScroll.length).map(x=>x.id),realModelCalls:0}));
