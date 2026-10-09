/** Portable user facts, frozen before planning. Never contains execution settings. */
import { walkNodes, type UiDocument, type UiNode } from './tree-contract.ts';
export interface LayerSemanticControl {
  subject: string;
  target: { type: UiNode['type']; id?: string; label?: string };
  values: Record<string, string | number | boolean | null | string[]>;
}
export interface LayerSemanticInputs { version: '1.0'; controls: LayerSemanticControl[] }
export interface BoundLayerSemanticInputs { sha256: string; value: LayerSemanticInputs }
export const MAX_LAYER_SEMANTIC_INPUT_BYTES = 16 * 1024;
const fields: Record<string, string[]> = {
  Switch: ['checked', 'enabled'], CheckBox: ['checked', 'enabled'],
  RadioGroup: ['selectedLabel', 'optionLabels', 'enabled'], Select: ['selectedLabel', 'optionLabels', 'enabled'],
  List: ['selectedLabel', 'optionLabels', 'enabled'], Tabs: ['selectedLabel', 'optionLabels', 'enabled'],
  Slider: ['value', 'min', 'max', 'step', 'enabled'], ProgressBar: ['value', 'max'],
  Input: ['value', 'placeholder', 'inputType', 'readOnly', 'maxLength', 'enabled'],
  Button: ['label', 'enabled'], Text: ['text'], Panel: ['title'], Dialog: ['title', 'open', 'modal'],
};
function fail(code = 'LAYER_SEMANTIC_INPUTS_INVALID'): never { throw new Error(code); }
function row(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const result = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => ![...required, ...optional].includes(key))) fail();
  return result;
}
function label(value: unknown, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum
    || /[\x00-\x1f\x7f]/.test(value)) fail();
  return value;
}
export function canonicalLayerSemanticInputs(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalLayerSemanticInputs).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + canonicalLayerSemanticInputs(record[key])).join(',') + '}';
}
export function validateLayerSemanticInputs(value: unknown): LayerSemanticInputs {
  const data = row(value, ['version', 'controls']);
  if (data.version !== '1.0' || !Array.isArray(data.controls) || data.controls.length > 64) fail();
  const subjects = new Set<string>(), targets = new Set<string>();
  const controls = data.controls.map(entry => {
    const control = row(entry, ['subject', 'target', 'values']), target = row(control.target, ['type'], ['id', 'label']);
    const subject = label(control.subject);
    if (subjects.has(subject) || typeof target.type !== 'string' || !Object.hasOwn(fields, target.type)) fail();
    subjects.add(subject);
    if (Object.hasOwn(target, 'id')) label(target.id, 100);
    if (Object.hasOwn(target, 'label')) label(target.label);
    const key = canonicalLayerSemanticInputs(target); if (targets.has(key)) fail(); targets.add(key);
    const values = row(control.values, [], fields[target.type as string]);
    if (!Object.keys(values).length || Object.keys(values).some(key => !fields[target.type as string].includes(key))) fail();
    for (const [key, actual] of Object.entries(values)) {
      if (['checked', 'enabled', 'readOnly', 'open', 'modal'].includes(key)) { if (typeof actual !== 'boolean') fail(); }
      else if (key === 'optionLabels') {
        if (!Array.isArray(actual) || !actual.length || actual.length > 100 || new Set(actual.map(value => label(value))).size !== actual.length) fail();
      } else if (key === 'selectedLabel') { if (actual !== null) label(actual); }
      else if (['min', 'max', 'step', 'maxLength'].includes(key) || (key === 'value' && target.type !== 'Input')) {
        if (typeof actual !== 'number' || !Number.isFinite(actual)) fail();
        if (key === 'step' && actual <= 0) fail();
        if (key === 'maxLength' && (!Number.isInteger(actual) || actual < 1)) fail();
      } else {
        if (typeof actual !== 'string' || actual.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(actual)) fail();
        if (key === 'inputType' && !['text', 'password', 'email', 'number'].includes(actual)) fail();
      }
    }
    return structuredClone({ subject, target, values }) as unknown as LayerSemanticControl;
  });
  const normalized: LayerSemanticInputs = { version: '1.0', controls };
  if (new TextEncoder().encode(canonicalLayerSemanticInputs(normalized)).length > MAX_LAYER_SEMANTIC_INPUT_BYTES) fail('LAYER_SEMANTIC_INPUTS_LIMIT');
  return normalized;
}
export async function bindLayerSemanticInputs(value: unknown): Promise<BoundLayerSemanticInputs> {
  const normalized = validateLayerSemanticInputs(value);
  const canonical = canonicalLayerSemanticInputs(normalized);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  // Identical facts must also produce identical prompts when a caller reorders
  // JSON keys. Freeze the same canonical representation that owns the digest.
  return { sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
    value: JSON.parse(canonical) as LayerSemanticInputs };
}
export async function validateBoundLayerSemanticInputs(value: unknown): Promise<BoundLayerSemanticInputs> {
  const data = row(value, ['sha256', 'value']), bound = await bindLayerSemanticInputs(data.value);
  if (data.sha256 !== bound.sha256) fail('LAYER_SEMANTIC_INPUTS_DIGEST');
  return bound;
}
export function assertLayerSemanticInputs(bound: BoundLayerSemanticInputs, document: UiDocument): void {
  for (const control of bound.value.controls) {
    const matches = walkNodes(document).filter(node => {
      const props = node.props as unknown as Record<string, unknown>;
      return node.type === control.target.type && (!control.target.id || node.id === control.target.id)
        && (!control.target.label || [props.label, props.title, props.text].includes(control.target.label));
    });
    if (matches.length !== 1) fail('LAYER_PLAN_SEMANTIC_TARGET');
    const node = matches[0], props = node.props as unknown as Record<string, unknown>;
    for (const [key, expected] of Object.entries(control.values)) {
      let actual = props[key];
      if (key === 'optionLabels' || key === 'selectedLabel') {
        const options = (props.options ?? props.items ?? props.tabs) as Array<{ id: string; label: string }>;
        if (!Array.isArray(options)) fail('LAYER_PLAN_SEMANTIC_MISMATCH');
        if (key === 'optionLabels') actual = options.map(option => option.label);
        else {
          if (expected !== null && options.filter(option => option.label === expected).length !== 1) fail('LAYER_PLAN_SEMANTIC_MISMATCH');
          const selected = Object.hasOwn(props, 'selectedId') ? props.selectedId : props.activeId;
          actual = selected === null ? null : options.find(option => option.id === selected)?.label;
        }
      }
      if (canonicalLayerSemanticInputs(actual) !== canonicalLayerSemanticInputs(expected)) fail('LAYER_PLAN_SEMANTIC_MISMATCH');
    }
  }
}
