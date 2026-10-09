import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {createApplePanelSample,panelSamples} from '../examples/apple-panel-samples-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {attachPanelSession} from '../src/state.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
// Derive the source theme from public fixtures, avoiding ignored acceptance outputs as test dependencies.
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {panelBundleAssetInputs} from '../src/panel-bundle.mjs';
const catalog=await json('../examples/modern-minimal.catalog.json');
const fixtures=await assetUsageFixtures(catalog,await json('../examples/settings-controls.panel.json'),await loadBundledCoreAssets());
async function source(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  let bundle=await createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,await loadBundledCoreAssets()));
  for(const factory of [craftedAudioStudy,groupedAudioStudy]){
    const input=factory(bundle);bundle=await createPanelBundle(input.spec,input.catalog,core,bundle.state,panelBundleAssetInputs(bundle,core));
  }
  const sourceSpec=structuredClone(bundle.spec),sourceCatalog=structuredClone(bundle.catalog);
  sourceSpec.assets=null;
  const theme=sourceCatalog.themes.find(item=>item.id===sourceSpec.theme.id&&item.version===sourceSpec.theme.version);
  Object.assign(theme,{iconStyle:'plain-v1',sliderStyle:'raised-v1'});
  return createPanelBundle(sourceSpec,sourceCatalog,core);
}
for(const mode of ['light','dark']){
  const original=await source(mode);
  for(const sample of panelSamples)test(`${sample.id} ${mode}: presentation-only comparison and portable grouped content`,async()=>{
    const saved=structuredClone(original),pair=createApplePanelSample(sample.id,mode,original,catalog);
    const before=await createPanelBundle(pair.before.spec,pair.before.catalog,core),after=await createPanelBundle(pair.after.spec,pair.after.catalog,core);
    await validatePanelBundle(before,core);await validatePanelBundle(after,core);assert.deepEqual(original,saved);
    assert.equal(after.compilerVersion,'0.24.0');assert.equal(before.compilerVersion,'0.19.0');
    for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
    assert.deepEqual(after.spec.sections,before.spec.sections);
    const nodes=nodesOf(after.componentBundle.document),node=id=>nodes.find(node=>node.id===`sample-${sample.id}.${id}`);
    assert.equal(node('panel').props.style.borderWidth,0);
    if(sample.id==='exit'){
      const plate=node('panel'),canvas=node('canvas');
      assert.notEqual(plate.props.style.backgroundColor,canvas.props.style.backgroundColor,'confirmation needs a visible outer plate');
      assert(plate.props.style.cornerRadius>=14,'confirmation plate must have rounded corners');
      assert.equal(node('section.message').props.style.backgroundColor,plate.props.style.backgroundColor);
      assert.equal(node('section.actions').props.style.backgroundColor,plate.props.style.backgroundColor);
      assert.notEqual(node('row.cancel.control').props.style.backgroundColor,plate.props.style.backgroundColor,'cancel remains visible on the plate');
      assert.equal(before.spec.appearance,null);
      const section=node('section.actions');
      for(const id of ['row.cancel.control','row.confirm.control']){
        const button=node(id);
        assert(section.layout.x+button.layout.x>=0&&section.layout.y+button.layout.y>=0);
        assert(section.layout.x+button.layout.x+button.layout.width<=plate.layout.width);
        assert(section.layout.y+button.layout.y+button.layout.height<=plate.layout.height);
      }
    }
    if(['graphics','profile','exit'].includes(sample.id)){
      const sectionId=pair.after.spec.sections[0].id;
      assert.equal(node(`section.${sectionId}`).props.style.cornerRadius,14);
      assert.notEqual(node(`section.${sectionId}`).props.style.backgroundColor,node('canvas').props.style.backgroundColor);
    }
    if(sample.id==='profile'){
      assert(node('row.name.control').layout.x>node('row.name.label').layout.x+112);
      assert(node('row.experience-row.value').layout.x>node('row.experience-row.control').layout.x);
    }
    if(sample.id==='exit')assert.equal(nodes.filter(node=>node.id==='sample-exit.row.message.control'||node.id.startsWith('sample-exit.row.message.control.line')).length,2);
    const unity=await createUnityDocument(after,core);assert.equal(unity.controls.length,after.bindings.length+after.actions.length);
    let document=after.componentBundle.document;
    const runtime={getDocument:()=>document,subscribe:()=>()=>{},setValue:()=>{},setVisible:()=>{},setEnabled:()=>{}};
    attachPanelSession(after.spec,runtime,()=>{},after.state,'grouped-v2').destroy();
    if(sample.id==='exit'){
      document=structuredClone(document);nodesOf(document).find(node=>node.id.endsWith('.control.line1')).layout.x+=1;
      assert.throws(()=>attachPanelSession(after.spec,runtime,()=>{},after.state,'grouped-v2'),/PANEL_RUNTIME_MISMATCH/);
    }
  });
  test(`sample source ${mode} rejects model provenance`,()=>{
    const model=structuredClone(original);model.spec.provenance.kind='agent-authored';assert.throws(()=>createApplePanelSample('menu',mode,model,catalog),/APPLE_SAMPLE_SOURCE/);
  });
}
