import type { UiBundle } from './bundle.ts';
import { compileComponentHandoff } from './component-handoff.ts';
import { componentHandoffEntries, MAX_COMPONENT_HANDOFF_ARCHIVE_BYTES } from './decomposition-import.ts';

import { validateReferenceStates } from './reference-evidence.ts';

/** Bundle 0.3 preserves the authoritative handoff; its v2 fields are not duplicated. */
export interface PersistedHandoff { sha256: string; base64: string }
export function encodeArchive(bytes: Uint8Array): string {
  let value = ''; for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
export async function referenceSha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function decodeArchive(value: string): Uint8Array {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(MAX_COMPONENT_HANDOFF_ARCHIVE_BYTES / 3) * 4) throw new Error('REFERENCE_ARCHIVE_SIZE_LIMIT');
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (bytes.length > MAX_COMPONENT_HANDOFF_ARCHIVE_BYTES || encodeArchive(bytes) !== value) throw new Error('REFERENCE_ARCHIVE_BASE64');
  return bytes;
}
function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
const mutable: Record<string, string[]> = { Tabs: ['activeId'], CheckBox: ['checked'], Switch: ['checked'], RadioGroup: ['selectedId'], List: ['selectedId'], Select: ['selectedId'], ScrollView: ['scrollX', 'scrollY'], Input: ['value'], Slider: ['value'], ProgressBar: ['value'], Dialog: ['open'] };
function nodes(document: any): any[] { const all: any[] = []; const visit = (n: any) => { all.push(n); for (const c of n.children ?? []) visit(c); }; visit(document.root); return all; }
function structure(document: any): string {
  const copy = structuredClone(document);
  for (const node of nodes(copy)) for (const key of mutable[node.type] ?? []) delete node.props[key];
  return canonical(copy);
}
export async function validatePersistedHandoff(input: unknown, bundle: UiBundle) {
  const value = input as PersistedHandoff;
  if (!value || Object.keys(value).sort().join(',') !== 'base64,sha256' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('REFERENCE_ARCHIVE_ATTACHMENT');
  const bytes = decodeArchive(value.base64);
  if (await referenceSha256(bytes) !== value.sha256) throw new Error('REFERENCE_ARCHIVE_DIGEST');
  const source = await compileComponentHandoff(bytes);
  if (source.referenceEvidence.status !== 'complete') throw new Error('REFERENCE_EVIDENCE_REQUIRED');
  if (bundle.document.schemaVersion !== '0.2' || structure(bundle.document) !== structure(source.bundle.document)
    || canonical([...bundle.resources].sort((a, b) => a.path.localeCompare(b.path))) !== canonical([...source.bundle.resources].sort((a, b) => a.path.localeCompare(b.path)))) throw new Error('REFERENCE_EVIDENCE_STALE: component structure, options, canvas or resources changed');
  validateReferenceStates(source.referenceEvidence.state, source.referenceEvidence.scope, bundle.document);
  return source.referenceEvidence;
}

/** Deterministic ZIP_STORED writer; entries originate from the validated v2 inventory. */
export function zip(entries: Map<string, Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const [path, bytes] of [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const name = new TextEncoder().encode(path); let crc = 0xffffffff;
    for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const header = new Uint8Array(46 + name.length), c = new DataView(header.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); header.set(name, 46);
    chunks.push(local, bytes); central.push(header); offset += local.length + bytes.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.size, true); v.setUint16(10, entries.size, true); v.setUint32(12, size, true); v.setUint32(16, offset, true);
  const output = new Uint8Array(offset + size + 22); let cursor = 0;
  for (const part of [...chunks, ...central, end]) { output.set(part, cursor); cursor += part.length; }
  return output;
}
export async function exportReferenceHandoff(bundle: UiBundle): Promise<Uint8Array> {
  await validatePersistedHandoff(bundle.componentHandoff, bundle);
  const entries = await componentHandoffEntries(decodeArchive(bundle.componentHandoff!.base64));
  const read = (path: string) => JSON.parse(new TextDecoder().decode(entries.get(path)!));
  const write = (path: string, value: unknown) => entries.set(path, new TextEncoder().encode(JSON.stringify(value)));
  const semantic = read('component.ui-bundle.json'), manifest = read('handoff.json');
  const current = new Map(nodes(bundle.document).map(n => [n.id, n]));
  for (const node of nodes(semantic.document)) for (const key of mutable[node.type] ?? []) node.props[key] = current.get(node.id).props[key];
  if (bundle.motion) semantic.motion = bundle.motion; else delete semantic.motion;
  if (bundle.motionSystem) semantic.motionSystem = bundle.motionSystem; else delete semantic.motionSystem;
  semantic.bundleVersion = bundle.motionSystem ? '0.2' : '0.1';
  write('runtime.ui-bundle.json', semantic);
  manifest.schemaVersion = '2.1';
  manifest.runtime_bundle = { path: 'runtime.ui-bundle.json', sha256: await referenceSha256(entries.get('runtime.ui-bundle.json')!) };
  write('handoff.json', manifest);
  const output = zip(entries); await compileComponentHandoff(output); return output;
}
