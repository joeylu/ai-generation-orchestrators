import { expect, test, type Page } from '@playwright/test';

type Bounds = { x: number; y: number; width: number; height: number };
type InspectedNode = { id: string; type: string; bounds: Bounds; visible: boolean; enabled: boolean | null; value?: unknown };
type Inspection = { instances: number; resources: number; nodes: InspectedNode[] };

async function inspection(page: Page): Promise<Inspection> {
  return page.evaluate(() => (window as any).uiHarness.inspect());
}

async function node(page: Page, id: string): Promise<InspectedNode> {
  const result = (await inspection(page)).nodes.find(item => item.id === id);
  if (!result) throw new Error(`missing inspected node ${id}`);
  return result;
}

async function nodePoint(page: Page, id: string, xRatio = 0.5, yRatio = 0.5): Promise<{ x: number; y: number; bounds: Bounds; scaleX: number; scaleY: number }> {
  const current = await node(page, id);
  await page.evaluate(({ bounds }) => {
    const area = document.querySelector<HTMLElement>('.canvas-area');
    if (!area) throw new Error('missing canvas area');
    area.scrollTop = Math.max(0, bounds.y + bounds.height / 2 - area.clientHeight / 2);
    area.scrollLeft = Math.max(0, bounds.x + bounds.width / 2 - area.clientWidth / 2);
  }, current);
  const canvas = page.locator('#canvas-host canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const canvasSize = await page.evaluate(() => {
    const document = (window as any).uiHarness.getDocument();
    return document?.schemaVersion === '0.2' ? document.canvas : undefined;
  });
  if (!canvasSize) throw new Error('missing v0.2 canvas size');
  return {
    x: box.x + (current.bounds.x + current.bounds.width * xRatio) * box.width / canvasSize.width,
    y: box.y + (current.bounds.y + current.bounds.height * yRatio) * box.height / canvasSize.height,
    bounds: current.bounds,
    scaleX: box.width / canvasSize.width,
    scaleY: box.height / canvasSize.height,
  };
}

async function clickNode(page: Page, id: string, xRatio = 0.5, yRatio = 0.5): Promise<void> {
  const point = await nodePoint(page, id, xRatio, yRatio);
  await page.mouse.click(point.x, point.y);
}

async function expectNodeValue(page: Page, id: string, value: unknown): Promise<void> {
  await expect.poll(async () => (await node(page, id)).value).toEqual(value);
}

async function loadGallery(page: Page): Promise<void> {
  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-composite');
  await page.locator('#scenario').selectOption('gallery');
  await page.locator('#load-example').click();
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-gallery');
  await expect.poll(async () => (await inspection(page)).nodes.length).toBeGreaterThanOrEqual(30);
  await expect(page.locator('#lifecycle')).toHaveText('运行中');
  await expect(page.locator('#error')).toBeHidden();
}

test.beforeEach(async ({ page }) => { await loadGallery(page); });

test('gallery mounts a live canvas with every supported component type', async ({ page }) => {
  const live = await inspection(page);
  expect(live.instances).toBe(1);
  expect(new Set(live.nodes.map(item => item.type))).toEqual(new Set([
    'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select',
    'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
  ]));
  await expect(page.locator('#canvas-host canvas')).toBeVisible();
  await expect(page.locator('#node-count')).not.toHaveText('0');
});

test('mouse interaction updates switch, checkbox, and radio-group values', async ({ page }) => {
  await clickNode(page, 'sound');
  await expectNodeValue(page, 'sound', false);

  await clickNode(page, 'tips');
  await expectNodeValue(page, 'tips', true);

  await clickNode(page, 'quality', 0.5, 0.22);
  await expectNodeValue(page, 'quality', 'quality-low');
  await expect(page.locator('#events')).toContainText('quality-low');
});

test('slider commits pointer input on release, cancels Escape, and ignores mouse input once disabled', async ({ page }) => {
  const start = await node(page, 'volume');
  expect(start.value).toBe(40);
  const point = await nodePoint(page, 'volume');
  const sliderX = point.x - point.bounds.width * point.scaleX / 2 + (14 + (point.bounds.width - 28) * 0.75) * point.scaleX;

  await page.mouse.move(sliderX, point.y); await page.mouse.down(); await page.keyboard.press('Escape'); await page.mouse.up();
  await expectNodeValue(page, 'volume', 40);

  await page.mouse.move(sliderX, point.y); await page.mouse.down(); await page.mouse.up();
  await expectNodeValue(page, 'volume', 75);

  await page.evaluate(() => (window as any).uiHarness.setEnabled('volume', false));
  expect((await node(page, 'volume')).enabled).toBe(false);
  await page.mouse.move(point.x - point.bounds.width * point.scaleX / 2 + 14 * point.scaleX, point.y); await page.mouse.down(); await page.mouse.up();
  await expectNodeValue(page, 'volume', 75);
});

test('native keyboard editing honors the runtime readOnly state', async ({ page }) => {
  await clickNode(page, 'name');
  await page.keyboard.press('Control+A'); await page.keyboard.type('Ada');
  await expectNodeValue(page, 'name', 'Ada');

  await page.evaluate(async () => {
    const api = (window as any).uiHarness;
    const document = api.getDocument();
    const input = document.root.children.find((item: any) => item.id === 'name');
    input.props.readOnly = true;
    await api.loadDocument(document);
  });
  await expect.poll(async () => (await node(page, 'name')).value).toBe('Ada');
  await clickNode(page, 'name');
  await page.keyboard.press('Control+A'); await page.keyboard.type('Blocked');
  await expectNodeValue(page, 'name', 'Ada');
});

test('select popup chooses a row and scroll/list/tabs respond to canvas input', async ({ page }) => {
  await clickNode(page, 'region');
  const select = await node(page, 'region');
  const popup = await nodePoint(page, 'region');
  const rowHeight = Math.max(32, select.bounds.height);
  const popupY = popup.y - select.bounds.height * popup.scaleY / 2 + (select.bounds.height + 2 + rowHeight * 1.5) * popup.scaleY;
  await page.mouse.click(popup.x, popupY);
  await expectNodeValue(page, 'region', 'region-west');

  const scrollPoint = await nodePoint(page, 'scroll');
  await page.mouse.move(scrollPoint.x, scrollPoint.y); await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await node(page, 'scroll')).value).toEqual({ x: 0, y: 120 });

  await clickNode(page, 'inventory', 0.5, 72 / 177);
  await expectNodeValue(page, 'inventory', 'item-gem');

  await clickNode(page, 'details', 0.75, 24 / 177);
  await expectNodeValue(page, 'details', 'tab-stats');
  await expect.poll(async () => (await node(page, 'page-info')).visible).toBe(false);
  await expect.poll(async () => (await node(page, 'page-stats')).visible).toBe(true);
});

test('modal dialog blocks background controls and its canvas close button restores interaction', async ({ page }) => {
  await page.locator('#show-dialog').click();
  await expect.poll(async () => (await node(page, 'dialog')).visible).toBe(true);

  await clickNode(page, 'sound');
  await expectNodeValue(page, 'sound', true);

  await clickNode(page, 'dialog-close');
  await expect.poll(async () => (await node(page, 'dialog')).visible).toBe(false);
  await clickNode(page, 'sound');
  await expectNodeValue(page, 'sound', false);
});
