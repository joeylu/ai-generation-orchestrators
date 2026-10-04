import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPrimitiveSvg } from '../src/redesign-primitives.mjs';

const sizes = [32, 64, 128, 256, 512, 1024];
const primitivePaths = ['Border/Flat/Square Filled.png', 'Border/Others/Modal Tab Button.png'];
for (const family of ['Rounded', 'Radial']) for (const size of sizes) {
  primitivePaths.push(`Border/${family}/${size}px/${family} Filled ${size}px.png`);
  for (let weight = 1; weight <= 10; weight++) primitivePaths.push(`Border/${family}/${size}px/${family} Outline ${size}px - ${weight}x.png`);
}
const shadows = ['Flat Shadow', 'Horizontal Shadow', 'Horizontal Shadow (Normal)', 'Horizontal Shadow (High)', 'Radial Shadow', 'Vertical Shadow'];
const demos = ['MUIP', 'MUIP Big', 'Discord', 'Demo Welcome'];
primitivePaths.push(...shadows.map(name => `Shadow/${name}.png`), ...demos.map(name => `Demo/${name}.png`));
const rounded = 'Border/Rounded/128px/Rounded Filled 128px.png';
const stroke = value => Number(/stroke-width="([.\d]+)"/.exec(value.svg)?.[1]);

test('all 144 intended semantic primitive paths have original safe SVG recipes', () => {
  assert.equal(primitivePaths.length, 144);
  assert.equal(new Set(primitivePaths).size, 144);
  for (const path of primitivePaths) {
    const out = renderPrimitiveSvg(path, { width: 1024, height: 768 });
    assert.match(out.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1024" height="768" viewBox="0 0 1024 768">/);
    assert.doesNotMatch(out.svg, /(?:NaN|undefined|Infinity|<script|<image|<foreignObject|<text|href=|data:)/);
    assert.ok(out.notes.length >= 2);
    if (out.border) {
      assert.ok(out.border.left + out.border.right < 1024, path);
      assert.ok(out.border.top + out.border.bottom < 768, path);
    }
  }
});

test('actual dimensions remain authoritative when the filename says 32px', () => {
  const out = renderPrimitiveSvg('Border/Rounded/32px/Rounded Filled 32px.png', { width: 1024, height: 1024 });
  assert.match(out.svg, /viewBox="0 0 1024 1024"/);
  assert.ok(out.notes.some(note => note.includes('recipe scale label') && note.includes('1024×1024')));
  assert.doesNotMatch(out.svg, /width="32"/);
});

test('all ten outline weights are distinct and monotonic for each family and nominal scale', () => {
  for (const family of ['Rounded', 'Radial']) for (const size of sizes) {
    let previous = 0;
    for (let weight = 1; weight <= 10; weight++) {
      const out = renderPrimitiveSvg(`Border/${family}/${size}px/${family} Outline ${size}px - ${weight}x.png`, { width: 1024, height: 1024 });
      assert.match(out.svg, /fill="none"/);
      const line = stroke(out);
      assert.ok(line > previous && line < 512, `${family} ${size}px ${weight}x`);
      previous = line;
    }
  }
});

test('rounded and radial shapes are tint masks without a background rectangle', () => {
  for (const path of [rounded, 'Border/Radial/128px/Radial Filled 128px.png']) {
    const out = renderPrimitiveSvg(path, { width: 128, height: 96, color: '#FFFFFF' });
    assert.match(out.svg, /fill="#FFFFFF"/);
    assert.doesNotMatch(out.svg, /background|linearGradient|opacity="1"/);
    assert.equal((out.svg.match(/<(?:rect|ellipse)\b/g) ?? []).length, 1);
  }
});

test('valid source slices remain independent immutable metadata', () => {
  const border = Object.freeze({ left: 12, bottom: 12, right: 12, top: 12 });
  const input = Object.freeze({ width: 128, height: 128, border });
  const out = renderPrimitiveSvg(rounded, input);
  assert.deepEqual(out.border, border);
  assert.notEqual(out.border, border);
  assert.ok(out.notes.some(note => note.includes('preserved')));
  const tab = renderPrimitiveSvg('Border/Others/Modal Tab Button.png', { width: 126, height: 126, border: { left: 10, bottom: 0, right: 10, top: 10 } });
  assert.deepEqual(tab.border, { left: 10, bottom: 0, right: 10, top: 10 });
  assert.ok(tab.notes.some(note => note.includes('flush lower edge')));
});

test('zero-center and undersized slices are replaced by bounded stretch margins', () => {
  const out = renderPrimitiveSvg('Border/Radial/32px/Radial Filled 32px.png', { width: 1024, height: 1024, border: { left: 512, bottom: 512, right: 512, top: 512 } });
  assert.deepEqual(out.border, { left: 511, bottom: 511, right: 511, top: 511 });
  assert.ok(out.notes.some(note => note.includes('recomputed')));
  const thick = renderPrimitiveSvg('Border/Rounded/32px/Rounded Outline 32px - 10x.png', { width: 1024, height: 1024, border: { left: 74, bottom: 74, right: 74, top: 74 } });
  assert.ok(thick.border.left > 74);
  assert.ok(thick.border.left + thick.border.right < 1024);
});

test('tiny and non-square dimensions retain nonnegative bounded geometry', () => {
  for (const path of primitivePaths) for (const [width, height] of [[1, 1], [4, 4], [3, 1024], [2048, 8]]) {
    const out = renderPrimitiveSvg(path, { width, height });
    assert.doesNotMatch(out.svg, /(?:width|height|rx|ry|stroke-width)="-/);
    if (out.border) {
      assert.ok(out.border.left + out.border.right < width, path);
      assert.ok(out.border.bottom + out.border.top < height, path);
    }
  }
});

test('shadows use black falloff, distinguish strength, and describe axis semantics', () => {
  const results = shadows.map(name => renderPrimitiveSvg(`Shadow/${name}.png`, { width: 256, height: 128 }));
  for (const result of results) {
    assert.match(result.svg, /#000000/);
    assert.doesNotMatch(result.svg, /#F1F5FC/);
    assert.ok(result.notes.some(note => note.includes('black alpha')));
  }
  const plain = results[1], normal = results[2], high = results[3];
  assert.match(plain.svg, /stop-opacity="0.18"/);
  assert.match(normal.svg, /stop-opacity="0.26"/);
  assert.match(high.svg, /stop-opacity="0.42"/);
  assert.match(plain.svg, /x2="0" y2="1"/);
  assert.match(results[5].svg, /x2="1" y2="0"/);
  assert.ok(results[4].notes.some(note => note.includes('unsliced')));
});

test('presentation artwork uses a coherent palette, geometric lettering, and role warnings', () => {
  const results = demos.map(name => renderPrimitiveSvg(`Demo/${name}.png`, { width: 617, height: 256 }));
  assert.equal(new Set(results.map(result => result.svg)).size, 4);
  for (const out of results) {
    assert.match(out.svg, /#71DBC3/);
    assert.match(out.svg, /#111622/);
    assert.doesNotMatch(out.svg, /<text|font-family|<image/);
    assert.equal(out.border, null);
    assert.ok(out.notes.some(note => note.startsWith('presentation-only')));
  }
});

test('strict input guards reject injection, unsupported paths and malformed geometry', () => {
  for (const path of [null, '../Border/Rounded/128px/Rounded Filled 128px.png', 'C:/Border/Flat/Square Filled.png', 'Border\\Flat\\Square Filled.png', 'Textures/Border/Flat/Square Filled.png', 'Icon/System/Settings.png', 'Border/Rounded/12px/Rounded Filled 12px.png', 'Border/Rounded/128px/Rounded Outline 128px - 11x.png', 'Border/Radial/128px/Radial Filled 128px - 1x.png', 'Border/Rounded/128px/Rounded Outline 128px.png']) {
    assert.throws(() => renderPrimitiveSvg(path, { width: 128, height: 128 }));
  }
  for (const options of [undefined, [], { width: 0, height: 2 }, { width: 1.5, height: 2 }, { width: 8193, height: 1 }, { width: 8192, height: 8192 }, { width: NaN, height: 2 }, { width: Infinity, height: 2 }, { width: '128', height: 128 }, { width: 128, height: 128, color: 'red' }, { width: 128, height: 128, color: '#fff\" onload=\"alert(1)' }, { width: 128, height: 128, border: { left: 2 } }, { width: 128, height: 128, border: { left: -1, bottom: 1, right: 1, top: 1 } }, { width: 128, height: 128, border: { left: 1, bottom: 1, right: 1, top: 1, arbitrary: 1 } }, { width: 128, height: 128, arbitrary: 1 }]) {
    assert.throws(() => renderPrimitiveSvg(rounded, options));
  }
});

test('accessor and non-JSON properties are rejected before reading user-controlled fields', () => {
  let invoked = false;
  const getter = { get width() { invoked = true; return 128; }, height: 128 };
  assert.throws(() => renderPrimitiveSvg(rounded, getter));
  assert.equal(invoked, false);
  const symbolic = { width: 128, height: 128, [Symbol('hidden')]: 1 };
  assert.throws(() => renderPrimitiveSvg(rounded, symbolic));
  const hidden = Object.defineProperty({ width: 128, height: 128 }, 'color', { value: '#FFFFFF', enumerable: false });
  assert.throws(() => renderPrimitiveSvg(rounded, hidden));
});
