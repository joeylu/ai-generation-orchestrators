import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureDocument } from '../src/fixtures.ts';
import { walkNodes, type UiNodeType } from '../src/tree-contract.ts';
import { compileMotionPreset, type MotionRecipe } from '../src/motion-presets.ts';
import { motionCapabilities, sampleMotion, validateMotion } from '../src/motion.ts';
import { HarnessError } from '../src/contract.ts';

const document = fixtureDocument('gallery');
const types: UiNodeType[] = ['Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs'];
const definitions = [
  { preset: 'fade-in', parameters: { duration: 100, fromAlpha: 0.2, easing: 'linear' } },
  { preset: 'fade-out', parameters: { duration: 100, toAlpha: 0.2, easing: 'linear' } },
  { preset: 'slide-in', parameters: { duration: 100, fromX: -10, fromY: 12, fromAlpha: 0, easing: 'ease-out' } },
  { preset: 'pulse', parameters: { attackMs: 40, releaseMs: 60, scale: 0.97, easing: 'ease-out' } },
  { preset: 'shake', parameters: { stepMs: 20, distance: 6, cycles: 2, easing: 'ease-in-out' } },
] as const;
function recipe(targetId: string, index = 3): MotionRecipe {
  return structuredClone({ presetVersion: '0.1', id: `test-${targetId}`, targetId, trigger: { type: 'manual' }, ...definitions[index] }) as MotionRecipe;
}
for (const type of types) test(`${type}: all five whole-node recipes compile, sample and preserve UI`, () => {
  const node = walkNodes(document).find(node => node.type === type)!;
  assert.ok(node);
  for (let index = 0; index < definitions.length; index++) {
    const input = recipe(node.id, index), before = structuredClone([document, input]);
    const motion = compileMotionPreset(input, document);
    assert.deepEqual(validateMotion(motion, document), motion);
    assert.deepEqual([document, input], before);
    assert.equal(new Set(motion.tracks.map(track => track.targetId)).size, 1);
    const middle = sampleMotion(motion, 40)[0].values;
    const final = sampleMotion(motion, motion.duration)[0].values;
    if (index === 3) {
      assert.ok(Math.abs(middle.x! + node.layout.width * middle.scaleX! / 2 - node.layout.width / 2) < 1e-8);
      assert.ok(Math.abs(middle.y! + node.layout.height * middle.scaleY! / 2 - node.layout.height / 2) < 1e-8);
      assert.deepEqual(final, { scaleX: 1, scaleY: 1, x: 0, y: 0 });
    } else if (index === 4) assert.equal(final.x, 0);
    else assert.ok(Math.abs(final.alpha! - (index === 1 ? 0.2 : 1)) < 1e-12);
  }
});

test('capability registry covers 16 types and exposes only implemented trigger pairs', () => {
  const report = motionCapabilities(document);
  assert.deepEqual(new Set(report.types.map(item => item.type)), new Set(types));
  assert.deepEqual(report.implementedAdapters, ['pixijs']);
  assert.equal(report.nodes.length, walkNodes(document).length);
  const changes = new Set(['Switch', 'CheckBox', 'RadioGroup', 'Input', 'Select', 'Slider', 'List', 'Tabs']);
  for (const node of walkNodes(document)) {
    for (const event of ['activate', 'change', 'press', 'release', 'cancel', 'focus', 'scroll', 'show']) {
      const input = { ...recipe(node.id), trigger: { type: 'event', targetId: node.id, event } };
      if ((event === 'activate' && node.type === 'Button') || (event === 'change' && changes.has(node.type))) {
        assert.equal(compileMotionPreset(input, document).trigger.type, 'event');
      } else assert.throws(() => compileMotionPreset(input, document), /UNSUPPORTED_TRIGGER/);
    }
  }
  assert.ok(report.types.find(item => item.type === 'Select')!.limitations.includes('POPUP_TRANSFORMS_NOT_INHERITED'));
  report.types[0].properties.length = 0;
  assert.equal(motionCapabilities(document).types[0].properties.length, 6);
});

test('pulse keeps layout center through easing, including subpixel and expanded samples', () => {
  const node = walkNodes(document).find(node => node.id === 'confirm')!;
  const input = recipe(node.id) as Extract<MotionRecipe, { preset: 'pulse' }>;
  for (const scale of [0.5, 0.98, 1.2]) for (const easing of ['linear', 'ease-out', 'ease-in-out'] as const) {
    input.parameters.scale = scale; input.parameters.easing = easing;
    const motion = compileMotionPreset(input, document);
    for (const time of [0, 5.5, 20, 40, 60.5, 99, 100]) {
      const value = sampleMotion(motion, time)[0].values;
      assert.ok(Math.abs(value.x! + node.layout.width * value.scaleX! / 2 - node.layout.width / 2) < 1e-8);
      assert.ok(Math.abs(value.y! + node.layout.height * value.scaleY! / 2 - node.layout.height / 2) < 1e-8);
    }
  }
});

test('recipes reject unsupported params, nonfinite numbers, unsafe timelines and non-node identifiers', () => {
  const invalid = [
    { ...recipe('confirm'), extra: true }, { ...recipe('confirm'), presetVersion: '2' },
    { ...recipe('confirm'), preset: '__proto__' }, recipe('unknown'), recipe('quality-low'),
    { ...recipe('confirm'), parameters: { attackMs: 60, releaseMs: 60, scale: 1, easing: 'spring' } },
    { ...recipe('confirm'), parameters: { attackMs: 60, releaseMs: 60, scale: NaN, easing: 'linear' } },
    { ...recipe('confirm'), parameters: { attackMs: 60, releaseMs: 60, scale: 0, easing: 'linear' } },
    { ...recipe('confirm'), parameters: { attackMs: 120000, releaseMs: 60, scale: 1, easing: 'linear' } },
    { ...recipe('confirm', 4), parameters: { stepMs: 20, distance: 3, cycles: 1.5, easing: 'linear' } },
    { ...recipe('confirm', 4), parameters: { stepMs: 120000, distance: 3, cycles: 8, easing: 'linear' } },
    { ...recipe('confirm', 0), parameters: { duration: 100, fromAlpha: 2, easing: 'linear' } },
    { ...recipe('confirm'), parameters: {} },
  ];
  for (const input of invalid) assert.throws(() => compileMotionPreset(input, document), HarnessError);
  assert.throws(() => compileMotionPreset(recipe('confirm'), { schemaVersion: '0.1' }), HarnessError);
});
