import { test, expect } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';
import type { UiDocument } from '../../src/tree-contract.ts';

test('raster ScrollView expands an undersized thumb to the semantic viewport ratio', async ({ page }) => {
  const style = { backgroundColor: '#FFFFFF', borderColor: '#0000FF', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'normal' as const, opacity: 1 };
  const document: UiDocument = { schemaVersion: '0.2', id: 'scroll-thumb-ratio', canvas: { width: 120, height: 100 }, root: {
    id: 'scroll', type: 'ScrollView', layout: { x: 0, y: 0, width: 120, height: 100 }, props: {
      scrollX: 0, scrollY: 0, contentWidth: 120, contentHeight: 101, style,
      appearance: {
        sourceCanvas: { width: 120, height: 100 },
        viewport: { image: 'viewport.svg', canvas: { width: 120, height: 100 }, layout: { x: 0, y: 0, width: 120, height: 100 } },
        scrollbarTrack: { image: 'track.svg', canvas: { width: 10, height: 80 }, layout: { x: 100, y: 10, width: 10, height: 80 } },
        scrollbarThumbImage: 'thumb.svg', scrollbarThumbCanvas: { width: 10, height: 10 },
        scrollbarThumbPositions: { min: { x: 100, y: 10 }, max: { x: 100, y: 80 } },
      },
    }, children: [],
  } };
  const bytes = (text: string) => new TextEncoder().encode(text);
  const bundle = await createBundle(document, [
    { path: 'viewport.svg', mime: 'image/svg+xml', bytes: bytes('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect width="120" height="100" fill="white"/></svg>') },
    { path: 'track.svg', mime: 'image/svg+xml', bytes: bytes('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="80"><rect width="10" height="80" fill="blue"/></svg>') },
    { path: 'thumb.svg', mime: 'image/svg+xml', bytes: bytes('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>') },
  ], { kind: 'programmatic-fixture', description: 'Semantic ScrollView thumb ratio regression.' });

  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await page.evaluate(value => (window as any).uiHarness.importBundle(value), bundle);
  const screenshot = await page.locator('#canvas-host canvas').screenshot();
  const samples = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = window.document.createElement('canvas'); canvas.width = 120; canvas.height = 100;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
    return { top: pixel(105, 15), nearBottom: pixel(105, 85) };
  }, screenshot.toString('base64'));
  expect(samples).toEqual({ top: [255, 0, 0, 255], nearBottom: [255, 0, 0, 255] });

  const canvas = page.locator('#canvas-host canvas'); const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas');
  // Exercise the DOM -> Pixi wheel handler directly; OS wheel targeting of this
  // tiny canvas is timing-sensitive in headless Chromium. No state API is used.
  await canvas.dispatchEvent('wheel', { clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2, deltaY: 120, deltaX: 0, deltaMode: 0,
    bubbles: true, cancelable: true });
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.inspect().nodes[0].value)).toEqual({ x: 0, y: 1 });
});
