import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createBundle, validateBundle } from '../../src/bundle.ts';
import { buttonInteractionsFixture } from '../helpers/button-interactions-fixture.ts';
const fixtureBundle = async () => createBundle(buttonInteractionsFixture(), await Promise.all(['gem.svg', 'plate.svg'].map(async name => ({ path: `fixtures/${name}`, mime: 'image/svg+xml', bytes: new Uint8Array(await readFile(`public/fixtures/${name}`)) }))), { kind: 'programmatic-fixture', description: 'Explicit procedural interaction regression; no live model or artwork generation.' });
const state = (page: Page) => page.evaluate(() => ({ document: window.uiHarness.getDocument(), inspection: window.uiHarness.inspect() }));
const node = async (page: Page, id: string) => (await state(page)).inspection.nodes.find(n => n.id === id)!;
const click = async (page: Page, id: string) => {
  const current = await node(page, id), box = await page.locator('#canvas-host canvas').boundingBox();
  if (!box) throw Error('canvas missing');
  const doc = (await state(page)).document!; if (doc.schemaVersion !== '0.2') throw Error('fixture');
  await page.mouse.click(box.x + (current.bounds.x + current.bounds.width / 2) * box.width / doc.canvas.width,
    box.y + (current.bounds.y + current.bounds.height / 2) * box.height / doc.canvas.height);
};
const load = async (page: Page, bytes: Buffer) => {
  await page.locator('#bundle-file').setInputFiles({ name: 'interactive-fixture.json', mimeType: 'application/json', buffer: bytes });
  await expect.poll(() => page.evaluate(() => window.uiHarness.inspect().instances === 1 && window.uiHarness.getDocument()?.id)).toBe('button-interactions-procedural');
  await expect(page.locator('#error')).toBeHidden();
};
test('real input performs UI effects, boundaries, repeated choices and export/reopen', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.abort());
  await page.goto('/workbench.html'); await page.waitForFunction(() => Boolean(window.uiHarness));
  const bundle = await fixtureBundle(); await load(page, Buffer.from(JSON.stringify(bundle)));
  expect((await node(page, 'minus')).enabled).toBe(false);
  await click(page, 'plus'); expect((await node(page, 'quantity')).value).toBe('1');
  // Pointer focus and keyboard navigation are independent in the public runtime.
  for (let step = 0; step < 16 && await page.locator('#canvas-host canvas').getAttribute('data-focused-component') !== 'plus'; step++) await page.keyboard.press('Tab');
  await expect(page.locator('#canvas-host canvas')).toHaveAttribute('data-focused-component', 'plus');
  await page.keyboard.press('Enter'); expect((await node(page, 'quantity')).value).toBe('2');
  await page.keyboard.press('Space'); expect((await node(page, 'quantity')).value).toBe('3');
  await click(page, 'close'); expect((await node(page, 'detail')).value).toBe(false);
  await click(page, 'beta-open'); expect((await node(page, 'detail')).value).toBe(true);
  expect((await node(page, 'detail-name')).renderedTextBounds?.[0]?.text).toBe('Beta');
  await page.locator('#canvas-host canvas').screenshot({ path: info.outputPath('interactive-beta.png') });
  const downloading = page.waitForEvent('download'); await page.locator('#export-bundle').click();
  const path = await (await downloading).path(); if (!path) throw Error('download missing');
  const bytes = await readFile(path), saved = await validateBundle(JSON.parse(bytes.toString()));
  expect(saved.resources).toEqual(bundle.resources);
  expect(saved.document.schemaVersion === '0.2' && saved.document.interactionState?.copies).toEqual([
    { targetId: 'detail-name', sourceId: 'beta-name' }, { targetId: 'detail-image', sourceId: 'beta-image' },
  ]);
  await page.reload(); await page.waitForFunction(() => Boolean(window.uiHarness)); await load(page, bytes);
  expect((await node(page, 'detail-name')).renderedTextBounds?.[0]?.text).toBe('Beta');
  expect((await node(page, 'quantity')).value).toBe('3');
  await click(page, 'quantity'); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('9');
  expect((await node(page, 'plus')).enabled).toBe(false); await click(page, 'plus'); expect((await node(page, 'quantity')).value).toBe('9');
  const resources = (await state(page)).inspection.resources;
  for (let index = 0; index < 10; index++) {
    await click(page, 'cancel'); await click(page, index % 2 ? 'alpha-open' : 'beta-open');
    expect((await state(page)).inspection.resources).toBe(resources);
  }
  expect(errors).toEqual([]);
});
