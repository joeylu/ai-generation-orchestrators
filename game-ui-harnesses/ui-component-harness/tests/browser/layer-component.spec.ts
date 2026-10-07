import { expect, test } from '@playwright/test';
import { layerComponentFixture } from '../helpers/layer-component-fixture.ts';
import { compileLayerComponents } from '../../src/layer-component.ts';
import { layerPlanningFixture } from '../helpers/layer-planning-fixture.ts';
import { layerPlanningInput, validateLayerProposal } from '../../src/layer-auto-dag.ts';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexLayerPlanner } from '../../scripts/studio-codex-plan.mjs';
import { fixtureRgbaPng } from '../helpers/decomposition-fixture.ts';
import { zip } from '../../src/reference-persistence.ts';
import { layerSha256 } from '../../src/layer-component.ts';
import { layerAdaptationFixture } from '../helpers/layer-adaptation-fixture.ts';

test('frozen source adaptation restores card art and dynamic progress through Studio export/reopen', async ({ page }) => {
  const fixture = await layerAdaptationFixture(); let requests = 0;
  await page.route('**/api/ui-vision**', route => route.abort());
  await page.route('**/api/ui-layer-plan', route => { requests++; return route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify(fixture.proposal) }); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'frozen.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('#layer-auto')).toBeEnabled(); await page.locator('#layer-auto').click();
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  await expect(page.locator('#layer-auto-issues')).toContainText('程序控件替代');
  await expect(page.locator('#layer-auto-issues')).toContainText('调整遮挡顺序');
  const sample = async () => {
    const screenshot = await page.locator('#main-preview canvas').screenshot();
    return page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 200, 100);
      return [[130, 40], [35, 35], [55, 35], [15, 25]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
    }, screenshot.toString('base64'));
  };
  expect(await sample()).toEqual([[230, 40, 40, 255], [0, 255, 0, 255], [240, 230, 200, 255], [0, 255, 0, 255]]);
  await page.evaluate(() => window.uiStudio!.setValue('progress', 0));
  expect((await sample()).slice(1, 3)).toEqual([[240, 230, 200, 255], [240, 230, 200, 255]]);
  await page.evaluate(() => window.uiStudio!.setValue('progress', 16));
  expect((await sample()).slice(1, 3)).toEqual([[0, 255, 0, 255], [0, 255, 0, 255]]);
  const saved = await page.evaluate(() => window.uiStudio!.exportSelected());
  expect(saved.layerSource?.plan.adaptations).toHaveLength(6);
  expect(Buffer.from(saved.layerSource!.base64, 'base64')).toEqual(Buffer.from(fixture.bytes));
  await page.locator('#open-bundle').setInputFiles({ name: 'adapted.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  expect((await sample()).slice(0, 3)).toEqual([[230, 40, 40, 255], [0, 255, 0, 255], [0, 255, 0, 255]]);
  expect(requests).toBe(1);
});

test('Studio displays bounded unresolved reasons and retains only the source for a later explicit decision', async ({ page }) => {
  const fixture = await layerPlanningFixture(); let requests = 0;
  await page.route('**/api/ui-layer-plan', route => { requests++; return route.fulfill({ status: 502, contentType: 'application/json',
    body: JSON.stringify({ error: 'LAYER_PLANNING_UNRESOLVED', diagnostic: { summary: '完整提案未生成。', issues: ['业务文字可读；图层绑定和逐节点证据尚未完成。'] } }) }); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'frozen.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('#layer-auto')).toBeEnabled(); await page.locator('#layer-auto').click();
  await expect(page.locator('#studio-error')).toContainText('完整提案未生成');
  await expect(page.locator('#studio-status')).toHaveText('组件方案未完成');
  await expect(page.locator('#layer-auto-issues')).toContainText('图层绑定和逐节点证据尚未完成');
  await expect(page.locator('#layer-archive-status')).toContainText('已保留');
  await expect(page.locator('#studio-export')).toBeDisabled(); await expect(page.locator('#main-preview canvas')).toHaveCount(0);
  expect(requests).toBe(1);
});

test('exhausted construction corrections show the concrete reason and retain source without exporting partial output', async ({ page }) => {
  const fixture = await layerPlanningFixture(); let requests = 0;
  await page.route('**/api/ui-layer-plan', async route => { requests++; await route.fulfill({ status: 502, contentType: 'application/json',
    body: JSON.stringify({ error: 'SESSION_CORRECTIONS_EXHAUSTED', diagnostic: {
      summary: '完整组件方案仍未生成。', issues: ['图层绑定与逐节点证据未完成。'], reason: 'construction-incomplete', missingInputs: [],
    } }) }); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'ui-layers.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('#layer-auto')).toBeEnabled(); await page.locator('#layer-auto').click();
  await expect(page.locator('#studio-error')).toContainText('已完成 3 次自动修正');
  await expect(page.locator('#studio-error')).toContainText('完整组件方案仍未生成');
  await expect(page.locator('#layer-auto-issues')).toContainText('图层绑定与逐节点证据未完成');
  await expect(page.locator('#layer-archive-status')).toContainText('已保留');
  await expect(page.locator('#studio-export')).toBeDisabled(); await expect(page.locator('#main-preview canvas')).toHaveCount(0);
  expect(requests).toBe(1);
});

for (const [code, message] of [
  ['SESSION_TIMEOUT_NO_RETRY', '超过 15 分钟'],
  ['SESSION_TRANSPORT_FAILED_NO_RETRY', '连接或响应流失败'],
]) test(`terminal ${code} displays its cause and clears component output without another request`, async ({ page }) => {
  const fixture = await layerPlanningFixture(); let requests = 0;
  await page.route('**/api/ui-layer-plan', route => { requests++; return route.fulfill({ status: 502,
    contentType: 'application/json', body: JSON.stringify({ error: code }) }); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'ui-layers.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('#layer-plan')).toBeEnabled();
  await page.locator('#layer-plan').setInputFiles({ name: 'manual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.plan)) });
  await page.locator('#layer-build').click(); await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  await page.locator('#layer-auto').click();
  await expect(page.locator('#studio-error')).toContainText(message);
  await expect(page.locator('#studio-error')).toContainText('未收到完整响应');
  await expect(page.locator('#studio-status')).toHaveText('组件方案未完成');
  await expect(page.locator('#studio-export')).toBeDisabled(); await expect(page.locator('#layer-plan-export')).toBeDisabled();
  await expect(page.locator('#main-preview canvas')).toHaveCount(0); expect(requests).toBe(1);
});

test('layer ZIP intake displays its authenticated preview pixels without publishing a component bundle', async ({ page }) => {
  const fixture = await layerComponentFixture();
  const previewColor = [210, 70, 110, 255] as const;
  const preview = fixtureRgbaPng(200, 100, previewColor);
  fixture.entries.set('preview.png', preview);
  const manifest = JSON.parse(new TextDecoder().decode(fixture.entries.get('manifest.json')));
  manifest.files['preview.png'] = { sha256: await layerSha256(preview), bytes: preview.length };
  fixture.entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  const bytes = zip(fixture.entries);
  let providerCalls = 0;
  await page.route('**/api/**', route => { providerCalls++; return route.abort(); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'preview.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  const canvas = page.locator('#main-preview canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#studio-status')).toHaveText('交付包预览已加载');
  await expect(canvas).toHaveAttribute('aria-label', '交付包 preview.png 预览');
  const screenshot = await canvas.screenshot();
  const color = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const sample = document.createElement('canvas'); sample.width = image.width; sample.height = image.height;
    const context = sample.getContext('2d')!; context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data);
  }, screenshot.toString('base64'));
  expect(color).toEqual([...previewColor]);
  expect(await page.evaluate(() => window.uiStudio!.snapshot().ready)).toBe(false);
  await expect(page.locator('#studio-export')).toBeDisabled();
  await expect(page.locator('#studio-compare')).toBeDisabled();
  await expect(page.locator('#studio-replay')).toBeDisabled();
  await expect(page.locator('#appearance-target')).toBeDisabled();
  await expect(page.locator('#layer-auto')).toBeEnabled();
  expect(await page.evaluate(() => window.uiStudio!.exportSelected().then(() => 'exported', error => error.message))).toBe('NO_READY_PREVIEW');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox(); expect(box!.width).toBeLessThanOrEqual(390);
  await page.locator('#layer-archive').setInputFiles({ name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid') });
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect(canvas).toHaveCount(0);
  await page.locator('#layer-archive').setInputFiles({ name: 'preview.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(canvas).toBeVisible();
  await page.locator('#studio-reset').click();
  await expect(canvas).toHaveCount(0);
  expect(providerCalls).toBe(0);
});

test('source-bound layer component bundle renders, activates and survives Studio export/reopen', async ({ page }) => {
  const fixture = await layerComponentFixture();
  const bundle = await compileLayerComponents(fixture.bytes, fixture.plan);
  let providerCalls = 0;
  await page.route('**/api/vision/**', route => { providerCalls++; return route.abort(); });
  await page.goto('/');
  await page.locator('#open-bundle').setInputFiles({ name: 'layer.ui-bundle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  const canvas = page.locator('#main-preview canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox(); if (!box) throw new Error('canvas missing');
  await page.mouse.click(box.x + 35 * box.width / 200, box.y + 35 * box.height / 100);
  await expect.poll(() => page.evaluate(() => window.uiStudio?.snapshot().views[0].activationCounts.action ?? 0)).toBe(1);
  const saved = await page.evaluate(() => window.uiStudio!.exportSelected());
  expect(saved.bundleVersion).toBe('0.4');
  expect(saved.layerSource?.sha256).toBe(fixture.plan.archiveSha256);
  expect(Buffer.from(saved.layerSource!.base64, 'base64')).toEqual(Buffer.from(fixture.bytes));
  await page.locator('#open-bundle').setInputFiles({ name: 'reopened.ui-bundle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  expect((await page.evaluate(() => window.uiStudio!.exportSelected())).layerSource?.sha256).toBe(fixture.plan.archiveSha256);
  expect(providerCalls).toBe(0);
});

test('Studio imports a layer ZIP plus explicit plan, builds a bundle and clears failed replacement', async ({ page }) => {
  const fixture = await layerComponentFixture();
  let providerCalls = 0;
  await page.route('**/api/vision/**', route => { providerCalls++; return route.abort(); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'ui-layers.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('#layer-archive-status')).toContainText(fixture.plan.archiveSha256);
  await expect(page.locator('#main-preview canvas')).toBeVisible();
  await expect(page.locator('#scheme-name')).toHaveText('交付包预览');
  await expect(page.locator('#studio-export')).toBeDisabled();
  await expect(page.locator('#layer-build')).toBeDisabled();
  await expect(page.locator('#layer-plan')).toBeEnabled();
  await page.locator('#layer-plan').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.plan)) });
  await expect(page.locator('#main-preview canvas')).toBeVisible();
  await page.locator('#layer-build').click();
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  await expect(page.locator('#main-preview canvas')).toBeVisible();
  const built = await page.evaluate(() => window.uiStudio!.exportSelected());
  await expect(page.locator('#main-preview canvas')).toHaveCount(1);
  await expect(page.locator('#scheme-name')).toHaveText('原样');
  expect(built.bundleVersion).toBe('0.4');
  expect(built.layerSource?.sha256).toBe(fixture.plan.archiveSha256);
  expect(Buffer.from(built.layerSource!.base64, 'base64')).toEqual(Buffer.from(fixture.bytes));
  const save = page.waitForEvent('download'); await page.locator('#studio-export').click();
  const saved = await save; expect(saved.suggestedFilename()).toContain('ui-layers');

  await page.locator('#layer-plan').setInputFiles({ name: 'stale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixture.plan, archiveSha256: '0'.repeat(64) })) });
  await page.locator('#layer-build').click();
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect(page.locator('#studio-export')).toBeDisabled();
  expect(await page.evaluate(() => window.uiStudio?.snapshot().ready)).toBe(false);
  expect(providerCalls).toBe(0);
});

test('Studio dispatches one complete session plan, never calls vision and clears unresolved replacement', async ({ page }) => {
  const fixture = await layerPlanningFixture();
  let requests = 0;
  let visionCalls = 0;
  await page.route('**/api/ui-vision**', route => { visionCalls++; return route.abort(); });
  let response: unknown = fixture.proposal;
  let releaseResponse!: () => void;
  const responseReady = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route('**/api/ui-layer-plan', async route => {
    requests++;
    const body = route.request().postDataJSON();
    expect(body.archive.sha256).toBe(fixture.plan.archiveSha256);
    expect(Buffer.from(body.archive.base64, 'base64')).toEqual(Buffer.from(fixture.bytes));
    await responseReady;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'ui-layers.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('#layer-auto')).toBeEnabled();
  await page.locator('#layer-auto').click();
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator('#main-preview canvas')).toBeVisible();
  await expect(page.locator('#scheme-name')).toHaveText('交付包预览');
  await expect(page.locator('#studio-export')).toBeDisabled();
  releaseResponse();
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  await expect(page.locator('#main-preview canvas')).toBeVisible();
  await expect(page.locator('#main-preview canvas')).toHaveCount(1);
  await expect(page.locator('#scheme-name')).toHaveText('原样');
  await expect(page.locator('#layer-auto-status')).toContainText('草稿待人工视觉复核');
  const bundle = await page.evaluate(() => window.uiStudio!.exportSelected());
  expect(bundle.bundleVersion).toBe('0.4');
  expect(bundle.layerSource?.plan.basis).toBe('model-proposed');
  expect(bundle.layerSource?.plan.planningEvidence?.referenceSha256).toBe(fixture.proposal.referenceSha256);
  await expect(page.locator('#layer-auto-issues')).toContainText('推断');
  expect(bundle.layerSource?.sha256).toBe(fixture.plan.archiveSha256);
  expect(requests).toBe(1);
  response = { ...fixture.proposal, status: 'Unresolved', plan: null, issues: ['Button text unreadable.'],
    reason: 'required-semantics-missing', missingInputs: [{ subject: 'Button', kind: 'unreadable-text', detail: 'The reference label is unreadable.' }] };
  await page.locator('#layer-auto').click();
  await expect(page.locator('#studio-error')).toBeVisible();
  await expect(page.locator('#studio-export')).toBeDisabled();
  expect(await page.evaluate(() => window.uiStudio?.snapshot().ready)).toBe(false);
  expect(requests).toBe(2);
  expect(visionCalls).toBe(0);
  await expect(page.locator('#layer-plan-export')).toBeDisabled();
});

test('missing Codex login clears old output and preserves the ZIP for an explicit later click', async ({ page }) => {
  const fixture = await layerPlanningFixture(); let requests = 0;
  await page.route('**/api/ui-vision**', route => route.abort());
  await page.route('**/api/ui-layer-plan', route => { requests++; return route.fulfill({ status: 502,
    contentType: 'application/json', body: JSON.stringify({ error: 'SESSION_NOT_AUTHENTICATED' }) }); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'ui-layers.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('#layer-plan')).toBeEnabled();
  await page.locator('#layer-plan').setInputFiles({ name: 'manual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.plan)) });
  await page.locator('#layer-build').click(); await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  await page.locator('#layer-auto').click();
  await expect(page.locator('#studio-error')).toContainText('codex login');
  await expect(page.locator('#layer-archive-status')).toContainText('已保留');
  await expect(page.locator('#layer-auto')).toBeEnabled();
  await expect(page.locator('#studio-export')).toBeDisabled();
  await expect(page.locator('#layer-plan-export')).toBeDisabled();
  expect(await page.evaluate(() => window.uiStudio?.snapshot().ready)).toBe(false);
  expect(requests).toBe(1);
});

test('model draft implicit label overflow blocks auto preview and bundle reopen without a retry', async ({ page }) => {
  const fixture = await layerPlanningFixture(); let requests = 0;
  const response = structuredClone(fixture.proposal);
  const button = response.plan.document.root.children[1];
  if (button.type !== 'Button' || !button.props.appearance) throw new Error('fixture button');
  // Same failure as the native draft: region height below the implicit line height.
  button.props.appearance.labelLayout.height = 10;
  await page.route('**/api/ui-vision**', route => route.abort());
  await page.route('**/api/ui-layer-plan', route => { requests++; return route.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify(response) }); });
  await page.goto('/');
  await page.locator('#layer-archive').setInputFiles({ name: 'ui-layers.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
  await page.locator('#layer-auto').click();
  await expect(page.locator('#studio-error')).toContainText('放不下完整文字');
  await expect(page.locator('#studio-error')).toHaveAttribute('data-error-detail', /LAYER_PLAN_TEXT_OVERFLOW: action.label/);
  await expect(page.locator('#studio-export')).toBeDisabled();
  await expect(page.locator('#layer-plan-export')).toBeDisabled();
  expect(await page.evaluate(() => window.uiStudio?.snapshot().ready)).toBe(false);
  expect(requests).toBe(1);

  const plan = await validateLayerProposal(fixture.bytes, await layerPlanningInput(fixture.bytes), response);
  const bundle = await compileLayerComponents(fixture.bytes, plan);
  await page.locator('#open-bundle').setInputFiles({ name: 'overflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.locator('#studio-error')).toHaveAttribute('data-error-detail', /LAYER_PLAN_TEXT_OVERFLOW: action.label/);
  expect(await page.evaluate(() => window.uiStudio?.snapshot().ready)).toBe(false);
  expect(requests).toBe(1);
});

test('one browser request shares three corrections across unfinished construction and actual render failures', async ({ page, baseURL }) => {
  const fixture = await layerPlanningFixture(), directory = await mkdtemp(join(tmpdir(), 'layer-browser-corrections-'));
  const invalid = structuredClone(fixture.proposal), button = invalid.plan.document.root.children[1];
  if (button.type !== 'Button' || !button.props.appearance) throw new Error('fixture button');
  button.props.appearance.labelLayout.height = 10;
  const incomplete = { ...fixture.proposal, status: 'Unresolved', reason: 'construction-incomplete', plan: null,
    findings: [], summary: '业务文字可读，但完整方案尚未写完。', issues: ['绑定与逐节点证据未完成。'] };
  let turns = 0, requests = 0;
  const sessionId = '019aaaaa-1234-7000-8000-000000000003';
  const spawnProcess = (_executable: string, args: string[]) => {
    const round = turns++;
    expect(args.includes('resume')).toBe(round > 0);
    if (round > 0) expect(args).toContain(sessionId);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.emit('close', null); } });
    child.stdin.resume();
    child.stdin.once('finish', () => {
      const { plan, ...envelope } = round === 0 ? incomplete : round < 3 ? invalid : fixture.proposal;
      const text = JSON.stringify({ ...envelope, planJson: JSON.stringify(plan) });
      const trace = [{ type: 'thread.started', thread_id: sessionId }, { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text } }, { type: 'turn.completed' }];
      void writeFile(args[args.indexOf('--output-last-message') + 1], text)
        .then(() => { child.stdout.write(trace.map(event => JSON.stringify(event)).join('\n')); child.emit('close', 0); });
    });
    return child;
  };
  const planner = createCodexLayerPlanner({ executable: 'offline-double', env: {}, stateRoot: directory,
    spawnProcess, checkAuthentication: async () => true });
  await page.route('**/api/ui-vision**', route => route.abort());
  await page.route('**/api/ui-layer-plan', async route => {
    requests++;
    const result = await planner.planRun(fixture.bytes, { origin: baseURL });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '2.0', ...result }) });
  });
  try {
    await page.goto('/');
    await page.locator('#layer-archive').setInputFiles({ name: 'ui-layers.zip', mimeType: 'application/zip', buffer: Buffer.from(fixture.bytes) });
    await page.locator('#layer-auto').click();
    await page.waitForFunction(() => window.uiStudio?.snapshot().ready, undefined, { timeout: 35000 });
    await expect(page.locator('#layer-auto-status')).toContainText('实际修正 3/3 次');
    const saved = await page.evaluate(() => window.uiStudio!.exportSelected());
    expect(saved.layerSource?.sha256).toBe(fixture.plan.archiveSha256);
    expect(requests).toBe(1); expect(turns).toBe(4);
    const runs = await (await import('node:fs/promises')).readdir(directory);
    const firstCheck = JSON.parse(await readFile(join(directory, runs[0], 'turn-0/check.json'), 'utf8'));
    expect(firstCheck.status).toBe('repairable');
    expect(firstCheck.feedback.code).toBe('LAYER_PLANNING_CONSTRUCTION_INCOMPLETE');
    for (let round = 1; round < 4; round++) {
      const report = JSON.parse(await readFile(join(directory, runs[0], `turn-${round}/render.json`), 'utf8'));
      expect(report.status).toBe(round < 3 ? 'repairable' : 'pass');
      expect(report.forbiddenRequests).toBe(0);
    }
    const canvas = page.locator('#main-preview canvas'), box = await canvas.boundingBox(); if (!box) throw Error('canvas');
    await page.mouse.click(box.x + 35 * box.width / 200, box.y + 35 * box.height / 100);
    await expect.poll(() => page.evaluate(() => window.uiStudio?.snapshot().views[0].activationCounts.action)).toBe(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
