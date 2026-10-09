import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {compilePanel} from '../src/compiler.mjs';
import {APPEARANCE_KEYS} from '../src/appearance.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool);
async function source(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  const raw=await createPanelBundle(spec,catalog,core,{volume:67,music:32,muted:true},await workbenchAssetInputs(spec,pool));
  const study=craftedAudioStudy(raw);return createPanelBundle(study.spec,study.catalog,core,raw.state,panelBundleAssetInputs(raw,core));
}
for(const mode of ['dark','light'])test(`grouped ${mode}: new group geometry preserves exact business, resources and portable controls`,async()=>{
  const before=await source(mode),snapshot=structuredClone(before),input=groupedAudioStudy(before);
  const after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  await validatePanelBundle(after,core);await validatePanelBundle(before,core);assert.deepEqual(before,snapshot);
  assert.equal(after.compilerVersion,'0.21.0');
  for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(after.spec.sections.flatMap(section=>section.rows),before.spec.sections.flatMap(section=>section.rows));
  const list=nodesOf(after.componentBundle.document),node=id=>list.find(node=>node.id===`usage-settings.${id}`);
  assert.notEqual(node('canvas').props.style.backgroundColor,node('section.levels').props.style.backgroundColor);
  assert.equal(node('panel').props.style.borderWidth,0);assert.equal(node('section.levels').props.style.cornerRadius,14);
  assert.equal(node('section.levels.divider.1').layout.height,1);
  assert(node('section.levels.divider.1').layout.y+5<node('row.music-row.icon').layout.y);
  assert.equal(node('section.mute').layout.height,64);assert.equal(node('section.reset').layout.height,56);
  assert.equal(node('row.volume-row.control').props.appearance.thumbCanvas.width,56);
  const unity=await createUnityDocument(after,core);assert.equal(unity.controls.length,6);
  assert(unity.nodes.some(value=>value.id==='usage-settings.section.levels.divider.1'));
  assert.throws(()=>compilePanel(after.spec,after.catalog,core,after.state,after.assetClosure,'0.20.0'),error=>error.code==='COMPILER_VERSION');
});
test('layout factory refuses a saved model result and other panel identities',async()=>{
  const before=await source('dark');before.spec.provenance.kind='agent-authored';assert.throws(()=>groupedAudioStudy(before),/FIXTURE_ONLY/);
  before.spec.provenance.kind='programmatic-fixture';before.spec.id='unrelated';assert.throws(()=>groupedAudioStudy(before),/FIXTURE_ONLY/);
});
test('explicit action geometry and local panel color remain authoritative in the grouped profile',async()=>{
  const before=await source('light'),input=groupedAudioStudy(before);
  input.spec.buttonStyles.find(value=>value.rowId==='reset-row').style.width=120;
  input.spec.appearance={...Object.fromEntries(APPEARANCE_KEYS.map(key=>[key,null])),panelColor:'#F8F8FA'};
  const bundle=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core)),list=nodesOf(bundle.componentBundle.document);
  assert.equal(list.find(node=>node.id==='usage-settings.row.reset-row.control').layout.width,120);
  assert.equal(list.find(node=>node.id==='usage-settings.panel').props.style.backgroundColor,'#F8F8FA');
  input.spec.buttonStyles.find(value=>value.rowId==='reset-row').style.width=500;
  await assert.rejects(()=>createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core)),error=>error.code==='ACTION_LAYOUT_OVERFLOW');
});
