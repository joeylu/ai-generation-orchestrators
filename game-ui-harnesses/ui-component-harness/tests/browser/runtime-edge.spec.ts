import { expect, test, type Page } from '@playwright/test';

type Bounds = { x: number; y: number; width: number; height: number };
type InspectedNode = { id: string; bounds: Bounds; value?: unknown };
type Inspection = { externalListeners: number; nodes: InspectedNode[] };

async function gallery(page: Page): Promise<void> {
  await page.goto('/workbench.html');
  await page.waitForFunction(() => Boolean((window as any).uiHarness));
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-composite');
  await page.locator('#scenario').selectOption('gallery');
  await page.locator('#load-example').click();
  await expect.poll(() => page.evaluate(() => (window as any).uiHarness.getDocument()?.id)).toBe('fixture-gallery');
  await expect(page.locator('#error')).toBeHidden();
}

async function inspection(page: Page): Promise<Inspection> {
  return page.evaluate(() => (window as any).uiHarness.inspect());
}

async function point(page: Page, id: string): Promise<{ x: number; y: number; scaleX: number; scaleY: number; node: InspectedNode }> {
  return page.evaluate(id => {
    const api = (window as any).uiHarness;
    const node = api.inspect().nodes.find((item: InspectedNode) => item.id === id) as InspectedNode | undefined;
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas-host canvas');
    const documentState = api.getDocument();
    if (!node || !canvas || !documentState) throw new Error(`missing ${id} canvas state`);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (node.bounds.x + node.bounds.width / 2) * rect.width / documentState.canvas.width,
      y: rect.top + (node.bounds.y + node.bounds.height / 2) * rect.height / documentState.canvas.height,
      scaleX: rect.width / documentState.canvas.width,
      scaleY: rect.height / documentState.canvas.height,
      node,
    };
  }, id);
}

async function clickNode(page: Page, id: string): Promise<ReturnType<typeof point>> {
  const current = await point(page, id);
  await page.mouse.click(current.x, current.y);
  return current;
}

test.beforeEach(async ({ page }) => { await gallery(page); });

test('destroyNode updates exported snapshots and rejects direct Tabs content removal', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.destroyNode('dialog-close');
    const afterRemoval = api.getDocument();
    let tabError = '';
    try { api.destroyNode('page-info'); } catch (error) { tabError = String(error); }
    const afterRejectedRemoval = api.getDocument();
    const allIds = (node: any): string[] => [node.id, ...(('children' in node ? node.children : []) as any[]).flatMap(allIds)];
    return {
      afterRemovalIds: allIds(afterRemoval.root),
      afterRejectedRemovalIds: allIds(afterRejectedRemoval.root),
      inspectedIds: api.inspect().nodes.map((node: { id: string }) => node.id),
      tabError,
    };
  });

  expect(result.afterRemovalIds).not.toContain('dialog-close');
  expect(result.afterRejectedRemovalIds).not.toContain('dialog-close');
  expect(result.inspectedIds).not.toContain('dialog-close');
  expect(result.tabError).toContain('BROKEN_REFERENCE');
  expect(result.afterRejectedRemovalIds).toContain('page-info');
  expect(result.afterRejectedRemovalIds).toContain('page-stats');
});

test('programmatic Slider and ScrollView mutations reject invalid values without changing the document', async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    const before = api.getDocument();
    let sliderError = '', scrollError = '';
    try { api.setValue('volume', 42); } catch (error) { sliderError = String(error); }
    try { api.setValue('scroll', { x: 0, y: 194 }); } catch (error) { scrollError = String(error); }
    const after = api.getDocument();
    const node = (document: any, id: string): any => {
      const queue = [document.root];
      while (queue.length) { const current = queue.shift(); if (current.id === id) return current; if ('children' in current) queue.push(...current.children); }
      return undefined;
    };
    return {
      sliderError, scrollError,
      before: { volume: node(before, 'volume').props.value, scroll: node(before, 'scroll').props },
      after: { volume: node(after, 'volume').props.value, scroll: node(after, 'scroll').props },
    };
  });

  expect(result.sliderError).toContain('SLIDER_VALUE_INVALID');
  expect(result.scrollError).toContain('SCROLL_VALUE_OUT_OF_RANGE');
  expect(result.after).toEqual(result.before);
});

test('a valid image region creates a cropped Pixi image and remains exportable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = (window as any).uiHarness;
    const document = api.getDocument();
    const queue = [document.root];
    let image: any;
    while (queue.length) {
      const current = queue.shift();
      if (current.id === 'balance-gem') { image = current; break; }
      if ('children' in current) queue.push(...current.children);
    }
    if (!image) throw new Error('missing balance-gem');
    image.props.region = { x: 0, y: 0, width: 24, height: 24 };
    await api.loadDocument(document);
    const snapshot = api.getDocument();
    const cropped = [snapshot.root, ...(snapshot.root.children ?? [])]
      .flatMap(function collect(node: any): any[] {
        const children = ('children' in node ? node.children : []) as any[];
        return [node, ...children.flatMap(collect)];
      })
      .find((node: any) => node.id === 'balance-gem');
    return { region: cropped?.props.region, inspection: api.inspect() };
  });

  expect(result.region).toEqual({ x: 0, y: 0, width: 24, height: 24 });
  expect(result.inspection.nodes.some((node: InspectedNode) => node.id === 'balance-gem')).toBe(true);
  expect(result.inspection.nodes.length).toBeGreaterThan(30);
});

test('the hidden native editor accepts composition input and disabling it blurs and blocks later input', async ({ page }) => {
  await clickNode(page, 'name');
  const composed = await page.evaluate(() => {
    const editor = document.querySelector<HTMLInputElement>('#canvas-host input[aria-hidden="true"]');
    if (!editor || document.activeElement !== editor) throw new Error('native editor did not receive focus');
    editor.value = '漢字';
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '漢' }));
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: '字', inputType: 'insertCompositionText', isComposing: true }));
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '漢字' }));
    return true;
  });
  expect(composed).toBe(true);
  await expect.poll(async () => (await inspection(page)).nodes.find(node => node.id === 'name')?.value).toBe('漢字');

  const disabled = await page.evaluate(() => {
    const api = (window as any).uiHarness;
    api.setEnabled('name', false);
    const editor = document.querySelector<HTMLInputElement>('#canvas-host input[aria-hidden="true"]');
    if (!editor) throw new Error('missing native editor');
    editor.value = 'Blocked'; editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Blocked', inputType: 'insertText' }));
    return { focused: document.activeElement === editor, value: api.getDocument().root.children.find((node: any) => node.id === 'name').props.value };
  });
  expect(disabled).toEqual({ focused: false, value: '漢字' });
});

test('Select rows portal above sibling controls and repeated opening retains the adapter listener count', async ({ page }) => {
  const before = await inspection(page);
  const select = await clickNode(page, 'region');
  const rowHeight = Math.max(32, select.node.bounds.height);
  const secondRowY = select.y - select.node.bounds.height * select.scaleY / 2
    + (select.node.bounds.height + 2 + rowHeight * 1.5) * select.scaleY;
  await page.mouse.click(select.x, secondRowY);
  await expect.poll(async () => (await inspection(page)).nodes.find(node => node.id === 'region')?.value).toBe('region-west');

  await clickNode(page, 'region');
  await clickNode(page, 'region');
  const after = await inspection(page);
  expect(after.externalListeners).toBe(before.externalListeners);
  expect(after.nodes).toHaveLength(before.nodes.length);
});
