import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, nodesOf } from './helpers.mjs';
import { loadBundledCoreAssets } from '../src/bundled-core-assets.mjs';
import { assetUsageFixtures } from '../examples/asset-usage-v1/fixture.mjs';
import { workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { compilePanel, controlId } from '../src/compiler.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { arrangeIntentSpec } from '../src/panel-intent.mjs';
import { layoutSettings } from '../examples/focused-layout-v1/fixture.mjs';
import { attachPanelSession } from '../src/state.mjs';
import { APPEARANCE_KEYS } from '../src/appearance.mjs';
import { navigationFixture } from '../examples/navigation-v1/fixture.mjs';
import { themePlanningGuide } from '../src/theme-planning.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,previous,base,pool]=await Promise.all([json('../examples/modern-minimal.catalog.json'),json('../examples/modern-refined.catalog.json'),json('../examples/settings-controls.panel.json'),loadBundledCoreAssets()]);
const fixtures=await assetUsageFixtures(previous,base,pool);
const ref=theme=>({id:theme.id,version:theme.version});
const bundleFor=async(spec,selected=catalog)=>createPanelBundle(spec,selected,core,undefined,spec.assets?await workbenchAssetInputs(spec,pool):undefined);
const nodes=bundle=>nodesOf(bundle.componentBundle.document);
function contrast(a,b){
  const l=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const x=l(a),y=l(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for(const theme of catalog.themes)test(`${theme.id}: minimal artwork replays all six purposes without rewriting business or assets`,async()=>{
  for(const color of [theme.tokens.text,theme.tokens.muted,theme.tokens.accent])assert(contrast(color,theme.tokens.surface)>=4.5);
  for(const fixture of Object.values(fixtures)) {
    const before=await bundleFor(fixture.chosen,previous),spec=structuredClone(before.spec);spec.theme=ref(theme);
    const after=await bundleFor(spec);assert.equal(after.compilerVersion,'0.19.0');await validatePanelBundle(after,core);
    for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
    assert.deepEqual(after.spec.sections,before.spec.sections);assert.deepEqual(after.spec.layout,before.spec.layout);
    assert(!nodes(after).some(n=>n.id.endsWith('.title-accent')));
    for(const button of nodes(after).filter(n=>n.type==='Button'))assert(contrast(button.props.style.textColor,button.props.style.backgroundColor)>=4.5);
    for(const control of nodes(after).filter(n=>['Slider','Switch','Input','ProgressBar'].includes(n.type)))assert(control.props.appearance);
    const unity=await createUnityDocument(after,core);assert.equal(unity.assets.length,after.assetClosure?.records.length??0);
    assert(!unity.nodes.some(n=>n.id.endsWith('.center-label')));
    if(fixture===fixtures.role)assert(unity.controls.find(c=>c.kind==='input').deferEmptyError);
  }
});
test('new generation measures the minimal form and slider geometry; explicit frames and action layouts stay authoritative',async()=>{
  const theme=catalog.themes[1],spec=structuredClone(fixtures.role.chosen);spec.theme=ref(theme);
  const arranged=arrangeIntentSpec(spec,layoutSettings(),theme),bundle=await bundleFor(arranged),list=nodes(bundle);
  assert.equal(arranged.layout.padding,32);assert.equal(arranged.layout.width,448);
  const input=list.find(n=>n.type==='Input'),label=list.find(n=>n.id===`${arranged.id}.row.row0.label`),error=list.find(n=>n.id.endsWith('.error.required'));
  assert.equal(input.layout.height,48);assert.equal(error.layout.y,label.layout.y);assert(error.layout.x>=label.layout.x+label.layout.width+16);
  assert.equal(input.props.style.borderColor,theme.tokens.accent);
  const settings=structuredClone(fixtures.settings.chosen);settings.theme=ref(theme);
  const explicit=arrangeIntentSpec(settings,layoutSettings(760),theme);assert.equal(explicit.layout.width,760);
  assert.deepEqual(explicit.actionLayouts,settings.actionLayouts);
  const settingsBundle=await bundleFor(explicit),slider=nodes(settingsBundle).find(n=>n.type==='Slider');
  assert(slider.layout.y>0);assert.equal(slider.props.appearance.track.layout.height,6);
});
test('minimal pristine validation stays quiet while user edits and submit retain validation',async()=>{
  const spec=structuredClone(fixtures.role.chosen);spec.theme=ref(catalog.themes[1]);
  const bundle=await bundleFor(spec),document=structuredClone(bundle.componentBundle.document),map=new Map(nodesOf(document).map(n=>[n.id,n]));
  let listener;const visible=new Map(),events=[];
  const runtime={getDocument:()=>document,subscribe:f=>{listener=f;return()=>{listener=null;};},setValue:(id,value)=>{map.get(id).props.value=value;},setVisible:(id,value)=>visible.set(id,value),setEnabled:(id,value)=>{map.get(id).props.enabled=value;}};
  const session=attachPanelSession(spec,runtime,e=>events.push(e),bundle.state,'minimal-v1'),input=spec.sections[0].rows.find(r=>r.kind==='input'),submit=spec.sections[0].rows.find(r=>r.action?.kind==='submit');
  assert.equal(visible.get(`${spec.id}.row.${input.id}.error.required`),false);assert.equal(map.get(controlId(spec.id,submit.id)).props.enabled,false);
  listener({id:controlId(spec.id,input.id),type:'change',source:'keyboard',value:'青'});
  assert.equal(visible.get(`${spec.id}.row.${input.id}.error.min-length`),true);
  listener({id:controlId(spec.id,input.id),type:'change',source:'keyboard',value:''});
  assert.equal(visible.get(`${spec.id}.row.${input.id}.error.required`),true);
  listener({id:controlId(spec.id,submit.id),type:'activate',source:'mouse'});assert(!events.some(e=>e.action==='submit'));
  session.setText(input.bind,'青莓');assert.equal(map.get(controlId(spec.id,submit.id)).props.enabled,true);
  listener({id:controlId(spec.id,submit.id),type:'activate',source:'mouse'});assert.equal(events.at(-1).action,'submit');session.destroy();
});
test('explicit control color and local button styles override artwork; previous bundles remain pinned',async()=>{
  const spec=structuredClone(fixtures.settings.chosen);spec.theme=ref(catalog.themes[1]);
  spec.appearance=Object.assign(Object.fromEntries(APPEARANCE_KEYS.map(k=>[k,null])),{controlColor:'#31445A',panelRadius:0,buttonColor:'#FADE90'});
  const bundle=await bundleFor(spec);
  for(const control of nodes(bundle).filter(n=>['Slider','Switch'].includes(n.type))){assert.equal(control.props.style.backgroundColor,'#31445A');assert(!control.props.appearance);}
  for(const button of nodes(bundle).filter(n=>n.type==='Button'))assert.equal(button.props.style.backgroundColor,'#FADE90');
  const old=await bundleFor(fixtures.role.chosen,previous);assert.equal(old.compilerVersion,'0.18.0');
  assert.throws(()=>compilePanel(old.spec,previous,core,undefined,old.assetClosure,'0.19.0'),{code:'COMPILER_VERSION'});
});
test('minimal navigation retains composed scopes, played values and theme guidance',async()=>{
  assert.match(themePlanningGuide(catalog),/Minimal-v1 provides a complete compiler-owned art direction/);
  await assert.rejects(navigationFixture(catalog,base,core,'modern-mint-dark',640),{code:'ACTION_LAYOUT_OVERFLOW'});
  for(const themeId of ['modern-mint-light','modern-mint-dark']) {
    const {bundle,composition}=await navigationFixture(catalog,base,core,themeId,672);await validatePanelBundle(bundle,core);
    assert(nodes(bundle).some(n=>n.type==='Tabs'&&n.props.appearance));assert(nodes(bundle).some(n=>n.type==='Select'&&n.props.appearance));
    const unity=await createUnityDocument(bundle,core);assert(unity.nodes.find(n=>n.type==='Tabs').tabIndicatorColor);
    const volume=composition.receipt.mappings[1].fields.find(f=>f.source==='volume').target;
    assert.equal(bundle.state[volume],65);assert.equal(bundle.spec.state.find(s=>s.id===volume).initial,80);
  }
});
