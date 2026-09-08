import { expect, test, type Page } from '@playwright/test';
import { fixtureDocument } from '../../src/fixtures.ts';
import { compileMotionSystem, motionSystemCatalog, validateMotionSystem } from '../../src/motion-system.ts';
import { walkNodes, type UiNodeType } from '../../src/tree-contract.ts';

type MotionStyle = 'playful' | 'premium' | 'corporate';
type Presentation = Record<string, number>;
type SystemNode = { id: string; type: UiNodeType; visible: boolean; presentation: Presentation };
type SystemInspection = {
  style: MotionStyle | null;
  systemId: string | null;
  scheduler: { running: number; pendingFrame: boolean; destroyed: boolean };
  nodes: SystemNode[];
};
type Bounds = { x: number; y: number; width: number; height: number };
type RuntimeNode = { id: string; bounds: Bounds; value?: unknown; enabled?: boolean | null; visible: boolean };

const styles: readonly MotionStyle[] = ['playful', 'premium', 'corporate'];
const actionsByType: Readonly<Record<UiNodeType, readonly string[]>> = {
  Image: ['enter', 'exit', 'emphasis'],
  Text: ['enter', 'exit', 'emphasis'],
  Container: ['enter', 'exit', 'stagger'],
  Button: ['enter', 'exit', 'emphasis', 'press', 'hover'],
  Switch: ['enter', 'exit', 'change', 'hover'],
  CheckBox: ['enter', 'exit', 'change', 'hover'],
  RadioGroup: ['enter', 'exit', 'change', 'hover'],
  Input: ['enter', 'exit', 'focus'],
  Select: ['enter', 'exit', 'open', 'close', 'change', 'hover'],
  ProgressBar: ['enter', 'exit', 'progress'],
  Slider: ['enter', 'exit', 'progress', 'hover'],
  ScrollView: ['enter', 'exit', 'scroll'],
  List: ['enter', 'exit', 'change', 'stagger'],
  Panel: ['enter', 'exit', 'stagger'],
  Dialog: ['enter', 'exit', 'open', 'close'],
  Tabs: ['enter', 'exit', 'change'],
};

/** Choose gallery instances whose real child content makes composite feedback observable. */
const preferredGalleryTargets: Partial<Record<UiNodeType, string>> = {
  Image: 'balance-plate', Text: 'heading', Container: 'balance', Button: 'confirm',
  Switch: 'sound', CheckBox: 'tips', RadioGroup: 'quality', Input: 'name', Select: 'region',
  ProgressBar: 'progress', Slider: 'volume', ScrollView: 'scroll', List: 'inventory',
  Panel: 'footer-panel', Dialog: 'dialog', Tabs: 'details',
};

const readDocumentNode = (document: any, id: string): any => {
  const queue = [document.root];
  while (queue.length) {
    const node = queue.shift();
    if (node.id === id) return node;
    if ('children' in node) queue.push(...node.children);
  }
  throw new Error(`missing document node ${id}`);
};

function galleryTargets(): { type: UiNodeType; id: string }[] {
  const nodes = walkNodes(fixtureDocument('gallery'));
  const types = Object.keys(actionsByType) as UiNodeType[];
  return types.map(type => {
    const node = nodes.find(item => item.id === preferredGalleryTargets[type]) ?? nodes.find(item => item.type === type);
    expect(node?.type).toBe(type);
    return { type, id: node!.id };
  });
}

function targetId(type: UiNodeType): string {
  const target = galleryTargets().find(item => item.type === type);
  if (!target) throw new Error(`missing gallery target for ${type}`);
  return target.id;
}

function system(style: MotionStyle, id = `gallery-${style}`) {
  return compileMotionSystem({ id, style, targets: galleryTargets().map(target => target.id) }, fixtureDocument('gallery'));
}

function fullSystem(style: MotionStyle, id: string) {
  const document = fixtureDocument('gallery');
  return compileMotionSystem({ id, style, targets: walkNodes(document).map(node => node.id) }, document);
}

function systemNode(snapshot: SystemInspection, id: string): SystemNode {
  const node = snapshot.nodes.find(item => item.id === id);
  if (!node) throw new Error(`missing motion inspection for ${id}`);
  return node;
}

function runtimeNode(snapshot: { nodes: RuntimeNode[] }, id: string): RuntimeNode {
  const node = snapshot.nodes.find(item => item.id === id);
  if (!node) throw new Error(`missing runtime inspection for ${id}`);
  return node;
}

async function openGallery(page: Page): Promise<void> {
  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-composite');
  await page.locator('#scenario').selectOption('gallery');
  await page.locator('#load-example').click();
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-gallery');
  await expect(page.locator('#lifecycle')).toHaveText('运行中');
  await expect(page.locator('#error')).toBeHidden();
}

async function inspectSystem(page: Page): Promise<SystemInspection> {
  return page.evaluate(() => (window as any).uiHarness.inspectMotionSystem());
}

async function inspectRuntime(page: Page): Promise<{ nodes: RuntimeNode[] }> {
  return page.evaluate(() => (window as any).uiHarness.inspect());
}

async function install(page: Page, input: ReturnType<typeof system>): Promise<void> {
  await page.evaluate(input => (window as any).uiHarness.setMotionSystem(input), input);
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getMotionSystem()?.id)).toBe(input.id);
}

async function play(page: Page, id: string, action: string): Promise<void> {
  const running = await page.evaluate(({ id, action }) => {
    const api = (window as any).uiHarness;
    api.playMotionAction(id, action);
    return api.inspectMotionSystem().scheduler.running;
  }, { id, action });
  expect(running).toBeGreaterThan(0);
}

async function waitForMotion(page: Page): Promise<void> {
  await waitForIdle(page);
}

async function waitForIdle(page: Page): Promise<void> {
  // A timer-backed condition yields to the native WebGL compositor between
  // observations; it never advances or replaces the scheduler clock.
  await page.waitForFunction(() => {
    const scheduler = (window as any).uiHarness.inspectMotionSystem().scheduler;
    return scheduler.running === 0 && scheduler.pendingFrame === false;
  }, undefined, { polling: 100 });
}

async function nodePoint(page: Page, id: string, xRatio = 0.5, yRatio = 0.5): Promise<{ x: number; y: number; bounds: Bounds; scaleX: number; scaleY: number }> {
  const current = runtimeNode(await inspectRuntime(page), id);
  await page.evaluate(({ bounds }) => {
    const area = document.querySelector<HTMLElement>('.canvas-area');
    if (!area) throw new Error('missing canvas area');
    area.scrollTop = Math.max(0, bounds.y + bounds.height / 2 - area.clientHeight / 2);
    area.scrollLeft = Math.max(0, bounds.x + bounds.width / 2 - area.clientWidth / 2);
  }, current);
  const canvas = page.locator('#canvas-host canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounds');
  const size = await page.evaluate(() => (window as any).uiHarness.getDocument()?.canvas);
  if (!size) throw new Error('missing canvas size');
  return {
    x: box.x + (current.bounds.x + current.bounds.width * xRatio) * box.width / size.width,
    y: box.y + (current.bounds.y + current.bounds.height * yRatio) * box.height / size.height,
    bounds: current.bounds,
    scaleX: box.width / size.width,
    scaleY: box.height / size.height,
  };
}

async function clickNode(page: Page, id: string, xRatio = 0.5, yRatio = 0.5): Promise<void> {
  const point = await nodePoint(page, id, xRatio, yRatio);
  await page.mouse.click(point.x, point.y);
}

/**
 * Screenshot the rendered composite Button icon and locate the known teal
 * fixture gem. This deliberately reads compositor pixels rather than the
 * WebGL canvas (which does not preserve its drawing buffer for 2D readback).
 */
async function renderedGemBounds(page: Page): Promise<{ fingerprint: number; count: number; minX: number; minY: number; maxX: number; maxY: number }> {
  await nodePoint(page, 'confirm');
  const clip = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    const node = api.inspect().nodes.find((item: RuntimeNode) => item.id === 'confirm');
    const documentState = api.getDocument();
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas-host canvas');
    if (!node || !documentState || !canvas) throw new Error('missing composite Button canvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / documentState.canvas.width, scaleY = rect.height / documentState.canvas.height;
    return { x: rect.left + node.bounds.x * scaleX, y: rect.top + node.bounds.y * scaleY, width: 70 * scaleX, height: node.bounds.height * scaleY };
  });
  const screenshot = await page.screenshot({ clip });
  return page.evaluate(async encoded => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const copy = document.createElement('canvas'); copy.width = image.naturalWidth; copy.height = image.naturalHeight;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D screenshot context unavailable');
    context.drawImage(image, 0, 0);
    const { width, height } = copy, pixels = context.getImageData(0, 0, width, height).data;
    let count = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    let fingerprint = 2166136261;
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      const offset = (row * width + column) * 4;
      const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2], alpha = pixels[offset + 3];
      fingerprint = Math.imul(fingerprint ^ red, 16777619) >>> 0;
      fingerprint = Math.imul(fingerprint ^ green, 16777619) >>> 0;
      fingerprint = Math.imul(fingerprint ^ blue, 16777619) >>> 0;
      fingerprint = Math.imul(fingerprint ^ alpha, 16777619) >>> 0;
      // The fixture's filled gem path is #57d9bd. Keep this narrow enough to
      // exclude the Button's pale fill and any antialiased label pixels.
      if (alpha > 0 && red >= 60 && red <= 120 && green >= 190 && green <= 240 && blue >= 160 && blue <= 220) {
        count += 1; minX = Math.min(minX, column); minY = Math.min(minY, row); maxX = Math.max(maxX, column); maxY = Math.max(maxY, row);
      }
    }
    if (count === 0) throw new Error('composite Button gem pixels were not rendered');
    return { fingerprint, count, minX, minY, maxX, maxY };
  }, screenshot.toString('base64'));
}

/** Hash a rendered node region from compositor pixels for non-screenshot-only visual assertions. */
async function renderedNodeFingerprint(page: Page, id: string, height: number): Promise<number> {
  const clip = await page.evaluate(({ id, height }) => {
    const api = (window as any).uiHarness;
    const node = api.inspect().nodes.find((item: RuntimeNode) => item.id === id);
    const documentState = api.getDocument();
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas-host canvas');
    if (!node || !documentState || !canvas) throw new Error(`missing rendered node ${id}`);
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / documentState.canvas.width, scaleY = rect.height / documentState.canvas.height;
    return { x: rect.left + node.bounds.x * scaleX, y: rect.top + node.bounds.y * scaleY, width: node.bounds.width * scaleX, height: height * scaleY };
  }, { id, height });
  const screenshot = await page.screenshot({ clip });
  return page.evaluate(async encoded => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const copy = document.createElement('canvas'); copy.width = image.naturalWidth; copy.height = image.naturalHeight;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D screenshot context unavailable');
    context.drawImage(image, 0, 0);
    let fingerprint = 2166136261;
    for (const value of context.getImageData(0, 0, copy.width, copy.height).data) fingerprint = Math.imul(fingerprint ^ value, 16777619) >>> 0;
    return fingerprint;
  }, screenshot.toString('base64'));
}

test('catalog and compiler validate all 48 style/component bindings without mutating input', () => {
  const ui = fixtureDocument('gallery');
  const catalog = motionSystemCatalog();
  expect(catalog.motionSystemVersion).toBe('0.1');
  expect(Object.keys(catalog.profiles).sort()).toEqual([...styles].sort());
  expect(catalog.components.map(component => [component.componentType, component.actions]))
    .toEqual((Object.keys(actionsByType) as UiNodeType[]).map(type => [type, actionsByType[type]]));

  for (const style of styles) {
    const compiled = system(style, `all-${style}`);
    const before = structuredClone(compiled);
    expect(validateMotionSystem(compiled, ui)).toEqual(compiled);
    expect(compiled).toEqual(before);
    expect(compiled.bindings).toHaveLength(16);
    expect(compiled.bindings.map(binding => [binding.componentType, binding.actions]))
      .toEqual(galleryTargets().map(target => [target.type, actionsByType[target.type]]));
  }

  const duplicated = system('playful', 'duplicate-target');
  duplicated.bindings.push(structuredClone(duplicated.bindings[0]));
  expect(() => validateMotionSystem(duplicated, ui)).toThrow(/DUPLICATE_TARGET/);
});

test('each profile binds every live gallery type and enter, exit, reapply, and clear have deterministic endpoints', async ({ page }) => {
  await openGallery(page);
  const targetIds = galleryTargets().map(target => target.id);
  const imageId = targetId('Image');
  const textId = targetId('Text');
  const containerId = targetId('Container');
  const panelId = targetId('Panel');

  await page.evaluate(() => (window as any).uiHarness.setMotionSystem(null));
  const unboundSelectOpen = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    let error = '';
    try { api.playMotionAction('region', 'open'); } catch (reason) { error = String(reason); }
    const node = api.inspectMotionSystem().nodes.find((item: SystemNode) => item.id === 'region');
    return { error, popupOpen: node?.presentation.popupOpen };
  });
  expect(unboundSelectOpen).toEqual({ error: expect.stringContaining('MOTION_ACTION_NOT_BOUND'), popupOpen: 0 });

  for (const style of styles) {
    const input = system(style, `endpoints-${style}`);
    await install(page, input);
    expect(await page.evaluate(() => (window as any).uiHarness.getMotionSystem())).toEqual(input);
    const initial = await inspectSystem(page);
    expect(initial).toMatchObject({ style, systemId: input.id, scheduler: { running: 0, pendingFrame: false, destroyed: false } });
    expect(initial.nodes.filter(node => targetIds.includes(node.id)).map(node => [node.id, node.type]).sort((left, right) => left[0].localeCompare(right[0])))
      .toEqual(galleryTargets().map(target => [target.id, target.type]).sort((left, right) => left[0].localeCompare(right[0])));
    for (const node of initial.nodes.filter(node => targetIds.includes(node.id))) {
      for (const value of Object.values(node.presentation)) expect(Number.isFinite(value)).toBe(true);
    }

    await play(page, imageId, 'enter');
    await waitForMotion(page);
    expect(systemNode(await inspectSystem(page), imageId)).toMatchObject({ visible: true, presentation: { entryAlpha: 1, entryY: 0 } });

    await play(page, imageId, 'exit');
    await waitForMotion(page);
    expect(systemNode(await inspectSystem(page), imageId)).toMatchObject({ visible: true, presentation: { entryAlpha: 0 } });

    await play(page, textId, 'emphasis');
    await waitForMotion(page);
    expect(systemNode(await inspectSystem(page), textId).presentation.emphasisScale).toBe(1);

    await play(page, containerId, 'stagger');
    await waitForMotion(page);
    expect(systemNode(await inspectSystem(page), containerId).presentation.stagger).toBe(1);
    expect(systemNode(await inspectSystem(page), imageId)).toMatchObject({ visible: true, presentation: { entryAlpha: 1, entryY: 0 } });

    await play(page, panelId, 'stagger');
    await waitForMotion(page);
    const panel = systemNode(await inspectSystem(page), panelId);
    expect(panel.presentation.stagger).toBe(1);
    expect(systemNode(await inspectSystem(page), 'footer-text')).toMatchObject({ visible: true, presentation: { entryAlpha: 1, entryY: 0 } });

    // Re-applying while an action is live cancels the prior scheduler and restores the new system's canonical presentation.
    await play(page, 'confirm', 'enter');
    const reapplied = system(style, `reapplied-${style}`);
    await install(page, reapplied);
    const afterReapply = await inspectSystem(page);
    expect(afterReapply.scheduler).toEqual({ running: 0, pendingFrame: false, destroyed: false });
    expect(systemNode(afterReapply, 'confirm').presentation).toEqual(systemNode(initial, 'confirm').presentation);

    await page.evaluate(() => (window as any).uiHarness.setMotionSystem(null));
    await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getMotionSystem())).toBeNull();
    const cleared = await inspectSystem(page);
    expect(cleared).toMatchObject({ style: null, systemId: null, scheduler: { running: 0, pendingFrame: false, destroyed: false } });
    expect(systemNode(cleared, 'confirm').presentation).toEqual(systemNode(initial, 'confirm').presentation);
  }
});

test('latest entry channel ownership wins across parent interruption and child stagger', async ({ page }) => {
  await openGallery(page);
  await install(page, fullSystem('playful', 'channel-ownership'));

  // The latest parent entry replaces its exit and returns both the parent and its staggered child to their entry endpoint.
  await play(page, 'root', 'exit');
  await play(page, 'root', 'enter');
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'root').presentation.entryAlpha).toBe(1);
  expect(systemNode(await inspectSystem(page), 'heading').presentation.entryAlpha).toBe(1);

  // A direct child exit is newer than an in-flight group stagger and must own that child's entry channel.
  await play(page, 'root', 'stagger');
  await play(page, 'footer-panel', 'exit');
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'footer-panel').presentation.entryAlpha).toBe(0);
});

test('composite Button image pixels follow the Button presentation scale', async ({ page }) => {
  await openGallery(page);
  await install(page, system('playful', 'composite-button-pixels'));
  const button = await nodePoint(page, 'confirm');
  // Keep a real pointer capture active so the renderer cannot settle back to
  // its canonical scale while Playwright takes the compositor screenshot.
  await page.mouse.move(button.x, button.y);
  const before = await renderedGemBounds(page);
  await page.mouse.down();
  await expect.poll(async () => systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBeLessThan(1);
  const pressed = await renderedGemBounds(page);
  expect(pressed.fingerprint).not.toBe(before.fingerprint);
  expect(pressed.maxX - pressed.minX).toBeLessThanOrEqual(before.maxX - before.minX);
  await page.mouse.up();
  await waitForIdle(page);
});

test('Tabs indicator pixels move after an inspected in-flight tabProgress transition', async ({ page }) => {
  await openGallery(page);
  await install(page, system('premium', 'tabs-indicator-pixels'));
  const tabs = await nodePoint(page, 'details', 0.75, 24 / 177);
  const before = await renderedNodeFingerprint(page, 'details', 48);
  await page.mouse.click(tabs.x, tabs.y);
  const inFlight = await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const api = (window as any).uiHarness;
    return api.inspectMotionSystem().nodes.find((node: SystemNode) => node.id === 'details')!.presentation.tabProgress;
  });
  expect(inFlight).toBeGreaterThan(0);
  expect(inFlight).toBeLessThan(1);
  const during = await renderedNodeFingerprint(page, 'details', 48);
  expect(during).not.toBe(before);
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'details').presentation.tabProgress).toBe(1);
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'details').props.activeId).toBe('tab-stats');
});

test('trusted Button press, release, cancellation, and disabling produce one activation in every profile', async ({ page }) => {
  await openGallery(page);

  for (const style of styles) {
    await install(page, system(style, `button-${style}`));
    const button = await nodePoint(page, 'confirm');
    const before = await page.evaluate(() => (window as any).uiHarness.activates());

    await page.mouse.move(button.x, button.y);
    await page.mouse.down();
    await expect.poll(async () => systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBeLessThan(1);
    expect(await page.evaluate(() => (window as any).uiHarness.activates())).toBe(before);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as any).uiHarness.activates())).toBe(before + 1);
    await waitForIdle(page);
    expect(systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBe(1);

    await page.mouse.down();
    await expect.poll(async () => systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBeLessThan(1);
    await page.mouse.move(button.x + Math.max(80, button.bounds.width * button.scaleX + 8), button.y);
    await page.mouse.up();
    await waitForIdle(page);
    expect(await page.evaluate(() => (window as any).uiHarness.activates())).toBe(before + 1);
    expect(systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBe(1);

    await page.evaluate(() => (window as any).uiHarness.setEnabled('confirm', false));
    await page.mouse.click(button.x, button.y);
    expect(await page.evaluate(() => (window as any).uiHarness.activates())).toBe(before + 1);
    expect(systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBe(1);
    await page.evaluate(() => (window as any).uiHarness.setEnabled('confirm', true));
  }
});

test('ancestor hiding, unrelated disabling, dialog teardown, and transformed Slider gestures preserve their own lifecycles', async ({ page }) => {
  await openGallery(page);
  await install(page, system('corporate', 'interruptions'));

  // Hiding an ancestor interrupts an in-flight child exit. Re-showing the ancestor cannot let the old completion hide the child.
  await play(page, 'confirm', 'exit');
  await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setVisible('root', false); api.setVisible('root', true);
  });
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'confirm')).toMatchObject({ visible: true, presentation: { entryAlpha: 1, entryY: 0 } });

  // Manual presentation actions never have authority to revive a host-hidden control.
  await page.evaluate(() => (window as any).uiHarness.setVisible('confirm', false));
  await play(page, 'confirm', 'enter');
  await waitForMotion(page);
  expect(systemNode(await inspectSystem(page), 'confirm')).toMatchObject({ visible: false, presentation: { entryAlpha: 1, entryY: 0 } });
  await page.evaluate(() => (window as any).uiHarness.setVisible('confirm', true));

  // A disabled Switch has no authority to cancel another control's captured pointer gesture.
  const button = await nodePoint(page, 'confirm');
  const activationCount = await page.evaluate(() => (window as any).uiHarness.activates());
  await page.mouse.move(button.x, button.y); await page.mouse.down();
  await expect.poll(async () => systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBeLessThan(1);
  await page.evaluate(() => (window as any).uiHarness.setEnabled('sound', false));
  expect(systemNode(await inspectSystem(page), 'confirm').presentation.pressScale).toBeLessThan(1);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.activates())).toBe(activationCount + 1);
  await waitForIdle(page);
  await page.evaluate(() => (window as any).uiHarness.setEnabled('sound', true));

  // Clearing or replacing a system while a modal closes must clear closing state instead of reviving its blocker later.
  await page.evaluate(() => (window as any).uiHarness.setValue('dialog', true));
  await waitForIdle(page);
  await page.evaluate(() => (window as any).uiHarness.setValue('dialog', false));
  expect(systemNode(await inspectSystem(page), 'dialog').visible).toBe(true);
  await page.evaluate(() => (window as any).uiHarness.setMotionSystem(null));
  await install(page, system('corporate', 'after-dialog-clear'));
  await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setVisible('root', false); api.setVisible('root', true);
  });
  await waitForIdle(page);
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'dialog').props.open).toBe(false);
  expect(systemNode(await inspectSystem(page), 'dialog').visible).toBe(false);

  // Hit testing uses transformed view coordinates: a legacy timeline scale/rotation plus zoom still commits the intended snapped Slider value.
  const transformedSliderMotion = {
    motionVersion: '0.1', id: 'transformed-slider-hit-test', scope: 'component', duration: 100,
    trigger: { type: 'manual' },
    tracks: [
      { targetId: 'volume', property: 'scaleX', start: 0, duration: 100, from: 1, to: 1.18, easing: 'linear' },
      { targetId: 'volume', property: 'scaleY', start: 0, duration: 100, from: 1, to: 1.08, easing: 'linear' },
      { targetId: 'volume', property: 'rotation', start: 0, duration: 100, from: 0, to: 0.12, easing: 'linear' },
    ],
  };
  await page.locator('[data-tab=motion]').click();
  await page.locator('#motion-editor').fill(JSON.stringify(transformedSliderMotion));
  await page.locator('#motion-apply').click();
  await expect(page.locator('#error')).toBeHidden();
  await page.evaluate(() => (window as any).uiHarness.seekMotion(100));
  await page.locator('#zoom').selectOption('1.5');
  await play(page, 'volume', 'hover');
  await waitForMotion(page);
  const slider = await nodePoint(page, 'volume');
  expect(systemNode(await inspectSystem(page), 'volume').presentation.hoverScale).toBeGreaterThan(1);
  const sliderTarget = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    const node = (function () {
      const queue = [api.getDocument().root];
      while (queue.length) { const item = queue.shift(); if (item.id === 'volume') return item; if ('children' in item) queue.push(...item.children); }
    })();
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas-host canvas');
    if (!node || !canvas) throw new Error('missing transformed Slider');
    const rect = canvas.getBoundingClientRect();
    const localX = 14 + (node.layout.width - 28) * 0.75, localY = node.layout.height / 2;
    const angle = 0.12, scaleX = 1.18, scaleY = 1.08;
    const x = node.layout.x + Math.cos(angle) * scaleX * localX - Math.sin(angle) * scaleY * localY;
    const y = node.layout.y + Math.sin(angle) * scaleX * localX + Math.cos(angle) * scaleY * localY;
    return { x: rect.left + x * rect.width / api.getDocument().canvas.width, y: rect.top + y * rect.height / api.getDocument().canvas.height };
  });
  await page.mouse.move(sliderTarget.x, sliderTarget.y); await page.mouse.down(); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (function () {
    const api = (window as any).uiHarness; const queue = [api.getDocument().root];
    while (queue.length) { const node = queue.shift(); if (node.id === 'volume') return node.props.value; if ('children' in node) queue.push(...node.children); }
  })())).toBe(75);
});

test('control-specific presentation follows real gallery input and settles without changing committed values early', async ({ page }) => {
  await openGallery(page);
  for (const [index, style] of styles.entries()) {
    if (index > 0) {
      await page.evaluate(document => (window as any).uiHarness.loadDocument(document), fixtureDocument('gallery'));
      await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-gallery');
    }
    await install(page, system(style, `control-feedback-${style}`));

  await clickNode(page, 'sound');
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'sound').presentation.checked).toBe(0);

  await clickNode(page, 'tips');
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'tips').presentation).toMatchObject({ checked: 1, checkAlpha: 1, checkScale: 1 });

  await clickNode(page, 'quality', 0.5, 0.22);
  await waitForIdle(page);
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'quality').props.selectedId).toBe('quality-low');
  expect(systemNode(await inspectSystem(page), 'quality').presentation.markerAlpha).toBe(1);

  await clickNode(page, 'name');
  await expect.poll(async () => systemNode(await inspectSystem(page), 'name').presentation.focus).toBe(1);
  await page.locator('#scenario').focus();
  await expect.poll(async () => systemNode(await inspectSystem(page), 'name').presentation.focus).toBe(0);

  await clickNode(page, 'region');
  await expect.poll(async () => systemNode(await inspectSystem(page), 'region').presentation.popupOpen).toBe(1);
  await clickNode(page, 'region');
  await expect.poll(async () => systemNode(await inspectSystem(page), 'region').presentation.popupOpen).toBe(0);

  const progress = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setValue('progress', 85);
    const state = api.inspectMotionSystem();
    return {
      value: (function () {
        const queue = [api.getDocument().root];
        while (queue.length) { const node = queue.shift(); if (node.id === 'progress') return node.props.value; if ('children' in node) queue.push(...node.children); }
      })(),
      presentation: state.nodes.find((node: SystemNode) => node.id === 'progress')!.presentation.progress,
    };
  });
  expect(progress.value).toBe(85);
  expect(progress.presentation).toBeLessThan(0.85);
  await waitForMotion(page);
  expect(systemNode(await inspectSystem(page), 'progress').presentation.progress).toBeCloseTo(0.85, 6);

  const slider = await nodePoint(page, 'volume');
  const slider75 = slider.x - slider.bounds.width * slider.scaleX / 2 + (14 + (slider.bounds.width - 28) * 0.75) * slider.scaleX;
  await page.mouse.move(slider75, slider.y);
  await page.mouse.down();
  await expect.poll(async () => systemNode(await inspectSystem(page), 'volume').presentation.sliderValue).toBeGreaterThan(40);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'volume').props.value).toBe(40);
  expect(systemNode(await inspectSystem(page), 'volume').presentation.sliderValue).toBe(40);

  const scrollStart = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setValue('scroll', { x: 0, y: 120 });
    return {
      committed: (function () {
        const queue = [api.getDocument().root];
        while (queue.length) { const node = queue.shift(); if (node.id === 'scroll') return node.props.scrollY; if ('children' in node) queue.push(...node.children); }
      })(),
      presentation: api.inspectMotionSystem().nodes.find((node: SystemNode) => node.id === 'scroll')!.presentation.scrollY,
    };
  });
  expect(scrollStart).toEqual({ committed: 120, presentation: 0 });
  await waitForMotion(page);
  expect(systemNode(await inspectSystem(page), 'scroll').presentation.scrollY).toBe(120);

  await play(page, 'inventory', 'stagger');
  await waitForMotion(page);
  expect(systemNode(await inspectSystem(page), 'inventory').presentation.stagger).toBe(1);
  await clickNode(page, 'inventory', 0.5, 72 / 177);
  await waitForIdle(page);
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'inventory').props.selectedId).toBe('item-gem');
  expect(systemNode(await inspectSystem(page), 'inventory').presentation.listSelection).toBe(1);
  }
});

test('Dialog protects the full canvas through close while Tabs transition header and content', async ({ page }) => {
  await openGallery(page);
  for (const [index, style] of styles.entries()) {
    if (index > 0) {
      await page.evaluate(document => (window as any).uiHarness.loadDocument(document), fixtureDocument('gallery'));
      await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-gallery');
    }
    await install(page, system(style, `modal-and-tabs-${style}`));

  const opening = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setValue('dialog', true);
    const dialog = api.inspectMotionSystem().nodes.find((node: SystemNode) => node.id === 'dialog')!;
    return { open: (function () {
      const queue = [api.getDocument().root];
      while (queue.length) { const node = queue.shift(); if (node.id === 'dialog') return node.props.open; if ('children' in node) queue.push(...node.children); }
    })(), visible: dialog.visible, presentation: dialog.presentation };
  });
  expect(opening.open).toBe(true);
  expect(opening.visible).toBe(true);
  expect(opening.presentation.dialogAlpha).toBeLessThan(1);
  expect(opening.presentation.dialogScale).toBeLessThan(1);

  const soundBefore = readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'sound').props.checked;
  await clickNode(page, 'sound');
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'sound').props.checked).toBe(soundBefore);
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'dialog').presentation).toMatchObject({ dialogAlpha: 1, dialogScale: 1 });

  const soundDuringClose = await nodePoint(page, 'sound');
  const closing = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setValue('dialog', false);
    const dialog = api.inspectMotionSystem().nodes.find((node: SystemNode) => node.id === 'dialog')!;
    return { visible: dialog.visible, alpha: dialog.presentation.dialogAlpha };
  });
  expect(closing.visible).toBe(true);
  await page.mouse.click(soundDuringClose.x, soundDuringClose.y);
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'sound').props.checked).toBe(soundBefore);
  await waitForIdle(page);
  expect(systemNode(await inspectSystem(page), 'dialog').visible).toBe(false);

  await clickNode(page, 'sound');
  await waitForIdle(page);
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'sound').props.checked).toBe(!soundBefore);

  await clickNode(page, 'details', 0.75, 24 / 177);
  await waitForIdle(page);
  expect(readDocumentNode(await page.evaluate(() => (window as any).uiHarness.getDocument()), 'details').props.activeId).toBe('tab-stats');
  expect(systemNode(await inspectSystem(page), 'details').presentation.tabProgress).toBe(1);
  const runtime = await inspectRuntime(page);
  expect(runtimeNode(runtime, 'page-info').visible).toBe(false);
  expect(runtimeNode(runtime, 'page-stats').visible).toBe(true);
  }
});

test('workbench controls and portable bundles preserve a system alongside an independent timeline', async ({ page, context }) => {
  await openGallery(page);
  await page.locator('#motion-style').selectOption('corporate');
  await page.locator('#apply-motion-system').click();
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getMotionSystem()?.style)).toBe('corporate');
  await page.locator('#clear-motion-system').click();
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getMotionSystem())).toBeNull();

  const independentMotion = {
    motionVersion: '0.1', id: 'independent-bundle-motion', scope: 'canvas', duration: 1000,
    trigger: { type: 'manual' },
    tracks: [{ targetId: 'balance', property: 'x', start: 0, duration: 1000, from: -100, to: 0, easing: 'linear' }],
  };
  await page.locator('[data-tab=motion]').click();
  await page.locator('#motion-editor').fill(JSON.stringify(independentMotion));
  await page.locator('#motion-apply').click();
  await expect(page.locator('#error')).toBeHidden();

  const installed = system('corporate', 'portable-system');
  await install(page, installed);
  const bundle = await page.evaluate(() => (window as any).uiHarness.exportBundle());
  expect(bundle).toMatchObject({ bundleVersion: '0.2', motion: { id: 'independent-bundle-motion' }, motionSystem: installed });

  const second = await context.newPage();
  await openGallery(second);
  await second.evaluate(bundle => (window as any).uiHarness.importBundle(bundle), bundle);
  expect(await second.evaluate(() => (window as any).uiHarness.getMotionSystem())).toEqual(installed);
  expect(await second.evaluate(() => (window as any).uiHarness.motionSnapshot())).toMatchObject({ time: 0, running: false, destroyed: false });
  const base = runtimeNode(await inspectRuntime(second), 'balance').bounds;
  await second.evaluate(() => (window as any).uiHarness.seekMotion(500));
  expect(runtimeNode(await inspectRuntime(second), 'balance').bounds.x).toBeCloseTo(base.x - 50, 5);
  await play(second, 'confirm', 'enter');
  await waitForMotion(second);
  expect(await second.evaluate(() => (window as any).uiHarness.motionSnapshot()?.time)).toBe(500);
  await second.close();
});
