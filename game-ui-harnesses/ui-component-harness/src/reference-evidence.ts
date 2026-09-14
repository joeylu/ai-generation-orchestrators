/** Portable v2 reference contract. No DOM, renderer, filesystem or provider dependencies. */
type Row = Record<string, any>;
export interface ReferenceEvidence {
  status: 'complete' | 'missing_reference_evidence';
  visualComparisonReady: boolean;
  unknownFields: string[];
  humanVisualAcceptance: false;
  manifest?: Row;
  state?: Row;
  scope?: Row;
  files: { path: string; sha256: string; base64: string }[];
}
const fields: Record<string, string[]> = {
  Tabs: ['activeId'], CheckBox: ['checked'], Switch: ['checked'], RadioGroup: ['selectedId'],
  Select: ['selectedId', 'popupOpen'], List: ['selectedId'], ScrollView: ['scrollX', 'scrollY'],
  Input: ['value'], Slider: ['value'], ProgressBar: ['value'], Dialog: ['open'],
};
function check(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function exact(row: any, keys: string[], code: string): asserts row is Row {
  check(row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length === keys.length && keys.every(k => Object.hasOwn(row, k)), code);
}
const finite = (v: any) => typeof v === 'number' && Number.isFinite(v);
const text = (v: any) => typeof v === 'string' && v.trim().length > 0;
export function referencePaths(reference: any): string[] {
  exact(reference, ['original', 'mapping', 'state', 'scope', 'derivatives'], 'REFERENCE_MANIFEST');
  exact(reference.original, ['path', 'sha256', 'width', 'height'], 'REFERENCE_ORIGINAL');
  exact(reference.state, ['path', 'sha256'], 'REFERENCE_STATE_ENTRY');
  exact(reference.scope, ['path', 'sha256'], 'REFERENCE_SCOPE_ENTRY');
  check(typeof reference.original.path === 'string' && /^reference\/original\.(png|jpe?g|webp|gif|bmp)$/i.test(reference.original.path), 'REFERENCE_PATH_INVALID');
  check(reference.state.path === 'reference/reference-state.json' && reference.scope.path === 'acceptance-scope.json', 'REFERENCE_PATH_INVALID');
  check(Array.isArray(reference.derivatives), 'REFERENCE_DERIVED_SCHEMA');
  const derived = reference.derivatives.map((row: Row) => {
    exact(row, ['path', 'sha256', 'width', 'height', 'source', 'mapping'], 'REFERENCE_DERIVED_SCHEMA');
    check(typeof row.path === 'string' && /^reference\/derived-[1-9][0-9]*\.(png|jpe?g|webp|gif|bmp)$/i.test(row.path) && row.source === reference.original.path, 'REFERENCE_PATH_INVALID');
    return row.path;
  });
  check(new Set(derived).size === derived.length, 'REFERENCE_DERIVED_DUPLICATE');
  return [reference.original.path, reference.state.path, reference.scope.path, ...derived];
}
function imageSize(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  check(bytes.length >= 24, 'REFERENCE_IMAGE_INVALID');
  if (bytes[0] === 137 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR') return [view.getUint32(16), view.getUint32(20)];
  if (ascii(0, 3) === 'GIF') return [view.getUint16(6, true), view.getUint16(8, true)];
  if (ascii(0, 2) === 'BM') return [view.getInt32(18, true), Math.abs(view.getInt32(22, true))];
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (ascii(12, 4) === 'VP8X') return [1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)];
    if (ascii(12, 4) === 'VP8L') { const bits = view.getUint32(21, true); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]; }
    if (ascii(12, 4) === 'VP8 ') return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      check(bytes[offset++] === 255, 'REFERENCE_IMAGE_INVALID');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; const length = view.getUint16(offset);
      check(length >= 2 && offset + length <= bytes.length, 'REFERENCE_IMAGE_INVALID');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  throw new Error('REFERENCE_FORMAT_UNSUPPORTED');
}
export function validateReferenceMapping(m: any, size: number[], canvas: Row): void {
  exact(m, ['coordinateSpace', 'sourceSize', 'targetSize', 'crop', 'rotationDegrees', 'flipX', 'flipY', 'scale', 'offset'], 'REFERENCE_MAPPING_INCOMPLETE');
  check(m.coordinateSpace === 'raw-image-pixel-edges-to-runtime-canvas', 'REFERENCE_MAPPING_SPACE');
  check(JSON.stringify(m.sourceSize) === JSON.stringify(size) && JSON.stringify(m.targetSize) === JSON.stringify([canvas.width, canvas.height]), 'REFERENCE_SIZE_MISMATCH');
  for (const [key, count] of [['crop', 4], ['scale', 2], ['offset', 2]] as const) check(Array.isArray(m[key]) && m[key].length === count && m[key].every(finite), 'REFERENCE_MAPPING_INVALID');
  const [x, y, w, h] = m.crop;
  check(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= size[0] && y + h <= size[1], 'REFERENCE_CROP_INVALID');
  check([0, 90, 180, 270].includes(m.rotationDegrees) && typeof m.flipX === 'boolean' && typeof m.flipY === 'boolean', 'REFERENCE_ROTATION_INVALID');
  const [rw, rh] = [90, 270].includes(m.rotationDegrees) ? [h, w] : [w, h];
  const [sx, sy] = m.scale, [ox, oy] = m.offset;
  check(sx > 0 && sy > 0 && ox >= 0 && oy >= 0 && ox + rw * sx <= canvas.width + 1e-6 && oy + rh * sy <= canvas.height + 1e-6, 'REFERENCE_MAPPING_BOUNDS');
}
export function validateReferenceStates(state: any, scope: any, document: Row): string[] {
  exact(state, ['kind', 'schemaVersion', 'components'], 'REFERENCE_STATE_SCHEMA');
  check(state.kind === 'ui-reference-state' && ['1.0','1.1'].includes(state.schemaVersion) && Array.isArray(state.components), 'REFERENCE_STATE_SCHEMA');
  const nodes = new Map<string, Row>();
  function visit(node: Row) { check(node && !nodes.has(node.id), 'REFERENCE_COMPONENT_INVALID'); nodes.set(node.id, node); for (const child of node.children ?? []) visit(child); }
  visit(document.root);
  const seen = new Set<string>(), unknown: string[] = [];
  for (const row of state.components) {
    exact(row, ['componentId', 'componentType', 'fields'], 'REFERENCE_STATE_SCHEMA');
    const node = nodes.get(row.componentId);
    check(node && !seen.has(row.componentId) && row.componentType === node.type && Object.hasOwn(fields, node.type), 'REFERENCE_STATE_COMPONENT');
    seen.add(row.componentId); exact(row.fields, state.schemaVersion==='1.1'&&node.type==='Input'?[...fields.Input,'focused','selectionStart','selectionEnd','selectionDirection','caretVisible']:fields[node.type], 'REFERENCE_STATE_FIELDS');
    for (const [field, raw] of Object.entries(row.fields)) {
      const e = raw as Row;
      if (e?.status === 'unknown') {
        exact(e, ['status', 'reason'], 'REFERENCE_STATE_UNKNOWN'); check(text(e.reason), 'REFERENCE_STATE_UNKNOWN'); unknown.push(`${row.componentId}.${field}`); continue;
      }
      exact(e, ['status', 'value', 'evidence'], 'REFERENCE_STATE_EVIDENCE'); check(e.status === 'observed' && text(e.evidence), 'REFERENCE_STATE_EVIDENCE');
      const value = e.value, props = node.props, type = node.type;
      if (['checked', 'popupOpen', 'open','focused','caretVisible'].includes(field)) check(typeof value === 'boolean', 'REFERENCE_STATE_VALUE');
      else if(['selectionStart','selectionEnd'].includes(field))check(Number.isInteger(value)&&value>=0&&value<=(row.fields.value.status==='observed'?row.fields.value.value.length:props.maxLength),'REFERENCE_STATE_SELECTION');
      else if(field==='selectionDirection')check(['forward','backward','none'].includes(value),'REFERENCE_STATE_SELECTION');
      else if (['activeId', 'selectedId'].includes(field)) {
        const options = props[type === 'Tabs' ? 'tabs' : type === 'List' ? 'items' : 'options'];
        check((value === null && type !== 'Tabs') || (typeof value === 'string' && options.some((o: Row) => o.id === value)), 'REFERENCE_STATE_OPTION');
      } else if (type === 'Input') check(typeof value === 'string' && value.length <= props.maxLength, 'REFERENCE_STATE_VALUE');
      else {
        const min = type === 'Slider' ? props.min : 0;
        const max = ['Slider', 'ProgressBar'].includes(type) ? props.max : Math.max(0, props[field === 'scrollX' ? 'contentWidth' : 'contentHeight'] - node.layout[field === 'scrollX' ? 'width' : 'height']);
        check(finite(value) && value >= min && value <= max, 'REFERENCE_STATE_VALUE');
        if (type === 'Slider') check(Math.abs((value - min) / props.step - Math.round((value - min) / props.step)) < 1e-6, 'REFERENCE_STATE_VALUE');
      }
    }
    if(node.type==='Input'&&state.schemaVersion==='1.1'){
      const known=(key:string)=>row.fields[key].status==='observed'?row.fields[key].value:undefined;
      check(['text','password'].includes(node.props.inputType),'REFERENCE_INPUT_EDITING_UNSUPPORTED');
      check(!(known('selectionStart')>known('selectionEnd')),'REFERENCE_STATE_SELECTION');
      if(known('selectionStart')!==undefined&&known('selectionStart')===known('selectionEnd')&&known('selectionDirection')!==undefined)check(known('selectionDirection')==='none','REFERENCE_STATE_SELECTION');
      if(known('focused')===true)check(node.props.enabled!==false,'REFERENCE_INPUT_DISABLED_FOCUS');
      if(known('caretVisible')===true)check(known('focused')===true&&!node.props.readOnly&&known('selectionStart')!==undefined&&known('selectionStart')===known('selectionEnd'),'REFERENCE_CARET_CONFLICT');
    }
  }
  check(state.components.filter((r:any)=>r.componentType==='Input'&&r.fields.focused?.status==='observed'&&r.fields.focused.value===true).length<=1,'REFERENCE_MULTIPLE_FOCUSED_INPUTS');
  check([...nodes.values()].filter(n => Object.hasOwn(fields, n.type)).every(n => seen.has(n.id)), 'REFERENCE_STATE_COVERAGE');
  exact(scope, ['kind', 'schemaVersion', 'referenceState', 'components', 'derivedTestStates', 'human_visual_acceptance'], 'ACCEPTANCE_SCOPE_SCHEMA');
  check(scope.kind === 'ui-acceptance-scope' && scope.schemaVersion === '1.0' && scope.referenceState === 'reference/reference-state.json' && scope.human_visual_acceptance === false && Array.isArray(scope.components) && Array.isArray(scope.derivedTestStates), 'ACCEPTANCE_SCOPE_SCHEMA');
  const covered = new Set();
  for (const row of scope.components) {
    exact(row, ['componentId', 'mode', 'reason'], 'ACCEPTANCE_SCOPE_COMPONENT');
    check(nodes.has(row.componentId) && !covered.has(row.componentId) && ['compare', 'exclude'].includes(row.mode) && text(row.reason), 'ACCEPTANCE_SCOPE_COMPONENT'); covered.add(row.componentId);
  }
  check(covered.size === nodes.size, 'ACCEPTANCE_SCOPE_COVERAGE');
  for (const row of scope.derivedTestStates) { exact(row, ['componentId', 'basis', 'description'], 'ACCEPTANCE_DERIVED_STATE'); check(nodes.has(row.componentId) && row.basis === 'contract-derived' && text(row.description), 'ACCEPTANCE_DERIVED_STATE'); }
  return unknown;
}
export async function validateReferenceEvidence(reference: Row, members: ReadonlyMap<string, { bytes: Uint8Array }>, document: Row, parse: (bytes: Uint8Array) => Row): Promise<ReferenceEvidence> {
  const paths = referencePaths(reference);
  const files: ReferenceEvidence['files'] = [];
  for (const row of [reference.original, reference.state, reference.scope, ...reference.derivatives]) {
    const member = members.get(row.path); check(member, 'REFERENCE_MEMBER_MISSING');
    check(typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256), 'REFERENCE_DIGEST_INVALID');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(member.bytes)))].map(x => x.toString(16).padStart(2, '0')).join('');
    check(hash === row.sha256, 'REFERENCE_DIGEST_MISMATCH');
    let binary = ''; for (const byte of member.bytes) binary += String.fromCharCode(byte);
    files.push({ path: row.path, sha256: hash, base64: btoa(binary) });
  }
  const size = imageSize(members.get(paths[0])!.bytes);
  check(size.every(x => Number.isSafeInteger(x) && x > 0) && size[0] * size[1] <= 67_108_864 && size[0] === reference.original.width && size[1] === reference.original.height, 'REFERENCE_SIZE_MISMATCH');
  validateReferenceMapping(reference.mapping, size, document.canvas);
  for (const row of reference.derivatives) {
    const dimensions = imageSize(members.get(row.path)!.bytes);
    check(dimensions[0] === row.width && dimensions[1] === row.height, 'REFERENCE_SIZE_MISMATCH');
    validateReferenceMapping(row.mapping, size, { width: row.width, height: row.height });
  }
  const state = parse(members.get(paths[1])!.bytes), scope = parse(members.get(paths[2])!.bytes);
  const unknownFields = validateReferenceStates(state, scope, document);
  return { status: 'complete', visualComparisonReady: unknownFields.length === 0, unknownFields, humanVisualAcceptance: false, manifest: reference, state, scope, files };
}
