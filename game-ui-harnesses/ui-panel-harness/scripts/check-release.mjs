#!/usr/bin/env node
/** Installed-artifact acceptance. Every CLI child is a test double; real model calls = zero. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';
import { menuRequest, menuIntent } from '../examples/menu-defaults-v1/fixture.mjs';
import { checkInstalledHeadings } from './lib/heading-release-check.mjs';
import { checkInstalledGeometry } from './lib/geometry-release-check.mjs';
import { selectRequest, selectIntent } from '../examples/section-geometry-v2/fixture.mjs';
import {imageRequest,imageIntent,conciseRoleSpec} from '../examples/image-slots-v1/fixture.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {checkInstalledComponents} from './lib/all-components-release-check.mjs';
import {checkInstalledCompactMessages} from './lib/compact-message-release-check.mjs';

function fixtureProcess(reply, calls) {
  return (command, args, options) => {
    assert(args.includes('gpt-6-luna')); assert(args.includes('model_reasoning_effort="xhigh"'));
    calls.push({ operation: reply.codexEditDraftVersion ? 'edit' : 'generate', model: 'gpt-6-luna', effort: 'xhigh' });
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
    child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); }, final(callback) {
      callback(); queueMicrotask(() => {
        const events = [{ type: 'thread.started', thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { type: 'turn.started' },
          { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(reply) } },
          { type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } }];
        child.stdout.write(events.map(event => JSON.stringify(event)).join('\n') + '\n'); child.emit('close', 0);
      });
    } });
    return child;
  };
}

const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === '--package' && args[2] === '--output', 'RELEASE_CHECK_ARGUMENTS');
const output = await createOutputDirectory(args[3]), archive = await readFile(resolve(args[1]));
const files = readStoredZip(archive), temporary = await mkdtemp(join(tmpdir(), 'panel-installed-sdk-'));
const checks = [], pass = name => checks.push({ name, status: 'PASS' });
for (const [name, bytes] of files) {
  assert(/^package\/[A-Za-z0-9_.@/-]+$/.test(name) && name.split('/').every(part => part && !['.', '..'].includes(part)), 'RELEASE_CHECK_PATH');
  const target = resolve(temporary, name);
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
}
const sdk = await (await import(pathToFileURL(join(temporary, 'package/src/sdk.mjs')).href)).loadPanelSdk();
assert.equal(sdk.seed.pool.index.records.length, 12); assert.equal(sdk.seed.pool.resources.length, 12);
const cardLayout=sdk.seed.catalog.id==='modern-readable-game-card-layout',itemGroups=cardLayout||sdk.seed.catalog.id==='modern-readable-game-item-groups',dataPanels=itemGroups||sdk.seed.catalog.id==='modern-readable-game-data-panels',readableData=dataPanels||sdk.seed.catalog.id==='modern-readable-game-data-layout',groupedReadable=readableData||sdk.seed.catalog.id==='modern-readable-game-grouped-layout',sectionPanels=groupedReadable||sdk.seed.catalog.id==='modern-readable-game-section-panels',headingPanels=sectionPanels||sdk.seed.catalog.id==='modern-readable-game-heading-panels',readableLayout=headingPanels||sdk.seed.catalog.id==='modern-readable-game-layout',contentHeadings=readableLayout||sdk.seed.catalog.id==='modern-readable-game-headings',readable=contentHeadings||sdk.seed.catalog.id==='modern-readable-game',compact=readable||sdk.seed.catalog.id==='modern-compact-message',full=compact||sdk.seed.catalog.id==='modern-all-components',centered=full||sdk.seed.catalog.id==='modern-centered-cards',images=centered||sdk.seed.catalog.id==='modern-image-slots';
assert.equal(sdk.seed.catalog.id, cardLayout?'modern-readable-game-card-layout':itemGroups?'modern-readable-game-item-groups':dataPanels?'modern-readable-game-data-panels':readableData?'modern-readable-game-data-layout':groupedReadable?'modern-readable-game-grouped-layout':sectionPanels?'modern-readable-game-section-panels':headingPanels?'modern-readable-game-heading-panels':readableLayout?'modern-readable-game-layout':contentHeadings?'modern-readable-game-headings':readable?'modern-readable-game':compact?'modern-compact-message':full?'modern-all-components':centered?'modern-centered-cards':images?'modern-image-slots':'modern-menu-headings');
assert.equal(sdk.seed.catalog.version, images?'0.1.0':'0.20.0');
assert.equal(files.has('package/src/component-adapter.mjs'), false);
assert(![...files.keys()].some(name => /(?:node_modules|\.ts$|workbench-server|\.tmp\/|output\/)/.test(name)));
pass('loads-outside-checkout-with-no-sibling-node-modules-or-typescript-and-twelve-pinned-icons');
const calls = [], executable = join(temporary, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
await writeFile(executable, 'Non-executable placeholder: fixtureProcess owns every child.');
const options = reply => ({ executable, outputRoot: join(temporary, 'writable-runs'), runProcess: fixtureProcess(reply, calls) });
const model = await sdk.createWorkbenchModel(sdk.seed, sdk.core);
const prepared = await model.prepare(menuRequest);
// These are authored fixtures. Their transport version follows the tested SDK.
const nativeFixture=(context,fixture)=>({...fixture,panelIntentVersion:context.planningContextVersion==='0.11'?'0.12':context.planningContextVersion==='0.10'?'0.11':fixture.panelIntentVersion});
const planned = await sdk.planner.planWithCodex(prepared.context, options(nativeFixture(prepared.context,menuIntent(prepared.context))));
assert.equal(planned.receipt.invocationCount, 1); assert.equal(planned.receipt.automaticRetries, 0);
let current = await model.acceptProposal(planned.proposal);
assert.equal(current.phase, 'ready');
pass('installed-generation-transport-and-compiler-accept-one-authored-fixture');
const row = current.panel.spec.sections.flatMap(section => section.rows).find(row => row.buttonLabel === '继续游戏');
assert(row);
const request = { requestVersion: '0.1', id: 'installed-edit', target: 'pixi', text: '只把“继续游戏”按钮的文字改为“继续”，其他不变。' };
const editing = await model.prepareEdit(request, { rowId: row.id });
const draft = { codexEditDraftVersion: '0.3', contextSha256: editing.context.sha256, unresolved: [], noChange: null,
  patch: { patchVersion: '0.1', baseSpecSha256: editing.context.baseSpecSha256, reason: request.text,
    operations: [{ op: 'set-button-label', rowId: row.id, buttonLabel: '继续' }] },
  bases: [{ kind: 'request-interpretation', quote: request.text }] };
const edited = await sdk.planner.editWithCodex(editing.context, options(draft));
current = await model.acceptEditProposal(edited.proposal);
assert.equal(current.panel.spec.sections.flatMap(section => section.rows).find(value => value.id === row.id).buttonLabel, '继续');
assert.deepEqual(model.getEditBudget(), { limit: 10, used: 1, remaining: 9 });
assert.equal(calls.length, 2);
assert.equal((await readdir(join(temporary, 'writable-runs'))).length, 2);
pass('installed-edit-preserves-identities-and-writes-receipts-outside-sdk-with-one-fixture-invocation');
const bundle = await sdk.panel.validatePanelBundle(current.panel, sdk.core);
const kit = await sdk.delivery.createUnityKitFiles(bundle, sdk.core, sdk.delivery.sources);
assert.equal(kit.manifest.verification.unityImport, 'NOT_RUN');
const delivered = await sdk.delivery.createPanelDelivery(bundle, sdk.core, { runtime: sdk.delivery.runtime, unityKit: kit });
const zip = sdk.delivery.createStoredZip(delivered.contents), reread = readStoredZip(zip);
assert.equal(reread.size, delivered.contents.size);
for (const file of delivered.manifest.files) assert.equal(await digestBytes(reread.get(file.path)), file.sha256);
await writeFile(resolve(output, 'panel-delivery.zip'), zip, { flag: 'wx' });
await writeFile(resolve(output, 'ugui-import-kit.zip'), sdk.delivery.createStoredZip(kit.contents), { flag: 'wx' });
for (const [name, bytes] of reread) if (name.startsWith('pixi/')) {
  const target = resolve(output, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
}
await writeFile(resolve(output, 'browser-runtime.js'), files.get('package/dist-browser/index.js'), { flag: 'wx' });
pass('actual-web-and-ugui-zips-reopen-with-every-file-hash-and-native-verification-not-run');
await sdk.panel.validatePanelBundle(JSON.parse(new TextDecoder().decode(reread.get('pixi/panel.bundle.json'))), sdk.core);
pass('downloaded-bundle-reimports-without-a-separate-asset-library');
await (await import(pathToFileURL(join(temporary, 'package/src/sdk.mjs')).href)).verifyPanelSdk();
pass('generation-edit-and-export-leave-installed-package-bytes-intact');
const legacyCatalog=JSON.parse(Buffer.from(files.get('package/examples/modern-all-components.catalog.json')));
const legacySdk=compact?{...sdk,seed:{...sdk.seed,catalog:legacyCatalog}}:sdk;
checks.push(...await checkInstalledHeadings(legacySdk,output));
checks.push(...await checkInstalledGeometry(legacySdk,output));
const selectModel=await sdk.createWorkbenchModel(sdk.seed,sdk.core),selectPrepared=await selectModel.prepare(selectRequest);
const selectPlan=await sdk.planner.planWithCodex(selectPrepared.context,options(nativeFixture(selectPrepared.context,selectIntent(selectPrepared.context))));
assert.equal(selectPlan.receipt.invocationCount,1);assert.equal(selectPlan.receipt.automaticRetries,0);
const selected=await selectModel.acceptProposal(selectPlan.proposal),field=selected.panel.spec.state.find(value=>value.type==='enum');
assert.equal(selected.phase,'ready');assert.equal(selected.panel.compilerVersion,itemGroups?'0.45.0':dataPanels?'0.44.0':readableData?'0.43.0':groupedReadable?'0.42.0':sectionPanels?'0.41.0':headingPanels?'0.40.0':readableLayout?'0.39.0':contentHeadings?'0.38.0':readable?'0.37.0':compact?'0.34.0':full?'0.32.0':centered?'0.30.0':images?'0.29.0':'0.28.0');
assert.deepEqual(field.options.map(option=>option.label),['男','女']);assert.equal(selected.panel.state[field.id],field.options[0].id);
pass('installed-reported-select-request-compiles-after-one-explicit-generation-fixture');
const selectEditRequest={requestVersion:'0.1',id:'select-title-edit',target:'pixi',text:'只把面板标题改为“选择角色”，其他不变。'};
const selectEditing=await selectModel.prepareEdit(selectEditRequest);
const selectDraft={codexEditDraftVersion:'0.3',contextSha256:selectEditing.context.sha256,unresolved:[],noChange:null,
  patch:{patchVersion:'0.1',baseSpecSha256:selectEditing.context.baseSpecSha256,reason:selectEditRequest.text,operations:[{op:'set-panel-title',title:'选择角色'}]},
  bases:[{kind:'request-interpretation',quote:selectEditRequest.text}]};
const selectEdited=await sdk.planner.editWithCodex(selectEditing.context,options(selectDraft));
const selectCurrent=await selectModel.acceptEditProposal(selectEdited.proposal,{[field.id]:field.options[1].id});
assert.deepEqual(selectCurrent.panel.spec.sections,selected.panel.spec.sections);assert.deepEqual(selectCurrent.panel.spec.state,selected.panel.spec.state);
assert.deepEqual(selectCurrent.panel.bindings,selected.panel.bindings);assert.deepEqual(selectCurrent.panel.state,{[field.id]:field.options[1].id});
assert.equal(selectModel.getEditBudget().used,1);assert.equal(calls.length,4);selectModel.dispose();
pass('installed-explicit-edit-fixture-preserves-select-default-options-bindings-and-female-play-state');
if(images){
  const pool=await imageAssetPool(),imageModel=await sdk.createWorkbenchModel({catalog:sdk.seed.catalog,pool},sdk.core);
  const imagePrepared=await imageModel.prepare(imageRequest);
  const installedImageIntent=imageIntent(imagePrepared.context,{source:pool.index.records.map(record=>record.key)});
  // This authored fixture exercises a later +20px portrait edit inside a fixed frame.
  // Budget the new two-sided group padding explicitly; production geometry stays binding.
  if(sectionPanels){installedImageIntent.panel.layout.maxHeight+=24;installedImageIntent.panel.layout.canvasHeight+=24;}
  const imagePlanned=await sdk.planner.planWithCodex(imagePrepared.context,options(nativeFixture(imagePrepared.context,installedImageIntent)));
  const imageReady=await imageModel.acceptProposal(imagePlanned.proposal),before=imageReady.panel;
  assert.equal(before.compilerVersion,itemGroups?'0.45.0':dataPanels?'0.44.0':readableData?'0.43.0':groupedReadable?'0.42.0':sectionPanels?'0.41.0':headingPanels?'0.40.0':readableLayout?'0.39.0':contentHeadings?'0.38.0':readable?'0.37.0':compact?'0.34.0':full?'0.32.0':centered?'0.30.0':'0.29.0');assert.equal(before.assetClosure.records.length,3);
  const editRequest={...imageRequest,text:'把战士肖像高度改成200，其他不变。'},editing=(await imageModel.prepareEdit(editRequest,{rowId:'row0'})).context;
  const imageDraft={codexEditDraftVersion:'0.3',contextSha256:editing.sha256,unresolved:[],noChange:null,
    patch:{patchVersion:'0.1',baseSpecSha256:editing.baseSpecSha256,reason:editRequest.text,operations:[{op:'set-image-properties',rowId:'row0',source:before.spec.sections[0].rows[0].source,width:'fill',height:200,fit:'contain',assetLibrary:null}]},bases:[{kind:'request-interpretation',quote:editRequest.text}]};
  const imageEdited=await sdk.planner.editWithCodex(editing,options(imageDraft));await imageModel.acceptEditProposal(imageEdited.proposal);
  const result=imageModel.getSnapshot().panel;assert.deepEqual(result.assetClosure,before.assetClosure);assert.deepEqual(result.state,before.state);assert.deepEqual(result.actions,before.actions);
  const imported=await sdk.createWorkbenchModel({catalog:sdk.seed.catalog,pool:null},sdk.core);await imported.importPanel(JSON.parse(JSON.stringify(result)));
  const imageKit=await sdk.delivery.createUnityKitFiles(result,sdk.core,sdk.delivery.sources),imageDelivery=await sdk.delivery.createPanelDelivery(result,sdk.core,{runtime:sdk.delivery.runtime,unityKit:imageKit});
  const imageZip=sdk.delivery.createStoredZip(imageDelivery.contents),imageFiles=readStoredZip(imageZip);
  for(const file of imageDelivery.manifest.files){assert.equal(imageFiles.get(file.path).length,file.bytes);assert.equal(await digestBytes(imageFiles.get(file.path)),file.sha256);}
  await writeFile(resolve(output,'image-panel-delivery.zip'),imageZip,{flag:'wx'});
  const imageArtifacts=[];
  async function saveImageArtifact(id,bundle,zip,files,expectedCenters){
    const native=await sdk.panel.createUnityDocument(bundle,sdk.core);
    if(['0.32.0','0.34.0','0.36.0','0.37.0','0.38.0','0.39.0','0.40.0','0.41.0','0.42.0','0.43.0','0.44.0','0.45.0'].includes(bundle.compilerVersion)){
      assert.equal(native.nodes.find(node=>node.id===`${bundle.spec.id}.title`).textAlignment,'MiddleCenter');
      expectedCenters++;
    }
    assert.equal(native.adapterVersion,sdk.manifest.runtime.ugui);
    assert.equal(native.nodes.filter(node=>node.textAlignment==='MiddleCenter').length,expectedCenters);
    const pixiDirectory=id+'-pixi';
    for(const [name,bytes]of files)if(name.startsWith('pixi/')){const target=resolve(output,pixiDirectory,name.slice(5));await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
    imageArtifacts.push({id,pixiDirectory,bundleSha256:bundle.sha256,compilerVersion:bundle.compilerVersion,centeredNativeNodes:expectedCenters,zipBytes:zip.length,zipSha256:await digestBytes(zip)});
  }
  await saveImageArtifact('bound',result,imageZip,imageFiles,centered?3:0);
  for(const mode of ['light','dark']){
    const placeholder=await sdk.panel.createPanelBundle(conciseRoleSpec(sdk.panel,legacySdk.seed.catalog,{mode}),legacySdk.seed.catalog,sdk.core);
    const kit=await sdk.delivery.createUnityKitFiles(placeholder,sdk.core,sdk.delivery.sources);
    const delivery=await sdk.delivery.createPanelDelivery(placeholder,sdk.core,{runtime:sdk.delivery.runtime,unityKit:kit});
    const zip=sdk.delivery.createStoredZip(delivery.contents),files=readStoredZip(zip);
    for(const file of delivery.manifest.files){assert.equal(files.get(file.path).length,file.bytes);assert.equal(await digestBytes(files.get(file.path)),file.sha256);}
    await writeFile(resolve(output,`placeholder-${mode}-panel-delivery.zip`),zip,{flag:'wx'});
    await saveImageArtifact('placeholder-'+mode,placeholder,zip,files,centered?6:0);
  }
  await writeNewJson(output,'image-report.json',{status:'PASS',artifacts:imageArtifacts,realModelCalls:0,unityNative:'NOT_RUN'});
  assert.equal(imageKit.manifest.verification.unityImport,'NOT_RUN');assert.equal(calls.length,6);imageModel.dispose();imported.dispose();
  pass('installed-image-generation-edit-poolless-import-and-web-ugui-export-use-only-two-fixture-invocations');
}
await (await import(pathToFileURL(join(temporary, 'package/src/sdk.mjs')).href)).verifyPanelSdk();
if(full)checks.push(...await checkInstalledComponents(sdk,output,options));
if(compact)checks.push(...await checkInstalledCompactMessages(sdk,output));
await writeFile(join(temporary, 'package/prompts/panel-intent.md'), 'tampered');
assert.throws(() => sdk.planner.planWithCodex(prepared.context, { outputRoot: 'relative' }), /SDK_OUTPUT_ROOT_REQUIRED/);
await assert.rejects((await import(pathToFileURL(join(temporary, 'package/src/sdk.mjs')).href)).verifyPanelSdk(), /SDK_FILE_INTEGRITY/);
pass('tampered-installed-inputs-and-implicit-output-roots-are-rejected');
model.dispose();
const report = { status: 'PASS', archive: { bytes: archive.length, sha256: await digestBytes(archive) }, checks,
  fixtureInvocations: calls, realModelCalls: 0, browser: 'NOT_RUN', unityNative: 'NOT_RUN', source: sdk.manifest.source };
await writeNewJson(output, 'installed-package-report.json', report);
console.log(JSON.stringify({ status: 'PASS', checks: checks.length, fixtureInvocations: calls.length, realModelCalls: 0 }));
