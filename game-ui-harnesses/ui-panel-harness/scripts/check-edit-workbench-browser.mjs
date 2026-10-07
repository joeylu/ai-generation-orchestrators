#!/usr/bin/env node
/** Read-only external Agent inputs; all application mutations use visible UI and real pointer events. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, harnessRoot, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validateCatalog } from '../src/catalog.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { checkPanelEditProposal, validatePanelEditContext, validatePanelEditProposal } from '../src/edit-planning.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { validateWorkbenchAssetPool, verifyWorkbenchContextPool, workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { controlId, initialPanelState } from '../src/compiler.mjs';

const options = {}, args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const name = args[index];
  assert(['--workbench', '--output'].includes(name) && args[index + 1] && !options[name], 'Expected --workbench and --output exactly once');
  options[name] = args[index + 1];
}
assert.equal(Object.keys(options).length, 2, 'Required: --workbench <static directory> --output <fresh directory>');
const directory = await createOutputDirectory(options['--output']);
const inputPaths = {
  base: 'output/readiness-settings-v1/panel.bundle.json',
  shortContext: 'output/edit-readiness-v1/short.context.json',
  shortProposal: 'output/edit-readiness-v1/short.proposal.json',
  completeContext: 'output/edit-readiness-v1/complete.context.json',
  completeProposal: 'output/edit-readiness-v1/complete.proposal.json',
};
const report = {
  editWorkbenchBrowserReportVersion: '0.1', status: 'RUNNING', checks: [], screenshots: [], inputs: {},
  scope: 'Supplied external subagent edit proposals; actual Pixi, visible UI, pointer events, downloads and a fresh browser context. No inference, provider, server or external network is used.',
  providerCalls: 0, humanVisualReview: 'NOT_RUN', semanticReview: 'NOT_RUN', nativeEngines: 'NOT_RUN',
};
const pass = (name, evidence = {}) => report.checks.push({ ...evidence, name, status: 'PASS' });
const problems = [], contexts = [], routedRequests = [];
const origin = 'http://127.0.0.1:4187';
let browser, context, page, stage = 'validate-static-build';

try {
  const core = await loadWorkspaceCore();
  const manifest = await readJson(resolve(options['--workbench'], 'workbench-build.json'));
  assert.equal(manifest.workbenchBuildVersion, '0.1');
  assert.equal(manifest.status, 'COMPLETE');
  assert.deepEqual(manifest.files.map(file => file.path).sort(), ['index.html', 'workbench.js']);
  const files = new Map();
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(options['--workbench'], file.path));
    assert.equal(bytes.length, file.bytes, `${file.path} byte count`);
    assert.equal(await digestBytes(bytes), file.sha256, `${file.path} SHA-256`);
    files.set(`/${file.path}`, bytes);
  }
  const match = files.get('/index.html').toString('utf8').match(/<script id="workbench-seed" type="application\/json">([\s\S]*?)<\/script>/u);
  assert(match, 'Static workbench must contain its complete seed');
  const seed = JSON.parse(match[1]);
  assert.deepEqual(Object.keys(seed).sort(), ['catalog', 'example', 'pool', 'workbenchSeedVersion']);
  assert.equal(seed.workbenchSeedVersion, '0.1');
  const catalog = validateCatalog(seed.catalog), pool = await validateWorkbenchAssetPool(seed.pool);
  assert.equal(await digestJson(catalog), manifest.catalogSha256);
  assert.equal(pool.sha256, manifest.poolSha256);
  assert.equal(pool.index.records.length, manifest.recordCount);
  assert.equal(pool.resources.length, manifest.imageCount);
  const exampleContext = await validatePlanningContext(seed.example.context);
  await verifyWorkbenchContextPool(exampleContext, pool);
  const exampleReport = await checkPanelProposal(exampleContext, seed.example.proposal);
  assert.equal(exampleReport.status, 'READY_TO_COMPILE');
  assert.equal(exampleContext.sha256, manifest.example.contextSha256);
  assert.equal(await digestJson(seed.example.proposal), manifest.example.proposalSha256);
  const exampleBundle = await validatePanelBundle(await createPanelBundle(seed.example.proposal.spec, catalog, core,
    undefined, await workbenchAssetInputs(seed.example.proposal.spec, pool)), core);
  assert.equal(exampleBundle.sha256, manifest.example.panelSha256);
  report.build = manifest;
  pass(stage, { fileCount: files.size, recordCount: pool.index.records.length, imageCount: pool.resources.length });

  stage = 'validate-supplied-base-contexts-and-proposals';
  const inputs = {};
  for (const [name, path] of Object.entries(inputPaths)) {
    const file = resolve(harnessRoot, path), bytes = await readFile(file);
    inputs[name] = await readJson(file);
    report.inputs[name] = { path, bytes: bytes.length, sha256: await digestBytes(bytes) };
  }
  const base = await validatePanelBundle(inputs.base, core);
  assert.deepEqual(base.catalog, catalog);
  const shortContext = await validatePanelEditContext(inputs.shortContext);
  const completeContext = await validatePanelEditContext(inputs.completeContext);
  const shortProposal = await validatePanelEditProposal(shortContext, inputs.shortProposal);
  const completeProposal = await validatePanelEditProposal(completeContext, inputs.completeProposal);
  const shortReport = await checkPanelEditProposal(shortContext, shortProposal);
  const completeReport = await checkPanelEditProposal(completeContext, completeProposal);
  for (const editContext of [shortContext, completeContext]) {
    assert.deepEqual(editContext.spec, base.spec);
    assert.deepEqual(editContext.catalog, base.catalog);
    assert.equal(editContext.baseSpecSha256, await digestJson(base.spec));
    assert.equal(editContext.request.id, 'panel-edit', 'Visible UI uses this exact request ID');
    assert.equal(Object.hasOwn(editContext, 'state'), false);
  }
  assert.equal(shortReport.status, 'NEEDS_INPUT');
  assert.equal(shortProposal.patch, null); assert(shortProposal.unresolved.length > 0);
  assert.equal(completeReport.status, 'READY_TO_APPLY');
  assert.equal(completeReport.compilation, 'NOT_RUN');
  assert.equal(completeReport.semanticReview, 'NOT_RUN');
  assert.equal(completeProposal.patch.operations.length, 1);
  const addition = completeProposal.patch.operations[0];
  assert.equal(addition.op, 'add-row'); assert.equal(addition.row.id, 'sfx-volume-row'); assert.equal(addition.state.id, 'sfxVolume');
  const expectedEdit = await applyPanelPatch(base.spec, completeProposal.patch);
  assert.equal(completeReport.resultSpecSha256, expectedEdit.receipt.resultSpecSha256);
  await writeNewJson(directory, 'short.planning-report.json', shortReport);
  await writeNewJson(directory, 'complete.planning-report.json', completeReport);
  pass(stage, { basePanelSha256: base.sha256, baseSpecSha256: shortContext.baseSpecSha256,
    shortContextSha256: shortContext.sha256, completeContextSha256: completeContext.sha256,
    shortStatus: shortReport.status, completeStatus: completeReport.status });

  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const editSnapshot = () => page.evaluate(() => window.panelWorkbench.editSnapshot());
  const values = () => page.evaluate(() => window.panelWorkbench.getState());
  const inspect = () => page.evaluate(() => window.panelWorkbench.inspect());
  const events = () => page.evaluate(() => window.panelWorkbench.events());
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const healthy = async () => {
    assert.deepEqual(problems, [], 'No unexpected browser exceptions or network requests');
    for (const id of ['request-error', 'proposal-error', 'clarification-error', 'edit-plan-error', 'edit-error', 'preview-error']) {
      assert.equal((await page.locator(`#${id}`).textContent()).trim(), '', `${id} must be empty`);
    }
  };
  const open = async () => {
    context = await browser.newContext({ viewport: { width: 1560, height: 1100 }, serviceWorkers: 'block', acceptDownloads: true });
    contexts.push(context);
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET' && !url.search && files.has(url.pathname)) {
        routedRequests.push(url.pathname);
        return route.fulfill({ body: files.get(url.pathname), contentType: url.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
      }
      if (url.origin === origin && request.method() === 'GET' && !url.search && url.pathname === '/api/panel/capabilities') {
        routedRequests.push(url.pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ protocol: '0.1', model: 'gpt-6-luna', effort: 'xhigh', available: false }) });
      }
      if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
      problems.push('Unexpected external, non-GET or unlisted request was blocked');
      return route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', () => problems.push('Uncaught browser exception'));
    page.on('console', entry => { if (entry.type() === 'error') problems.push('Browser console error'); });
    page.on('requestfailed', () => problems.push('Browser resource request failed'));
    await page.goto(`${origin}/index.html`); await idle(); await healthy();
  };
  const click = async selector => { await page.locator(selector).click(); await idle(); };
  const upload = async (selector, path) => { await page.locator(selector).setInputFiles(path); await idle(); };
  const download = async (selector, name) => {
    const pending = page.waitForEvent('download'); await page.locator(selector).click();
    const downloaded = await pending; assert.equal(await downloaded.failure(), null);
    await downloaded.saveAs(resolve(directory, name)); await idle();
    return readJson(resolve(directory, name));
  };
  const screenshot = async (name, canvas = false) => {
    if (canvas) await page.locator('#canvas-host canvas').screenshot({ path: resolve(directory, name) });
    else await page.screenshot({ path: resolve(directory, name), fullPage: true });
    report.screenshots.push(name);
  };
  const point = async (bounds, spec) => {
    const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox(); assert(box && box.width > 0 && box.height > 0);
    return { x: box.x + bounds.x * box.width / spec.canvas.width, y: box.y + bounds.y * box.height / spec.canvas.height,
      sx: box.width / spec.canvas.width, sy: box.height / spec.canvas.height };
  };
  const node = async (spec, row) => (await inspect()).nodes.find(item => item.id === controlId(spec.id, row.id));
  const clickRow = async (spec, row) => {
    const item = await node(spec, row); assert(item?.visible, 'Control must be visible');
    const position = await point(item.bounds, spec);
    await page.mouse.click(position.x + item.bounds.width * position.sx / 2, position.y + item.bounds.height * position.sy / 2);
  };
  const choose = async (spec, row, optionId) => {
    const before = await values(), eventCount = (await events()).length;
    await clickRow(spec, row);
    const item = await node(spec, row), field = spec.state.find(field => field.id === row.bind), bounds = item.popupBounds;
    assert(item.popupOpen && bounds, 'Select popup must open');
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= spec.canvas.width + 1 && bounds.y + bounds.height <= spec.canvas.height + 1);
    const index = field.options.findIndex(option => option.id === optionId); assert(index >= 0);
    const position = await point(bounds, spec);
    await page.mouse.click(position.x + bounds.width * position.sx / 2,
      position.y + (index + .5) * bounds.height * position.sy / field.options.length);
    assert.deepEqual(await values(), { ...before, [row.bind]: optionId });
    assert.equal((await node(spec, row)).popupOpen, false);
    assert.deepEqual((await events()).slice(eventCount), [{ name: row.event, fieldId: row.bind, value: optionId, source: 'mouse' }]);
  };
  const setSlider = async (spec, row, value) => {
    const before = await values(), eventCount = (await events()).length;
    const item = await node(spec, row), field = spec.state.find(field => field.id === row.bind);
    assert(item?.visible, 'Slider must be visible');
    const position = await point(item.bounds, spec);
    const x = 14 + (value - field.min) / (field.max - field.min) * (item.bounds.width - 28);
    await page.mouse.click(position.x + x * position.sx, position.y + item.bounds.height * position.sy / 2);
    assert.deepEqual(await values(), { ...before, [row.bind]: value });
    assert.deepEqual((await events()).slice(eventCount), [{ name: row.event, fieldId: row.bind, value, source: 'mouse' }]);
  };
  const textBounds = async () => {
    for (const item of (await inspect()).nodes) for (const text of item.renderedTextBounds ?? []) {
      assert(!text.implicitTruncation && text.bounds.width <= item.bounds.width + 1 && text.bounds.height <= item.bounds.height + 1,
        'Actual renderer must not truncate or overflow text');
    }
  };

  stage = 'import-base-through-visible-file-input'; await open();
  assert.equal((await snapshot()).phase, 'empty');
  await upload('#panel-file', resolve(harnessRoot, inputPaths.base)); await healthy();
  const original = await snapshot(), spec = base.spec, rows = spec.sections.flatMap(section => section.rows);
  assert.equal(original.panel.sha256, base.sha256); assert.deepEqual(await values(), base.state);
  assert.equal(original.history.length, 0); await textBounds();
  assert.equal((await inspect()).resources, base.componentBundle.resources.length);
  const master = rows.find(row => row.id === 'volume-row'), quality = rows.find(row => row.id === 'quality-row');
  const bgm = rows.find(row => row.id === 'bgm-row'), reset = rows.find(row => row.id === 'reset-row');
  assert(master?.kind === 'slider' && quality?.kind === 'select' && bgm?.kind === 'switch' && reset?.action.kind === 'reset-initial');
  assert.deepEqual(reset.action.fields, ['masterVolume', 'bgmEnabled', 'quality']);
  await screenshot('panel-before.png', true); pass(stage, { panelSha256: base.sha256, state: await values() });

  stage = 'mouse-changes-existing-live-controls';
  await setSlider(spec, master, 25); await choose(spec, quality, 'smooth');
  const bgmEventCount = (await events()).length; await clickRow(spec, bgm);
  assert.equal((await values()).bgmEnabled, false);
  assert.deepEqual((await events()).slice(bgmEventCount), [{ name: bgm.event, fieldId: bgm.bind, value: false, source: 'mouse' }]);
  const beforeShort = await values(); assert.deepEqual((await snapshot()).panel.spec, base.spec);
  pass(stage, { state: beforeShort });

  stage = 'prepare-exact-short-edit-context';
  await page.locator('#edit-request-text').fill(shortContext.request.text); await click('#prepare-edit-context'); await healthy();
  const exportedShort = await validatePanelEditContext(await download('#download-edit-context', 'short.exported-context.json'));
  assert.deepEqual(exportedShort, shortContext); assert.deepEqual(await values(), beforeShort);
  pass(stage, { contextSha256: exportedShort.sha256 });

  stage = 'short-proposal-needs-input-preserves-panel-and-live-state';
  await upload('#edit-proposal-file', resolve(harnessRoot, inputPaths.shortProposal)); await healthy();
  const unresolved = await editSnapshot();
  assert.deepEqual(unresolved.report, shortReport); assert.deepEqual(unresolved.proposal, shortProposal);
  assert.deepEqual(await page.locator('#edit-questions li').allTextContents(), shortProposal.unresolved.map(item => item.question));
  assert.match(await page.locator('#edit-plan-status').textContent(), /补充.*重新准备/u);
  assert.equal((await snapshot()).panel.sha256, original.panel.sha256);
  assert.deepEqual((await snapshot()).history, original.history); assert.deepEqual(await values(), beforeShort);
  await screenshot('studio-needs-input.png'); pass(stage, { proposalStatus: unresolved.report.status, questionCount: shortProposal.unresolved.length, state: await values() });

  stage = 'prepare-exact-complete-context-and-change-live-values-afterward';
  await page.locator('#edit-request-text').fill(completeContext.request.text);
  assert.equal(await page.locator('#edit-proposal-file').isDisabled(), true);
  await click('#prepare-edit-context'); await healthy();
  const exportedComplete = await validatePanelEditContext(await download('#download-edit-context', 'complete.exported-context.json'));
  assert.deepEqual(exportedComplete, completeContext);
  assert.equal(await page.locator('#edit-questions li').count(), 0);
  await setSlider(spec, master, 83); await choose(spec, quality, 'fine');
  const beforeApply = await values();
  assert.notDeepEqual(beforeApply, beforeShort);
  assert.equal((await editSnapshot()).context.sha256, completeContext.sha256, 'Pure play does not invalidate context');
  pass(stage, { contextSha256: exportedComplete.sha256, preparedState: beforeShort, applyTimeState: beforeApply });

  stage = 'complete-proposal-adds-only-independent-sfx-control';
  await upload('#edit-proposal-file', resolve(harnessRoot, inputPaths.completeProposal)); await healthy();
  const applied = await snapshot(), editedSpec = applied.panel.spec;
  assert.deepEqual(editedSpec, expectedEdit.spec);
  const withoutAddition = structuredClone(editedSpec);
  withoutAddition.state = withoutAddition.state.filter(field => field.id !== addition.state.id);
  for (const section of withoutAddition.sections) section.rows = section.rows.filter(row => row.id !== addition.row.id);
  assert.deepEqual(withoutAddition, base.spec, 'Every unrelated Spec field must remain exact');
  assert.deepEqual(editedSpec.assets, base.spec.assets);
  assert.deepEqual(applied.panel.componentBundle.resources, base.componentBundle.resources);
  const editedRows = editedSpec.sections.flatMap(section => section.rows), sfx = editedRows.find(row => row.id === addition.row.id);
  assert.deepEqual(sfx, addition.row);
  assert.deepEqual(editedRows.find(row => row.id === reset.id), reset);
  assert.deepEqual(await values(), { ...beforeApply, sfxVolume: addition.state.initial });
  assert.equal(applied.history.length, 1);
  assert.deepEqual(applied.history[0].patch, completeProposal.patch);
  assert.deepEqual(applied.history[0].receipt.changedRowIds, ['sfx-volume-row']);
  assert.deepEqual(applied.history[0].editEvidence, { context: completeContext, proposal: completeProposal, report: completeReport });
  assert.equal(await page.locator('#edit-proposal-file').isDisabled(), true);
  assert.equal((await editSnapshot()).context, null);
  await textBounds(); await screenshot('studio-edited.png'); await screenshot('panel-edited.png', true);
  pass(stage, { resultSpecSha256: await digestJson(editedSpec), state: await values(), history: applied.history.length,
    unchangedResetFields: reset.action.fields, retainedImageCount: applied.panel.componentBundle.resources.length });

  stage = 'new-slider-real-pointer-event-is-independent';
  const beforeSfx = await values(); await setSlider(editedSpec, sfx, 32);
  assert.deepEqual(await values(), { ...beforeSfx, sfxVolume: 32 });
  pass(stage, { event: (await events()).at(-1), state: await values() });

  stage = 'reset-only-original-three-fields';
  const resetEventCount = (await events()).length; await clickRow(editedSpec, reset);
  const expectedReset = { ...initialPanelState(base.spec), sfxVolume: 32 };
  assert.deepEqual(await values(), expectedReset);
  assert.deepEqual((await events()).slice(resetEventCount), [{ name: reset.event, rowId: reset.id,
    action: 'reset-initial', state: expectedReset, source: 'mouse' }]);
  await textBounds(); pass(stage, { state: expectedReset, preservedSfxValue: 32, resetFields: reset.action.fields });

  stage = 'download-validate-edited-bundle-with-current-state';
  await setSlider(editedSpec, master, 46); await choose(editedSpec, quality, 'smooth');
  const savedState = await values();
  const exported = await validatePanelBundle(await download('#download-panel', 'edited.panel.bundle.json'), core);
  assert.deepEqual(exported.state, savedState); assert.deepEqual(exported.spec, editedSpec);
  assert.deepEqual(exported.spec.assets, base.spec.assets);
  assert.deepEqual(exported.componentBundle.resources, base.componentBundle.resources);
  await writeNewJson(directory, 'edited.panel.state.json', savedState);
  await screenshot('studio-exported.png'); await screenshot('panel-exported.png', true);
  pass(stage, { artifact: 'edited.panel.bundle.json', panelSha256: exported.sha256, state: exported.state });

  stage = 'fresh-browser-context-reopens-identical-exported-state';
  const editingContext = context, editingPage = page;
  await open(); assert.equal((await snapshot()).panel, null);
  await upload('#panel-file', resolve(directory, 'edited.panel.bundle.json')); await healthy();
  const reopened = await snapshot();
  assert.equal(reopened.panel.sha256, exported.sha256); assert.deepEqual(reopened.panel.spec, editedSpec);
  assert.deepEqual(await values(), savedState); assert.deepEqual(await events(), []);
  assert.equal(reopened.history.length, 0); assert.equal(await page.locator('#undo').isDisabled(), true);
  await textBounds(); await screenshot('studio-reopened.png'); await screenshot('panel-reopened.png', true);
  pass(stage, { panelSha256: reopened.panel.sha256, state: await values(), freshContext: true });
  await context.close(); context = editingContext; page = editingPage;

  stage = 'undo-whole-proposal-restores-source-and-apply-time-live-state';
  await click('#undo'); await healthy();
  const undone = await snapshot(); await validatePanelBundle(undone.panel, core);
  assert.deepEqual(undone.panel.spec, base.spec); assert.deepEqual(await values(), beforeApply);
  assert.equal(Object.hasOwn(await values(), 'sfxVolume'), false);
  assert.equal(undone.history.length, 0); assert.equal(await page.locator('#undo').isDisabled(), true);
  assert.deepEqual(undone.panel.componentBundle.resources, base.componentBundle.resources);
  await screenshot('studio-undone.png'); await screenshot('panel-undone.png', true);
  pass(stage, { sourceSpecSha256: await digestJson(undone.panel.spec), restoredState: await values(), history: 0 });

  stage = 'source-files-remain-exact-and-network-boundary-held';
  for (const [name, path] of Object.entries(inputPaths)) {
    const bytes = await readFile(resolve(harnessRoot, path));
    assert.equal(bytes.length, report.inputs[name].bytes);
    assert.equal(await digestBytes(bytes), report.inputs[name].sha256, 'Acceptance must never repair its inputs');
  }
  assert.deepEqual(problems, []);
  assert(routedRequests.every(path => ['/index.html', '/workbench.js', '/api/panel/capabilities'].includes(path)));
  pass(stage, { inputCount: Object.keys(inputPaths).length, providerCalls: 0, externalRequests: 0, serverStarted: false });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.failure = { stage, code: error.code ?? error.name ?? 'ACCEPTANCE_FAILED', message: String(error.message).slice(0, 1600) };
  if (page) try {
    await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png');
  } catch {}
  process.exitCode = 1;
} finally {
  report.browserProblems = problems;
  report.routedRequests = routedRequests;
  for (const item of contexts) await item.close().catch(() => {});
  await browser?.close().catch(() => {});
  await writeNewJson(directory, 'edit-workbench-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, failedStage: report.failure?.stage ?? null })}\n`);
}
