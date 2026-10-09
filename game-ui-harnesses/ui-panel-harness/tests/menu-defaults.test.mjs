import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {menuFixture} from '../examples/menu-defaults-v1/fixture.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {digestJson} from '../src/canonical.mjs';
import {roleIntent,roleRequest} from '../examples/adaptive-v1/fixture.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {navigationFixture} from '../examples/navigation-v1/fixture.mjs';
const json=async file=>JSON.parse(await readFile(new URL(file,import.meta.url),'utf8'));
const catalog=await json('../examples/modern-menu.catalog.json'),previous=await json('../examples/modern-minimal.catalog.json');
const compile=spec=>createPanelBundle(spec,catalog,core),nodes=b=>nodesOf(b.componentBundle.document);
for(const theme of catalog.themes)test(`${theme.id}: native menu materialization uses scoped polished defaults without changing business`,async()=>{
  const {spec}=await menuFixture(catalog,theme.id),bundle=await compile(spec);await validatePanelBundle(bundle,core);
  assert.equal(bundle.compilerVersion,'0.26.0');assert.equal(spec.layout.width,428);assert.equal(spec.layout.padding,28);assert.equal(spec.layout.titleHeight,34);
  const list=nodes(bundle),panel=list.find(n=>n.id===spec.id+'.panel'),buttons=list.filter(n=>n.type==='Button');
  assert.equal(panel.layout.height,298);assert.equal(panel.props.style.backgroundColor,theme.menuTokens.surface);assert.equal(panel.props.style.cornerRadius,20);
  assert.equal(list.find(n=>n.id===spec.id+'.title').props.style.fontWeight,'bold');
  for(const button of buttons){assert.equal(button.layout.width,280);assert.equal(button.layout.height,48);assert.equal(button.props.style.cornerRadius,10);}
  assert.equal(buttons[0].props.style.backgroundColor,theme.menuTokens.accent);assert.equal(buttons[1].props.style.backgroundColor,theme.menuTokens.control);
  assert.deepEqual(spec.sections[0].rows.map(r=>r.buttonLabel),['继续游戏','设置','返回主菜单']);
  assert.deepEqual(bundle.spec,spec);assert.equal(bundle.actions.length,3);assert.deepEqual(bundle.state,{});
  const unity=await createUnityDocument(bundle,core);assert.equal(unity.nodes.find(n=>n.id===spec.id+'.title').textAlignment,'MiddleCenter');
  assert(!unity.nodes.some(n=>n.id.endsWith('.center-label')));
});
test('non-menu form geometry, colors and authored state remain identical to the previous minimal profile',async()=>{
  const form=context=>{const intent=roleIntent(context);for(const row of intent.panel.body.children[0].rows)if(row.kind==='button')row.recipeKey=`settings.button.${row.action==='submit'?'primary':'secondary'}@0.1.0`;return intent;};
  const a=await createPlanningContext(roleRequest,previous),old=(await materializePanelIntent(a,form(a))).spec;
  const b=await createPlanningContext(roleRequest,catalog),current=(await materializePanelIntent(b,form(b))).spec;
  assert.deepEqual(current.layout,old.layout);assert.deepEqual(current.sections,old.sections);assert.deepEqual(current.state,old.state);
  const before=await createPanelBundle(old,previous,core),after=await compile(current);
  assert.deepEqual(nodes(after),nodes(before));assert.deepEqual(after.bindings,before.bindings);assert.deepEqual(after.actions,before.actions);
});
test('saved nonredundant headings and text-only edits remain intact under the new catalog',async()=>{
  const {spec}=await menuFixture(catalog,'modern-blue-dark','菜单入口'),before=await compile(spec);
  assert(nodes(before).some(n=>n.type==='Text'&&n.props.text==='菜单入口'));
  const applied=await applyPanelPatch(spec,{patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'只改文案',operations:[{op:'set-button-label',rowId:'row0',buttonLabel:'回到游戏'}]});
  const after=await compile(applied.spec);assert.deepEqual(after.spec.layout,before.spec.layout);
  assert.deepEqual(after.spec.sections[0].rows.slice(1),before.spec.sections[0].rows.slice(1));
  assert.equal(after.spec.sections[0].title,'菜单入口');
});
test('explicit action arrangement and local dimensions, colors and title style override menu defaults',async()=>{
  const {spec}=await menuFixture(catalog);
  const style={horizontalAlign:'left',verticalAlign:null,backgroundColor:null,textColor:null,cornerRadius:null,fontSize:null,padding:0};
  const local={backgroundColor:'#553388',textColor:'#FFFFFF',borderColor:null,borderWidth:null,cornerRadius:6,width:80,height:80,shape:'circle'};
  const patch={patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'显式横排圆形按钮',operations:[
    {op:'set-button-label',rowId:'row0',buttonLabel:'⏵'},{op:'set-button-label',rowId:'row1',buttonLabel:'⚙'},{op:'set-button-label',rowId:'row2',buttonLabel:'⌂'},
    {op:'set-action-layout',sectionId:'section0',layout:{direction:'row',align:'end',gap:16,buttonWidth:56,buttonHeight:56,shape:'circle'}},
    {op:'set-button-style',rowId:'row0',style:local},{op:'set-title-bar',style}]};
  const {spec:edited}=await applyPanelPatch(spec,patch),bundle=await compile(edited),buttons=nodes(bundle).filter(n=>n.type==='Button');
  assert.deepEqual(bundle.spec,edited);assert.equal(buttons[0].layout.width,80);assert.equal(buttons[1].layout.width,56);
  assert.equal(buttons[0].props.style.backgroundColor,'#553388');assert.equal(buttons[0].props.style.cornerRadius,40);
  const unity=await createUnityDocument(bundle,core);assert.equal(unity.nodes.find(n=>n.id===spec.id+'.title').textAlignment,'MiddleLeft');
});
test('menu token contracts reject incomplete, null, alien and unversioned palettes',()=>{
  for(const mutate of [c=>{delete c.themes[0].menuTokens;},c=>{c.themes[0].menuTokens=null;},c=>{c.themes[0].menuTokens.extra=1;},c=>{c.themes[0].surfaceStyle='minimal-v1';}]){
    const bad=structuredClone(catalog);mutate(bad);assert.throws(()=>validateCatalog(bad));
  }
  assert.match(themePlanningGuide(catalog),/do not invent an extra heading/);
});
test('settings, form, dialog, loading and icon-menu nodes retain previous presentation and assets',async()=>{
  const pool=await loadBundledCoreAssets(),base=await json('../examples/settings-controls.panel.json');
  const fixtures=await assetUsageFixtures(previous,base,pool);
  for(const [name,fixture] of Object.entries(fixtures)){
    if(['pause','menu'].includes(name)&&!fixture.chosen.assets?.rowIcons.length)continue;
    const spec=structuredClone(fixture.chosen),old=await createPanelBundle(spec,previous,core,undefined,spec.assets?await workbenchAssetInputs(spec,pool):undefined);
    spec.theme.version='0.18.0';const current=await createPanelBundle(spec,catalog,core,old.state,spec.assets?await workbenchAssetInputs(spec,pool):undefined);
    assert.deepEqual(nodes(current),nodes(old),name);assert.deepEqual(current.assetClosure,old.assetClosure,name);
    for(const key of ['state','bindings','actions'])assert.deepEqual(current[key],old[key],name);
  }
});
test('Tabs do not activate standalone-menu defaults inside their pages',async()=>{
  const base=await json('../examples/settings-controls.panel.json');
  const before=(await navigationFixture(previous,base,core,'modern-blue-dark',672)).bundle;
  const after=(await navigationFixture(catalog,base,core,'modern-blue-dark',672)).bundle;
  assert.deepEqual(nodes(after),nodes(before));assert.deepEqual(after.state,before.state);
});
