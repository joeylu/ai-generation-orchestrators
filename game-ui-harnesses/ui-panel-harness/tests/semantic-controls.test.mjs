import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
import {createPanelBundle,validatePanelBundle,panelBundleAssetInputs} from '../src/panel-bundle.mjs';
import {compilePanel} from '../src/compiler.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {buildNativePanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {APPEARANCE_KEYS} from '../src/appearance.mjs';
import {BUTTON_STYLE_KEYS} from '../src/button-style.mjs';
import {digestBytes} from '../src/canonical.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {semanticSettingsFixture} from '../examples/semantic-controls-v1/fixture.mjs';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const [catalog,oldCatalog,base,core]=await Promise.all([json('../examples/modern-controls.catalog.json'),json('../examples/modern-adaptive.catalog.json'),json('../examples/settings-controls.panel.json'),loadWorkspaceCore()]);
const fixture=()=>semanticSettingsFixture(catalog,base);
const nodes=bundle=>{const list=[];function visit(n){list.push(n);n.children?.forEach(visit);}visit(bundle.componentBundle.document.root);return list;};
const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
function contrast(a,b){const l=color=>{const c=rgb(color).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const x=l(a),y=l(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function decodePng(resource){const bytes=Buffer.from(resource.base64,'base64'),parts=[],out={};for(let at=8;at<bytes.length;){const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+length);if(type==='IHDR'){out.width=data.readUInt32BE(0);out.height=data.readUInt32BE(4);assert.equal(data[8],4);assert.equal(data[9],3);}if(type==='PLTE')out.palette=data;if(type==='IDAT')parts.push(data);at+=12+length;}out.raw=inflateSync(Buffer.concat(parts));return out;}

test('explicit roles are independent of labels/actions and preserve geometry, state and native UGUI data',async()=>{
  const spec=fixture(),state={volume:65,muted:false,quality:'medium'},bundle=await createPanelBundle(spec,catalog,core,state);
  assert.equal(bundle.compilerVersion,'0.15.0');assert.deepEqual(await validatePanelBundle(bundle,core),bundle);assert.deepEqual(bundle.state,state);
  const buttons=nodes(bundle).filter(n=>n.type==='Button'),primary=buttons.find(n=>n.props.label==='保存设置'),secondary=buttons.find(n=>n.props.label==='关闭');
  assert.notEqual(primary.props.style.backgroundColor,secondary.props.style.backgroundColor);
  assert.equal(secondary.props.style.borderWidth,1);assert.equal(primary.props.style.borderWidth,0);
  const renamed=structuredClone(spec);renamed.sections[1].rows[2].buttonLabel='关闭';renamed.sections[1].rows[1].buttonLabel='保存设置';
  const after=nodes(await createPanelBundle(renamed,catalog,core,state));for(const button of buttons){const same=after.find(n=>n.id===button.id);assert.deepEqual(same.props.style,button.props.style);assert.deepEqual(same.layout,button.layout);}
  const native=await createUnityDocument(bundle,core);assert(!native.nodes.some(n=>n.id.endsWith('.center-label')));assert.equal(native.nodes.find(n=>n.id===secondary.id).backgroundColor,secondary.props.style.backgroundColor);
  assert.deepEqual(native.controls.filter(c=>c.kind==='button').map(c=>c.action),['reset-initial','emit','emit']);assert.equal(native.assets.length,0,'procedural Pixi skins do not create native asset dependencies');
});

for(const theme of catalog.themes)test(`${theme.id}: field/menu PNGs follow palette and normal/selected text stays readable`,async()=>{
  const spec=fixture();spec.theme={id:theme.id,version:theme.version};const bundle=await createPanelBundle(spec,catalog,core),select=nodes(bundle).find(n=>n.type==='Select'),s=select.props.style,a=select.props.appearance;
  assert.equal(s.backgroundColor,theme.tokens.control);assert(contrast(s.textColor,s.backgroundColor)>=4.5);assert(contrast(s.borderColor,s.backgroundColor)>=3);
  const selected=rgb(s.backgroundColor).map((v,i)=>Math.round(v*.84+rgb(theme.tokens.accent)[i]*.16)),selectedHex='#'+selected.map(v=>v.toString(16).padStart(2,'0')).join('');assert(contrast(s.textColor,selectedHex)>=4.5);
  assert.equal(a.popupCanvas.height,120);assert.equal(bundle.componentBundle.resources.length,3);
  for(const path of [a.fieldImage,a.popupImage]){const png=decodePng(bundle.componentBundle.resources.find(r=>r.path===path));assert.deepEqual([...png.palette.subarray(3,6)],rgb(s.backgroundColor));assert.equal(png.raw.length,(Math.ceil(png.width/2)+1)*png.height);}
  assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  const native=await createUnityDocument(bundle,core);assert.equal(native.nodes.find(n=>n.id===select.id).backgroundColor,theme.tokens.control);
});

test('local colors/radii override role defaults and deterministically rebuild Select resources',async()=>{
  const spec=fixture();spec.appearance=Object.fromEntries(APPEARANCE_KEYS.map(k=>[k,null]));spec.appearance.controlColor='#112233';spec.appearance.controlRadius=0;
  spec.buttonStyles=[{rowId:'save',style:{...Object.fromEntries(BUTTON_STYLE_KEYS.map(k=>[k,null])),backgroundColor:'#553388'}}];
  const bundle=await createPanelBundle(spec,catalog,core),select=nodes(bundle).find(n=>n.type==='Select');assert.equal(select.props.style.cornerRadius,0);assert.equal(select.props.style.backgroundColor,'#112233');
  assert.equal(nodes(bundle).find(n=>n.id.endsWith('.row.save.control')).props.style.backgroundColor,'#553388');assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  const forged=structuredClone(bundle);forged.componentBundle.resources[0].base64=forged.componentBundle.resources[1].base64;await assert.rejects(validatePanelBundle(forged,core));
});

test('profile/compiler and role/kind boundaries fail closed; frozen old themes replay without raster resources',async()=>{
  const spec=fixture(),legacy=structuredClone(spec);legacy.theme.version='0.4.0';legacy.sections[1].rows.forEach(row=>row.recipe={id:'settings.button',version:'0.1.0'});
  const before=await createPanelBundle(legacy,oldCatalog,core);assert.equal(before.compilerVersion,'0.10.0');assert.equal(before.componentBundle.resources.length,0);assert.deepEqual(await validatePanelBundle(before,core),before);
  assert.throws(()=>compilePanel(spec,catalog,core,undefined,undefined,'0.10.0'),/COMPILER_VERSION/);assert.throws(()=>compilePanel(legacy,oldCatalog,core,undefined,undefined,'0.15.0'),/COMPILER_VERSION/);
  const mixed=structuredClone(catalog);delete mixed.themes.find(t=>t.id===spec.theme.id).controlStyle;assert.throws(()=>compilePanel(spec,mixed,core),/BUTTON_ROLE_THEME/);
  for(const mutation of [c=>c.themes[0].controlStyle='unknown',c=>c.recipes[0].buttonRole='primary',c=>c.recipes.at(-1).buttonRole='unknown']){const bad=structuredClone(catalog);mutation(bad);assert.throws(()=>validateCatalog(bad));}
});

test('generation schema and prompt expose explicit role recipes from the pinned catalog',async()=>{
  const context=await createPlanningContext({requestVersion:'0.1',id:'semantic-settings',target:'pixi',text:'做一个设置面板，保存是主要按钮，关闭是次要按钮。'},catalog);
  const schema=JSON.stringify(buildNativePanelIntentResponseSchema(context));for(const role of ['primary','secondary','danger'])assert(schema.includes(`settings.button.${role}@0.1.0`));
  assert(!schema.includes('settings.button@0.1.0'),'new generation must choose an explicit role');
  const guide=themePlanningGuide(catalog);assert(guide.includes('Roles change appearance only'));assert(guide.includes('one primary per action group'));
});

test('authored asset closure remains separate from regenerated skins through restore and native packaging',async()=>{
  const spec=fixture(),bytes=new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png',import.meta.url))),sha256=await digestBytes(bytes),key='test-kit/panel-surface@1.0.0';
  spec.assets={library:{id:'test-kit',sha256:'a'.repeat(64)},panelSurface:key,rowIcons:[]};
  const input={closure:{assetClosureVersion:'0.1',library:spec.assets.library,records:[{key,role:'shape',width:64,height:64,slice:{left:7,top:11,right:9,bottom:13},sha256,bytes:bytes.length}]},resources:[{path:`textures/${sha256}.png`,mime:'image/png',bytes}]};
  const bundle=await createPanelBundle(spec,catalog,core,undefined,input);assert.equal(bundle.componentBundle.resources.length,4);
  assert.deepEqual(await validatePanelBundle(bundle,core),bundle);assert.equal(panelBundleAssetInputs(bundle,core).resources.length,1);
  const native=await createUnityDocument(bundle,core);assert.equal(native.assets.length,1);assert.equal(native.assets[0].sha256,sha256);
  const kit=await createUnityKitFiles(bundle,core,await readUnityAdapterSources());assert(![...kit.contents.keys()].some(path=>path.startsWith('generated/')));assert(kit.contents.has(`textures/${sha256}.png`));
});
