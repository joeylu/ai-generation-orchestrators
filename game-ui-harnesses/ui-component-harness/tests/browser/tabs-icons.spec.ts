import { test, expect } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';
import type { UiDocument } from '../../src/tree-contract.ts';

test('Tabs keeps every icon visible and swaps its raster with active state', async ({ page }) => {
  const style = { backgroundColor: '#173D25', borderColor: '#173D25', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'bold' as const, opacity: 1 };
  const icon = (tabId: string, x: number) => ({
    tabId,
    icon: { image: `${tabId}-idle.svg`, canvas: { width: 20, height: 20 }, layout: { x, y: 15, width: 20, height: 20 } },
    activeIcon: { image: `${tabId}-active.svg`, canvas: { width: 20, height: 20 }, layout: { x, y: 15, width: 20, height: 20 } },
  });
  const document: UiDocument = { schemaVersion: '0.2', id: 'tabs-icons', canvas: { width: 240, height: 100 }, root: {
    id: 'tabs', type: 'Tabs', layout: { x: 0, y: 0, width: 240, height: 100 }, props: { activeId: 'a', tabs: [
      { id: 'a', label: 'A', contentId: 'a-content' }, { id: 'b', label: 'B', contentId: 'b-content' },
    ], enabled: true, style, appearance: {
      sourceCanvas: { width: 240, height: 100 }, tabImage: 'tab.svg', tabCanvas: { width: 120, height: 50 }, activeTabImage: 'tab.svg', activeTabCanvas: { width: 120, height: 50 },
      headerHeight: 50, labelLayout: { x: 50, y: 5, width: 60, height: 40 }, hitArea: { x: 0, y: 0, width: 120, height: 50 }, icons: [icon('a', 15), icon('b', 15)],
    } }, children: [
      { id: 'a-content', type: 'Container', layout: { x: 0, y: 50, width: 240, height: 50 }, props: { style }, children: [] },
      { id: 'b-content', type: 'Container', layout: { x: 0, y: 50, width: 240, height: 50 }, props: { style }, children: [] },
    ],
  } };
  const bytes = (value: string) => new TextEncoder().encode(value);
  const svg = (width: number, height: number, fill: string) => bytes(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`);
  const resources = [{ path: 'tab.svg', mime: 'image/svg+xml', bytes: svg(120, 50, '#173D25') }];
  for (const id of ['a', 'b']) resources.push(
    { path: `${id}-idle.svg`, mime: 'image/svg+xml', bytes: svg(20, 20, '#FF0000') },
    { path: `${id}-active.svg`, mime: 'image/svg+xml', bytes: svg(20, 20, '#00FFFF') },
  );
  const bundle = await createBundle(document, resources, { kind: 'programmatic-fixture', description: 'Per-tab state icon regression.' });
  await page.goto('/workbench.html'); await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await page.evaluate(value => (window as any).uiHarness.importBundle(value), bundle);
  const canvas = page.locator('#canvas-host canvas');
  const samples = async () => {
    const screenshot = await canvas.screenshot();
    return page.evaluate(async base64 => { const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode(); const c = document.createElement('canvas'); c.width = 240; c.height = 100; const context = c.getContext('2d')!; context.drawImage(image, 0, 0); const at = (x: number) => Array.from(context.getImageData(x, 25, 1, 1).data); return [at(25), at(145)]; }, screenshot.toString('base64'));
  };
  expect(await samples()).toEqual([[0, 255, 255, 255], [255, 0, 0, 255]]);
  const box = await canvas.boundingBox(); if (!box) throw new Error('missing canvas'); await page.mouse.click(box.x + 180, box.y + 25);
  expect(await samples()).toEqual([[255, 0, 0, 255], [0, 255, 255, 255]]);
});
