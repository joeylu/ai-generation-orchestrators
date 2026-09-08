import { HarnessError } from './contract.ts';
import { validateDocument, walkNodes, type UiNodeType } from './tree-contract.ts';
import type { MotionClock } from './motion.ts';

/** The public document and profile revision for the component motion system. */
export const MOTION_SYSTEM_VERSION = '0.1' as const;

export type MotionStyle = 'playful' | 'premium' | 'corporate';
export type MotionAction =
  | 'enter' | 'exit' | 'emphasis' | 'press' | 'hover' | 'focus'
  | 'change' | 'progress' | 'scroll' | 'open' | 'close' | 'stagger';

/**
 * Explicit authored tokens used by adapters when they turn a component action
 * into presentation values. They are not observations about an arbitrary UI.
 */
export interface MotionStyleProfile {
  pressScale: number;
  pressMs: number;
  releasePeak: number;
  releasePeakMs: number;
  releaseSettleMs: number;
  hoverScale: number;
  hoverMs: number;
  enterMs: number;
  exitMs: number;
  enterOffsetY: number;
  enterScale: number;
  changeMs: number;
  focusMs: number;
  staggerMs: number;
  scrollMs: number;
  easing: 'linear' | 'ease-out' | 'ease-in-out' | 'spring';
}

export interface MotionSystemBinding {
  targetId: string;
  componentType: UiNodeType;
  actions: MotionAction[];
}

export interface MotionSystemDocument {
  motionSystemVersion: typeof MOTION_SYSTEM_VERSION;
  id: string;
  style: MotionStyle;
  bindings: MotionSystemBinding[];
}

export interface MotionComponentDefinition {
  componentType: UiNodeType;
  actions: MotionAction[];
}

export interface MotionSystemCatalog {
  motionSystemVersion: typeof MOTION_SYSTEM_VERSION;
  profiles: Record<MotionStyle, MotionStyleProfile>;
  components: MotionComponentDefinition[];
}

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_BINDINGS = 1_000;
const identifier = /^[A-Za-z][A-Za-z0-9._-]*$/;
const motionStyles = new Set<MotionStyle>(['playful', 'premium', 'corporate']);
const motionActions = new Set<MotionAction>([
  'enter', 'exit', 'emphasis', 'press', 'hover', 'focus',
  'change', 'progress', 'scroll', 'open', 'close', 'stagger',
]);

const componentDefinitions: readonly MotionComponentDefinition[] = [
  { componentType: 'Image', actions: ['enter', 'exit', 'emphasis'] },
  { componentType: 'Text', actions: ['enter', 'exit', 'emphasis'] },
  { componentType: 'Container', actions: ['enter', 'exit', 'stagger'] },
  { componentType: 'Button', actions: ['enter', 'exit', 'emphasis', 'press', 'hover'] },
  { componentType: 'Switch', actions: ['enter', 'exit', 'change', 'hover'] },
  { componentType: 'CheckBox', actions: ['enter', 'exit', 'change', 'hover'] },
  { componentType: 'RadioGroup', actions: ['enter', 'exit', 'change', 'hover'] },
  { componentType: 'Input', actions: ['enter', 'exit', 'focus'] },
  { componentType: 'Select', actions: ['enter', 'exit', 'open', 'close', 'change', 'hover'] },
  { componentType: 'ProgressBar', actions: ['enter', 'exit', 'progress'] },
  { componentType: 'Slider', actions: ['enter', 'exit', 'progress', 'hover'] },
  { componentType: 'ScrollView', actions: ['enter', 'exit', 'scroll'] },
  { componentType: 'List', actions: ['enter', 'exit', 'change', 'stagger'] },
  { componentType: 'Panel', actions: ['enter', 'exit', 'stagger'] },
  { componentType: 'Dialog', actions: ['enter', 'exit', 'open', 'close'] },
  { componentType: 'Tabs', actions: ['enter', 'exit', 'change'] },
];

const actionsByType = new Map<UiNodeType, readonly MotionAction[]>(
  componentDefinitions.map(definition => [definition.componentType, definition.actions]),
);

/*
 * Button press/release values are the supplied source facts. Every remaining
 * token below is an authored Harness design choice, not a source-derived fact.
 */
const profiles: Readonly<Record<MotionStyle, Readonly<MotionStyleProfile>>> = Object.freeze({
  playful: Object.freeze({
    pressScale: 0.95, pressMs: 60, releasePeak: 1.05, releasePeakMs: 80, releaseSettleMs: 120,
    hoverScale: 1.03, hoverMs: 120, enterMs: 260, exitMs: 160, enterOffsetY: 16, enterScale: 0.92,
    changeMs: 180, focusMs: 140, staggerMs: 55, scrollMs: 180, easing: 'spring',
  }),
  premium: Object.freeze({
    pressScale: 0.98, pressMs: 80, releasePeak: 1, releasePeakMs: 150, releaseSettleMs: 0,
    hoverScale: 1.01, hoverMs: 180, enterMs: 280, exitMs: 200, enterOffsetY: 12, enterScale: 0.98,
    changeMs: 200, focusMs: 140, staggerMs: 70, scrollMs: 220, easing: 'ease-in-out',
  }),
  corporate: Object.freeze({
    pressScale: 0.97, pressMs: 60, releasePeak: 1, releasePeakMs: 100, releaseSettleMs: 0,
    hoverScale: 1.01, hoverMs: 100, enterMs: 180, exitMs: 140, enterOffsetY: 8, enterScale: 0.99,
    changeMs: 140, focusMs: 100, staggerMs: 45, scrollMs: 160, easing: 'ease-out',
  }),
});

function issue(path: string, code: string, message: string): never {
  throw new HarnessError('contract', [{ path, code, message }]);
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) issue(path, 'OBJECT_REQUIRED', 'must be an object');
  const data = value as Record<string, unknown>;
  for (const key of keys) if (!Object.hasOwn(data, key)) issue(`${path}.${key}`, 'REQUIRED', 'required field is missing');
  for (const key of Object.keys(data)) if (!keys.includes(key)) issue(`${path}.${key}`, 'UNSUPPORTED_FIELD', 'unknown fields are not accepted');
  return data;
}

function validIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH || !identifier.test(value)) {
    issue(path, 'INVALID_ID', 'must be a bounded UI-compatible identifier');
  }
  return value;
}

function validStyle(value: unknown, path: string): MotionStyle {
  if (typeof value !== 'string' || !motionStyles.has(value as MotionStyle)) issue(path, 'UNSUPPORTED_STYLE', 'must be playful, premium, or corporate');
  return value as MotionStyle;
}

function definitionsFor(type: UiNodeType): readonly MotionAction[] {
  const actions = actionsByType.get(type);
  if (!actions) issue('$motionSystem.bindings', 'UNSUPPORTED_TYPE', 'unsupported component type');
  return actions;
}

function cloneProfile(profile: Readonly<MotionStyleProfile>): MotionStyleProfile {
  return { ...profile };
}

/** Returns a fresh profile, so callers cannot change the stable registry. */
export function getMotionStyle(style: MotionStyle): MotionStyleProfile {
  if (!motionStyles.has(style)) issue('$motionStyle', 'UNSUPPORTED_STYLE', 'must be playful, premium, or corporate');
  return cloneProfile(profiles[style]);
}

/** Returns a fresh, complete registry for document tooling and workbenches. */
export function motionSystemCatalog(): MotionSystemCatalog {
  return {
    motionSystemVersion: MOTION_SYSTEM_VERSION,
    profiles: {
      playful: getMotionStyle('playful'),
      premium: getMotionStyle('premium'),
      corporate: getMotionStyle('corporate'),
    },
    components: componentDefinitions.map(definition => ({
      componentType: definition.componentType,
      actions: [...definition.actions],
    })),
  };
}

/**
 * Validates a standalone motion-system document against an existing strict UI
 * tree. The input tree and document are never changed.
 */
export function validateMotionSystem(input: unknown, uiInput: unknown): MotionSystemDocument {
  const ui = validateDocument(uiInput);
  const nodesById = new Map(walkNodes(ui).map(node => [node.id, node]));
  const data = object(input, '$motionSystem', ['motionSystemVersion', 'id', 'style', 'bindings']);
  if (data.motionSystemVersion !== MOTION_SYSTEM_VERSION) issue('$motionSystem.motionSystemVersion', 'UNSUPPORTED_VERSION', 'only motion system 0.1 is supported');
  validIdentifier(data.id, '$motionSystem.id');
  validStyle(data.style, '$motionSystem.style');
  if (!Array.isArray(data.bindings)) issue('$motionSystem.bindings', 'ARRAY_REQUIRED', 'must be an array');
  if (data.bindings.length < 1 || data.bindings.length > MAX_BINDINGS || data.bindings.length > nodesById.size) {
    issue('$motionSystem.bindings', 'BINDING_LIMIT', 'must select between one and the number of UI nodes');
  }

  const boundIds = new Set<string>();
  for (const [index, rawBinding] of data.bindings.entries()) {
    const path = `$motionSystem.bindings[${index}]`;
    const binding = object(rawBinding, path, ['targetId', 'componentType', 'actions']);
    const targetId = validIdentifier(binding.targetId, `${path}.targetId`);
    const node = nodesById.get(targetId);
    if (!node) issue(`${path}.targetId`, 'UNKNOWN_TARGET', 'must reference an existing UI node');
    if (boundIds.has(targetId)) issue(`${path}.targetId`, 'DUPLICATE_TARGET', 'each UI node may have one motion binding');
    boundIds.add(targetId);
    if (typeof binding.componentType !== 'string' || !actionsByType.has(binding.componentType as UiNodeType)) {
      issue(`${path}.componentType`, 'UNSUPPORTED_TYPE', 'must be a supported UI component type');
    }
    if (binding.componentType !== node.type) issue(`${path}.componentType`, 'TYPE_MISMATCH', 'must match the referenced UI node type');
    if (!Array.isArray(binding.actions)) issue(`${path}.actions`, 'ARRAY_REQUIRED', 'must be an array');
    const supported = definitionsFor(node.type);
    if (binding.actions.length < 1 || binding.actions.length > supported.length) {
      issue(`${path}.actions`, 'ACTION_LIMIT', 'must include between one and the supported action count');
    }
    const selected = new Set<MotionAction>();
    for (const [actionIndex, action] of binding.actions.entries()) {
      const actionPath = `${path}.actions[${actionIndex}]`;
      if (typeof action !== 'string' || !motionActions.has(action as MotionAction)) issue(actionPath, 'UNSUPPORTED_ACTION', 'must be a supported motion action');
      if (!supported.includes(action as MotionAction)) issue(actionPath, 'UNSUPPORTED_ACTION', 'the action is not available for this component type');
      if (selected.has(action as MotionAction)) issue(actionPath, 'DUPLICATE_ACTION', 'actions may be selected once per binding');
      selected.add(action as MotionAction);
    }
  }
  return structuredClone(input) as MotionSystemDocument;
}

/** Compiles explicit target IDs into all actions available to each target type. */
export function compileMotionSystem(input: unknown, uiInput: unknown): MotionSystemDocument {
  const ui = validateDocument(uiInput);
  const nodesById = new Map(walkNodes(ui).map(node => [node.id, node]));
  const data = object(input, '$motionSystemInput', ['id', 'style', 'targets']);
  const id = validIdentifier(data.id, '$motionSystemInput.id');
  const style = validStyle(data.style, '$motionSystemInput.style');
  if (!Array.isArray(data.targets)) issue('$motionSystemInput.targets', 'ARRAY_REQUIRED', 'must be an array');
  if (data.targets.length < 1 || data.targets.length > MAX_BINDINGS || data.targets.length > nodesById.size) {
    issue('$motionSystemInput.targets', 'TARGET_LIMIT', 'must select between one and the number of UI nodes');
  }
  const targetIds = new Set<string>();
  const bindings: MotionSystemBinding[] = data.targets.map((target, index) => {
    const path = `$motionSystemInput.targets[${index}]`;
    const targetId = validIdentifier(target, path);
    const node = nodesById.get(targetId);
    if (!node) issue(path, 'UNKNOWN_TARGET', 'must reference an existing UI node');
    if (targetIds.has(targetId)) issue(path, 'DUPLICATE_TARGET', 'each target may be selected once');
    targetIds.add(targetId);
    return { targetId, componentType: node.type, actions: [...definitionsFor(node.type)] };
  });
  return validateMotionSystem({ motionSystemVersion: MOTION_SYSTEM_VERSION, id, style, bindings }, ui);
}

/** Bounded errors for scheduler arguments and invalid clock values. */
export class MotionAnimatorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MotionAnimatorError';
    this.code = code;
  }
}

type AnimationValues = Record<string, number>;
export interface MotionAnimationStep {
  to: Record<string, number>;
  duration: number;
  easing: MotionStyleProfile['easing'];
}

interface PreparedStep {
  from: AnimationValues;
  to: AnimationValues;
  start: number;
  end: number;
  easing: MotionStyleProfile['easing'];
}

interface Channel {
  key: string;
  startedAt: number;
  totalDuration: number;
  initial: AnimationValues;
  steps: PreparedStep[];
  apply: (values: AnimationValues) => void;
  complete?: () => void;
}

interface ScheduledFrame {
  active: boolean;
  id?: number;
}

/** Marks an error thrown by an error callback so a frame does not report it twice. */
class ErrorReportFailure {
  readonly error: unknown;
  constructor(error: unknown) { this.error = error; }
}

const MAX_ANIMATION_STEPS = 64;
const MAX_ANIMATION_DURATION_MS = 120_000;
const MAX_ANIMATION_VALUE = 1_000_000;
const animationKey = /^[A-Za-z][A-Za-z0-9._-]*$/;
const animationValueKey = /^[A-Za-z][A-Za-z0-9_-]*$/;

function animatorError(code: string, message: string): never {
  throw new MotionAnimatorError(code, message);
}

function safeAnimationKey(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH || !animationKey.test(value)) {
    animatorError('INVALID_KEY', 'animation key must be a bounded identifier');
  }
  return value;
}

function cloneValues(value: unknown, path: string): AnimationValues {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) animatorError('VALUES_OBJECT_REQUIRED', `${path} must be an object`);
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length === 0 || keys.length > 32) animatorError('VALUES_LIMIT', `${path} must contain 1–32 numeric values`);
  const result: AnimationValues = {};
  for (const key of keys) {
    if (!animationValueKey.test(key)) animatorError('INVALID_VALUE_KEY', `${path}.${key} is not a safe animation value key`);
    const numeric = source[key];
    if (typeof numeric !== 'number' || !Number.isFinite(numeric) || Math.abs(numeric) > MAX_ANIMATION_VALUE) {
      animatorError('INVALID_VALUE', `${path}.${key} must be a bounded finite number`);
    }
    result[key] = numeric;
  }
  return result;
}

function sameKeys(left: AnimationValues, right: AnimationValues, path: string): void {
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length || leftKeys.some(key => !Object.hasOwn(right, key))) {
    animatorError('VALUE_KEYS_MISMATCH', `${path} must contain exactly the animated value keys`);
  }
}

function prepareSteps(from: AnimationValues, input: MotionAnimationStep[]): { steps: PreparedStep[]; totalDuration: number } {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ANIMATION_STEPS) {
    animatorError('STEP_LIMIT', `steps must contain 1–${MAX_ANIMATION_STEPS} entries`);
  }
  let prior = from;
  let totalDuration = 0;
  const steps = input.map((rawStep, index) => {
    if (typeof rawStep !== 'object' || rawStep === null || Array.isArray(rawStep)) animatorError('STEP_OBJECT_REQUIRED', `steps[${index}] must be an object`);
    const step = rawStep as unknown as Record<string, unknown>;
    const expected = ['to', 'duration', 'easing'];
    for (const field of expected) if (!Object.hasOwn(step, field)) animatorError('STEP_REQUIRED', `steps[${index}].${field} is required`);
    for (const field of Object.keys(step)) if (!expected.includes(field)) animatorError('STEP_UNSUPPORTED_FIELD', `steps[${index}].${field} is not supported`);
    const to = cloneValues(step.to, `steps[${index}].to`);
    sameKeys(prior, to, `steps[${index}].to`);
    if (typeof step.duration !== 'number' || !Number.isFinite(step.duration) || step.duration <= 0 || step.duration > MAX_ANIMATION_DURATION_MS) {
      animatorError('INVALID_DURATION', `steps[${index}].duration must be finite and positive`);
    }
    if (typeof step.easing !== 'string' || !['linear', 'ease-out', 'ease-in-out', 'spring'].includes(step.easing)) {
      animatorError('INVALID_EASING', `steps[${index}].easing is not supported`);
    }
    const start = totalDuration;
    totalDuration += step.duration;
    if (!Number.isFinite(totalDuration) || totalDuration > MAX_ANIMATION_DURATION_MS) {
      animatorError('DURATION_LIMIT', `summed animation duration must not exceed ${MAX_ANIMATION_DURATION_MS}ms`);
    }
    const prepared: PreparedStep = { from: cloneValues(prior, `steps[${index}].from`), to, start, end: totalDuration, easing: step.easing as MotionStyleProfile['easing'] };
    prior = to;
    return prepared;
  });
  return { steps, totalDuration };
}

/**
 * Fixed constants make the optional spring reproducible across every adapter.
 * The normalized damped response begins at 0 and is forced to exactly 1 at its
 * endpoint, while preserving a small authored overshoot before it settles.
 */
const SPRING_DAMPING = 7.5;
const SPRING_ANGULAR_FREQUENCY = 11;
const springEndpoint = 1 - Math.exp(-SPRING_DAMPING)
  * (Math.cos(SPRING_ANGULAR_FREQUENCY) + (SPRING_DAMPING / SPRING_ANGULAR_FREQUENCY) * Math.sin(SPRING_ANGULAR_FREQUENCY));

function ease(progress: number, easing: MotionStyleProfile['easing']): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  if (easing === 'linear') return progress;
  if (easing === 'ease-out') return 1 - (1 - progress) ** 3;
  if (easing === 'ease-in-out') return progress * progress * (3 - 2 * progress);
  const damped = 1 - Math.exp(-SPRING_DAMPING * progress)
    * (Math.cos(SPRING_ANGULAR_FREQUENCY * progress)
      + (SPRING_DAMPING / SPRING_ANGULAR_FREQUENCY) * Math.sin(SPRING_ANGULAR_FREQUENCY * progress));
  return damped / springEndpoint;
}

function valuesAt(channel: Channel, elapsed: number): AnimationValues {
  if (elapsed <= 0) return { ...channel.initial };
  if (elapsed >= channel.totalDuration) return { ...channel.steps[channel.steps.length - 1].to };
  for (const step of channel.steps) {
    if (elapsed <= step.end) {
      const progress = (elapsed - step.start) / (step.end - step.start);
      const eased = ease(progress, step.easing);
      const values: AnimationValues = {};
      for (const key of Object.keys(step.from)) values[key] = step.from[key] + (step.to[key] - step.from[key]) * eased;
      return values;
    }
  }
  return { ...channel.steps[channel.steps.length - 1].to };
}

/**
 * A shared, engine-neutral scheduler. It owns no presentation state: callers
 * supply the current values when retargeting and apply each sampled value.
 */
export class MotionAnimator {
  private readonly channels = new Map<string, Channel>();
  private frame: ScheduledFrame | undefined;
  private dead = false;
  private readonly clock: MotionClock;
  private readonly onError: (error: unknown) => void;

  constructor(
    clock: MotionClock,
    onError: (error: unknown) => void = error => { throw error; },
  ) {
    this.clock = clock;
    this.onError = onError;
  }

  animate(
    key: string,
    from: Record<string, number>,
    steps: Array<{ to: Record<string, number>; duration: number; easing: MotionStyleProfile['easing'] }>,
    apply: (values: Record<string, number>) => void,
    complete?: () => void,
  ): void {
    this.assertAlive();
    const safeKey = safeAnimationKey(key);
    const initial = cloneValues(from, 'from');
    const prepared = prepareSteps(initial, steps);
    if (typeof apply !== 'function') animatorError('APPLY_REQUIRED', 'apply must be a function');
    if (complete !== undefined && typeof complete !== 'function') animatorError('COMPLETE_REQUIRED', 'complete must be a function');
    let startedAt: number;
    try { startedAt = this.now(); }
    catch (error) { this.report(error); return; }

    this.removeChannel(safeKey);
    const channel: Channel = { key: safeKey, startedAt, totalDuration: prepared.totalDuration, initial, steps: prepared.steps, apply, complete };
    this.channels.set(safeKey, channel);
    try {
      channel.apply({ ...channel.initial });
    } catch (error) {
      this.handleChannelError(channel, error);
      return;
    }
    if (this.channels.get(safeKey) !== channel || this.dead) return;
    this.schedule();
  }

  cancel(key: string): void {
    this.assertAlive();
    this.removeChannel(safeAnimationKey(key));
  }

  cancelAll(): void {
    if (this.dead) return;
    this.channels.clear();
    this.cancelFrame();
  }

  destroy(): void {
    if (this.dead) return;
    this.cancelAll();
    this.dead = true;
  }

  snapshot(): { running: number; pendingFrame: boolean; destroyed: boolean } {
    return { running: this.channels.size, pendingFrame: this.frame !== undefined, destroyed: this.dead };
  }

  private assertAlive(): void {
    if (this.dead) animatorError('MOTION_ANIMATOR_DESTROYED', 'motion animator has been destroyed');
  }

  private now(): number {
    const value = this.clock.now();
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      animatorError('INVALID_CLOCK_TIME', 'clock.now() must return a finite safe timestamp');
    }
    return value;
  }

  private removeChannel(key: string): void {
    this.channels.delete(key);
    if (this.channels.size === 0) this.cancelFrame();
  }

  private cancelFrame(): void {
    const frame = this.frame;
    if (!frame) return;
    this.frame = undefined;
    frame.active = false;
    if (frame.id !== undefined) {
      try { this.clock.cancel(frame.id); }
      catch (error) { this.report(error); }
    }
  }

  private schedule(): void {
    if (this.dead || this.channels.size === 0 || this.frame) return;
    const frame: ScheduledFrame = { active: true };
    this.frame = frame;
    try {
      const id = this.clock.request(now => this.onFrame(frame, now));
      if (typeof id !== 'number' || !Number.isFinite(id) || !Number.isSafeInteger(id)) {
        animatorError('INVALID_FRAME_ID', 'clock.request() must return a finite integer frame ID');
      }
      if (this.frame === frame && frame.active) frame.id = id;
    } catch (error) {
      if (this.frame === frame) this.frame = undefined;
      frame.active = false;
      this.channels.clear();
      this.report(error);
    }
  }

  private onFrame(frame: ScheduledFrame, timestamp: number): void {
    if (!frame.active || this.frame !== frame || this.dead) return;
    this.frame = undefined;
    frame.active = false;
    try {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(timestamp) > Number.MAX_SAFE_INTEGER) {
        animatorError('INVALID_CLOCK_TIME', 'clock frame must provide a finite safe timestamp');
      }
      for (const channel of [...this.channels.values()]) {
        if (this.channels.get(channel.key) !== channel || this.dead) continue;
        const elapsed = Math.max(0, Math.min(channel.totalDuration, timestamp - channel.startedAt));
        try {
          channel.apply(valuesAt(channel, elapsed));
          if (this.channels.get(channel.key) !== channel || this.dead) continue;
          if (elapsed >= channel.totalDuration) {
            this.channels.delete(channel.key);
            channel.complete?.();
          }
        } catch (error) {
          this.handleChannelError(channel, error);
        }
      }
    } catch (error) {
      if (error instanceof ErrorReportFailure) throw error.error;
      this.channels.clear();
      this.report(error);
    } finally {
      this.schedule();
    }
  }

  private handleChannelError(channel: Channel, error: unknown): void {
    if (this.channels.get(channel.key) === channel) this.channels.delete(channel.key);
    if (this.channels.size === 0) this.cancelFrame();
    try { this.report(error); }
    catch (reportError) { throw new ErrorReportFailure(reportError); }
  }

  private report(error: unknown): void {
    this.onError(error);
  }
}
