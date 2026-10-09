#!/usr/bin/env node
/** Local vectors and saved bundles through the existing asset/Pixi/UGUI chain. No model transport. */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {readJson,writeNewJson,createOutputDirectory,harnessRoot} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {loadTextureImageAdapter} from '../src/texture-image-adapter.mjs';
import {importAssetBatch,verifyAssetLibrary} from '../src/asset-library.mjs';
import {loadPanelAssets} from '../src/panel-assets-io.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {audioLineIcon,audioLineIconBatch,plainAudioIconStudy} from '../examples/plain-audio-icons-v1/fixture.mjs';
import {buildArtSkillReview} from './lib/art-skill-review.mjs';

const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){assert(['--source','--output','--sharp-module'].includes(args[i])&&args[i+1]&&!options[args[i]]);options[args[i]]=args[i+1];}
assert(options['--source']&&options['--output']);
const source=resolve(options['--source']),output=await createOutputDirectory(options['--output']);
const core=await loadWorkspaceCore(),adapter=await loadTextureImageAdapter(options['--sharp-module']);
const input=await createOutputDirectory(resolve(output,'icon-sources')),batch=audioLineIconBatch();
for(const entry of batch.assets){const mode=entry.variant,name=entry.id.slice(0,-mode.length-1);await writeFile(resolve(input,entry.file),audioLineIcon(name,mode),{flag:'wx'});}
await writeNewJson(input,'assets.json',batch);
const assetsDirectory=resolve(output,'icon-library');
await importAssetBatch(resolve(input,'assets.json'),assetsDirectory,adapter,{id:'audio-line-icons-v1'});
const verified=await verifyAssetLibrary(assetsDirectory,adapter);
assert.equal(verified.index.records.length,6);
for(const record of verified.index.records){const alpha=record.image.alpha;
  assert.equal(alpha.mode,'mixed');assert.equal(alpha.hiddenRgbPixels,0);assert(alpha.transparentPixels>112*112*.65&&alpha.softPixels>0);
  assert(alpha.visibleBounds.x>0&&alpha.visibleBounds.y>0&&alpha.visibleBounds.x+alpha.visibleBounds.width<112&&alpha.visibleBounds.y+alpha.visibleBounds.height<112);
}
const baselines={},bundles={},rowIconReplacements={};
for(const mode of ['light','dark']){
  baselines[mode]=await validatePanelBundle(await readJson(resolve(source,`s1-${mode}.panel.bundle.json`)),core);
  const input=plainAudioIconStudy(baselines[mode],{id:verified.index.id,sha256:verified.index.sha256});
  bundles[mode]=await createPanelBundle(input.spec,input.catalog,core,baselines[mode].state,await loadPanelAssets(input.spec,assetsDirectory,adapter));
  await validatePanelBundle(bundles[mode],core);rowIconReplacements[mode]=input.spec.assets.rowIcons;
}
const review=await buildArtSkillReview({baselines,candidates:[{id:'s1',label:'无底色线性图标',bundles}],output:resolve(output,'review'),core,fixture:true,
  study:{title:'声音设置 · 图标精修',caption:'去掉蓝色底块，统一线宽与留白；浅深色分别使用深墨色与柔白色。可切换当前稿比较。',rowIconReplacements}});
const files=[];for(const path of ['src/compiler.mjs','src/catalog.mjs','examples/plain-audio-icons-v1/fixture.mjs','scripts/lib/row-icon-study.mjs','scripts/build-plain-audio-icon-review.mjs'])
  files.push({path,sha256:await digestBytes(await readFile(resolve(harnessRoot,path)))});
await writeNewJson(output,'study-report.json',{status:review.status,kind:'LOCAL_ICON_STUDY',modelCalls:0,imageGenerationCalls:0,checks:review.checks.length,
  sourceBundles:Object.fromEntries(Object.entries(baselines).map(([mode,bundle])=>[mode,bundle.sha256])),files,library:{id:verified.index.id,sha256:verified.index.sha256},
  vectorChecks:'SIX_SOURCES_REPLAYED; TRANSPARENT_NONEMPTY_ALPHA_CLEAN; PADDED_BOUNDS',rowIconReplacements,
  humanVisualApproval:'NOT_RUN',nativeUnity:'NOT_RUN',gameIntegration:'NOT_RUN',productionDefaultChanged:false,review:'review/index.html'});
process.stdout.write(JSON.stringify({status:review.status,checks:review.checks.length,modelCalls:0,review:'review/index.html'})+'\n');
