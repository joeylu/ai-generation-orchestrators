import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {audioFlowStudy} from '../examples/audio-flow-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {assertAudioFlowStudy} from '../scripts/lib/audio-flow-study.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool);
async function source(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  const raw=await createPanelBundle(spec,catalog,core,{volume:67,music:32,muted:true},await workbenchAssetInputs(spec,pool));
  const input=groupedAudioStudy(raw);Object.assign(input.catalog.themes[0],{iconStyle:'plain-v1',sliderStyle:'raised-v1'});
  return createPanelBundle(input.spec,input.catalog,core,raw.state,panelBundleAssetInputs(raw,core));
}
function geometry(bundle){
  const nodes=new Map();
  const walk=(node,x=0,y=0,parentId=null)=>{const rect={...node.layout,x:x+node.layout.x,y:y+node.layout.y};nodes.set(node.id,{node,rect,parentId});for(const child of node.children??[])walk(child,rect.x,rect.y,node.id);};
  walk(bundle.componentBundle.document.root);return id=>nodes.get(`usage-settings.${id}`);
}
for(const mode of ['light','dark'])test(`audio flow ${mode}: one sound group, one aligned footer, exact control artwork and business`,async()=>{
  const before=await source(mode),snapshot=structuredClone(before),input=audioFlowStudy(before);
  const after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  await validatePanelBundle(before,core);await validatePanelBundle(after,core);assert.deepEqual(before,snapshot);assertAudioFlowStudy(before,after,core);
  assert.equal(after.compilerVersion,'0.23.0');assert(after.spec.canvas.height<before.spec.canvas.height);
  const get=geometry(after),group=get('section.audio').rect;
  for(const row of ['volume-row','music-row','mute-row'])assert.equal(get(`row.${row}.control`).parentId,'usage-settings.section.audio');
  for(const row of ['reset-row','close','save']){const r=get(`row.${row}.control`).rect;assert(r.y>=group.y+group.height+20&&r.y+r.height<=after.spec.canvas.height);}
  const reset=get('row.reset-row.control').rect,close=get('row.close.control').rect,save=get('row.save.control').rect;
  assert.equal(reset.y,close.y);assert.equal(close.y,save.y);assert.equal(reset.x,group.x);assert.equal(save.x+save.width,group.x+group.width);
  assert.equal(save.x-close.x-close.width,12);assert(reset.x+reset.width<close.x);
  for(const section of ['reset','actions'])assert.equal(get(`section.${section}`).node.props.style.backgroundColor,after.catalog.themes[0].tokens.background);
  for(const index of [1,2]){const divider=get(`section.audio.divider.${index}`).rect,icon=get(`row.${index===1?'music-row':'mute-row'}.icon`).rect;assert(divider.y+divider.height<icon.y);}
  const native=await createUnityDocument(after,core);assert.equal(native.controls.length,6);
  const all=nodesOf(after.componentBundle.document);assert.equal(all.filter(node=>node.type==='Text'&&node.id.endsWith('.title')).length,1);
});
test('layout study rejects source substitution and unrelated state, palette, font or row edits',async()=>{
  const before=await source('light'),input=audioFlowStudy(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  for(const mutate of [value=>value.state.volume=5,value=>value.spec.sections[0].rows.reverse(),
    value=>value.catalog.themes[0].tokens.fontFamily='different',value=>value.spec.title='different',value=>value.spec.assets.rowIcons=[]]){
    const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertAudioFlowStudy(before,changed,core));
  }
  before.spec.provenance.kind='agent-authored';assert.throws(()=>audioFlowStudy(before),/FIXTURE_ONLY/);
});
