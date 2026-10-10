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
assert.equal(sdk.seed.catalog.id, 'modern-menu-headings');
assert.equal(sdk.seed.catalog.version, '0.20.0');
assert.equal(files.has('package/src/component-adapter.mjs'), false);
assert(![...files.keys()].some(name => /(?:node_modules|\.ts$|workbench-server|\.tmp\/|output\/)/.test(name)));
pass('loads-outside-checkout-with-no-sibling-node-modules-or-typescript-and-twelve-pinned-icons');
const calls = [], executable = join(temporary, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
await writeFile(executable, 'Non-executable placeholder: fixtureProcess owns every child.');
const options = reply => ({ executable, outputRoot: join(temporary, 'writable-runs'), runProcess: fixtureProcess(reply, calls) });
const model = await sdk.createWorkbenchModel(sdk.seed, sdk.core);
const prepared = await model.prepare(menuRequest);
const planned = await sdk.planner.planWithCodex(prepared.context, options(menuIntent(prepared.context)));
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
checks.push(...await checkInstalledHeadings(sdk,output));
checks.push(...await checkInstalledGeometry(sdk,output));
const selectModel=await sdk.createWorkbenchModel(sdk.seed,sdk.core),selectPrepared=await selectModel.prepare(selectRequest);
const selectPlan=await sdk.planner.planWithCodex(selectPrepared.context,options(selectIntent(selectPrepared.context)));
assert.equal(selectPlan.receipt.invocationCount,1);assert.equal(selectPlan.receipt.automaticRetries,0);
const selected=await selectModel.acceptProposal(selectPlan.proposal),field=selected.panel.spec.state.find(value=>value.type==='enum');
assert.equal(selected.phase,'ready');assert.equal(selected.panel.compilerVersion,'0.28.0');
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
await writeFile(join(temporary, 'package/prompts/panel-intent.md'), 'tampered');
assert.throws(() => sdk.planner.planWithCodex(prepared.context, { outputRoot: 'relative' }), /SDK_OUTPUT_ROOT_REQUIRED/);
await assert.rejects((await import(pathToFileURL(join(temporary, 'package/src/sdk.mjs')).href)).verifyPanelSdk(), /SDK_FILE_INTEGRITY/);
pass('tampered-installed-inputs-and-implicit-output-roots-are-rejected');
model.dispose();
const report = { status: 'PASS', archive: { bytes: archive.length, sha256: await digestBytes(archive) }, checks,
  fixtureInvocations: calls, realModelCalls: 0, browser: 'NOT_RUN', unityNative: 'NOT_RUN', source: sdk.manifest.source };
await writeNewJson(output, 'installed-package-report.json', report);
console.log(JSON.stringify({ status: 'PASS', checks: checks.length, fixtureInvocations: calls.length, realModelCalls: 0 }));
