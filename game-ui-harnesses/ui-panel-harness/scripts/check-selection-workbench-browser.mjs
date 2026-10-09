#!/usr/bin/env node
/** Studio selection feedback with real Pixi input and fixture editing only. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { loadBundledCoreAssets } from '../src/bundled-core-assets.mjs';
import { assetUsageFixtures } from '../examples/asset-usage-v1/fixture.mjs';
import { workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { composePanelBundles } from '../src/panel-composition.mjs';
import { arrangeIntentSpec } from '../src/panel-intent.mjs';
import { layoutSettings } from '../examples/focused-layout-v1/fixture.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { previewSelectionTargets } from '../src/workbench-selection.mjs';
import { controlId } from '../src/compiler.mjs';
import { canonicalJson, digestBytes } from '../src/canonical.mjs';

assert(process.argv.length === 6 && process.argv[2] === '--workbench' && process.argv[4] === '--output',
  'Required: --workbench <build> --output <fresh directory>');
const workbench = resolve(process.argv[3]), output = await createOutputDirectory(process.argv[5]);
const report = { status: 'RUNNING', sourceKind: 'PROGRAMMATIC_FIXTURE', modelCalls: 0, fixtureEditorCalls: 0,
  checks: [], errors: [], externalRequests: 0, nativeUnity: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
const pass = name => report.checks.push({ name, status: 'PASS' });
let browser, server, releaseEdit, expectedError = false, failEdit = false;
try {
  const [core, pool, catalog, base, manifest] = await Promise.all([loadWorkspaceCore(), loadBundledCoreAssets(),
    readJson(resolve(harnessRoot, 'examples/modern-navigation.catalog.json')),
    readJson(resolve(harnessRoot, 'examples/settings-controls.panel.json')), readJson(resolve(workbench, 'workbench-build.json'))]);
  for (const file of manifest.files) assert.equal(await digestBytes(await readFile(resolve(workbench, file.path))), file.sha256);
  report.buildSha256 = manifest.studio.buildSha256;
  const fixtures = await assetUsageFixtures(catalog, base, pool), bundles = {};
  const compile = async spec => createPanelBundle(spec, catalog, core, undefined, spec.assets ? await workbenchAssetInputs(spec, pool) : undefined);
  for (const mode of ['light', 'dark']) {
    const spec = structuredClone(fixtures.settings.chosen), theme = catalog.themes.find(t => t.id === `modern-blue-${mode}`);
    spec.theme = { id: theme.id, version: theme.version }; bundles[mode] = await compile(spec);
  }
  const theme = catalog.themes.find(t => t.id === bundles.dark.spec.theme.id);
  bundles.scroll = await compile(arrangeIntentSpec(structuredClone(fixtures.settings.chosen), { ...layoutSettings(760), maxHeight: 260 }, theme));
  const role = await compile(fixtures.role.chosen);
  bundles.tabs = (await composePanelBundles({ panelCompositionRequestVersion: '0.1', id: 'selection-tabs', title: '选择反馈夹具',
    sources: [{ namespace: 'sound', bundleSha256: bundles.dark.sha256 }, { namespace: 'role', bundleSha256: role.sha256 }],
    layout: 'tabs', width: 760, canvasWidth: 820, canvasHeight: 620, maxHeight: 480, surfaceFrom: null }, [bundles.dark, role], core)).bundle;
  for (const [name, bundle] of Object.entries(bundles)) await writeFile(resolve(output, `${name}.panel.bundle.json`), canonicalJson(bundle) + '\n', { flag: 'wx' });
  server = await createWorkbenchServer({ workbench, outputRoot: resolve(output, 'fixture-runs'), port: 0,
    planner: async () => { throw new Error('UNEXPECTED_PLANNER_CALL'); },
    editor: async context => {
      report.fixtureEditorCalls++;
      await new Promise(done => { releaseEdit = done; });
      if (failEdit) throw Object.assign(new Error('CODEX_CONNECTION_FAILED_NO_RETRY'), { code: 'CODEX_CONNECTION_FAILED_NO_RETRY' });
      const operation = { op: 'set-row-enabled', rowId: context.selection.rowId, enabled: false };
      const proposal = { editProposalVersion: '0.1', contextSha256: context.sha256, unresolved: [],
        patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Deterministic selection fixture.', operations: [operation] },
        decisions: [{ operationIndex: 0, basis: { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } }] };
      const checked = await checkPanelEditProposal(context, proposal);
      return { proposal, report: checked, receipt: { codexEditingReceiptVersion: '0.1', status: checked.status,
        model: 'gpt-6-luna', effort: 'xhigh', contextSha256: context.sha256, proposalSha256: checked.proposalSha256,
        failureCode: null, invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null } };
    } });
  const { chromium } = await loadWorkspaceTool('@playwright/test');
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true, serviceWorkers: 'block' });
  const origin = new URL(server.url).origin;
  await context.route(url => !['data:', 'blob:'].includes(url.protocol) && url.origin !== origin, route => {
    report.externalRequests++; return route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error' && !(expectedError && /Failed to load resource/.test(entry.text()))) report.errors.push(entry.text()); });
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot()?.panel && !window.panelWorkbench.busy);
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const state = () => page.evaluate(() => window.panelWorkbench.getState());
  const events = () => page.evaluate(() => window.panelWorkbench.events());
  const releaseFixture = async () => {
    for (let i = 0; i < 750 && !releaseEdit; i++) await new Promise(done => setTimeout(done, 20));
    assert(releaseEdit, 'Fixture edit must reach the injected editor'); releaseEdit(); releaseEdit = null;
  };
  const outline = page.locator('.selected-edit-target'), canvas = page.locator('#canvas-host canvas');
  const menu = async () => { if (!await page.locator('#panel-menu').evaluate(node => node.open)) await page.locator('#panel-menu > summary').click(); };
  const open = async name => {
    await menu(); await page.locator('#panel-file').setInputFiles(resolve(output, `${name}.panel.bundle.json`)); await idle();
    assert.equal((await snapshot()).panel.sha256, bundles[name].sha256);
    assert(await outline.isHidden());
  };
  const select = async rowId => {
    await page.locator('#select-edit-target').click();
    await page.locator(`.selection-target[data-row-id="${rowId}"]`).press('Enter');
    assert(await page.locator('#edit-request-text').evaluate(node => node === document.activeElement));
    assert(await outline.isVisible()); assert.equal(await outline.getAttribute('data-row-id'), rowId);
  };
  const aligned = async rowId => {
    const bundle = (await snapshot()).panel, inspection = await page.evaluate(() => window.panelWorkbench.inspect());
    const target = previewSelectionTargets(bundle.spec, bundle.componentBundle.document, inspection).find(row => row.rowId === rowId);
    assert(target, 'Selected row must be visible');
    const box = await canvas.boundingBox(), actual = await outline.boundingBox();
    const expected = { x: box.x + target.bounds.x * box.width / bundle.spec.canvas.width,
      y: box.y + target.bounds.y * box.height / bundle.spec.canvas.height,
      width: target.bounds.width * box.width / bundle.spec.canvas.width, height: target.bounds.height * box.height / bundle.spec.canvas.height };
    for (const key of Object.keys(expected)) assert(Math.abs(expected[key] - actual[key]) < 1, `Outline ${key} matches clipped row`);
    assert.equal(await outline.evaluate(node => getComputedStyle(node).pointerEvents), 'none');
    assert.equal(await outline.getAttribute('aria-hidden'), 'true');
  };
  const clickNode = async nodeId => {
    const spec = (await snapshot()).panel.spec, node = (await page.evaluate(() => window.panelWorkbench.inspect())).nodes.find(n => n.id === nodeId);
    await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
    await page.mouse.click(box.x + (node.bounds.x + node.bounds.width / 2) * box.width / spec.canvas.width,
      box.y + (node.bounds.y + node.bounds.height / 2) * box.height / spec.canvas.height);
  };
  await page.goto(server.url);
  for (const mode of ['light', 'dark']) {
    report.phase = mode; await open(mode);
    const bundle = bundles[mode], row = bundle.spec.sections.flatMap(s => s.rows).find(r => r.kind === 'switch');
    const before = await state(), beforeEvents = await events(); await select(row.id); await aligned(row.id);
    assert.deepEqual(await state(), before); assert.deepEqual(await events(), beforeEvents);
    pass(`${mode}-keyboard-selection-marks-row-without-playing`);
    await page.locator('#edit-request-text').fill('把这个开关禁用，其他保持不变。'); await aligned(row.id);
    await clickNode(controlId(bundle.spec.id, row.id)); assert.equal((await state())[row.bind], !before[row.bind]);
    await aligned(row.id); pass(`${mode}-passive-outline-allows-real-pixi-toggle`);
    await page.screenshot({ path: resolve(output, `${mode}-selected.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    await aligned(row.id); pass(`${mode}-narrow-outline-follows-canvas`);
    await page.screenshot({ path: resolve(output, `${mode}-narrow.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1080 }); await aligned(row.id);
    await menu(); const download = page.waitForEvent('download'); await page.locator('#download-panel').click();
    const saved = resolve(output, `${mode}-selected-export.json`); await (await download).saveAs(saved);
    const exported = await readJson(saved); assert.deepEqual(exported.spec, bundle.spec); assert.deepEqual(exported.state, await state());
    assert.match(await page.locator('#edit-rounds').textContent(), /0 \/ 10/); pass(`${mode}-selection-keeps-spec-assets-state-and-budget`);
    await page.locator('#select-edit-target').click(); assert(await outline.isHidden());
    await page.locator('.selection-target').first().press('Escape'); await aligned(row.id);
    await page.locator('#clear-edit-target').click(); assert(await outline.isHidden()); pass(`${mode}-escape-restores-outline-clear-removes-it`);
  }
  report.phase = 'edit'; await open('dark');
  const row = bundles.dark.spec.sections.flatMap(s => s.rows).find(r => r.kind === 'switch'); await select(row.id);
  const before = (await snapshot()).panel, live = await state();
  await page.locator('#edit-request-text').fill('把这个开关禁用，其他保持不变。');
  failEdit = expectedError = true; await page.locator('#generate-edit').click();
  await page.waitForFunction(() => window.panelWorkbench.busy && document.getElementById('cancel-edit').disabled === false);
  assert(await outline.isHidden());
  await releaseFixture(); await idle();
  assert.equal(report.fixtureEditorCalls, 1); await aligned(row.id);
  assert.equal((await snapshot()).panel.sha256, before.sha256); assert.deepEqual(await state(), live);
  assert.match(await page.locator('#edit-rounds').textContent(), /0 \/ 10/); pass('failed-fixture-edit-restores-outline-without-retry-or-budget');
  failEdit = expectedError = false; await page.locator('#generate-edit').click();
  await releaseFixture(); await idle();
  assert(await outline.isHidden()); assert(await page.locator('#edit-target').isHidden());
  const edited = (await snapshot()).panel;
  assert.equal(edited.spec.sections.flatMap(s => s.rows).find(r => r.id === row.id).enabled, false);
  assert.deepEqual(edited.spec.assets, before.spec.assets);
  assert.deepEqual(edited.bindings, before.bindings.map(binding => binding.nodeId === controlId(before.spec.id, row.id) ? { ...binding, enabled: false } : binding));
  assert.deepEqual(await state(), live);
  assert.match(await page.locator('#edit-rounds').textContent(), /1 \/ 10/); pass('applied-fixture-edit-clears-outline-preserves-assets-bindings-trial');
  await select(row.id); await menu(); await page.locator('#undo').click(); await idle(); assert(await outline.isHidden());
  assert.deepEqual((await snapshot()).panel.spec, before.spec); pass('undo-clears-outline');
  await select(row.id); await page.reload(); await idle(); assert(await outline.isHidden()); assert(await page.locator('#edit-target').isHidden()); pass('refresh-keeps-panel-without-persisting-selection');
  report.phase = 'scroll'; await open('scroll');
  const scrollSpec = bundles.scroll.spec, first = scrollSpec.sections[0].rows[0]; await select(first.id); await aligned(first.id);
  await canvas.scrollIntoViewIfNeeded(); const scrollBox = await canvas.boundingBox();
  await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2); await page.mouse.wheel(0, 1200);
  await page.waitForFunction(() => document.querySelector('.selected-edit-target').hidden); assert(await page.locator('#edit-target').isVisible());
  await page.mouse.wheel(0, -1200); await page.waitForFunction(() => !document.querySelector('.selected-edit-target').hidden); await aligned(first.id); pass('scroll-hides-offscreen-target-and-restores-clipped-outline');
  report.phase = 'tabs'; await open('tabs');
  const tabSpec = bundles.tabs.spec, tabRow = tabSpec.sections.flatMap(s => s.rows).find(r => r.kind === 'switch'); await select(tabRow.id); await aligned(tabRow.id);
  const tabs = (await page.evaluate(() => window.panelWorkbench.inspect())).nodes.find(n => n.type === 'Tabs');
  await canvas.scrollIntoViewIfNeeded(); const tabBox = await canvas.boundingBox();
  const clickTab = fraction => page.mouse.click(tabBox.x + (tabs.bounds.x + tabs.bounds.width * fraction) * tabBox.width / tabSpec.canvas.width,
    tabBox.y + (tabs.bounds.y + 20) * tabBox.height / tabSpec.canvas.height);
  await clickTab(0.75); await page.waitForFunction(() => document.querySelector('.selected-edit-target').hidden); assert(await page.locator('#edit-target').isVisible());
  await clickTab(0.25); await page.waitForFunction(() => !document.querySelector('.selected-edit-target').hidden); await aligned(tabRow.id); pass('tabs-hide-other-page-outline-without-changing-edit-scope');
  assert.equal(report.fixtureEditorCalls, 2); assert.deepEqual(report.errors, []); assert.equal(report.externalRequests, 0);
  pass('no-model-external-request-or-page-error'); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { code: error.code ?? 'CHECK_FAILED', message: error.message }; process.exitCode = 1;
} finally {
  releaseEdit?.(); await browser?.close(); await server?.close(); await writeNewJson(output, 'selection-browser-report.json', report);
}
process.stdout.write(JSON.stringify({ status: report.status, checks: report.checks.length, modelCalls: report.modelCalls, phase: report.phase, failure: report.failure }) + '\n');
