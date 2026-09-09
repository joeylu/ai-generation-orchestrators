import { test, expect, type Page } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';
import type { UiDocument } from '../../src/tree-contract.ts';

async function fixture() {
  const style = { backgroundColor: '#123456', borderColor: '#FFFFFF', borderWidth: 0, cornerRadius: 0, textColor: '#FFFFFF', fontFamily: 'sans-serif', fontSize: 20, fontWeight: 'normal' as const, opacity: 1 };
  const source = 'assets/transparent.svg';
  const document: UiDocument = { schemaVersion: '0.2', id: 'texture-fixture', canvas: { width: 200, height: 120 }, root: {
    id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 200, height: 120 }, props: { style }, children: [
      { id: 'static-image', type: 'Image', layout: { x: 10, y: 10, width: 80, height: 40 }, props: { source, fit: 'stretch', drawBackground: false, style: { ...style, backgroundColor: '#FFFFFF' } } },
      { id: 'textured-button', type: 'Button', layout: { x: 100, y: 10, width: 80, height: 40 }, props: { label: '████', enabled: true, backgroundImage: source, style: { ...style, backgroundColor: '#FFFFFF' } }, children: [] },
    ],
  } };
  return createBundle(document, [{ path: source, mime: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect x="10" y="10" width="60" height="20" fill="#ff0000"/></svg>') }], { kind: 'programmatic-fixture', description: 'Transparent texture regression fixture; no generated artwork.' });
}
async function open(page: Page, bundle: unknown) {
  await page.locator('#open-bundle').setInputFiles({ name: 'texture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.locator('#studio-export')).toBeEnabled();
}

test('transparent image and Button textures preserve pixels, activation, motion, and portable restoration', async ({ page }) => {
  let providerCalls = 0;
  await page.route('**/api/ui-vision**', route => { providerCalls++; return route.abort(); });
  await page.goto('/'); const bundle = await fixture(); await open(page, bundle);
  const capture = await page.locator('#main-preview canvas').screenshot();
  const pixels = await page.evaluate(async bytes => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close();
    return [[11, 11], [101, 11], [40, 30], [140, 30]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
  }, [...capture]);
  expect(pixels).toEqual([[18, 52, 86, 255], [18, 52, 86, 255], [255, 0, 0, 255], [255, 0, 0, 255]]);
  await page.locator('[data-scheme="premium"]').click();
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].motionSnapshot.scheduler.running)).toBe(0);
  const canvas = page.locator('#main-preview canvas'); await canvas.scrollIntoViewIfNeeded();
  await canvas.click({ position: { x: 140, y: 30 } });
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].activationCounts['textured-button'])).toBe(1);
  const exported = await page.evaluate(() => window.uiStudio.exportSelected());
  expect(exported.resources).toEqual(bundle.resources);
  expect(exported.document).toEqual(bundle.document);
  expect(exported.motionSystem?.style).toBe('premium');
  await page.reload(); await open(page, exported);
  expect(await page.evaluate(() => window.uiStudio.exportSelected())).toEqual(exported);
  await page.locator('#studio-reset').click();
  expect(await page.evaluate(() => window.uiStudio.snapshot().resourceCount)).toBe(0);
  await expect(page.locator('#main-preview canvas')).toHaveCount(0);
  expect(providerCalls).toBe(0);
});
