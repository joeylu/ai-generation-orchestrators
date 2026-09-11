import { test, expect } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';
import type { UiDocument } from '../../src/tree-contract.ts';

test('transparent Text paint preserves background pixels and visible glyphs', async ({ page }) => {
  const style = { backgroundColor: '#123456', borderColor: '#123456', borderWidth: 0, cornerRadius: 0, textColor: '#FFFFFF', fontFamily: 'sans-serif', fontSize: 24, fontWeight: 'normal' as const, opacity: 1 };
  const document: UiDocument = { schemaVersion: '0.2', id: 'text-paint-regression', canvas: { width: 200, height: 100 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 200, height: 100 }, props: { style }, children: [
      { id: 'transparent-text', type: 'Text', layout: { x: 10, y: 10, width: 80, height: 60 }, props: { text: 'I', wrap: 'none', overflow: 'error', lineHeight: 30, drawBackground: false, style: { ...style, backgroundColor: '#FF0000' } } },
      { id: 'legacy-text', type: 'Text', layout: { x: 110, y: 10, width: 80, height: 60 }, props: { text: 'I', wrap: 'none', overflow: 'error', lineHeight: 30, style: { ...style, backgroundColor: '#FF0000' } } },
    ],
  } };
  const bundle = await createBundle(document, [], { kind: 'programmatic-fixture', description: 'Opt-in Text background paint regression.' });
  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await page.evaluate(value => (window as any).uiHarness.importBundle(value), bundle);
  const screenshot = await page.locator('#canvas-host canvas').screenshot();
  const pixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = window.document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, 200, 100);
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const data = ctx.getImageData(10, 10, 30, 40).data;
    let white = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) white++;
    return { transparent: pixel(80, 60), legacy: pixel(180, 60), white };
  }, screenshot.toString('base64'));
  expect(pixels.transparent).toEqual([18, 52, 86, 255]);
  expect(pixels.legacy).toEqual([255, 0, 0, 255]);
  expect(pixels.white).toBeGreaterThan(0);
});
