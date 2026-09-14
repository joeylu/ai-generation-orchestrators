import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { componentHandoffFixture } from '../helpers/component-handoff-fixture.ts';
import { importAndApplyComponentHandoff } from '../../src/component-handoff.ts';

test('Studio directly compiles a handoff ZIP, preserves draft disclosure, accepts input and clears corrupt replacement', async ({ page }) => {
  let providerCalls = 0;
  await page.route('**/api/vision/**', route => { providerCalls++; return route.abort(); });
  const bytes = await componentHandoffFixture();
  const compiled = await importAndApplyComponentHandoff(bytes);
  await page.goto('/');
  await page.locator('#open-handoff').setInputFiles({ name: 'fixture.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  await expect(page.locator('#handoff-review')).toContainText(createHash('sha256').update(bytes).digest('hex'));
  await expect(page.locator('#handoff-review')).toContainText('未通过（草稿）');
  expect((await page.evaluate(() => window.uiStudio.exportSelected())).document).toEqual(compiled.document);
  const canvas = page.locator('#main-preview canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox(); if (!box) throw Error('canvas');
  await page.mouse.click(box.x + 90 * box.width / 500, box.y + 90 * box.height / 400);
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(n => n.id === 'apply-switch')?.value)).toBe(true);
  await page.locator('#open-handoff').setInputFiles({ name: 'corrupt.zip', mimeType: 'application/zip', buffer: Buffer.from(await componentHandoffFixture(true)) });
  await expect(page.locator('#studio-error')).toBeVisible(); await expect(canvas).toHaveCount(0);
  await expect(page.locator('#studio-export')).toBeDisabled(); await expect(page.locator('#handoff-review')).toBeHidden();
  expect(providerCalls).toBe(0);
});
