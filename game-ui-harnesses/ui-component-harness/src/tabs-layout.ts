/** Optional native-header layout policy. Absence preserves all legacy behavior. */
export interface TabsLayoutPolicy { version: '1.0'; orientation: 'horizontal' | 'vertical' }
export function tabsLayoutError(value: unknown, items: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'layoutPolicy must be an object';
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'orientation,version' || v.version !== '1.0' || !['horizontal', 'vertical'].includes(v.orientation as string)) return 'unsupported layoutPolicy version, fields or orientation';
  if (!Array.isArray(items) || !items.length) return 'layoutPolicy requires explicit native items';
  return undefined;
}
