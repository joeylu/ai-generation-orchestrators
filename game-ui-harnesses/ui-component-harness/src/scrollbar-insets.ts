export interface ScrollbarInsets { version: '1.0'; top: number; bottom: number }
export function scrollbarInsetsError(value: unknown, trackHeight: number, thumbHeight: number): string | undefined {
  if (!Number.isFinite(trackHeight) || !Number.isFinite(thumbHeight) || trackHeight <= 0 || thumbHeight <= 0) return 'valid track and thumb dimensions required';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'object required';
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['version','top','bottom'].includes(k)) || v.version !== '1.0') return 'unsupported fields or version';
  if (typeof v.top !== 'number' || typeof v.bottom !== 'number' || !Number.isFinite(v.top) || !Number.isFinite(v.bottom) || v.top < 0 || v.bottom < 0) return 'finite nonnegative insets required';
  if (trackHeight - v.top - v.bottom < thumbHeight || trackHeight - v.top - v.bottom <= 0) return 'usable track must contain the source thumb';
}
export function insetThumbGeometry(trackY: number, trackHeight: number, thumbHeight: number, viewport: number, content: number, scroll: number, insets: ScrollbarInsets) {
  const usable = trackHeight - insets.top - insets.bottom;
  const height = Math.min(usable, Math.max(thumbHeight, usable * Math.min(1, viewport / content)));
  const travelY = Math.max(0, usable - height), maxScroll = Math.max(0, content - viewport);
  const ratio = maxScroll === 0 ? 0 : Math.max(0, Math.min(1, scroll / maxScroll));
  return { y: trackY + insets.top + travelY * ratio, height, travelY };
}
