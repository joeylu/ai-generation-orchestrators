import { test, expect, type Page } from '@playwright/test';
import { fixtureDocument } from '../../src/fixtures.ts';
import { readFile } from 'node:fs/promises';

async function ready(page: Page) {
  await page.goto('/workbench.html');
  await expect(page.locator('#lifecycle')).toHaveText('运行中');
  await expect(page.locator('#error')).toBeHidden();
}
async function point(page: Page, id: string) {
  return page.evaluate(id => {
    const node = window.uiHarness.inspect().nodes.find(node => node.id === id)!;
    const canvas = document.querySelector('#canvas-host canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + node.bounds.x + node.bounds.width / 2, y: rect.top + node.bounds.y + node.bounds.height / 2 };
  }, id);
}
test('composite follows actual compiler facts and trusted mouse activates composed Button once', async ({ page }) => {
  await ready(page);
  const document = await page.evaluate(() => window.uiHarness.getDocument());
  expect(document?.schemaVersion).toBe('0.2');
  const inspection = await page.evaluate(() => window.uiHarness.inspect());
  expect(inspection.nodes).toHaveLength(9); expect(inspection.resources).toBe(2);
  const button = await point(page, 'confirm'); await page.mouse.click(button.x, button.y);
  expect(await page.evaluate(() => window.uiHarness.activates())).toBe(1);
  await page.mouse.move(button.x, button.y); await page.mouse.down(); await page.mouse.move(button.x + 230, button.y); await page.mouse.up();
  expect(await page.evaluate(() => window.uiHarness.activates())).toBe(1);
  await page.screenshot({ path: 'test-results/composite-accepted.png', fullPage: true });
});
test('invalid contract, missing image, corrupt image and font failure leave no successful tree', async ({ page }) => {
  await ready(page);
  for (const kind of ['unknown', 'missing', 'corrupt', 'font']) {
    const document: any = fixtureDocument('composite');
    if (kind === 'unknown') document.root.children[0].type = 'Unknown';
    else if (kind === 'font') document.root.children[0].props.fontSource = 'fixtures/missing.woff2';
    else document.root.children[1].children[0].props.source = kind === 'missing' ? 'fixtures/missing.png' : 'fixtures/corrupt.png';
    const result = await page.evaluate(async document => { try { await window.uiHarness.loadDocument(document); return 'unexpected-success'; } catch (error) { return String(error); } }, document);
    expect(result).not.toBe('unexpected-success');
    expect((await page.evaluate(() => window.uiHarness.inspect())).instances).toBe(0);
    await expect(page.locator('#output-json')).toHaveText('尚未生成合同');
    await expect(page.locator('#error')).toBeVisible();
  }
});
test('shared image survives sibling destruction and final destroy releases resources/listeners', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.uiHarness.destroyNode('balance-gem'));
  expect((await page.evaluate(() => window.uiHarness.inspect())).resources).toBe(2);
  const button = await point(page, 'confirm'); await page.mouse.click(button.x, button.y);
  expect(await page.evaluate(() => window.uiHarness.activates())).toBe(1);
  await page.evaluate(() => window.uiHarness.destroyNode('confirm-icon'));
  expect((await page.evaluate(() => window.uiHarness.inspect())).resources).toBe(1);
  await page.click('#destroy');
  expect(await page.evaluate(() => window.uiHarness.inspect())).toEqual({ instances: 0, externalListeners: 0, resources: 0, nodes: [] });
});
test('uploaded image creates explicit intent; portable bundle restores without fetching source in a fresh page', async ({ page, context }) => {
  await ready(page);
  const svg = await readFile('public/fixtures/gem.svg');
  await page.locator('#asset-files').setInputFiles({ name: 'gem.svg', mimeType: 'image/svg+xml', buffer: svg });
  await expect(page.locator('#source-preview')).toBeVisible();
  await page.selectOption('#asset-type', 'Button'); await page.click('#use-image');
  await expect(page.locator('#source-note')).toContainText('人工指定 Button');
  const bundle = await page.evaluate(() => window.uiHarness.exportBundle());
  expect(bundle.resources).toHaveLength(1); expect(bundle.document.id).toBe('imported-component');
  expect(JSON.stringify(bundle)).not.toContain('blob:');
  const second = await context.newPage(); await ready(second);
  await second.route('**/assets/**', route => route.abort());
  await second.locator('#bundle-file').setInputFiles({ name: 'component.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(second.locator('#source-note')).toContainText('组件包');
  expect(await second.evaluate(() => window.uiHarness.getDocument())).toEqual(bundle.document);
  const button = await point(second, 'imported-button'); await second.mouse.click(button.x, button.y);
  expect(await second.evaluate(() => window.uiHarness.activates())).toBe(1); await second.close();
});
test('tampered imported bundle is rejected and clears old result', async ({ page }) => {
  await ready(page); const bundle = await page.evaluate(() => window.uiHarness.exportBundle());
  bundle.resources[0].sha256 = '0'.repeat(64);
  await page.locator('#bundle-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.locator('#error')).toBeVisible();
  expect((await page.evaluate(() => window.uiHarness.inspect())).instances).toBe(0);
  await expect(page.locator('#export-bundle')).toBeDisabled();
});
test('raw contract file import validates the document and reloads declared resources', async ({ page }) => {
  await ready(page); const document = fixtureDocument('composite'); document.id = 'imported-raw-contract';
  await page.locator('#document-file').setInputFiles({ name: 'document.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  await expect(page.locator('#source-note')).toContainText('用户导入组件合同');
  expect(await page.evaluate(() => window.uiHarness.getDocument())).toEqual(document);
  await page.locator('#document-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":"9"}') });
  await expect(page.locator('#error')).toBeVisible();
  expect((await page.evaluate(() => window.uiHarness.inspect())).instances).toBe(0);
});
test('legacy Button 14 probes pass and legacy bundle restores embedded resource', async ({ page, context }) => {
  await ready(page); await page.selectOption('#scenario', 'legacy'); await page.click('#load-example');
  await expect(page.locator('#render-info')).toContainText('v0.1 Button');
  const canvas = await page.locator('#canvas-host canvas').boundingBox();
  await page.mouse.click(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  expect(await page.evaluate(() => window.uiHarness.activates())).toBe(1);
  await page.click('#legacy-probes');
  await expect(page.locator('#probe-report')).toContainText('14 项通过', { timeout: 30000 });
  const bundle = await page.evaluate(() => window.uiHarness.exportBundle());
  const second = await context.newPage(); await ready(second);
  await second.route('**/fixtures/button.svg', route => route.abort());
  await second.evaluate(bundle => window.uiHarness.importBundle(bundle), bundle);
  expect(await second.evaluate(() => window.uiHarness.legacySnapshot()?.enabled)).toBe(true); await second.close();
});
test('separate motion seeks and restores without changing component contract', async ({ page }) => {
  await ready(page); const before = await page.evaluate(() => window.uiHarness.getDocument());
  const beforeBounds = await page.evaluate(() => window.uiHarness.inspect().nodes.find(node => node.id === 'balance')!.bounds);
  await page.evaluate(() => window.uiHarness.seekMotion(200));
  const afterBounds = await page.evaluate(() => window.uiHarness.inspect().nodes.find(node => node.id === 'balance')!.bounds);
  expect(afterBounds.x).toBeLessThan(beforeBounds.x);
  expect(await page.evaluate(() => window.uiHarness.getDocument())).toEqual(before);
  await page.click('[data-tab=motion]'); await page.click('#motion-stop');
  expect((await page.evaluate(() => window.uiHarness.inspect().nodes.find(node => node.id === 'balance')!.bounds))).toEqual(beforeBounds);
  await page.click('#motion-play');
  await expect.poll(() => page.evaluate(() => window.uiHarness.motionSnapshot()?.time)).toBe(1100);
  expect(await page.evaluate(() => window.uiHarness.motionSnapshot()?.running)).toBe(false);
});
test('concurrent requests discard stale result and repeated reload has stable live counts', async ({ page }) => {
  await ready(page); const original = fixtureDocument('composite'); const latest = structuredClone(original); latest.id = 'latest-request';
  const outcomes = await page.evaluate(async ([a, b]) => (await Promise.allSettled([window.uiHarness.loadDocument(a), window.uiHarness.loadDocument(b)])).map(result => result.status), [original, latest]);
  expect(outcomes).toEqual(['rejected', 'fulfilled']);
  expect((await page.evaluate(() => window.uiHarness.getDocument()))?.id).toBe('latest-request');
  const counts = await page.evaluate(() => { const result = window.uiHarness.inspect(); return [result.instances, result.resources, result.externalListeners, result.nodes.length]; });
  for (let i = 0; i < 8; i++) await page.evaluate(document => window.uiHarness.loadDocument(document), original);
  expect(await page.evaluate(() => { const result = window.uiHarness.inspect(); return [result.instances, result.resources, result.externalListeners, result.nodes.length]; })).toEqual(counts);
});
test('unresolved intent and overflowing text expose real errors before success', async ({ page }) => {
  await ready(page);
  await page.locator('#intent-editor').fill(JSON.stringify({ intentVersion: '0.2', id: 'unresolved', root: { id: 'unknown', componentType: 'Unresolved', props: {} } }));
  await page.click('#compile'); await expect(page.locator('#error')).toBeVisible();
  expect((await page.evaluate(() => window.uiHarness.inspect())).instances).toBe(0);
  const document: any = fixtureDocument('composite'); document.root.children[0].layout.width = 8;
  const error = await page.evaluate(async document => { try { await window.uiHarness.loadDocument(document); return ''; } catch (error) { return String(error); } }, document);
  expect(error).toContain('TEXT_OVERFLOW'); expect((await page.evaluate(() => window.uiHarness.inspect())).instances).toBe(0);
});
