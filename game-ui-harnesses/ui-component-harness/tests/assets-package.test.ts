import test from 'node:test';
import assert from 'node:assert/strict';
import { assetsPackageFixture } from './helpers/assets-package-fixture.ts';
import { importDecompositionZip, assertValidImportedDecomposition, componentHandoffEntries } from '../src/decomposition-import.ts';
import { compileDecompositionAssets, importComponentHandoffWithReview } from '../src/component-handoff.ts';
import { referenceSha256, exportReferenceHandoff, zip } from '../src/reference-persistence.ts';
import { validateBundle } from '../src/bundle.ts';
import { intakeAssets, planAssets } from '../src/assets-intake.ts';
import { forceZip64Stored } from './helpers/decomposition-fixture.ts';

test('v2 authenticates original, mapping and all files; unknown observations stay unknown',async()=>{
  const f=await assetsPackageFixture(),value=await importDecompositionZip(f.bytes);
  assert.equal(value.assetsPackage?.manifestSha256,await referenceSha256(f.entries.get('manifest.json')!));
  assert.deepEqual(value.assetsPackage?.manifest.assets[0].bakedContent,null);
  assert.notDeepEqual(value.assetsPackage?.original.bytes,value.preview.bytes);
  const report=await intakeAssets(f.bytes);assert.equal(report.referenceAcceptance,'blocked');assert.equal(report.semantics,'not_planned');
  value.assetsPackage!.original.bytes[0]^=1;await assert.rejects(()=>assertValidImportedDecomposition(value),/IMPORTED_ORIGINAL_TAMPERED/);
});

for(const change of ['kind','version','unknown','size','digest','mapping','layer','rect','relation','state','image-type','self-inventory','original-size','lineage'])test(`v2 rejects ${change} drift`,async()=>{
  const f=await assetsPackageFixture(),m=f.manifest;
  if(change==='kind')m.kind='other';if(change==='version')m.schemaVersion='3.0';if(change==='unknown')m.extra=true;
  if(change==='size')m.files[0].bytes++;if(change==='digest')m.files[0].sha256='0'.repeat(64);
  if(change==='mapping')m.reference.mapping.crop=[0,0,501,400];if(change==='layer')m.assets[1].layerId=m.assets[0].layerId;
  if(change==='rect')m.assets[0].visibleBounds=[1,0,499,400];if(change==='relation')m.assets[0].relation.action='context';
  if(change==='state')m.stateRelations=[{layerIds:['missing'],label:'active',evidence:'fixture'}];
  if(change==='image-type')m.files.find((r:any)=>r.path==='reference/original.png').mediaType='image/jpeg';
  if(change==='self-inventory')m.files[0].path='manifest.json';if(change==='original-size')m.files.find((r:any)=>r.path==='reference/original.png').width++;
  if(change==='lineage')m.lineage=[{relation:'unknown',zipSha256:'0'.repeat(64),manifestSha256:'0'.repeat(64)}];
  await assert.rejects(()=>importDecompositionZip(f.rebuild()));
});

test('v2 rejects undeclared, merely declared extras, duplicate members/JSON keys and traversal',async()=>{
  const f=await assetsPackageFixture();f.entries.set('extra.json',new TextEncoder().encode('{}'));
  await assert.rejects(()=>importDecompositionZip(zip(f.entries)),/INVENTORY/);
  f.manifest.files.push({path:'extra.json',sha256:await referenceSha256(f.entries.get('extra.json')!),bytes:2,mediaType:'application/json'});
  await assert.rejects(()=>importDecompositionZip(f.rebuild()),/INVENTORY/);
  const entries=[...f.entries].map(([name,bytes])=>({name,bytes}));
  await assert.rejects(()=>importDecompositionZip(forceZip64Stored([...entries,entries[0]])),/DUPLICATE/);
  f.entries.delete('extra.json');f.entries.set('../escape.json',new Uint8Array([1]));await assert.rejects(()=>importDecompositionZip(zip(f.entries)),/PATH/);
  f.entries.delete('../escape.json');f.entries.set('manifest.json',new TextEncoder().encode('{"kind":1,"kind":2}'));
  await assert.rejects(()=>importDecompositionZip(zip(f.entries)),/DUPLICATE_JSON_KEY/);
});

test('supplemental intake retains base/context but refuses standalone build',async()=>{
  const f=await assetsPackageFixture();f.manifest.scope={type:'supplemental',description:'Explicit supplementary material',base:{zipSha256:'1'.repeat(64),manifestSha256:'2'.repeat(64)}};
  for(const row of f.manifest.assets)row.relation.action='context';const bytes=f.rebuild();
  assert.ok((await intakeAssets(bytes)).diagnostics.some(d=>d.code==='ASSETS_SUPPLEMENT_REQUIRES_MERGE'));
  const archiveSha256=await referenceSha256(bytes);
  await assert.rejects(()=>compileDecompositionAssets(bytes,f.target,{...f.binding,archiveSha256}),/ASSETS_SUPPLEMENT_REQUIRES_MERGE/);
});

test('v2 build saves original source and reopens runtime with CLI-compatible handoff unchanged',async()=>{
  const f=await assetsPackageFixture(),built=await compileDecompositionAssets(f.bytes,f.target,f.binding);
  assert.equal(built.bundle.bundleVersion,'0.3');const saved:any=structuredClone(built.bundle);saved.document.root.children[1].props.checked=true;
  const valid=await validateBundle(saved),out=await exportReferenceHandoff(valid),entries=await componentHandoffEntries(out);
  assert.deepEqual(entries.get('decomposition/assets.zip'),f.bytes);
  const reopened=await importComponentHandoffWithReview(out);assert.deepEqual(reopened.bundle.document,valid.document);
  assert.equal(reopened.referenceEvidence.status,'missing_reference_evidence');assert.equal(reopened.referenceEvidence.visualComparisonReady,false);
  assert.deepEqual((await componentHandoffEntries(await exportReferenceHandoff(reopened.bundle))).get('decomposition/assets.zip'),f.bytes);
});

test('single-package planning reports missing input, validates explicit bundle/binding and never calls model',async()=>{
  const f=await assetsPackageFixture(),request={kind:'ui-assets-planning-input',schemaVersion:'1.0',archiveSha256:await referenceSha256(f.bytes),requirements:'',basis:'programmatic-fixture',openQuestions:[]};
  const empty=await planAssets(f.bytes,request);assert.equal(empty.status,'needs_input');assert.equal(empty.modelRecognition,'not_run');assert.equal(empty.bundle,undefined);
  assert.ok(empty.diagnostics.some(d=>d.code==='USER_REQUIREMENTS_REQUIRED'));
  const ready=await planAssets(f.bytes,{...request,requirements:'Demonstrate the fixture button, sound switch and explicit quality choices.',target:f.target,binding:f.binding});
  assert.equal(ready.status,'build_ready');assert.ok(ready.bundle?.componentHandoff);assert.equal(ready.businessAcceptance,'not_run');assert.equal(ready.referenceAcceptance,'blocked');
  const blocked=await planAssets(f.bytes,{...request,requirements:'Fixture',openQuestions:['Which action should Apply invoke?'],target:f.target,binding:f.binding});assert.equal(blocked.bundle,undefined);
  await assert.rejects(()=>planAssets(f.bytes,{...request,archiveSha256:'0'.repeat(64)}),/ASSETS_PLANNING_INPUT/);
});

test('planning reuses source-bound semantic compiler; incomplete visible props remain unresolved',async()=>{
  const f=await assetsPackageFixture(),file=f.manifest.files.find((row:any)=>row.path==='reference/original.png');
  const request={kind:'ui-assets-planning-input',schemaVersion:'1.0',archiveSha256:await referenceSha256(f.bytes),requirements:'Show a static label, no business behavior.',basis:'programmatic-fixture',openQuestions:[],
    observation:{version:'0.2',sourceSha256:file.sha256,status:'Observed',summary:'Synthetic observation',components:[{id:'title',parentId:null,componentType:'Text',bounds:{x:10,y:10,width:100,height:30},evidence:'Explicit fixture label',visibleProps:{text:'Fixture'}}]}};
  const report=await planAssets(f.bytes,request);assert.equal(report.semantics,'validated');assert.equal(report.binding,'unresolved');assert.ok(report.target);
  delete (request.observation.components[0].visibleProps as any).text;const missing=await planAssets(f.bytes,request);assert.ok(missing.diagnostics.some(d=>d.code==='MISSING_SEMANTIC_FIELD'));
});
