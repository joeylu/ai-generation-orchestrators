#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createOutputDirectory,harnessRoot,writeNewJson} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {typographyStudy,typefaces,typographySamples} from '../examples/apple-typography-v1/fixture.mjs';
import {typographyHtml} from '../examples/apple-typography-v1/gallery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {checkApplePanelSamples} from './lib/apple-panel-samples-browser.mjs';
import {checkAppleTypography} from './lib/apple-typography-browser.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output');
const source=resolve(args[1]),output=await createOutputDirectory(args[3]),review=await createOutputDirectory(resolve(output,'review')),core=await loadWorkspaceCore();
const entries={},references=[],replays=[],runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources();
for(const mode of ['light','dark'])for(const sample of typographySamples){
  const sourcePath=resolve(source,`${sample.id}-${mode}-after.panel.bundle.json`),localPath=relative(harnessRoot,sourcePath);
  assert(localPath&&!isAbsolute(localPath)&&localPath!=='..'&&!localPath.startsWith('..\\')&&!localPath.startsWith('../'));
  const bytes=await readFile(sourcePath),before=await validatePanelBundle(JSON.parse(bytes.toString('utf8')),core);
  replays.push({path:localPath.replaceAll('\\','/'),sha256:await digestBytes(bytes),bundleSha256:before.sha256});
  for(const face of typefaces){
    const key=`${sample.id}-${mode}-${face.id}`,input=typographyStudy(before,face.id),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
    await validatePanelBundle(after,core);
    for(const field of ['state','bindings','actions','assetClosure'])assert.deepEqual(before[field],after[field]);
    assert.deepEqual({...after.spec,theme:before.spec.theme},before.spec);
    const normalized=structuredClone(after.componentBundle.document),oldFamily=before.catalog.themes.find(theme=>theme.id===before.spec.theme.id&&theme.version===before.spec.theme.version).tokens.fontFamily;
    const normalize=node=>{assert.equal(node.props.style.fontFamily,face.family);node.props.style.fontFamily=oldFamily;for(const child of node.children??[])normalize(child);};normalize(normalized.root);
    assert.deepEqual(normalized,before.componentBundle.document);assert.deepEqual(after.componentBundle.resources,before.componentBundle.resources);
    entries[key]={...sample,caption:`${sample.caption} ${face.caption}`,mode,face,before,after};
    for(const [id,bundle] of Object.entries({before,after}))await writeNewJson(review,`${key}-${id}.panel.bundle.json`,bundle);
    const unityKit=await createUnityKitFiles(after,core,unitySources),delivery=await createPanelDelivery(after,core,{runtime,unityKit});
    await writeFile(resolve(review,`${key}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
    references.push({key,beforeSha256:before.sha256,afterSha256:after.sha256});
  }
}
const {build}=await loadWorkspaceTool('vite');
const built=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
  lib:{entry:resolve(harnessRoot,'examples/apple-typography-v1/review.mjs'),name:'AppleTypographyReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(built)?built:[built]).flatMap(item=>item.output);assert.equal(chunks.length,1);
await writeFile(resolve(review,'review.js'),chunks[0].code,{flag:'wx'});
await writeFile(resolve(review,'index.html'),typographyHtml(entries),{flag:'wx'});
await writeNewJson(review,'samples.json',entries);
const browser=await checkApplePanelSamples(review,entries,core),fonts=await checkAppleTypography(review,entries);
for(const replay of replays)assert.equal(await digestBytes(await readFile(resolve(harnessRoot,replay.path))),replay.sha256);
const files=[];for(const path of ['examples/apple-typography-v1/fixture.mjs','examples/apple-typography-v1/gallery.mjs','examples/apple-typography-v1/review.mjs','scripts/build-apple-typography.mjs','scripts/lib/apple-typography-browser.mjs','scripts/lib/apple-panel-samples-browser.mjs','src/compiler.mjs','src/panel-visuals.mjs','src/pixi-panel-instance.mjs','src/panel-viewport.mjs','src/unity-export.mjs'])
  files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
await writeNewJson(output,'study-report.json',{status:'PASS',kind:'LOCAL_APPLE_TYPOGRAPHY_STUDY',panelTypes:3,modes:2,typefaces,modelCalls:0,imageGenerationCalls:0,
  browserChecks:browser.checks.length+fonts.checks.length,actualZipDownloads:12,strictSourceReplays:replays.length,references,replays,files,fontsEmbedded:false,fontPortability:'environment-family',highDpi:'EXISTING_1X_LIMITATION',
  typographyScope:'font family only; original weight, line height, size, layout, copy, assets and business preserved',humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',productionDefaultChanged:false,review:'review/index.html?panel=audio-dark-noto'});
process.stdout.write(JSON.stringify({status:'PASS',samples:12,browserChecks:browser.checks.length+fonts.checks.length,strictSourceReplays:replays.length,modelCalls:0,review:'review/index.html?panel=audio-dark-noto'})+'\n');
