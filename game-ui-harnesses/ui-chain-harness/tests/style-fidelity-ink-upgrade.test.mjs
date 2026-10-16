import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve,sep} from 'node:path';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {hash,json,readSafe,verifySkinPackage} from '../src/skins/package.mjs';
import {encodePng} from '../src/skins/png.mjs';
import {extractMaterialAtlas,materializeMaterialAtlas} from '../src/skins/material-atlas.mjs';
import {extendSkinMaterials} from '../src/skins/materials.mjs';
import {validateStyleFidelityInkUpgrade,verifyStyleFidelityRuntimeUpgrade,verifyBatchStyleEvidence} from '../src/acceptance/style-fidelity.mjs';

async function fixture(t,{edgeMismatch=false}={}){
 const root=await mkdtemp(join(tmpdir(),'style-ink-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const parent=join(root,'work/fixture'),base=await materialSkinFixture(join(parent,'base')),baseSkin=await verifySkinPackage(base.packageDirectory);
 const ids=['material.title-band','material.section-band','material.panel-fill'],template={kind:'ui_material_template',version:'1.0',sheetId:'S05',coordinates:{width:32,height:32,outputScale:1},parts:[
  {assetId:ids[0],slotRect:[1,1,30,6],bodyRect:[2,2,28,4],stretch:'horizontal',purpose:'title'},
  {assetId:ids[1],slotRect:[1,9,30,5],bodyRect:[2,10,28,3],stretch:'horizontal',purpose:'section'},
  {assetId:ids[2],slotRect:[1,17,14,14],bodyRect:[2,18,12,12],stretch:'tile',purpose:'panel'}]};
 const image={width:32,height:32,pixels:Buffer.alloc(32*32*4)};for(const [index,part]of template.parts.entries()){const[x,y,w,h]=part.bodyRect;for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)image.pixels.set(index===0?[30,75,92,255]:[244,235,210,255],(py*32+px)*4);}
 if(edgeMismatch)for(let y=18;y<30;y++)image.pixels.set([30,75,92,255],(y*32+13)*4);
 const raw=encodePng(image),input={raw,rawSha256:hash(raw),template,sourceSkinSha256:baseSkin.manifestSha256,pack:baseSkin.pack};
 const previousExtraction=await materializeMaterialAtlas({...input,extractionVersion:'1.0',output:join(parent,'s05-v10')}),first=await extendSkinMaterials({packageDirectory:base.packageDirectory,configPath:previousExtraction.configPath,output:join(parent,'original')}),original=await verifySkinPackage(first.packageDirectory),currentExtraction=extractMaterialAtlas({...input,extractionVersion:'1.2'});
 const spec={kind:'ui_skin_material_input',version:'1.0',sourceSkinSha256:original.manifestSha256,materials:[],surfaceStyles:currentExtraction.spec.surfaceStyles},configPath=join(parent,'ink-only.json');await writeFile(configPath,json(spec));
 const updated=await extendSkinMaterials({packageDirectory:first.packageDirectory,configPath,output:join(parent,'updated')}),verified=await verifySkinPackage(updated.packageDirectory),extension=JSON.parse(await readFile(join(updated.directory,'report.json')));
 const rel=file=>relative(root,file).split(sep).join('/');
 async function consumer(name,skin){const directory=join(parent,name),files=[];await mkdir(directory,{recursive:true});for(const [file,bytes]of [['index.html',Buffer.from('fixture html')],['runtime.mjs',Buffer.from('fixture runtime')],['kit.json',Buffer.from('{}')],['skin/skin-pack.json',Buffer.from(json(skin.pack))],...[...skin.resources].map(([file,bytes])=>['skin/'+file,bytes])]){await mkdir(join(directory,file,'..'),{recursive:true});await writeFile(join(directory,file),bytes);files.push({file,sha256:hash(bytes)});}const bytes=Buffer.from(json({kind:'ui_component_consumer_candidate',version:'0.1',components:16,manifestSha256:skin.manifestSha256,files}));await writeFile(join(directory,'manifest.json'),bytes);return{directory,manifestSha256:hash(bytes),files};}
 const oldConsumer=await consumer('old-consumer',original),newConsumer=await consumer('new-consumer',verified),checkFile=join(parent,'checks.json'),checks={kind:'ui_consumer_relocation_check',status:'passed',manifestSha256:newConsumer.manifestSha256,sourceSkinSha256:verified.manifestSha256,components:16,publicFactory:'passed',results:[{status:'passed'}],errors:[]};await writeFile(checkFile,json(checks));
 const upgrade={kind:'ui_component_runtime_upgrade',version:'1.0',sourceConsumerSha256:oldConsumer.manifestSha256,originalSkinSha256:original.manifestSha256,skinSha256:verified.manifestSha256,materialExtension:{file:rel(join(updated.directory,'report.json')),sha256:hash(json(extension))},consumerSha256:newConsumer.manifestSha256,directory:rel(newConsumer.directory),checkFile:rel(checkFile),checkSha256:hash(json(checks)),modelCalls:0},upgradeFile=join(parent,'upgrade.json');
 const save=async()=>{await writeFile(upgradeFile,json(upgrade));return {file:rel(upgradeFile),sha256:hash(json(upgrade))};};const selection=await save();
 const evidence=new Map(),record=async(file,bytes,expected)=>{const path=resolve(root,file),name=rel(path);assert(name.startsWith('work/')&&!name.includes('../'));const data=bytes??await readSafe(root,name),digest=hash(data);if(expected!==undefined)assert.equal(digest,expected);if(evidence.has(name))assert.equal(evidence.get(name),digest);evidence.set(name,digest);return data;};
 return {root,parent,original,verified,extension,previousExtraction,currentExtraction,selection,upgrade,upgradeFile,save,checkFile,checks,originalDirectory:oldConsumer.directory,newConsumer,record,evidence};
}

test('official ink-only runtime extension preserves all original material bytes and records every upgraded dependency',async t=>{
 const f=await fixture(t),proof=await verifyStyleFidelityRuntimeUpgrade(f);
 assert.equal(proof.extractionVersion,'1.2');assert.equal(proof.modelCalls,0);assert.equal(proof.sourceSkinSha256,f.original.manifestSha256);assert.equal(proof.skinSha256,f.verified.manifestSha256);
 assert.deepEqual(f.original.pack.materialAssets,f.verified.pack.materialAssets);assert.equal(f.verified.pack.surfaceStyles.title.textColor,'#F5F7FF');assert.equal(f.verified.pack.surfaceStyles.section.textColor,'#111827');
 for(const file of [f.selection.file,f.upgrade.checkFile,f.upgrade.materialExtension.file,relative(f.root,join(f.newConsumer.directory,'manifest.json')).split(sep).join('/'),...f.newConsumer.files.map(entry=>relative(f.root,join(f.newConsumer.directory,entry.file)).split(sep).join('/'))])assert(f.evidence.has(file));
 const reference={id:'pixel-cartoon',sha256:'f'.repeat(64)},proofFile=join(f.parent,'proof.json'),skinSha256=f.verified.manifestSha256,proofBody={kind:'ui_panel_style_fidelity_evidence',version:'1.0',skinSha256,reference,bindings:[{surface:'title'},{surface:'section'},{surface:'panel'}],files:[...f.evidence].map(([file,sha256])=>({file,sha256}))};await writeFile(proofFile,json(proofBody));
 const batch={acceptanceMode:'style-fidelity',styleSkins:[{skin:'pixel-cartoon',file:'proof.json',skinSha256,reference}],styleReferences:[reference],cases:[{skin:'pixel-cartoon',skinSha256}],files:[{file:'proof.json'}]};
 await verifyBatchStyleEvidence({root:f.root,directory:f.parent,batch});await writeFile(f.checkFile,'changed after preparation');await assert.rejects(verifyBatchStyleEvidence({root:f.root,directory:f.parent,batch}),{code:'ACCEPTANCE_STYLE_PROVENANCE_CHANGED'});
});

test('arbitrary colors, panel changes, crop changes, new materials and base pixels cannot use the ink upgrade exception',async t=>{
 const f=await fixture(t);assert.doesNotThrow(()=>validateStyleFidelityInkUpgrade(f));
 for(const mutate of [next=>next.pack.surfaceStyles.title.textColor='#FFFFFF',next=>next.pack.surfaceStyles.panel.layers[0].alpha=.5,next=>next.pack.surfaceStyles.panel.layers[0].mode='cover',next=>next.pack.surfaceStyles.title.layers[0].anchorX=0,next=>next.pack.materialAssets[0].source.crop[0]++,next=>next.pack.materialAssets.push({...next.pack.materialAssets[0],assetId:'material.extra'}),next=>next.pack.theme.palette.text='#000000',next=>next.resources.set(next.pack.assets[0].file,Buffer.from('changed'))]){
  const verified={...f.verified,pack:structuredClone(f.verified.pack),resources:new Map(f.verified.resources)};mutate(verified);assert.throws(()=>validateStyleFidelityInkUpgrade({...f,verified}));
 }
 const bad=structuredClone(f.currentExtraction);bad.report.version='1.0';assert.throws(()=>validateStyleFidelityInkUpgrade({...f,currentExtraction:bad}));
});

test('a source-derived tile-to-cover upgrade passes the complete official chain without changing any material pixels',async t=>{
 const f=await fixture(t,{edgeMismatch:true});
 assert.equal(f.previousExtraction.spec.surfaceStyles.panel.layers[0].mode,'tile');assert.equal(f.currentExtraction.report.panelPresentation.reason,'opposite-edges-differ');assert.equal(f.currentExtraction.spec.surfaceStyles.panel.layers[0].mode,'cover');
 const proof=await verifyStyleFidelityRuntimeUpgrade(f);assert.equal(proof.extractionVersion,'1.2');assert.equal(f.verified.pack.surfaceStyles.panel.layers[0].mode,'cover');
 assert.deepEqual(f.original.pack.materialAssets,f.verified.pack.materialAssets);for(const [file,bytes]of f.original.resources)assert.deepEqual(f.verified.resources.get(file),bytes);
 assert.deepEqual(f.previousExtraction.spec.materials,f.currentExtraction.spec.materials);assert.equal(f.verified.pack.surfaceStyles.panel.layers[0].alpha,.14);assert.equal(f.verified.pack.surfaceStyles.panel.layers[0].blendMode,'multiply');assert(f.evidence.has(f.upgrade.checkFile));
});

test('upgrade mapping shape, path, source consumer and official browser check remain mandatory',async t=>{
 const f=await fixture(t);
 for(const selection of [{...f.selection,success:true},{file:'work/../private.json',sha256:f.selection.sha256},{...f.selection,sha256:'f'.repeat(64)},null])await assert.rejects(verifyStyleFidelityRuntimeUpgrade({...f,selection}));
 f.upgrade.sourceConsumerSha256='f'.repeat(64);let selection=await f.save();f.evidence.clear();await assert.rejects(verifyStyleFidelityRuntimeUpgrade({...f,selection}),/COMPONENT_UPGRADE_SOURCE/);
 f.upgrade.sourceConsumerSha256=hash(await readFile(join(f.originalDirectory,'manifest.json')));
 f.checks.status='failed';await writeFile(f.checkFile,json(f.checks));f.upgrade.checkSha256=hash(json(f.checks));selection=await f.save();f.evidence.clear();await assert.rejects(verifyStyleFidelityRuntimeUpgrade({...f,selection}),/COMPONENT_UPGRADE_CHECK/);
});
