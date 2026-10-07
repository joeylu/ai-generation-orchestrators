import type { UiDocument, UiNode } from './tree-contract.ts';

export type ButtonEffect =
  | { kind: 'dialog-open'; targetId: string; open: boolean }
  | { kind: 'input-step'; targetId: string; delta: number; min: number; max: number }
  | { kind: 'copy-text' | 'copy-image'; sourceId: string; targetId: string };
export type ButtonInteraction =
  | { version: '1.0'; mode: 'internal'; effects: ButtonEffect[] }
  | { version: '1.0'; mode: 'external'; reason: string };
export interface InteractionState { version: '1.0'; copies: { targetId: string; sourceId: string }[] }
export type InteractionBaselines = Map<string, { text?: string; source?: string; region?: unknown }>;

function fail(code: string): never { throw new Error(`BUTTON_INTERACTION_${code}`); }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('SCHEMA');
}
function nodes(document: UiDocument): Map<string, UiNode> {
  const result = new Map<string, UiNode>();
  const visit = (node: UiNode): void => { result.set(node.id, node); if ('children' in node) node.children.forEach(visit); };
  visit(document.root); return result;
}
export function interactionEffects(document: UiDocument): ButtonEffect[] {
  return [...nodes(document).values()].flatMap(node => node.type === 'Button' && node.props.interaction?.mode === 'internal' ? node.props.interaction.effects : []);
}
export function validateButtonInteractions(document: UiDocument): void {
  const map = nodes(document), sources = new Set<string>(), targets = new Set<string>();
  const copyPairs = new Set<string>(); let declarations = 0;
  const controlled = new Set((document.componentLinkages?.pipelines ?? []).flatMap(p => [p.quantity.incrementId, p.quantity.decrementId, p.purchase.buttonId]));
  const textTargets = new Set((document.valueTextBindings?.bindings ?? []).map(b => b.targetId));
  const ref = (id: unknown, type: string): UiNode => {
    if (typeof id !== 'string' || map.get(id)?.type !== type) fail('REFERENCE_TYPE');
    return map.get(id)!;
  };
  for (const node of map.values()) {
    if (node.type !== 'Button' || !Object.hasOwn(node.props, 'interaction')) continue;
    declarations++;
    const value = node.props.interaction;
    if (value?.mode === 'external') {
      exact(value, ['version', 'mode', 'reason']);
      if (value.version !== '1.0' || typeof value.reason !== 'string' || !value.reason.trim()
        || value.reason.length > 500 || /[\u0000-\u001f]|(?:[A-Za-z]:[\\/]|https?:\/\/)/.test(value.reason)) fail('EXTERNAL_REASON');
      continue;
    }
    exact(value, ['version', 'mode', 'effects']);
    if (value.version !== '1.0' || value.mode !== 'internal') fail('VERSION_MODE');
    if (!Array.isArray(value.effects) || !value.effects.length || value.effects.length > 16) fail('EFFECT_LIMIT');
    if (controlled.has(node.id)) fail('CONTROL_CONFLICT');
    const writers = new Set<string>();
    for (const effect of value.effects as ButtonEffect[]) {
      if (effect?.kind === 'dialog-open') {
        exact(effect, ['kind', 'targetId', 'open']); ref(effect.targetId, 'Dialog');
        if (typeof effect.open !== 'boolean') fail('BOOLEAN');
      } else if (effect?.kind === 'input-step') {
        exact(effect, ['kind', 'targetId', 'delta', 'min', 'max']);
        const input = ref(effect.targetId, 'Input');
        if (input.type !== 'Input' || input.props.inputType !== 'number' || input.props.readOnly) fail('NUMERIC_INPUT_REQUIRED');
        if (![effect.delta, effect.min, effect.max].every(Number.isSafeInteger) || effect.delta === 0 || effect.min >= effect.max) fail('NUMBER');
        if (Math.max(String(effect.min).length, String(effect.max).length) > input.props.maxLength) fail('INPUT_CAPACITY');
        if (value.effects.length !== 1) fail('STEP_MUST_BE_SINGLE_EFFECT');
      } else if (effect?.kind === 'copy-text' || effect?.kind === 'copy-image') {
        exact(effect, ['kind', 'sourceId', 'targetId']);
        const type = effect.kind === 'copy-text' ? 'Text' : 'Image';
        ref(effect.sourceId, type); ref(effect.targetId, type);
        if (effect.sourceId === effect.targetId || textTargets.has(effect.targetId)) fail('COPY_CONFLICT');
        sources.add(effect.sourceId); targets.add(effect.targetId);
        copyPairs.add(`${effect.targetId}:${effect.sourceId}`);
      } else fail('EFFECT_KIND');
      if (writers.has(effect.targetId)) fail('DUPLICATE_TARGET'); writers.add(effect.targetId);
    }
  }
  if ([...sources].some(id => targets.has(id))) fail('COPY_CHAIN');
  if (Object.hasOwn(document, 'interactionState')) {
    if (!declarations) fail('STATE_WITHOUT_CONFIG');
    const state = document.interactionState; exact(state, ['version', 'copies']);
    if (state.version !== '1.0' || !Array.isArray(state.copies) || state.copies.length > targets.size) fail('STATE_SCHEMA');
    const seen = new Set<string>();
    for (const copy of state.copies) {
      exact(copy, ['targetId', 'sourceId']);
      if (!copyPairs.has(`${copy.targetId}:${copy.sourceId}`) || seen.has(copy.targetId)) fail('STATE_REFERENCE');
      seen.add(copy.targetId);
    }
  }
}

/** Numeric bounds are authored UI limits, never inferred inventory/business rules. */
export function nextInputStep(document: UiDocument, effect: Extract<ButtonEffect, { kind: 'input-step' }>): string | null {
  const input = nodes(document).get(effect.targetId);
  if (input?.type !== 'Input' || !input.props.enabled || input.props.readOnly || !/^-?(?:0|[1-9]\d*)$/.test(input.props.value)) return null;
  const value = Number(input.props.value);
  if (!Number.isSafeInteger(value) || value < effect.min || value > effect.max) return null;
  const next = Math.min(effect.max, Math.max(effect.min, value + effect.delta));
  return Number.isSafeInteger(next) && next !== value ? String(next) : null;
}
export function buttonInteractionEnabled(document: UiDocument, node: UiNode): boolean {
  if (node.type !== 'Button' || node.props.interaction?.mode !== 'internal') return true;
  return node.props.interaction.effects.every(effect => effect.kind !== 'input-step' || nextInputStep(document, effect) !== null);
}
function copyValue(document: UiDocument, sourceId: string, targetId: string): void {
  const map = nodes(document), source = map.get(sourceId)!, target = map.get(targetId)!;
  if (source.type === 'Text' && target.type === 'Text') target.props.text = source.props.text;
  else if (source.type === 'Image' && target.type === 'Image') {
    target.props.source = source.props.source;
    if (source.props.region) target.props.region = structuredClone(source.props.region); else delete target.props.region;
  } else fail('COPY_TYPE');
}
export function applyInteractionCopy(document: UiDocument, effect: Extract<ButtonEffect, { sourceId: string }>): void {
  const state = document.interactionState ??= { version: '1.0', copies: [] };
  const prior = state.copies.find(copy => copy.targetId === effect.targetId);
  if (prior) prior.sourceId = effect.sourceId; else state.copies.push({ targetId: effect.targetId, sourceId: effect.sourceId });
  copyValue(document, effect.sourceId, effect.targetId);
}
/** Keep frozen target fields for portable snapshots; only declared source IDs become runtime state. */
export function prepareInteractionCopies(document: UiDocument): InteractionBaselines {
  const map = nodes(document), baselines: InteractionBaselines = new Map();
  for (const effect of interactionEffects(document)) if (effect.kind === 'copy-text' || effect.kind === 'copy-image') {
    const node = map.get(effect.targetId)!;
    if (node.type === 'Text') baselines.set(node.id, { text: node.props.text });
    else if (node.type === 'Image') baselines.set(node.id, { source: node.props.source, ...(node.props.region ? { region: structuredClone(node.props.region) } : {}) });
  }
  for (const copy of document.interactionState?.copies ?? []) copyValue(document, copy.sourceId, copy.targetId);
  return baselines;
}
export function snapshotInteractionDocument(document: UiDocument, baselines: InteractionBaselines): UiDocument {
  const copy = structuredClone(document), map = nodes(copy);
  for (const [id, baseline] of baselines) {
    const node = map.get(id)!;
    if (node.type === 'Text') node.props.text = baseline.text!;
    else if (node.type === 'Image') {
      node.props.source = baseline.source!;
      if (baseline.region) node.props.region = structuredClone(baseline.region) as typeof node.props.region; else delete node.props.region;
    }
  }
  return copy;
}
export function requireButtonInteractionCoverage(document: UiDocument): void {
  for (const node of nodes(document).values()) if (node.type === 'Button' && !node.props.interaction) fail(`DECLARATION_REQUIRED: ${node.id}`);
}
/** Acceptance must cover every declaration, including derived disabled buttons. */
export function requireButtonInteractionReport(document: UiDocument, report: unknown): void {
  const expected = [...nodes(document).values()].filter(node => node.type === 'Button' && node.props.interaction);
  const value = report as { status?: string; scope?: string; external?: string[]; bindings?: { buttonId: string; status: string; input: string; enabled: boolean; activations: number }[] } | undefined;
  if (value?.status !== 'pass' || value.scope !== 'declared-effects-only' || !Array.isArray(value.external) || !Array.isArray(value.bindings)) fail('REPORT_REQUIRED');
  const internal = expected.filter(node => node.type === 'Button' && node.props.interaction?.mode === 'internal').map(node => node.id);
  const external = expected.filter(node => node.type === 'Button' && node.props.interaction?.mode === 'external').map(node => node.id);
  if (JSON.stringify([...external].sort()) !== JSON.stringify([...value.external].sort())
    || JSON.stringify([...internal].sort()) !== JSON.stringify(value.bindings.map(binding => binding.buttonId).sort())) fail('REPORT_COVERAGE');
  for (const binding of value.bindings) if (binding.status !== 'pass' || binding.input !== 'actual-mouse'
    || typeof binding.enabled !== 'boolean' || binding.activations !== (binding.enabled ? 1 : 0)) fail('REPORT_RESULT');
}
