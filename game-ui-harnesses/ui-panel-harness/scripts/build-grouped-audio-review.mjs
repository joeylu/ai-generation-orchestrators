#!/usr/bin/env node
/** Existing PanelBundle/Pixi/UGUI path; local authored fixture, no model transport. */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {readJson,writeNewJson,createOutputDirectory,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {buildArtSkillReview} from './lib/art-skill-review.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output');
const source=resolve(args[1]),output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore(),baselines={},bundles={};
for(const mode of ['light','dark']){
  baselines[mode]=await validatePanelBundle(await readJson(resolve(source,`baseline-${mode}.panel.bundle.json`)),core);
  const input=groupedAudioStudy(baselines[mode]);
  bundles[mode]=await createPanelBundle(input.spec,input.catalog,core,baselines[mode].state,panelBundleAssetInputs(baselines[mode],core));
  await validatePanelBundle(bundles[mode],core);
}
const review=await buildArtSkillReview({baselines,candidates:[{id:'s1',label:'Apple 风格试稿',bundles}],output:resolve(output,'review'),core,fixture:true,
  study:{title:'声音设置 · Apple 风格布局',caption:'圆角分组、细分隔线和独立操作区。可切换当前稿与浅深色，直接试玩。'}});
const files=[];for(const path of ['src/grouped-presentation.mjs','src/compiler.mjs','src/minimal-skin.mjs','examples/grouped-audio-v1/fixture.mjs'])
  files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
await writeNewJson(output,'study-report.json',{status:review.status,kind:'LOCAL_LAYOUT_STUDY',modelCalls:0,imageGenerationCalls:0,checks:review.checks.length,
  sourceBundles:Object.fromEntries(Object.entries(baselines).map(([mode,bundle])=>[mode,bundle.sha256])),files,
  humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',productionDefaultChanged:false,
  review:'review/index.html',references:['https://developer.apple.com/design/human-interface-guidelines/layout','https://developer.apple.com/design/human-interface-guidelines/lists-and-tables']});
process.stdout.write(JSON.stringify({status:review.status,checks:review.checks.length,modelCalls:0,review:'review/index.html'})+'\n');
