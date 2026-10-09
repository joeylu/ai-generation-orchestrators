import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {audioLineIcon,audioLineIconBatch,plainAudioIconStudy} from '../examples/plain-audio-icons-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {compilePanel} from '../src/compiler.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {validateAssetSvg} from '../src/asset-svg.mjs';
import {validateAssetBatch} from '../src/asset-descriptor.mjs';
import {assertRowIconStudy} from '../scripts/lib/row-icon-study.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool);
async function source(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  const raw=await createPanelBundle(spec,catalog,core,{volume:67,music:32,muted:true},await workbenchAssetInputs(spec,pool));
  const crafted=craftedAudioStudy(raw),first=await createPanelBundle(crafted.spec,crafted.catalog,core,raw.state,panelBundleAssetInputs(raw,core));
  const grouped=groupedAudioStudy(first);return createPanelBundle(grouped.spec,grouped.catalog,core,first.state,panelBundleAssetInputs(first,core));
}
async function candidate(before){
  const input=plainAudioIconStudy(before,before.spec.assets.library),assets=panelBundleAssetInputs(before,core);
  // Byte fixtures reuse verified PNGs. Real vector raster/alpha replay is owned by the local study builder.
  const replacements=new Map(before.spec.assets.rowIcons.map((item,index)=>[item.asset,input.spec.assets.rowIcons[index].asset]));
  const closure={...assets.closure,records:assets.closure.records.map(item=>({...item,key:replacements.get(item.key)})).sort((a,b)=>a.key.localeCompare(b.key))};
  return createPanelBundle(input.spec,input.catalog,core,before.state,{closure,resources:assets.resources});
}
for(const mode of ['light','dark'])test(`plain ${mode} icons remove only badges and sources, preserving grouped geometry, controls and state`,async()=>{
  const before=await source(mode),snapshot=structuredClone(before),after=await candidate(before);
  await validatePanelBundle(after,core);await validatePanelBundle(before,core);assert.deepEqual(before,snapshot);
  assert.equal(before.compilerVersion,'0.21.0');assert.equal(after.compilerVersion,'0.22.0');
  assertRowIconStudy(before,after,after.spec.assets.rowIcons);
  const previous=nodesOf(before.componentBundle.document),next=nodesOf(after.componentBundle.document);
  assert.deepEqual(next.map(node=>node.id),previous.map(node=>node.id));
  const own=node=>({...node,...(node.children?{children:node.children.map(child=>child.id)}:{})});
  for(const entry of next){const node=own(entry),old=own(previous.find(item=>item.id===node.id));
    if(node.id.endsWith('.icon')){assert.equal(old.props.drawBackground,true);assert.equal(node.props.drawBackground,false);
      assert.deepEqual({...node,props:{...node.props,source:old.props.source,drawBackground:true}},old);
    }else assert.deepEqual(node,old);
  }
  const native=await createUnityDocument(after,core);assert.equal(native.controls.length,6);
  assert.throws(()=>compilePanel(after.spec,after.catalog,core,after.state,after.assetClosure,'0.21.0'),error=>error.code==='COMPILER_VERSION');
});
test('plain icon profile requires grouped surfaces and rejects unknown treatments',async()=>{
  const before=await source('light'),input=plainAudioIconStudy(before,before.spec.assets.library);
  input.catalog.themes[0].surfaceStyle='crafted-v1';assert.throws(()=>validateCatalog(input.catalog),/plain-v1 icons require grouped/);
  input.catalog.themes[0].surfaceStyle='grouped-v1';input.catalog.themes[0].iconStyle='glow-v1';assert.throws(()=>validateCatalog(input.catalog),/plain-v1 icons require grouped/);
  before.spec.provenance.kind='agent-authored';assert.throws(()=>plainAudioIconStudy(before,before.spec.assets.library),/FIXTURE_ONLY/);
});
test('local replacement gate rejects business, layout and palette drift',async()=>{
  const before=await source('light'),after=await candidate(before),expected=after.spec.assets.rowIcons;
  for(const mutate of [value=>value.state.volume=8,value=>value.spec.layout.padding=30,
    value=>value.spec.sections[0].rows[0].label='changed',value=>value.catalog.themes[0].tokens.surface='#FF0000',
    value=>value.spec.assets.rowIcons[0].rowId='music-row']){
    const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertRowIconStudy(before,changed,expected));
  }
});
test('six bounded vectors share geometry and line weight across light/dark, with no backplate',()=>{
  const batch=validateAssetBatch(audioLineIconBatch());assert.equal(batch.assets.length,6);
  for(const entry of batch.assets){const name=entry.id.slice(0,-entry.variant.length-1),svg=audioLineIcon(name,entry.variant);
    validateAssetSvg(svg,entry.size);assert(svg.includes('stroke-width="1.65"'));assert(!svg.includes('<rect'));
    assert.equal(audioLineIcon(name,'light').replace('#1D1D1F','#F5F5F7'),audioLineIcon(name,'dark'));
  }
  assert.throws(()=>audioLineIcon('unknown','light'),/AUDIO_ICON_VARIANT/);
});
