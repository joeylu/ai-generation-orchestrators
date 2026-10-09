#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createOutputDirectory,harnessRoot,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {alignAudioStudy} from '../examples/audio-aligned-v1/fixture.mjs';
import {alignedAudioHtml} from '../examples/audio-aligned-v1/gallery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {checkApplePanelSamples} from './lib/apple-panel-samples-browser.mjs';
import {checkAudioAlignment} from './lib/audio-aligned-browser.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output');
const source=resolve(args[1]),local=relative(harnessRoot,source);assert(local&&!isAbsolute(local)&&local!=='..'&&!local.startsWith('..\\')&&!local.startsWith('../'));
const output=await createOutputDirectory(args[3]),review=await createOutputDirectory(resolve(output,'review')),core=await loadWorkspaceCore();
const entries={},replays=[],runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources();
for(const name of (await readdir(source)).filter(name=>name.endsWith('.panel.bundle.json'))){
  const bytes=await readFile(resolve(source,name)),bundle=await validatePanelBundle(JSON.parse(bytes.toString('utf8')),core);
  replays.push({path:relative(harnessRoot,resolve(source,name)).replaceAll('\\','/'),sha256:await digestBytes(bytes),bundleSha256:bundle.sha256});
}
for(const mode of ['light','dark']){
  const key=`audio-${mode}`,before=await validatePanelBundle(JSON.parse(await readFile(resolve(source,`audio-${mode}-noto-after.panel.bundle.json`),'utf8')),core);
  const input=alignAudioStudy(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  await validatePanelBundle(after,core);
  for(const field of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[field],before[field]);
  for(const field of ['sections','state','assets','canvas','buttonFonts'])assert.deepEqual(after.spec[field],before.spec[field]);
  assert.equal(after.catalog.themes.find(theme=>theme.id===after.spec.theme.id&&theme.version===after.spec.theme.version).tokens.fontFamily,before.catalog.themes.find(theme=>theme.id===before.spec.theme.id&&theme.version===before.spec.theme.version).tokens.fontFamily);
  for(const resource of before.componentBundle.resources.filter(resource=>resource.path.startsWith('textures/')))assert.deepEqual(after.componentBundle.resources.find(item=>item.path===resource.path),resource);
  entries[key]={id:'audio',title:'声音设置',mode,before,after};
  for(const [id,bundle] of Object.entries({before,after}))await writeNewJson(review,`${key}-${id}.panel.bundle.json`,bundle);
  const unityKit=await createUnityKitFiles(after,core,unitySources),delivery=await createPanelDelivery(after,core,{runtime,unityKit});
  await writeFile(resolve(review,`${key}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
}
const {build}=await loadWorkspaceTool('vite');
const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
  lib:{entry:resolve(harnessRoot,'examples/audio-aligned-v1/review.mjs'),name:'AudioAlignedReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(item=>item.output);assert.equal(chunks.length,1);
await writeFile(resolve(review,'review.js'),chunks[0].code,{flag:'wx'});await writeFile(resolve(review,'index.html'),alignedAudioHtml(entries),{flag:'wx'});await writeNewJson(review,'samples.json',entries);
const browser=await checkApplePanelSamples(review,entries,core),alignment=await checkAudioAlignment(review,entries);
for(const replay of replays)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,replay.path))),replay.sha256);
const files=[];for(const path of ['src/aligned-settings-presentation.mjs','src/compiler.mjs','src/panel-presentation.mjs','src/panel-visuals.mjs','src/catalog.mjs','src/unity-export.mjs','examples/audio-aligned-v1/fixture.mjs','examples/audio-aligned-v1/gallery.mjs','examples/audio-aligned-v1/review.mjs','scripts/build-audio-aligned.mjs','scripts/lib/audio-aligned-browser.mjs','adapters/unity/Editor/PanelPrefabBuilder.cs'])files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
const report={status:'PASS',kind:'LOCAL_ALIGNED_AUDIO_STUDY',samples:2,modelCalls:0,imageGenerationCalls:0,browserChecks:browser.checks.length+alignment.checks.length,actualZipDownloads:2,strictSourceReplays:replays.length,replays,files,
  compilerVersion:'0.25.0',productionDefaultChanged:false,fontPortability:'environment-family',highDpi:'EXISTING_1X_LIMITATION',humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',review:'review/index.html?panel=audio-dark'};
await writeNewJson(output,'study-report.json',report);process.stdout.write(JSON.stringify(report)+'\n');
