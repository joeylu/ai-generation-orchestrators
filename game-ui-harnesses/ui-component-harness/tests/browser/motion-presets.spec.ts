import { test, expect, type Page } from '@playwright/test';
import { fixtureDocument } from '../../src/fixtures.ts';
import { compileMotionPreset } from '../../src/motion-presets.ts';
import { walkNodes } from '../../src/tree-contract.ts';
import type { MotionDocument } from '../../src/motion.ts';

async function apply(page: Page, motion: MotionDocument) {
  await page.locator('[data-tab=motion]').click();
  await page.locator('#motion-editor').fill(JSON.stringify(motion));
  await page.locator('#motion-apply').click();
  await expect(page.locator('#error')).toBeHidden();
}
async function bounds(page: Page, id: string) {
  return page.evaluate(id => window.uiHarness.inspect().nodes.find(node => node.id === id)!.bounds, id);
}

test('Pixi centered pulse and reset on all 16 node types', async ({ page }) => {
  await page.goto('/workbench.html'); await expect(page.locator('#lifecycle')).toHaveText('运行中');
  const document = fixtureDocument('gallery');
  await page.evaluate(document => window.uiHarness.loadDocument(document), document);
  const nodes = [...new Map(walkNodes(document).map(node => [node.type, node])).values()];
  expect(nodes).toHaveLength(16);
  const canonical = await page.evaluate(() => window.uiHarness.getDocument());
  for (const node of nodes) {
    const initial = await bounds(page, node.id);
    const motion = compileMotionPreset({ presetVersion: '0.1', id: `pulse-${node.id}`, targetId: node.id,
      trigger: { type: 'manual' }, preset: 'pulse', parameters: { attackMs: 60, releaseMs: 120, scale: 0.97, easing: 'ease-out' } }, document);
    await apply(page, motion);
    await page.evaluate(() => window.uiHarness.seekMotion(60));
    const peak = await bounds(page, node.id);
    expect(peak.width).toBeCloseTo(initial.width * 0.97, 4);
    expect(peak.height).toBeCloseTo(initial.height * 0.97, 4);
    expect(peak.x + peak.width / 2).toBeCloseTo(initial.x + initial.width / 2, 4);
    expect(peak.y + peak.height / 2).toBeCloseTo(initial.y + initial.height / 2, 4);
    await page.locator('#motion-stop').click();
    expect(await bounds(page, node.id)).toEqual(initial);
    expect(await page.evaluate(() => window.uiHarness.getDocument())).toEqual(canonical);
  }
});

test('activation preset follows real Button input, replays and preserves disabled state', async ({ page }) => {
  await page.goto('/workbench.html'); await expect(page.locator('#lifecycle')).toHaveText('运行中');
  const document = fixtureDocument('composite');
  const motion = compileMotionPreset({ presetVersion: '0.1', id: 'activate-pulse', targetId: 'confirm',
    trigger: { type: 'event', targetId: 'confirm', event: 'activate' }, preset: 'pulse',
    parameters: { attackMs: 60, releaseMs: 120, scale: 0.97, easing: 'ease-out' } }, document);
  await apply(page, motion);
  const initial = await bounds(page, 'confirm');
  await page.locator('#canvas-host canvas').scrollIntoViewIfNeeded();
  const rect = await page.locator('#canvas-host canvas').boundingBox(); expect(rect).not.toBeNull();
  const x = rect!.x + initial.x + initial.width / 2, y = rect!.y + initial.y + initial.height / 2;
  for (let index = 1; index <= 3; index++) {
    await page.mouse.click(x, y);
    await expect.poll(() => page.evaluate(() => window.uiHarness.motionSnapshot()?.time)).toBe(180);
    expect(await page.evaluate(() => window.uiHarness.activates())).toBe(index);
    expect(await bounds(page, 'confirm')).toEqual(initial);
  }
  await page.locator('#motion-stop').click();
  await page.evaluate(() => window.uiHarness.setEnabled('confirm', false));
  await page.locator('#canvas-host canvas').scrollIntoViewIfNeeded();
  const disabledRect = await page.locator('#canvas-host canvas').boundingBox();
  await page.mouse.click(disabledRect!.x + initial.x + initial.width / 2, disabledRect!.y + initial.y + initial.height / 2);
  expect(await page.evaluate(() => window.uiHarness.activates())).toBe(3);
  expect(await page.evaluate(() => window.uiHarness.motionSnapshot()?.time)).toBe(0);
  expect((await page.evaluate(() => window.uiHarness.inspect().nodes.find(node => node.id === 'confirm')))?.enabled).toBe(false);
});
