import { test, expect } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';
import type { UiDocument } from '../../src/tree-contract.ts';

test('raster Tabs and Select render their explicit selected-state text colors', async ({ page }) => {
  const style = { backgroundColor: '#173D25', borderColor: '#173D25', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 22, fontWeight: 'bold' as const, opacity: 1 };
  const tabAppearance = {
    sourceCanvas: { width: 240, height: 100 }, tabImage: 'dark.svg', tabCanvas: { width: 120, height: 50 },
    activeTabImage: 'dark.svg', activeTabCanvas: { width: 120, height: 50 }, headerHeight: 50,
    labelLayout: { x: 8, y: 5, width: 104, height: 40 }, hitArea: { x: 0, y: 0, width: 120, height: 50 }, activeTextColor: '#FFFFFF',
  };
  const document: UiDocument = { schemaVersion: '0.2', id: 'state-text-colors', canvas: { width: 400, height: 150 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 400, height: 150 }, props: { style }, children: [
      { id: 'tabs', type: 'Tabs', layout: { x: 0, y: 0, width: 240, height: 100 }, props: { activeId: 'active', tabs: [
        { id: 'active', label: 'ACTIVE', contentId: 'active-content' },
        { id: 'other', label: 'OTHER', contentId: 'other-content' },
      ], enabled: true, style, appearance: tabAppearance }, children: [
        { id: 'active-content', type: 'Container', layout: { x: 0, y: 50, width: 240, height: 50 }, props: { style }, children: [] },
        { id: 'other-content', type: 'Container', layout: { x: 0, y: 50, width: 240, height: 50 }, props: { style }, children: [] },
      ] },
      { id: 'select', type: 'Select', layout: { x: 250, y: 0, width: 150, height: 50 }, props: { selectedId: 'all', options: [{ id: 'all', label: 'REGION' }], enabled: true, style, appearance: {
        fieldImage: 'field.svg', arrowImage: 'arrow.svg', popupImage: 'popup.svg', sourceCanvas: { width: 150, height: 50 },
        labelLayout: { x: 8, y: 5, width: 110, height: 40 }, arrowLayout: { x: 125, y: 18, width: 16, height: 14 },
        popupCanvas: { width: 150, height: 60 }, popupGap: 0, fieldTextColor: '#FFFFFF',
      } } },
    ],
  } };
  const bytes = (value: string) => new TextEncoder().encode(value);
  const svg = (width: number, height: number, fill: string) => bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`);
  const bundle = await createBundle(document, [
    { path: 'dark.svg', mime: 'image/svg+xml', bytes: svg(120, 50, '#173D25') },
    { path: 'field.svg', mime: 'image/svg+xml', bytes: svg(150, 50, '#173D25') },
    { path: 'arrow.svg', mime: 'image/svg+xml', bytes: svg(16, 14, '#173D25') },
    { path: 'popup.svg', mime: 'image/svg+xml', bytes: svg(150, 60, '#F5EBCF') },
  ], { kind: 'programmatic-fixture', description: 'Explicit state text color browser regression.' });

  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await page.evaluate(value => (window as any).uiHarness.importBundle(value), bundle);
  const screenshot = await page.locator('#canvas-host canvas').screenshot();
  const brightCounts = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = window.document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const count = (x: number, y: number, width: number, height: number) => {
      const pixels = context.getImageData(x, y, width, height).data; let result = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220 && pixels[i + 3] > 0) result++;
      return result;
    };
    return { activeTab: count(8, 5, 104, 40), selectField: count(258, 5, 110, 40) };
  }, screenshot.toString('base64'));
  expect(brightCounts.activeTab).toBeGreaterThan(20);
  expect(brightCounts.selectField).toBeGreaterThan(20);
  const box = await page.locator('#canvas-host canvas').boundingBox();
  if (!box) throw new Error('missing canvas');
  await page.mouse.click(box.x + 300 * box.width / 400, box.y + 25 * box.height / 150);
  const opened = await page.locator('#canvas-host canvas').screenshot();
  const darkCounts = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 150;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, 400, 150);
    const count = (x: number, y: number, w: number, h: number) => {
      const pixels = ctx.getImageData(x, y, w, h).data; let total = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 20 && pixels[i + 1] < 20 && pixels[i + 2] < 20) total++;
      return total;
    };
    return { inactive: count(128, 5, 104, 40), popup: count(258, 55, 130, 50) };
  }, opened.toString('base64'));
  expect(darkCounts.inactive).toBeGreaterThan(20);
  expect(darkCounts.popup).toBeGreaterThan(20);
});
