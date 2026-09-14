import { expect, test, type Page } from '@playwright/test';

async function load(page: Page) {
  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await page.locator('#scenario').selectOption('gallery'); await page.locator('#load-example').click();
  await page.waitForFunction(() => (window as any).uiHarness.getDocument()?.id === 'fixture-gallery');
}
async function focus(page: Page, id: string) {
  const canvas = page.locator('#canvas-host canvas');
  await canvas.focus();
  for (let index = 0; index < 18; index++) {
    if (await canvas.getAttribute('data-focused-component') === id) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`keyboard did not reach ${id}`);
}
const value = (page: Page, id: string) => page.evaluate(id => (window as any).uiHarness.inspect().nodes.find((n: any) => n.id === id)?.value, id);

test('mouse activation does not report a synthetic keyboard focus', async ({ page }) => {
  await load(page);
  const canvas = page.locator('#canvas-host canvas'); const box = await canvas.boundingBox(); if (!box) throw Error('canvas');
  const doc = await page.evaluate(() => (window as any).uiHarness.getDocument());
  await page.mouse.click(box.x + 530 * box.width / doc.canvas.width, box.y + 118 * box.height / doc.canvas.height);
  await expect(page.locator('#events li.activate')).toHaveCount(1);
  await expect(page.locator('#events li.focus').filter({ hasText: '"source":"keyboard"' })).toHaveCount(0);
  await page.keyboard.press('Tab'); await expect(canvas).toHaveAttribute('data-focused-component', 'confirm');
});

test('keyboard navigation changes actual control values and emits keyboard events with visible feedback', async ({ page }) => {
  await load(page);
  const canvas = page.locator('#canvas-host canvas');
  await focus(page, 'confirm'); const before = await canvas.screenshot();
  await page.keyboard.down('Space'); expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.keyboard.up('Space');
  await expect(page.locator('#events li.activate').filter({ hasText: '"source":"keyboard"' })).toHaveCount(1);
  await focus(page, 'sound'); await page.keyboard.press('Space'); await expect.poll(() => value(page, 'sound')).toBe(false);
  await focus(page, 'tips'); await page.keyboard.press('Enter'); await expect.poll(() => value(page, 'tips')).toBe(true);
  await focus(page, 'quality'); await page.keyboard.press('Home'); await expect.poll(() => value(page, 'quality')).toBe('quality-low');
  await focus(page, 'volume'); await page.keyboard.press('ArrowRight'); await expect.poll(() => value(page, 'volume')).toBe(45);
  await focus(page, 'name'); await page.keyboard.press('Control+A'); await page.keyboard.type('Keyboard user');
  await expect.poll(() => value(page, 'name')).toBe('Keyboard user');
  await page.keyboard.press('Tab'); await expect(canvas).toHaveAttribute('data-focused-component', 'region');
  await page.keyboard.press('Enter'); await page.keyboard.press('End'); await expect.poll(() => value(page, 'region')).toBe('region-west');
  await page.keyboard.press('Escape');
  await focus(page, 'scroll'); await page.keyboard.press('End'); await expect.poll(() => value(page, 'scroll')).toEqual({ x: 0, y: 193 });
  await focus(page, 'inventory'); await page.keyboard.press('End'); await expect.poll(() => value(page, 'inventory')).toBe('item-key');
  await focus(page, 'details'); await page.keyboard.press('ArrowRight'); await expect.poll(() => value(page, 'details')).toBe('tab-stats');
  for (const id of ['sound', 'tips', 'quality', 'volume', 'name', 'region', 'inventory', 'details']) {
    expect(await page.locator('#events li.change').filter({ hasText: `"id":"${id}"` }).filter({ hasText: '"source":"keyboard"' }).count()).toBeGreaterThan(0);
  }
  await page.keyboard.press('Shift+Tab'); await expect(canvas).toHaveAttribute('data-focused-component', 'inventory');
  await expect(page.locator('#error')).toBeHidden();
});

test('keyboard focus skips disabled/hidden controls, obeys modal blocking and cancels held activation', async ({ page }) => {
  await load(page);
  await focus(page, 'confirm'); await page.keyboard.down('Enter');
  await page.evaluate(() => (window as any).uiHarness.setEnabled('confirm', false));
  await page.keyboard.up('Enter'); await expect(page.locator('#events li.activate')).toHaveCount(0);
  await page.evaluate(() => (window as any).uiHarness.setVisible('sound', false));
  await focus(page, 'tips');
  await page.evaluate(() => (window as any).uiHarness.setValue('dialog', true));
  await page.keyboard.press('Space'); await expect.poll(() => value(page, 'tips')).toBe(false);
  await page.keyboard.press('Tab'); await expect(page.locator('#canvas-host canvas')).toHaveAttribute('data-focused-component', 'dialog-close');
  await page.keyboard.press('Enter');
  await expect(page.locator('#events li.activate').filter({ hasText: 'dialog-close' })).toHaveCount(1);
});
