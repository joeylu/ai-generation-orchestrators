import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { measureFlowLayout } from '../src/flow-layout.mjs';

const load = async name => JSON.parse(await readFile(new URL(`../examples/layout-v1/${name}.panel.json`, import.meta.url), 'utf8'));
const fixture = await load('settings');
const leaf = (sectionId, width = 'fill') => ({ kind: 'section', sectionId, width });
const flow = (kind, children, extras = {}) => ({ id: 'flow', kind, width: 'fill', gap: 20, align: 'start', children, ...extras });
const get = (result, id) => result.sections.find(section => section.id === id);
function plain() {
  const spec = structuredClone(fixture);
  spec.sections[0].rows = spec.sections[0].rows.slice(0, 1);
  spec.sections[1].rows = spec.sections[1].rows.slice(1, 3);
  spec.layout.maxHeight = 700; spec.layout.overflow = 'error';
  return spec;
}

test('column content sizes the panel; explicit child widths align without stretching', () => {
  const spec = plain();
  spec.layout.body = flow('column', [leaf('audio', 300), leaf('general', 500)], { align: 'center' });
  const before = structuredClone(spec), result = measureFlowLayout(spec);
  assert.deepEqual(spec, before);
  assert.equal(result.scrollable, false);
  assert.equal(result.body.width, 892);
  assert.equal(get(result, 'audio').x, 296);
  assert.equal(get(result, 'general').x, 196);
  assert.equal(get(result, 'general').y, get(result, 'audio').height + 20);
  assert.equal(result.panelHeight, result.contentHeight + 108);
  assert.equal(result.panelY, (720 - result.panelHeight) / 2);
});

test('row slots divide width equally and align different child heights vertically', () => {
  const spec = plain();
  spec.layout.body = flow('row', [leaf('audio'), leaf('general')], { align: 'end' });
  const result = measureFlowLayout(spec), a = get(result, 'audio'), b = get(result, 'general');
  assert.equal(a.width, 436); assert.equal(b.width, 436);
  assert.equal(b.x, 456); assert.equal(b.y, 0);
  assert.equal(a.y, b.height - a.height);
  assert.equal(result.contentHeight, b.height);
});

test('grid aligns each fixed-width child inside its cell and wraps below its declared breakpoint', () => {
  const spec = plain();
  spec.layout.body = flow('grid', [leaf('audio', 300), leaf('general', 350)], { minColumnWidth: 400, align: 'center' });
  let result = measureFlowLayout(spec), a = get(result, 'audio'), b = get(result, 'general');
  assert.equal(a.x, 68); assert.equal(b.x, 499);
  assert.equal(a.y, (b.height - a.height) / 2);
  spec.canvas.width = 760;
  result = measureFlowLayout(spec); a = get(result, 'audio'); b = get(result, 'general');
  assert.equal(result.width, 760); assert.equal(a.x, 206); assert.equal(b.x, 181);
  assert.equal(b.y, a.height + 20);
});

test('nested containers accumulate parent-relative coordinates without altering section order', () => {
  const spec = plain();
  spec.layout.body = flow('column', [flow('row', [leaf('audio'), leaf('general')], { width: 700 })], { align: 'end' });
  const result = measureFlowLayout(spec);
  assert.equal(get(result, 'audio').x, 192);
  assert.equal(get(result, 'general').x, 552);
  assert.deepEqual(result.sections.map(section => section.id), ['audio', 'general']);
});

test('scroll reserves its gutter, remeasures collapsed grids, and reserves canvas space for Select overlays', () => {
  const spec = structuredClone(fixture);
  spec.canvas.width = 748; // 700 px body: exactly two 340 px cells before the gutter.
  const result = measureFlowLayout(spec), a = get(result, 'audio'), b = get(result, 'general');
  assert.equal(result.scrollable, true); assert.equal(result.body.width, 684);
  assert.equal(a.x, 0); assert.equal(b.x, 0); assert.equal(b.y, a.height + 20);
  assert.equal(result.contentHeight, a.height + b.height + 20);
  assert.equal(result.panelHeight, 460);
  assert.equal(result.panelY, (720 - 122 - 460) / 2);
  assert.ok(result.panelY + result.panelHeight + 122 <= spec.canvas.height);
});

test('error overflow, impossible child slots and undersized scroll viewports fail instead of shrinking', () => {
  const cases = [];
  const height = structuredClone(fixture); height.layout.overflow = 'error'; cases.push([height, 'LAYOUT_OVERFLOW']);
  const width = plain(); width.layout.body = leaf('audio', 1000); cases.push([width, 'LAYOUT_OVERFLOW']);
  const gaps = plain(); gaps.layout.body = flow('row', [leaf('audio'), leaf('general')], { gap: 900 }); cases.push([gaps, 'LAYOUT_GEOMETRY']);
  const viewport = structuredClone(fixture); viewport.canvas.height = 260; cases.push([viewport, 'LAYOUT_OVERFLOW']);
  for (const [spec, code] of cases) assert.throws(() => measureFlowLayout(spec), error => error.code === code);
});

test('all four samples produce positive geometry; settings has two columns and compact settings one', async () => {
  const expected = ['settings', 'settings-compact', 'pause', 'character'];
  for (const name of expected) {
    const spec = await load(name), result = measureFlowLayout(spec);
    assert.ok(result.panelHeight > 0 && result.body.height > 0);
    assert.equal(result.sections.length, spec.sections.length);
    for (const section of result.sections) {
      assert.ok(section.x >= 0 && section.y >= 0);
      assert.ok(section.x + section.width <= result.body.width);
      assert.ok(section.y + section.height <= result.contentHeight);
    }
    if (name === 'settings') assert.ok(result.sections[1].x > 0);
    if (name === 'settings-compact') { assert.equal(result.sections[1].x, 0); assert.ok(result.sections[1].y > 0); }
    if (name === 'pause') assert.equal(result.sections[0].width, 360);
  }
});
