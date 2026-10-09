#!/usr/bin/env node
/** Local deterministic comparisons only. Never invokes a model or rewrites the source. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createOutputDirectory,writeNewJson,harnessRoot} from '../src/io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {menuFixture} from '../examples/menu-defaults-v1/fixture.mjs';
import {menuDefaultsHtml} from '../examples/menu-defaults-v1/gallery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {createPanelDelivery} from '../src/panel-delivery.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {buildDeliveryRuntime} from './build-delivery-runtime.mjs';
import {loadWorkspaceTool} from './lib/workspace-tools.mjs';
import {checkApplePanelSamples} from './lib/apple-panel-samples-browser.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output');
const sourcePath=resolve(args[1]),rel=relative(harnessRoot,sourcePath);assert(rel&&!isAbsolute(rel)&&!rel.startsWith('..'));
const bytes=await readFile(sourcePath),sourceSha256=await digestBytes(bytes),core=await loadWorkspaceCore();
const source=await validatePanelBundle(JSON.parse(bytes.toString('utf8')),core);
const catalog=JSON.parse(await readFile(resolve(harnessRoot,'examples/modern-menu.catalog.json'),'utf8'));
const previous=JSON.parse(await readFile(resolve(harnessRoot,'examples/modern-minimal.catalog.json'),'utf8'));
const output=await createOutputDirectory(args[3]),review=await createOutputDirectory(resolve(output,'review')),entries={};
const spec=structuredClone(source.spec);spec.theme={id:source.spec.theme.id,version:'0.18.0'};
const adapted=await createPanelBundle(spec,catalog,core,source.state,panelBundleAssetInputs(source,core));
assert.deepEqual({...adapted.spec,theme:source.spec.theme},source.spec);
for(const field of ['state','bindings','actions','assetClosure'])assert.deepEqual(adapted[field],source[field]);
entries['saved-dark']={id:'pause',mode:'dark',title:'保留真实规格',caption:'保留真实结果的完整文字、分组标题、显式几何和业务，仅换到新目录复编译；“菜单入口”不会被自动删除。这份派生预览不是新的模型结果。',before:source,after:adapted};
for(const mode of ['dark','light']){
  const themeId=`modern-blue-${mode}`,before=await menuFixture(previous,themeId),after=await menuFixture(catalog,themeId);
  assert.deepEqual(before.spec.sections,after.spec.sections);assert.deepEqual(before.spec.state,after.spec.state);
  entries[`fresh-${mode}`]={id:'pause',mode,title:`新生成夹具 · ${mode==='dark'?'深色':'浅色'}`,caption:'明确编写的原生Intent程序夹具，验证未指定尺寸时的新生成默认：428px完整底板、28px内边距、280×48px按钮。不是模型已遵守提示的证据。',
    before:await createPanelBundle(before.spec,previous,core),after:await createPanelBundle(after.spec,catalog,core)};
}
const runtime=await buildDeliveryRuntime(),unitySources=await readUnityAdapterSources();
for(const [key,entry] of Object.entries(entries)){
  await validatePanelBundle(entry.after,core);await validatePanelBundle(entry.before,core);
  for(const side of ['before','after'])await writeNewJson(review,`${key}-${side}.panel.bundle.json`,entry[side]);
  const unityKit=await createUnityKitFiles(entry.after,core,unitySources),delivery=await createPanelDelivery(entry.after,core,{runtime,unityKit});
  await writeFile(resolve(review,`${key}.zip`),createStoredZip(delivery.contents),{flag:'wx'});
}
const {build}=await loadWorkspaceTool('vite');const result=await build({configFile:false,root:harnessRoot,publicDir:false,logLevel:'silent',build:{write:false,target:'es2022',minify:true,
  lib:{entry:resolve(harnessRoot,'examples/menu-defaults-v1/review.mjs'),name:'MenuDefaultsReview',formats:['iife'],fileName:()=> 'review.js'}}});
const chunks=(Array.isArray(result)?result:[result]).flatMap(item=>item.output);assert.equal(chunks.length,1);
await writeFile(resolve(review,'review.js'),chunks[0].code,{flag:'wx'});await writeFile(resolve(review,'index.html'),menuDefaultsHtml(entries),{flag:'wx'});await writeNewJson(review,'samples.json',entries);
const browser=await checkApplePanelSamples(review,entries,core);assert.equal(await digestBytes(await readFile(sourcePath)),sourceSha256);
await writeNewJson(output,'acceptance.json',{status:'TECHNICAL_PASS_VISUAL_REVIEW_PENDING',modelCalls:0,sourceFile:rel.replaceAll('\\','/'),sourceFileSha256:sourceSha256,sourceBundleSha256:source.sha256,
  samples:3,actualZipDownloads:3,browserChecks:browser.checks.length,sourceRewritten:false,newCompilerVersion:'0.26.0',defaultCatalog:'examples/modern-menu.catalog.json',
  humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',review:'review/index.html?panel=fresh-dark'});
console.log(JSON.stringify({status:'TECHNICAL_PASS_VISUAL_REVIEW_PENDING',samples:3,browserChecks:browser.checks.length,actualZipDownloads:3,modelCalls:0}));
