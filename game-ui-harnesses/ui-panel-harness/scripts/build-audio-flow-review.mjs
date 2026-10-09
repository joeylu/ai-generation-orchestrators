#!/usr/bin/env node
/** Existing PanelSpec/Pixi/UGUI playback; a local layout fixture, no model or media transport. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readJson,writeNewJson,createOutputDirectory,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {audioFlowStudy} from '../examples/audio-flow-v1/fixture.mjs';
import {buildArtSkillReview} from './lib/art-skill-review.mjs';
const args=process.argv.slice(2);assert(args.length===4&&args[0]==='--source'&&args[2]==='--output');
const source=resolve(args[1]),output=await createOutputDirectory(args[3]),core=await loadWorkspaceCore(),baselines={},bundles={};
for(const mode of ['light','dark']){
  baselines[mode]=await validatePanelBundle(await readJson(resolve(source,`s1-${mode}.panel.bundle.json`)),core);
  const input=audioFlowStudy(baselines[mode]);
  bundles[mode]=await createPanelBundle(input.spec,input.catalog,core,baselines[mode].state,panelBundleAssetInputs(baselines[mode],core));
  await validatePanelBundle(bundles[mode],core);
}
const review=await buildArtSkillReview({baselines,candidates:[{id:'s1',label:'连续布局',bundles}],output:resolve(output,'review'),core,fixture:true,
  study:{title:'声音设置 · 布局精修',caption:'音量与静音归为一组，恢复默认回到底部操作区。沿用当前图标、字体和滑块，可切换上一版比较。',audioFlow:true,sliderInteractionChecks:true}});
const files=[];for(const path of ['examples/audio-flow-v1/fixture.mjs','scripts/lib/audio-flow-study.mjs','scripts/lib/art-skill-review.mjs','scripts/build-audio-flow-review.mjs','src/flow-layout.mjs','src/grouped-presentation.mjs','src/panel-presentation.mjs','src/compiler.mjs'])
  files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
await writeNewJson(output,'study-report.json',{status:review.status,kind:'LOCAL_AUDIO_FLOW_STUDY',compilerVersion:'0.23.0',modelCalls:0,imageGenerationCalls:0,checks:review.checks.length,
  sourceBundles:Object.fromEntries(Object.entries(baselines).map(([mode,bundle])=>[mode,bundle.sha256])),files,
  humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',productionDefaultChanged:false,review:'review/index.html'});
process.stdout.write(JSON.stringify({status:review.status,checks:review.checks.length,modelCalls:0,review:'review/index.html'})+'\n');
