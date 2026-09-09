import { expect, test, type Page } from '@playwright/test';
import { createBundle } from '../../src/bundle.ts';

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

test('a Button has visible press feedback without a motion binding', async ({ page }) => {
  const canvas = page.locator('#canvas-host canvas'), before = await canvas.screenshot();
  const point = await nodePoint(page, 'confirm'); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.waitForTimeout(50);
  const pressed = await canvas.screenshot(); expect(pressed.equals(before)).toBe(false);
  await page.mouse.up(); await expect(page.locator('#events')).toContainText('"type":"activate","id":"confirm"');
});

test('mouse interaction updates switch, checkbox, and radio-group values', async ({ page }) => {
  await clickNode(page, 'sound');
  await expectNodeValue(page, 'sound', false);

  await clickNode(page, 'tips');
  await expectNodeValue(page, 'tips', true);

  const radioBefore = await page.locator('#canvas-host canvas').screenshot(); await clickNode(page, 'quality', 0.5, 0.22);
  await expectNodeValue(page, 'quality', 'quality-low');
  const radioAfter = await page.locator('#canvas-host canvas').screenshot(); expect(radioAfter.equals(radioBefore)).toBe(false);
  await expect(page.locator('#events')).toContainText('quality-low');
});

test('raster-layered Switch moves its thumb without a bound motion system', async ({ page }) => {
  const style = { backgroundColor: '#000000', borderColor: '#000000', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 12, fontWeight: 'normal' as const, opacity: 1 };
  const document = {
    schemaVersion: '0.2' as const, id: 'raster-switch', canvas: { width: 241, height: 129 },
    root: { id: 'root', type: 'Container' as const, layout: { x: 0, y: 0, width: 241, height: 129 }, props: { style }, children: [{
      id: 'raster-toggle', type: 'Switch' as const, layout: { x: 0, y: 0, width: 241, height: 129 },
      props: { label: '', checked: true, enabled: true, style, appearance: {
        trackImage: 'fixtures/raster-track.svg', thumbImage: 'fixtures/raster-thumb.svg', sourceCanvas: { width: 241, height: 129 },
        thumbPositions: { off: { x: 18, y: 18 }, on: { x: 130, y: 18 } },
      } },
    }] },
  };
  const encode = (value: string) => new TextEncoder().encode(value);
  const bundle = await createBundle(document, [
    { path: 'fixtures/raster-track.svg', mime: 'image/svg+xml', bytes: encode('<svg xmlns="http://www.w3.org/2000/svg" width="241" height="129"><rect x="8" y="8" width="225" height="113" rx="56" fill="#4f8f2f"/></svg>') },
    { path: 'fixtures/raster-thumb.svg', mime: 'image/svg+xml', bytes: encode('<svg xmlns="http://www.w3.org/2000/svg" width="93" height="91"><ellipse cx="46.5" cy="45.5" rx="43" ry="42" fill="white" stroke="#173d18" stroke-width="4"/></svg>') },
  ], { kind: 'programmatic-fixture', description: 'Deterministic SVG layers for raster Switch browser regression.' });
  await page.evaluate(value => (window as any).uiHarness.importBundle(value), bundle);
  await expectNodeValue(page, 'raster-toggle', true);
  const before = await page.locator('#canvas-host canvas').screenshot();
  await clickNode(page, 'raster-toggle');
  await expectNodeValue(page, 'raster-toggle', false);
  const after = await page.locator('#canvas-host canvas').screenshot();
  expect(after.equals(before)).toBe(false);
});

test('raster-layered Select opens its popup, changes value, and exports all layers', async ({ page }) => {
  const style = { backgroundColor: '#000000', borderColor: '#315322', borderWidth: 0, cornerRadius: 0, textColor: '#344522', fontFamily: 'sans-serif', fontSize: 24, fontWeight: 'bold' as const, opacity: 1 };
  const document = {
    schemaVersion: '0.2' as const, id: 'raster-select', canvas: { width: 300, height: 340 },
    root: { id: 'root', type: 'Container' as const, layout: { x: 0, y: 0, width: 300, height: 340 }, props: { style }, children: [{
      id: 'raster-select-control', type: 'Select' as const, layout: { x: 0, y: 0, width: 300, height: 100 },
      props: { selectedId: 'high', options: [{ id: 'high', label: 'High' }, { id: 'medium', label: 'Medium' }, { id: 'smooth', label: 'Smooth' }], enabled: true, style, appearance: {
        fieldImage: 'fixtures/select-field.svg', arrowImage: 'fixtures/select-arrow.svg', popupImage: 'fixtures/select-popup.svg',
        sourceCanvas: { width: 300, height: 100 }, labelLayout: { x: 60, y: 18, width: 150, height: 64 },
        arrowLayout: { x: 230, y: 40, width: 30, height: 21 }, popupCanvas: { width: 300, height: 225 }, popupGap: 2,
      } },
    }] },
  };
  const encode = (value: string) => new TextEncoder().encode(value);
  const bundle = await createBundle(document, [
    { path: 'fixtures/select-field.svg', mime: 'image/svg+xml', bytes: encode('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect x="5" y="10" width="290" height="80" rx="35" fill="#f2e5c5" stroke="#8d7b4f" stroke-width="4"/></svg>') },
    { path: 'fixtures/select-arrow.svg', mime: 'image/svg+xml', bytes: encode('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="21"><path d="M3 3l12 14L27 3" fill="none" stroke="#315322" stroke-width="5"/></svg>') },
    { path: 'fixtures/select-popup.svg', mime: 'image/svg+xml', bytes: encode('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="225"><rect x="3" y="3" width="294" height="219" rx="18" fill="#f2e5c5" stroke="#8d7b4f" stroke-width="4"/><path d="M8 75h284M8 150h284" stroke="#b6a477" stroke-width="2"/></svg>') },
  ], { kind: 'programmatic-fixture', description: 'Deterministic SVG layers for raster Select browser regression.' });
  await page.evaluate(value => (window as any).uiHarness.importBundle(value), bundle);
  await clickNode(page, 'raster-select-control');
  const open = await page.locator('#canvas-host canvas').screenshot();
  const point = await nodePoint(page, 'raster-select-control', 0.5, 0.5);
  await page.mouse.click(point.x, point.y + (50 + 2 + 112.5) * point.scaleY);
  await expectNodeValue(page, 'raster-select-control', 'medium');
  const closed = await page.locator('#canvas-host canvas').screenshot();
  expect(closed.equals(open)).toBe(false);
  const exported = await page.evaluate(() => (window as any).uiHarness.exportBundle());
  expect(exported.resources.filter((resource: { path: string }) => resource.path.includes('select-'))).toHaveLength(3);
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

  await page.mouse.move(scrollPoint.x, scrollPoint.y); await page.mouse.down();
  await page.mouse.move(scrollPoint.x, scrollPoint.y + 40 * scrollPoint.scaleY); await page.mouse.up();
  await expect.poll(async () => (await node(page, 'scroll')).value).toEqual({ x: 0, y: 80 });

  await page.mouse.move(scrollPoint.x, scrollPoint.y); await page.mouse.down();
  await page.mouse.move(scrollPoint.x, scrollPoint.y - 30 * scrollPoint.scaleY); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => (await node(page, 'scroll')).value).toEqual({ x: 0, y: 80 });

  const listBefore = await page.locator('#canvas-host canvas').screenshot(); await clickNode(page, 'inventory', 0.5, 72 / 177);
  await expectNodeValue(page, 'inventory', 'item-gem');
  const listAfter = await page.locator('#canvas-host canvas').screenshot(); expect(listAfter.equals(listBefore)).toBe(false);

  const tabsBefore = await page.locator('#canvas-host canvas').screenshot(); await clickNode(page, 'details', 0.75, 24 / 177);
  await expectNodeValue(page, 'details', 'tab-stats');
  const tabsAfter = await page.locator('#canvas-host canvas').screenshot(); expect(tabsAfter.equals(tabsBefore)).toBe(false);
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
