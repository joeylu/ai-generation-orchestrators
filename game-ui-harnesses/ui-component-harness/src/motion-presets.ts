import { HarnessError } from './contract.ts';
import { validateDocument, walkNodes } from './tree-contract.ts';
import { validateMotion, type MotionDocument, type MotionProperty, type MotionTrack } from './motion.ts';

type Easing = MotionTrack['easing'];
interface RecipeBase { presetVersion: '0.1'; id: string; targetId: string; trigger: MotionDocument['trigger'] }
/** Explicit design parameters, not observations extracted from artwork. */
export type MotionRecipe = RecipeBase & (
  | { preset: 'fade-in'; parameters: { duration: number; fromAlpha: number; easing: Easing } }
  | { preset: 'fade-out'; parameters: { duration: number; toAlpha: number; easing: Easing } }
  | { preset: 'slide-in'; parameters: { duration: number; fromX: number; fromY: number; fromAlpha: number; easing: Easing } }
  | { preset: 'pulse'; parameters: { attackMs: number; releaseMs: number; scale: number; easing: Easing } }
  | { preset: 'shake'; parameters: { stepMs: number; distance: number; cycles: number; easing: Easing } }
);
function fail(path: string, code: string, message: string): never {
  throw new HarnessError('contract', [{ path, code, message }]);
}
function object(input: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(path, 'OBJECT_REQUIRED', 'Expected an object');
  const data = input as Record<string, unknown>;
  for (const key of keys) if (!Object.hasOwn(data, key)) fail(`${path}.${key}`, 'REQUIRED', 'Explicit parameter required');
  for (const key of Object.keys(data)) if (!keys.includes(key)) fail(`${path}.${key}`, 'UNSUPPORTED_FIELD', 'Unknown recipe field');
  return data;
}
function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(`$recipe.parameters.${name}`, 'INVALID_NUMBER', `Expected a finite value in [${min}, ${max}]`);
  return value as number;
}
/** Expands a named recipe into ordinary validated tracks. No engine or clock dependency. */
export function compileMotionPreset(input: unknown, uiInput: unknown): MotionDocument {
  const ui = validateDocument(uiInput);
  const data = object(input, ['presetVersion', 'id', 'targetId', 'trigger', 'preset', 'parameters'], '$recipe');
  if (data.presetVersion !== '0.1') fail('$recipe.presetVersion', 'UNSUPPORTED_VERSION', 'Only preset 0.1 is supported');
  const node = walkNodes(ui).find(item => item.id === data.targetId);
  if (!node) fail('$recipe.targetId', 'UNKNOWN_TARGET', 'Expected an existing v0.2 node ID');
  const keys = {
    'fade-in': ['duration', 'fromAlpha', 'easing'], 'fade-out': ['duration', 'toAlpha', 'easing'],
    'slide-in': ['duration', 'fromX', 'fromY', 'fromAlpha', 'easing'],
    pulse: ['attackMs', 'releaseMs', 'scale', 'easing'], shake: ['stepMs', 'distance', 'cycles', 'easing'],
  };
  if (typeof data.preset !== 'string' || !Object.hasOwn(keys, data.preset)) fail('$recipe.preset', 'UNSUPPORTED_PRESET', 'Unknown motion preset');
  const preset = data.preset as keyof typeof keys;
  const p = object(data.parameters, keys[preset], '$recipe.parameters');
  if (!['linear', 'ease-out', 'ease-in-out'].includes(p.easing as string)) fail('$recipe.parameters.easing', 'UNSUPPORTED_EASING', 'Use an implemented easing');
  const tracks: MotionTrack[] = [];
  const track = (property: MotionProperty, start: number, duration: number, from: number, to: number) => {
    tracks.push({ targetId: node.id, property, start, duration, from, to, easing: p.easing as Easing });
  };
  const milliseconds = (name: string) => finite(p[name], name, 1, 120000);
  let duration: number;
  if (preset === 'pulse') {
    const attack = milliseconds('attackMs'), release = milliseconds('releaseMs');
    const scale = finite(p.scale, 'scale', 0.001, 100); duration = attack + release;
    // Layout-center compensation for the 0.1 top-left-origin transform semantics.
    // Equal easing on scale and translation preserves the center at every sample.
    for (const [property, base, peak] of [
      ['scaleX', 1, scale], ['scaleY', 1, scale],
      ['x', 0, node.layout.width * (1 - scale) / 2], ['y', 0, node.layout.height * (1 - scale) / 2],
    ] as Array<[MotionProperty, number, number]>) {
      track(property, 0, attack, base, peak); track(property, attack, release, peak, base);
    }
  } else if (preset === 'shake') {
    const step = milliseconds('stepMs'), distance = finite(p.distance, 'distance', 0, 1000000);
    const cycles = finite(p.cycles, 'cycles', 1, 8);
    if (!Number.isInteger(cycles)) fail('$recipe.parameters.cycles', 'INVALID_NUMBER', 'Expected 1 to 8 integer cycles');
    duration = (cycles * 2 + 1) * step; let previous = 0;
    for (let index = 0; index <= cycles * 2; index++) {
      const next = index === cycles * 2 ? 0 : (index % 2 ? -1 : 1) * distance * (1 - index / (cycles * 2));
      track('x', index * step, step, previous, next); previous = next;
    }
  } else {
    duration = milliseconds('duration');
    if (preset === 'fade-out') track('alpha', 0, duration, 1, finite(p.toAlpha, 'toAlpha', 0, 1));
    else {
      track('alpha', 0, duration, finite(p.fromAlpha, 'fromAlpha', 0, 1), 1);
      if (preset === 'slide-in') {
        track('x', 0, duration, finite(p.fromX, 'fromX', -1000000, 1000000), 0);
        track('y', 0, duration, finite(p.fromY, 'fromY', -1000000, 1000000), 0);
      }
    }
  }
  return validateMotion({ motionVersion: '0.1', id: data.id, scope: 'component', duration, trigger: data.trigger, tracks }, ui);
}
