import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {compilePanel} from '../src/compiler.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool);
async function study(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  const before=await createPanelBundle(spec,catalog,core,{volume:67,music:32,muted:true},await workbenchAssetInputs(spec,pool));
  const input=craftedAudioStudy(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  return{before,after};
}
for(const mode of ['light','dark'])test(`crafted ${mode}: real PanelBundle preserves controls, played values, assets and native export`,async()=>{
  const {before,after}=await study(mode),snapshot=structuredClone(before);
  assert.equal(after.compilerVersion,'0.20.0');await validatePanelBundle(after,core);await validatePanelBundle(before,core);
  for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(after.spec.sections.flatMap(s=>s.rows),before.spec.sections.flatMap(s=>s.rows));assert.deepEqual(before,snapshot);
  const list=nodesOf(after.componentBundle.document),title=list.find(n=>n.id==='usage-settings.title');
  assert.equal(title.props.style.fontSize,28);assert.equal(title.props.style.fontWeight,'bold');
  assert(!list.some(n=>n.id==='usage-settings.section.actions.title'));
  const button=id=>list.find(n=>n.id===`usage-settings.row.${id}.control`);
  const slider=list.find(n=>n.type==='Slider');assert.equal(slider.props.appearance.sourceCanvas.width,slider.layout.width*2);
  assert.equal(slider.props.appearance.thumbCanvas.width,36);assert.equal(slider.props.appearance.track.layout.height,12);
  assert.equal(button('reset-row').props.style.borderWidth,0);assert.equal(button('reset-row').props.style.backgroundColor,title.props.style.backgroundColor);
  assert(button('close').layout.x>button('reset-row').layout.x+button('reset-row').layout.width+12);
  const unity=await createUnityDocument(after,core);assert.equal(unity.assets.length,after.assetClosure.records.length);
  assert.equal(unity.controls.length,6);assert.equal(unity.nodes.find(n=>n.id===title.id).bold,true);
  assert.throws(()=>compilePanel(after.spec,after.catalog,core,after.state,after.assetClosure,'0.19.0'),error=>error.code==='COMPILER_VERSION');
});
test('crafted profile retains distinct explicit headings and requested action arrangement',async()=>{
  const {after}=await study('dark'),spec=structuredClone(after.spec);
  spec.sections[1].title='指定操作区';spec.actionLayouts=[{sectionId:'actions',direction:'row',align:'start',gap:8,buttonWidth:120,buttonHeight:48,shape:'default'}];
  spec.buttonStyles=[];
  const bundle=await createPanelBundle(spec,after.catalog,core,after.state,panelBundleAssetInputs(after,core)),list=nodesOf(bundle.componentBundle.document);
  assert.equal(list.find(n=>n.id==='usage-settings.section.actions.title').props.text,'指定操作区');
  const buttons=list.filter(n=>n.type==='Button');assert.deepEqual(buttons.map(n=>n.layout.x),[0,128,256]);
  assert(buttons.every(n=>n.layout.width===120));
});
test('study factory refuses saved model panels and does not mutate its source',async()=>{
  const {before}=await study('dark'),snapshot=structuredClone(before);craftedAudioStudy(before);assert.deepEqual(before,snapshot);
  before.spec.provenance.kind='agent-authored';assert.throws(()=>craftedAudioStudy(before),/CRAFTED_AUDIO_FIXTURE_ONLY/);
});
