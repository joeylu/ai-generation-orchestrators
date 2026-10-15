import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {extendSkinMaterials,verifyMaterialExtension} from '../src/skins/materials.mjs';
import {verifySkinPackage,json,hash} from '../src/skins/package.mjs';
import {validatePack} from '../src/skins/contract.mjs';
import {surfaceStyleInfo,surfaceTextBox,validateSurfaceStyles} from '../src/skins/surface-styles.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {editorData} from '../src/panel/data.mjs';
import {resourceClosure,validateDocument} from '../src/panel/document.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {validateSizeEdit} from '../src/panel/size-edit.mjs';
const fixture=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-chain-materials-')));
const oldManifest=await readFile(join(fixture.packageDirectory,'skin-pack.json'));
const result=await extendSkinMaterials({...fixture,output:join(fixture.directory,'decorated')});
const verified=await verifySkinPackage(result.packageDirectory),{pack,resources}=verified;

test('material import preserves all base pixels, source identity and shared raw provenance',async()=>{
 assert.equal(pack.assets.length,30);assert.equal(pack.materialAssets.length,2);assert.equal(result.modelCalls,0);
 assert.deepEqual(await readFile(join(fixture.packageDirectory,'skin-pack.json')),oldManifest);
 const before=await verifySkinPackage(fixture.packageDirectory);
 for(const a of before.pack.assets)assert.deepEqual(resources.get(a.file),before.resources.get(a.file));
 assert.equal(pack.materialAssets[0].source.file,pack.materialAssets[1].source.file);
 assert.deepEqual(resources.get(pack.materialAssets[0].source.file),await readFile(join(fixture.directory,'paper.png')));
 assert.equal(pack.revision,before.pack.revision+1);assert.equal(pack.visualAcceptance,'unreviewed');
 assert.equal(verified.textReadability.status,'needs-review');assert(verified.textReadability.surfaceCompositing.styles.includes('title'));
});
test('selection accepts a checked extension but rejects altered base contracts or pixels',async()=>{
 const original=await verifySkinPackage(fixture.packageDirectory),report=JSON.parse(await readFile(join(result.directory,'report.json'),'utf8'));
 verifyMaterialExtension(original,verified,report);
 const replaced={...verified,pack:structuredClone(pack)};replaced.pack.theme.palette.text='#123456';
 assert.throws(()=>verifyMaterialExtension(original,replaced,report),{code:'skin.material'});
 const pixels={...verified,resources:new Map(resources)};pixels.resources.set(pack.assets[0].file,Buffer.from('changed'));
 assert.throws(()=>verifyMaterialExtension(original,pixels,report),{code:'skin.material'});
 assert.throws(()=>verifyMaterialExtension(original,verified,{...report,sourceSkinSha256:'0'.repeat(64)}),{code:'skin.material'});
});
test('material style rejects missing sources, unknown fields, invalid sizes and unsafe paths',()=>{
 for(const change of [s=>s.title.layers[0].assetId='missing',s=>s.title.radius=-1,s=>s.title.layers[0].scale=0,s=>s.title.layers[0].url='https://example.invalid',s=>s.title.baseRole='skin.missing']){
  const styles=structuredClone(pack.surfaceStyles);change(styles);assert.throws(()=>validateSurfaceStyles(styles,[...pack.assets,...pack.materialAssets].map(a=>a.assetId),pack.roles.map(r=>r.role)),{code:'skin.surface-style'});
 }
 const corrupt=structuredClone(pack);corrupt.materialAssets[0].source.file='../escape.png';assert.throws(()=>validatePack(corrupt),{code:'skin.material'});
});

test('complete title bands replace the base with full bounds; overlays still protect the old border',()=>{
 const ids=[...pack.assets,...pack.materialAssets].map(a=>a.assetId),roles=pack.roles.map(r=>r.role),replacement=structuredClone(pack);
 replacement.surfaceStyles.title.baseMode='replace';delete replacement.surfaceStyles.title.clipInsets;
 validateSurfaceStyles(replacement.surfaceStyles,ids,roles);
 const info=surfaceStyleInfo(replacement,'title');
 assert.deepEqual(info.clipInsets,{left:0,right:0,top:0,bottom:0});
 assert.deepEqual(info.insets,pack.surfaceStyles.title.insets);
 assert.deepEqual(surfaceStyleInfo(pack,'title').clipInsets,pack.surfaceStyles.title.clipInsets);
 const zero={left:0,right:0,top:0,bottom:0};replacement.surfaceStyles.title.clipInsets=zero;assert.doesNotThrow(()=>validatePack(replacement));
 const overlay=structuredClone(replacement);overlay.surfaceStyles.title.baseMode='overlay';assert.throws(()=>validatePack(overlay),{code:'skin.surface-style'});
 for(const change of [s=>s.title.baseMode='unknown',s=>s.title.layers=[],s=>s.panel.baseMode='replace']){
  const styles=structuredClone(replacement.surfaceStyles);change(styles);assert.throws(()=>validateSurfaceStyles(styles,ids,roles),{code:'skin.surface-style'});
 }
});
test('rehashed replacement pixels still fail material crop replay',async()=>{
 const item=pack.materialAssets[0],file=join(result.packageDirectory,item.file),original=resources.get(item.file);
 await writeFile(file,resources.get(pack.materialAssets[1].file));
 const changed=structuredClone(pack),entry=changed.materialAssets[0];entry.sha256=hash(await readFile(file));entry.bytes=(await readFile(file)).length;
 await writeFile(join(result.packageDirectory,'skin-pack.json'),json(changed));
 await assert.rejects(()=>verifySkinPackage(result.packageDirectory),{code:'skin.material'});
 await writeFile(file,original);await writeFile(join(result.packageDirectory,'skin-pack.json'),json(pack));
});
test('import supports the optional material contract directly and rejects changed source digest',async()=>{
 const config=structuredClone(fixture.config);config.materials[0].sha256='0'.repeat(64);const path=join(fixture.directory,'bad-input.json');await writeFile(path,json(config));
 await assert.rejects(()=>extendSkinMaterials({packageDirectory:fixture.packageDirectory,configPath:path,output:join(fixture.directory,'invalid')}),{code:'skin.material'});
 const {buildSkinPackage}=await import('../src/skins/package.mjs');
 const spec={...fixture.spec,materials:fixture.config.materials,surfaceStyles:fixture.config.surfaceStyles};await writeFile(fixture.input,json(spec));
 const built=await buildSkinPackage({input:fixture.input,output:join(fixture.directory,'direct-import')});
 assert.equal((await verifySkinPackage(join(built.directory,'pack'))).pack.materialAssets.length,2);
});
test('new headings use skin surfaces; closure, editor and legacy compilation preserve the recipe',async()=>{
 const ctx={...await editorData(),...settingsSkinGeometry(pack),profile:pack.theme,orientation:'landscape'};
 const config=customActionConfig(JSON.parse(await readFile(new URL('../configs/action-presets.json',import.meta.url)))),catalog=JSON.parse(await readFile(new URL('../../ui-panel-harness/examples/modern-all-components.catalog.json',import.meta.url)));
 const example={id:'surface-example',presetId:'custom',request:'Create game settings with an audio description.',title:'Game Settings',sectionTitle:'Audio',rows:[{kind:'text',recipeKey:'settings.text@0.1.0',label:'Audio',text:'Audio controls',wrap:'word'}]};
 const f=await actionFixture(example,catalog,config),converted=await actionPresetFromIntent(f.session,f.intent,config,'custom',ctx),doc=converted.documents.landscape;
 const heading=doc.nodes.find(n=>n.id==='heading');assert.equal(heading.surfaceStyle,'title');
 assert(surfaceTextBox(ctx.skinGeometry,'title',heading.size.width,heading.size.height).height>=ctx.profile.geometry.lineHeight);
 const closure=resourceClosure(doc,ctx);assert(closure.assets.includes('material.paper'));assert(closure.roles.includes('skin.surface.bar'));
 assert.deepEqual(validateSizeEdit(doc,doc,ctx),validateDocument(doc,ctx));
 const changed=structuredClone(doc);changed.nodes.find(n=>n.id==='heading').surfaceStyle='panel';assert.throws(()=>validateDocument(changed,ctx),{code:'panel.surface-style'});
 const legacy=await actionPresetFromIntent(f.session,f.intent,config,'custom',{...ctx,surfaceStylesEnabled:false});assert.equal(legacy.documents.landscape.nodes.find(n=>n.id==='heading').surfaceStyle,undefined);
});
