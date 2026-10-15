import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {core,nodesOf} from './helpers.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {composeCardSpec} from './card-composition-fixture.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {buildCodexPlanningPrompt} from '../src/codex-planner.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {CARD_TARGET_DEFAULT_SUITE} from '../examples/card-target-default-v1/suite.mjs';
const fixture=await readJson(new URL('./fixtures/card-target-regressions-v1.json',import.meta.url)),catalog=await readJson(new URL('../examples/modern-readable-game-card-layout.catalog.json',import.meta.url)),pool=await loadBundledCoreAssets();
test('the original narrow real task result stays exactly reproducible',async()=>{
 const {record}=fixture,bundle=await createPanelBundle(record.spec,fixture.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(bundle.sha256,record.sourceSha256);assert.equal(bundle.spec.layout.width,420);assert.equal(bundle.spec.layout.body.kind,'column');
});
test('an explicit offline three-column task variant preserves every row, progress state, action and asset',async()=>{
 const {record}=fixture,before=await createPanelBundle(record.spec,fixture.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool)),spec=composeCardSpec(record,catalog,{kind:'row'}),after=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));
 assert.equal(spec.layout.body.kind,'row');assert.equal(spec.layout.width,1000);assert(spec.canvas.height<record.spec.canvas.height);assert.deepEqual(spec.sections,record.spec.sections);
 for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
 const nodes=nodesOf(after.componentBundle.document),panels=spec.sections.map(section=>nodes.find(node=>node.id===spec.id+'.section.'+section.id));assert.equal(new Set(panels.map(node=>node.layout.y)).size,1);assert.equal(new Set(panels.map(node=>node.layout.x)).size,3);assert(nodes.filter(node=>node.type==='Text').every(node=>node.props.style.fontSize>=24));
});
test('the shared prompt states the missing-target default while explicit mobile and authored edits retain priority',async()=>{
 const model=await createWorkbenchModel({catalog,pool},core);try{for(const item of CARD_TARGET_DEFAULT_SUITE){const {context}=await model.prepare(item.request),prompt=await buildCodexPlanningPrompt(context);assert(prompt.includes('When no target is specified, treat repeated whole-item sections as desktop/landscape collections'));assert(prompt.includes('Explicit mobile, portrait or single-column requests use a column'));assert(prompt.includes(item.request.text));assert(!prompt.includes('每日登录（样例）'));}}
 finally{model.dispose();}
 assert(themePlanningGuide(catalog).includes('When no target is specified, repeated whole-item sections default to desktop/landscape'));
 assert(themePlanningGuide(catalog,catalog.themes[0]).includes('Preserve authored composition in unrelated edits'));
 const mobile=composeCardSpec(fixture.record,catalog,{kind:'column',settings:{width:420,canvasWidth:452}});assert.equal(mobile.layout.width,420);assert.equal(mobile.layout.body.kind,'column');assert.deepEqual(mobile.sections,fixture.record.spec.sections);
});
