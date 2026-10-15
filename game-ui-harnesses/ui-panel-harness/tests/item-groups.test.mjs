import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {core,nodesOf} from './helpers.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {groupedItemSpec} from './item-groups-fixture.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {attachPanelSession,projectPanelEvent} from '../src/state.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {sectionHeadingVisible,headingThemeTarget} from '../src/section-headings.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {buildCodexPlanningPrompt} from '../src/codex-planner.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {imageRequest,imageIntent} from '../examples/image-slots-v1/fixture.mjs';
const catalog=await readJson(new URL('../examples/modern-readable-game-item-groups.catalog.json',import.meta.url)),fixture=await readJson(new URL('./fixtures/item-groups-regressions-v1.json',import.meta.url)),pool=await loadBundledCoreAssets();
const shop=fixture.records.find(record=>record.id==='G25');
for(const record of fixture.records)test(`${record.id}: exact 0.44 replay and reviewed 0.45 groups preserve every row, value and event`,async()=>{
 const old=await createPanelBundle(record.spec,fixture.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(old.sha256,record.sourceSha256);
 const spec=groupedItemSpec(record,catalog),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert.equal(bundle.compilerVersion,'0.45.0');assert.deepEqual(spec.sections.flatMap(s=>s.rows),record.spec.sections.flatMap(s=>s.rows));assert.deepEqual(spec.textLayouts,record.spec.textLayouts);assert.equal(spec.layout.width,record.spec.layout.width);
 for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(bundle[key],old[key]);
 if(!record.reviewedGroups)assert.deepEqual(bundle.componentBundle.document,old.componentBundle.document);
 else{for(const group of record.reviewedGroups){const panel=nodesOf(bundle.componentBundle.document).find(node=>node.id===spec.id+'.section.'+group.id);assert.equal(panel.type,'Panel');const ids=new Set(nodesOf({root:panel}).map(node=>node.id));for(const rowId of group.rowIds)assert(ids.has(spec.id+'.row.'+rowId+'.control'));for(const other of record.reviewedGroups.filter(item=>item.id!==group.id))for(const rowId of other.rowIds)assert(!ids.has(spec.id+'.row.'+rowId+'.control'));assert(!ids.has(panel.id+'.title'));}}
 const session=attachPanelSession(spec,{getDocument:()=>structuredClone(bundle.componentBundle.document),subscribe:()=>()=>{},setValue(){},setEnabled(){},setVisible(){}},()=>{throw Error('UNEXPECTED_EVENT');},bundle.state,'minimal-v1',catalog);assert.deepEqual(session.getState(),bundle.state);session.destroy();
 const native=await createUnityDocument(bundle,core);assert.equal(native.adapterVersion,'0.1.9');for(const group of record.reviewedGroups??[]){const panel=native.nodes.find(node=>node.id===spec.id+'.section.'+group.id);assert.equal(panel.type,'Panel');}
});
test('duplicate headings hide by exact data identity, while authored labels and distinct category titles remain',()=>{
 const spec=groupedItemSpec(shop,catalog);for(const section of spec.sections){assert.equal(sectionHeadingVisible(spec,section,'concise-v6'),false);assert.equal(sectionHeadingVisible(spec,section,'visible-v6'),true);assert.equal(sectionHeadingVisible(spec,section,'concise-v5'),true);}
 const section=structuredClone(spec.sections[1]);section.title='补给商品';assert.equal(sectionHeadingVisible(spec,section,'concise-v6'),true);section.title=spec.sections[1].rows[0].text+'（完整）';assert.equal(sectionHeadingVisible(spec,section,'concise-v6'),true);
 assert.deepEqual(spec.sections.flatMap(s=>s.rows),shop.spec.sections.flatMap(s=>s.rows));
});
test('explicit visible headings preserve group titles and author-controlled fixed dimensions',async()=>{
 const spec=groupedItemSpec(shop,catalog,{headingStyle:'visible-v6',settings:{width:680,canvasWidth:744,canvasHeight:1600,maxHeight:1400,overflow:'scroll'}}),bundle=await createPanelBundle(spec,catalog,core,shop.state),headings=nodesOf(bundle.componentBundle.document).filter(node=>/\.section\.[^.]+\.title$/u.test(node.id));assert.deepEqual(headings.map(node=>node.props.text),spec.sections.map(s=>s.title));assert.equal(spec.layout.width,680);assert.equal(spec.canvas.height,1600);assert.equal(spec.layout.maxHeight,1400);
 const normal=groupedItemSpec(shop,catalog);assert.deepEqual(headingThemeTarget(normal,catalog,catalog,'show'),{id:normal.theme.id,version:'0.32.1'});
 assert.throws(()=>groupedItemSpec(shop,catalog,{settings:{width:420,canvasWidth:452,canvasHeight:320,maxHeight:240,overflow:'error'}}),{code:'LAYOUT_OVERFLOW'});
});
test('purchase actions retain distinct row identities and no data Panel can trigger them',()=>{
 const spec=groupedItemSpec(shop,catalog),buttons=spec.sections.flatMap(s=>s.rows).filter(row=>row.kind==='button');assert.equal(buttons.length,2);const events=buttons.map(row=>projectPanelEvent(spec,shop.state,{type:'activate',id:spec.id+'.row.'+row.id+'.control',source:'mouse'}).event);assert.deepEqual(events.map(event=>event.rowId),['row3','row6']);assert.deepEqual(events.map(event=>event.name),['panel.row3','panel.row6']);assert.equal(projectPanelEvent(spec,shop.state,{type:'activate',id:spec.id+'.section.section1',source:'mouse'}).event,null);
});
test('explicit reviewed membership rejects dropped, duplicated or reordered facts',()=>{
 for(const groups of [shop.reviewedGroups.slice(1),[...shop.reviewedGroups,shop.reviewedGroups[1]],[shop.reviewedGroups[0],shop.reviewedGroups[2],shop.reviewedGroups[1]]])assert.throws(()=>groupedItemSpec(shop,catalog,{groups}));
});

test('image cards retain authored titles and centered native headings when a Text repeats the name',async()=>{
 const context=await createPlanningContext(imageRequest,catalog),intent={...imageIntent(context),panelIntentVersion:'0.12'};
 intent.panel.layout.canvasHeight+=24;intent.panel.layout.maxHeight+=24;
 const proposal=await materializePanelIntent(context,intent),bundle=await createPanelBundle(proposal.spec,catalog,core),nodes=nodesOf(bundle.componentBundle.document),native=await createUnityDocument(bundle,core);
 for(const section of bundle.spec.sections){assert.equal(sectionHeadingVisible(bundle.spec,section,'concise-v6'),true);const id=bundle.spec.id+'.section.'+section.id+'.title';assert.equal(nodes.find(node=>node.id===id).props.text,section.title);assert.equal(native.nodes.find(node=>node.id===id).textAlignment,'MiddleCenter');}
 assert.equal(native.nodes.filter(node=>node.textAlignment==='MiddleCenter').length,7);
});
test('programmatic mixed Text, Progress and claim rows stay in their explicit item Panels',async()=>{
 const source=await readJson(new URL('./fixtures/readable-data-regressions-v1.json',import.meta.url)),record=structuredClone(source.records.find(record=>record.id==='G16')),rows=record.spec.sections.flatMap(s=>s.rows),groups=[];
 // These added claim controls are programmatic specimens, never real model output.
 record.spec.sections[0].rows=[];
 for(let index=0;index<3;index++){const text=rows[index*2],progress=rows[index*2+1],claim={id:'claim'+index,kind:'button',label:'',buttonLabel:'领取',enabled:true,event:'panel.claim'+index,action:{kind:'emit'},recipe:{id:'settings.button.primary',version:'0.1.0'}};record.spec.sections[0].rows.push(text,progress,claim);groups.push({id:'item'+index,title:text.label,rowIds:[text.id,progress.id,claim.id]});}
 const spec=groupedItemSpec(record,catalog,{groups}),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool)),nodes=nodesOf(bundle.componentBundle.document);
 assert.deepEqual(bundle.state,record.state);for(const group of groups){const panel=nodes.find(node=>node.id===spec.id+'.section.'+group.id),children=nodesOf({root:panel});assert.equal(panel.type,'Panel');for(const id of group.rowIds)assert(children.some(node=>node.id===spec.id+'.row.'+id+'.control'));assert(!children.some(node=>node.id===panel.id+'.title'));const claim=group.rowIds.at(-1),event=projectPanelEvent(spec,bundle.state,{type:'activate',id:spec.id+'.row.'+claim+'.control',source:'mouse'}).event;assert.equal(event.rowId,claim);assert.deepEqual(event.state,bundle.state);}
});
test('the pinned item-group prompt keeps per-item actions with their data and preserves old prompt policy',async()=>{
 for(const [seed,current]of [[catalog,true],[fixture.catalog,false]]){const model=await createWorkbenchModel({catalog:seed,pool},core);try{const {context}=await model.prepare({requestVersion:'0.1',id:'grouping-draft',target:'pixi',text:'做个游戏商店面板'}),prompt=await buildCodexPlanningPrompt(context);assert.equal(prompt.includes('For repeated items spanning several rows'),current);assert.equal(prompt.includes('only standalone or page-wide actions use a Button-only section'),current);assert(prompt.includes(current?'concise-v6':'concise-v5'));assert(prompt.includes('Each labeled settings.text data item gets its own inner Panel'));}finally{model.dispose();}}
 const guide=themePlanningGuide(catalog);assert(guide.includes('presentation v6'));assert(guide.includes('visible-v6'));assert(guide.includes('exactly equal'));
});
test('item group headings require the data Panel profile and work across all theme modes',async()=>{
 for(const theme of catalog.themes){const spec=groupedItemSpec(shop,catalog,{themeId:theme.id,headingStyle:theme.headingStyle}),bundle=await createPanelBundle(spec,catalog,core,shop.state);assert.equal(bundle.compilerVersion,'0.45.0');assert.equal(nodesOf(bundle.componentBundle.document).filter(node=>node.id.endsWith('.data-content')).length,5);}
 const bad=structuredClone(catalog);bad.themes[0].draftSizing='game-readable-v4';assert.throws(()=>validateCatalog(bad));
});
