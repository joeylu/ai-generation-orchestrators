#!/usr/bin/env node
/** Offline visible-UI acceptance. Application probes are read-only; edits use controls and files. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { createOutputDirectory, harnessRoot, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { validateCatalog } from '../src/catalog.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { checkPanelEditProposal, validatePanelEditContext } from '../src/edit-planning.mjs';
import { validateWorkbenchAssetPool, verifyWorkbenchContextPool, workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { controlId } from '../src/compiler.mjs';

const options = {}, args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  assert(['--workbench', '--output'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Expected --workbench and --output exactly once');
  options[args[index]] = args[index + 1];
}
assert.equal(Object.keys(options).length, 2, 'Required: --workbench <static directory> --output <fresh directory>');
const directory = await createOutputDirectory(options['--output']);
const report = { layoutWorkbenchBrowserReportVersion: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  scope: 'Offline file workbench; real Pixi pointer, keyboard, upload and download UI. Edit proposals are explicit programmatic fixtures, not model results. Read-only application probes only.',
  humanVisualReview: 'NOT_RUN', semanticReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
const pass = (name, evidence = {}) => report.checks.push({ name, status: 'PASS', ...evidence });
const problems = [], contexts = [];
let browser, context, page, stage = 'validate-static-build';
try {
  const core = await loadWorkspaceCore(), manifest = await readJson(resolve(options['--workbench'], 'workbench-build.json'));
  assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.workbenchBuildVersion, '0.1');
  assert.deepEqual(manifest.files.map(file => file.path).sort(), ['index.html', 'workbench.js']);
  let html;
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(options['--workbench'], file.path));
    assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256);
    if (file.path === 'index.html') html = bytes.toString('utf8');
  }
  const seedMatch = html.match(/<script id="workbench-seed" type="application\/json">([\s\S]*?)<\/script>/u);
  assert(seedMatch); const seed = JSON.parse(seedMatch[1]), catalog = validateCatalog(seed.catalog);
  assert.equal(await digestJson(catalog), manifest.catalogSha256);
  const pool = seed.pool ? await validateWorkbenchAssetPool(seed.pool) : null;
  assert.equal(pool?.sha256 ?? null, manifest.poolSha256);
  const exampleContext = await validatePlanningContext(seed.example.context);
  const exampleReport = await checkPanelProposal(exampleContext, seed.example.proposal);
  assert.equal(exampleContext.planningContextVersion, '0.4'); assert.equal(exampleReport.status, 'READY_TO_COMPILE');
  if (exampleContext.assetRetrieval) await verifyWorkbenchContextPool(exampleContext, pool);
  const exampleBundle = await validatePanelBundle(await createPanelBundle(seed.example.proposal.spec, catalog, core, undefined,
    pool ? await workbenchAssetInputs(seed.example.proposal.spec, pool) : undefined), core);
  assert.equal(exampleContext.sha256, manifest.example.contextSha256);
  assert.equal(await digestJson(seed.example.proposal), manifest.example.proposalSha256);
  assert.equal(exampleBundle.sha256, manifest.example.panelSha256);
  report.build = manifest; pass(stage, { fileCount: manifest.files.length, contextVersion: exampleContext.planningContextVersion });

  stage = 'validate-four-layout-bundles';
  const bundles = {};
  for (const name of ['settings', 'pause', 'character', 'settings-compact']) {
    bundles[name] = await validatePanelBundle(await readJson(resolve(harnessRoot, 'output/layout-v2', name, 'panel.bundle.json')), core);
    assert.equal(bundles[name].panelBundleVersion, '0.4'); assert.deepEqual(bundles[name].catalog, catalog);
  }
  pass(stage, { bundles: Object.fromEntries(Object.entries(bundles).map(([name, bundle]) => [name, bundle.sha256])) });

  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const edits = () => page.evaluate(() => window.panelWorkbench.editSnapshot());
  const values = () => page.evaluate(() => window.panelWorkbench.getState());
  const inspect = () => page.evaluate(() => window.panelWorkbench.inspect());
  const events = () => page.evaluate(() => window.panelWorkbench.events());
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const healthy = async () => {
    assert.deepEqual(problems, [], 'No browser exceptions or unexpected requests');
    for (const id of ['request-error', 'proposal-error', 'clarification-error', 'edit-plan-error', 'edit-error', 'preview-error'])
      assert.equal((await page.locator(`#${id}`).textContent()).trim(), '', `${id} must be empty`);
  };
  const open = async () => {
    context = await browser.newContext({ viewport: { width: 1560, height: 1100 }, serviceWorkers: 'block', acceptDownloads: true });
    contexts.push(context); await context.setOffline(true);
    const allowed = new Set(manifest.files.map(file => pathToFileURL(resolve(options['--workbench'], file.path)).href));
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if ((request.method() === 'GET' && allowed.has(url.href)) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      problems.push('Blocked unexpected network or unlisted file request'); return route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => problems.push(`Uncaught browser exception: ${String(error.message).slice(0, 160)}`));
    page.on('console', entry => { if (entry.type() === 'error') problems.push(`Browser console error: ${entry.text().slice(0, 160)}`); });
    page.on('requestfailed', request => problems.push(`Failed browser request: ${new URL(request.url()).protocol}`));
    await page.goto(pathToFileURL(resolve(options['--workbench'], 'index.html')).href); await idle(); await healthy();
  };
  const click = async selector => { await page.locator(selector).click(); await idle(); };
  const upload = async (selector, name, value) => {
    await page.locator(selector).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) }); await idle();
  };
  const download = async (selector, name) => {
    const waiting = page.waitForEvent('download'); await page.locator(selector).click();
    const file = await waiting; assert.equal(await file.failure(), null);
    await file.saveAs(resolve(directory, name)); await idle(); return readJson(resolve(directory, name));
  };
  const screenshot = async (name, canvas = false) => {
    if (canvas) await page.locator('#canvas-host canvas').screenshot({ path: resolve(directory, name) });
    else await page.screenshot({ path: resolve(directory, name), fullPage: true }); report.screenshots.push(name);
  };
  const point = async (bounds, spec) => {
    const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox(); assert(box && box.width > 0 && box.height > 0);
    return { x: box.x + bounds.x * box.width / spec.canvas.width, y: box.y + bounds.y * box.height / spec.canvas.height,
      sx: box.width / spec.canvas.width, sy: box.height / spec.canvas.height };
  };
  const findNode = async id => (await inspect()).nodes.find(node => node.id === id);
  const setSlider = async (spec, row, value) => {
    const node = await findNode(controlId(spec.id, row.id)), field = spec.state.find(field => field.id === row.bind), before = await values();
    assert(node?.visible); const p = await point(node.bounds, spec);
    await page.mouse.click(p.x + (14 + (value - field.min) / (field.max - field.min) * (node.bounds.width - 28)) * p.sx,
      p.y + node.bounds.height * p.sy / 2);
    assert.deepEqual(await values(), { ...before, [row.bind]: value });
  };
  const activate = async (spec, row) => {
    const node = await findNode(controlId(spec.id, row.id)), p = await point(node.bounds, spec), before = (await events()).length;
    await page.mouse.click(p.x + node.bounds.width * p.sx / 2, p.y + node.bounds.height * p.sy / 2);
    assert.deepEqual((await events()).slice(before), [{ name: row.event, rowId: row.id, action: 'emit', state: {}, source: 'mouse' }]);
  };
  const editProposal = (context, operations) => ({ editProposalVersion: '0.1', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Programmatic layout workbench acceptance fixture; not a model interpretation.', operations },
    decisions: operations.map((_, operationIndex) => ({ operationIndex, basis: { kind: 'request-interpretation', start: 0,
      end: context.request.text.length, quote: context.request.text } })), unresolved: [] });

  stage = 'offline-visible-example-shows-flow-panel-and-scroll-guidance'; await open(); await click('#example'); await healthy();
  const original = await snapshot(), spec = original.panel.spec;
  assert.equal(original.panel.sha256, exampleBundle.sha256); assert.equal(spec.panelSpecVersion, '0.4');
  assert.match(await page.locator('#panel-dimensions').textContent(), /滚轮或拖动空白处查看更多/u);
  assert.equal((await findNode(`${spec.id}.body`)).type, 'ScrollView');
  await screenshot('settings-before.png', true); pass(stage, { scheme: 'file', network: 'OFFLINE', panelSha256: original.panel.sha256 });

  stage = 'real-pointer-changes-volume-before-layout-edit';
  const slider = spec.sections.flatMap(section => section.rows).find(row => row.kind === 'slider' && row.bind === 'volume'); assert(slider);
  await setSlider(spec, slider, 25); const played = await values(); assert.notDeepEqual(played, original.panel.state);
  pass(stage, { state: played });

  stage = 'prepare-source-bound-natural-language-layout-edit';
  await page.locator('#edit-request-text').fill('把设置内容从双列网格改为纵向排列，其他布局参数、控件、默认值与当前试玩值保持不变。');
  await click('#prepare-edit-context'); await healthy();
  const editContext = await validatePanelEditContext(await download('#download-edit-context', 'layout-edit.context.json'));
  assert.deepEqual(editContext.spec, spec); assert.equal(Object.hasOwn(editContext, 'state'), false);
  const layout = structuredClone(spec.layout); layout.body.kind = 'column'; delete layout.body.minColumnWidth;
  const proposal = editProposal(editContext, [{ op: 'set-layout', layout }]);
  const checkedEdit = await checkPanelEditProposal(editContext, proposal); assert.equal(checkedEdit.status, 'READY_TO_APPLY');
  await writeNewJson(directory, 'layout-edit.proposal.json', proposal); pass(stage, { contextSha256: editContext.sha256 });

  stage = 'layout-edit-preserves-live-values-and-control-semantics';
  await upload('#edit-proposal-file', 'layout-edit.proposal.json', proposal); await healthy();
  const applied = await snapshot(); assert.deepEqual(applied.panel.spec, { ...spec, layout }); assert.deepEqual(await values(), played);
  assert.equal(applied.history.length, 1); assert.deepEqual(applied.history[0].receipt.changedRowIds, []);
  const sections = applied.panel.spec.sections.map(section => section.id), a = await findNode(`${spec.id}.section.${sections[0]}`), b = await findNode(`${spec.id}.section.${sections[1]}`);
  assert.equal(a.bounds.x, b.bounds.x); assert(b.bounds.y > a.bounds.y);
  const editedBundle = await validatePanelBundle(await download('#download-panel', 'layout-edited.panel.bundle.json'), core);
  assert.deepEqual(editedBundle.state, played); assert.deepEqual(editedBundle.spec.layout, layout);
  await screenshot('settings-column.png', true); pass(stage, { panelSha256: editedBundle.sha256, state: played });

  stage = 'undo-layout-edit-restores-grid-and-live-values'; await click('#undo'); await healthy();
  assert.deepEqual((await snapshot()).panel.spec, spec); assert.deepEqual(await values(), played);
  assert.equal((await snapshot()).history.length, 0); pass(stage);

  stage = 'invalid-narrow-layout-retains-panel-state-history-and-export';
  const beforeFailure = await snapshot(), beforeFailureState = await values();
  await page.locator('#edit-request-text').fill('将面板宽度设为100像素，用于明确的失败回归；原面板应在验证失败时保留。'); await click('#prepare-edit-context');
  const invalidContext = await validatePanelEditContext(await download('#download-edit-context', 'invalid-layout.context.json'));
  const invalid = editProposal(invalidContext, [{ op: 'set-layout', layout: { ...spec.layout, width: 100 } }]);
  await upload('#edit-proposal-file', 'invalid-layout.proposal.json', invalid);
  assert((await page.locator('#edit-plan-error').textContent()).trim());
  assert.deepEqual((await snapshot()).panel, beforeFailure.panel); assert.deepEqual((await snapshot()).history, beforeFailure.history);
  assert.deepEqual(await values(), beforeFailureState); assert.equal((await edits()).context.sha256, invalidContext.sha256);
  const retained = await validatePanelBundle(await download('#download-panel', 'retained-after-failure.panel.bundle.json'), core);
  assert.deepEqual(retained.spec, spec); assert.deepEqual(retained.state, played); pass(stage);

  stage = 'import-character-read-only-rows-have-no-enabled-or-initial-editor';
  await upload('#panel-file', 'character.panel.bundle.json', bundles.character); await healthy();
  const character = bundles.character.spec, text = character.sections.flatMap(section => section.rows).find(row => row.kind === 'text');
  await page.locator('#edit-row').selectOption(text.id);
  assert.equal(await page.locator('#edit-enabled').isDisabled(), true); assert.equal(await page.locator('#edit-initial').count(), 0);
  assert.match(await page.locator('#action-description').textContent(), /只读内容/u); assert.deepEqual(await values(), {});
  await screenshot('character-before.png', true); pass(stage);

  stage = 'text-label-edit-and-undo-keep-empty-state';
  await page.locator('#edit-label').fill('姓名'); await click('#apply-edit'); await healthy();
  let changedCharacter = await snapshot();
  assert.equal(changedCharacter.panel.spec.sections.flatMap(section => section.rows).find(row => row.id === text.id).label, '姓名');
  assert.deepEqual(changedCharacter.panel.state, {}); assert.deepEqual(await values(), {});
  assert.deepEqual(changedCharacter.history[0].patch.operations, [{ op: 'set-row-label', rowId: text.id, label: '姓名' }]);
  await click('#undo'); await healthy(); assert.deepEqual((await snapshot()).panel.spec, character); assert.deepEqual(await values(), {}); pass(stage);

  stage = 'pure-menu-title-edit-and-export-edit-context';
  await upload('#panel-file', 'pause.panel.bundle.json', bundles.pause); await healthy();
  assert.deepEqual(await values(), {}); assert.deepEqual((await snapshot()).panel.spec.state, []);
  await page.locator('#edit-title').fill('暂停菜单'); await click('#apply-edit'); await healthy();
  await page.locator('#edit-request-text').fill('在当前暂停菜单基础上准备下一次修改；这份输入仅用于导出上下文的程序验收。'); await click('#prepare-edit-context');
  const pauseContext = await validatePanelEditContext(await download('#download-edit-context', 'pause-edit.context.json'));
  assert.equal(pauseContext.spec.title, '暂停菜单'); assert.deepEqual(pauseContext.spec.state, []);
  const pauseSaved = await validatePanelBundle(await download('#download-panel', 'pause-edited.panel.bundle.json'), core);
  assert.equal(pauseSaved.spec.title, '暂停菜单'); assert.deepEqual(pauseSaved.state, {});
  await screenshot('pause-edited.png', true); pass(stage, { contextSha256: pauseContext.sha256, panelSha256: pauseSaved.sha256 });

  stage = 'reopen-stateless-menu-in-fresh-offline-context-and-emit-action';
  await context.close(); await open(); await upload('#panel-file', 'pause-edited.panel.bundle.json', pauseSaved); await healthy();
  assert.deepEqual((await snapshot()).panel, pauseSaved); assert.deepEqual(await values(), {});
  await activate(pauseSaved.spec, pauseSaved.spec.sections[0].rows[0]); await healthy(); assert.deepEqual(await values(), {}); pass(stage);

  stage = 'compact-panel-drag-scroll-preserves-business-state';
  await upload('#panel-file', 'compact.panel.bundle.json', bundles['settings-compact']); await healthy();
  const compact = bundles['settings-compact'].spec, compactSlider = compact.sections.flatMap(section => section.rows).find(row => row.bind === 'volume');
  await setSlider(compact, compactSlider, 35); const compactState = await values();
  let body = await findNode(`${compact.id}.body`); assert.equal(body.value.y, 0);
  let p = await point(body.bounds, compact);
  await page.mouse.move(p.x + 4 * p.sx, p.y + body.bounds.height * .75 * p.sy); await page.mouse.down();
  await page.mouse.move(p.x + 4 * p.sx, p.y + body.bounds.height * .25 * p.sy, { steps: 8 }); await page.mouse.up();
  body = await findNode(`${compact.id}.body`); assert(body.value.y > 0); assert.deepEqual(await values(), compactState);
  await screenshot('compact-scrolled.png', true); pass(stage, { scrollY: body.value.y, state: compactState });

  stage = 'preparing-edit-cancels-inflight-scroll-and-retains-current-state';
  await page.locator('#edit-request-text').fill('保留当前紧凑设置面板，用于检查异步准备修改时的滚动手势取消。');
  body = await findNode(`${compact.id}.body`); p = await point(body.bounds, compact);
  await page.mouse.move(p.x + 4 * p.sx, p.y + body.bounds.height * .75 * p.sy); await page.mouse.down();
  await page.mouse.move(p.x + 4 * p.sx, p.y + body.bounds.height * .50 * p.sy, { steps: 5 });
  const duringDrag = (await findNode(`${compact.id}.body`)).value.y;
  // Real keyboard activation while the pointer remains held; no app mutation API.
  await page.locator('#prepare-edit-context').focus(); await page.keyboard.press('Enter'); await idle(); await healthy();
  const afterPrepare = (await findNode(`${compact.id}.body`)).value.y;
  await page.mouse.move(p.x + 4 * p.sx, p.y + body.bounds.height * .10 * p.sy, { steps: 5 }); await page.mouse.up();
  assert.equal((await findNode(`${compact.id}.body`)).value.y, afterPrepare, 'A cancelled drag must not resume after the asynchronous operation');
  assert.equal(afterPrepare, duringDrag, 'Lock preserves the visible scroll value at the start of the operation');
  assert.deepEqual(await values(), compactState); assert.deepEqual((await snapshot()).panel.spec, compact); assert.equal((await snapshot()).history.length, 0);
  const compactContext = await validatePanelEditContext(await download('#download-edit-context', 'compact-edit.context.json'));
  assert.deepEqual(compactContext.spec, compact); const compactSaved = await validatePanelBundle(await download('#download-panel', 'compact-saved.panel.bundle.json'), core);
  assert.deepEqual(compactSaved.state, compactState); await healthy(); pass(stage, { duringDrag, afterPrepare, state: compactState });

  stage = 'compact-export-restores-semantic-state-through-visible-import';
  await upload('#panel-file', 'compact-saved.panel.bundle.json', compactSaved); await healthy();
  assert.deepEqual(await values(), compactState); assert.deepEqual((await snapshot()).panel, compactSaved);
  assert.equal((await findNode(`${compact.id}.body`)).value.y, 0, 'Scroll position is view state and is not included in PanelBundle');
  await screenshot('layout-workbench-offline.png'); pass(stage);
  assert.deepEqual(problems, []); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name ?? 'ACCEPTANCE_FAILED', message: String(error.message).slice(0, 1600) };
  if (page) try { await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png'); } catch {}
  process.exitCode = 1;
} finally {
  report.browserProblems = problems;
  for (const item of contexts) await item.close().catch(() => {});
  await browser?.close().catch(() => {}); await writeNewJson(directory, 'layout-workbench-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure ?? null })}\n`);
}
