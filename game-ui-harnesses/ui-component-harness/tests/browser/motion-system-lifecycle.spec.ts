import { expect, test, type Page } from '@playwright/test';
import { fixtureDocument } from '../../src/fixtures.ts';

type Bounds = { x: number; y: number; width: number; height: number };
type RuntimeNode = { id: string; bounds: Bounds; visible: boolean; value?: unknown };
type RuntimeInspection = { nodes: RuntimeNode[] };
type SystemNode = { id: string; visible: boolean; presentation: Record<string, number> };
type SystemInspection = { scheduler: { running: number; pendingFrame: boolean }; nodes: SystemNode[] };

function findNode(document: any, id: string): any {
  const queue = [document.root];
  while (queue.length) {
    const node = queue.shift();
    if (node.id === id) return node;
    if ('children' in node) queue.push(...node.children);
  }
  throw new Error(`missing ${id}`);
}

async function openGallery(page: Page): Promise<void> {
  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-composite');
  await page.locator('#scenario').selectOption('gallery');
  await page.locator('#load-example').click();
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-gallery');
  await expect(page.locator('#error')).toBeHidden();
}

async function loadDocument(page: Page, document: unknown): Promise<void> {
  await page.evaluate(async input => { await (window as any).uiHarness.loadDocument(input); }, document);
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-gallery');
  await expect(page.locator('#error')).toBeHidden();
}

async function inspect(page: Page): Promise<RuntimeInspection> {
  return page.evaluate(() => (window as any).uiHarness.inspect());
}

async function inspectSystem(page: Page): Promise<SystemInspection> {
  return page.evaluate(() => (window as any).uiHarness.inspectMotionSystem());
}

function runtimeNode(snapshot: RuntimeInspection, id: string): RuntimeNode {
  const node = snapshot.nodes.find(item => item.id === id);
  if (!node) throw new Error(`missing runtime inspection for ${id}`);
  return node;
}

function systemNode(snapshot: SystemInspection, id: string): SystemNode {
  const node = snapshot.nodes.find(item => item.id === id);
  if (!node) throw new Error(`missing motion inspection for ${id}`);
  return node;
}

async function nodePoint(page: Page, id: string, xRatio = 0.5, yRatio = 0.5): Promise<{ x: number; y: number; node: RuntimeNode; scaleX: number; scaleY: number }> {
  const node = runtimeNode(await inspect(page), id);
  await page.evaluate(({ bounds }) => {
    const area = document.querySelector<HTMLElement>('.canvas-area');
    if (!area) throw new Error('missing canvas area');
    area.scrollTop = Math.max(0, bounds.y + bounds.height / 2 - area.clientHeight / 2);
    area.scrollLeft = Math.max(0, bounds.x + bounds.width / 2 - area.clientWidth / 2);
  }, node);
  const canvas = page.locator('#canvas-host canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('missing canvas bounds');
  const canvasSize = await page.evaluate(() => (window as any).uiHarness.getDocument()?.canvas);
  if (!canvasSize) throw new Error('missing canvas size');
  return {
    x: box.x + (node.bounds.x + node.bounds.width * xRatio) * box.width / canvasSize.width,
    y: box.y + (node.bounds.y + node.bounds.height * yRatio) * box.height / canvasSize.height,
    node,
    scaleX: box.width / canvasSize.width,
    scaleY: box.height / canvasSize.height,
  };
}

async function clickNode(page: Page, id: string, xRatio = 0.5, yRatio = 0.5): Promise<void> {
  const point = await nodePoint(page, id, xRatio, yRatio);
  await page.mouse.click(point.x, point.y);
}

async function value(page: Page, id: string): Promise<unknown> {
  return page.evaluate(id => {
    const queue = [(window as any).uiHarness.getDocument().root];
    while (queue.length) {
      const node = queue.shift();
      if (node.id === id) return node.props.value ?? node.props.checked ?? node.props.open;
      if ('children' in node) queue.push(...node.children);
    }
    throw new Error(`missing ${id}`);
  }, id);
}

async function dialogOpen(page: Page, id: string): Promise<boolean> {
  return page.evaluate(id => {
    const queue = [(window as any).uiHarness.getDocument().root];
    while (queue.length) {
      const node = queue.shift();
      if (node.id === id) return node.props.open;
      if ('children' in node) queue.push(...node.children);
    }
    throw new Error(`missing ${id}`);
  }, id);
}

function stackedModalDocument(): any {
  const document = fixtureDocument('gallery') as any;
  const first = findNode(document, 'dialog');
  const second = structuredClone(first);
  second.id = 'dialog-second';
  second.props.title = 'Second modal';
  second.children[0].id = 'dialog-second-copy';
  second.children[1].id = 'dialog-second-close';
  document.root.children.push(second);
  return document;
}

function nestedModalDocument(): any {
  const document = fixtureDocument('gallery') as any;
  const rootChildren = document.root.children as any[];
  const dialogIndex = rootChildren.findIndex(node => node.id === 'dialog');
  const [dialog] = rootChildren.splice(dialogIndex, 1);
  const balance = findNode(document, 'balance');
  dialog.layout = { x: 80, y: 90, width: 390, height: 235 };
  balance.children.push(dialog);
  return document;
}

function tabSelectDocument(): any {
  const document = fixtureDocument('gallery') as any;
  const rootChildren = document.root.children as any[];
  const selectIndex = rootChildren.findIndex(node => node.id === 'region');
  const [select] = rootChildren.splice(selectIndex, 1);
  select.layout = { x: 14, y: 61, width: 242, height: 46 };
  const tabs = findNode(document, 'details');
  const infoIndex = tabs.children.findIndex((node: any) => node.id === 'page-info');
  tabs.children.splice(infoIndex, 1, select);
  tabs.props.tabs[0].contentId = 'region';
  return document;
}

test.beforeEach(async ({ page }) => { await openGallery(page); });

test('an unbound real hover preserves a settled subset exit presentation channel', async ({ page }) => {
  const subset = {
    motionSystemVersion: '0.1', id: 'subset-exit', style: 'premium',
    bindings: [{ targetId: 'confirm', componentType: 'Button', actions: ['exit'] }],
  };
  await page.evaluate(input => (window as any).uiHarness.setMotionSystem(input), subset);
  await page.evaluate(() => (window as any).uiHarness.playMotionAction('confirm', 'exit'));
  await expect.poll(async () => (await inspectSystem(page)).scheduler.running).toBe(0);
  expect(systemNode(await inspectSystem(page), 'confirm').presentation.entryAlpha).toBe(0);

  // Exit presentation never disables Button input. This real pointer enter is an
  // unbound hover event and must not reset the independent entry channel.
  await page.mouse.move(0, 0);
  const button = await nodePoint(page, 'confirm');
  await page.mouse.move(button.x, button.y);
  expect(systemNode(await inspectSystem(page), 'confirm').presentation.entryAlpha).toBe(0);
});

test('programmatic Input state rebases the focused native editing session before a real keystroke', async ({ page }) => {
  await clickNode(page, 'name');
  await page.evaluate(() => (window as any).uiHarness.setValue('name', 'Server'));
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect.poll(() => value(page, 'name')).toBe('Server!');
});

test('programmatic Slider state wins when a captured pointer releases', async ({ page }) => {
  const slider = await nodePoint(page, 'volume');
  const x75 = slider.x - slider.node.bounds.width * slider.scaleX / 2
    + (14 + (slider.node.bounds.width - 28) * 0.75) * slider.scaleX;
  await page.mouse.move(x75, slider.y);
  await page.mouse.down();
  await page.evaluate(() => (window as any).uiHarness.setValue('volume', 80));
  await page.mouse.up();
  await expect.poll(() => value(page, 'volume')).toBe(80);
});

test('hidden modal backdrops release input and the visually latest modal owns its close control', async ({ page }) => {
  await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setValue('dialog', true); api.setVisible('dialog', false);
  });
  expect(runtimeNode(await inspect(page), 'dialog').visible).toBe(false);
  await clickNode(page, 'sound');
  await expect.poll(() => value(page, 'sound')).toBe(false);

  await loadDocument(page, stackedModalDocument());
  await page.evaluate(() => {
    const api = (window as any).uiHarness;
    // dialog-second is later in document order, then the earlier dialog is
    // opened last and therefore painted above it.
    api.setValue('dialog-second', true); api.setValue('dialog', true);
  });
  await clickNode(page, 'dialog-close');
  await expect.poll(() => dialogOpen(page, 'dialog')).toBe(false);
  await expect.poll(() => dialogOpen(page, 'dialog-second')).toBe(true);
});

test('a nested modal follows its legacy animated ancestor while portaled', async ({ page }) => {
  await loadDocument(page, nestedModalDocument());
  const timeline = {
    motionVersion: '0.1', id: 'nested-modal-ancestor', scope: 'component', duration: 100,
    trigger: { type: 'manual' }, tracks: [
      { targetId: 'balance', property: 'x', start: 0, duration: 100, from: 0, to: 120, easing: 'linear' },
      { targetId: 'balance', property: 'scaleX', start: 0, duration: 100, from: 1, to: 1.25, easing: 'linear' },
      { targetId: 'balance', property: 'scaleY', start: 0, duration: 100, from: 1, to: 1.25, easing: 'linear' },
      { targetId: 'balance', property: 'rotation', start: 0, duration: 100, from: 0, to: 0.2, easing: 'linear' },
    ],
  };
  await page.locator('[data-tab=motion]').click();
  await page.locator('#motion-editor').fill(JSON.stringify(timeline));
  await page.locator('#motion-apply').click();
  await page.evaluate(() => (window as any).uiHarness.seekMotion(0));
  await page.evaluate(() => (window as any).uiHarness.setValue('dialog', true));
  const before = runtimeNode(await inspect(page), 'dialog').bounds;

  await page.evaluate(() => (window as any).uiHarness.seekMotion(100));
  const after = runtimeNode(await inspect(page), 'dialog').bounds;
  expect(after.width).toBeGreaterThan(before.width * 1.1);
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(40);

  // The transformed portaled descendant must still receive its real close input.
  await clickNode(page, 'dialog-close');
  await expect.poll(() => dialogOpen(page, 'dialog')).toBe(false);
});

test('deactivating a Tabs page closes its Select overlay through the public motion inspection', async ({ page }) => {
  await loadDocument(page, tabSelectDocument());
  await clickNode(page, 'region');
  expect(systemNode(await inspectSystem(page), 'region').presentation.popupOpen).toBe(1);

  await clickNode(page, 'details', 0.75, 24 / 177);
  await expect.poll(async () => runtimeNode(await inspect(page), 'region').visible).toBe(false);
  await expect.poll(async () => systemNode(await inspectSystem(page), 'region').presentation.popupOpen).toBe(0);
});
