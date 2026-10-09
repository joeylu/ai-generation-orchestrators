#!/usr/bin/env node
/** Saved bundles and deterministic control artwork only; no model transport or image service. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readJson,writeNewJson,createOutputDirectory,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {sliderClarityStudy} from '../examples/slider-clarity-v1/fixture.mjs';
import {buildArtSkillReview} from './lib/art-skill-review.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output');
const source=resolve(args[1]),output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore(),baselines={},bundles={};
for(const mode of ['light','dark']){
  baselines[mode]=await validatePanelBundle(await readJson(resolve(source,`s1-${mode}.panel.bundle.json`)),core);
  const input=sliderClarityStudy(baselines[mode]);
  bundles[mode]=await createPanelBundle(input.spec,input.catalog,core,baselines[mode].state,panelBundleAssetInputs(baselines[mode],core));
  await validatePanelBundle(bundles[mode],core);
}
const review=await buildArtSkillReview({baselines,candidates:[{id:'s1',label:'清晰滑块',bundles}],output:resolve(output,'review'),core,fixture:true,
  study:{title:'声音设置 · 滑块清晰度',caption:'圆钮增加清晰边缘与轻微投影，轨道加深并略微加粗。可切换当前稿与浅深色试玩。',sliderRefinement:true}});
const files=[];for(const path of ['src/raised-slider.mjs','src/minimal-skin.mjs','src/raster-skin.mjs','src/compiler.mjs','src/catalog.mjs','examples/slider-clarity-v1/fixture.mjs','scripts/lib/slider-clarity-study.mjs','scripts/lib/art-skill-review.mjs','scripts/build-slider-clarity-review.mjs'])
  files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
await writeNewJson(output,'study-report.json',{status:review.status,kind:'LOCAL_SLIDER_CLARITY_STUDY',modelCalls:0,imageGenerationCalls:0,checks:review.checks.length,
  sourceBundles:Object.fromEntries(Object.entries(baselines).map(([mode,bundle])=>[mode,bundle.sha256])),files,
  humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',productionDefaultChanged:false,review:'review/index.html'});
process.stdout.write(JSON.stringify({status:review.status,checks:review.checks.length,modelCalls:0,review:'review/index.html'})+'\n');
