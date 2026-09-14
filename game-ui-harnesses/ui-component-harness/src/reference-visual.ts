import type { ReferenceEvidence } from './reference-evidence.ts';
import { decodeArchive } from './reference-persistence.ts';
import type { TreeInspection } from './tree-runtime.ts';

/** Decode a copy without orientation metadata. The stored original is never rewritten. */
function rawImageBytes(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  if (bytes[0] === 255 && bytes[1] === 216) {
    parts.push(bytes.subarray(0, 2)); let p = 2;
    while (p < bytes.length) {
      if (bytes[p] !== 255) throw new Error('REFERENCE_JPEG_MARKER');
      const marker = bytes[p + 1]; if (marker === 218 || marker === 217) { parts.push(bytes.subarray(p)); break; }
      const length = (bytes[p + 2] << 8) | bytes[p + 3]; if (length < 2 || p + 2 + length > bytes.length) throw new Error('REFERENCE_JPEG_LENGTH');
      if (marker !== 225) parts.push(bytes.subarray(p, p + 2 + length)); p += 2 + length;
    }
  } else if (bytes[0] === 137 && bytes[1] === 80) {
    parts.push(bytes.subarray(0, 8)); const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let p = 8; p < bytes.length;) {
      if (p + 12 > bytes.length) throw new Error('REFERENCE_PNG_LENGTH');
      const size = v.getUint32(p), type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
      if (p + 12 + size > bytes.length) throw new Error('REFERENCE_PNG_LENGTH');
      if (type === 'acTL') throw new Error('REFERENCE_ANIMATION_UNSPECIFIED');
      if (type !== 'eXIf') parts.push(bytes.subarray(p, p + 12 + size)); p += 12 + size;
    }
  } else if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF') {
    parts.push(bytes.slice(0, 12)); const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let p = 12; p < bytes.length;) {
      if (p + 8 > bytes.length) throw new Error('REFERENCE_WEBP_LENGTH');
      const size = v.getUint32(p + 4, true), type = String.fromCharCode(...bytes.subarray(p, p + 4)), end = p + 8 + size + size % 2;
      if (end > bytes.length) throw new Error('REFERENCE_WEBP_LENGTH');
      if (type === 'ANIM' || type === 'ANMF') throw new Error('REFERENCE_ANIMATION_UNSPECIFIED');
      if (type !== 'EXIF') { const chunk = bytes.slice(p, end); if (type === 'VP8X') chunk[8] &= ~8; parts.push(chunk); } p = end;
    }
    new DataView(parts[0].buffer).setUint32(4, parts.reduce((n, b) => n + b.length, 0) - 8, true);
  } else if (String.fromCharCode(...bytes.subarray(0, 3)) === 'GIF') {
    let p = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0), frames = 0;
    const blocks = () => { for (;;) { if (p >= bytes.length) throw new Error('REFERENCE_GIF_LENGTH'); const n = bytes[p++]; if (!n) break; p += n; if (p > bytes.length) throw new Error('REFERENCE_GIF_LENGTH'); } };
    while (p < bytes.length) {
      const marker = bytes[p++]; if (marker === 59) break;
      if (marker === 33) { p++; blocks(); }
      else if (marker === 44) { frames++; if (p + 9 > bytes.length) throw new Error('REFERENCE_GIF_LENGTH'); const packed = bytes[p + 8]; p += 9 + ((packed & 128) ? 3 * (1 << ((packed & 7) + 1)) : 0); p++; blocks(); }
      else throw new Error('REFERENCE_GIF_MARKER');
    }
    if (frames !== 1) throw new Error('REFERENCE_ANIMATION_UNSPECIFIED'); return bytes;
  } else return bytes;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
}
export async function referenceBitmap(evidence: ReferenceEvidence, path: string): Promise<ImageBitmap> {
  const file = evidence.files.find(f => f.path === path); if (!file) throw new Error('REFERENCE_MEMBER_MISSING');
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(rawImageBytes(decodeArchive(file.base64))).buffer]), { imageOrientation: 'none' });
  const entry = [evidence.manifest!.original, ...evidence.manifest!.derivatives].find(e => e.path === path);
  if (!entry || bitmap.width !== entry.width || bitmap.height !== entry.height) { bitmap.close(); throw new Error('REFERENCE_DECODE_SIZE'); }
  return bitmap;
}
export async function mappedReference(evidence: ReferenceEvidence): Promise<HTMLCanvasElement> {
  if (evidence.status !== 'complete') throw new Error('REFERENCE_EVIDENCE_REQUIRED');
  const m = evidence.manifest!.mapping, bitmap = await referenceBitmap(evidence, evidence.manifest!.original.path);
  const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = m.targetSize;
  const ctx = canvas.getContext('2d')!; const [x, y, w, h] = m.crop;
  try {
    ctx.translate(...m.offset as [number, number]); ctx.scale(...m.scale as [number, number]);
    if (m.rotationDegrees === 90) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
    if (m.rotationDegrees === 180) { ctx.translate(w, h); ctx.rotate(Math.PI); }
    if (m.rotationDegrees === 270) { ctx.translate(0, w); ctx.rotate(3 * Math.PI / 2); }
    ctx.translate(m.flipX ? w : 0, m.flipY ? h : 0); ctx.scale(m.flipX ? -1 : 1, m.flipY ? -1 : 1);
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  } finally { bitmap.close(); } return canvas;
}
export const REFERENCE_COMPARISON_POLICY = Object.freeze({ kind: 'ui-reference-rgba-comparison', schemaVersion: '1.1', channelTolerance: 8, maxDifferentPixelRatio: 0.01, region: 'renderer primitive bounding rectangles in actual painter order, including popup/foreground; intersect renderer mask bounds; last painter owns overlaps, including transparent texture margins; exclude only owned pixels', alpha: 'premultiplied RGB and alpha', human_visual_acceptance: false });
export async function compareReference(evidence: ReferenceEvidence, inspection: TreeInspection, runtime: HTMLCanvasElement) {
  const base = { policy: REFERENCE_COMPARISON_POLICY, unknownFields: evidence.unknownFields, human_visual_acceptance: false };
  if (evidence.status !== 'complete') return { ...base, status: 'blocked', reason: 'MISSING_REFERENCE_EVIDENCE', scopes: evidence.scope?.components ?? [] };
  const mismatchedFields: string[] = [];
  for (const row of evidence.state!.components) {
    const actual = inspection.nodes.find(n => n.id === row.componentId);
    for (const [key, field] of Object.entries(row.fields) as [string, any][]) {
      const value = ['focused','selectionStart','selectionEnd','selectionDirection','caretVisible'].includes(key) ? (actual?.inputEditing as any)?.[key] : key === 'popupOpen' ? actual?.popupOpen : key === 'scrollX' ? (actual?.value as any)?.x : key === 'scrollY' ? (actual?.value as any)?.y : actual?.value;
      if (field.status === 'observed' && JSON.stringify(value) !== JSON.stringify(field.value)) mismatchedFields.push(`${row.componentId}.${key}`);
    }
  }
  if (mismatchedFields.length) return { ...base, status: 'blocked', reason: 'RUNTIME_REFERENCE_STATE_MISMATCH', mismatchedFields, scopes: evidence.scope!.components };
  const ref = await mappedReference(evidence), w = ref.width, h = ref.height;
  if (runtime.width !== w || runtime.height !== h) throw new Error('RUNTIME_SCREENSHOT_SIZE');
  const a = ref.getContext('2d')!.getImageData(0, 0, w, h).data, b = runtime.getContext('2d')!.getImageData(0, 0, w, h).data;
  const rows = inspection.nodes, owner = new Int32Array(w * h).fill(-1);
  const scopes = evidence.scope!.components as any[];
  const mapping = evidence.manifest!.mapping, rotated = mapping.rotationDegrees % 180 !== 0;
  const coverage = { x: mapping.offset[0], y: mapping.offset[1], width: mapping.crop[rotated ? 3 : 2] * mapping.scale[0], height: mapping.crop[rotated ? 2 : 3] * mapping.scale[1] };
  const inside = (x: number, y: number, r: any) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
  if (!inspection.paintRegions) return { ...base, status: 'blocked', reason: 'RENDERER_PAINT_REGIONS_REQUIRED', scopes };
  for (const region of inspection.paintRegions) { const r = region.bounds, i = rows.findIndex(n => n.id === region.componentId); if (i < 0) throw new Error('REFERENCE_PAINT_OWNER');
    for (let y = Math.max(0, Math.ceil(r.y)); y < Math.min(h, r.y + r.height); y++) for (let x = Math.max(0, Math.ceil(r.x)); x < Math.min(w, r.x + r.width); x++) owner[y * w + x] = i;
  }
  // Only numeric ProgressBar paint is locally bounded. Unknown scroll/selection/open
  // state can alter descendants, visibility or occlusion outside current paint.
  const unknownComponents: string[] = evidence.state!.components.filter((row: any) => Object.values(row.fields).some((f: any) => f.status === 'unknown')).map((row: any) => row.componentId);
  const globalUnknown = unknownComponents.some(id => rows.find(n => n.id === id)?.type !== 'ProgressBar');
  const uncertainBounds = unknownComponents.flatMap(id => { const node = rows.find(n => n.id === id); return node ? [node.bounds] : []; });
  const results = rows.map(n => ({ componentId: n.id, mode: scopes.find(s => s.componentId === n.id)?.mode, bounds: n.bounds, paintRegions: inspection.paintRegions!.filter(r => r.componentId === n.id).map(r => r.bounds), ...(n.popupBounds ? {popupBounds: n.popupBounds} : {}), visible: n.visible, pixels: 0, differentPixels: 0, uncoveredPixels: 0, unverifiedPixels: 0, status: 'unverified', reason: '' }));
  for (let p = 0; p < owner.length; p++) { const i = owner[p]; if (i < 0 || results[i].mode !== 'compare') continue;
    const row = results[i]; if (globalUnknown || uncertainBounds.some(r => inside(p % w + .5, Math.floor(p / w) + .5, r))) { row.unverifiedPixels++; continue; } if (!inside(p % w + .5, Math.floor(p / w) + .5, coverage)) { row.uncoveredPixels++; continue; }
    row.pixels++; let delta = Math.abs(a[p * 4 + 3] - b[p * 4 + 3]);
    for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(a[p * 4 + c] * a[p * 4 + 3] / 255 - b[p * 4 + c] * b[p * 4 + 3] / 255));
    if (delta > REFERENCE_COMPARISON_POLICY.channelTolerance) row.differentPixels++;
  }
  for (const row of results) {
    if (unknownComponents.includes(row.componentId)) { row.status = 'unverified'; row.reason = 'UNKNOWN_REFERENCE_STATE'; }
    else if (globalUnknown) { row.status = 'unverified'; row.reason = 'UNKNOWN_STATE_DEPENDENCY'; }
    else if (row.mode === 'exclude') { row.status = 'excluded'; row.reason = scopes.find(s => s.componentId === row.componentId).reason; }
    else if (row.unverifiedPixels) { row.status = 'unverified'; row.reason = 'UNKNOWN_STATE_OVERLAP'; }
    else if (!row.pixels || row.uncoveredPixels) { row.status = 'blocked'; row.reason = row.uncoveredPixels ? 'REFERENCE_MAPPING_UNCOVERED' : 'NO_VISIBLE_OWN_RECTANGLE'; }
    else row.status = row.differentPixels / row.pixels <= REFERENCE_COMPARISON_POLICY.maxDifferentPixelRatio ? 'passed' : 'failed';
  }
  const compared = results.filter(r => r.mode === 'compare');
  const partial = unknownComponents.length > 0 || compared.some(r => r.status === 'unverified' || r.status === 'blocked');
  const counts = { passed: compared.filter(r => r.status === 'passed').length, failed: compared.filter(r => r.status === 'failed').length, unverified: results.filter(r => r.status === 'unverified' || (r.mode === 'compare' && r.status === 'blocked')).length };
  return { ...base, coverage: partial ? 'partial' : 'complete', counts, status: counts.failed ? 'failed' : partial ? (counts.passed ? 'partially_verified' : 'blocked') : !compared.length || compared.some(r => r.status === 'blocked') ? 'blocked' : compared.some(r => r.status === 'failed') ? 'failed' : 'passed', scopes: results };
}
