import { expect, test } from '@playwright/test';
import { inputEditingFixture } from '../helpers/input-editing-fixture.ts';
import { createBundle } from '../../src/bundle.ts';

test('Workbench mouse node selection survives native Input blur and targets the requested enabled control', async ({ page }) => {
  const fixture = inputEditingFixture(), first = fixture.document.root.children[0];
  fixture.document.id = 'input-editing-fixture';
  fixture.document.root.children.push({ ...structuredClone(first), id: 'other', layout: { x: 20, y: 85, width: 260, height: 40 } });
  const bundle = await createBundle(fixture.document, [], { kind: 'programmatic-fixture', description: 'Native editor blur and Workbench node selection regression.' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.abort());
  await page.goto('/workbench.html');
  await page.locator('#bundle-file').setInputFiles({ name: 'input-selection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.waitForFunction(() => window.uiHarness?.getDocument()?.id === 'input-editing-fixture');
  const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded();
  await page.locator('#tree [data-node-id="name"]').click();
  await expect(page.locator('#selected-name')).toHaveText('Input / name');
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 60 * box.width / 320, box.y + 45 * box.height / 140);
  await page.keyboard.press('End'); await page.keyboard.insertText('中文');
  await page.locator('#tree [data-node-id="other"]').click();
  await expect(page.locator('#selected-name')).toHaveText('Input / other');
  await page.locator('#node-enabled').uncheck();
  expect(await page.evaluate(() => window.uiHarness.inspect().nodes.filter(node => node.type === 'Input').map(node => [node.id, node.enabled, node.value])))
    .toEqual([['name', true, 'ABCD中文'], ['other', false, 'ABCD']]);
  await page.locator('#node-enabled').check();
  await page.locator('#tree [data-node-id="name"]').click();
  await expect(page.locator('#selected-name')).toHaveText('Input / name');
  expect(errors).toEqual([]);
});
