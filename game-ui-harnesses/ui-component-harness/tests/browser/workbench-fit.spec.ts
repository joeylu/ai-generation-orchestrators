import { expect, test } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';
import type { UiDocument } from '../../src/tree-contract.ts';

test('workbench fits a large canvas beside the inspector and preserves numeric zoom scrolling', async ({ page }, info) => {
  const style = { backgroundColor: '#E1EEE5', borderColor: '#227744', borderWidth: 1, cornerRadius: 6, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 24, fontWeight: 'normal' as const, opacity: 1 };
  const document: UiDocument = { schemaVersion: '0.2', id: 'fit-regression', canvas: { width: 1536, height: 1024 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 1536, height: 1024 }, props: { style }, children: [
      { id: 'edge-toggle', type: 'CheckBox', layout: { x: 1300, y: 50, width: 210, height: 70 }, props: { label: 'Edge control', checked: false, enabled: true, style } },
    ],
  } };
  const bundle = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Large canvas inspector regression; no reference artwork.' });
  await page.goto('/workbench.html'); await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await page.evaluate(bundle => (window as any).uiHarness.importBundle(bundle), bundle);
  await expect(page.locator('#zoom')).toHaveValue('fit');
  const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(), inspector = await page.locator('.right-panel').boundingBox();
  if (!box || !inspector) throw Error('layout');
  expect(box.x + box.width).toBeLessThanOrEqual(inspector.x);
  const point = { x: box.x + 1400 * box.width / 1536, y: box.y + 85 * box.height / 1024 };
  expect(await page.evaluate(p => window.document.elementFromPoint(p.x, p.y)?.tagName, point)).toBe('CANVAS');
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.inspect().nodes.find((n: any) => n.id === 'edge-toggle').value)).toBe(true);
  await page.screenshot({ path: info.outputPath('workbench-fit.png') });
  await page.locator('#zoom').selectOption('1');
  expect(await page.locator('.canvas-area').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const right = await page.locator('.right-panel').boundingBox(); if (!right) throw Error('inspector');
  expect(await page.evaluate(p => !!document.elementFromPoint(p.x, p.y)?.closest('.right-panel'), { x: right.x + 20, y: right.y + 40 })).toBe(true);
});
