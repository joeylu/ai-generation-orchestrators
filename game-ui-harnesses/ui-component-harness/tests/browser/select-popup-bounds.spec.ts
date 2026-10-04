import { test, expect } from '@playwright/test';

const style = { backgroundColor: '#FFFFFF', borderColor: '#52718A', borderWidth: 1, cornerRadius: 4,
  textColor: '#173746', fontFamily: 'Arial', fontSize: 20, fontWeight: 'normal', opacity: 1 };

for (const zoom of ['1', '1.5']) test(`Select near canvas bottom flips above a nested field at zoom ${zoom}`, async ({ page }, info) => {
  const document = { schemaVersion: '0.2', id: 'procedural-select-popup-boundary-fixture', canvas: { width: 520, height: 300 },
    root: { id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 520, height: 300 }, props: { style }, children: [
      { id: 'behind', type: 'Button', layout: { x: 360, y: 145, width: 160, height: 40 }, props: { label: 'Behind menu', enabled: true, style }, children: [] },
      { id: 'nested', type: 'Container', layout: { x: 30, y: 40, width: 490, height: 250 }, props: { style }, children: [
        { id: 'theme', type: 'Select', layout: { x: 330, y: 180, width: 160, height: 40 }, props: {
          selectedId: 'light', options: [{ id: 'light', label: 'LIGHT' }, { id: 'dark', label: 'DARK' }, { id: 'system', label: 'SYSTEM' }], enabled: true, style } },
      ] },
    ] } };
  const errors: string[] = [], blocked: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173' && !url.pathname.startsWith('/api/')) return route.continue();
    blocked.push(url.origin + url.pathname); return route.abort();
  });
  await page.goto('/workbench.html'); await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await page.evaluate(doc => (window as any).uiHarness.importDocument(doc), document);
  await page.locator('#zoom').selectOption(zoom);
  const canvas = page.locator('#canvas-host canvas');
  const inspect = () => page.evaluate(() => (window as any).uiHarness.inspect().nodes.find((n: any) => n.id === 'theme'));
  const click = async (x: number, y: number) => { await canvas.scrollIntoViewIfNeeded(); const bounds = (await canvas.boundingBox())!;
    await page.mouse.click(bounds.x + x * bounds.width / 520, bounds.y + y * bounds.height / 300); };
  const field = (await inspect()).bounds;
  await click(field.x + field.width / 2, field.y + field.height / 2);
  const opened = await inspect();
  await canvas.screenshot({ path: info.outputPath('opened.png') });
  expect(opened.popupOpen).toBe(true);
  expect(opened.popupBounds.x).toBeGreaterThanOrEqual(0);
  expect(opened.popupBounds.y).toBeGreaterThanOrEqual(0);
  expect(opened.popupBounds.x + opened.popupBounds.width).toBeLessThanOrEqual(520);
  expect(opened.popupBounds.y + opened.popupBounds.height).toBeLessThanOrEqual(field.y);
  expect(opened.popupItems.map((item: any) => item.text)).toEqual(['LIGHT', 'DARK', 'SYSTEM']);
  for (const item of opened.popupItems) for (const text of item.textBounds) {
    expect(text.bounds.y).toBeGreaterThanOrEqual(0);
    expect(text.bounds.y + text.bounds.height).toBeLessThanOrEqual(300);
  }
  const system = opened.popupItems.find((item: any) => item.optionId === 'system').textBounds[0].bounds;
  await click(system.x + system.width / 2, system.y + system.height / 2);
  expect((await inspect()).value).toBe('system'); expect((await inspect()).popupOpen).toBe(false);
  expect(await page.evaluate(() => (window as any).uiHarness.activationCount('behind'))).toBe(0);
  await canvas.focus();
  for (let step = 0; step < 5 && await canvas.getAttribute('data-focused-component') !== 'theme'; step++) await page.keyboard.press('Tab');
  await expect(canvas).toHaveAttribute('data-focused-component', 'theme');
  await page.keyboard.press('Space'); expect((await inspect()).popupOpen).toBe(true);
  await page.keyboard.press('Home'); expect((await inspect()).value).toBe('light');
  await page.keyboard.press('End'); expect((await inspect()).value).toBe('system');
  await page.keyboard.press('Escape'); expect((await inspect()).popupOpen).toBe(false);
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
});
