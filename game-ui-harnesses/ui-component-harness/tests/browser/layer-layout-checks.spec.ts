import { expect, test } from '@playwright/test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layerLayoutFixture } from '../helpers/layer-layout-fixture.ts';
import { layerPlanningInput, validateLayerProposal } from '../../src/layer-auto-dag.ts';
import { compileLayerComponents } from '../../src/layer-component.ts';
import { createCodexLayerPlanner, collectCodexLayerPlan } from '../../scripts/studio-codex-plan.mjs';
import { fixtureFindings, fixtureProceduralAdaptations } from '../helpers/layer-planning-fixture.ts';
import { fixtureStyle } from '../../src/fixtures.ts';

for (const evasion of ['lower-gap', 'hide-target'] as const) test(`actual Pixi gap feedback rejects ${evasion} using one request and three same-session corrections`, async ({ page, baseURL }) => {
  test.setTimeout(65000);
  const fixture = await layerLayoutFixture(), directory = await mkdtemp(join(tmpdir(), 'layer-layout-browser-'));
  const lowered = structuredClone(fixture.proposal); lowered.plan.layoutChecks!.separations[1].minGap = 0;
  if (evasion === 'hide-target') {
    lowered.plan.layoutChecks = structuredClone(fixture.proposal.plan.layoutChecks);
    const count = lowered.plan.document.root.children.pop()!;
    lowered.plan.document.root.children.push({ id: 'hidden-dialog', type: 'Dialog', layout: { x: 0, y: 0, width: 200, height: 100 },
      props: { open: false, title: 'Fixture', modal: false, style: { ...fixtureStyle, fontSize: 12 } }, children: [count] });
    lowered.plan.adaptations = fixtureProceduralAdaptations(lowered.plan.document);
    lowered.findings = fixtureFindings(lowered.plan.document);
  }
  const proposals = [fixture.proposal, lowered, fixture.proposal, fixture.corrected];
  const sessionId = '019aaaaa-1234-7000-8000-000000000004';
  let turns = 0, requests = 0, forbidden = 0; const prompts: string[] = [];
  const spawnProcess = (_exe: string, args: string[]) => {
    const round = turns++; expect(round).toBeLessThan(4);
    expect(args.includes('resume')).toBe(round > 0); if (round > 0) expect(args).toContain(sessionId);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.emit('close', null); } });
    prompts[round] = ''; child.stdin.on('data', part => prompts[round] += part.toString());
    child.stdin.once('finish', () => {
      const { plan, ...envelope } = proposals[round]; const text = JSON.stringify({ ...envelope, planJson: JSON.stringify(plan) });
      const trace = [{ type: 'thread.started', thread_id: sessionId }, { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text } }, { type: 'turn.completed' }];
      void writeFile(args[args.indexOf('--output-last-message') + 1], text)
        .then(() => { child.stdout.write(trace.map(event => JSON.stringify(event)).join('\n')); child.emit('close', 0); });
    });
    return child;
  };
  const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
    spawnProcess, checkAuthentication: async () => true });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname !== '/api/ui-layer-plan') { forbidden++; return route.abort(); }
    requests++; const result = await planner.planRun(fixture.bytes, { origin: baseURL });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '2.0', ...result }) });
  });
  try {
    await page.goto('/');
    await page.locator('#layer-archive').setInputFiles({ name: 'synthetic.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
    await page.locator('#layer-auto').click();
    await page.waitForFunction(() => window.uiStudio?.snapshot().ready, undefined, { timeout: 55000 });
    await expect(page.locator('#layer-auto-status')).toContainText('实际修正 3/3 次');
    const run = join(directory, (await readdir(directory))[0]);
    const first = JSON.parse(await readFile(join(run, 'turn-0/render.json'), 'utf8'));
    expect(first.code).toBe('LAYER_PLAN_LAYOUT_GAP'); expect(first.layoutChecks.status).toBe('repairable');
    expect(first.layoutChecks.checks.find((item: any) => item.id === 'name-count').actualGap).toBeLessThan(4);
    expect(first.issues[0].message).toContain('required 4px'); expect(first.forbiddenRequests).toBe(0);
    expect((await readFile(join(run, 'turn-0/render.png'))).length).toBeGreaterThan(100);
    expect(prompts[1]).toContain('actualGap'); expect(prompts[1]).toContain('firstBounds');
    const weakened = JSON.parse(await readFile(join(run, 'turn-1/check.json'), 'utf8'));
    expect(weakened.feedback.code).toBe('LAYER_PLAN_LAYOUT_CHECKS_WEAKENED');
    expect(weakened.feedback.requiredLayoutChecks).toEqual(fixture.proposal.plan.layoutChecks);
    const final = JSON.parse(await readFile(join(run, 'turn-3/render.json'), 'utf8'));
    expect(final.status).toBe('pass'); expect(final.layoutChecks.checks.every((item: any) => item.status === 'pass')).toBe(true);
    const collected = await collectCodexLayerPlan(fixture.bytes, run);
    expect(collected.receipt.corrections).toBe(3); expect(collected.receipt.modelDispatches).toBe(0);
    const saved = await page.evaluate(() => window.uiStudio!.exportSelected());
    expect(saved.layerSource?.plan.layoutChecks).toEqual(fixture.corrected.plan.layoutChecks);
    expect(Buffer.from(saved.layerSource!.base64, 'base64')).toEqual(Buffer.from(fixture.bytes));
    await page.locator('#open-bundle').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
    expect(requests).toBe(1); expect(turns).toBe(4); expect(forbidden).toBe(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('overlapping Bundle fails import with a layout message and clears previous successful output', async ({ page }) => {
  const fixture = await layerLayoutFixture(), input = await layerPlanningInput(fixture.bytes);
  const valid = await compileLayerComponents(fixture.bytes, await validateLayerProposal(fixture.bytes, input, fixture.corrected));
  const invalid = await compileLayerComponents(fixture.bytes, await validateLayerProposal(fixture.bytes, input, fixture.proposal));
  let requests = 0; await page.route('**/api/**', route => { requests++; return route.abort(); });
  await page.goto('/');
  await page.locator('#open-bundle').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(valid)) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  await page.locator('#open-bundle').setInputFiles({ name: 'overlap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('#studio-error')).toContainText('间距未达到方案要求');
  await expect(page.locator('#studio-error')).toHaveAttribute('data-error-detail', /LAYER_PLAN_LAYOUT_GAP: name-count/);
  await expect(page.locator('#studio-export')).toBeDisabled(); await expect(page.locator('#main-preview canvas')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiStudio?.snapshot().ready)).toBe(false); expect(requests).toBe(0);
});
