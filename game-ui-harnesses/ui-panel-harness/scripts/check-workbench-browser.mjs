#!/usr/bin/env node
/** Real visible-UI acceptance; routes static bytes in Playwright and starts no server. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { validatePanelEditContext } from '../src/edit-planning.mjs';
import { proposalTargets } from '../src/proposal.mjs';
import { validateWorkbenchAssetPool, verifyWorkbenchContextPool } from '../src/workbench-assets.mjs';
import { controlId, initialPanelState } from '../src/compiler.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--workbench', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Expected --workbench and --output exactly once');
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 2, 'Required: --workbench <static directory> --output <fresh directory>');
const directory = await createOutputDirectory(options['--output']);
const report = { version: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  scope: 'Visible static workbench UI with real Pixi and offline asset pool; no server started; only read-only acceptance probes',
  humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
const pass = (name, evidence = {}) => report.checks.push({ name, status: 'PASS', ...evidence });
const origin = 'http://127.0.0.1:4183';
let browser, context, page, stage = 'validate-static-build';
const problems = [];
try {
  const core = await loadWorkspaceCore(), manifest = await readJson(resolve(options['--workbench'], 'workbench-build.json'));
  assert.equal(manifest.workbenchBuildVersion, '0.1'); assert.equal(manifest.status, 'COMPLETE');
  assert.deepEqual(manifest.files.map(file => file.path).sort(), ['index.html', 'workbench.js']);
  const files = new Map();
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(options['--workbench'], file.path));
    assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256);
    files.set(`/${file.path}`, bytes);
  }
  const match = files.get('/index.html').toString('utf8').match(/<script id="workbench-seed" type="application\/json">([\s\S]*?)<\/script>/u);
  assert(match, 'Static HTML must embed its seed');
  const seed = JSON.parse(match[1]);
  assert.equal(seed.workbenchSeedVersion, '0.1'); assert(seed.example && seed.pool, 'Acceptance fixture needs an example and full pool');
  const pool = await validateWorkbenchAssetPool(seed.pool);
  assert.equal(pool.sha256, manifest.poolSha256); assert.equal(pool.index.records.length, manifest.recordCount);
  assert.equal(await digestJson(seed.catalog), manifest.catalogSha256);
  await verifyWorkbenchContextPool(seed.example.context, pool);
  report.build = manifest; pass(stage, { recordCount: manifest.recordCount, embeddedPngs: pool.resources.length });

  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const values = () => page.evaluate(() => window.panelWorkbench.getState());
  const inspect = () => page.evaluate(() => window.panelWorkbench.inspect());
  const events = () => page.evaluate(() => window.panelWorkbench.events());
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const healthy = async () => {
    assert.deepEqual(problems, [], 'No unexpected browser errors or network requests');
    for (const id of ['request-error', 'proposal-error', 'clarification-error', 'edit-plan-error', 'edit-error', 'preview-error'])
      assert.equal((await page.locator(`#${id}`).textContent()).trim(), '', `${id} must be empty`);
  };
  const screenshot = async (name, canvas = false) => {
    if (canvas) await page.locator('#canvas-host canvas').screenshot({ path: resolve(directory, name) });
    else await page.screenshot({ path: resolve(directory, name), fullPage: true });
    report.screenshots.push(name);
  };
  const open = async (offlineFile = false) => {
    context = await browser.newContext({ viewport: { width: 1560, height: 1100 }, serviceWorkers: 'block', acceptDownloads: true });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (!offlineFile && url.origin === origin && url.pathname === '/api/panel/capabilities')
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ protocol: '0.1', model: 'gpt-6-luna', effort: 'xhigh', available: false }) });
      if (!offlineFile && url.origin === origin && files.has(url.pathname) && !url.search)
        return route.fulfill({ body: files.get(url.pathname), contentType: url.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
      if (['data:', 'blob:'].includes(url.protocol) || (offlineFile && url.protocol === 'file:')) return route.continue();
      problems.push('Unexpected external or unlisted browser request'); return route.abort();
    });
    if (offlineFile) await context.setOffline(true);
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', () => problems.push('Uncaught browser exception'));
    page.on('console', entry => { if (entry.type() === 'error') problems.push('Browser console error'); });
    page.on('requestfailed', () => problems.push('Browser resource request failed'));
    await page.goto(`${offlineFile ? pathToFileURL(resolve(options['--workbench'], 'index.html')).href : `${origin}/index.html`}#advanced`);
    await idle(); await healthy();
  };
  const click = async selector => { await page.locator(selector).click(); await idle(); };
  const upload = async (selector, name, value) => {
    await page.locator(selector).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await idle();
  };
  const download = async (selector, name) => {
    const waiting = page.waitForEvent('download'); await page.locator(selector).click();
    const file = await waiting; assert.equal(await file.failure(), null);
    await file.saveAs(resolve(directory, name)); await idle();
    return readJson(resolve(directory, name));
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
    const p = await point(item.bounds, spec);
    await page.mouse.click(p.x + item.bounds.width * p.sx / 2, p.y + item.bounds.height * p.sy / 2);
  };
  const choose = async (spec, row, optionId) => {
    await clickRow(spec, row);
    const item = await node(spec, row), field = spec.state.find(field => field.id === row.bind), bounds = item.popupBounds;
    assert(item.popupOpen && bounds, 'Select popup must open');
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= spec.canvas.width + 1 && bounds.y + bounds.height <= spec.canvas.height + 1);
    const index = field.options.findIndex(option => option.id === optionId); assert(index >= 0);
    const p = await point(bounds, spec);
    await page.mouse.click(p.x + bounds.width * p.sx / 2, p.y + (index + .5) * bounds.height * p.sy / field.options.length);
    assert.equal((await values())[row.bind], optionId); assert.equal((await node(spec, row)).popupOpen, false);
  };

  stage = 'initial-empty-state'; await open();
  assert.equal((await snapshot()).phase, 'empty'); assert.equal((await snapshot()).panel, null);
  assert.equal(await page.locator('#canvas-host canvas').count(), 0);
  assert.equal(await page.locator('#download-panel').isDisabled(), true);
  assert.equal(await page.locator('#accept-proposal').isDisabled(), true);
  assert.equal(await page.locator('#library-badge').textContent(), `${manifest.recordCount} 项自有资源 · 离线库`);
  pass(stage);

  stage = 'example-real-planning-and-compilation'; await click('#example'); await healthy();
  const original = await snapshot(), spec = original.panel.spec, rows = spec.sections.flatMap(section => section.rows);
  assert.equal(original.phase, 'ready'); assert.equal(original.panel.sha256, manifest.example.panelSha256);
  await validatePanelBundle(original.panel, core); assert.deepEqual(await values(), initialPanelState(spec));
  assert.equal((await inspect()).resources, original.panel.componentBundle.resources.length);
  assert.equal(original.context.assetRetrieval.candidates.length, await page.locator('#candidates .candidate').count());
  assert.equal(original.assetEvidence.sourceReplay, 'NOT_RUN');
  assert(JSON.parse(await page.locator('#evidence-output').textContent()).originalProposalAssetEvidence);
  const slider = rows.find(row => row.kind === 'slider' && row.id === 'volume-row'), select = rows.find(row => row.kind === 'select');
  const reset = rows.find(row => row.kind === 'button' && row.action.kind === 'reset-initial');
  assert(slider && select && reset);
  await screenshot('studio-initial.png'); await screenshot('panel-initial.png', true);
  pass(stage, { panelSha256: original.panel.sha256, candidateCount: original.context.assetRetrieval.candidates.length });

  stage = 'mouse-select-updates-live-state';
  const quality = spec.state.find(field => field.id === select.bind), selected = quality.options.find(option => option.id !== quality.initial).id;
  await choose(spec, select, selected);
  const live = await values(); assert.equal(live[select.bind], selected);
  assert.deepEqual((await events()).at(-1), { name: select.event, fieldId: select.bind, value: selected, source: 'mouse' });
  pass(stage, { state: live });

  stage = 'form-edits-preserve-live-state-and-undo';
  await page.locator('#edit-title').fill('工作台修改后的设置'); await page.locator('#edit-row').selectOption(slider.id);
  await page.locator('#edit-label').fill('主音量'); await click('#apply-edit'); await healthy();
  let edited = await snapshot(); assert.equal(edited.panel.spec.title, '工作台修改后的设置');
  assert.equal(edited.panel.spec.sections.flatMap(section => section.rows).find(row => row.id === slider.id).label, '主音量');
  assert.deepEqual(await values(), live); assert.equal(edited.history.length, 1);
  assert.deepEqual(edited.assetEvidence, original.assetEvidence, 'Original proposal evidence remains historical');
  pass(stage, { state: live, history: edited.history.length });

  stage = 'render-overflow-failure-is-atomic';
  await page.locator('#edit-title').fill('宽'.repeat(120)); await click('#apply-edit');
  assert((await page.locator('#edit-error').textContent()).trim(), 'Real measured text overflow must be reported');
  const afterOverflow = await snapshot();
  assert.equal(afterOverflow.panel.sha256, edited.panel.sha256, 'Renderer failure must not commit the proposed panel');
  assert.deepEqual(afterOverflow.history, edited.history, 'Renderer failure must not append undo history');
  assert.deepEqual(await values(), live, 'Renderer failure must preserve live interaction state');
  assert.equal(await page.locator('#canvas-host canvas').count(), 1, 'Last successful canvas must remain');
  assert.equal(await page.locator('#download-panel').isDisabled(), false);
  assert.equal(await page.locator('#edit-title').isDisabled(), false); assert.equal(await page.locator('#undo').isDisabled(), false);
  const afterFailureExport = await validatePanelBundle(await download('#download-panel', 'after-render-failure.panel.bundle.json'), core);
  assert.equal(afterFailureExport.sha256, edited.panel.sha256); assert.deepEqual(afterFailureExport.state, live);
  pass(stage, { panelSha256: edited.panel.sha256, oldPreviewPreserved: true });

  stage = 'undo-restores-panel-and-live-state';
  await click('#undo'); await healthy();
  assert.equal((await snapshot()).panel.spec.title, spec.title); assert.deepEqual(await values(), live);
  assert.equal((await snapshot()).history.length, 0); pass(stage);

  stage = 'authored-default-change-and-real-reset';
  const number = spec.state.find(field => field.id === slider.bind), replacement = number.initial === number.min ? number.max : number.min;
  await page.locator('#edit-row').selectOption(slider.id); await page.locator('#edit-initial').fill(String(replacement));
  await click('#apply-edit'); await healthy(); edited = await snapshot();
  assert.equal(edited.panel.spec.state.find(field => field.id === slider.bind).initial, replacement);
  assert.deepEqual(await values(), live, 'Authored defaults do not overwrite live values');
  await clickRow(edited.panel.spec, reset); const defaults = initialPanelState(edited.panel.spec);
  assert.deepEqual(await values(), defaults);
  assert.deepEqual((await events()).at(-1), { name: reset.event, rowId: reset.id, action: 'reset-initial', state: defaults, source: 'mouse' });
  pass(stage, { state: defaults });

  stage = 'export-valid-live-panel';
  await choose(edited.panel.spec, select, selected); const savedValues = await values();
  const exported = await validatePanelBundle(await download('#download-panel', 'exported.panel.bundle.json'), core);
  assert.deepEqual(exported.state, savedValues); assert.equal(exported.spec.state.find(field => field.id === slider.bind).initial, replacement);
  pass(stage, { panelSha256: exported.sha256, state: exported.state });

  stage = 'fresh-page-file-import'; await context.close(); await open();
  await upload('#panel-file', 'exported.panel.bundle.json', exported); await healthy();
  assert.equal((await snapshot()).panel.sha256, exported.sha256); assert.deepEqual(await values(), savedValues);
  assert.equal((await snapshot()).context, null); assert.equal(await page.locator('#undo').isDisabled(), true); pass(stage);

  stage = 'prepare-exact-new-request-and-download';
  const requestText = `${seed.example.context.request.text}\n本次为离线工作台验收，保持上述控件定义。\n`;
  await page.locator('#request-text').fill(requestText);
  await page.locator('details').filter({ has: page.locator('#request-id') }).locator('summary').click();
  await page.locator('#request-id').fill('workbench-roundtrip'); await click('#prepare'); await healthy();
  let contextDocument = await validatePlanningContext(await download('#download-context', 'planning-context.json'));
  assert.equal(contextDocument.request.text, requestText); assert.equal(contextDocument.request.id, 'workbench-roundtrip');
  await verifyWorkbenchContextPool(contextDocument, pool);
  assert.equal((await snapshot()).panel.sha256, exported.sha256); assert.deepEqual(await values(), savedValues);
  pass(stage, { contextSha256: contextDocument.sha256, originalTextPreserved: true });

  stage = 'wrong-context-proposal-preserves-preview';
  await upload('#proposal-file', 'wrong-context.proposal.json', seed.example.proposal);
  assert.match(await page.locator('#proposal-error').textContent(), /另一份需求/u);
  assert.equal((await snapshot()).panel.sha256, exported.sha256); assert.deepEqual(await values(), savedValues); pass(stage);

  stage = 'needs-input-preserves-preview';
  await upload('#proposal-file', 'questions.proposal.json', { proposalVersion: contextDocument.planningContextVersion,
    contextSha256: contextDocument.sha256, spec: null, decisions: [], unresolved: [{ id: 'review', question: '请确认恢复默认包含哪些字段？' }] });
  await healthy(); assert.equal((await snapshot()).phase, 'needs-input');
  assert.equal(await page.locator('#questions li').textContent(), '请确认恢复默认包含哪些字段？');
  assert.equal((await snapshot()).panel.sha256, exported.sha256); assert.deepEqual(await values(), savedValues); pass(stage);

  stage = 'incomplete-answers-keep-questions-and-preview';
  const questionProposal = (await snapshot()).proposal;
  await click('#clarify');
  assert.match(await page.locator('#clarification-error').textContent(), /逐项/u);
  assert.equal((await snapshot()).context.sha256, contextDocument.sha256);
  assert.equal((await snapshot()).phase, 'needs-input');
  assert.deepEqual(await values(), savedValues); pass(stage);

  stage = 'answers-retrieve-new-context-without-replacing-panel';
  const answer = 'volume、muted、quality 全部恢复到创作初值。';
  await page.locator('#clarification-answer-0').fill(answer);
  await screenshot('studio-clarification.png');
  await click('#clarify'); await healthy();
  const oldContext = contextDocument;
  contextDocument = await validatePlanningContext(await download('#download-context', 'clarified-context.json'));
  assert(contextDocument.request.text.startsWith(oldContext.request.text)); assert(contextDocument.request.text.includes(answer));
  assert.notEqual(contextDocument.sha256, oldContext.sha256);
  await verifyWorkbenchContextPool(contextDocument, pool);
  assert.equal((await snapshot()).phase, 'awaiting-proposal'); assert.equal((await snapshot()).proposal, null);
  assert.equal(await page.locator('#clarification-form').isVisible(), false);
  assert.equal((await snapshot()).panel.sha256, exported.sha256); assert.deepEqual(await values(), savedValues);
  pass(stage, { contextSha256: contextDocument.sha256, oldPreviewRetained: true });

  stage = 'old-proposal-rejected-after-answering';
  await upload('#proposal-file', 'stale-questions.proposal.json', questionProposal);
  assert.match(await page.locator('#proposal-error').textContent(), /另一份需求/u);
  assert.equal((await snapshot()).phase, 'awaiting-proposal'); assert.deepEqual(await values(), savedValues); pass(stage);

  const proposal = { proposalVersion: contextDocument.planningContextVersion, contextSha256: contextDocument.sha256,
    spec: structuredClone(spec), unresolved: [], decisions: proposalTargets(spec, contextDocument.planningContextVersion).map(target => ({ target,
      basis: { kind: 'request-interpretation', start: 0, end: contextDocument.request.text.length, quote: contextDocument.request.text } })) };
  stage = 'candidate-membership-required';
  const keys = new Set(contextDocument.assetRetrieval.candidates.map(candidate => candidate.asset.key));
  const unavailable = pool.index.records.find(record => record.metadata.role === 'icon' && !keys.has(record.key)); assert(unavailable);
  const invalid = structuredClone(proposal); invalid.spec.assets.rowIcons[0].asset = unavailable.key;
  await upload('#proposal-file', 'outside-candidates.proposal.json', invalid);
  assert.match(await page.locator('#proposal-error').textContent(), /候选列表以外/u);
  assert.equal((await snapshot()).panel.sha256, exported.sha256); pass(stage);

  stage = 'external-proposal-file-real-compilation';
  await upload('#proposal-file', 'valid.proposal.json', proposal); await healthy();
  const accepted = await snapshot(); assert.equal(accepted.phase, 'ready'); assert.equal(accepted.context.sha256, contextDocument.sha256);
  assert.equal(accepted.panel.sha256, original.panel.sha256); assert.deepEqual(await values(), initialPanelState(spec));
  assert.equal(accepted.history.length, 0); assert.equal(await page.locator('#questions li').count(), 0); pass(stage);

  const editProposal = (context, operations) => ({ editProposalVersion: '0.1', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Explicit browser editing fixture; no model call.', operations },
    decisions: operations.map((_, operationIndex) => ({ operationIndex,
      basis: { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } })), unresolved: [] });
  stage = 'prepare-natural-language-edit-context';
  await choose(spec, select, selected); const beforeEditValues = await values();
  const editText = '把音量标签改为总音量，默认值改为40，其他设置不变。';
  await page.locator('#edit-request-text').fill(editText); await click('#prepare-edit-context'); await healthy();
  const firstEdit = await validatePanelEditContext(await download('#download-edit-context', 'edit-context.json'));
  assert.deepEqual(firstEdit.spec, accepted.panel.spec); assert.equal(Object.hasOwn(firstEdit, 'state'), false);
  assert.equal(firstEdit.request.text, editText); assert.deepEqual(await values(), beforeEditValues); pass(stage);

  stage = 'unresolved-edit-preserves-panel';
  await upload('#edit-proposal-file', 'edit-questions.json', { editProposalVersion: '0.1', contextSha256: firstEdit.sha256,
    patch: null, decisions: [], unresolved: [{ id: 'meaning', question: '默认值是否只影响恢复默认？' }] });
  await healthy(); assert.equal(await page.locator('#edit-questions li').textContent(), '默认值是否只影响恢复默认？');
  assert.equal((await snapshot()).panel.sha256, accepted.panel.sha256); assert.deepEqual(await values(), beforeEditValues); pass(stage);

  stage = 'changed-edit-request-rejects-old-proposal';
  const operations = [{ op: 'set-row-label', rowId: slider.id, label: '总音量' }, { op: 'set-state-initial', fieldId: slider.bind, value: 40 }];
  await page.locator('#edit-request-text').fill(`${editText}默认值只用于恢复默认，保留试玩值。`);
  assert.equal(await page.locator('#edit-proposal-file').isDisabled(), true);
  assert.equal(await page.locator('#download-edit-context').isDisabled(), true);
  await click('#prepare-edit-context'); await healthy();
  const secondEdit = await validatePanelEditContext(await download('#download-edit-context', 'edit-context-revised.json'));
  assert.notEqual(firstEdit.sha256, secondEdit.sha256);
  await upload('#edit-proposal-file', 'stale-edit.json', editProposal(firstEdit, operations));
  assert.match(await page.locator('#edit-plan-error').textContent(), /不匹配/u); assert.deepEqual(await values(), beforeEditValues); pass(stage);

  stage = 'apply-edit-proposal-preserves-unmentioned-controls-and-live-values';
  await upload('#edit-proposal-file', 'edit-proposal.json', editProposal(secondEdit, operations)); await healthy();
  const editApplied = await snapshot(), editedRows = editApplied.panel.spec.sections.flatMap(s => s.rows);
  assert.equal(editedRows.find(row => row.id === slider.id).label, '总音量');
  assert.equal(editApplied.panel.spec.state.find(field => field.id === slider.bind).initial, 40);
  assert.deepEqual(editedRows.filter(row => row.id !== slider.id), rows.filter(row => row.id !== slider.id));
  assert.deepEqual(await values(), beforeEditValues); assert.equal(editApplied.history.length, 1);
  assert.equal(editApplied.history[0].editEvidence.context.sha256, secondEdit.sha256);
  assert.equal(await page.locator('#edit-proposal-file').isDisabled(), true);
  const editedExport = await validatePanelBundle(await download('#download-panel', 'agent-edited.panel.bundle.json'), core);
  assert.deepEqual(editedExport.state, beforeEditValues); await screenshot('studio-agent-edit.png'); pass(stage);

  stage = 'edit-proposal-render-failure-retains-old-panel-and-context';
  await page.locator('#edit-request-text').fill('把标题改为用于溢出测试的长标题。'); await click('#prepare-edit-context');
  const overflowEdit = await validatePanelEditContext(await download('#download-edit-context', 'overflow-edit-context.json'));
  await upload('#edit-proposal-file', 'overflow-edit.json', editProposal(overflowEdit, [{ op: 'set-panel-title', title: '宽'.repeat(120) }]));
  assert.match(await page.locator('#edit-plan-error').textContent(), /文字超出/u);
  assert.equal((await snapshot()).panel.sha256, editApplied.panel.sha256); assert.deepEqual(await values(), beforeEditValues);
  assert.equal(await page.evaluate(() => window.panelWorkbench.editSnapshot().context.sha256), overflowEdit.sha256); pass(stage);

  stage = 'undo-natural-language-edit-restores-original-spec-and-live-values';
  await clickRow(editApplied.panel.spec, reset); assert.equal((await values())[slider.bind], 40);
  await click('#undo'); await healthy();
  assert.deepEqual((await snapshot()).panel.spec, accepted.panel.spec); assert.deepEqual(await values(), beforeEditValues);
  assert.equal((await snapshot()).history.length, 0); pass(stage);
  await click('#example'); await healthy();

  stage = 'failed-json-patch-preserves-panel';
  await page.locator('details').filter({ has: page.locator('#patch-json') }).locator('summary').click();
  await page.locator('#patch-json').fill(JSON.stringify({ patchVersion: '0.1', baseSpecSha256: '0'.repeat(64), reason: 'Explicit stale patch acceptance fixture.',
    operations: [{ op: 'set-panel-title', title: '不应应用' }] }));
  await click('#apply-json-patch'); assert.match(await page.locator('#edit-error').textContent(), /旧版面板/u);
  assert.equal((await snapshot()).panel.sha256, accepted.panel.sha256); assert.deepEqual(await values(), initialPanelState(spec)); pass(stage);

  stage = 'dirty-request-disables-stale-context';
  await page.locator('#request-text').fill(`${requestText}增加一条待规划需求。`);
  assert.equal(await page.locator('#accept-proposal').isDisabled(), true); assert.equal(await page.locator('#proposal-file').isDisabled(), true);
  assert.equal(await page.locator('#download-context').isDisabled(), true); assert.equal((await snapshot()).panel.sha256, accepted.panel.sha256); pass(stage);

  stage = 'keyboard-controls-reachable';
  await page.locator('#canvas-host canvas').focus();
  for (let count = 0; count < rows.length + 2 && await page.locator('#canvas-host canvas').getAttribute('data-focused-component') !== controlId(spec.id, select.id); count++) await page.keyboard.press('Tab');
  assert.equal(await page.locator('#canvas-host canvas').getAttribute('data-focused-component'), controlId(spec.id, select.id));
  await page.keyboard.press('ArrowUp');
  assert.equal((await values())[select.bind], quality.options[quality.options.findIndex(option => option.id === quality.initial) - 1].id);
  assert.equal((await events()).at(-1).source, 'keyboard'); pass(stage);

  stage = 'mobile-layout-without-horizontal-overflow';
  await page.setViewportSize({ width: 375, height: 900 });
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, body: document.body.scrollWidth, root: document.documentElement.scrollWidth }));
  assert(widths.body <= widths.viewport + 1 && widths.root <= widths.viewport + 1, '375px page must not overflow horizontally');
  await screenshot('studio-mobile.png'); await screenshot('panel-mobile.png', true); pass(stage, widths);

  stage = 'file-offline-example-smoke'; await context.close(); await open(true);
  await click('#example'); await healthy(); assert.equal((await snapshot()).panel.sha256, original.panel.sha256);
  await choose(spec, select, selected); await clickRow(spec, reset); assert.deepEqual(await values(), initialPanelState(spec));
  await screenshot('studio-offline.png'); pass(stage, { scheme: 'file', network: 'OFFLINE', interactions: ['example', 'select', 'reset'] });

  stage = 'mounted-context-loss-after-rejected-render';
  const beforeContextLoss = await snapshot();
  await page.locator('#edit-title').fill('宽'.repeat(120)); await click('#apply-edit');
  assert((await page.locator('#edit-error').textContent()).trim(), 'Candidate render must fail before testing the retained canvas');
  assert.equal((await snapshot()).panel.sha256, beforeContextLoss.panel.sha256);
  assert.equal(await page.locator('#download-panel').isDisabled(), false);
  // Explicit real GPU fault injection. No application/model mutation is called.
  const injected = await page.locator('#canvas-host canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext(); return true;
  });
  assert.equal(injected, true, 'Software WebGL must expose real context-loss injection');
  await page.waitForFunction(() => document.getElementById('preview-error').textContent.trim().length > 0);
  assert.equal(await page.locator('#download-panel').isDisabled(), true, 'Context loss must disable panel export');
  assert.equal(await page.locator('#edit-title').isDisabled(), true, 'Context loss must disable the actual editor inputs');
  const failedPreview = await snapshot();
  assert.equal(failedPreview.panel.sha256, beforeContextLoss.panel.sha256);
  assert.deepEqual(failedPreview.history, beforeContextLoss.history);
  assert.deepEqual(failedPreview.panel.state, beforeContextLoss.panel.state, 'Context loss must not mutate the authored model state');
  await click('#example'); await healthy();
  assert.equal((await snapshot()).panel.sha256, original.panel.sha256); assert.deepEqual(await values(), initialPanelState(spec));
  assert.equal(await page.locator('#download-panel').isDisabled(), false);
  assert.equal(await page.locator('#edit-title').isDisabled(), false);
  pass(stage, { fault: 'WEBGL_lose_context', retainedModel: true, recovery: 'Visible example reload', consoleErrorsExempted: 0 });
  assert.deepEqual(problems, []); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name ?? 'ACCEPTANCE_FAILED', message: String(error.message).slice(0, 1600) };
  if (page) try { await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png'); } catch {}
  process.exitCode = 1;
} finally {
  report.browserProblems = problems;
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  await writeNewJson(directory, 'workbench-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, failedStage: report.failure?.stage ?? null })}\n`);
}
