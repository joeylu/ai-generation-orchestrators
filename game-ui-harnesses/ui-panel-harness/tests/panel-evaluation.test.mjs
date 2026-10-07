import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_EVALUATION_SUITE as suite } from '../examples/panel-evaluation/suite.mjs';
import { evaluatePanelSemantics, evaluateRecipeHits } from '../src/panel-evaluation.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { readJson } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { QUOTE_RECHECK_SUITE, quoteRecheckFixture } from '../examples/quote-recheck-v1/suite.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { readFile } from 'node:fs/promises';

const catalog = await readJson(new URL('../examples/modern-mint-layout.catalog.json', import.meta.url));
const core = await loadWorkspaceCore();
function fixture(item) {
  const state = [], rows = item.expected.rows.map((expected, i) => {
    const kind = expected.kind, bind = `field${i}`, row = { id: `row${i}`, kind,
      recipe: { id: `settings.${kind}`, version: '0.1.0' }, label: expected.label };
    if (kind === 'text') return { ...row, text: expected.text };
    Object.assign(row, { enabled: expected.enabled, event: `panel.event${i}` });
    if (kind === 'button') return { ...row, label: '', buttonLabel: expected.label,
      action: expected.action === 'emit' ? { kind: 'emit' } : { kind: 'reset-initial',
        fields: expected.resetLabels.map(label => `field${item.expected.rows.findIndex(r => r.label === label)}`) } };
    row.bind = bind;
    if (kind === 'slider') {
      state.push({ id: bind, type: 'number', min: expected.min, max: expected.max, step: expected.step, initial: expected.initial });
      row.format = { fractionDigits: expected.step < 1 ? 1 : 0, prefix: '', suffix: '' };
    } else if (kind === 'switch') state.push({ id: bind, type: 'boolean', initial: expected.initial });
    else state.push({ id: bind, type: 'enum', initial: `option${expected.options.indexOf(expected.initialLabel)}`,
      options: expected.options.map((label, i) => ({ id: `option${i}`, label })) });
    return row;
  });
  const grid = item.expected.layout?.kind === 'grid';
  const split = item.id === 'eval-character' ? 1 : 2;
  const sections = grid ? [{ id: 'first', title: '第一组', rows: rows.slice(0, split) }, { id: 'second', title: '第二组', rows: rows.slice(split) }]
    : [{ id: 'main', title: '设置', rows }];
  return { panelSpecVersion: '0.4', id: item.id, title: item.title,
    theme: { id: 'modern-mint-light', version: '0.1.0' }, canvas: { width: 1000, height: 1000 },
    layout: { width: grid ? 940 : 680, padding: 24, gap: 12, sectionGap: 20, labelWidth: 112, rowHeight: 56,
      titleHeight: 48, sectionTitleHeight: 32, maxHeight: item.expected.layout?.maxHeight ?? 840,
      overflow: item.expected.layout?.overflow ?? 'error', body: { id: 'body-layout', kind: grid ? 'grid' : 'column', width: 'fill',
        gap: 20, align: 'start', ...(grid ? { minColumnWidth: 340 } : {}), children: sections.map(s => ({ kind: 'section', sectionId: s.id, width: 'fill' })) } },
    state, sections, assets: null, provenance: { kind: 'programmatic-fixture', description: 'Explicit expectation fixture; never a model generation result.', assumptions: [] } };
}

test('16 supported fixture contracts compile and lexical retrieval finds required row recipes; zero model calls', async () => {
  assert.equal(suite.cases.length, 16); assert.equal(new Set(suite.cases.map(c => c.id)).size, 16);
  for (const item of suite.cases) {
    const context = await createPlanningContext(item.request, catalog);
    assert.equal(evaluateRecipeHits(context, item.expected).status, 'PASS', item.id);
    const spec = fixture(item); assert.equal(evaluatePanelSemantics(spec, item.expected).status, 'PASS', item.id);
    await validatePanelBundle(await createPanelBundle(spec, catalog, core), core);
  }
});

test('semantic gate rejects legal but wrong defaults, reset scope, order and enabled flags', () => {
  const item = suite.cases[0], original = fixture(item);
  const mutations = [s => { s.state[0].initial = 50; }, s => { s.sections[0].rows[2].action.fields = ['field0']; },
    s => { s.sections[0].rows.reverse(); }, s => { s.sections[0].rows[0].enabled = false; }];
  for (const mutate of mutations) { const spec = structuredClone(original); mutate(spec); assert.equal(evaluatePanelSemantics(spec, item.expected).status, 'FAIL'); }
});

test('semantic gate rejects legal enum labels/default, read-only content and layout changes', () => {
  for (const [id, mutate] of [
    ['eval-language', s => { s.state[0].initial = 'option1'; }],
    ['eval-language', s => { s.state[0].options[1].label = '英语'; }],
    ['eval-confirm', s => { s.sections[0].rows[0].text = '删除成功'; }],
    ['eval-advanced', s => { s.layout.maxHeight = 600; }],
  ]) {
    const item = suite.cases.find(item => item.id === id), spec = fixture(item); mutate(spec);
    assert.equal(evaluatePanelSemantics(spec, item.expected).status, 'FAIL');
  }
});

test('missing lexical row kinds are reported separately from generation', async () => {
  const item = suite.cases[0], context = await createPlanningContext({ ...item.request, text: '做一个东西' }, catalog);
  assert.equal(evaluateRecipeHits(context, item.expected).status, 'MISS');
  assert.equal(evaluateRecipeHits(context, item.expected).assetCandidateCount, 0);
});

test('tabs expectations count navigation and independently reject wrong initial page, membership and availability', async () => {
  const item = QUOTE_RECHECK_SUITE.cases.find(item => item.expected.tabs);
  const forms = await readJson(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url));
  const context = await createPlanningContext(item.request, forms);
  const { spec } = await materializePanelIntent(context, quoteRecheckFixture(context, item));
  assert.equal(evaluatePanelSemantics(spec, item.expected).status, 'PASS');
  for (const mutate of [
    value => { value.state.find(field => field.id === value.tabs.bind).initial = value.tabs.pages[1].id; },
    value => { value.tabs.enabled = false; },
    value => { value.tabs.pages.reverse(); value.state.find(field => field.id === value.tabs.bind).options.reverse(); },
    value => { [value.tabs.pages[0].sections, value.tabs.pages[1].sections] = [value.tabs.pages[1].sections, value.tabs.pages[0].sections]; },
  ]) {
    const bad = structuredClone(spec); mutate(bad); assert.equal(evaluatePanelSemantics(bad, item.expected).status, 'FAIL');
  }
  const noTabsExpected = structuredClone(item.expected); delete noTabsExpected.tabs;
  assert.equal(evaluatePanelSemantics(spec, noTabsExpected).status, 'FAIL', 'unrequested navigation state is not ignored');
});

test('evaluation fingerprints bind the prompt selected by native quote-guard generation', async () => {
  const protocol = await evaluationProtocolFingerprint();
  assert.equal(protocol.panelIntentVersion, '0.10');
  for (const name of ['panel-intent-v0.7-quote-guard.md', 'panel-intent-v0.7-native-quotes.md', 'panel-intent-v0.8-request-refs.md', 'panel-intent-v0.8-text-labels.md', 'panel-intent-v0.8-panel-titles.md', 'panel-intent-v0.9-actions.md']) {
    const file = protocol.files.find(file => file.path === `prompts/${name}`); assert(file);
    assert.equal(file.sha256, await digestBytes(await readFile(new URL(`../prompts/${name}`, import.meta.url))));
  }
});
