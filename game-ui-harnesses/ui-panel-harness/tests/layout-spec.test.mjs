import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validatePanelSpec, validatePanelState } from '../src/spec.mjs';
import { resolveRecipe, searchCatalog, validateCatalog } from '../src/catalog.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { digestJson } from '../src/canonical.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const base = read('../examples/audio-settings.panel.json');
const leaf = (sectionId, width = 'fill') => ({ kind: 'section', sectionId, width });
const container = (id, kind, children) => ({ id, kind, width: 'fill', gap: 16, align: 'start', children,
  ...(kind === 'grid' ? { minColumnWidth: 280 } : {}) });
const textRow = (id = 'summary-row') => ({ id, kind: 'text', recipe: { id: 'settings.text', version: '0.1.0' }, label: '角色', text: '莓莓 · 等级 12' });
function fixture() {
  const spec = structuredClone(base);
  spec.panelSpecVersion = '0.4'; spec.assets = null;
  Object.assign(spec.layout, { maxHeight: 600, overflow: 'scroll', body: container('body', 'column', [leaf('audio')]) });
  return spec;
}
function stateless() {
  const spec = fixture(); spec.state = [];
  spec.sections[0].rows = [textRow()];
  return spec;
}
function rejects(mutate, code) {
  const spec = fixture(); mutate(spec);
  assert.throws(() => validatePanelSpec(spec), { code });
}
async function patch(spec, operations) {
  return applyPanelPatch(spec, { patchVersion: '0.1', baseSpecSha256: await digestJson(spec),
    reason: 'Programmatic layout contract regression', operations });
}

test('0.4 preserves explicit values and isolates nested containers while older specs remain unchanged', () => {
  const spec = fixture(), checked = validatePanelSpec(spec);
  assert.deepEqual(checked, spec);
  checked.layout.body.children[0].width = 400;
  assert.equal(spec.layout.body.children[0].width, 'fill');
  assert.deepEqual(validatePanelSpec(base), base);
  const legacy = structuredClone(base); legacy.layout.body = spec.layout.body;
  assert.throws(() => validatePanelSpec(legacy), { code: 'unknown-key' });
  rejects(s => { s.panelSpecVersion = '0.6'; }, 'required');
});

test('layout tree requires every section exactly once, existing references and unique container IDs', () => {
  rejects(s => { s.layout.body.children.push(leaf('audio')); }, 'duplicate');
  rejects(s => { s.layout.body.children[0].sectionId = 'missing'; }, 'layout-section');
  rejects(s => { s.sections.push({ id: 'profile', title: '角色', rows: [textRow()] }); }, 'layout-coverage');
  rejects(s => { s.layout.body.children = [container('body', 'row', [leaf('audio')])]; }, 'duplicate');
  const spec = fixture(); spec.layout.body.id = 'audio';
  assert.equal(validatePanelSpec(spec).layout.body.id, 'audio', 'container IDs have a separate namespace');
});

test('layout tree exact shapes reject unknown fields, invalid dimensions, alignment and grid thresholds', () => {
  for (const kind of ['column', 'row', 'grid']) {
    const spec = fixture(); spec.layout.body = container('body', kind, [leaf('audio', 400)]);
    assert.deepEqual(validatePanelSpec(spec).layout.body, spec.layout.body);
  }
  for (const [mutate, code] of [
    [s => { s.layout.body.children[0].id = 'unexpected'; }, 'unknown-key'],
    [s => { s.layout.body.children = []; }, 'array'],
    [s => { s.layout.body.width = 'auto'; }, 'integer'],
    [s => { s.layout.body.children[0].width = 0; }, 'integer'],
    [s => { s.layout.body.gap = 257; }, 'integer'],
    [s => { s.layout.body.align = 'stretch'; }, 'layout-align'],
    [s => { s.layout.body.kind = 'stack'; }, 'layout-kind'],
    [s => { s.layout.body.kind = 'grid'; }, 'required'],
    [s => { s.layout.body.minColumnWidth = 280; }, 'unknown-key'],
    [s => { s.layout.body = container('grid', 'grid', [leaf('audio')]); s.layout.body.minColumnWidth = 0; }, 'integer'],
    [s => { delete s.layout.maxHeight; }, 'required'],
    [s => { s.layout.maxHeight = 4097; }, 'integer'],
    [s => { s.layout.overflow = 'hidden'; }, 'layout-overflow'],
  ]) rejects(mutate, code);
});

test('layout depth permits eight levels and rejects nine without unbounded traversal', () => {
  const spec = fixture(); let body = leaf('audio');
  for (let i = 0; i < 7; i++) body = container(`level${i}`, 'column', [body]);
  spec.layout.body = body;
  assert.deepEqual(validatePanelSpec(spec).layout.body, body);
  spec.layout.body = container('ninth', 'column', [body]);
  assert.throws(() => validatePanelSpec(spec), { code: 'layout-structure' });
});

test('layout node budget accepts 96 nodes and rejects 97 even with valid depth and section coverage', () => {
  const spec = stateless();
  spec.sections = Array.from({ length: 32 }, (_, i) => ({ id: `section${i}`, title: `信息 ${i}`, rows: [textRow(`row${i}`)] }));
  spec.layout.body = container('body', 'column', spec.sections.map((section, i) =>
    container(`outer${i}`, 'column', [i === 31 ? leaf(section.id) : container(`inner${i}`, 'column', [leaf(section.id)])])));
  assert.equal(validatePanelSpec(spec).sections.length, 32);
  spec.layout.body.children[31].children[0] = container('inner31', 'column', [leaf('section31')]);
  assert.throws(() => validatePanelSpec(spec), { code: 'layout-structure' });
});

test('read-only text rows and pure button menus have an exact empty state contract', () => {
  const spec = stateless();
  assert.deepEqual(validatePanelState(spec, {}), {});
  assert.throws(() => validatePanelState(spec, { summary: 'extra' }), { code: 'unknown-key' });
  const button = { id: 'resume', kind: 'button', recipe: { id: 'settings.button', version: '0.1.0' },
    label: '', buttonLabel: '继续游戏', enabled: true, event: 'menu.resume', action: { kind: 'emit' } };
  spec.sections[0].rows = [button];
  assert.equal(validatePanelSpec(spec).sections[0].rows[0].label, '');
  button.label = ' ';
  assert.throws(() => validatePanelSpec(spec), { code: 'text' });
  button.label = ''; button.action = { kind: 'reset-initial', fields: ['missing'] };
  assert.throws(() => validatePanelSpec(spec), { code: 'action-field' });
});

test('text rows reject interactive fields, empty/overlong/multiline content and older spec versions', () => {
  for (const key of ['bind', 'enabled', 'event']) {
    const spec = stateless(); spec.sections[0].rows[0][key] = key === 'enabled' ? true : 'extra';
    assert.throws(() => validatePanelSpec(spec), { code: 'unknown-key' });
  }
  for (const value of ['', ' ', 'a'.repeat(121), 'a\nb', 'a\rb', 'a\u2028b', 'a\u2029b']) {
    const spec = stateless(); spec.sections[0].rows[0].text = value;
    assert.throws(() => validatePanelSpec(spec), { code: 'text' });
  }
  const spec = fixture(); spec.panelSpecVersion = '0.3';
  for (const key of ['body', 'maxHeight', 'overflow']) delete spec.layout[key];
  spec.sections[0].rows.push(textRow());
  assert.throws(() => validatePanelSpec(spec), { code: 'row-kind' });
  spec.sections[0].rows.pop(); spec.state = []; spec.sections[0].rows = [];
  assert.throws(() => validatePanelSpec(spec), { code: 'array' });
});

test('text add/remove patches require state:null and preserve layout references and existing state', async () => {
  const spec = fixture(), original = structuredClone(spec);
  const added = await patch(spec, [{ op: 'add-row', sectionId: 'audio', afterRowId: null, row: textRow(), state: null }]);
  assert.deepEqual(spec, original);
  assert.deepEqual(added.receipt.changedRowIds, ['summary-row']);
  assert.deepEqual(added.spec.state, spec.state);
  assert.deepEqual(added.spec.layout, spec.layout);
  const removed = await patch(added.spec, [{ op: 'remove-row', rowId: 'summary-row' }]);
  assert.deepEqual(removed.spec, spec);
  await assert.rejects(patch(spec, [{ op: 'add-row', sectionId: 'audio', afterRowId: null, row: textRow(), state: { id: 'extra', type: 'boolean', initial: true } }]), { code: 'button-state' });
  await assert.rejects(patch(added.spec, [{ op: 'set-row-enabled', rowId: 'summary-row', enabled: true }]), { code: 'unknown-key' });
});

test('layout patches validate complete tree coverage and support pure-menu button labels', async () => {
  const spec = fixture();
  const nextLayout = { ...spec.layout, body: leaf('audio', 480), overflow: 'error' };
  assert.deepEqual((await patch(spec, [{ op: 'set-layout', layout: nextLayout }])).spec.layout, nextLayout);
  await assert.rejects(patch(spec, [{ op: 'set-layout', layout: { ...nextLayout, body: leaf('missing') } }]), { code: 'layout-section' });
  const added = await patch(stateless(), [{ op: 'add-row', sectionId: 'audio', afterRowId: null, state: null,
    row: { id: 'resume', kind: 'button', recipe: { id: 'settings.button', version: '0.1.0' }, label: '操作',
      buttonLabel: '继续', enabled: true, event: 'menu.resume', action: { kind: 'emit' } } }]);
  const changed = await patch(added.spec, [{ op: 'set-row-label', rowId: 'resume', label: '' }]);
  assert.equal(changed.spec.sections[0].rows[0].label, '');
  assert.deepEqual(changed.spec.state, []);
});

test('layout catalog adds a discoverable read-only recipe without changing existing recipes or themes', () => {
  const original = read('../examples/modern-mint-controls.catalog.json');
  const catalog = validateCatalog(read('../examples/modern-mint-layout.catalog.json'));
  assert.equal(catalog.id, 'modern-mint-layout'); assert.equal(catalog.version, '0.1.0');
  assert.deepEqual(catalog.themes, original.themes);
  assert.deepEqual(catalog.recipes.slice(0, original.recipes.length), original.recipes);
  assert.equal(resolveRecipe(catalog, { id: 'settings.text', version: '0.1.0' }, 'text-row').minWidth, 240);
  assert.equal(searchCatalog(catalog, { query: '角色信息', kind: 'text-row', target: 'pixi' })[0].recipe.id, 'settings.text');
});

test('new JSON schemas expose layout/text shapes, preserve strict unions and resolve every reference', () => {
  const files = ['panel-spec.schema.json', 'panel-spec-v0.2.schema.json', 'panel-spec-v0.3.schema.json',
    'panel-spec-v0.4.schema.json', 'panel-spec-v0.5.schema.json','panel-spec-v0.6.schema.json','panel-spec-v0.7.schema.json', 'panel-spec-v0.8.schema.json', 'panel-spec-v0.9.schema.json', 'panel-spec-v0.10.schema.json', 'panel-spec-v0.11.schema.json', 'panel-spec-v0.12.schema.json', 'panel-spec-v0.13.schema.json', 'panel-spec-v0.14.schema.json', 'panel-request.schema.json', 'panel-patch.schema.json', 'panel-edit-context.schema.json', 'panel-edit-context-v0.2.schema.json', 'panel-edit-context-v0.3.schema.json', 'panel-edit-context-v0.4.schema.json'];
  const schemas = files.map(file => read(`../schemas/${file}`)), registry = new Map(schemas.map(schema => [schema.$id, schema]));
  function visit(value, owner) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const [id, fragment = ''] = value.$ref.split('#');
      let target = id ? registry.get(id) : owner;
      assert.ok(target, `unknown schema ${value.$ref}`);
      for (const part of fragment.split('/').filter(Boolean)) target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      assert.ok(target, `unknown reference ${value.$ref}`);
    }
    Object.values(value).forEach(child => visit(child, owner));
  }
  schemas.forEach(schema => visit(schema, schema));
  const latest = registry.get('urn:ai-game-assets:panel-spec:0.4');
  assert.equal(latest.properties.state.minItems, 0);
  assert.equal(latest.$defs.textRow.additionalProperties, false);
  assert.deepEqual(latest.$defs.textRow.required, ['id', 'kind', 'recipe', 'label', 'text']);
  const patchSchema = registry.get('urn:ai-game-assets:panel-patch:0.1');
  assert.deepEqual(patchSchema.$defs.addRow.allOf[0].if.properties.row.properties.kind.enum, ['button', 'text']);
  assert.equal(patchSchema.$defs.setLayout.properties.layout.oneOf.length, 2);
});
