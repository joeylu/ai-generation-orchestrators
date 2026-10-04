import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { layerPlanningFixture, fixtureFindings, fixtureProceduralAdaptations } from '../helpers/layer-planning-fixture.ts';
import { layerPlanningInput, validateLayerProposal } from '../../src/layer-auto-dag.ts';
import { compileLayerComponents } from '../../src/layer-component.ts';
import { validateBundle } from '../../src/bundle.ts';
import { fixtureStyle } from '../../src/fixtures.ts';
import { walkNodes, type InputNode } from '../../src/tree-contract.ts';

const capacityValue = '12345678901234567890';
async function fixture(policy: boolean, failure?: 'height' | 'placeholder') {
  const source = await layerPlanningFixture(), proposal = structuredClone(source.proposal);
  const input: InputNode = { id: 'editable', type: 'Input', layout: { x: 90, y: 20, width: 100, height: failure === 'height' ? 4 : 30 },
    props: { value: failure === 'placeholder' ? '' : 'A', placeholder: failure === 'placeholder' ? capacityValue : '',
      inputType: 'text', enabled: true, readOnly: false, maxLength: 20,
      ...(policy ? { valueOverflow: 'ellipsis' as const } : {}), style: { ...fixtureStyle, fontFamily: 'Arial', fontSize: 20 } } };
  if (!policy) input.props.value = capacityValue;
  proposal.plan.document.root.children.push(input);
  proposal.plan.adaptations = fixtureProceduralAdaptations(proposal.plan.document);
  proposal.findings = fixtureFindings(proposal.plan.document);
  const overflow = proposal.findings.find(row => row.componentId === input.id && row.pointer === '/props/valueOverflow');
  if (overflow) { overflow.basis = 'explicit-policy'; overflow.note = 'Declared horizontal display ellipsis preserves the full synthetic editable value.'; }
  const plan = await validateLayerProposal(source.bytes, await layerPlanningInput(source.bytes), proposal);
  return compileLayerComponents(source.bytes, plan);
}

test('declared Input horizontal ellipsis preserves capacity edits through actual export and reopen', async ({ page }) => {
  const bundle = await fixture(true); let forbidden = 0;
  await page.route('**/api/**', route => { forbidden++; return route.abort(); });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#open-bundle').setInputFiles({ name: 'explicit-input.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  const canvas = page.locator('#main-preview canvas'), box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 140 * box.width / 200, box.y + 35 * box.height / 100);
  await page.keyboard.press('Control+A'); await page.keyboard.insertText(capacityValue);
  await page.keyboard.insertText('x');
  const value = () => page.evaluate(() => window.uiStudio!.snapshot().views[0].inspection.nodes.find(node => node.id === 'editable')!.value);
  expect(await value()).toBe(capacityValue);
  await page.mouse.click(5, 5);
  const truncation = () => page.evaluate(() => window.uiStudio!.snapshot().views[0].inspection.nodes.find(node => node.id === 'editable')!.renderedTextBounds![0].implicitTruncation);
  expect(await truncation()).toMatchObject({ requestedText: capacityValue, overflowAxis: 'x', ellipsisFits: true });
  const download = page.waitForEvent('download'); await page.locator('#studio-export').click();
  const saved = Buffer.from(await readFile((await (await download).path())!));
  const exported = await validateBundle(JSON.parse(saved.toString()));
  expect(walkNodes(exported.document as typeof bundle.document).find(node => node.id === 'editable')!.props).toMatchObject({ value: capacityValue, valueOverflow: 'ellipsis' });
  expect(exported.layerSource).toEqual(bundle.layerSource); expect(exported.resources).toEqual(bundle.resources);
  await page.reload();
  await page.locator('#open-bundle').setInputFiles({ name: 'edited-input.json', mimeType: 'application/json', buffer: saved });
  await page.waitForFunction(() => window.uiStudio?.snapshot().ready);
  expect(await value()).toBe(capacityValue);
  expect(await truncation()).toMatchObject({ requestedText: capacityValue, overflowAxis: 'x', ellipsisFits: true });
  await expect(page.locator('#studio-export')).toBeEnabled();
  expect(errors).toEqual([]); expect(forbidden).toBe(0);
});

test('Input horizontal policy never admits undeclared values, vertical overflow or placeholders', async ({ page }) => {
  let forbidden = 0; await page.route('**/api/**', route => { forbidden++; return route.abort(); });
  await page.goto('/');
  for (const [policy, failure] of [[false, undefined], [true, 'height'], [true, 'placeholder']] as const) {
    const bundle = await fixture(policy, failure);
    await page.locator('#open-bundle').setInputFiles({ name: 'rejected-input.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
    await expect(page.locator('#studio-error')).toHaveAttribute('data-error-detail', /LAYER_PLAN_TEXT_OVERFLOW: editable.label/);
    await expect(page.locator('#studio-export')).toBeDisabled();
    expect(await page.evaluate(() => window.uiStudio?.snapshot().ready)).toBe(false);
  }
  expect(forbidden).toBe(0);
});
