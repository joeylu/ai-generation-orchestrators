import test from 'node:test';
import assert from 'node:assert/strict';
import { layerLayoutFixture } from './helpers/layer-layout-fixture.ts';
import { validateLayerLayoutChecks, checkLayerLayoutRendering, assertLayerLayoutChecksPreserved,
  assertLayerLayoutVisibilityPreserved, LayerLayoutRenderError, type LayerLayoutInspection } from '../src/layer-layout-checks.ts';
import { assertLayerTextRendering } from '../src/layer-preview.ts';
import { compileLayerComponents } from '../src/layer-component.ts';
import { validateBundle } from '../src/bundle.ts';
import { layerPlanningInput, validateLayerProposal } from '../src/layer-auto-dag.ts';

const bounds = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const measured = (): LayerLayoutInspection => ({ nodes: [
  { id: 'spacing-icon', visible: true, bounds: bounds(79, 25, 12, 14) },
  { id: 'name', visible: true, bounds: bounds(95, 25, 100, 24), renderedTextBounds: [{ bounds: bounds(95, 25, 35, 14) }] },
  { id: 'count', visible: true, bounds: bounds(95, 30, 100, 24), renderedTextBounds: [{ bounds: bounds(95, 37, 20, 14) }] },
] });

test('actual nested glyph bounds expose a two-pixel overlap; four-pixel correction passes', async () => {
  const { plan } = await layerLayoutFixture(), inspection = measured();
  const report = checkLayerLayoutRendering(plan.layoutChecks!, plan.document, inspection);
  assert.equal(report.status, 'repairable'); assert.equal(report.checks[0].actualGap, 4);
  assert.equal(report.checks[1].actualGap, -2);
  inspection.nodes[2].renderedTextBounds![0].bounds!.y = 43;
  assert.equal(checkLayerLayoutRendering(plan.layoutChecks!, plan.document, inspection).status, 'pass');
});

test('missing/nonfinite glyph evidence is terminal rather than a false no-overlap success', async () => {
  const { plan } = await layerLayoutFixture();
  for (const mutation of ['missing', 'flat', 'nan', 'absent-node', 'duplicate-node'] as const) {
    const inspection = measured();
    if (mutation === 'missing') inspection.nodes[1].renderedTextBounds = [];
    if (mutation === 'flat') inspection.nodes[1].renderedTextBounds = [bounds(95, 25, 35, 14) as any];
    if (mutation === 'nan') inspection.nodes[1].renderedTextBounds![0].bounds!.width = NaN;
    if (mutation === 'absent-node') inspection.nodes.pop();
    if (mutation === 'duplicate-node') inspection.nodes.push(inspection.nodes[0]);
    assert.throws(() => checkLayerLayoutRendering(plan.layoutChecks!, plan.document, inspection), /LAYER_RENDER_MEASUREMENT_INVALID/);
  }
});

test('built-in labels select exact owned text and never use an arbitrary glyph index', async () => {
  const { plan } = await layerLayoutFixture();
  const checks = structuredClone(plan.layoutChecks!);
  checks.separations.push({ id: 'button-name', firstId: 'action', firstText: 'PLAY', secondId: 'name',
    axis: 'x', minGap: 4, reason: 'Independent fixture button label precedes the caption.' });
  validateLayerLayoutChecks(checks, plan.document);
  const inspection = measured(); inspection.nodes[2].renderedTextBounds![0].bounds!.y = 43;
  inspection.nodes.push({ id: 'action', visible: true, renderedTextBounds: [
    { text: 'PLAY', bounds: bounds(12, 24, 30, 15) }, { text: 'Other', bounds: bounds(0, 0, 190, 100) },
  ] });
  assert.equal(checkLayerLayoutRendering(checks, plan.document, inspection).status, 'pass');
  const invalid = structuredClone(checks); invalid.separations[2].firstText = 'Guessed';
  assert.throws(() => validateLayerLayoutChecks(invalid, plan.document), /LAYOUT_CHECKS_INVALID/);
  inspection.nodes[3].renderedTextBounds!.push(inspection.nodes[3].renderedTextBounds![0]);
  assert.throws(() => checkLayerLayoutRendering(checks, plan.document, inspection), /MEASUREMENT_INVALID/);
});

test('explicit relations require valid endpoints, finite gaps, coverage and portable reasons', async () => {
  const { plan } = await layerLayoutFixture();
  for (const mutation of ['unknown', 'self', 'background-pair', 'negative', 'nan', 'coverage', 'extra', 'private', 'duplicate', 'exemption'] as const) {
    const checks = structuredClone(plan.layoutChecks!);
    if (mutation === 'unknown') checks.separations[0].firstId = 'missing';
    if (mutation === 'self') checks.separations[0].firstId = 'name';
    if (mutation === 'background-pair') checks.separations[0].secondId = 'background';
    if (mutation === 'negative') checks.separations[0].minGap = -1;
    if (mutation === 'nan') checks.separations[0].minGap = NaN;
    if (mutation === 'coverage') checks.separations.pop();
    if (mutation === 'extra') (checks as any).policy = 'guess';
    if (mutation === 'private') checks.separations[0].reason = 'C:/private/state';
    if (mutation === 'duplicate') checks.separations.push(checks.separations[0]);
    if (mutation === 'exemption') checks.unpairedText.push({ componentId: 'name', reason: 'Already paired.' });
    assert.throws(() => validateLayerLayoutChecks(checks, plan.document), /LAYER_PLAN_LAYOUT/);
  }
  const checks = structuredClone(plan.layoutChecks!); checks.separations.pop();
  checks.unpairedText.push({ componentId: 'count', reason: 'Explicitly unpaired synthetic text requires review.' });
  assert.equal(validateLayerLayoutChecks(checks, plan.document).unpairedText.length, 1);
});

test('corrections cannot remove, lower, redirect or hide a previously measured relation', async () => {
  const { plan } = await layerLayoutFixture();
  for (const mutation of ['remove', 'lower', 'axis', 'endpoint'] as const) {
    const next = structuredClone(plan.layoutChecks!);
    if (mutation === 'remove') next.separations.pop();
    if (mutation === 'lower') next.separations[0].minGap = 3;
    if (mutation === 'axis') next.separations[0].axis = 'y';
    if (mutation === 'endpoint') next.separations[0].firstId = 'background';
    assert.throws(() => assertLayerLayoutChecksPreserved(plan.layoutChecks, next), /CHECKS_WEAKENED/);
  }
  const inspection = measured(); inspection.nodes[2].visible = false;
  const report = checkLayerLayoutRendering(plan.layoutChecks!, plan.document, inspection);
  assert.equal(report.checks[1].status, 'skipped-hidden');
  assert.throws(() => assertLayerLayoutVisibilityPreserved(new Set(['name-count']), report), /CHECKS_WEAKENED/);
});

test('source-bound plan digest retains layout checks and rejects a weakened stored policy', async () => {
  const fixture = await layerLayoutFixture();
  const plan = await validateLayerProposal(fixture.bytes, await layerPlanningInput(fixture.bytes), fixture.corrected);
  const bundle = await compileLayerComponents(fixture.bytes, plan);
  assert.deepEqual((await validateBundle(bundle)).layerSource?.plan.layoutChecks, plan.layoutChecks);
  const tampered = structuredClone(bundle); tampered.layerSource!.plan.layoutChecks!.separations[0].minGap = 0;
  await assert.rejects(validateBundle(tampered), /LAYER_PLAN_DIGEST/);
});

test('historical plans remain compatible; declared geometry throws a specific preview error', async () => {
  const { plan } = await layerLayoutFixture();
  const inspection = measured() as any;
  inspection.nodes.forEach((node: any) => node.renderedTextBounds?.forEach((glyph: any) => glyph.text = 'Synthetic'));
  assert.throws(() => assertLayerTextRendering(plan, inspection), LayerLayoutRenderError);
  const legacy = structuredClone(plan); delete legacy.layoutChecks;
  assert.equal(assertLayerTextRendering(legacy, inspection), undefined);
});
