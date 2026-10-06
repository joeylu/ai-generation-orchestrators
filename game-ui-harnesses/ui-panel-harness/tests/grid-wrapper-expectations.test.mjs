import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { measureFlowLayout } from '../src/flow-layout.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { ORDINAL_STABILITY_SUITE as original } from '../examples/ordinal-stability-v1/suite.mjs';
import { ORDINAL_STABILITY_SUITE as corrected } from '../examples/ordinal-stability-v2/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { ordinalFixture } from './ordinal-intent-fixture.mjs';
import { requestReferenceFixture } from '../examples/request-reference-v1/fixture.mjs';
const old = original.cases.find(item => item.id === 'eval-graphics'), current = corrected.cases.find(item => item.id === old.id);
const catalog = await readJson(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url));
const context = await createPlanningContext(old.request, catalog);
const intent = requestReferenceFixture(ordinalFixture(compactIntentFixture(context, old)));
const flat = (await materializePanelIntent(context, intent)).spec;
function wrapped() {
  const spec = structuredClone(flat);
  spec.layout.body = { id: 'wrapper', kind: 'column', width: 'fill', gap: 20, align: 'start', children: [spec.layout.body] };
  return spec;
}

test('the exact real failure shape satisfies the requested grid while historical root checks remain unchanged', () => {
  const spec = wrapped(), before = structuredClone(spec);
  assert.equal(evaluatePanelSemantics(spec, old.expected).status, 'FAIL');
  assert.equal(evaluatePanelSemantics(spec, current.expected).status, 'PASS');
  assert.deepEqual(spec, before); assert.equal(spec.layout.body.kind, 'column');
});

test('one fill-width column wrapper preserves all measured positions at wide, collapsed and narrow widths', () => {
  for (const width of [1000, 704, 640, 390]) {
    const a = structuredClone(flat), b = wrapped();
    for (const spec of [a, b]) { spec.canvas.width = width; spec.layout.width = Math.min(spec.layout.width, width); }
    assert.deepEqual(measureFlowLayout(b), measureFlowLayout(a));
    const positions = measureFlowLayout(b).sections;
    if (width === 1000) { assert.equal(positions[0].y, positions[1].y); assert(positions[0].x < positions[1].x); }
    if (width === 390) { assert.equal(positions[0].x, positions[1].x); assert(positions[0].y < positions[1].y); }
  }
});

test('the declared correction changes only this layout assertion; all16 requests and other expectations remain exact', () => {
  assert.equal(corrected.cases.length, 16);
  for (let n = 0; n < 16; n++) {
    const item = structuredClone(corrected.cases[n]);
    if (item.id === old.id) delete item.expected.layout.allowSingleColumnWrapper;
    assert.deepEqual(item, original.cases[n]);
  }
  assert.equal(evaluatePanelSemantics(flat, current.expected).status, 'PASS');
});

test('ordinary columns, rows, extra siblings, narrowing or extra nesting cannot masquerade as the two-group grid', () => {
  const mutations = [
    spec => { spec.layout.body.children[0].kind = 'column'; delete spec.layout.body.children[0].minColumnWidth; },
    spec => { spec.layout.body.children[0].kind = 'row'; delete spec.layout.body.children[0].minColumnWidth; },
    spec => { spec.layout.body.width = 800; },
    spec => { spec.layout.body.children[0].width = 800; },
    spec => { const grid = spec.layout.body.children[0]; spec.layout.body.children = grid.children; },
    spec => { spec.layout.body.children[0] = { id: 'extra', kind: 'column', width: 'fill', gap: 20, align: 'start', children: [spec.layout.body.children[0]] }; },
  ];
  for (const mutate of mutations) { const spec = wrapped(); mutate(spec); assert.equal(evaluatePanelSemantics(spec, current.expected).status, 'FAIL'); }
});

test('explicit body shape remains an exact tree contract, including wrappers', () => {
  const expected = { ...current.expected, bodyShape: { kind: 'grid', children: [{ kind: 'section', index: 0 }, { kind: 'section', index: 1 }] } };
  assert.equal(evaluatePanelSemantics(flat, expected).status, 'PASS');
  assert.equal(evaluatePanelSemantics(wrapped(), expected).status, 'FAIL');
});

test('defaults, groups, order, reset scope, dimensions and labels still reject independent business regressions', () => {
  for (const mutate of [
    spec => { spec.state[0].initial = spec.state[0].options[0].id; },
    spec => { spec.sections[1].rows[1].action.fields.pop(); },
    spec => { spec.layout.width = 920; },
    spec => { spec.canvas.width = 980; },
    spec => { spec.sections[0].rows.reverse(); },
    spec => { spec.sections[0].rows[0].label = '显示质量'; },
  ]) { const spec = wrapped(); mutate(spec); assert.equal(evaluatePanelSemantics(spec, current.expected).status, 'FAIL'); }
});
