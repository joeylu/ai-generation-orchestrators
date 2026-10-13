#!/usr/bin/env node
/** Deterministically re-lower unchanged accepted native intents after the default-canvas repair. */
import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createOutputDirectory,readJson,writeNewJson} from '../src/io.mjs';
import {canonicalJson,digestJson,digestBytes} from '../src/canonical.mjs';
import {materializePanelIntent,validateNativePanelIntentEvidence} from '../src/panel-intent.mjs';
import {validateCodexReceipt} from '../src/codex-planner.mjs';
import {checkPanelProposal} from '../src/proposal.mjs';
import {validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from '../tests/unity-kit-helpers.mjs';

const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--run'&&args[2]==='--output');
const source=resolve(args[1]),original=await readJson(join(source,'input-adaptability-report.json')),plan=await readJson(join(source,'approved-plan.json'));
assert.equal(original.planSha256,plan.sha256);const output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore();
const runtime=await buildDeliveryRuntime(),sources=await readUnityAdapterSources(),pool=await imageAssetPool(),results=[];
for(const item of plan.cases.filter(item=>item.operation==='generate'&&item.expectedOutcome==='READY_TO_COMPILE')){
  const accepted=original.results.find(result=>result.id===item.id);
  if(accepted.status!=='PASS'){results.push({id:item.id,status:'NOT_REPLAYED',reason:'ORIGINAL_BUSINESS_FAILURE_PRESERVED'});continue;}
  const attempt=(await readdir(join(source,item.id),{withFileTypes:true})).filter(item=>item.isDirectory()&&item.name.startsWith('codex-'));assert.equal(attempt.length,1);
  const path=join(source,item.id,attempt[0].name),context=await readJson(join(path,'planning-context.json')),
    intent=await readJson(join(path,'panel-intent.json')),proposal=await readJson(join(path,'proposal.json')),receipt=await readJson(join(path,'codex-receipt.json'));
  validateCodexReceipt(receipt,{contextSha256:context.sha256,proposalSha256:await digestJson(proposal)});assert.deepEqual(receipt,accepted.receipt);
  const originalBundle=await validatePanelBundle(await readJson(join(source,item.id,'panel.bundle.json')),core);
  validateNativePanelIntentEvidence(context,intent);
  const replayed=await materializePanelIntent(context,intent),comparison=structuredClone(replayed);
  // Compare only: the published result below always comes from the untouched native intent.
  // Every authored fact and decision must remain identical; only default canvas height may change.
  comparison.spec.canvas.height=proposal.spec.canvas.height;assert.equal(canonicalJson(comparison),canonicalJson(proposal),'REPLAY_CHANGED_MORE_THAN_DEFAULT_HEIGHT');
  const model=await createWorkbenchModel({catalog:context.catalog,pool},core);
  try{
    assert.deepEqual((await model.prepare(context.request)).context,context);await model.acceptProposal(replayed);
    const bundle=await model.exportPanel();await validatePanelBundle(bundle,core);
    const directory=await createOutputDirectory(join(output,item.id));
    const kit=await createUnityKitFiles(bundle,core,sources),delivery=await createPanelDelivery(bundle,core,{runtime,unityKit:kit});
    const zip=createStoredZip(delivery.contents),files=readStoredZip(zip);
    for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
    await writeNewJson(directory,'panel.bundle.json',bundle);await writeNewJson(directory,'replay-evidence.json',{
      kind:'DETERMINISTIC_DEFAULT_CANVAS_REPAIR',originalPlanSha256:plan.sha256,originalProposalSha256:receipt.proposalSha256,
      originalNativeIntentSha256:await digestBytes(await readFile(join(path,'panel-intent.json'))),
      originalPanelSha256:originalBundle.sha256,
      originalCanvas:proposal.spec.canvas,replayedCanvas:bundle.spec.canvas,unchangedAuthoredFacts:'PASS',realModelCalls:0});
    await writeFile(join(directory,'panel.zip'),zip,{flag:'wx'});
    for(const [name,bytes]of files){assert(/^[A-Za-z0-9_.@/-]+$/.test(name)&&name.split('/').every(part=>part&&!['.','..'].includes(part)));const destination=join(directory,'delivery',name);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes,{flag:'wx'});}
    const checked=await checkPanelProposal(context,replayed);
    results.push({id:item.id,status:'PASS',outcome:checked.status,delivery:{path:'panel.zip',bytes:zip.length,sha256:await digestBytes(zip)},
      originalCanvas:proposal.spec.canvas,replayedCanvas:bundle.spec.canvas,browser:'NOT_RUN'});
  }finally{model.dispose();}
}
await writeNewJson(output,'input-adaptability-report.json',{kind:'DETERMINISTIC_REPLAY_NOT_NEW_MODEL_RESULTS',status:'PASS_BEFORE_BROWSER',planSha256:plan.sha256,
  realModelCalls:0,originalRealModelCalls:original.realModelCalls,automaticRetries:0,results,browser:'NOT_RUN',originalFailureCount:original.fail});
process.stdout.write(JSON.stringify({status:'REPLAY_PASS',panels:results.filter(item=>item.status==='PASS').length,originalFailuresPreserved:original.fail,realModelCalls:0})+'\n');
