import assert from 'node:assert/strict';
import test from 'node:test';
import { supportedIconPaths } from '../src/redesign-icons.mjs';
import { classifyTexture } from '../src/texture-semantics.mjs';
import { TEXTURE_CURATION_POLICY, textureUsage } from '../src/texture-usage.mjs';

test('the versioned curation policy is immutable and independent of source classification', () => {
  assert.deepEqual(TEXTURE_CURATION_POLICY, { id: 'panel-core', version: '0.1' });
  assert.equal(Object.isFrozen(TEXTURE_CURATION_POLICY), true);
  assert.throws(() => { TEXTURE_CURATION_POLICY.version = 'forged'; }, TypeError);
  const path = 'Icon/Communication & Social/Twitter X.png';
  const before = classifyTexture(path);
  assert.deepEqual(textureUsage(path), { role: 'excluded', reason: 'brand-platform' });
  assert.deepEqual(classifyTexture(path), before);
  assert.equal(before.category, 'icon');
});

test('all 157 supported icon paths have the expected generation roles without Unity filesystem access', () => {
  const paths = supportedIconPaths();
  assert.equal(paths.length, 157);
  const counts = {};
  for (const path of paths) {
    const { role, reason } = textureUsage(path);
    const key = role === 'excluded' ? reason : role;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  assert.deepEqual(counts, { icon: 116, 'brand-platform': 17, 'animation-part': 5, 'layout-primitive': 1, 'control-illustration': 18 });
});

test('demo images and every UI Elements illustration are excluded by directory', () => {
  for (const path of ['Demo/MUIP.png', 'Demo/Nested/Any Image.png', 'Textures/Demo/Settings.png']) {
    assert.deepEqual(textureUsage(path), { role: 'excluded', reason: 'demo' });
  }
  for (const path of ['Icon/UI Elements/Button.png', 'Icon/UI Elements/Button (Filled).png', 'Icon/UI Elements/Unknown New Control.png', 'Icon/UI Elements/Nested/Settings.png']) {
    assert.deepEqual(textureUsage(path), { role: 'excluded', reason: 'control-illustration' });
  }
  assert.equal(textureUsage('Icon/UI Elements Extra/Button.png').role, 'icon');
  assert.equal(textureUsage('Icon/Media/UI Elements.png').role, 'icon');
});

test('all named platform variants are excluded without excluding ordinary communication icons', () => {
  for (const name of ['Discord', 'Facebook', 'Github', 'Instagram', 'Reddit', 'Steam', 'Twitter', 'YouTube']) {
    for (const suffix of ['', ' Filled', ' (Filled)', ' Outline', ' (Outline)', ' 2']) {
      assert.deepEqual(textureUsage(`Icon/Communication & Social/${name}${suffix}.png`), { role: 'excluded', reason: 'brand-platform' });
    }
  }
  assert.deepEqual(textureUsage('Icon/Communication & Social/Twitter X.png'), { role: 'excluded', reason: 'brand-platform' });
  assert.deepEqual(textureUsage('Icon/Communication & Social/Twitter X Filled.png'), { role: 'excluded', reason: 'brand-platform' });
  for (const name of ['Email', 'Email 2', 'Message', 'Message Empty', 'Share', 'User', 'Steamship', 'My Discord']) {
    assert.deepEqual(textureUsage(`Icon/Communication & Social/${name}.png`), { role: 'icon', reason: 'semantic-icon' });
  }
  assert.equal(textureUsage('Icon/Other/Twitter.png').role, 'icon');
});

test('animation parts remain distinct from icons and layout primitives retain exact path boundaries', () => {
  for (const name of ['Heart Pop', 'Lock Bottom', 'Lock Top', 'Sand Clock', 'Sand Clock Sand']) {
    assert.deepEqual(textureUsage(`Icon/Others/Animation Icon Stuff/${name}.png`), { role: 'animation-part', reason: 'animation-part' });
  }
  assert.deepEqual(textureUsage('Icon/System/Lock.png'), { role: 'icon', reason: 'semantic-icon' });
  assert.equal(textureUsage('Icon/Others/Animation Icon Stuff Extra/Lock Top.png').role, 'icon');
  assert.deepEqual(textureUsage('Icon/Others/Panel Seperator.png'), { role: 'layout-primitive', reason: 'panel-separator' });
  assert.deepEqual(textureUsage('Border/Flat/Square Filled.png'), { role: 'layout-primitive', reason: 'flat-fill' });
  assert.equal(textureUsage('Icon/Others/Panel Seperator Extra.png').role, 'icon');
  assert.equal(textureUsage('Border/Flat/Square Filled Extra.png').role, 'shape');
});

test('remaining borders and shadows are generation primitives while unknown categories are excluded', () => {
  assert.deepEqual(textureUsage('Border/Rounded/64px/Rounded Filled 64px.png'), { role: 'shape', reason: 'geometric-shape' });
  assert.deepEqual(textureUsage('Border/Radial/64px/Radial Outline 64px - 1x.png'), { role: 'shape', reason: 'geometric-shape' });
  assert.deepEqual(textureUsage('Shadow/Horizontal Shadow.png'), { role: 'effect', reason: 'shadow-effect' });
  assert.deepEqual(textureUsage('Unknown/Settings.png'), { role: 'excluded', reason: 'unsupported-role' });
  assert.deepEqual(textureUsage('Demo Extra/Settings.png'), { role: 'excluded', reason: 'unsupported-role' });
});

test('portable prefix and case handling match classifier rules and unsafe paths remain rejected', () => {
  assert.deepEqual(textureUsage('Textures/Icon/UI Elements/Button.png'), textureUsage('icon/ui elements/button.PNG'));
  assert.deepEqual(textureUsage('TEXTURES/BORDER/FLAT/SQUARE FILLED.PNG'), { role: 'layout-primitive', reason: 'flat-fill' });
  assert.deepEqual(textureUsage('textures/ICON/COMMUNICATION & SOCIAL/GITHUB (FILLED).png'), { role: 'excluded', reason: 'brand-platform' });
  for (const path of ['', '/Icon/Settings.png', 'C:/Icon/Settings.png', '../Icon/Settings.png', 'Icon/../Settings.png', 'Icon\\Settings.png', 'Icon/Settings.png\n']) {
    assert.throws(() => textureUsage(path), /safe relative/);
  }
});
