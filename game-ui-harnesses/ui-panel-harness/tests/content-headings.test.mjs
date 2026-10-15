import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {headingThemeTarget,sectionHeadingVisible} from '../src/section-headings.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
const core=await loadWorkspaceCore(),pool=await loadBundledCoreAssets(),catalog=await readJson(new URL('../examples/modern-readable-game-headings.catalog.json',import.meta.url)),{records}=await readJson(new URL('./fixtures/readable-heading-regressions-v1.json',import.meta.url));
const flatten=node=>[node,...(node.children??[]).flatMap(flatten)],headings=bundle=>flatten(bundle.componentBundle.document.root).filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.props.text);
for(const record of records)test(`${record.id}: v5 heading adoption preserves exact v4 replay, content, dimensions, assets and state`,async()=>{
 const before=await createPanelBundle(record.spec,record.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(before.sha256,record.originalBundleSha256);assert.equal(before.compilerVersion,'0.37.0');
 const spec=structuredClone(before.spec);spec.theme=headingThemeTarget(spec,before.catalog,catalog,'auto');const after=await createPanelBundle(spec,catalog,core,before.state,panelBundleAssetInputs(before,core));
 assert.equal(after.compilerVersion,'0.38.0');assert.deepEqual({...after.spec,theme:before.spec.theme},before.spec);for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(after[key],before[key]);
 assert.equal(after.catalog.themes[0].tokens.fontSize,24);assert.equal(after.catalog.themes[0].tokens.titleSize,32);await validatePanelBundle(before,core);await validatePanelBundle(after,core);
 if(record.id==='G22'){assert.deepEqual(headings(before),['背包']);assert.deepEqual(headings(after),[]);}
 else assert.deepEqual(headings(after),headings(before));
 const native=await createUnityDocument(after,core);assert.deepEqual(native.nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.text),headings(after));
});
for(const tabbed of [false,true])for(const actionGroups of [1,2])test(`one content group with ${actionGroups} independent action groups has no extra heading; tabs=${tabbed}`,()=>{
 const content={id:'items',title:'物品',rows:[{kind:'list'}]},actions=Array.from({length:actionGroups},(_,index)=>({id:'actions'+index,title:'操作'+index,rows:[{kind:'button'}]})),sections=[content,...actions],spec={title:'背包',sections,...(tabbed?{tabs:{pages:[{id:'items-page',label:'物品页',sections:sections.map(section=>section.id)}]}}:{})};
 for(const section of sections){assert.equal(sectionHeadingVisible(spec,section,'concise-v5'),false);assert.equal(sectionHeadingVisible(spec,section,'visible-v5'),true);}
 if(!tabbed)assert.equal(sectionHeadingVisible(spec,content,'concise-v4'),true);
});
for(const tabbed of [false,true])test(`multiple meaningful content groups retain their titles; tabs=${tabbed}`,()=>{
 const audio={id:'audio',title:'音频',rows:[{kind:'slider'}]},video={id:'video',title:'画面',rows:[{kind:'select'}]},actions={id:'actions',title:'设置操作',rows:[{kind:'button'}]},spec={title:'游戏设置',sections:[audio,video,actions],...(tabbed?{tabs:{pages:[{id:'settings',label:'设置',sections:['audio','video','actions']}]}}:{})};
 assert(sectionHeadingVisible(spec,audio,'concise-v5'));assert(sectionHeadingVisible(spec,video,'concise-v5'));assert.equal(sectionHeadingVisible(spec,actions,'concise-v5'),false);
 const duplicate={...audio,title:'游戏设置面板'};assert.equal(sectionHeadingVisible(spec,duplicate,'concise-v5'),false);assert(sectionHeadingVisible(spec,duplicate,'visible-v5'));
});
test('explicit visible adoption retains every semantic title, and v5 cannot opt into unrelated themes',async()=>{
 const record=records.find(record=>record.id==='G22'),spec=structuredClone(record.spec);spec.theme=headingThemeTarget(spec,record.catalog,catalog,'show');const shown=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));
 assert.deepEqual(headings(shown),spec.sections.map(section=>section.title));const bad=structuredClone(catalog);delete bad.themes[0].draftSizing;assert.throws(()=>validateCatalog(bad),/headingStyle/);assert(themePlanningGuide(catalog).includes('counts content groups independently'));
});
