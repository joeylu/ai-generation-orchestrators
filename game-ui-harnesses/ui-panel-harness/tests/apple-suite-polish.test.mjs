import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {attachPanelSession} from '../src/state.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {audioFlowStudy} from '../examples/audio-flow-v1/fixture.mjs';
import {createApplePanelSample} from '../examples/apple-panel-samples-v1/fixture.mjs';
import {polishAppleDialog} from '../examples/apple-dialog-polish-v1/fixture.mjs';
import {polishAppleSuite,suiteSamples} from '../examples/apple-suite-polish-v1/fixture.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool);
async function source(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  let bundle=await createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,pool));
  for(const factory of [craftedAudioStudy,groupedAudioStudy]){
    const input=factory(bundle);bundle=await createPanelBundle(input.spec,input.catalog,core,bundle.state,panelBundleAssetInputs(bundle,core));
  }
  const sourceSpec=structuredClone(bundle.spec),sourceCatalog=structuredClone(bundle.catalog);
  // No ignored output or optional imported library is needed for these protocol tests.
  sourceSpec.assets=null;
  Object.assign(sourceCatalog.themes.find(item=>item.id===sourceSpec.theme.id&&item.version===sourceSpec.theme.version),{iconStyle:'plain-v1',sliderStyle:'raised-v1'});
  bundle=await createPanelBundle(sourceSpec,sourceCatalog,core);
  const input=audioFlowStudy(bundle);return createPanelBundle(input.spec,input.catalog,core,bundle.state);
}
function contrast(a,b){
  const lum=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for(const mode of ['light','dark']){
  const original=await source(mode);
  for(const sample of suiteSamples)test(`suite ${sample.id} ${mode}: complete plate, usable controls and exact business`,async()=>{
    const pair=sample.id==='audio'?null:createApplePanelSample(sample.id,mode,original,catalog);
    const before=pair?await createPanelBundle(pair.after.spec,pair.after.catalog,core):original,snapshot=structuredClone(before);
    const input=polishAppleSuite(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
    await validatePanelBundle(before,core);await validatePanelBundle(after,core);assert.deepEqual(before,snapshot);
    for(const field of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[field],before[field]);
    assert.deepEqual(after.spec.sections.flatMap(section=>section.rows),before.spec.sections.flatMap(section=>section.rows));
    const nodes=nodesOf(after.componentBundle.document),node=suffix=>nodes.find(node=>node.id===`${after.spec.id}.${suffix}`);
    assert.notEqual(node('panel').props.style.backgroundColor,node('canvas').props.style.backgroundColor,'every sample needs a visible complete plate');
    assert.equal(node('panel').props.style.cornerRadius,20);
    assert.equal(after.spec.titleBar.fontSize,24);
    const positions=new Map();
    const visit=(node,x=0,y=0)=>{const point={x:x+node.layout.x,y:y+node.layout.y};positions.set(node.id,point);for(const child of node.children??[])visit(child,point.x,point.y);};
    visit(after.componentBundle.document.root);
    const plate=node('panel'),platePosition=positions.get(plate.id),buttons=nodes.filter(node=>node.type==='Button');
    for(const button of buttons){
      const position=positions.get(button.id);
      assert.equal(button.layout.height,48);
      assert(position.x>=platePosition.x&&position.y>=platePosition.y);
      assert(position.x+button.layout.width<=platePosition.x+plate.layout.width);
      assert(position.y+button.layout.height<=platePosition.y+plate.layout.height);
      const style=button.props.style;
      assert(contrast(style.textColor,style.backgroundColor)>=4.5,`${button.id}: readable button label`);
    }
    const rows=after.spec.sections.flatMap(section=>section.rows);
    const primary=rows.filter(row=>row.kind==='button'&&row.recipe.id.endsWith('.primary'));
    assert(primary.length<=1,'one main action per sample');
    for(const slider of nodes.filter(node=>node.type==='Slider')){
      assert.equal(slider.props.appearance.thumbCanvas.width,72);
      assert.equal(slider.props.appearance.track.layout.height,12);
    }
    if(sample.id==='profile'){
      const bar=node('row.experience-row.control'),value=node('row.experience-row.value');
      assert(bar.layout.width>=96);assert(value.layout.x>=bar.layout.x+bar.layout.width);
    }
    if(sample.id==='exit'){
      const anchor=polishAppleDialog(before),expected=await createPanelBundle(anchor.spec,anchor.catalog,core,before.state);
      assert.equal(after.sha256,expected.sha256,'reviewed dialog stays exact');
    }
    const runtime={getDocument:()=>after.componentBundle.document,subscribe:()=>()=>{},setValue:()=>{},setVisible:()=>{},setEnabled:()=>{}};
    attachPanelSession(after.spec,runtime,()=>{},after.state,sample.id==='exit'?'focused-v1':'grouped-v2').destroy();
    const unity=await createUnityDocument(after,core);assert.equal(unity.controls.length,after.bindings.length+after.actions.length);
  });
  test(`suite ${mode}: refuses model results and unexpected source rows`,()=>{
    const model=structuredClone(original);model.spec.provenance.kind='agent-authored';assert.throws(()=>polishAppleSuite(model),/APPLE_SUITE_FIXTURE_ONLY/);
    const changed=structuredClone(original);changed.spec.sections[0].rows[0].id='other';assert.throws(()=>polishAppleSuite(changed),/APPLE_SUITE_ROWS/);
  });
}
