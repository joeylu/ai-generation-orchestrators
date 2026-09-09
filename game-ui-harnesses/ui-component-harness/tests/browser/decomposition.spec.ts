import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fixtureZip } from '../helpers/decomposition-fixture.ts';
import { importDecompositionZip } from '../../src/decomposition-import.ts';
import { appearanceDocumentSha256 } from '../../src/appearance-binding.ts';
import { createBundle, validateBundle } from '../../src/bundle.ts';
import { applyAppearanceBinding } from '../../src/appearance-apply.ts';
import type { UiDocument } from '../../src/tree-contract.ts';
import { appearanceApplicationFixture } from '../helpers/appearance-application-fixture.ts';
import { firstBatchAppearanceFixture } from '../helpers/first-batch-appearance-fixture.ts';
import { secondBatchAppearanceFixture } from '../helpers/second-batch-appearance-fixture.ts';

async function inputs() {
  const fixture = await fixtureZip({ includeQa: true });
  const imported = await importDecompositionZip(fixture.zip);
  const document: UiDocument = { schemaVersion: '0.2', id: 'fixture-document', canvas: { width: 1, height: 1 }, root: {
    id: 'fixture-image', type: 'Image', layout: { x: 0, y: 0, width: 1, height: 1 },
    props: { source: imported.preview.path, fit: 'stretch', style: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF', borderWidth: 0, cornerRadius: 0, textColor: '#000000', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1 } },
  } };
  const bundle = await createBundle(document, [imported.preview], { kind: 'programmatic-fixture', description: 'Offline decomposition binding fixture; not user artwork.' });
  const binding = { kind: 'ui-appearance-binding', version: '0.1', documentSha256: await appearanceDocumentSha256(document),
    archiveSha256: imported.archiveSha256, deliveryDigest: imported.deliveryDigest, sceneSha256: imported.sceneSha256,
    registration: { sourceCanvas: document.canvas, targetCanvas: document.canvas, transform: { scale: 1, offset: { x: 0, y: 0 } } },
    bindings: [{ componentId: 'fixture-image', componentType: 'Image', parts: [{ role: 'image', layerId: 'background' }] }],
  };
  return { fixture, bundle, binding };
}
const jsonFile = (name: string, value: unknown) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
async function openTarget(page: Page, value: Awaited<ReturnType<typeof inputs>>) {
  await page.locator('#open-bundle').setInputFiles(jsonFile('component.json', value.bundle));
  await expect(page.locator('#appearance-target')).toBeEnabled();
  await page.locator('#appearance-target').click();
  await expect(page.locator('#appearance-target-status')).toContainText('已固定目标');
}
async function openZip(page: Page, value: Awaited<ReturnType<typeof inputs>>) {
  await page.locator('#decomposition-file').setInputFiles({ name: 'sample-ui.draft.zip', mimeType: 'application/zip', buffer: Buffer.from(value.fixture.zip) });
  await expect(page.locator('#decomposition-status')).toContainText('完整性校验通过');
}

test('offline ZIP preview and explicit appearance binding roundtrip preserve draft evidence', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/ui-vision**', route => { requests++; return route.abort(); });
  await page.goto('/');
  const value = await inputs();
  await openTarget(page, value); await openZip(page, value);
  await expect(page.locator('#decomposition-status')).toContainText('未人工审核的草稿');
  await expect(page.locator('#decomposition-status')).toContainText('passed');
  await page.locator('#decomposition-preview').click();
  await expect(page.locator('#scheme-name')).toHaveText('拆分包合成图');
  await expect(page.locator('#main-preview canvas')).toBeVisible();
  await expect(page.locator('#appearance-target')).toBeDisabled();
  const targetDownloadEvent = page.waitForEvent('download');
  await page.locator('#appearance-target-export').click();
  const targetDownload = await targetDownloadEvent;
  const savedTarget = JSON.parse(await readFile((await targetDownload.path())!, 'utf8'));
  expect(savedTarget).toEqual(value.bundle);
  await expect(page.locator('#studio-compare')).toBeDisabled();
  const preview = await page.evaluate(() => window.uiStudio.exportSelected());
  expect(preview.resources).toEqual(value.bundle.resources);
  expect(preview.provenance.description).toContain('unreviewed_draft');
  await page.locator('#appearance-file').setInputFiles(jsonFile('binding.json', value.binding));
  await expect(page.locator('#appearance-export')).toBeEnabled();
  await expect(page.locator('#appearance-status')).toContainText('外观绑定尚未应用到控件');
  const downloadEvent = page.waitForEvent('download'); await page.locator('#appearance-export').click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).toEqual(value.binding);
  await page.reload(); await openTarget(page, { ...value, bundle: savedTarget }); await openZip(page, value);
  await page.locator('#appearance-file').setInputFiles(jsonFile('restored-binding.json', exported));
  await expect(page.locator('#appearance-export')).toBeEnabled();
  expect(requests).toBe(0);
});

test('invalid or replaced imports cannot retain a validated binding or stale material canvas', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/ui-vision**', route => { requests++; return route.abort(); });
  await page.goto('/'); const value = await inputs();
  await openTarget(page, value); await openZip(page, value);
  await page.locator('#appearance-file').setInputFiles(jsonFile('binding.json', value.binding));
  await expect(page.locator('#appearance-export')).toBeEnabled();
  await page.locator('#appearance-file').setInputFiles(jsonFile('wrong.json', { ...value.binding, archiveSha256: '0'.repeat(64) }));
  await expect(page.locator('#appearance-status')).toContainText('未通过校验');
  await expect(page.locator('#appearance-export')).toBeDisabled();
  await page.locator('#decomposition-preview').click();
  await expect(page.locator('#scheme-name')).toHaveText('拆分包合成图');
  await page.locator('#decomposition-file').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken') });
  await expect(page.locator('#decomposition-status')).toContainText('未通过校验');
  await expect(page.locator('#decomposition-preview')).toBeDisabled();
  await expect(page.locator('#appearance-file')).toBeDisabled();
  await expect(page.locator('#studio-export')).toBeDisabled();
  await expect(page.locator('#main-preview canvas')).toHaveCount(0);
  await page.locator('#studio-reset').click();
  await expect(page.locator('#appearance-target-status')).toContainText('先打开组件方案');
  expect(requests).toBe(0);
});

test('v0.2 binding applies Button, Switch, and Select, preserves schemes, and exports without model calls', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/ui-vision**', route => { requests++; return route.abort(); });
  await page.goto('/'); const value = await appearanceApplicationFixture();
  await page.locator('#open-bundle').setInputFiles(jsonFile('target.ui-bundle.json', value.target));
  await expect(page.locator('#appearance-target')).toBeEnabled(); await page.locator('#appearance-target').click();
  await page.locator('#decomposition-file').setInputFiles({ name: 'layers.zip', mimeType: 'application/zip', buffer: Buffer.from(value.fixture.zip) });
  await expect(page.locator('#decomposition-status')).toContainText('完整性校验通过');
  await page.locator('#appearance-file').setInputFiles(jsonFile('binding.json', value.binding));
  await expect(page.locator('#appearance-apply')).toBeEnabled(); await page.locator('#appearance-apply').click();
  await expect(page.locator('#appearance-status')).toContainText('已确定性应用');
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().ready)).toBe(true);

  const point = async (id: string, x: number, y: number) => {
    const snapshot = await page.evaluate(() => window.uiStudio.snapshot());
    const target = snapshot.views[0].inspection.nodes.find(node => node.id === id); expect(target).toBeTruthy();
    await page.locator('#main-preview canvas').scrollIntoViewIfNeeded();
    const box = await page.locator('#main-preview canvas').boundingBox(); expect(box).toBeTruthy();
    return { x: (target!.bounds.x + x) * box!.width / 500, y: (target!.bounds.y + y) * box!.height / 400 };
  };
  const click = async (id: string, x: number, y: number) => { const p = await point(id, x, y); await page.locator('#main-preview canvas').click({ position: p }); };
  await click('apply-button', 50, 20);
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].activationCounts['apply-button'])).toBe(1);
  const switchBefore = await page.locator('#main-preview canvas').screenshot();
  await click('apply-switch', 60, 20);
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-switch')?.value)).toBe(true);
  const switchAfter = await page.locator('#main-preview canvas').screenshot(); expect(switchAfter.equals(switchBefore)).toBe(false);
  await click('apply-select', 60, 20);
  const popup = await point('apply-select', 60, 109.5); await page.locator('#main-preview canvas').click({ position: popup });
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-select')?.value)).toBe('low');

  for (const scheme of ['playful', 'premium', 'corporate', 'original']) {
    await page.locator(`#scheme-options [data-scheme="${scheme}"]`).click();
    await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].motionSnapshot.scheduler.running)).toBe(0);
    const exported = await page.evaluate(() => window.uiStudio.exportSelected());
    expect(exported.document.root.children.filter((node: any) => node.props.appearance)).toHaveLength(3);
    expect(exported.resources.filter((resource: any) => resource.path.startsWith(`appearance/${value.imported.archiveSha256}/`))).toHaveLength(6);
  }
  expect(requests).toBe(0);
});

test('v0.2 binding applies the first five additional controls with live interaction and portable export', async ({ page }) => {
  let requests = 0; await page.route('**/api/ui-vision**', route => { requests++; return route.abort(); });
  await page.goto('/'); const value = await firstBatchAppearanceFixture();
  await page.locator('#open-bundle').setInputFiles(jsonFile('target.ui-bundle.json', value.target)); await expect(page.locator('#appearance-target')).toBeEnabled(); await page.locator('#appearance-target').click(); await expect(page.locator('#appearance-target-status')).toContainText('已固定目标');
  await page.locator('#decomposition-file').setInputFiles({ name: 'first-batch.zip', mimeType: 'application/zip', buffer: Buffer.from(value.fixture.zip) });
  await expect(page.locator('#decomposition-status')).toContainText('完整性校验通过'); await expect(page.locator('#appearance-file')).toBeEnabled();
  await page.locator('#appearance-file').setInputFiles(jsonFile('binding.json', value.binding)); await expect(page.locator('#appearance-apply')).toBeEnabled(); await page.locator('#appearance-apply').click();
  await expect(page.locator('#appearance-status')).toContainText('已确定性应用');
  const canvas = page.locator('#main-preview canvas'); await canvas.scrollIntoViewIfNeeded();
  const click = async (id: string, localX: number, localY: number) => {
    const snapshot = await page.evaluate(() => window.uiStudio.snapshot()), node = snapshot.views[0].inspection.nodes.find(candidate => candidate.id === id); expect(node).toBeTruthy();
    const box = await canvas.boundingBox(); expect(box).toBeTruthy(); await canvas.click({ position: { x: (node!.bounds.x + localX) * box!.width / 600, y: (node!.bounds.y + localY) * box!.height / 600 } });
  };
  await click('apply-checkbox', 20, 25); await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-checkbox')?.value)).toBe(false);
  await click('apply-radio', 100, 100); await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-radio')?.value)).toBe('high');
  await click('apply-radio', 100, 65); await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-radio')?.value)).toBe('high');
  await click('apply-input', 100, 25);
  await page.evaluate(() => { const editor = document.querySelector<HTMLInputElement>('#main-preview input[aria-hidden="true"]')!; editor.value = 'Ada'; editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'Ada', inputType: 'insertText' })); });
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-input')?.value)).toBe('Ada');
  await click('apply-slider', 220, 25); await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-slider')?.value)).toBe(100);
  for (const scheme of ['playful', 'premium', 'corporate', 'original']) {
    await page.locator(`#scheme-options [data-scheme="${scheme}"]`).click(); const exported = await page.evaluate(() => window.uiStudio.exportSelected());
    expect(exported.document.root.children.filter((node: any) => node.props.appearance)).toHaveLength(5);
    expect(exported.resources.filter((resource: any) => resource.path.startsWith(`appearance/${value.imported.archiveSha256}/`))).toHaveLength(12);
  }
  expect(requests).toBe(0);
});

test('v0.2 binding applies the remaining eight component types and exports their portable raster resources', async ({ page }) => {
  let requests = 0; await page.route('**/api/ui-vision**', route => { requests++; return route.abort(); });
  await page.goto('/'); const value = await secondBatchAppearanceFixture();
  await page.locator('#open-bundle').setInputFiles(jsonFile('target.ui-bundle.json', value.target));
  await expect(page.locator('#appearance-target')).toBeEnabled(); await page.locator('#appearance-target').click();
  await page.locator('#decomposition-file').setInputFiles({ name: 'second-batch.zip', mimeType: 'application/zip', buffer: Buffer.from(value.fixture.zip) });
  await expect(page.locator('#decomposition-status')).toContainText('完整性校验通过');
  await page.locator('#appearance-file').setInputFiles(jsonFile('binding.json', value.binding));
  await expect(page.locator('#appearance-apply')).toBeEnabled(); await page.locator('#appearance-apply').click();
  await expect(page.locator('#appearance-status')).toContainText('已确定性应用');
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().ready)).toBe(true);

  for (const scheme of ['playful', 'premium', 'corporate', 'original']) {
    await page.locator(`#scheme-options [data-scheme="${scheme}"]`).click();
    await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].motionSnapshot.scheduler.running)).toBe(0);
    const exported = await page.evaluate(() => window.uiStudio.exportSelected());
    const nodes = exported.document.root.children;
    expect(nodes.map((node: any) => node.type)).toEqual(['ScrollView', 'List', 'Dialog', 'Tabs', 'Image', 'Text', 'Container', 'Panel']);
    expect((nodes.find((node: any) => node.type === 'Text') as any).props.text).toBe('Live semantic text');
    expect((nodes.find((node: any) => node.type === 'Image') as any).props.source).toContain(`/image-layer.png`);
    expect(exported.resources.filter((resource: any) => resource.path.startsWith(`appearance/${value.imported.archiveSha256}/`))).toHaveLength(17);
  }
  expect(requests).toBe(0);
});

test('the eight-component showcase keeps List, Tabs, and ScrollView interactive beside a visible Dialog', async ({ page }) => {
  let requests = 0; await page.route('**/api/ui-vision**', route => { requests++; return route.abort(); });
  const value = await secondBatchAppearanceFixture();
  const interactive = structuredClone(await applyAppearanceBinding(value.target, value.imported, value.binding)) as any;
  const dialog = interactive.document.root.children.find((node: any) => node.id === 'apply-dialog');
  dialog.props.modal = false; delete dialog.props.appearance.overlayImage; delete dialog.props.appearance.overlayCanvas;
  const bundle = await validateBundle(interactive);
  await page.goto('/'); await page.locator('#open-bundle').setInputFiles(jsonFile('eight-components.ui-bundle.json', bundle));
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().ready)).toBe(true);
  const canvas = page.locator('#main-preview canvas'), box = await canvas.boundingBox(); expect(box).toBeTruthy();
  const click = async (x: number, y: number) => page.mouse.click(box!.x + x * box!.width / 800, box!.y + y * box!.height / 760);
  await click(300, 35);
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-list')?.value)).toBe('first');
  await click(150, 440);
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-tabs')?.value)).toBe('tab-a');
  await page.mouse.move(box!.x + 100 * box!.width / 800, box!.y + 60 * box!.height / 760); await page.mouse.wheel(0, 50);
  await expect.poll(() => page.evaluate(() => window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-scroll')?.value)).toEqual({ x: 0, y: 110 });
  await canvas.scrollIntoViewIfNeeded(); const dragBox = await canvas.boundingBox(); expect(dragBox).toBeTruthy();
  const thumbX = dragBox!.x + 195 * dragBox!.width / 800, thumbY = dragBox!.y + (10 + 10 + 70 * 110 / 120 + 10) * dragBox!.height / 760;
  await page.mouse.move(thumbX, thumbY); await page.mouse.down();
  await page.mouse.move(thumbX, thumbY - 35 * dragBox!.height / 760); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window.uiStudio.snapshot().views[0].inspection.nodes.find(node => node.id === 'apply-scroll')?.value as { y: number }).y)).toBeCloseTo(50, 4);
  expect(requests).toBe(0);
});
