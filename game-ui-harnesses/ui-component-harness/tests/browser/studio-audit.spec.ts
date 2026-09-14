import { expect, test } from '@playwright/test';
import { applyAppearanceBinding } from '../../src/appearance-apply.ts';
import { firstBatchAppearanceFixture } from '../helpers/first-batch-appearance-fixture.ts';
import { secondBatchAppearanceFixture } from '../helpers/second-batch-appearance-fixture.ts';

test('Studio fits a large canvas and accepts real mouse and keyboard input without hiding editor chrome', async ({ page }, info) => {
  const fixture = await firstBatchAppearanceFixture();
  const bundle = structuredClone(await applyAppearanceBinding(fixture.target, fixture.imported, fixture.binding));
  if (bundle.document.schemaVersion !== '0.2' || !('children' in bundle.document.root)) throw new Error('fixture');
  bundle.document.canvas = { width: 1536, height: 1024 };
  bundle.document.root.layout = { x: 0, y: 0, ...bundle.document.canvas };
  for (const child of bundle.document.root.children) { child.layout.x += 1100; child.layout.y += 500; }
  await page.goto('/');
  await page.locator('#open-bundle').setInputFiles({ name: 'large-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  const canvas = page.locator('#main-preview canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(); if (!box) throw new Error('missing canvas');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1600);
  expect(box.y + box.height).toBeLessThanOrEqual(1100);
  const click = async (x: number, y: number) => {
    const client = { x: box.x + x * box.width / 1536, y: box.y + y * box.height / 1024 };
    expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName, client)).toBe('CANVAS');
    await page.mouse.click(client.x, client.y);
  };
  const before = await canvas.screenshot();
  await click(1125, 535);
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(n => n.id === 'apply-checkbox')?.value)).toBe(false);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await click(1200, 755);
  await page.keyboard.type('Audit42');
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(n => n.id === 'apply-input')?.value)).toBe('Audit42');
  const exported = await page.evaluate(() => window.uiStudio.exportSelected());
  expect(JSON.stringify(exported.document)).toContain('Audit42');
  const screenshot = info.outputPath('studio-large-canvas.png');
  await page.screenshot({ path: screenshot });
  await info.attach('studio-large-canvas', { path: screenshot, contentType: 'image/png' });
});

test('Studio rejects a missing inactive tab icon and clears the previous successful preview', async ({ page }) => {
  const fixture = await secondBatchAppearanceFixture();
  const bundle = await applyAppearanceBinding(fixture.target, fixture.imported, fixture.binding);
  await page.goto('/');
  const open = async (value: unknown) => page.locator('#open-bundle').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await open(bundle);
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  const damaged = structuredClone(bundle);
  damaged.resources = damaged.resources.filter(resource => !resource.path.endsWith('/tab-a-icon.png'));
  expect(damaged.resources.length).toBe(bundle.resources.length - 1);
  await open(damaged);
  await expect(page.locator('#studio-error')).toBeVisible();
  expect(await page.evaluate(() => window.uiStudio.snapshot())).toMatchObject({ ready: false, resourceCount: 0, views: [] });
  await expect(page.locator('#main-preview canvas')).toHaveCount(0);
  await expect(page.locator('#studio-export')).toBeDisabled();
});
