import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent, buildPanelIntentResponseSchema, validateNativePanelIntentQuotes } from '../src/panel-intent.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { createPanelEditContext } from '../src/edit-planning.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { INPUT_STRESS_SUITE } from '../examples/input-stress-v1/suite.mjs';
import { INPUT_STRESS_RECHECK_SUITE } from '../examples/input-stress-v2/suite.mjs';
import { ordinalFixture } from './ordinal-intent-fixture.mjs';
const catalog = await readJson(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url));
const core = await loadWorkspaceCore();
import { QUOTE_RECHECK_SUITE, quoteRecheckFixture } from '../examples/quote-recheck-v1/suite.mjs';
async function fixture(id = 'eval-graphics', text) {
  const item = INPUT_STRESS_SUITE.cases.find(value => value.id === id);
  const context = await createPlanningContext({ ...item.request, ...(text ? { text } : {}) }, catalog);
  return { context, intent: ordinalFixture(compactIntentFixture(context, item)), item };
}
const rows = spec => spec.sections.flatMap(section => section.rows);

test('native 0.7 disallows authored row/section/page IDs and uses bounded integer action references', async () => {
  const { context } = await fixture(), schema = buildPanelIntentResponseSchema(context);
  assert.deepEqual(schema.properties.panelIntentVersion.enum, ['0.7']);
  const section = schema.$defs.body.anyOf[0];
  assert(!section.properties.id); assert(!section.required.includes('id'));
  for (const row of section.properties.rows.items.anyOf) {
    assert(!row.properties.id); assert(!row.required.includes('id'));
    if (row.properties.resetRows) for (const key of ['resetRows', 'submitRows'])
      assert.deepEqual(row.properties[key].items, { type: 'integer', minimum: 0, maximum: 127 });
  }
  const pages = schema.properties.panel.anyOf[1].properties.body.anyOf[1].properties.pages;
  assert(!pages.items.properties.id); assert.equal(pages.items.additionalProperties, false);
});

test('all16 ordinal fixtures preserve independent business facts, grouping, binding and compiled bundles', async () => {
  for (const item of INPUT_STRESS_SUITE.cases) {
    const context = await createPlanningContext(item.request, catalog);
    const intent = ordinalFixture(compactIntentFixture(context, item)), before = structuredClone(intent);
    const { spec } = await materializePanelIntent(context, intent);
    assert.deepEqual(intent, before, 'input intent must stay untouched');
    assert.equal(evaluatePanelSemantics(spec, item.expected).status, 'PASS', item.id);
    assert.deepEqual(rows(spec).map(row => row.id), rows(spec).map((_, i) => `row${i}`));
    assert.deepEqual(spec.sections.map(section => section.id), spec.sections.map((_, i) => `section${i}`));
    await validatePanelBundle(await createPanelBundle(spec, catalog, core), core);
  }
});

test('native 0.7 pins complete exact evidence across every row kind, tabs and pages; older schemas stay unchanged', async () => {
  const text = '标题“设置🌿”\n音量 0～100，默认 65；静音默认关。\n【补充回答】静音开才静音。';
  const { context } = await fixture('eval-audio', text), schema = buildPanelIntentResponseSchema(context);
  assert.deepEqual(schema.$defs.exactRequestQuote, { type: 'string', enum: [text] });
  const all = schema.$defs.body.anyOf[0].properties.rows.items.anyOf;
  assert.deepEqual(all.map(row => row.properties.kind.enum[0]).sort(), ['button', 'input', 'progress', 'select', 'slider', 'switch', 'text']);
  const tabs = schema.properties.panel.anyOf[1].properties.body.anyOf[1];
  for (const field of [...all.map(row => row.properties.sourceQuote), tabs.properties.sourceQuote, tabs.properties.pages.items.properties.sourceQuote]) {
    assert.deepEqual(field, { $ref: '#/$defs/exactRequestQuote' });
  }
  for (const drift of [text.replace('默认 65', '默认65'), text.replace('～', '~'), text.replace('\n', ' '), '静音', '', '音量 0～100，默认 65；'])
    assert(!schema.$defs.exactRequestQuote.enum.includes(drift));
  const legacyCatalog = await readJson(new URL('../examples/modern-mint-tabs.catalog.json', import.meta.url));
  const legacy = buildPanelIntentResponseSchema(await createPlanningContext({ ...context.request, text }, legacyCatalog));
  assert.equal(legacy.$defs.exactRequestQuote, undefined);
  for (const row of legacy.$defs.body.anyOf[0].properties.rows.items.anyOf) assert.deepEqual(row.properties.sourceQuote, { type: 'string' });
});

test('native quote guard independently covers tabs root, pages and all actual rows without rewriting input', async () => {
  const item = QUOTE_RECHECK_SUITE.cases.find(item => item.id === 'quote-tabs-progress');
  const context = await createPlanningContext(item.request, catalog), intent = quoteRecheckFixture(context, item);
  validateNativePanelIntentQuotes(context, intent);
  for (const path of ['tabs', 'page0', 'page1', 'slider', 'switch', 'button', 'progress']) {
    const changed = structuredClone(intent), tabs = changed.panel.body;
    if (path === 'tabs') tabs.sourceQuote = '声音';
    else if (path.startsWith('page')) tabs.pages[Number(path.at(-1))].sourceQuote = '声音';
    else tabs.pages.flatMap(page => page.body.children.flatMap(section => section.rows)).find(row => row.kind === path).sourceQuote = '声音';
    const before = structuredClone(changed);
    assert.throws(() => validateNativePanelIntentQuotes(context, changed), { code: 'INTENT_NATIVE_QUOTE' });
    assert.deepEqual(changed, before);
  }
  assert.doesNotThrow(() => validateNativePanelIntentQuotes({ ...context, planningContextVersion: '0.6' }, { panelIntentVersion: '0.5' }));
  assert.doesNotThrow(() => validateNativePanelIntentQuotes(context, { panelIntentVersion: '0.7', panel: null }));
  assert.throws(() => validateNativePanelIntentQuotes(context, { panelIntentVersion: '0.6', panel: null }), { code: 'INTENT_VERSION' });
});

test('advanced sixth-row quote drift reproduces the observed diagnostic and is never repaired', async () => {
  const { context, intent, item } = await fixture('eval-advanced');
  const bad = structuredClone(intent); bad.panel.body.children[0].rows[5].sourceQuote = context.request.text.replace('默认依次70', '默认依次 70');
  assert.notEqual(bad.panel.body.children[0].rows[5].sourceQuote, context.request.text);
  const before = structuredClone(bad);
  await assert.rejects(materializePanelIntent(context, bad), error => {
    assert.equal(error.code, 'INTENT_QUOTE'); assert.equal(error.path, '$.panel.sections[0].rows[5].sourceQuote'); return true;
  });
  assert.deepEqual(bad, before);
  assert.equal(evaluatePanelSemantics((await materializePanelIntent(context, intent)).spec, item.expected).status, 'PASS');
  const schema = buildPanelIntentResponseSchema(context);
  assert(!schema.$defs.exactRequestQuote.enum.includes(bad.panel.body.children[0].rows[5].sourceQuote));
});

test('nested grouping and cross-page forward submit/reset references share global ordinals', async () => {
  const { context, intent } = await fixture('eval-audio', '生成两页设置，第一页操作、第二页输入，默认操作页；角色名输入必填2至12字符，初始空；确认提交角色名；只读说明；返回只发事件；音量0至100步长1默认70，恢复只重置音量。');
  const quote = context.request.text;
  const row = (kind, label, attrs) => ({ kind, label, recipeKey: kind === 'input' ? 'forms.input@0.1.0' : `settings.${kind}@0.1.0`, sourceQuote: quote, icon: null, ...attrs });
  intent.panel.body = { kind: 'tabs', enabled: true, sourceQuote: quote, pages: [
    { label: '操作', sourceQuote: quote, initial: true, body: { kind: 'column', children: [{ kind: 'section', title: '操作', rows: [
      row('button', '确认', { enabled: true, action: 'submit', resetRows: [], submitRows: [2] }),
      row('button', '恢复', { enabled: true, action: 'reset-initial', resetRows: [4], submitRows: [] }),
    ] }] } },
    { label: '输入', sourceQuote: quote, initial: false, body: { kind: 'column', children: [
      { kind: 'section', title: '角色', rows: [row('input', '角色名', { enabled: true, initial: '', placeholder: '', inputType: 'text', readOnly: false, maxLength: 12, required: true, minLength: 2 })] },
      { kind: 'column', children: [{ kind: 'section', title: '说明', rows: [row('text', '说明', { text: '只读说明' }), row('slider', '音量', { enabled: true, min: 0, max: 100, step: 1, initial: 70, prefix: '', suffix: '' }), row('button', '返回', { enabled: true, action: 'emit', resetRows: [], submitRows: [] })] }] },
    ] } },
  ] };
  const { spec } = await materializePanelIntent(context, intent);
  assert.deepEqual(rows(spec).map(row => row.id), ['row0', 'row1', 'row2', 'row3', 'row4', 'row5']);
  assert.deepEqual(rows(spec)[0].action.fields, ['row2']); assert.deepEqual(rows(spec)[1].action.fields, ['row4']);
  assert.deepEqual(spec.tabs.pages.map(page => [page.id, page.sections]), [['page0', ['section0']], ['page1', ['section1', 'section2']]]);
  await validatePanelBundle(await createPanelBundle(spec, catalog, core), core);
});

test('ordinal transport rejects authored IDs, invalid references and duplicate scopes without correction', async () => {
  const { context, intent } = await fixture();
  for (const mutate of [
    value => { value.panel.body.children[0].id = 'section0'; },
    value => { value.panel.body.children[0].rows[0].id = 'row0'; },
    ...['row0', null, true, -1, 128, 0.5].map(index => value => { value.panel.body.children[1].rows[1].resetRows = [index]; }),
    ...[[0, 0], [3], [127]].map(indices => value => { value.panel.body.children[1].rows[1].resetRows = indices; }),
    value => { value.panel.body.children = Array.from({ length: 97 }, () => value.panel.body.children[0]); },
  ]) {
    const value = structuredClone(intent); mutate(value); const before = structuredClone(value);
    await assert.rejects(materializePanelIntent(context, value)); assert.deepEqual(value, before);
  }
  const legacy = compactIntentFixture(context, INPUT_STRESS_SUITE.cases.find(value => value.id === 'eval-graphics'));
  legacy.panelIntentVersion = '0.6';
  for (const section of legacy.panel.body.children) for (const row of section.rows) if (row.kind === 'button') row.submitRows = [];
  legacy.panel.body.children[1].rows[0].id = legacy.panel.body.children[0].rows[0].id;
  await assert.rejects(materializePanelIntent(context, legacy), { code: 'duplicate' });
});

test('literal numbered-row qualifier loss is rejected while explicitly separate short labels remain valid', async () => {
  const { context, intent } = await fixture('eval-inventory');
  const bad = structuredClone(intent); bad.panel.body.children[0].rows[1].label = '收藏';
  await assert.rejects(materializePanelIntent(context, bad), { code: 'INTENT_LABEL_QUALIFIER' });
  assert.equal(bad.panel.body.children[0].rows[1].label, '收藏', 'invalid output is not silently repaired');
  const bothText = context.request.text + '下一行收藏开关，默认关闭。';
  const separate = await fixture('eval-inventory', bothText);
  separate.intent.panel.body.children[0].rows.push({ ...separate.intent.panel.body.children[0].rows[1], label: '收藏', initial: false });
  await materializePanelIntent(separate.context, separate.intent);
});

test('new character wording quotes title without replacing the failed frozen request', async () => {
  const previous = INPUT_STRESS_SUITE.cases.find(value => value.id === 'eval-character');
  assert(previous.request.text.startsWith('角色信息面板，两列grid'));
  const revised = INPUT_STRESS_RECHECK_SUITE.cases.find(value => value.id === 'eval-character');
  assert(revised.request.text.includes('面板标题必须是“角色信息”'));
  assert.deepEqual(revised.expected, previous.expected);
  assert.equal(INPUT_STRESS_RECHECK_SUITE.cases.length, 3);
});

test('editing an ordinal-generated saved bundle preserves remaining IDs after deletion and reimport', async () => {
  const { context, intent } = await fixture('eval-notifications');
  const { spec } = await materializePanelIntent(context, intent);
  const edit = await createPanelEditContext(spec, catalog, { ...context.request, id: 'delete-first', text: '删除好友上线，其余保持。' });
  const patch = { patchVersion: '0.1', baseSpecSha256: edit.baseSpecSha256, reason: '明确删除第一项', operations: [{ op: 'remove-row', rowId: 'row0' }] };
  const next = await applyPanelPatch(spec, patch);
  const bundle = await validatePanelBundle(await createPanelBundle(next.spec, catalog, core), core);
  assert.deepEqual(rows(bundle.spec).map(row => row.id), ['row1', 'row2', 'row3']);
  assert.equal(rows(spec)[0].id, 'row0');
});
