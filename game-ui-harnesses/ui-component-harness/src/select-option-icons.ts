import type { Issue } from './contract.ts';
import type { Layout } from './tree-contract.ts';

/** Coordinates are relative to one equal-height row of popupContentLayout. */
export interface SelectOptionIcons<Reference extends 'image' | 'layerId' = 'image'> {
  version: '1.0';
  coordinateSpace: 'popup-row-local';
  items: Array<{
    optionId: string;
    icon: ({ layout: Layout } & Record<Reference, string>) | null;
    labelLayout: Layout;
  }>;
}

/** Shared producer-binding/runtime geometry validation. No IO or inferred links. */
export function validateSelectOptionIcons(
  value: unknown, optionIds: readonly string[], content: unknown,
  reference: 'image' | 'layerId', path: string,
  checkReference: (value: unknown, path: string) => void,
): Issue[] {
  const issues: Issue[] = [];
  const fail = (p: string, code: string, message: string) => issues.push({ path: p, code, message });
  const object = (v: unknown, p: string, keys: string[]): Record<string, unknown> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { fail(p, 'OBJECT_REQUIRED', 'must be an object'); return; }
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${p}.${k}`, 'UNKNOWN_FIELD', 'unsupported field');
    for (const k of keys) if (!Object.hasOwn(o, k)) fail(`${p}.${k}`, 'REQUIRED_FIELD', 'field is required');
    return o;
  };
  const data = object(value, path, ['version', 'coordinateSpace', 'items']);
  if (!data) return issues;
  if (data.version !== '1.0') fail(`${path}.version`, 'UNSUPPORTED_VERSION', 'only 1.0 is supported');
  if (data.coordinateSpace !== 'popup-row-local') fail(`${path}.coordinateSpace`, 'UNSUPPORTED_COORDINATE_SPACE', 'must be popup-row-local');
  const safe = content as Layout | undefined;
  if (!safe || ![safe.width, safe.height].every(n => Number.isFinite(n) && n > 0)) fail(path, 'POPUP_CONTENT_REQUIRED', 'optionIcons requires explicit valid popupContentLayout');
  const rowWidth = safe?.width ?? 0, rowHeight = (safe?.height ?? 0) / optionIds.length;
  const rect = (v: unknown, p: string): Layout | undefined => {
    const r = object(v, p, ['x', 'y', 'width', 'height']);
    if (!r) return;
    if (![r.x, r.y, r.width, r.height].every(n => typeof n === 'number' && Number.isFinite(n))
      || (r.x as number) < 0 || (r.y as number) < 0 || (r.width as number) <= 0 || (r.height as number) <= 0) {
      fail(p, 'INVALID_LAYOUT', 'finite nonnegative coordinates and positive dimensions required'); return;
    }
    const result = r as unknown as Layout;
    if (result.x + result.width > rowWidth + 1e-6 || result.y + result.height > rowHeight + 1e-6) fail(p, 'OPTION_LAYOUT_OUT_OF_BOUNDS', 'must fit inside its popup content row');
    return result;
  };
  if (!Array.isArray(data.items)) { fail(`${path}.items`, 'ARRAY_REQUIRED', 'must be an array'); return issues; }
  if (data.items.length !== optionIds.length) fail(`${path}.items`, 'OPTION_COVERAGE_REQUIRED', 'declare every option exactly once; icon:null explicitly means no icon');
  const seen = new Set<string>();
  data.items.forEach((raw, i) => {
    const p = `${path}.items[${i}]`, item = object(raw, p, ['optionId', 'icon', 'labelLayout']);
    if (!item) return;
    if (typeof item.optionId !== 'string' || !optionIds.includes(item.optionId)) fail(`${p}.optionId`, 'UNKNOWN_OPTION', 'must reference an option of this Select');
    else if (seen.has(item.optionId)) fail(`${p}.optionId`, 'DUPLICATE_OPTION', 'each option must appear once');
    else seen.add(item.optionId);
    const label = rect(item.labelLayout, `${p}.labelLayout`);
    if (item.icon === null) return;
    const icon = object(item.icon, `${p}.icon`, [reference, 'layout']);
    if (!icon) return;
    checkReference(icon[reference], `${p}.icon.${reference}`);
    const box = rect(icon.layout, `${p}.icon.layout`);
    if (label && box && label.x < box.x + box.width && label.x + label.width > box.x && label.y < box.y + box.height && label.y + label.height > box.y) fail(p, 'OPTION_ICON_TEXT_OVERLAP', 'icon and label reservations must not overlap');
  });
  return issues;
}
