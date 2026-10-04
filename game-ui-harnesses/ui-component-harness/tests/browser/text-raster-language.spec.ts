import { test, expect } from '@playwright/test';

for (const language of ['en', 'zh-CN']) {
  test(`generic numeric glyph textures remain complete in ${language} pages`, async ({ page }, info) => {
    let forbidden = 0;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(info.project.use.baseURL!).origin && !url.pathname.startsWith('/api/')) {
        return route.continue();
      }
      forbidden++; return route.abort();
    });
    await page.goto('/layer-plan-check.html');
    await page.evaluate(lang => document.documentElement.lang = lang, language);
    const result = await page.evaluate(async () => {
      const path = '/tests/helpers/text-raster-browser-fixture.ts';
      const module = await import(path);
      return module.textRasterFixture();
    });
    await info.attach('actual-numeric-render', {
      body: Buffer.from(result.png.split(',')[1], 'base64'), contentType: 'image/png',
    });
    await info.attach('independent-raster-measurements', {
      body: JSON.stringify({ language, rows: result.rows }, null, 2), contentType: 'application/json',
    });
    for (const row of result.rows) {
      expect(row.frameWidth, `${row.text}: actual draw advance must fit the texture frame`).toBeGreaterThanOrEqual(Math.ceil(row.drawWidth));
      expect(row.frameWidth, `${row.text}: actual glyph ink must fit the texture frame`).toBeGreaterThanOrEqual(Math.ceil(row.inkRight));
      expect(row.outsidePixels, `${row.text}: no glyph pixels outside exported texture frame`).toBe(0);
      expect(row.measuredWidth).toBeCloseTo(row.drawWidth, 5);
    }
    expect(result.inspection.nodes.filter((node: any) => node.type === 'Text')
      .map((node: any) => node.renderedTextBounds[0].text)).toEqual(['30', '50', '20', '250']);
    expect(forbidden).toBe(0);
  });
}
