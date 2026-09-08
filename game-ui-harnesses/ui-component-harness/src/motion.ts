import { HarnessError } from './contract.ts';
import { validateDocument, walkNodes, type UiDocument, type UiNodeType } from './tree-contract.ts';

export type MotionProperty = 'x' | 'y' | 'alpha' | 'scaleX' | 'scaleY' | 'rotation';
export interface MotionTrack {
  targetId: string; property: MotionProperty; start: number; duration: number;
  from: number; to: number; easing: 'linear' | 'ease-out' | 'ease-in-out';
}
export interface MotionDocument {
  motionVersion: '0.1'; id: string; scope: 'component' | 'canvas'; duration: number;
  trigger: { type: 'manual' } | { type: 'event'; targetId: string; event: 'activate' | 'change' };
  tracks: MotionTrack[];
}
/** An explicitly placed reusable timeline. Its own trigger is validated but not inherited. */
export interface MotionClip { motion: MotionDocument; at: number }
/** Input for a canvas timeline assembled from existing local motion documents. */
export interface CanvasMotionComposition {
  motionVersion: '0.1'; id: string; duration: number;
  trigger: MotionDocument['trigger']; clips: MotionClip[];
}
export type MotionValues = Partial<Record<MotionProperty, number>>;
const properties: MotionProperty[] = ['x', 'y', 'alpha', 'scaleX', 'scaleY', 'rotation'];
type MotionEvent = Extract<MotionDocument['trigger'], { type: 'event' }>['event'];
const eventCapabilities: Record<UiNodeType, readonly MotionEvent[]> = {
  Image: [], Text: [], Container: [], Button: ['activate'], Switch: ['change'],
  CheckBox: ['change'], RadioGroup: ['change'], Input: ['change'], Select: ['change'],
  ProgressBar: [], Slider: ['change'], ScrollView: [], List: ['change'], Panel: [],
  Dialog: [], Tabs: ['change'],
};
const componentLimits: Partial<Record<UiNodeType, readonly string[]>> = {
  Image: ['BAKED_PARTS_NOT_ADDRESSABLE'], Text: ['GLYPHS_NOT_ADDRESSABLE'],
  Button: ['PRESS_RELEASE_CANCEL_HOVER_NOT_BOUND'], Switch: ['THUMB_NOT_ADDRESSABLE'],
  CheckBox: ['TICK_NOT_ADDRESSABLE'], RadioGroup: ['OPTION_IDS_ARE_NOT_NODES'],
  Input: ['FOCUS_BLUR_NOT_BOUND', 'EDITOR_PARTS_NOT_ADDRESSABLE'],
  Select: ['POPUP_TRANSFORMS_NOT_INHERITED', 'OPTION_IDS_ARE_NOT_NODES'],
  ProgressBar: ['VALUE_TWEEN_NOT_IMPLEMENTED', 'CHANGE_NOT_BOUND'],
  Slider: ['THUMB_NOT_ADDRESSABLE', 'TRANSFORMED_DRAG_NOT_VERIFIED'],
  ScrollView: ['SCROLL_TRIGGER_NOT_BOUND'], List: ['GENERATED_ROWS_NOT_ADDRESSABLE'],
  Panel: ['GENERATED_TITLE_NOT_ADDRESSABLE'],
  Dialog: ['OPEN_CLOSE_NOT_BOUND', 'MODAL_BACKDROP_TRANSFORMS_WITH_NODE'],
  Tabs: ['TAB_IDS_ARE_NOT_NODES', 'INACTIVE_CONTENT_NOT_VISIBLE'],
};
/** Contract capability, not a claim that a hidden/disabled node currently emits events. */
export function motionCapabilities(uiInput: unknown) {
  const ui = validateDocument(uiInput);
  return {
    uiVersion: ui.schemaVersion, motionVersion: '0.1' as const,
    semantics: 'ui-motion-2d/0.1' as const, implementedAdapters: ['pixijs'],
    manualTrigger: true, targetScope: 'whole-node' as const,
    limitations: ['V02_UI_ONLY', 'EXCLUSIVE_PLAYER_OWNERSHIP', 'ALPHA_DOES_NOT_DISABLE_INPUT', 'REVALIDATE_AFTER_TOPOLOGY_CHANGE'],
    types: (Object.keys(eventCapabilities) as UiNodeType[]).map(type => ({
      type, targetScope: 'whole-node' as const, properties: [...properties],
      events: [...eventCapabilities[type]], partTargets: 'declared-node-ids-only' as const,
      limitations: [...(componentLimits[type] ?? [])],
    })),
    nodes: walkNodes(ui).map(node => ({
      id: node.id, type: node.type, properties: [...properties], events: [...eventCapabilities[node.type]],
      limitations: [...(componentLimits[node.type] ?? [])],
    })),
  };
}
const fail = (path: string, code: string, message: string): never => { throw new HarnessError('contract', [{ path, code, message }]); };
function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'OBJECT_REQUIRED', '必须为对象');
  const data = value as Record<string, unknown>;
  for (const key of keys) if (!Object.hasOwn(data, key)) fail(`${path}.${key}`, 'REQUIRED', '缺少必需字段');
  for (const key of Object.keys(data)) if (!keys.includes(key)) fail(`${path}.${key}`, 'UNSUPPORTED_FIELD', '不支持该动效字段');
  return data;
}
function number(value: unknown, path: string, min = -1e6, max = 1e6): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, 'INVALID_NUMBER', `必须是 ${min} 到 ${max} 之间的有限数`);
  return value as number;
}
export function validateMotion(input: unknown, uiInput: unknown): MotionDocument {
  const ui = validateDocument(uiInput);
  const ids = new Set(walkNodes(ui).map(node => node.id));
  const data = object(input, ['motionVersion', 'id', 'scope', 'duration', 'trigger', 'tracks'], '$motion');
  if (data.motionVersion !== '0.1') fail('$motion.motionVersion', 'UNSUPPORTED_VERSION', '仅支持动效 0.1');
  if (typeof data.id !== 'string' || !data.id.trim() || data.id.trim() !== data.id || data.id.length > 128) fail('$motion.id', 'INVALID_ID', '需要有效动效 ID');
  if (data.scope !== 'component' && data.scope !== 'canvas') fail('$motion.scope', 'UNSUPPORTED_VALUE', 'scope 必须为 component 或 canvas');
  const duration = number(data.duration, '$motion.duration', 1, 120000);
  const triggerType = (data.trigger as Record<string, unknown> | null)?.type;
  const trigger = object(data.trigger, triggerType === 'manual' ? ['type'] : ['type', 'targetId', 'event'], '$motion.trigger');
  if (trigger.type !== 'manual' && trigger.type !== 'event') fail('$motion.trigger.type', 'UNSUPPORTED_TRIGGER', '只支持手动或组件事件触发');
  if (trigger.type === 'event') {
    if (typeof trigger.targetId !== 'string' || !ids.has(trigger.targetId)) fail('$motion.trigger.targetId', 'UNKNOWN_TARGET', '触发节点不存在');
    const node = walkNodes(ui).find(item => item.id === trigger.targetId)!;
    if (!eventCapabilities[node.type].includes(trigger.event as MotionEvent)) fail('$motion.trigger.event', 'UNSUPPORTED_TRIGGER', '该节点不支持指定事件');
  }
  if (!Array.isArray(data.tracks) || data.tracks.length < 1 || data.tracks.length > 512) fail('$motion.tracks', 'TRACK_LIMIT', '需要 1–512 条轨道');
  const intervals = new Map<string, { start: number; end: number }[]>();
  const targets = new Set<string>();
  for (const [index, value] of (data.tracks as unknown[]).entries()) {
    const path = `$motion.tracks[${index}]`;
    const track = object(value, ['targetId', 'property', 'start', 'duration', 'from', 'to', 'easing'], path);
    if (typeof track.targetId !== 'string' || !ids.has(track.targetId)) fail(`${path}.targetId`, 'UNKNOWN_TARGET', '目标节点不存在');
    if (!properties.includes(track.property as MotionProperty)) fail(`${path}.property`, 'UNSUPPORTED_PROPERTY', '不支持该动效属性');
    if (!['linear', 'ease-out', 'ease-in-out'].includes(track.easing as string)) fail(`${path}.easing`, 'UNSUPPORTED_EASING', '不支持该缓动');
    const start = number(track.start, `${path}.start`, 0, duration);
    const length = number(track.duration, `${path}.duration`, 1, duration);
    if (start + length > duration) fail(`${path}.duration`, 'TIMELINE_OVERFLOW', '轨道超出时间线');
    const scale = track.property === 'scaleX' || track.property === 'scaleY';
    for (const field of ['from', 'to']) number(track[field], `${path}.${field}`, track.property === 'alpha' ? 0 : scale ? 0.001 : -1e6, track.property === 'alpha' ? 1 : scale ? 100 : 1e6);
    const key = JSON.stringify([track.targetId, track.property]);
    const prior = intervals.get(key) ?? [];
    if (prior.some(item => start < item.end && start + length > item.start)) fail(path, 'OVERLAPPING_TRACKS', '同一目标属性的时间区间不能重叠');
    prior.push({ start, end: start + length }); intervals.set(key, prior); targets.add(track.targetId as string);
  }
  if (data.scope === 'component' && targets.size !== 1) fail('$motion.scope', 'COMPONENT_SCOPE', '组件级动效只能作用于一个节点；多节点编排使用 canvas');
  return structuredClone(input) as MotionDocument;
}

function remapClipValidationError(error: unknown, path: string): never {
  if (error instanceof HarnessError) {
    const issues = error.issues.map(issue => ({
      ...issue,
      path: issue.path === '$motion' ? path : issue.path.startsWith('$motion.') ? `${path}${issue.path.slice('$motion'.length)}` : path,
    }));
    throw new HarnessError('contract', issues);
  }
  throw error;
}

function remapCompiledMotionError(error: unknown, origins: readonly { path: string; track: number }[]): never {
  if (error instanceof HarnessError) {
    const issues = error.issues.map(issue => {
      const match = /^\$motion\.tracks\[(\d+)\](.*)$/.exec(issue.path);
      if (!match) return issue;
      const origin = origins[Number(match[1])];
      return origin ? { ...issue, path: `${origin.path}.motion.tracks[${origin.track}]${match[2]}` } : issue;
    });
    throw new HarnessError('contract', issues);
  }
  throw error;
}

/**
 * Validate explicit local clips and flatten them into one canvas motion.
 * Clip placement, duration, and the resulting trigger are all caller-owned;
 * the function never supplies timing, target, or trigger defaults.
 */
export function composeMotions(input: unknown, uiInput: unknown): MotionDocument {
  const ui = validateDocument(uiInput);
  const data = object(input, ['motionVersion', 'id', 'duration', 'trigger', 'clips'], '$canvasMotion');
  if (data.motionVersion !== '0.1') fail('$canvasMotion.motionVersion', 'UNSUPPORTED_VERSION', '仅支持动效 0.1');
  if (typeof data.id !== 'string' || !data.id.trim() || data.id.trim() !== data.id || data.id.length > 128) fail('$canvasMotion.id', 'INVALID_ID', '需要有效动效 ID');
  const duration = number(data.duration, '$canvasMotion.duration', 1, 120000);
  const clips: unknown[] = Array.isArray(data.clips)
    ? data.clips : fail('$canvasMotion.clips', 'CLIP_LIMIT', '需要 1–512 个显式片段');
  if (clips.length < 1 || clips.length > 512) fail('$canvasMotion.clips', 'CLIP_LIMIT', '需要 1–512 个显式片段');

  const tracks: MotionTrack[] = [];
  const origins: Array<{ path: string; track: number }> = [];
  for (const [index, value] of clips.entries()) {
    const path = `$canvasMotion.clips[${index}]`;
    const clip = object(value, ['motion', 'at'], path);
    const at = number(clip.at, `${path}.at`, 0, duration);
    let local: MotionDocument;
    try { local = validateMotion(clip.motion, ui); }
    catch (error) { remapClipValidationError(error, `${path}.motion`); }
    if (at + local.duration > duration) fail(`${path}.at`, 'TIMELINE_OVERFLOW', '片段超出画布时间线');
    local.tracks.forEach((track, trackIndex) => {
      tracks.push({ ...track, start: track.start + at }); origins.push({ path, track: trackIndex });
    });
  }

  const composed = {
    motionVersion: '0.1' as const, id: data.id, scope: 'canvas' as const, duration, trigger: data.trigger, tracks,
  };
  try { return validateMotion(composed, ui); }
  catch (error) { remapCompiledMotionError(error, origins); }
}

/** Alias for callers that describe composition as a compile step. */
export const compileCanvasMotion = composeMotions;

export function sampleMotion(motion: MotionDocument, time: number): { id: string; values: MotionValues }[] {
  number(time, '$time', 0, motion.duration);
  const values = new Map<string, MotionValues>();
  const tracks = motion.tracks.map((track, order) => ({ track, order })).sort((a, b) => a.track.start - b.track.start || a.order - b.order);
  for (const { track } of tracks) {
    const state = values.get(track.targetId) ?? {};
    if (time < track.start && Object.hasOwn(state, track.property)) continue;
    const p = Math.max(0, Math.min(1, (time - track.start) / track.duration));
    const eased = track.easing === 'ease-out' ? 1 - (1 - p) ** 3 : track.easing === 'ease-in-out' ? p * p * (3 - 2 * p) : p;
    state[track.property] = track.from + (track.to - track.from) * eased; values.set(track.targetId, state);
  }
  return [...values].map(([id, state]) => ({ id, values: state }));
}
export interface MotionTarget { applyMotion(id: string, values: MotionValues): void; resetMotion(): void }
export interface MotionClock { now(): number; request(callback: (now: number) => void): number; cancel(id: number): void }
/** Clock injection permits deterministic tests; playback never changes the UI contract. */
export class MotionPlayer {
  readonly motion: MotionDocument;
  private frame: number | undefined;
  private dead = false;
  private position = 0;
  private running = false;
  private target: MotionTarget;
  private clock: MotionClock;
  private onUpdate: (time: number, running: boolean) => void;
  private onError: (error: unknown) => void;
  constructor(input: unknown, ui: UiDocument, target: MotionTarget, clock: MotionClock, onUpdate: (time: number, running: boolean) => void = () => {}, onError: (error: unknown) => void = error => { throw error; }) {
    this.target = target; this.clock = clock; this.onUpdate = onUpdate; this.onError = onError;
    this.motion = validateMotion(input, ui);
  }
  private alive() { if (this.dead) throw new Error('MOTION_DESTROYED'); }
  private cancel() { if (this.frame !== undefined) this.clock.cancel(this.frame); this.frame = undefined; this.running = false; }
  seek(time: number) {
    this.alive(); number(time, '$time', 0, this.motion.duration); this.cancel(); this.position = time;
    this.target.resetMotion();
    try {
      for (const sample of sampleMotion(this.motion, time)) this.target.applyMotion(sample.id, sample.values);
      this.onUpdate(time, false);
    }
    catch (error) { this.target.resetMotion(); throw error; }
  }
  play() {
    this.alive(); this.cancel(); if (this.position >= this.motion.duration) this.position = 0;
    const started = this.clock.now() - this.position; this.running = true;
    const tick = (now: number) => {
      if (this.dead || !this.running) return;
      const time = Math.min(this.motion.duration, Math.max(0, now - started));
      try {
        this.target.resetMotion();
        for (const sample of sampleMotion(this.motion, time)) this.target.applyMotion(sample.id, sample.values);
        this.position = time;
        if (time >= this.motion.duration) { this.frame = undefined; this.running = false; }
        this.onUpdate(time, this.running);
        if (this.running) this.frame = this.clock.request(tick);
      } catch (error) { this.cancel(); this.target.resetMotion(); this.onError(error); }
    };
    tick(this.clock.now());
  }
  replay() { this.seek(0); this.play(); }
  stop() { this.alive(); this.cancel(); this.position = 0; this.target.resetMotion(); this.onUpdate(0, false); }
  destroy() { if (this.dead) return; this.cancel(); this.dead = true; this.target.resetMotion(); }
  snapshot() { return { time: this.position, running: this.running, destroyed: this.dead }; }
}
