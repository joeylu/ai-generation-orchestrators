import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import { fixtureDocument } from '../src/fixtures.ts';
import type { MotionClock } from '../src/motion.ts';
import {
  MotionAnimator, MotionAnimatorError, compileMotionSystem, getMotionStyle, motionSystemCatalog, validateMotionSystem,
  type MotionStyle, type MotionSystemDocument,
} from '../src/motion-system.ts';
import { walkNodes, type UiNodeType } from '../src/tree-contract.ts';

const ui = fixtureDocument('gallery');
const types: UiNodeType[] = [
  'Image', 'Text', 'Container', 'Button', 'Switch', 'CheckBox', 'RadioGroup', 'Input',
  'Select', 'ProgressBar', 'Slider', 'ScrollView', 'List', 'Panel', 'Dialog', 'Tabs',
];
const styles: MotionStyle[] = ['playful', 'premium', 'corporate'];

function nodeId(type: UiNodeType): string {
  const node = walkNodes(ui).find(candidate => candidate.type === type);
  assert.ok(node, `fixture must contain ${type}`);
  return node.id;
}

function source(style: MotionStyle = 'playful', target = nodeId('Button')) {
  return { id: `system-${style}`, style, targets: [target] };
}

function validDocument(): MotionSystemDocument {
  return compileMotionSystem(source(), ui);
}

function expectIssue(run: () => unknown, code: string, path?: string): void {
  assert.throws(run, (error: unknown) => error instanceof HarnessError && error.stage === 'contract'
    && error.issues.some(issue => issue.code === code && (path === undefined || issue.path === path)));
}

for (const style of styles) for (const type of types) test(`${style} ${type} compiles every registered action`, () => {
  const input = source(style, nodeId(type));
  const before = structuredClone([input, ui]);
  const compiled = compileMotionSystem(input, ui);
  assert.deepEqual(validateMotionSystem(compiled, ui), compiled);
  assert.deepEqual([input, ui], before);
  assert.equal(compiled.motionSystemVersion, '0.1');
  assert.equal(compiled.style, style);
  assert.equal(compiled.bindings.length, 1);
  assert.equal(compiled.bindings[0].targetId, input.targets[0]);
  assert.equal(compiled.bindings[0].componentType, type);
  assert.ok(compiled.bindings[0].actions.length > 0);
});

test('style profiles preserve supplied button facts and catalog data is caller-isolated', () => {
  const playful = getMotionStyle('playful');
  assert.deepEqual(
    { pressScale: playful.pressScale, pressMs: playful.pressMs, releasePeak: playful.releasePeak, releasePeakMs: playful.releasePeakMs, releaseSettleMs: playful.releaseSettleMs },
    { pressScale: 0.95, pressMs: 60, releasePeak: 1.05, releasePeakMs: 80, releaseSettleMs: 120 },
  );
  const premium = getMotionStyle('premium');
  assert.deepEqual(
    { pressScale: premium.pressScale, pressMs: premium.pressMs, releasePeak: premium.releasePeak, releasePeakMs: premium.releasePeakMs, releaseSettleMs: premium.releaseSettleMs },
    { pressScale: 0.98, pressMs: 80, releasePeak: 1, releasePeakMs: 150, releaseSettleMs: 0 },
  );
  const corporate = getMotionStyle('corporate');
  assert.deepEqual(
    { pressScale: corporate.pressScale, pressMs: corporate.pressMs, releasePeak: corporate.releasePeak, releasePeakMs: corporate.releasePeakMs, releaseSettleMs: corporate.releaseSettleMs },
    { pressScale: 0.97, pressMs: 60, releasePeak: 1, releasePeakMs: 100, releaseSettleMs: 0 },
  );

  playful.pressScale = 9;
  assert.equal(getMotionStyle('playful').pressScale, 0.95);
  const catalog = motionSystemCatalog();
  assert.equal(catalog.motionSystemVersion, '0.1');
  assert.deepEqual(catalog.components.map(definition => definition.componentType), types);
  catalog.profiles.playful.hoverScale = 99;
  catalog.components[0].actions.length = 0;
  assert.equal(motionSystemCatalog().profiles.playful.hoverScale, 1.03);
  assert.equal(motionSystemCatalog().components[0].actions.length, 3);
  expectIssue(() => getMotionStyle('invented' as MotionStyle), 'UNSUPPORTED_STYLE', '$motionStyle');
});

test('motion-system documents reject extra fields, bad IDs, counts, types, actions, and duplicates', () => {
  const invalid: Array<[string, (document: any) => void, string, string?]> = [
    ['extra top level', document => document.extra = true, 'UNSUPPORTED_FIELD', '$motionSystem.extra'],
    ['version', document => document.motionSystemVersion = '2', 'UNSUPPORTED_VERSION', '$motionSystem.motionSystemVersion'],
    ['invalid id', document => document.id = ' bad', 'INVALID_ID', '$motionSystem.id'],
    ['style', document => document.style = 'loud', 'UNSUPPORTED_STYLE', '$motionSystem.style'],
    ['empty binding list', document => document.bindings = [], 'BINDING_LIMIT', '$motionSystem.bindings'],
    ['duplicate target', document => document.bindings.push(structuredClone(document.bindings[0])), 'DUPLICATE_TARGET', '$motionSystem.bindings[1].targetId'],
    ['missing target', document => document.bindings[0].targetId = 'absent', 'UNKNOWN_TARGET', '$motionSystem.bindings[0].targetId'],
    ['mismatched type', document => document.bindings[0].componentType = 'Text', 'TYPE_MISMATCH', '$motionSystem.bindings[0].componentType'],
    ['empty action list', document => document.bindings[0].actions = [], 'ACTION_LIMIT', '$motionSystem.bindings[0].actions'],
    ['invalid action', document => document.bindings[0].actions[0] = 'zoom', 'UNSUPPORTED_ACTION', '$motionSystem.bindings[0].actions[0]'],
    ['unavailable action', document => document.bindings[0].actions = ['focus'], 'UNSUPPORTED_ACTION', '$motionSystem.bindings[0].actions[0]'],
    ['duplicate action', document => document.bindings[0].actions = ['enter', 'enter'], 'DUPLICATE_ACTION', '$motionSystem.bindings[0].actions[1]'],
  ];
  for (const [, mutate, code, path] of invalid) {
    const document = validDocument();
    mutate(document);
    expectIssue(() => validateMotionSystem(document, ui), code, path);
  }

  const invalidInput: Array<[unknown, string, string?]> = [
    [{ ...source(), targets: [] }, 'TARGET_LIMIT', '$motionSystemInput.targets'],
    [{ ...source(), targets: ['missing'] }, 'UNKNOWN_TARGET', '$motionSystemInput.targets[0]'],
    [{ ...source(), targets: [nodeId('Button'), nodeId('Button')] }, 'DUPLICATE_TARGET', '$motionSystemInput.targets[1]'],
    [{ ...source(), extra: true }, 'UNSUPPORTED_FIELD', '$motionSystemInput.extra'],
  ];
  for (const [input, code, path] of invalidInput) expectIssue(() => compileMotionSystem(input, ui), code, path);
});

class FakeClock implements MotionClock {
  time = 0;
  requests = 0;
  readonly cancelled: number[] = [];
  private nextId = 1;
  private readonly callbacks = new Map<number, (now: number) => void>();
  private readonly history = new Map<number, (now: number) => void>();

  now(): number { return this.time; }
  request(callback: (now: number) => void): number {
    const id = this.nextId++;
    this.requests += 1;
    this.callbacks.set(id, callback);
    this.history.set(id, callback);
    return id;
  }
  cancel(id: number): void { this.cancelled.push(id); this.callbacks.delete(id); }
  advance(time: number): void {
    this.time = time;
    const current = [...this.callbacks.entries()];
    this.callbacks.clear();
    for (const [, callback] of current) callback(time);
  }
  stale(id: number, time: number): void {
    const callback = this.history.get(id);
    assert.ok(callback, `known frame ${id}`);
    callback(time);
  }
  get pending(): number { return this.callbacks.size; }
}

test('one shared frame drives concurrent channels and retains exact endpoints', () => {
  const clock = new FakeClock();
  const animator = new MotionAnimator(clock);
  const first: number[] = [], second: number[] = [];
  animator.animate('first', { x: 0 }, [{ to: { x: 10 }, duration: 100, easing: 'linear' }], values => first.push(values.x));
  animator.animate('second', { x: 10 }, [{ to: { x: 0 }, duration: 100, easing: 'spring' }], values => second.push(values.x));
  assert.equal(clock.requests, 1, 'all channels share one pending frame');
  assert.deepEqual(animator.snapshot(), { running: 2, pendingFrame: true, destroyed: false });
  clock.advance(50);
  assert.equal(first.at(-1), 5);
  assert.notEqual(second.at(-1), 10);
  assert.equal(clock.pending, 1);
  clock.advance(100);
  assert.equal(first.at(-1), 10);
  assert.equal(second.at(-1), 0);
  assert.deepEqual(animator.snapshot(), { running: 0, pendingFrame: false, destroyed: false });
});

test('retarget starts from caller presentation and stale cancelled frames cannot apply', () => {
  const clock = new FakeClock();
  const animator = new MotionAnimator(clock);
  const values: number[] = [];
  animator.animate('motion.button.scale', { value: 0 }, [{ to: { value: 10 }, duration: 100, easing: 'linear' }], current => values.push(current.value));
  clock.advance(50);
  assert.equal(values.at(-1), 5);
  const oldPendingFrame = 2;
  animator.animate('motion.button.scale', { value: 5 }, [{ to: { value: 20 }, duration: 100, easing: 'linear' }], current => values.push(current.value));
  assert.equal(values.at(-1), 5, 'retarget applies its supplied presentation immediately');
  assert.ok(clock.cancelled.includes(oldPendingFrame));
  const countBeforeStale = values.length;
  clock.stale(oldPendingFrame, 100);
  assert.equal(values.length, countBeforeStale, 'a callback from a cancelled generation is ignored');
  clock.advance(100);
  assert.equal(values.at(-1), 12.5);
  clock.advance(150);
  assert.equal(values.at(-1), 20);
});

test('cancellation and destruction tear down frames without resetting other channels', () => {
  const clock = new FakeClock();
  const animator = new MotionAnimator(clock);
  animator.animate('one', { x: 0 }, [{ to: { x: 1 }, duration: 100, easing: 'linear' }], () => {});
  animator.animate('two', { x: 0 }, [{ to: { x: 1 }, duration: 100, easing: 'linear' }], () => {});
  animator.cancel('one');
  assert.deepEqual(animator.snapshot(), { running: 1, pendingFrame: true, destroyed: false });
  animator.cancelAll();
  assert.deepEqual(animator.snapshot(), { running: 0, pendingFrame: false, destroyed: false });
  assert.equal(clock.pending, 0);
  animator.destroy();
  animator.destroy();
  assert.deepEqual(animator.snapshot(), { running: 0, pendingFrame: false, destroyed: true });
  assert.throws(() => animator.animate('three', { x: 0 }, [{ to: { x: 1 }, duration: 1, easing: 'linear' }], () => {}), /MOTION_ANIMATOR_DESTROYED/);
  assert.throws(() => animator.cancel('__proto__'), /MOTION_ANIMATOR_DESTROYED/);
});

test('scheduler rejects unsafe arguments without changing a running channel', () => {
  const clock = new FakeClock();
  const animator = new MotionAnimator(clock);
  animator.animate('safe', { x: 0 }, [{ to: { x: 1 }, duration: 10, easing: 'linear' }], () => {});
  const before = animator.snapshot();
  const invalid = [
    () => animator.animate('__proto__', { x: 0 }, [{ to: { x: 1 }, duration: 1, easing: 'linear' }], () => {}),
    () => animator.animate('bad-value', { x: Number.NaN }, [{ to: { x: 1 }, duration: 1, easing: 'linear' }], () => {}),
    () => animator.animate('bad-duration', { x: 0 }, [{ to: { x: 1 }, duration: 0, easing: 'linear' }], () => {}),
    () => animator.animate('bad-keys', { x: 0 }, [{ to: { y: 1 }, duration: 1, easing: 'linear' }], () => {}),
    () => animator.animate('bad-sum', { x: 0 }, [{ to: { x: 1 }, duration: 80_000, easing: 'linear' }, { to: { x: 2 }, duration: 80_000, easing: 'linear' }], () => {}),
  ];
  for (const run of invalid) assert.throws(run, MotionAnimatorError);
  assert.deepEqual(animator.snapshot(), before);
});

test('apply and completion failures clean their channels and report errors', () => {
  const errors: unknown[] = [];
  const clock = new FakeClock();
  const animator = new MotionAnimator(clock, error => errors.push(error));
  animator.animate('initial-error', { x: 0 }, [{ to: { x: 1 }, duration: 10, easing: 'linear' }], () => { throw new Error('INITIAL'); });
  assert.deepEqual(animator.snapshot(), { running: 0, pendingFrame: false, destroyed: false });
  assert.equal(errors.length, 1);

  let failFrame = false;
  animator.animate('frame-error', { x: 0 }, [{ to: { x: 1 }, duration: 10, easing: 'linear' }], () => {
    if (failFrame) throw new Error('FRAME');
  });
  failFrame = true;
  clock.advance(5);
  assert.deepEqual(animator.snapshot(), { running: 0, pendingFrame: false, destroyed: false });

  animator.animate('complete-error', { x: 0 }, [{ to: { x: 1 }, duration: 10, easing: 'linear' }], () => {}, () => { throw new Error('COMPLETE'); });
  clock.advance(15);
  assert.deepEqual(animator.snapshot(), { running: 0, pendingFrame: false, destroyed: false });
  assert.equal(errors.length, 3);
});

test('reentrant apply and completion retain the newest generation without duplicate frames', () => {
  const clock = new FakeClock();
  const animator = new MotionAnimator(clock);
  const values: number[] = [];
  let retargeted = false;
  animator.animate('reentrant', { x: 0 }, [{ to: { x: 1 }, duration: 10, easing: 'linear' }], current => {
    values.push(current.x);
    if (!retargeted) {
      retargeted = true;
      animator.animate('reentrant', { x: current.x }, [{ to: { x: 2 }, duration: 10, easing: 'linear' }], next => values.push(next.x));
    }
  });
  assert.equal(clock.requests, 1);
  clock.advance(10);
  assert.equal(values.at(-1), 2);

  let completed = false;
  animator.animate('first', { x: 0 }, [{ to: { x: 1 }, duration: 10, easing: 'linear' }], () => {}, () => {
    completed = true;
    animator.animate('second', { x: 1 }, [{ to: { x: 2 }, duration: 10, easing: 'linear' }], current => values.push(current.x));
  });
  clock.advance(20);
  assert.equal(completed, true);
  assert.deepEqual(animator.snapshot(), { running: 1, pendingFrame: true, destroyed: false });
  clock.advance(30);
  assert.equal(values.at(-1), 2);
  assert.deepEqual(animator.snapshot(), { running: 0, pendingFrame: false, destroyed: false });
});
