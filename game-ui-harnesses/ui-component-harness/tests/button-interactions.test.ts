import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, walkNodes } from '../src/tree-contract.ts';
import { applyInteractionCopy, buttonInteractionEnabled, nextInputStep, prepareInteractionCopies, requireButtonInteractionCoverage, requireButtonInteractionReport, snapshotInteractionDocument } from '../src/button-interactions.ts';
import { buttonInteractionsFixture } from './helpers/button-interactions-fixture.ts';
const internal = (d: ReturnType<typeof buttonInteractionsFixture>, id: string) => {
  const node = walkNodes(d).find(n => n.id === id)!;
  if (node.type !== 'Button' || node.props.interaction?.mode !== 'internal') throw Error('fixture');
  return node.props.interaction;
};
test('explicit effects validate; historical Buttons retain standalone behavior', () => {
  const d = buttonInteractionsFixture(); validateDocument(d); requireButtonInteractionCoverage(d);
  const b = walkNodes(d).find(n => n.id === 'close')!; if (b.type !== 'Button') throw Error('fixture');
  delete b.props.interaction; validateDocument(d);
  assert.throws(() => requireButtonInteractionCoverage(d), /DECLARATION_REQUIRED/);
});
const mutations: Record<string, (d: ReturnType<typeof buttonInteractionsFixture>) => void> = {
  missing: d => { internal(d, 'close').effects[0].targetId = 'missing'; },
  wrongType: d => { internal(d, 'close').effects[0].targetId = 'quantity'; },
  code: d => { (internal(d, 'close').effects as any)[0] = { kind: 'script', code: 'run()' }; },
  capacity: d => { (internal(d, 'plus').effects[0] as any).max = 99; },
  delta: d => { (internal(d, 'plus').effects[0] as any).delta = 0; },
  state: d => { d.interactionState = { version: '1.0', copies: [{ targetId: 'detail-name', sourceId: 'beta-image' }] }; },
  chain: d => { (internal(d, 'beta-open').effects[0] as any).sourceId = 'detail-name'; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`reject unsafe or incomplete interaction: ${name}`, () => {
  const d = buttonInteractionsFixture(); mutate(d); assert.throws(() => validateDocument(d), /BUTTON_INTERACTION_/);
});
test('numeric stepping blocks boundaries, invalid/empty values and disabled target', () => {
  const d = buttonInteractionsFixture(), effect = internal(d, 'plus').effects[0];
  if (effect.kind !== 'input-step') throw Error('fixture');
  const input = walkNodes(d).find(n => n.id === 'quantity')!; if (input.type !== 'Input') throw Error('fixture');
  assert.equal(nextInputStep(d, effect), '1');
  assert.equal(buttonInteractionEnabled(d, walkNodes(d).find(n => n.id === 'minus')!), false);
  input.props.value = '9'; assert.equal(nextInputStep(d, effect), null);
  for (const value of ['', 'NaN', '8.5', '10']) { input.props.value = value; assert.equal(nextInputStep(d, effect), null); }
  input.props.value = '5'; input.props.enabled = false; assert.equal(nextInputStep(d, effect), null);
});
test('copy state persists source IDs; snapshots retain frozen target fields', () => {
  const d = buttonInteractionsFixture(), original = structuredClone(d), baseline = prepareInteractionCopies(d);
  for (const effect of internal(d, 'beta-open').effects) if (effect.kind === 'copy-text' || effect.kind === 'copy-image') applyInteractionCopy(d, effect);
  assert.equal((walkNodes(d).find(n => n.id === 'detail-name')!.props as any).text, 'Beta');
  const saved = snapshotInteractionDocument(d, baseline); validateDocument(saved);
  assert.deepEqual(saved.root, original.root); assert.equal(saved.interactionState!.copies.length, 2);
  prepareInteractionCopies(saved);
  assert.equal((walkNodes(saved).find(n => n.id === 'detail-image')!.props as any).source, 'fixtures/plate.svg');
});

test('acceptance cannot omit declarations or report event-only/malformed success', () => {
  const d = buttonInteractionsFixture();
  const report = { status: 'pass', scope: 'declared-effects-only', external: ['external'],
    bindings: walkNodes(d).filter(n => n.type === 'Button' && n.props.interaction?.mode === 'internal')
      .map(n => ({ buttonId: n.id, status: 'pass', input: 'actual-mouse', enabled: n.id !== 'minus', activations: n.id === 'minus' ? 0 : 1 })) };
  requireButtonInteractionReport(d, report);
  assert.throws(() => requireButtonInteractionReport(d, undefined), /REPORT_REQUIRED/);
  assert.throws(() => requireButtonInteractionReport(d, { ...report, bindings: report.bindings.slice(1) }), /REPORT_COVERAGE/);
  assert.throws(() => requireButtonInteractionReport(d, { ...report, bindings: report.bindings.map(b => ({ ...b, input: 'api' })) }), /REPORT_RESULT/);
});
