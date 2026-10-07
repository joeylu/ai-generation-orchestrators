#!/usr/bin/env node
/** Visible native-Intent fixture regression. No model process is launched. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { controlId } from '../src/compiler.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { INPUT_STRESS_RECHECK_SUITE } from '../examples/input-stress-v2/suite.mjs';
import { ordinalFixture } from '../tests/ordinal-intent-fixture.mjs';
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) { assert(['--workbench', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
assert(options['--workbench'] && options['--output']);
const directory = await createOutputDirectory(options['--output']);
const report = { version: '0.1', status: 'RUNNING', modelCalls: 0, fixtureCalls: 0, checks: [], evidence: 'PROGRAMMATIC_NATIVE_INTENT_FIXTURES',
  nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN', scope: 'Visible Generate with native ordinal fixtures, real Pixi, reset and export/reimport. Not real-generation acceptance.' };
let server, browser, active;
const pass = (id, name) => report.checks.push({ id, name, status: 'PASS' });
try {
  server = await createWorkbenchServer({ workbench: options['--workbench'], outputRoot: resolve(directory, 'fixture-only'), port: 0,
    planner: async context => {
      assert(active && !active.used); assert.equal(context.request.id, active.item.id); assert.equal(context.request.text, active.item.request.text);
      active.used = true; report.fixtureCalls++;
      const proposal = await materializePanelIntent(context, ordinalFixture(compactIntentFixture(context, active.item)));
      assert.equal(evaluatePanelSemantics(proposal.spec, active.item.expected).status, 'PASS');
      const checked = await checkPanelProposal(context, proposal);
      return { proposal, report: checked, receipt: { codexPlanningReceiptVersion: '0.1', model: 'gpt-6-luna', effort: 'xhigh', contextSha256: context.sha256,
        proposalSha256: checked.proposalSha256, status: checked.status, failureCode: null, invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null } };
    }, editor: async () => { throw new Error('UNEXPECTED_EDIT'); } });
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' } });
  for (const item of INPUT_STRESS_RECHECK_SUITE.cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    const page = await context.newPage(), errors = []; page.setDefaultTimeout(25000); page.on('pageerror', () => errors.push('PAGE_ERROR'));
    const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
    try {
      active = { item, used: false }; await page.goto(server.url); await idle();
      await page.waitForFunction(() => document.getElementById('model-status').textContent.includes('gpt-6-luna'));
      await page.locator('#panel-menu > summary').click(); await page.locator('#advanced-tools').click();
      await page.locator('#request-id').locator('xpath=..').evaluate(node => { if (node.tagName === 'DETAILS') node.open = true; });
      await page.locator('#request-id').fill(item.id); await page.locator('#request-text').fill(item.request.text); await page.locator('#advanced-tools').click();
      await page.locator('#generate-plan').click(); await idle(); assert(active.used);
      const bundle = (await page.evaluate(() => window.panelWorkbench.snapshot())).panel;
      assert(bundle?.spec); assert.equal(evaluatePanelSemantics(bundle.spec, item.expected).status, 'PASS'); pass(item.id, 'visible-generation-independent-semantics');
      const rows = bundle.spec.sections.flatMap(section => section.rows);
      assert.deepEqual(rows.map(row => row.id), rows.map((_, i) => `row${i}`)); pass(item.id, 'global-unique-identities');
      const canvas = page.locator('#canvas-host canvas'); assert(await canvas.isVisible()); pass(item.id, 'pixi-canvas-visible');
      const button = rows.find(row => row.action?.kind === 'reset-initial');
      if (button) {
        await canvas.scrollIntoViewIfNeeded(); await canvas.focus();
        const focus = async id => { for (let n = 0; n < 140; n++) { if (await canvas.getAttribute('data-focused-component') === controlId(bundle.spec.id, id)) return; await page.keyboard.press('Tab'); } throw new Error('FOCUS_UNREACHABLE'); };
        const toggle = rows.find(row => row.kind === 'switch');
        if (toggle) { await focus(toggle.id); await page.keyboard.press('Enter'); }
        await focus(button.id); await page.keyboard.press('Enter');
        const state = await page.evaluate(() => window.panelWorkbench.getState());
        for (const id of button.action.fields) assert.equal(state[id], bundle.spec.state.find(field => field.id === id).initial);
        pass(item.id, 'keyboard-reset-scope');
      }
      if (!await page.locator('#panel-menu').evaluate(node => node.open)) await page.locator('#panel-menu > summary').click();
      const event = page.waitForEvent('download'); await page.locator('#download-panel').click(); const download = await event, path = await download.path(); assert(path);
      await page.locator('#panel-file').setInputFiles(path); await idle();
      assert.deepEqual((await page.evaluate(() => window.panelWorkbench.snapshot())).panel.spec, bundle.spec); pass(item.id, 'download-reimport-spec');
      await page.setViewportSize({ width: 390, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); pass(item.id, 'narrow-page-no-horizontal-overflow');
      assert.deepEqual(errors, []); pass(item.id, 'no-browser-errors'); await page.screenshot({ path: resolve(directory, `${item.id}.png`), fullPage: true });
    } finally { await context.close(); }
  }
  assert.equal(report.fixtureCalls, 3); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failure = { code: error.code ?? error.name, message: String(error.message).slice(0, 600) }; process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {}); await server?.close().catch(() => {}); await writeNewJson(directory, 'browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, fixtureCalls: report.fixtureCalls, modelCalls: 0, failure: report.failure ?? null })}\n`);
}
