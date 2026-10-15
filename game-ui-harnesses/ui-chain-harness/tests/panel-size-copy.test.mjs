import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {extendSkinMaterials} from '../src/skins/materials.mjs';
import {verifySkinPackage,hash} from '../src/skins/package.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {editorData,presetDocument} from '../src/panel/data.mjs';
import {readContracts} from '../src/contracts/validate.mjs';
import {defaults} from '../src/contracts/build.mjs';
import {textEditDocument} from '../src/panel/size-edit.mjs';
import {panelSizeCopy,verifyPanelSizeCopy} from '../src/panel/size-copy.mjs';

async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),'panel-copy-export-'));
 try{
  const base=await materialSkinFixture(join(directory,'base')),extended=await extendSkinMaterials({...base,output:join(directory,'materials')}),verified=await verifySkinPackage(extended.packageDirectory),contracts=await readContracts(defaults);
  const ctx={...await editorData(contracts),...settingsSkinGeometry(verified.pack),profile:verified.pack.theme,binding:{sourceKind:'imported',sha256:verified.manifestSha256}};
  const document=presetDocument(ctx.presets.presets[0],ctx),source={kind:'ui_panel_edit_source',version:'1.0',artifactId:'panel-export-test',previewSha256:'a'.repeat(64),source:'offline-fixtures',ctx,
   pack:{manifest:(await readFile(join(extended.packageDirectory,'skin-pack.json'))).toString('base64'),manifestSha256:verified.manifestSha256,bindings:verified.pack.bindings,resources:Object.fromEntries([...verified.resources].filter(([file])=>!file.startsWith('sources/')).map(([file,bytes])=>[file,bytes.toString('base64')]))},
   variants:[{key:'settings-landscape',orientation:'landscape',document,behavior:{version:'1.0',fields:[],actions:[],dismissOnEmit:false}}]};
  const input={source,variantKey:source.variants[0].key,document:textEditDocument(document,{nodeId:'intro',changes:{text:'可携带纹理的副本'}},ctx)};
  await run({source,input,verified,contracts});
 }finally{await rm(directory,{recursive:true,force:true});}
}

test('portable JSON keeps prior fields and embeds exact runtime assets, material source PNGs and fonts without play data',async()=>{
 await fixture(async({source,input,verified})=>{
  const before=structuredClone(source),value=await panelSizeCopy(input);
  assert.equal(value.kind,'ui_panel_size_copy');assert.equal(value.version,'1.0');assert.equal(value.skinSha256,source.pack.manifestSha256);assert.equal(value.sourceSha256,source.previewSha256);
  assert.deepEqual(value.document,input.document);assert.deepEqual(value.behavior,source.variants[0].behavior);assert.deepEqual(value.portable.pack,source.pack);
  for(const asset of verified.pack.materialAssets){assert.equal(hash(Buffer.from(value.portable.pack.resources[asset.file],'base64')),asset.sha256);assert.equal(hash(Buffer.from(value.portable.pack.resources[asset.source.file],'base64')),asset.source.sha256);}
  for(const font of verified.pack.fonts)assert.equal(hash(Buffer.from(value.portable.pack.resources[font.file],'base64')),font.sha256);
  assert.equal(value.portable.contractEvidence,'derived-editor-context');assert.deepEqual(value.portable.originalContractBindings,verified.pack.bindings);assert.equal(value.portable.sourceContracts,undefined);
  assert.equal(value.portable.derivedContracts.length,3);assert(value.portable.derivedContracts.every(file=>file.serialization==='canonical-editor-context-json'&&hash(Buffer.from(file.base64,'base64'))===file.sha256));
  assert(!['state','camera','scale','navigation','playState'].some(key=>Object.hasOwn(value,key)));assert.equal(value.portable.scope,'runtime-json');assert.deepEqual(source,before);
  await verifyPanelSizeCopy(JSON.parse(JSON.stringify(value)));
 });
});
test('new previews retain exact original contract bytes separately from upgraded editor JSON snapshots',async()=>{
 await fixture(async({source,input,contracts})=>{
  source.sourceContracts={version:'1.0',files:['registry','usage','template'].map(name=>{const bytes=contracts.bytes[name];return {name,bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};})};
  const value=await panelSizeCopy(input);assert.equal(value.portable.contractEvidence,'original-source-bytes');assert.deepEqual(value.portable.sourceContracts,source.sourceContracts);
  for(const file of value.portable.sourceContracts.files){assert.deepEqual(Buffer.from(file.base64,'base64'),contracts.bytes[file.name]);assert.equal(file.sha256,value.portable.originalContractBindings[file.name+'Sha256']);}
  value.portable.sourceContracts.files[0].base64=Buffer.from('{}').toString('base64');await assert.rejects(()=>verifyPanelSizeCopy(value),{code:'panel.copy-export'});
 });
});
test('portable checks reject missing or changed texture bytes, changed contract snapshots and altered skin bindings',async()=>{
 await fixture(async({input,verified})=>{
  const value=await panelSizeCopy(input),material=verified.pack.materialAssets[0];
  for(const mutate of [v=>delete v.portable.pack.resources[material.file],v=>v.portable.pack.resources[material.source.file]=Buffer.from('changed').toString('base64'),v=>v.portable.context.registry.kind='changed',v=>v.portable.derivedContracts[0].base64=Buffer.from('{}').toString('base64'),v=>v.skinSha256='b'.repeat(64),v=>v.document.bindings.sha256='b'.repeat(64)]){
   const corrupt=structuredClone(value);mutate(corrupt);await assert.rejects(()=>verifyPanelSizeCopy(corrupt),{code:'panel.copy-export'});
  }
  const wrong=structuredClone(input);wrong.document.nodes.find(n=>n.id==='intro').props.text='x'.repeat(32769);await assert.rejects(()=>panelSizeCopy(wrong));
 });
});
