// Real-output replay or explicitly marked driver fixtures; never starts a model process.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { validateCodexEditReceipt } from '../src/codex-planner.mjs';
import { controlId, initialPanelState } from '../src/compiler.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { checkChainEdit as checkStressEdit, findStressRow, chainFixturePatch as stressFixturePatch, stressFixtureProposal } from './edit-chain-contract.mjs';
import { EDIT_CHAIN_STEPS } from '../examples/edit-chain-v1/suite.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';
import { pathToFileURL } from 'node:url';

const opts = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) { assert(['--prepared', '--run', '--output', '--mode'].includes(args[i]) && args[i + 1] && !opts[args[i]]); opts[args[i]] = args[i + 1]; }
assert(opts['--prepared'] && opts['--output']); const fixture = opts['--mode'] === 'fixture'; assert(fixture || opts['--mode'] === 'real' && opts['--run']);
const plan = await readJson(join(opts['--prepared'], fixture ? 'edit-chain-driver.json' : 'edit-chain-plan.json')), { sha256, ...payload } = plan;
assert.equal(await digestJson(payload), sha256);
const output = await createOutputDirectory(opts['--output']), core = await loadWorkspaceCore();
const trialFile = join(opts['--prepared'], plan.edit.trialFile), trial = await validatePanelBundle(await readJson(trialFile), core);
const buildDirectory = resolve(plan.build.file, '..'), build = await readJson(plan.build.file);
assert.equal(await digestJson(build), plan.build.sha256);
for (const file of build.files) assert.equal(await digestBytes(await readFile(join(buildDirectory, file.path))), file.sha256);
assert.deepEqual(plan.edit.steps,EDIT_CHAIN_STEPS);
const accepted = new Map(), report = { version: '0.1', evidence: fixture ? 'DRIVER_FIXTURE' : 'SAVED_REAL_MODEL_OUTPUT', status: 'RUNNING',
  planSha256: sha256, modelCalls: 0, automaticRetries: 0, replayCount: 0, cases: [], checks: [], deliveries: [], blockedUnexpectedRequests:0,
  nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN', scope: 'Ten visible dependent edits, separate trial/defaults, disabled/re-enabled mute, per-step and whole-chain undo, actual ZIP/offline/reimport. Only fixture or saved-real replay callbacks; no CLI invocation.' };
if (!fixture) {
  const source = await readJson(join(opts['--run'], 'edit-chain-report.json'));
  assert.equal(source.planSha256, sha256); assert.equal(source.steps.length, 10); report.sourceReportSha256 = await digestJson(source);
  for (const step of plan.edit.steps) {
    const result = source.steps.find(item => item.id === step.id);
    if (result.status !== 'PASS_BEFORE_BROWSER') continue;
    const directory = join(opts['--run'], step.id), names = (await readdir(directory)).filter(name => /^codex-edit-[a-f0-9-]{36}$/.test(name)); assert.equal(names.length, 1);
    const producer = join(directory, names[0]), context = await validatePanelEditContext(await readJson(join(producer, 'edit-context.json')));
    assert.deepEqual(context, await readJson(join(directory, 'dispatch-context.json')));
    const proposal = await readJson(join(producer, 'edit-proposal.json')), checked = await checkPanelEditProposal(context, proposal);
    assert.equal(checked.status, 'READY_TO_APPLY'); assert.deepEqual(checked, await readJson(join(producer, 'edit-planning-report.json')));
    const receipt = validateCodexEditReceipt(await readJson(join(producer, 'codex-edit-receipt.json')), { contextSha256: context.sha256, proposalSha256: checked.proposalSha256 });
    assert.deepEqual(receipt, result.receipt); assert.equal(receipt.invocationCount, 1); assert.equal(receipt.automaticRetries, 0);
    const before = await validatePanelBundle(await readJson(join(directory, 'before.panel.bundle.json')), core);
    const after = await validatePanelBundle(await readJson(join(directory, 'after.panel.bundle.json')), core);
    await checkStressEdit(before.spec, after.spec, step); assert.equal(after.sha256, result.bundleSha256);
    accepted.set(step.id, { context, proposal, report: checked, receipt, before, after });
  }
}
let server, browser, active;
const invoke = async context => {
  assert(active && !active.used); active.used = true; report.replayCount++;
  assert.deepEqual(context.request, active.step.request);
  if (!fixture) { const item = accepted.get(active.step.id); assert.deepEqual(context, item.context); return { proposal: item.proposal, report: item.report, receipt: item.receipt }; }
  const patch = await stressFixturePatch(context.spec, active.step), proposal = stressFixtureProposal(context, patch), checked = await checkPanelEditProposal(context, proposal);
  return { proposal, report: checked, receipt: { codexEditingReceiptVersion: '0.1', model: 'gpt-6-luna', effort: 'xhigh', contextSha256: context.sha256,
    proposalSha256: checked.proposalSha256, status: checked.status, failureCode: null, invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null } };
};
try {
  server = await createWorkbenchServer({ workbench: buildDirectory, outputRoot: resolve(output, 'replay-only'), port: 0,
    editor: invoke, planner: async () => { throw new Error('UNEXPECTED_GENERATION'); } });
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true,serviceWorkers:'block' });
  const origin=new URL(server.url).origin;
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin&&(request.method()==='GET'||request.method()==='POST'&&url.pathname==='/api/panel/edit'))return route.continue();
    if(['blob:','data:'].includes(url.protocol))return route.continue();report.blockedUnexpectedRequests++;return route.abort();
  });
  const errors = [], page = await context.newPage();
  const observe = page => { page.setDefaultTimeout(25000); page.on('pageerror', () => errors.push('PAGE_ERROR')); page.on('console', item => { if (item.type() === 'error') errors.push('CONSOLE_ERROR'); }); };
  observe(page);
  const idle = page => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const snap = page => page.evaluate(() => window.panelWorkbench.snapshot()), state = page => page.evaluate(() => window.panelWorkbench.getState());
  const menu = async page => { if (!await page.locator('#panel-menu').evaluate(node => node.open)) await page.locator('#panel-menu > summary').click(); };
  const upload = async (page, path) => { await menu(page); await page.locator('#panel-file').setInputFiles(resolve(path)); await idle(page); };
  const begin = async page => { await page.goto(server.url); await idle(page); await page.waitForFunction(() => document.getElementById('model-status').textContent.includes('gpt-6-luna')); };
  const focus = async (page, spec, row) => {
    const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded(); await canvas.focus();
    for (let i = 0; i <= spec.sections.flatMap(section => section.rows).length + 6; i++) {
      if (await canvas.getAttribute('data-focused-component') === controlId(spec.id, row.id)) return;
      await page.keyboard.press('Tab');
    } throw new Error('FOCUS_UNREACHABLE');
  };
  const apply = async (page, step) => {
    active = { step, used: false }; await page.locator('#edit-request-text').fill(step.request.text); await page.locator('#generate-edit').click(); await idle(page); assert(active.used);
    for (const id of ['request-error', 'edit-plan-error', 'preview-error']) assert.equal((await page.locator('#' + id).textContent()).trim(), '');
  };
  await begin(page); await upload(page, trialFile); const beforePanels = [], steps = plan.edit.steps;
  for (const step of steps) {
    const result = { id: step.id, status: 'RUNNING', checks: [], failedStage: null, failureCode: null }; report.cases.push(result);
    const pass = name => result.checks.push({ name, status: 'PASS' });
    if (!fixture && !accepted.has(step.id)) { result.status = 'NOT_RUN_DEPENDENCY_FAILED'; break; }
    let stage = 'apply-visible-edit';
    try {
      const before = (await snap(page)).panel, beforeValues = await state(page); beforePanels.push({ spec: before.spec, state: beforeValues });
      if (!fixture) { assert.deepEqual(before.spec, accepted.get(step.id).before.spec); assert.deepEqual(beforeValues, accepted.get(step.id).before.state); }
      await apply(page, step); const after = (await snap(page)).panel, values = await state(page);
      await checkStressEdit(before.spec, after.spec, step);
      if (!fixture) { assert.deepEqual(after.spec, accepted.get(step.id).after.spec); assert.deepEqual(values, accepted.get(step.id).after.state); }
      pass('visible-edit-and-exact-real-result');
      const main = findStressRow(after.spec, step.id === 'edit01' ? '主音量' : '总音量');
      assert.equal(values[main.bind], 83); assert.equal(initialPanelState(after.spec)[main.bind], 50); pass('trial83-default50-separated');
      const nodes = await page.evaluate(() => window.panelWorkbench.inspect().nodes), valueNode = nodes.find(node => node.id === `${after.spec.id}.row.${main.id}.value`);
      assert.equal(valueNode.renderedTextBounds.map(item => item.text).join(''), `${main.format.prefix}${(83).toFixed(main.format.fractionDigits)}${main.format.suffix}`); pass('visible-preview-shows-live83');
      await page.locator('#canvas-host').screenshot({ path: join(output, `${step.id}.png`) });
      stage = 'real-download'; await menu(page); const pending = page.waitForEvent('download'); await page.locator('#download-panel').click();
      const download = await pending; assert.equal(await download.failure(), null); const exportedPath = join(output, `${step.id}.export.bundle.json`); await download.saveAs(exportedPath);
      const exported = await validatePanelBundle(await readJson(exportedPath), core); assert.deepEqual(exported.spec, after.spec); assert.deepEqual(exported.state, values); pass('download-current-live-bundle');
      stage='actual-zip-download-offline';
      const zipWaiting=page.waitForEvent('download');await page.locator('#download-delivery').click();await idle(page);
      const zipDownload=await zipWaiting;assert.equal(await zipDownload.failure(),null);
      const zip=step.id+'.panel-delivery.zip';await zipDownload.saveAs(join(output,zip));
      const zipBytes=await readFile(join(output,zip)),entries=readStoredZip(zipBytes),manifest=JSON.parse(entries.get('delivery-manifest.json'));
      assert.equal(manifest.status,'COMPLETE');assert.equal(entries.size,manifest.files.length+1);assert.equal(manifest.verification.unityImport,'NOT_RUN');
      for(const file of manifest.files){assert.equal(entries.get(file.path).length,file.bytes);assert.equal(await digestBytes(entries.get(file.path)),file.sha256);}
      const delivered=await validatePanelBundle(JSON.parse(entries.get('pixi/panel.bundle.json')),core);
      assert.deepEqual(delivered.spec,after.spec);assert.deepEqual(delivered.state,values);assert.deepEqual(JSON.parse(entries.get('unity/panel.bundle.json')),delivered);
      assert.equal(delivered.sha256,manifest.panelSha256);pass('actual-zip-crc-sha-shared-spec-and-played-state');
      const extracted=await createOutputDirectory(join(output,step.id+'-delivery'));
      for(const [path,bytes]of entries){assert(/^[A-Za-z0-9._/-]+$/.test(path)&&!path.split('/').some(part=>['','.','..'].includes(part)));
        const target=resolve(extracted,path);assert(!relative(extracted,target).startsWith('..'));await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:'wx'});}
      const offline=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});
      try{await offline.setOffline(true);await offline.route('**/*',route=>['file:','blob:','data:'].includes(new URL(route.request().url()).protocol)?route.continue():route.abort());
        const offPage=await offline.newPage();offPage.on('pageerror',()=>errors.push('OFFLINE_PAGE_ERROR'));
        await offPage.goto(pathToFileURL(join(extracted,'pixi/index.html')).href);await offPage.waitForFunction(()=>['ready','error'].includes(document.getElementById('status').dataset.state));
        assert.equal(await offPage.locator('#status').getAttribute('data-state'),'ready');assert.deepEqual(await offPage.evaluate(()=>window.panelDelivery.getState()),values);
        pass('actual-zip-opens-offline');}finally{await offline.close();}
      report.deliveries.push({id:step.id,zip,zipSha256:await digestBytes(zipBytes),deliveredBundleSha256:delivered.sha256,unityImport:'NOT_RUN'});
      stage = 'reset-and-reopen'; const child = await context.newPage(); observe(child); await begin(child); await upload(child, exportedPath);
      assert.deepEqual((await snap(child)).panel.spec, after.spec); assert.deepEqual(await state(child), values); pass('reopen-in-another-instance');
      await upload(child,join(output,step.id+'-delivery/pixi/panel.bundle.json'));assert.deepEqual(await state(child),values);pass('actual-delivery-reimport-retains-played-state');
      if(step.expectation==='disableMute'){
        const mute=findStressRow(after.spec,'静音'),node=(await child.evaluate(()=>window.panelWorkbench.inspect().nodes)).find(node=>node.id===controlId(after.spec.id,mute.id));
        assert.equal(node.enabled,false);const canvas=child.locator('#canvas-host canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
        const beforeEvents=await child.evaluate(()=>window.panelWorkbench.events().length),beforeState=await state(child);
        await child.mouse.click(box.x+(node.bounds.x+node.bounds.width/2)*box.width/after.spec.canvas.width,box.y+(node.bounds.y+node.bounds.height/2)*box.height/after.spec.canvas.height);
        assert.deepEqual(await state(child),beforeState);assert.equal(await child.evaluate(()=>window.panelWorkbench.events().length),beforeEvents);pass('disabled-mute-real-pointer-no-state-or-event');
      }
      if(step.expectation==='enableMute'){
        const mute=findStressRow(after.spec,'静音'),beforeState=await state(child),beforeEvents=await child.evaluate(()=>window.panelWorkbench.events().length);
        await focus(child,after.spec,mute);await child.keyboard.press('Enter');assert.deepEqual(await state(child),{...beforeState,[mute.bind]:!beforeState[mute.bind]});
        assert.equal((await child.evaluate(()=>window.panelWorkbench.events())).at(-1).name,mute.event);assert.equal(await child.evaluate(()=>window.panelWorkbench.events().length),beforeEvents+1);
        await child.keyboard.press('Enter');assert.deepEqual(await state(child),beforeState);pass('re-enabled-mute-real-keyboard-event-and-value');
      }
      const button = after.spec.sections.flatMap(section => section.rows).find(row => row.kind === 'button');
      if (step.expectation === 'add') {
        const effects = findStressRow(after.spec, '音效音量'); await focus(child, after.spec, effects); await child.keyboard.press('Home');
        for (let i = 0; i < 91; i++) await child.keyboard.press('ArrowRight');
        assert.equal((await state(child))[effects.bind], 91);
      }
      const expectedReset = { ...await state(child) };
      for (const id of button.action.fields) expectedReset[id] = after.spec.state.find(field => field.id === id).initial;
      await focus(child, after.spec, button); await child.keyboard.press('Enter'); assert.deepEqual(await state(child), expectedReset); pass('real-reset-exact-fields-and-default50');
      stage = 'single-step-undo'; const beforePath = join(output, `${step.id}.before.bundle.json`);
      // Deterministic exporter packages the actual before-spec/live-state, never model output repair.
      const { createPanelBundle, panelBundleAssetInputs } = await import('../src/panel-bundle.mjs');
      const verifiedBefore = await validatePanelBundle(before, core), beforeBundle = await createPanelBundle(before.spec, before.catalog, core, beforeValues, panelBundleAssetInputs(verifiedBefore, core));
      await writeNewJson(output, `${step.id}.before.bundle.json`, beforeBundle); await upload(child, beforePath); await apply(child, step); await menu(child); await child.locator('#undo').click(); await idle(child);
      assert.deepEqual((await snap(child)).panel.spec, before.spec); assert.deepEqual(await state(child), beforeValues); pass('single-step-undo-preserves-original-live-state');
      await child.setViewportSize({ width: 390, height: 844 }); assert(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(await state(child), beforeValues); pass('narrow-viewport-no-horizontal-overflow'); await child.close();
      if (step.expectation === 'add') {
        const effects = findStressRow(after.spec, '音效音量'); await focus(page, after.spec, effects); await page.keyboard.press('Home');
        for (let i = 0; i < 91; i++) await page.keyboard.press('ArrowRight');
        assert.equal((await state(page))[effects.bind], 91); pass('new-slider-player-value91-before-next-edit');
      }
      assert.deepEqual(errors, []); result.status = fixture ? 'FIXTURE_PASS' : 'PASS';
    } catch (error) { result.status = 'FAIL'; result.failedStage = stage; result.failureCode = error.code ?? error.message; await page.screenshot({ path: join(output, `${step.id}-failure.png`), fullPage: true }).catch(() => {}); break; }
    console.log(JSON.stringify({ id: step.id, status: result.status, checks: result.checks.length }));
  }
  if (report.cases.length === 10 && report.cases.every(item => ['PASS', 'FIXTURE_PASS'].includes(item.status))) {
    for (let i = 9; i >= 0; i--) { await menu(page); await page.locator('#undo').click(); await idle(page); assert.deepEqual((await snap(page)).panel.spec, beforePanels[i].spec); assert.deepEqual(await state(page), beforePanels[i].state); report.checks.push({ name: `full-chain-undo-${steps[i].id}`, status: 'PASS' }); }
    assert.deepEqual(errors, []); assert.equal(report.blockedUnexpectedRequests,0); assert.equal(report.deliveries.length,10); report.status = fixture ? 'FIXTURE_PASS' : 'PASS';
  } else report.status = 'FAIL';
  await context.close();
} finally {
  await browser?.close(); await server?.close();
  report.totals = { cases: report.cases.length, passed: report.cases.filter(item => ['PASS', 'FIXTURE_PASS'].includes(item.status)).length,
    checks: report.checks.length + report.cases.reduce((sum, item) => sum + item.checks.length, 0), modelCalls: 0 };
  await writeNewJson(output, 'browser-report.json', report); console.log(JSON.stringify({ status: report.status, ...report.totals, deliveries:report.deliveries.length,replayCount: report.replayCount }));if(!['PASS','FIXTURE_PASS'].includes(report.status))process.exitCode=1;
}
