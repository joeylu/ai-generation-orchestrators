import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import {
  MotionPlayer, compileCanvasMotion, composeMotions, sampleMotion, validateMotion, type MotionClock, type MotionDocument,
  type MotionTarget, type MotionValues,
} from '../src/motion.ts';
import type { ControlStyle, UiDocument } from '../src/tree-contract.ts';

const style: ControlStyle = {
  backgroundColor: '#FFFFFF', borderColor: '#1D3557', borderWidth: 1, cornerRadius: 4,
  textColor: '#10243E', fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', opacity: 1,
};

function ui(): UiDocument {
  return {
    schemaVersion: '0.2', id: 'motion-ui', canvas: { width: 320, height: 180 },
    root: {
      id: 'root', type: 'Container', layout: { x: 0, y: 0, width: 320, height: 180 }, props: { style }, children: [
        { id: 'button', type: 'Button', layout: { x: 40, y: 30, width: 120, height: 44 }, props: { label: 'Play', enabled: true, style }, children: [] },
        { id: 'switch', type: 'Switch', layout: { x: 40, y: 90, width: 140, height: 44 }, props: { label: 'Music', checked: true, enabled: true, style } },
      ],
    },
  };
}

function motion(overrides: Partial<MotionDocument> = {}): MotionDocument {
  return {
    motionVersion: '0.1', id: 'button-enter', scope: 'component', duration: 100,
    trigger: { type: 'manual' },
    tracks: [{ targetId: 'button', property: 'x', start: 0, duration: 100, from: -20, to: 0, easing: 'linear' }],
    ...overrides,
  };
}

function expectMotionIssue(run: () => unknown, code: string, path?: string): void {
  assert.throws(run, (error: unknown) => error instanceof HarnessError && error.stage === 'contract'
    && error.issues.some(issue => issue.code === code && (path === undefined || issue.path === path)));
}

class FakeTarget implements MotionTarget {
  readonly applied: Array<{ id: string; values: MotionValues }> = [];
  readonly current = new Map<string, MotionValues>();
  resets = 0;
  throwOnApply = false;
  applyMotion(id: string, values: MotionValues): void {
    if (this.throwOnApply) throw new Error('APPLY_FAILED');
    const snapshot = structuredClone(values);
    this.applied.push({ id, values: snapshot }); this.current.set(id, snapshot);
  }
  resetMotion(): void { this.resets += 1; this.current.clear(); }
}

class FakeClock implements MotionClock {
  time = 0;
  private nextId = 1;
  private readonly callbacks = new Map<number, (now: number) => void>();
  readonly cancelled: number[] = [];
  now(): number { return this.time; }
  request(callback: (now: number) => void): number { const id = this.nextId; this.nextId += 1; this.callbacks.set(id, callback); return id; }
  cancel(id: number): void { this.cancelled.push(id); this.callbacks.delete(id); }
  advance(time: number): void {
    this.time = time;
    const next = this.callbacks.entries().next().value as [number, (now: number) => void] | undefined;
    assert.ok(next, 'a frame must be scheduled before advancing the fake clock');
    this.callbacks.delete(next[0]); next[1](time);
  }
  get pending(): number { return this.callbacks.size; }
}

test('motion validation rejects unsupported versions, targets, values, timeline overlap, triggers, and scope leakage', () => {
  const cases: Array<[string, (value: any) => void, string, string?]> = [
    ['version', value => value.motionVersion = '0.2', 'UNSUPPORTED_VERSION', '$motion.motionVersion'],
    ['unknown target', value => value.tracks[0].targetId = 'missing', 'UNKNOWN_TARGET', '$motion.tracks[0].targetId'],
    ['unknown property', value => value.tracks[0].property = 'depth', 'UNSUPPORTED_PROPERTY', '$motion.tracks[0].property'],
    ['alpha range', value => { value.tracks[0].property = 'alpha'; value.tracks[0].from = 0; value.tracks[0].to = 1.01; }, 'INVALID_NUMBER', '$motion.tracks[0].to'],
    ['timeline overflow', value => { value.tracks[0].start = 80; value.tracks[0].duration = 30; }, 'TIMELINE_OVERFLOW', '$motion.tracks[0].duration'],
    ['overlap', value => { value.scope = 'canvas'; value.tracks.push({ targetId: 'button', property: 'x', start: 50, duration: 40, from: -10, to: 0, easing: 'linear' }); }, 'OVERLAPPING_TRACKS', '$motion.tracks[1]'],
    ['invalid event capability', value => value.trigger = { type: 'event', targetId: 'button', event: 'change' }, 'UNSUPPORTED_TRIGGER', '$motion.trigger.event'],
    ['component scope has two targets', value => value.tracks.push({ targetId: 'switch', property: 'alpha', start: 0, duration: 100, from: 0, to: 1, easing: 'linear' }), 'COMPONENT_SCOPE', '$motion.scope'],
  ];
  for (const [, mutate, code, path] of cases) {
    const source = motion(); mutate(source);
    expectMotionIssue(() => validateMotion(source, ui()), code, path);
  }
});

test('motion is separate from the UI document and event triggers are capability-checked', () => {
  const document = ui(); const source = motion({
    scope: 'canvas', trigger: { type: 'event', targetId: 'switch', event: 'change' },
    tracks: [{ targetId: 'switch', property: 'alpha', start: 0, duration: 100, from: 0.2, to: 1, easing: 'ease-out' }],
  });
  const before = structuredClone([document, source]);
  assert.deepEqual(validateMotion(source, document), source);
  assert.deepEqual([document, source], before);
  (source as any).layout = { x: 1 };
  expectMotionIssue(() => validateMotion(source, document), 'UNSUPPORTED_FIELD', '$motion.layout');
});

test('explicit local clips compile into one pure canvas motion without inherited timing or triggers', () => {
  const buttonClip = motion({ id: 'button-enter', duration: 40, tracks: [
    { targetId: 'button', property: 'x', start: 0, duration: 40, from: -20, to: 0, easing: 'linear' },
  ] });
  const switchClip = motion({ id: 'switch-fade', duration: 30, tracks: [
    { targetId: 'switch', property: 'alpha', start: 0, duration: 30, from: 0, to: 1, easing: 'ease-out' },
  ] });
  const source = {
    motionVersion: '0.1', id: 'canvas-intro', duration: 100,
    trigger: { type: 'event', targetId: 'switch', event: 'change' },
    clips: [{ motion: buttonClip, at: 10 }, { motion: switchClip, at: 60 }],
  };
  const before = structuredClone(source);
  const composed = composeMotions(source, ui());
  assert.deepEqual(composed, {
    motionVersion: '0.1', id: 'canvas-intro', scope: 'canvas', duration: 100,
    trigger: { type: 'event', targetId: 'switch', event: 'change' },
    tracks: [
      { targetId: 'button', property: 'x', start: 10, duration: 40, from: -20, to: 0, easing: 'linear' },
      { targetId: 'switch', property: 'alpha', start: 60, duration: 30, from: 0, to: 1, easing: 'ease-out' },
    ],
  });
  assert.deepEqual(compileCanvasMotion(source, ui()), composed);
  assert.deepEqual(source, before);
});

test('canvas clip composition rejects missing placement, invalid local targets, overflow, and resultant overlaps', () => {
  const source = () => ({
    motionVersion: '0.1', id: 'canvas-intro', duration: 100, trigger: { type: 'manual' },
    clips: [
      { motion: motion({ duration: 50, tracks: [{ targetId: 'button', property: 'x', start: 0, duration: 50, from: -20, to: 0, easing: 'linear' }] }), at: 0 },
      { motion: motion({ id: 'button-leave', duration: 50, tracks: [{ targetId: 'button', property: 'x', start: 0, duration: 50, from: 0, to: 20, easing: 'linear' }] }), at: 25 },
    ],
  });
  const missing = source() as any; delete missing.clips[0].at;
  expectMotionIssue(() => composeMotions(missing, ui()), 'REQUIRED', '$canvasMotion.clips[0].at');

  const unknown = source() as any; unknown.clips[0].motion.tracks[0].targetId = 'absent';
  expectMotionIssue(() => composeMotions(unknown, ui()), 'UNKNOWN_TARGET', '$canvasMotion.clips[0].motion.tracks[0].targetId');

  const overflow = source(); overflow.clips[0].at = 51;
  expectMotionIssue(() => composeMotions(overflow, ui()), 'TIMELINE_OVERFLOW', '$canvasMotion.clips[0].at');

  expectMotionIssue(() => composeMotions(source(), ui()), 'OVERLAPPING_TRACKS', '$canvasMotion.clips[1].motion.tracks[0]');
});

test('sampling is pure and preserves sequential values while x/y remain runtime offsets', () => {
  const source = motion({
    scope: 'canvas', tracks: [
      { targetId: 'button', property: 'x', start: 50, duration: 50, from: 10, to: 20, easing: 'linear' },
      { targetId: 'switch', property: 'alpha', start: 25, duration: 50, from: 0.2, to: 1, easing: 'ease-in-out' },
      { targetId: 'button', property: 'x', start: 0, duration: 50, from: 0, to: 10, easing: 'linear' },
    ],
  });
  const validated = validateMotion(source, ui()); const before = structuredClone(validated);
  assert.deepEqual(sampleMotion(validated, 0), [{ id: 'button', values: { x: 0 } }, { id: 'switch', values: { alpha: 0.2 } }]);
  assert.deepEqual(sampleMotion(validated, 50), [{ id: 'button', values: { x: 10 } }, { id: 'switch', values: { alpha: 0.6000000000000001 } }]);
  assert.deepEqual(sampleMotion(validated, 75), [{ id: 'button', values: { x: 15 } }, { id: 'switch', values: { alpha: 1 } }]);
  assert.deepEqual(sampleMotion(validated, 100), [{ id: 'button', values: { x: 20 } }, { id: 'switch', values: { alpha: 1 } }]);
  expectMotionIssue(() => sampleMotion(validated, 101), 'INVALID_NUMBER', '$time');
  assert.deepEqual(validated, before);
});

test('injected clock makes play, seek, stop, replay, and destroy deterministic', () => {
  const target = new FakeTarget(); const clock = new FakeClock(); const updates: Array<[number, boolean]> = [];
  const player = new MotionPlayer(motion(), ui(), target, clock, (time, running) => updates.push([time, running]));
  player.play();
  assert.deepEqual(target.applied.at(-1), { id: 'button', values: { x: -20 } });
  assert.deepEqual(player.snapshot(), { time: 0, running: true, destroyed: false }); assert.equal(clock.pending, 1);

  clock.advance(30);
  assert.deepEqual(target.applied.at(-1), { id: 'button', values: { x: -14 } });

  player.seek(60);
  assert.deepEqual(target.applied.at(-1), { id: 'button', values: { x: -8 } });
  assert.deepEqual(player.snapshot(), { time: 60, running: false, destroyed: false });

  player.play(); clock.advance(70);
  assert.deepEqual(target.applied.at(-1), { id: 'button', values: { x: 0 } });
  assert.deepEqual(player.snapshot(), { time: 100, running: false, destroyed: false }); assert.equal(clock.pending, 0);

  player.replay();
  assert.deepEqual(player.snapshot(), { time: 0, running: true, destroyed: false });
  player.stop();
  assert.deepEqual(player.snapshot(), { time: 0, running: false, destroyed: false }); assert.equal(target.current.size, 0);

  player.destroy(); player.destroy();
  assert.deepEqual(player.snapshot(), { time: 0, running: false, destroyed: true });
  assert.throws(() => player.play(), /MOTION_DESTROYED/);
  assert.deepEqual(updates, [[0, true], [30, true], [60, false], [60, true], [100, false], [0, false], [0, true], [0, false]]);
});

test('apply and update callback failures cancel frames and clear temporary transforms', () => {
  const applyTarget = new FakeTarget(); applyTarget.throwOnApply = true;
  const applyClock = new FakeClock(); const applyErrors: unknown[] = [];
  const applyPlayer = new MotionPlayer(motion(), ui(), applyTarget, applyClock, () => {}, error => applyErrors.push(error));
  applyPlayer.play();
  assert.equal(applyClock.pending, 0); assert.equal(applyPlayer.snapshot().running, false); assert.equal(applyTarget.current.size, 0);
  assert.equal(applyErrors.length, 1); assert.ok(applyTarget.resets >= 2);

  const updateTarget = new FakeTarget(); const updateClock = new FakeClock(); const updateErrors: unknown[] = [];
  const updatePlayer = new MotionPlayer(motion(), ui(), updateTarget, updateClock, () => { throw new Error('UPDATE_FAILED'); }, error => updateErrors.push(error));
  updatePlayer.play();
  assert.equal(updateClock.pending, 0); assert.equal(updatePlayer.snapshot().running, false); assert.equal(updateTarget.current.size, 0);
  assert.equal(updateErrors.length, 1); assert.ok(updateTarget.resets >= 2);

  const seekTarget = new FakeTarget(); const seekPlayer = new MotionPlayer(motion(), ui(), seekTarget, new FakeClock(), () => { throw new Error('SEEK_UPDATE_FAILED'); });
  assert.throws(() => seekPlayer.seek(25), /SEEK_UPDATE_FAILED/);
  assert.equal(seekTarget.current.size, 0, 'a failed synchronous update must not leave a temporary transform mounted');

  const reportingTarget = new FakeTarget(); reportingTarget.throwOnApply = true;
  const reportingPlayer = new MotionPlayer(motion(), ui(), reportingTarget, new FakeClock(), () => {}, () => { throw new Error('REPORTING_FAILED'); });
  assert.throws(() => reportingPlayer.play(), /REPORTING_FAILED/);
  assert.equal(reportingPlayer.snapshot().running, false);
  assert.equal(reportingTarget.current.size, 0, 'an error handler failure happens only after temporary transforms are cleared');
});
