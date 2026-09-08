import { HarnessError, validateButton, type ButtonContract, type Issue } from './contract.ts';
import { ResourceReferenceError, validateResourceReference } from './resource-reference.ts';

/** Observations only. Coordinates, dimensions and enabled are not vision guesses. */
export interface ButtonIntent {
  intentVersion: '0.1';
  id: string;
  componentType: 'Button';
  visual: { source: string; mode: 'whole-image' };
  text: { mode: 'baked' | 'none'; value: string };
}
export interface PreviewPolicy {
  canvas: { width: number; height: number };
  placement: 'center';
  scale: number;
  enabled: boolean;
}
/** Comes from actual image decoding in the browser adapter. */
export interface ImageFacts { width: number; height: number }

function validator(stage: 'intent' | 'compile') {
  const issues: Issue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const object = (value: unknown, path: string, keys: string[]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { add(path, 'OBJECT_REQUIRED', '必须为对象'); return null; }
    const data = value as Record<string, unknown>;
    for (const key of keys) if (!Object.hasOwn(data, key)) add(`${path}.${key}`, 'REQUIRED', '缺少必需字段');
    for (const key of Object.keys(data)) if (!keys.includes(key)) add(`${path}.${key}`, 'UNSUPPORTED_FIELD', '未支持的字段，不会静默丢弃');
    return data;
  };
  const text = (value: unknown, path: string) => {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) add(path, 'NONEMPTY_STRING_REQUIRED', '必须为非空且无首尾空白的字符串');
  };
  const positive = (value: unknown, path: string, integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) add(path, 'INVALID_NUMBER', integer ? '必须为正安全整数' : '必须为有限正数');
  };
  const finish = () => { if (issues.length) throw new HarnessError(stage, issues); };
  return { add, object, text, positive, finish };
}

export function validateButtonIntent(input: unknown): ButtonIntent {
  const v = validator('intent');
  const root = v.object(input, '$intent', ['intentVersion', 'id', 'componentType', 'visual', 'text']);
  if (root) {
    if (root.intentVersion !== '0.1') v.add('$intent.intentVersion', 'UNSUPPORTED_VERSION', '仅支持 0.1');
    v.text(root.id, '$intent.id');
    if (root.componentType !== 'Button') v.add('$intent.componentType', root.componentType === 'Unresolved' ? 'UNRESOLVED_INTENT' : 'UNSUPPORTED_TYPE', '仅支持已明确识别的 Button；不能用猜测类型继续编译');
    const visual = v.object(root.visual, '$intent.visual', ['source', 'mode']);
    if (visual) {
      v.text(visual.source, '$intent.visual.source');
      if (typeof visual.source === 'string') {
        try { validateResourceReference(visual.source, '$intent.visual.source', 'intent'); }
        catch (error) {
          if (error instanceof ResourceReferenceError) v.add(error.path, error.code, error.message.replace(/^intent: [^:]+: /, ''));
          else v.add('$intent.visual.source', 'UNSAFE_SOURCE', '资源引用无效');
        }
      }
      if (visual.mode !== 'whole-image') v.add('$intent.visual.mode', 'UNSUPPORTED_VISUAL', '本轮仅支持完整复用原图');
    }
    const text = v.object(root.text, '$intent.text', ['mode', 'value']);
    if (text) {
      if (text.mode === 'baked') v.text(text.value, '$intent.text.value');
      else if (text.mode === 'none') {
        if (text.value !== '') v.add('$intent.text.value', 'TEXT_MODE_CONFLICT', 'none 必须配空字符串');
      } else v.add('$intent.text.mode', 'UNSUPPORTED_TEXT', '仅支持 baked（文字已在图中）或 none（图中没有文字）；不支持独立叠字');
    }
  }
  v.finish(); return structuredClone(input) as ButtonIntent;
}

export function validatePreviewPolicy(input: unknown): PreviewPolicy {
  const v = validator('compile');
  const root = v.object(input, '$policy', ['canvas', 'placement', 'scale', 'enabled']);
  if (root) {
    const canvas = v.object(root.canvas, '$policy.canvas', ['width', 'height']);
    if (canvas) { v.positive(canvas.width, '$policy.canvas.width'); v.positive(canvas.height, '$policy.canvas.height'); }
    if (root.placement !== 'center') v.add('$policy.placement', 'UNSUPPORTED_PLACEMENT', '本轮仅支持 center');
    v.positive(root.scale, '$policy.scale');
    if (typeof root.enabled !== 'boolean') v.add('$policy.enabled', 'BOOLEAN_REQUIRED', '必须明确配置 boolean');
  }
  v.finish(); return structuredClone(input) as PreviewPolicy;
}

/** Pure, deterministic compiler: no fetch, DOM, PixiJS, defaults, clock, or random IDs. */
export function compileButton(input: unknown, imageFacts: unknown, settings: unknown): ButtonContract {
  const intent = validateButtonIntent(input);
  const policy = validatePreviewPolicy(settings);
  const v = validator('compile');
  const facts = v.object(imageFacts, '$image', ['width', 'height']);
  if (facts) { v.positive(facts.width, '$image.width', true); v.positive(facts.height, '$image.height', true); }
  v.finish();
  const image = imageFacts as ImageFacts;
  const width = image.width * policy.scale, height = image.height * policy.scale;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new HarnessError('compile', [{ path: '$policy.scale', code: 'SIZE_OVERFLOW', message: '缩放后的尺寸溢出或下溢，不生成合同' }]);
  return validateButton({
    schemaVersion: '0.1', id: intent.id, type: 'Button',
    layout: { x: (policy.canvas.width - width) / 2, y: (policy.canvas.height - height) / 2, width, height },
    props: { enabled: policy.enabled },
    slots: { visual: { id: `${intent.id}_visual`, type: 'Image', props: { source: intent.visual.source } } },
  });
}
