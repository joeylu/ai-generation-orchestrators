import { test, expect } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';
import { appearanceApplicationFixture } from '../helpers/appearance-application-fixture.ts';

test('large Studio canvas fits a stable viewport without ResizeObserver feedback, including comparison mode', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).layoutErrors = [];
    window.addEventListener('error', event => (window as any).layoutErrors.push(event.message));
  });
  const f = await appearanceApplicationFixture();
  const doc = structuredClone(f.document); doc.canvas = { width: 1536, height: 1024 }; doc.root.layout.width = 1536; doc.root.layout.height = 1024;
  const bundle = await createBundle(doc, [], { kind: 'programmatic-fixture', description: 'Large-canvas resize regression; no generated artwork.' });
  await page.goto('/');
  await page.locator('#open-bundle').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  const verify = async (selector: string) => {
    const samples = await page.evaluate(async selector => {
      const results = [];
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame);
        const canvases = [...document.querySelectorAll<HTMLCanvasElement>(selector)];
        results.push(canvases.map(c => { const b = c.getBoundingClientRect(); return { width: b.width, height: b.height, hostWidth: c.parentElement!.clientWidth, hostHeight: c.parentElement!.clientHeight }; }));
      }
      return results;
    }, selector);
    expect(samples.at(-1)).toEqual(samples.at(-2));
    for (const c of samples.at(-1)!) { expect(c.width).toBeGreaterThan(1); expect(c.width).toBeLessThanOrEqual(c.hostWidth); expect(c.height).toBeLessThanOrEqual(c.hostHeight); expect(c.width / c.height).toBeCloseTo(1.5, 2); }
    expect(await page.evaluate(() => (window as any).layoutErrors)).toEqual([]);
  };
  await verify('#main-preview canvas');
  await page.locator('#studio-compare').click();
  await expect(page.locator('#comparison-grid canvas')).toHaveCount(4);
  await verify('#comparison-grid canvas');
});
