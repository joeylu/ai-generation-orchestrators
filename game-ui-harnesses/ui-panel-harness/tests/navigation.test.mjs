import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {navigationFixture} from '../examples/navigation-v1/fixture.mjs';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {tabContrast,tabPalette} from '../src/tabs-skin.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {appearanceTokens,APPEARANCE_KEYS} from '../src/appearance.mjs';
import {projectPanelEvent} from '../src/state.mjs';
import {controlId} from '../src/compiler.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
const json=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const [catalog,oldCatalog,base,core]=await Promise.all([json('../examples/modern-navigation.catalog.json'),json('../examples/modern-layout.catalog.json'),json('../examples/settings-controls.panel.json'),loadWorkspaceCore()]);
const nodes=b=>{const out=[];function visit(n){out.push(n);n.children?.forEach(visit);}visit(b.componentBundle.document.root);return out;};
const rgba=(resource,x,y)=>{
  const bytes=Buffer.from(resource.base64,'base64'),data=[];let width,palette,alpha;
  for(let at=8;at<bytes.length;){const len=bytes.readUInt32BE(at),kind=bytes.toString('ascii',at+4,at+8),part=bytes.subarray(at+8,at+8+len);
    if(kind==='IHDR')width=part.readUInt32BE(0);if(kind==='PLTE')palette=part;if(kind==='tRNS')alpha=part;if(kind==='IDAT')data.push(part);at+=len+12;}
  const raw=inflateSync(Buffer.concat(data)),v=raw[y*(Math.ceil(width/2)+1)+1+Math.floor(x/2)],index=x%2?v&15:v>>4;
  return [...palette.subarray(index*3,index*3+3),alpha[index]];
};
const color=value=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)).concat(255);

for(const theme of catalog.themes)test(`${theme.id}: navigation contrast, non-color selection and native data agree`,async()=>{
  const {bundle}=await navigationFixture(catalog,base,core,theme.id),tab=nodes(bundle).find(n=>n.type==='Tabs'),p=tab.props,palette=tabPalette(theme.tokens);
  assert.equal(bundle.compilerVersion,'0.17.0');assert(p.appearance);assert.equal(p.appearance.headerHeight,48);
  assert(tabContrast(p.style.textColor,palette.idle)>=4.5);assert(tabContrast(p.appearance.activeTextColor,palette.active)>=4.5);
  assert(tabContrast(palette.indicator,palette.active)>=3);assert(tabContrast(p.style.borderColor,palette.idle)>=3);
  const resources=bundle.componentBundle.resources,idle=resources.find(r=>r.path===p.appearance.tabImage),active=resources.find(r=>r.path===p.appearance.activeTabImage);
  assert.deepEqual(rgba(idle,0,0),color(palette.idle));assert.deepEqual(rgba(active,0,0),color(palette.active));assert.deepEqual(rgba(active,0,47),color(palette.indicator));
  assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  const native=await createUnityDocument(bundle,core),header=native.nodes.find(n=>n.type==='Tabs');
  assert.equal(native.adapterVersion,'0.1.5');assert.equal(header.tabActiveColor,palette.active);assert.equal(header.tabActiveTextColor,palette.activeText);assert.equal(header.tabIndicatorColor,palette.indicator);
  assert.equal(native.assets.length,0);assert.equal(native.controls.find(c=>c.kind==='tabs').contentIds.length,3);
});

test('custom opposing colors and fractional cells retain readable state and exact page geometry',async()=>{
  const {bundle}=await navigationFixture(catalog,base,core,'modern-blue-dark',641),s=structuredClone(bundle.spec);
  s.appearance=Object.fromEntries(APPEARANCE_KEYS.map(k=>[k,null]));Object.assign(s.appearance,{controlColor:'#FFFFFF',panelColor:'#000000',accentColor:'#777777',mutedColor:'#FFFFFF',borderColor:'#123456'});
  const b=await createPanelBundle(s,catalog,core,bundle.state),tab=nodes(b).find(n=>n.type==='Tabs'),palette=tabPalette(appearanceTokens(catalog.themes[3].tokens,s.appearance));
  assert.equal(tab.props.style.textColor,'#000000');assert(tabContrast(tab.props.appearance.activeTextColor,palette.active)>=4.5);assert(tabContrast(palette.focus,palette.idle)>=3);
  assert.equal(tab.props.appearance.tabCanvas.width,Math.ceil(tab.layout.width/3));assert.deepEqual(tab.layout,nodes(bundle).find(n=>n.type==='Tabs').layout);
  assert.deepEqual(tab.children.map(n=>n.layout),nodes(bundle).find(n=>n.type==='Tabs').children.map(n=>n.layout));
  await validatePanelBundle(b,core);assert.equal(panelBundleAssetInputs(b,core),undefined);
});

test('old focused tabs replay without new raster resources; values, actions and scopes stay identical',async()=>{
  const {bundle:old}=await navigationFixture(oldCatalog,base,core),{bundle:next}=await navigationFixture(catalog,base,core);
  assert.equal(old.compilerVersion,'0.16.0');assert(!nodes(old).find(n=>n.type==='Tabs').props.appearance);
  assert.deepEqual(await validatePanelBundle(old,core),old);assert.deepEqual(old.state,next.state);assert.deepEqual(old.actions,next.actions);assert.deepEqual(old.bindings,next.bindings);
  assert.deepEqual(nodes(old).map(n=>[n.id,n.layout]),nodes(next).map(n=>[n.id,n.layout]));
  const state={...next.state,form_f_row0:'Blueberry',settings_f_volume:35,settings_f_muted:true,settings_f_quality:'high',navigation:'page1'};
  const resetRow=next.spec.sections.flatMap(s=>s.rows).find(r=>r.action?.kind==='reset-initial');
  const reset=projectPanelEvent(next.spec,state,{id:controlId(next.spec.id,resetRow.id),type:'activate',source:'mouse'});
  assert.equal(reset.state.form_f_row0,'Blueberry');assert.equal(reset.state.navigation,'page1');
  for(const id of resetRow.action.fields)assert.equal(reset.state[id],next.spec.state.find(f=>f.id===id).initial);
});

test('profile dependencies, compiler mismatches and modified appearances fail closed',async()=>{
  assert(themePlanningGuide(catalog).includes('"navigationStyle":"tabs-v1"'));
  assert(!themePlanningGuide(oldCatalog).includes('Tabs-v1'));
  for(const mutate of [t=>t.navigationStyle='unknown',t=>delete t.presentationStyle]){const c=structuredClone(catalog);mutate(c.themes[0]);assert.throws(()=>validateCatalog(c));}
  const {bundle}=await navigationFixture(catalog,base,core),s=structuredClone(bundle.spec);
  await assert.rejects(createPanelBundle(s,catalog,core,undefined,undefined,'0.16.0'));
  const changed=structuredClone(bundle);nodes(changed).find(n=>n.type==='Tabs').props.appearance.activeTextColor='#000000';
  await assert.rejects(validatePanelBundle(changed,core));
});
