import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {materialSkinFixture} from '../fixtures/material-skin.mjs';
import {buildSkinPackage,verifySkinPackage,hash,json} from '../src/skins/package.mjs';
import {prepareAcceptance} from '../src/acceptance/batch.mjs';
import {acceptanceReport} from '../src/acceptance/check.mjs';
import {acceptanceMode,acceptanceAssessment,canonicalStyleReferences,validateStyleFidelityBindings,verifyStyleFidelitySkin,validateBatchStyleScope,verifyBatchStyleEvidence} from '../src/acceptance/style-fidelity.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),sha=text=>hash(Buffer.from(text)),reference={id:'pixel-cartoon',sha256:sha('offline canonical reference')};
function bindingFixture(){
 const ids=['material.title-band','material.section-band','material.panel-fill'],keys=['title','section','panel'],raw=sha('offline S05 raw'),template=sha('offline S05 template'),plan=sha('offline S05 plan'),materials=ids.map((assetId,index)=>({assetId,sha256:raw,crop:[0,index*10,10,10]})),surfaceStyles=Object.fromEntries(keys.map((key,index)=>[key,{baseRole:key==='panel'?'skin.surface.panel':'skin.surface.bar',layers:[{assetId:ids[index],mode:key==='panel'?'tile':'cover',alpha:1}]}]));
 return {reference,verified:{pack:{surfaceStyles:structuredClone(surfaceStyles),materialAssets:materials.map(m=>({assetId:m.assetId,sha256:sha(m.assetId),source:{sha256:m.sha256,crop:m.crop}}))}},intake:{summary:{status:'received-awaiting-localization',referenceSha256:reference.sha256,nodes:['S01','S02','S03','S04','S05'].map(sheetId=>({sheetId,status:'received',planSha256:sheetId==='S05'?plan:sha('offline plan '+sheetId),rawSha256:sheetId==='S05'?raw:sha('offline raw '+sheetId)}))},materialSources:[{sheetId:'S05',sha256:raw,planSha256:plan,template:{sha256:template}}]},material:{input:{planSha256:plan,raw:{sha256:raw}},template:{sha256:template}},extraction:{report:{source:{sha256:raw},templateSha256:template},spec:{materials,surfaceStyles}}};
}

test('all three S05 layers must bind to the verified producer crops from the same five-sheet reference',()=>{
 const fixture=bindingFixture();assert.deepEqual(validateStyleFidelityBindings(fixture).map(b=>b.surface),['title','section','panel']);
 for(const corrupt of [
  f=>{f.intake.summary.referenceSha256=sha('another historical reference');},
  f=>{f.intake.summary.nodes.pop();f.intake.materialSources=[];},
  f=>{f.intake.summary.nodes[0].sheetId='S02';},
  f=>{f.intake.summary.nodes[4].status='indeterminate';},
  f=>{f.material.input.planSha256=sha('a different S05 attempt');},
  f=>{f.extraction.report.templateSha256=sha('a different frozen template');},
  f=>{delete f.verified.pack.surfaceStyles.section;},
  f=>{f.verified.pack.surfaceStyles.panel.layers[0].assetId='material.title-band';},
  f=>{f.verified.pack.materialAssets[0].source.sha256=sha('a hand supplied texture');},
  f=>{f.verified.pack.materialAssets[2].source.crop=[1,1,9,9];},
 ]){const bad=structuredClone(fixture);corrupt(bad);assert.throws(()=>validateStyleFidelityBindings(bad));}
});

test('mapping must use one of the current six references and a retained producer task, never a caller success flag',async()=>{
 const references=await canonicalStyleReferences(root);assert.equal(references.length,6);const fixture=bindingFixture();
 const common={root,verified:fixture.verified,contracts:{},references};
 await assert.rejects(verifyStyleFidelitySkin({...common,selected:{styleReference:{id:'woodland',sha256:sha('historical')}}}),{code:'ACCEPTANCE_STYLE_REFERENCE_REQUIRED'});
 await assert.rejects(verifyStyleFidelitySkin({...common,selected:{styleReference:{id:references[0].id,sha256:sha('wrong')}}}),{code:'ACCEPTANCE_STYLE_REFERENCE_REQUIRED'});
 await assert.rejects(verifyStyleFidelitySkin({...common,styleId:references[1].id,selected:{styleReference:references[0]}}),{code:'ACCEPTANCE_STYLE_REFERENCE_REQUIRED'});
 await assert.rejects(verifyStyleFidelitySkin({...common,selected:{styleReference:references[0],sourceVerified:true}}),{code:'ACCEPTANCE_STYLE_PROVENANCE_REQUIRED'});
 const noMaterials=structuredClone(fixture.verified);noMaterials.pack.materialAssets=[];
 await assert.rejects(verifyStyleFidelitySkin({...common,verified:noMaterials,selected:{styleReference:references[0],skinTaskDirectory:'work/does-not-exist'}}),{code:'ACCEPTANCE_STYLE_S05_REQUIRED'});
});

test('style preflight rejects every used legacy skin before a panel preparation or model call',async()=>{
 const parent=join(root,'work/tests');await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'style-preflight-')),raster=await materialSkinFixture(join(directory,'input'));
 await writeFile(raster.input,json({...raster.spec,sourceKind:'imported'}));const built=await buildSkinPackage({input:raster.input,output:join(directory,'build')}),verified=await verifySkinPackage(join(built.directory,'pack'));
 let calls=0;const spec={version:'1.0',presets:[],custom:[{id:'C01',skin:'old',orientation:'portrait',text:'公告',expected:{literals:['公告']}}]},canonical=(await canonicalStyleReferences(root))[1];
 await assert.rejects(prepareAcceptance({root,spec,mode:'style-fidelity',skins:{old:{packageDirectory:join(built.directory,'pack'),styleReference:{id:canonical.id,sha256:canonical.sha256},skinTaskDirectory:'work/does-not-exist'}},evidenceDirectory:join(tmpdir(),'style-preflight-unused'),identity:async()=>({sha256:sha('offline source')}),sdkIdentity:async()=>({mode:'locked'}),runCommand:async()=>{calls++;throw Error('must not prepare or run');}}),{code:'ACCEPTANCE_STYLE_S05_REQUIRED'});
 assert.equal(calls,0);assert.equal(verified.pack.materialAssets,undefined);
});

test('technical passes never imply visual acceptance, including old batches without a mode',()=>{
 assert.equal(acceptanceMode(),'compatibility');assert.throws(()=>acceptanceMode('all'),{code:'ACCEPTANCE_MODE_INVALID'});
 for(const batch of [{},{acceptanceMode:'compatibility'}]){const scope=acceptanceAssessment(batch,'passed');assert.equal(scope.technicalAcceptance.status,'passed');assert.equal(scope.styleFidelity.status,'not-assessed');assert.equal(scope.productionReady,false);assert.equal(scope.visualAcceptance,'unreviewed');}
 const scope=acceptanceAssessment({acceptanceMode:'style-fidelity'},'passed');assert.equal(scope.styleFidelity.status,'awaiting-visual-review');assert.equal(scope.productionReady,false);
 assert.throws(()=>validateBatchStyleScope({acceptanceMode:'style-fidelity',cases:[],files:[]}),{code:'ACCEPTANCE_STYLE_PROVENANCE_REQUIRED'});
});

test('a new summary labels historical C11-C30 as compatibility and leaves the original reports byte exact',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'style-legacy-report-')),evidenceDirectory=join(directory,'external'),reportDirectory=join(evidenceDirectory,'original');await mkdir(reportDirectory,{recursive:true});
 const cases=[{id:'C11',skin:'woodland'},{id:'C21',skin:'bakery'}].map(c=>({...c,kind:'custom',planSha256:sha('offline '+c.id)})),body={kind:'ui_panel_acceptance_batch',version:'1.0',evidenceDirectory,cases,files:[]},batch={...body,sha256:sha(json(body))},oldReport={kind:'ui_panel_acceptance_check',version:'1.0',batchSha256:batch.sha256,createdAt:'2026-01-01T00:00:00.000Z',status:'passed',results:cases.map(c=>({id:c.id,status:'passed'}))};
 const oldBytes=Buffer.from(json(oldReport));await writeFile(join(directory,'batch.json'),json(batch));await writeFile(join(reportDirectory,'report.json'),oldBytes);
 const summary=await acceptanceReport({root:directory,directory});assert.equal(summary.status,'passed');assert.equal(summary.acceptanceMode,'compatibility');assert.equal(summary.styleFidelity.status,'not-assessed');assert.equal(summary.passed,2);
 for(const item of summary.cases){assert.equal(item.technicalAcceptance.status,'passed');assert.equal(item.styleFidelity.status,'not-assessed');assert.equal(item.visualAcceptance,'unreviewed');assert.equal(item.productionReady,false);}
 assert.deepEqual(await readFile(join(reportDirectory,'report.json')),oldBytes);assert.equal(summary.history.length,1);
});

test('source fingerprints are rechecked before dispatch and cannot be replaced by a frozen eligible label',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'style-proof-')),source=join(directory,'work/source');await mkdir(source,{recursive:true});await writeFile(join(source,'raw.png'),'immutable fixture');
 const proof={kind:'ui_panel_style_fidelity_evidence',version:'1.0',skinSha256:sha('offline skin'),reference,bindings:[{surface:'title'},{surface:'section'},{surface:'panel'}],files:[{file:'work/source/raw.png',sha256:sha('immutable fixture')}]};
 await writeFile(join(directory,'proof.json'),json(proof));const batch={acceptanceMode:'style-fidelity',styleSkins:[{skin:'pixel',file:'proof.json',skinSha256:proof.skinSha256,reference}],styleReferences:[reference],cases:[{skin:'pixel',skinSha256:proof.skinSha256}],files:[{file:'proof.json'}]};
 await verifyBatchStyleEvidence({root:directory,directory,batch});await writeFile(join(source,'raw.png'),'changed fixture');await assert.rejects(verifyBatchStyleEvidence({root:directory,directory,batch}),{code:'ACCEPTANCE_STYLE_PROVENANCE_CHANGED'});
});
