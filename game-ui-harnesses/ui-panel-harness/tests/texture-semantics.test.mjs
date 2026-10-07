import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyTexture, parseUnityTextureMeta } from '../src/texture-semantics.mjs';

const dimensions = { width: 256, height: 128 };
const meta = `fileFormatVersion: 2
guid: 3296a71782ce9ce42a9fe71d6f86a3ef
TextureImporter:
  spriteMode: 1
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: 100
  spriteBorder: {x: 16, y: 8, z: 16, w: 8}
  alphaIsTransparency: 1
`;

test('rounded and radial border variants collapse into geometric families', () => {
  const rounded = classifyTexture('Border/Rounded/64px/Rounded Outline 64px - 9x.png');
  assert.equal(rounded.family, 'border.rounded');
  assert.deepEqual(rounded.variant, { style: 'outline', nominalSize: 64, weight: 9 });
  const filled = classifyTexture('Textures/Border/Rounded/512px/Rounded Filled 512px.png');
  assert.equal(filled.family, rounded.family);
  assert.deepEqual(filled.variant, { style: 'filled', nominalSize: 512, weight: null });
  const radial = classifyTexture('Border/Radial/1024px/Radial Outline 1024px - 10x.png');
  assert.equal(radial.family, 'border.radial');
  assert.deepEqual(radial.variant, { style: 'outline', nominalSize: 1024, weight: 10 });
  assert.equal(rounded.semanticEvidence, 'path-rules');
  assert.equal(rounded.review, 'NOT_RUN');
});

test('icon Filled suffixes share a family without guessing unmarked style', () => {
  const plain = classifyTexture('Icon/UI Elements/Switch.png');
  const filled = classifyTexture('Icon/UI Elements/Switch (Filled).png');
  assert.equal(plain.family, 'icon.switch');
  assert.equal(filled.family, plain.family);
  assert.equal(plain.variant.style, 'default');
  assert.equal(filled.variant.style, 'filled');
  assert.equal(classifyTexture('Icon/Device/Speaker Filled.png').family, 'icon.speaker');
  assert.notEqual(classifyTexture('Icon/Common/Eye Off.png').family, classifyTexture('Icon/Common/Eye.png').family);
});

test('filename aliases make common English icons retrievable in Chinese', () => {
  for (const [name, alias] of [['Speaker', '音量'], ['Volume', '声音'], ['Settings', '设置'], ['Close', '关闭'], ['Check', '确认'], ['Arrow Left', '向左'], ['Play', '播放'], ['Pause', '暂停'], ['User', '用户'], ['Search', '搜索']]) {
    assert.ok(classifyTexture(`Icon/Group/${name}.png`).tags.includes(alias), name);
  }
});

test('animation parts and presentation assets stay visibly separate', () => {
  const top = classifyTexture('Icon/Others/Animation Icon Stuff/Lock Top.png');
  const bottom = classifyTexture('Icon/Others/Animation Icon Stuff/Lock Bottom.png');
  const lock = classifyTexture('Icon/System/Lock.png');
  assert.equal(top.family, 'icon.part.lock-top');
  assert.equal(top.variant.style, 'part');
  assert.notEqual(top.family, bottom.family);
  assert.notEqual(top.family, lock.family);
  assert.ok(top.tags.includes('animation-part'));
  assert.ok(classifyTexture('Demo/MUIP.png').tags.includes('presentation-only'));
  assert.equal(classifyTexture('Shadow/Horizontal Shadow (High).png').category, 'shadow');
  assert.equal(classifyTexture('Unclassified/Logo.png').category, 'other');
});

test('classification rejects unsafe or nonportable paths', () => {
  for (const path of ['', '/Icon/Play.png', 'C:/Icon/Play.png', 'Icon\\Play.png', '../Icon/Play.png', 'Icon/../Play.png', 'Icon/./Play.png', 'Icon//Play.png', 'Icon/Play.png\0', 'Icon/Play.png\n', 'x'.repeat(513), 'Icon/\ud800.png', null]) {
    assert.throws(() => classifyTexture(path), /safe relative/);
  }
});

test('single sprite metadata returns source values and valid nine slice geometry', () => {
  assert.deepEqual(parseUnityTextureMeta(meta, dimensions), {
    guid: '3296a71782ce9ce42a9fe71d6f86a3ef', spriteMode: 1, pixelsPerUnit: 100,
    pivot: { x: 0.5, y: 0.5 }, border: { left: 16, bottom: 8, right: 16, top: 8 },
    alphaIsTransparency: true, nineSlice: 'valid', issues: [],
  });
  const zero = parseUnityTextureMeta(meta.replace('{x: 16, y: 8, z: 16, w: 8}', '{x: 0, y: 0, z: 0, w: 0}').replace('alphaIsTransparency: 1', 'alphaIsTransparency: 0'), dimensions);
  assert.equal(zero.nineSlice, 'none');
  assert.equal(zero.alphaIsTransparency, false);
});

test('nested sprite sheets and AssetOrigin cannot overwrite importer or root fields', () => {
  const result = parseUnityTextureMeta(`${meta}  spriteSheet:
    sprites:
    - name: attacker
      spriteMode: 2
      spriteBorder: {x: 999, y: 999, z: 999, w: 999}
    spritePivot: {x: 0, y: 0}
    guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
AssetOrigin:
  guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  spriteMode: 2
  spriteBorder: {x: 999, y: 999, z: 999, w: 999}
`, dimensions);
  assert.deepEqual(result, parseUnityTextureMeta(meta, dimensions));
});

test('missing and duplicate fields stay unknown rather than acquiring defaults', () => {
  const absent = parseUnityTextureMeta('', dimensions);
  assert.equal(absent.guid, null);
  assert.equal(absent.border, null);
  assert.equal(absent.nineSlice, 'unknown');
  assert.ok(absent.issues.includes('missing:TextureImporter'));
  assert.ok(absent.issues.includes('missing:spriteBorder'));
  const duplicate = parseUnityTextureMeta(`${meta}  spriteBorder: {x: 1, y: 1, z: 1, w: 1}\nguid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n`, dimensions);
  assert.equal(duplicate.border, null);
  assert.equal(duplicate.guid, null);
  assert.equal(duplicate.nineSlice, 'unknown');
  assert.ok(duplicate.issues.includes('duplicate:spriteBorder'));
  assert.ok(duplicate.issues.includes('duplicate:guid'));
  const roots = parseUnityTextureMeta(`${meta}TextureImporter:\n  spriteMode: 1\n`, dimensions);
  assert.equal(roots.spriteMode, null);
  assert.equal(roots.border, null);
  assert.ok(roots.issues.includes('duplicate:TextureImporter'));
});

test('invalid numeric data never becomes a successful nine slice or is silently repaired', () => {
  for (const value of ['.nan', 'Infinity', '1e999', 'not-a-number']) {
    const result = parseUnityTextureMeta(meta.replace('x: 16', `x: ${value}`), dimensions);
    assert.equal(result.border, null);
    assert.equal(result.nineSlice, 'invalid');
    assert.ok(result.issues.includes('invalid:spriteBorder'));
  }
  for (const [replacement, value] of [['x: -1', -1], ['x: 240', 240], ['x: 241', 241]]) {
    const result = parseUnityTextureMeta(meta.replace('x: 16', replacement), dimensions);
    assert.equal(result.border.left, value);
    assert.equal(result.nineSlice, 'invalid');
    assert.ok(result.issues.includes('invalid:spriteBorder-geometry'));
  }
  const duplicatedVector = parseUnityTextureMeta(meta.replace('x: 16, y: 8', 'x: 16, x: 8'), dimensions);
  assert.equal(duplicatedVector.border, null);
  assert.equal(duplicatedVector.nineSlice, 'invalid');
  const ppu = parseUnityTextureMeta(meta.replace('spritePixelsToUnits: 100', 'spritePixelsToUnits: -1'), dimensions);
  assert.equal(ppu.pixelsPerUnit, -1);
  assert.ok(ppu.issues.includes('invalid:spritePixelsToUnits'));
});

test('multiple sprites cannot claim a usable single sprite border', () => {
  for (const mode of [0, 2, 7]) {
    const result = parseUnityTextureMeta(meta.replace('spriteMode: 1', `spriteMode: ${mode}`), dimensions);
    assert.equal(result.spriteMode, mode);
    assert.equal(result.nineSlice, 'unknown');
    assert.ok(result.issues.includes('not-single-sprite:spriteMode'));
    assert.deepEqual(result.border, { left: 16, bottom: 8, right: 16, top: 8 });
  }
});

test('the metadata reader is bounded and accepts Unity decimal/scientific numeric notation', () => {
  assert.throws(() => parseUnityTextureMeta(meta, { width: 0, height: 1 }), /dimensions/);
  assert.throws(() => parseUnityTextureMeta(null, dimensions), /meta text/);
  assert.throws(() => parseUnityTextureMeta('x'.repeat(2 * 1024 * 1024 + 1), dimensions), /meta text/);
  const result = parseUnityTextureMeta(`\uFEFF${meta.replace('spritePixelsToUnits: 100', 'spritePixelsToUnits: 1e2 # unit scale').replace('x: 0.5', 'x: .5')}`.replaceAll('\n', '\r\n'), dimensions);
  assert.equal(result.pixelsPerUnit, 100);
  assert.deepEqual(result.pivot, { x: 0.5, y: 0.5 });
  assert.deepEqual(result.issues, []);
});
