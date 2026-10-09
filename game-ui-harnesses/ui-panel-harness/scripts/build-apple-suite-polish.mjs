#!/usr/bin/env node
/** Explicit local fixture study; all artifacts pass the existing export and browser gates. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createOutputDirectory,harnessRoot,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {polishAppleSuite,suiteSamples} from '../examples/apple-suite-polish-v1/fixture.mjs';
import {APPLE_SUITE_RULES,appleSuitePalette} from '../examples/apple-suite-polish-v1/art-direction.mjs';
import {comparisonHtml,overviewHtml} from '../examples/apple-suite-polish-v1/gallery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {checkApplePanelSamples} from './lib/apple-panel-samples-browser.mjs';
import {checkAppleSuiteOverview} from './lib/apple-suite-overview-browser.mjs';
const args=process.argv.slice(2);
assert(args.length===8&&args[0]==='--source'&&args[2]==='--audio'&&args[4]==='--dialog'&&args[6]==='--output');
const source=resolve(args[1]),audio=resolve(args[3]),dialog=resolve(args[5]);
const output=await createOutputDirectory(args[7]),review=await createOutputDirectory(resolve(output,'review')),core=await loadWorkspaceCore();
const entries={},references=[],replays=[],sourceBytes=new Map();
const readSource=async path=>{
  const localPath=relative(harnessRoot,path);assert(localPath&&!isAbsolute(localPath)&&localPath!=='..'&&!localPath.startsWith('..\\')&&!localPath.startsWith('../'));
  const bytes=await readFile(path),bundle=await validatePanelBundle(JSON.parse(bytes.toString('utf8')),core);
  const sha256=await digestBytes(bytes);sourceBytes.set(path,sha256);
  replays.push({path:localPath.replaceAll('\\','/'),sha256,bundleSha256:bundle.sha256});return bundle;
};
const runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources();
for(const mode of ['light','dark'])for(const sample of suiteSamples){
  const key=`${sample.id}-${mode}`,before=await readSource(sample.id==='audio'?resolve(audio,`s1-${mode}.panel.bundle.json`):resolve(source,`${key}-after.panel.bundle.json`));
  if(sample.id!=='audio')await readSource(resolve(source,`${key}-before.panel.bundle.json`));
  const input=polishAppleSuite(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  await validatePanelBundle(after,core);
  for(const field of ['state','bindings','actions','assetClosure'])assert.deepEqual(before[field],after[field]);
  assert.deepEqual(before.spec.sections.flatMap(section=>section.rows),after.spec.sections.flatMap(section=>section.rows));
  if(sample.id==='exit')assert.equal(after.sha256,(await readSource(resolve(dialog,`${key}-after.panel.bundle.json`))).sha256,'reviewed dialog must remain exact');
  entries[key]={...sample,mode,before,after};
  for(const [id,bundle] of Object.entries({before,after}))await writeNewJson(review,`${key}-${id}.panel.bundle.json`,bundle);
  const unityKit=await createUnityKitFiles(after,core,unitySources),delivery=await createPanelDelivery(after,core,{runtime,unityKit});
  await writeFile(resolve(review,`${key}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
  references.push({key,beforeSha256:before.sha256,afterSha256:after.sha256});
}
const {build}=await loadWorkspaceTool('vite');
const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
  lib:{entry:resolve(harnessRoot,'examples/apple-panel-samples-v1/review.mjs'),name:'AppleSuiteReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(item=>item.output);assert.equal(chunks.length,1);
await writeFile(resolve(review,'review.js'),chunks[0].code,{flag:'wx'});
await writeFile(resolve(review,'index.html'),comparisonHtml(entries),{flag:'wx'});
await writeNewJson(review,'samples.json',entries);
await writeNewJson(output,'art-direction.json',{rules:APPLE_SUITE_RULES,palettes:{light:appleSuitePalette('light'),dark:appleSuitePalette('dark')}});
const browser=await checkApplePanelSamples(review,entries,core);
await writeFile(resolve(review,'overview.html'),overviewHtml(),{flag:'wx'});
const overview=await checkAppleSuiteOverview(review);
// Prove the read-only sources were retained byte for byte throughout the study.
for(const [path,sha256] of sourceBytes)assert.equal(await digestBytes(await readFile(path)),sha256);
const files=[];
for(const path of ['examples/apple-suite-polish-v1/art-direction.mjs','examples/apple-suite-polish-v1/fixture.mjs','examples/apple-suite-polish-v1/gallery.mjs','examples/apple-dialog-polish-v1/fixture.mjs','examples/apple-panel-samples-v1/review.mjs','scripts/build-apple-suite-polish.mjs','scripts/lib/apple-suite-overview-browser.mjs','scripts/lib/apple-panel-samples-browser.mjs','src/compiler.mjs','src/grouped-presentation.mjs','src/focused-presentation.mjs','src/state.mjs','src/panel-visuals.mjs'])
  files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
await writeNewJson(output,'study-report.json',{status:'PASS',kind:'LOCAL_APPLE_SUITE_POLISH',panelTypes:6,modes:2,compilerVersions:['0.24.0','0.18.0'],modelCalls:0,imageGenerationCalls:0,
  browserChecks:browser.checks.length+overview.checks.length,actualZipDownloads:12,strictSourceReplays:replays.length,references,replays,files,humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',productionDefaultChanged:false,review:'review/overview.html'});
process.stdout.write(JSON.stringify({status:'PASS',samples:12,browserChecks:browser.checks.length+overview.checks.length,strictSourceReplays:replays.length,modelCalls:0,review:'review/overview.html'})+'\n');
