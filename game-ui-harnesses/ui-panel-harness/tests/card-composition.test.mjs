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
import {digestBytes} from '../src/canonical.mjs';
import {DEFAULT_PANEL_CATALOG} from '../src/default-catalog.mjs';
const catalog=await readJson(new URL('../examples/modern-readable-game-card-layout.catalog.json',import.meta.url)),fixture=await readJson(new URL('./fixtures/card-composition-regressions-v1.json',import.meta.url)),pool=await loadBundledCoreAssets();
for(const record of fixture.records)test(`${record.id}: original 0.45 bundle and production prompt remain exact; explicit composition preserves all facts and events`,async()=>{
 const before=await createPanelBundle(record.spec,fixture.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(before.sha256,record.sourceSha256);
 const model=await createWorkbenchModel({catalog:fixture.catalog,pool},core);try{const {context}=await model.prepare(record.request),prompt=await buildCodexPlanningPrompt(context);assert.equal(await digestBytes(Buffer.from(prompt)),record.promptSha256);}finally{model.dispose();}
 const spec=composeCardSpec(record,catalog,{kind:record.kind}),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert.equal(bundle.compilerVersion,'0.45.0');assert.deepEqual(spec.sections,record.spec.sections);assert.deepEqual(spec.textLayouts,record.spec.textLayouts);for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(bundle[key],before[key]);
 if(record.kind==='preserve')assert.deepEqual(bundle.componentBundle.document,before.componentBundle.document);
 else{const nodes=nodesOf(bundle.componentBundle.document),panels=spec.sections.map(section=>nodes.find(node=>node.id===spec.id+'.section.'+section.id));assert(spec.layout.width>record.spec.layout.width);assert(spec.canvas.height<record.spec.canvas.height);assert.equal(new Set(panels.map(node=>node.layout.y)).size,1);assert.equal(new Set(panels.map(node=>node.layout.x)).size,panels.length);for(const node of nodes.filter(node=>node.type==='Text'))assert(node.props.style.fontSize>=24);for(const [index,section]of spec.sections.entries()){const ids=new Set(nodesOf({root:panels[index]}).map(node=>node.id));for(const row of section.rows)assert(ids.has(spec.id+'.row.'+row.id+'.control'));}}
});
test('the new default teaches content-dependent composition without changing the pinned item-group prompt',async()=>{
 assert.equal(DEFAULT_PANEL_CATALOG,'examples/modern-readable-game-card-layout.catalog.json');
 for(const [seed,current]of [[catalog,true],[fixture.catalog,false]]){const model=await createWorkbenchModel({catalog:seed,pool},core);try{const {context}=await model.prepare(fixture.records.find(record=>record.id==='G25').request),prompt=await buildCodexPlanningPrompt(context);assert.equal(prompt.includes('prefer two or three columns'),current);assert.equal(prompt.includes('a panel-width limit'),current);assert.equal(prompt.includes('Explicit mobile, portrait or single-column requests use a column'),current);assert.equal(prompt.includes('Use the game-readable-v5 single-column defaults for short requests.'),!current);assert(prompt.includes('For repeated items spanning several rows'));}finally{model.dispose();}}
 assert(themePlanningGuide(catalog).includes('Fixed canvases do not automatically reflow'));
});
test('authored column layouts and fixed dimensions remain binding instead of being inferred from product labels',async()=>{
 const record=fixture.records.find(record=>record.id==='G25'),mobile=composeCardSpec(record,catalog,{kind:'column',settings:{width:420,canvasWidth:452}}),bundle=await createPanelBundle(mobile,catalog,core,record.state);assert.equal(mobile.layout.body.kind,'column');assert.equal(mobile.layout.width,420);assert.deepEqual(mobile.sections,record.spec.sections);assert.deepEqual(bundle.state,record.state);
 await assert.rejects(async()=>{const narrow=composeCardSpec(record,catalog,{kind:'row',settings:{width:420,canvasWidth:452}});await createPanelBundle(narrow,catalog,core,record.state);});
 const grid=composeCardSpec(record,catalog,{kind:'grid'}),gridBundle=await createPanelBundle(grid,catalog,core,record.state);assert.equal(grid.layout.body.kind,'grid');assert.deepEqual(gridBundle.actions,bundle.actions);
});
test('all light/dark accent variants support the same explicit wide-card composition',async()=>{
 const record=fixture.records.find(record=>record.id==='G25');for(const theme of catalog.themes){const selected=structuredClone(record);selected.spec.theme.id=theme.id;const spec=composeCardSpec(selected,catalog,{kind:'row'});spec.theme={id:theme.id,version:theme.version};const bundle=await createPanelBundle(spec,catalog,core,record.state);assert.equal(bundle.compilerVersion,'0.45.0');assert.equal(spec.layout.width,1000);assert.deepEqual(bundle.actions,(await createPanelBundle(record.spec,fixture.catalog,core,record.state)).actions);}
});
