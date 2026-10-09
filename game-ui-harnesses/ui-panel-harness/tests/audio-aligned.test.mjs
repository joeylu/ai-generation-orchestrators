import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,nodesOf} from './helpers.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {compilePanel} from '../src/compiler.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createPanelValueAlignment,attachPanelVisuals} from '../src/panel-visuals.mjs';
import {measureAlignedSettings} from '../src/aligned-settings-presentation.mjs';
import {assetUsageFixtures} from '../examples/asset-usage-v1/fixture.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {craftedAudioStudy} from '../examples/crafted-audio-v1/fixture.mjs';
import {groupedAudioStudy} from '../examples/grouped-audio-v1/fixture.mjs';
import {audioFlowStudy} from '../examples/audio-flow-v1/fixture.mjs';
import {polishAppleSuite} from '../examples/apple-suite-polish-v1/fixture.mjs';
import {typographyStudy} from '../examples/apple-typography-v1/fixture.mjs';
import {alignAudioStudy} from '../examples/audio-aligned-v1/fixture.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(catalog,base,pool);
async function source(mode){
  const spec=structuredClone(fixtures.settings.chosen);spec.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  let bundle=await createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,pool));
  for(const factory of [craftedAudioStudy,groupedAudioStudy]){const input=factory(bundle);bundle=await createPanelBundle(input.spec,input.catalog,core,bundle.state,panelBundleAssetInputs(bundle,core));}
  const input={spec:structuredClone(bundle.spec),catalog:structuredClone(bundle.catalog)};
  Object.assign(input.catalog.themes.find(theme=>theme.id===bundle.spec.theme.id&&theme.version===bundle.spec.theme.version),{iconStyle:'plain-v1',sliderStyle:'raised-v1'});
  bundle=await createPanelBundle(input.spec,input.catalog,core,bundle.state,panelBundleAssetInputs(bundle,core));
  for(const factory of [audioFlowStudy,polishAppleSuite,bundle=>typographyStudy(bundle,'noto')]){const input=factory(bundle);bundle=await createPanelBundle(input.spec,input.catalog,core,bundle.state,panelBundleAssetInputs(bundle,core));}
  return bundle;
}
for(const mode of ['light','dark']){
  const before=await source(mode),input=alignAudioStudy(before),after=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  test(`aligned audio ${mode}: optical edges, compact grouping and existing artwork/business`,async()=>{
    const snapshot=structuredClone(before);await validatePanelBundle(before,core);await validatePanelBundle(after,core);assert.deepEqual(before,snapshot);
    assert.equal(after.compilerVersion,'0.25.0');for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
    for(const key of ['sections','assets','state','canvas'])assert.deepEqual(after.spec[key],before.spec[key]);
    const nodes=new Map(nodesOf(after.componentBundle.document).map(node=>[node.id,node])),id=after.spec.id;
    const slider=nodes.get(id+'.row.volume-row.control'),label=nodes.get(id+'.row.volume-row.label'),value=nodes.get(id+'.row.volume-row.value');
    assert.equal(label.layout.x,slider.layout.x+18);assert.equal(slider.layout.height,44);assert.equal(value.layout.x+value.layout.width,slider.layout.x+slider.layout.width-18);
    const toggle=nodes.get(id+'.row.mute-row.control'),save=nodes.get(id+'.row.save.control');
    assert.equal(toggle.layout.x+64,value.layout.x+value.layout.width);assert.equal(save.layout.x+save.layout.width,value.layout.x+value.layout.width);
    assert.equal(nodes.get(id+'.panel').layout.height,420);assert.equal([...nodes.keys()].filter(key=>key.includes('.divider.')).length,1);
    assert.equal(slider.props.appearance.thumbCanvas.width,72);assert.equal(slider.props.appearance.track.layout.height,12);
    assert.equal(nodes.get(id+'.row.close.control').props.style.backgroundColor,input.catalog.themes.find(theme=>theme.id===input.spec.theme.id&&theme.version===input.spec.theme.version).tokens.control);
    assert.throws(()=>compilePanel(after.spec,after.catalog,core,after.state,after.assetClosure,'0.24.0'),error=>error.code==='COMPILER_VERSION');
  });
  test(`aligned audio ${mode}: UGUI values right aligned and each button has one label`,async()=>{
    const native=await createUnityDocument(after,core);assert.equal(native.controls.length,6);
    for(const control of native.controls.filter(control=>control.kind==='slider'))assert.equal(native.nodes.find(node=>node.id===control.valueTextId).textAlignment,'MiddleRight');
    assert(!native.nodes.some(node=>node.id.endsWith('.center-label')));assert.equal(native.assets.length,3);
  });
  test(`aligned audio ${mode}: rejects model rewriting and unsupported control combinations`,async()=>{
    const model=structuredClone(before);model.spec.provenance.kind='agent-authored';assert.throws(()=>alignAudioStudy(model),/ALIGNED_AUDIO_FIXTURE_ONLY/);
    const spec=structuredClone(after.spec);spec.sections[0].rows.push({kind:'text',id:'note',label:'说明',text:'内容',recipe:{id:'settings.text',version:'0.1.0'}});
    await assert.rejects(()=>createPanelBundle(spec,after.catalog,core,after.state,panelBundleAssetInputs(after,core)),error=>error.code==='ALIGNED_SETTINGS_SCOPE');
  });
}
test('aligned value glyphs stay right aligned through repeated width changes without accumulated motion',()=>{
  const id='audio',layout={x:0,y:0,width:400,height:100},slider={id:'audio.row.volume.control',type:'Slider',layout:{...layout,x:14,width:386},props:{appearance:{sourceCanvas:{width:772},track:{layout:{x:36,width:700}}}}};
  const value={id:'audio.row.volume.value',type:'Text',layout:{...layout,x:318,width:64},props:{}};
  const bundle={compilerVersion:'0.25.0',spec:{id,sections:[{rows:[{id:'volume',kind:'slider'}]}]},componentBundle:{document:{root:{layout,children:[slider,value]}}}};
  let width=30,motion=0,calls=0;
  const runtime={inspect:()=>({nodes:[{id:slider.id,bounds:{x:14,width:386}},{id:value.id,bounds:{x:318+motion,width:64},renderedTextBounds:[{bounds:{x:318+motion,width}}]}]}),applyMotion:(id,values)=>{assert.equal(id,value.id);if(values.x!==undefined){motion=values.x;calls++;}}};
  const align=createPanelValueAlignment(bundle,runtime);
  for(const next of [12,20,30,40,12,40,30]){width=next;align();assert.equal(318+motion+width,382);align();assert.equal(318+motion+width,382);}
  assert.equal(calls,14);createPanelValueAlignment({...bundle,compilerVersion:'0.24.0'},runtime)();assert.equal(calls,14);
});
test('aligned settings handle mixed or absent icons, and reject overlapping action widths',()=>{
  const spec={layout:{sectionTitleHeight:24},assets:{rowIcons:[{rowId:'first'}]}},tokens={fontSize:16};
  const section={rows:[{id:'first',kind:'slider'},{id:'second',kind:'slider'},{id:'mute',kind:'switch'}]};
  const measure=spec=>measureAlignedSettings(spec,tokens,section,424,'settings',false);
  const mixed=measure(spec);assert.equal(mixed.rows[0].labelX+32,mixed.rows[1].labelX);assert.equal(mixed.rows[1].labelX,mixed.rows[1].controlX+18);assert.deepEqual(mixed.dividerRows,[2]);
  const plain=measure({...spec,assets:null});assert.equal(plain.rows[0].labelX,plain.rows[0].controlX+18);
  assert.throws(()=>measureAlignedSettings(spec,tokens,section,180,'settings',false),error=>error.code==='ALIGNED_SETTINGS_GEOMETRY');
  const buttons={rows:[{kind:'button',action:{kind:'reset-initial'}},{kind:'button',action:{kind:'emit'}}]};
  assert.throws(()=>measureAlignedSettings(spec,tokens,buttons,300,'menu',false,()=>({width:200,height:44})),error=>error.code==='ALIGNED_SETTINGS_GEOMETRY');
});
test('aligned visual pointer hooks are released on disposal and do not install on old bundles',async()=>{
  const before=await source('dark'),input=alignAudioStudy(before),bundle=await createPanelBundle(input.spec,input.catalog,core,before.state,panelBundleAssetInputs(before,core));
  const listeners=new Map(),target={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(listeners.get(type),fn);listeners.delete(type);}};
  let unsubscribed=0;
  const runtime={canvas:{ownerDocument:{defaultView:target}},inspect:()=>({nodes:[]}),applyMotion:()=>{},subscribe:()=>()=>{unsubscribed++;}};
  const stop=attachPanelVisuals(bundle,runtime);assert.equal(listeners.size,4);stop();stop();assert.equal(listeners.size,0);assert.equal(unsubscribed,1);
  attachPanelVisuals(before,runtime)();assert.equal(listeners.size,0);assert.equal(unsubscribed,2);
});
