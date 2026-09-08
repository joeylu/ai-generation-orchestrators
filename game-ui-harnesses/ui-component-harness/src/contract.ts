/** Engine-neutral v0.1 subset. No optional capability is silently discarded. */
import { ResourceReferenceError, validateResourceReference } from './resource-reference.ts';
export interface ImageContract {
  id: string;
  type: 'Image';
  props: { source: string };
}
export interface ButtonContract {
  schemaVersion: '0.1';
  id: string;
  type: 'Button';
  layout: { x: number; y: number; width: number; height: number };
  props: { enabled: boolean };
  slots: { visual: ImageContract };
}
export interface Issue { path: string; code: string; message: string }
export class HarnessError extends Error {
  readonly stage: 'intent' | 'compile' | 'contract' | 'resource' | 'runtime';
  readonly issues: Issue[];
  constructor(stage: HarnessError['stage'], issues: Issue[]) {
    super(issues.map(i => `${i.path}: ${i.message} [${i.code}]`).join('\n'));
    this.name = 'HarnessError'; this.stage = stage; this.issues = issues;
  }
}
export function validateButton(input: unknown): ButtonContract {
  const issues: Issue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const object = (v: unknown, path: string, keys: string[]): Record<string, unknown> | null => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      add(path, 'OBJECT_REQUIRED', '必须是对象'); return null;
    }
    const o = v as Record<string, unknown>;
    for (const k of keys) if (!Object.hasOwn(o, k)) add(`${path}.${k}`, 'REQUIRED', '缺少必需字段');
    for (const k of Object.keys(o)) if (!keys.includes(k)) add(`${path}.${k}`, 'UNSUPPORTED_FIELD', '本轮不支持此字段或能力');
    return o;
  };
  const literal = (v: unknown, expected: string, path: string) => {
    if (v !== expected) add(path, 'UNSUPPORTED_VALUE', `仅支持 ${expected}`);
  };
  const ids = new Set<string>();
  const id = (v: unknown, path: string) => {
    if (typeof v !== 'string' || !v.trim() || v !== v.trim()) add(path, 'INVALID_ID', 'ID 必须为非空且无首尾空白的字符串');
    else if (ids.has(v)) add(path, 'DUPLICATE_ID', `ID 重复：${v}`);
    else ids.add(v);
  };
  const root = object(input, '$', ['schemaVersion', 'id', 'type', 'layout', 'props', 'slots']);
  if (root) {
    literal(root.schemaVersion, '0.1', '$.schemaVersion'); literal(root.type, 'Button', '$.type'); id(root.id, '$.id');
    const layout = object(root.layout, '$.layout', ['x', 'y', 'width', 'height']);
    if (layout) for (const k of ['x', 'y', 'width', 'height']) {
      const v = layout[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) add(`$.layout.${k}`, 'FINITE_NUMBER_REQUIRED', '必须为有限数值');
      else if ((k === 'width' || k === 'height') && v <= 0) add(`$.layout.${k}`, 'POSITIVE_SIZE_REQUIRED', '尺寸必须大于 0');
    }
    const props = object(root.props, '$.props', ['enabled']);
    if (props && typeof props.enabled !== 'boolean') add('$.props.enabled', 'BOOLEAN_REQUIRED', '必须为 boolean');
    const slots = object(root.slots, '$.slots', ['visual']);
    const visual = slots && object(slots.visual, '$.slots.visual', ['id', 'type', 'props']);
    if (visual) {
      id(visual.id, '$.slots.visual.id'); literal(visual.type, 'Image', '$.slots.visual.type');
      const p = object(visual.props, '$.slots.visual.props', ['source']);
      if (p) {
        const s = p.source;
        if (typeof s !== 'string') add('$.slots.visual.props.source', 'SOURCE_REQUIRED', '资源引用必须为非空且无首尾空白的字符串');
        else {
          try { validateResourceReference(s, '$.slots.visual.props.source', 'contract'); }
          catch (error) {
            if (error instanceof ResourceReferenceError) add(error.path, error.code, error.message.replace(/^contract: [^:]+: /, ''));
            else add('$.slots.visual.props.source', 'UNSAFE_SOURCE', '资源引用无效');
          }
        }
      }
    }
  }
  if (issues.length) throw new HarnessError('contract', issues);
  return structuredClone(input) as ButtonContract;
}
