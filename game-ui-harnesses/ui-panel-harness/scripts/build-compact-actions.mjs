#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createOutputDirectory,harnessRoot,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {compactActionsStudy,compactActionSamples} from '../examples/compact-actions-v1/fixture.mjs';
import {compactActionsHtml} from '../examples/compact-actions-v1/gallery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {checkApplePanelSamples} from './lib/apple-panel-samples-browser.mjs';
import {checkCompactActions} from './lib/compact-actions-browser.mjs';
const args=process.argv.slice(2);assert(args.length===6&&args[0]==='--suite'&&args[2]==='--typography'&&args[4]==='--output');
const suite=resolve(args[1]),typography=resolve(args[3]),output=await createOutputDirectory(args[5]);
const review=await createOutputDirectory(resolve(output,'review')),core=await loadWorkspaceCore(),entries={},replays=[];
const readSource=async path=>{
  const local=relative(harnessRoot,path);assert(local&&!isAbsolute(local)&&local!=='..'&&!local.startsWith('..\\')&&!local.startsWith('../'));
  const bytes=await readFile(path),bundle=await validatePanelBundle(JSON.parse(bytes.toString('utf8')),core);
  replays.push({path:local.replaceAll('\\','/'),sha256:await digestBytes(bytes),bundleSha256:bundle.sha256});return bundle;
};
const runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources();
for(const mode of ['light','dark'])for(const sample of compactActionSamples){
  const key=`${sample.id}-${mode}`,before=await readSource(sample.id==='pause'?resolve(suite,`${key}-after.panel.bundle.json`):resolve(typography,`exit-${mode}-noto-after.panel.bundle.json`));
  const input=compactActionsStudy(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));await validatePanelBundle(after,core);
  for(const field of ['state','bindings','actions','assetClosure','compilerVersion','catalog'])assert.deepEqual(after[field],before[field]);
  for(const field of ['state','assets','canvas','theme','buttonFonts'])assert.deepEqual(after.spec[field],before.spec[field]);
  const normalized=structuredClone(after.spec.sections);if(sample.id==='exit'){
    assert.equal(after.spec.sections[0].rows[0].label+'\n'+after.spec.sections[0].rows[0].text,before.spec.sections[0].rows[0].text);
    Object.assign(normalized[0].rows[0],{label:before.spec.sections[0].rows[0].label,text:before.spec.sections[0].rows[0].text});
  }
  assert.deepEqual(normalized,before.spec.sections);
  entries[key]={...sample,mode,before,after};
  for(const [id,bundle] of Object.entries({before,after}))await writeNewJson(review,`${key}-${id}.panel.bundle.json`,bundle);
  const unityKit=await createUnityKitFiles(after,core,unitySources),delivery=await createPanelDelivery(after,core,{runtime,unityKit});
  await writeFile(resolve(review,`${key}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
}
const {build}=await loadWorkspaceTool('vite');
const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
  lib:{entry:resolve(harnessRoot,'examples/compact-actions-v1/review.mjs'),name:'CompactActionsReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(item=>item.output);assert.equal(chunks.length,1);
await writeFile(resolve(review,'review.js'),chunks[0].code,{flag:'wx'});await writeFile(resolve(review,'index.html'),compactActionsHtml(entries),{flag:'wx'});await writeNewJson(review,'samples.json',entries);
const browser=await checkApplePanelSamples(review,entries,core),layout=await checkCompactActions(review,entries);
for(const replay of replays)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,replay.path))),replay.sha256);
const files=[];for(const path of ['examples/compact-actions-v1/fixture.mjs','examples/compact-actions-v1/gallery.mjs','examples/compact-actions-v1/review.mjs','scripts/build-compact-actions.mjs','scripts/lib/compact-actions-browser.mjs','scripts/lib/apple-panel-samples-browser.mjs','src/compiler.mjs','src/panel-presentation.mjs','src/focused-presentation.mjs','src/panel-visuals.mjs','src/pixi-panel-instance.mjs','src/unity-export.mjs'])files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
const report={status:'PASS',kind:'LOCAL_COMPACT_ACTIONS_STUDY',samples:4,panelTypes:2,modes:2,modelCalls:0,imageGenerationCalls:0,browserChecks:browser.checks.length+layout.checks.length,actualZipDownloads:4,strictSourceReplays:replays.length,replays,files,
  productionSourceChanged:false,productionDefaultChanged:false,fontPortability:'environment-family',highDpi:'EXISTING_1X_LIMITATION',humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',review:'review/index.html?panel=pause-dark'};
await writeNewJson(output,'study-report.json',report);process.stdout.write(JSON.stringify({status:report.status,samples:report.samples,browserChecks:report.browserChecks,strictSourceReplays:report.strictSourceReplays,modelCalls:0,review:report.review})+'\n');
