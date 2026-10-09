import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {menuFixture,menuIntent} from '../examples/menu-defaults-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';

const catalog=JSON.parse(await readFile(new URL('../examples/modern-menu.catalog.json',import.meta.url),'utf8'));
async function single(themeId,heading='开始') {
  const {spec}=await menuFixture(catalog,themeId,heading);
  spec.title='开始';spec.sections[0].rows=spec.sections[0].rows.slice(0,1);
  spec.sections[0].rows[0].buttonLabel='开始';
  return spec;
}
for(const theme of catalog.themes)test(`${theme.id}: a single menu button without a duplicate heading meets section minimum geometry`,async()=>{
  const spec=await single(theme.id),before=structuredClone(spec);
  const bundle=await createPanelBundle(spec,catalog,core);await validatePanelBundle(bundle,core);
  assert.deepEqual(spec,before);assert.deepEqual(bundle.spec,before);
  const nodes=nodesOf(bundle.componentBundle.document),section=nodes.find(n=>n.id===spec.id+'.section.section0'),button=nodes.find(n=>n.type==='Button');
  assert.equal(section.layout.height,80);assert.equal(button.layout.height,48);assert.equal(button.layout.width,280);
  assert.equal(nodes.find(n=>n.id===spec.id+'.panel').layout.height,186);
  assert.equal(nodes.filter(n=>n.type==='Button').length,1);assert.equal(bundle.actions.length,1);assert.deepEqual(bundle.state,{});
  assert(!nodes.some(n=>n.id===spec.id+'.section.section0.title'));
  const native=await createUnityDocument(bundle,core);
  assert.equal(native.nodes.find(n=>n.id===button.id).height,button.layout.height);
});
test('a single button with an explicit different heading retains the heading and its original geometry',async()=>{
  const spec=await single(catalog.themes[0].id,'游戏入口'),bundle=await createPanelBundle(spec,catalog,core);
  const nodes=nodesOf(bundle.componentBundle.document);
  assert.equal(nodes.find(n=>n.id===spec.id+'.section.section0').layout.height,104);
  assert.equal(nodes.find(n=>n.id===spec.id+'.section.section0.title').props.text,'游戏入口');
});
test('minimum section sizing does not bypass pinned recipes or an explicit undersized canvas',async()=>{
  const spec=await single(catalog.themes[0].id),strict=structuredClone(catalog);
  strict.recipes.find(r=>r.id==='settings.section').minHeight=81;
  await assert.rejects(createPanelBundle(spec,strict,core),error=>error.code==='RECIPE_GEOMETRY');
  spec.canvas.height=159;spec.layout.overflow='error';
  await assert.rejects(createPanelBundle(spec,catalog,core),error=>error.code==='LAYOUT_OVERFLOW');
});
test('native single-button intent measures a fitting canvas and compiles without changing its business facts',async()=>{
  const context=await createPlanningContext({requestVersion:'0.1',id:'single-start-fixture',target:'pixi',text:'生成一个开始按钮，点击发出开始事件，不接入游戏。'},catalog,undefined,{actionLayouts:true,textWrap:true});
  const intent=menuIntent(context,'modern-mint-light','开始');intent.panel.title='开始';
  intent.panel.body.children[0].rows=intent.panel.body.children[0].rows.slice(0,1);
  intent.panel.body.children[0].rows[0].label='开始';
  const proposal=await materializePanelIntent(context,intent),bundle=await createPanelBundle(proposal.spec,catalog,core);
  await validatePanelBundle(bundle,core);assert.equal(proposal.spec.canvas.height,250);
  assert.equal(proposal.spec.sections[0].rows[0].buttonLabel,'开始');
  assert.deepEqual(proposal.spec.sections[0].rows[0].action,{kind:'emit'});assert.equal(bundle.actions.length,1);
});
