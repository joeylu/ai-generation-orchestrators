import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {core,fixture,catalog,copy} from './helpers.mjs';
import {readJson} from '../src/io.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {createPanelDelivery,createPanelIntegrationContract} from '../src/panel-delivery.mjs';
import {createUnityKitFiles} from '../src/unity-kit.mjs';
import {readUnityAdapterSources} from '../src/unity-export-io.mjs';
import {digestBytes,canonicalJson} from '../src/canonical.mjs';
import {createStoredZip} from '../src/zip-store.mjs';
import {readStoredZip} from './unity-kit-helpers.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {formRequest,formIntent} from '../examples/forms-v1/fixture.mjs';
import {progressRequest,progressIntent} from '../examples/progress-v1/fixture.mjs';
const sources=await readUnityAdapterSources(),utf8=text=>new TextEncoder().encode(text),decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const runtime={version:'0.1.0',code:'/* Explicit byte fixture, not a runnable browser adapter. */',notices:'Fixture'};
runtime.sha256=await digestBytes(utf8(runtime.code));
const bundle=await createPanelBundle(fixture,catalog,core);
const delivery=async(input=bundle,adapter=runtime,kit)=>createPanelDelivery(input,core,{runtime:adapter,unityKit:kit??await createUnityKitFiles(input,core,sources)});

test('standalone preview reserves its scrollbar gutter to prevent iframe resize feedback',async()=>{
 const out=await delivery(),html=new TextDecoder().decode(out.contents.get('pixi/index.html'));
 assert(html.includes('html{scrollbar-gutter:stable}'));
 assert(html.includes('@supports not (scrollbar-gutter:stable){html{overflow-y:scroll}}'));
 assert.deepEqual(decode(out.contents.get('pixi/panel.bundle.json')),bundle);
});

test('complete delivery retains played values separately from authored defaults and Unity document',async()=>{
 const boolean=fixture.state.find(field=>field.type==='boolean').id;
 const state={...bundle.state,volume:37,[boolean]:!bundle.state[boolean]};
 const played=await createPanelBundle(fixture,catalog,core,state),before=copy(played),out=await delivery(played);
 assert.deepEqual(decode(out.contents.get('pixi/panel.bundle.json')),played);
 assert.deepEqual(decode(out.contents.get('unity/panel.bundle.json')),played);
 const contract=decode(out.contents.get('integration-contract.json'));
 assert.equal(contract.fields.find(item=>item.id==='volume').current,37);
 assert.equal(contract.fields.find(item=>item.id==='volume').initial,fixture.state.find(item=>item.id==='volume').initial);
 assert.equal(contract.panelSha256,played.sha256);assert.deepEqual(played,before);
 assert.equal(out.manifest.verification.unityImport,'NOT_RUN');assert.equal(out.manifest.verification.businessBinding,'NOT_CONNECTED');
 assert.deepEqual(decode(out.contents.get('game-binding.template.json')).commands,[]);
 assert.equal([...out.contents.keys()].some(path=>path.includes('GameRuntime')),false);
});

test('every ZIP byte matches its manifest and repeated exports are identical',async()=>{
 const out=await delivery(),parsed=readStoredZip(createStoredZip(out.contents));
 assert.equal(parsed.size,out.manifest.files.length+1);
 for(const file of out.manifest.files){assert.equal(parsed.get(file.path).length,file.bytes);assert.equal(await digestBytes(parsed.get(file.path)),file.sha256);}
 assert.deepEqual(createStoredZip(out.contents),createStoredZip((await delivery()).contents));
 assert.deepEqual(createStoredZip(out.contents),createStoredZip((await delivery(JSON.parse(canonicalJson(bundle)))).contents));
});

test('form contract preserves input constraints and exact submit scopes',async()=>{
 const formCatalog=await readJson(new URL('../examples/modern-mint-forms.catalog.json',import.meta.url));
 const context=await createPlanningContext(formRequest,formCatalog),proposal=await materializePanelIntent(context,formIntent(context));
 const form=await createPanelBundle(proposal.spec,formCatalog,core),out=await delivery(form),contract=decode(out.contents.get('integration-contract.json'));
 assert.equal(contract.fields[0].maxLength,12);assert.equal(contract.controls[0].input.validation.required,true);
 assert.equal(contract.controls[0].input.validation.minLength,2);assert.deepEqual(contract.controls[1].action.fields,['row0']);
 assert.equal(contract.controls[1].action.kind,'submit');
});

test('selected PNG bytes remain identical in the offline Pixi and native import folders',async()=>{
 const bytes=new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png',import.meta.url))),sha256=await digestBytes(bytes);
 const spec=copy(fixture);spec.panelSpecVersion='0.2';spec.assets={library:{id:'fixture-assets',sha256:'a'.repeat(64)},panelSurface:'fixture/panel@1.0.0',rowIcons:[]};
 const closure={assetClosureVersion:'0.1',library:copy(spec.assets.library),records:[{key:'fixture/panel@1.0.0',role:'shape',width:64,height:64,slice:{left:12,right:12,top:12,bottom:12},sha256,bytes:bytes.length}]};
 const input=await createPanelBundle(spec,catalog,core,undefined,{closure,resources:[{path:'textures/'+sha256+'.png',mime:'image/png',bytes}]}),out=await delivery(input);
 for(const target of ['pixi','unity'])assert.deepEqual(out.contents.get(target+'/textures/'+sha256+'.png'),bytes);
 assert.equal(out.manifest.verification.assetClosure,'PASS');
});

test('read-only progress and text metadata export without inventing enabled flags',async()=>{
 const progressCatalog=await readJson(new URL('../examples/modern-mint-progress.catalog.json',import.meta.url));
 const context=await createPlanningContext(progressRequest,progressCatalog),proposal=await materializePanelIntent(context,progressIntent(context));
 const loading=await createPanelBundle(proposal.spec,progressCatalog,core),out=await delivery(loading),contract=decode(out.contents.get('integration-contract.json'));
 const progress=contract.fields.filter(field=>field.type==='progress');assert(progress.length>0);assert(progress.every(field=>field.direction==='from-game'));
 assert.equal(Object.hasOwn(contract.controls.find(row=>row.kind==='progress'),'enabled'),false);
});

test('runtime tampering and mismatched native source fail before producing an archive',async()=>{
 await assert.rejects(delivery(bundle,{...runtime,code:runtime.code+'modified'}),/DELIVERY_RUNTIME_INTEGRITY/);
 const other=copy(fixture);other.id='different-panel';const wrong=await createUnityKitFiles(await createPanelBundle(other,catalog,core),core,sources);
 await assert.rejects(delivery(bundle,runtime,wrong),/DELIVERY_UNITY_SOURCE/);
 const corrupted=await createUnityKitFiles(bundle,core,sources);corrupted.contents.set('Assets/PanelHarness/Runtime/PanelController.cs',utf8('changed'));
 await assert.rejects(delivery(bundle,runtime,corrupted),/DELIVERY_UNITY_INTEGRITY/);
});

test('portable panel filenames reject Windows devices without altering valid source inputs',async()=>{
 for(const id of ['NUL','COM1','LPT9','AUX']){
  const spec=copy(fixture);spec.id=id;const source=await createPanelBundle(spec,catalog,core);
  await assert.rejects(createPanelDelivery(source,core,{runtime,unityKit:{}}),/DELIVERY_PANEL_ID/);
 }
});

test('untrusted display text cannot escape the standalone inert JSON script',async()=>{
 const spec=copy(fixture);spec.title='</script><script>bad()</script>';
 const input=await createPanelBundle(spec,catalog,core),out=await delivery(input),html=new TextDecoder().decode(out.contents.get('pixi/index.html'));
 assert(!html.includes(spec.title));assert(html.includes('\\u003c/script>'));assert(html.includes('textContent=bundle.spec.title'));
 assert.equal((await createPanelIntegrationContract(input,core)).panelSha256,input.sha256);
});
