import { test, expect } from '@playwright/test';
import { appearanceApplicationFixture } from '../helpers/appearance-application-fixture.ts';
import { applyAppearanceBinding } from '../../src/appearance-apply.ts';

test('reference replay restores observed toggle/choice/open popup on real PixiJS and is idempotent', async ({ page }, info) => {
  const fixture = await appearanceApplicationFixture();
  const bundle = await applyAppearanceBinding(fixture.target, fixture.imported, fixture.binding);
  const observed = (value: unknown) => ({ status: 'observed', value, evidence: 'Local fixture' });
  const evidence: any = { status: 'complete', visualComparisonReady: true, unknownFields: [], humanVisualAcceptance: false, files: [],
    state: { kind: 'ui-reference-state', schemaVersion: '1.0', components: [
      { componentId: 'apply-switch', componentType: 'Switch', fields: { checked: observed(true) } },
      { componentId: 'apply-select', componentType: 'Select', fields: { selectedId: observed('low'), popupOpen: observed(true) } },
    ] }, scope: { kind: 'ui-acceptance-scope', schemaVersion: '1.0', referenceState: 'reference/reference-state.json', human_visual_acceptance: false, derivedTestStates: [],
      components: ['root', 'apply-button', 'apply-switch', 'apply-select'].map(componentId => ({ componentId, mode: 'compare', reason: 'Fixture' })) } };
  await page.goto('/workbench.html'); await page.waitForFunction(() => Boolean(window.uiHarness));
  await page.evaluate(b => window.uiHarness.importBundle(b), bundle);
  for (let count = 0; count < 2; count++) {
    const result = await page.evaluate(e => window.uiHarness.replayReferenceState(e), evidence);
    expect(result.visualComparisonReady).toBe(true);
    const rows = await page.evaluate(() => window.uiHarness.inspect().nodes);
    expect(rows.find(n => n.id === 'apply-switch')?.value).toBe(true);
    expect(rows.find(n => n.id === 'apply-select')?.value).toBe('low');
    expect(rows.find(n => n.id === 'apply-select')?.popupOpen).toBe(true);
  }
  const open = await page.locator('#canvas-host canvas').screenshot({ path: info.outputPath('reference-open.png') });
  evidence.state.components[1].fields.popupOpen.value = false;
  await page.evaluate(e => window.uiHarness.replayReferenceState(e), evidence);
  expect(await page.evaluate(() => window.uiHarness.inspect().nodes.find(n => n.id === 'apply-select')?.popupOpen)).toBe(false);
  const closed = await page.locator('#canvas-host canvas').screenshot({ path: info.outputPath('reference-closed.png') });
  expect(open.equals(closed)).toBe(false);
});
