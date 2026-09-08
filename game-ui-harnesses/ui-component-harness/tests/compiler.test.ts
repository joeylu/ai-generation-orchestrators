import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileButton, validateButtonIntent, validatePreviewPolicy } from '../src/intent-compiler.ts';
import { HarnessError } from '../src/contract.ts';
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const intent = () => read('../analysis/button-confirm.intent.json');
const policy = () => read('../examples/preview-policy.json');
const image = { width: 347, height: 133 };

test('compile actual button matches accepted contract and does not duplicate baked text', () => {
  const result = compileButton(intent(), image, policy());
  assert.deepEqual(result, read('../examples/button-confirm.json'));
  assert.deepEqual(Object.keys(result.slots), ['visual']);
  assert.deepEqual(result.layout, { x: 146.5, y: 133.5, width: 347, height: 133 });
});
test('deterministic output; no input mutation or shared output references', () => {
  const i = intent(), p = policy(), f = { ...image }; const before = structuredClone([i, p, f]);
  const a = compileButton(i, f, p), b = compileButton(i, f, p);
  assert.deepEqual(a, b); assert.deepEqual([i, p, f], before);
  a.layout.width = 1; assert.equal(b.layout.width, 347);
});
test('same compiler accepts another image and explicit scale/enabled without hand-written layout', () => {
  const i = intent(); i.id = 'second'; i.visual.source = './second.png'; i.text = { mode: 'none', value: '' };
  const p = policy(); p.scale = 0.5; p.enabled = false;
  const result = compileButton(i, { width: 120, height: 40 }, p);
  assert.deepEqual(result.layout, { x: 290, y: 190, width: 60, height: 20 });
  assert.equal(result.props.enabled, false); assert.equal(result.slots.visual.id, 'second_visual');
  assert.equal(result.slots.visual.props.source, './second.png');
});
test('large image preserves explicit scale; no silent auto-fit', () => {
  assert.deepEqual(compileButton(intent(), { width: 1000, height: 600 }, policy()).layout, { x: -180, y: -100, width: 1000, height: 600 });
});
const invalidIntents: [string, (i: any) => void, string][] = [
  ['unknown version', i => i.intentVersion = '2', '$intent.intentVersion'],
  ['unresolved', i => i.componentType = 'Unresolved', '$intent.componentType'],
  ['unsupported type', i => i.componentType = 'Custom', '$intent.componentType'],
  ['missing id', i => delete i.id, '$intent.id'],
  ['missing source', i => delete i.visual.source, '$intent.visual.source'],
  ['empty source', i => i.visual.source = ' ', '$intent.visual.source'],
  ['unsafe source scheme', i => i.visual.source = 'file:///secret', '$intent.visual.source'],
  ['layer mode', i => i.visual.mode = 'layers', '$intent.visual.mode'],
  ['independent label', i => i.text.mode = 'separate', '$intent.text.mode'],
  ['unknown baked text', i => i.text.value = '', '$intent.text.value'],
  ['none with non-empty text', i => i.text.mode = 'none', '$intent.text.value'],
  ['guessed width', i => i.visual.width = 347, '$intent.visual.width'],
  ['inferred business event', i => i.action = 'confirmPurchase', '$intent.action'],
  ['inferred enabled', i => i.enabled = true, '$intent.enabled'],
];
for (const [name, mutate, path] of invalidIntents) test(`intent rejects ${name}`, () => {
  const i = intent(); mutate(i);
  assert.throws(() => compileButton(i, image, policy()), (e: unknown) => e instanceof HarnessError && e.stage === 'intent' && e.issues.some(x => x.path === path));
});
test('legacy narrative analysis is not silently accepted as structured intent', () => {
  const narrative = {
    recordType: 'vision-analysis-record', method: 'Synthetic narrative rejection fixture',
    source: { file: 'fixtures/button.svg', width: 240, height: 80 },
    observation: { componentType: 'Button', visibleText: 'TEST BUTTON', textBakedIntoImage: true },
    unknownFromImage: ['business action', 'enabled state'],
  };
  assert.throws(() => validateButtonIntent(narrative), (error: unknown) => error instanceof HarnessError && error.stage === 'intent');
});
const invalidPolicies: [string, (p: any) => void, string][] = [
  ['missing enabled', p => delete p.enabled, '$policy.enabled'],
  ['enabled string', p => p.enabled = 'true', '$policy.enabled'],
  ['zero scale', p => p.scale = 0, '$policy.scale'],
  ['negative scale', p => p.scale = -1, '$policy.scale'],
  ['nonfinite canvas', p => p.canvas.width = Infinity, '$policy.canvas.width'],
  ['unsupported placement', p => p.placement = 'auto', '$policy.placement'],
];
for (const [name, mutate, path] of invalidPolicies) test(`policy rejects ${name}`, () => {
  const p = policy(); mutate(p);
  assert.throws(() => validatePreviewPolicy(p), (e: unknown) => e instanceof HarnessError && e.stage === 'compile' && e.issues.some(x => x.path === path));
});
test('decoded dimensions must be positive safe integers and have no extra fields', () => {
  for (const data of [{ width: 0, height: 20 }, { width: NaN, height: 20 }, { width: 20.5, height: 20 }, { width: 20, height: 20, fake: true }]) {
    assert.throws(() => compileButton(intent(), data, policy()), (e: unknown) => e instanceof HarnessError && e.stage === 'compile');
  }
});
test('scale overflow fails instead of producing an invalid or substituted size', () => {
  const p = policy(); p.scale = Number.MAX_VALUE;
  assert.throws(() => compileButton(intent(), image, p), (e: unknown) => e instanceof HarnessError && e.issues.some(i => i.code === 'SIZE_OVERFLOW'));
});
