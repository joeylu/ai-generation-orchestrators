import { canonicalJson, digestJson } from './canonical.mjs';
import { snapshotJson, validatePanelSpec } from './spec.mjs';

/** Invalid patch instructions; invalid resulting PanelSpecs use PanelSpecError. */
export class PanelPatchError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = 'PanelPatchError';
    this.code = code;
    this.path = path;
  }
}

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const INVALID_TEXT = /[\p{Cc}\p{Cs}]/u;
const OP_KEYS = {
  'set-panel-title': ['op', 'title'],
  'set-theme': ['op', 'theme'],
  'set-layout': ['op', 'layout'],
  'set-row-label': ['op', 'rowId', 'label'],
  'set-row-enabled': ['op', 'rowId', 'enabled'],
  'set-button-label': ['op', 'rowId', 'buttonLabel'],
  'set-button-action': ['op', 'rowId', 'action'],
  'set-state-initial': ['op', 'fieldId', 'value'],
  'add-row': ['op', 'sectionId', 'afterRowId', 'row', 'state'],
  'remove-row': ['op', 'rowId'],
};
const fail = (code, path, message) => { throw new PanelPatchError(code, path, message); };

function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object', path, 'must be an object');
  if (!keys) return;
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail('unknown-key', `${path}.${key}`, 'unknown field');
  for (const key of keys) if (!Object.hasOwn(value, key)) fail('required', `${path}.${key}`, 'required field is missing');
}

function text(value, path, max) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || INVALID_TEXT.test(value)) {
    fail('text', path, `must be a non-empty string of at most ${max} Unicode characters without control characters`);
  }
}

function identifier(value, path) {
  text(value, path, 64);
  if (!ID.test(value)) fail('identifier', path, 'must be a stable identifier, not a path or index');
}

// Only instruction structure is checked here. Values inserted into the isolated
// candidate are checked by validatePanelSpec, including all nested exact keys.
// Conflicting writes are forbidden, so an invalid value cannot be overwritten or
// deleted by a later instruction to evade final validation.
function snapshotPatch(input) {
  const patch = snapshotJson(input);
  object(patch, ['patchVersion', 'baseSpecSha256', 'reason', 'operations'], '$');
  if (patch.patchVersion !== '0.1') fail('version', '$.patchVersion', 'only PanelPatch 0.1 is supported');
  if (typeof patch.baseSpecSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(patch.baseSpecSha256)) {
    fail('digest', '$.baseSpecSha256', 'must be a lowercase SHA-256 digest');
  }
  text(patch.reason, '$.reason', 1000);
  if (!Array.isArray(patch.operations) || patch.operations.length < 1 || patch.operations.length > 32) {
    fail('array', '$.operations', 'must contain 1..32 operations');
  }
  patch.operations.forEach((operation, index) => {
    const path = `$.operations[${index}]`;
    object(operation, null, path);
    if (typeof operation.op !== 'string' || !Object.hasOwn(OP_KEYS, operation.op)) fail('operation', `${path}.op`, 'unsupported operation');
    object(operation, OP_KEYS[operation.op], path);
    if (Object.hasOwn(operation, 'rowId')) identifier(operation.rowId, `${path}.rowId`);
    if (Object.hasOwn(operation, 'fieldId')) identifier(operation.fieldId, `${path}.fieldId`);
    if (operation.op === 'add-row') {
      identifier(operation.sectionId, `${path}.sectionId`);
      if (operation.afterRowId !== null) identifier(operation.afterRowId, `${path}.afterRowId`);
      object(operation.row, null, `${path}.row`);
      identifier(operation.row.id, `${path}.row.id`);
      if (['button', 'text'].includes(operation.row.kind)) {
        if (operation.state !== null) fail('button-state', `${path}.state`, 'button and text rows require state: null');
      } else {
        object(operation.state, null, `${path}.state`);
        identifier(operation.state.id, `${path}.state.id`);
        if (operation.row.bind !== operation.state.id) fail('binding', `${path}.row.bind`, 'must bind to the state supplied by this operation');
      }
    }
  });
  return patch;
}

function findRow(spec, id, path) {
  for (const section of spec.sections) {
    const index = section.rows.findIndex(row => row.id === id);
    if (index !== -1) return { section, index, row: section.rows[index] };
  }
  fail('missing-row', path, `row ${id} does not exist`);
}

function rowContents(spec) {
  const state = new Map(spec.state.map(field => [field.id, field]));
  return new Map(spec.sections.flatMap(section => section.rows.map(row => [row.id, canonicalJson({ row, state: Object.hasOwn(row, 'bind') ? state.get(row.bind) : null })])));
}

/**
 * Atomically apply bounded stable-ID operations to an exact source snapshot.
 * No IO, catalog resolution or compilation is performed. Callers must compile
 * the returned spec against a validated catalog before publishing any package.
 *
 * Overlap rules: each property can be written only once; add/remove reserve the
 * entire row and paired state, if present. Button/text additions require state: null.
 * Different existing row properties may be edited
 * together. Empty sections are rejected, never silently removed.
 *
 * changedRowIds covers changed row definitions or their paired state, including
 * additions/removals. It is not a list of geometry or rendering invalidations.
 * Reason is the caller's explanation, not proof of natural-language intent.
 */
export async function applyPanelPatch(inputSpec, inputPatch) {
  // Both snapshots happen before the first await, protecting against mutation
  // while digest computation is pending.
  const original = validatePanelSpec(inputSpec);
  const patch = snapshotPatch(inputPatch);
  const baseSpecSha256 = await digestJson(original);
  if (patch.baseSpecSha256 !== baseSpecSha256) fail('base-digest', '$.baseSpecSha256', 'patch does not target this exact PanelSpec');
  const candidate = snapshotJson(original);
  const touches = new Map();
  function touch(resource, property, path) {
    const previous = touches.get(resource) ?? new Set();
    if (previous.has('*') || previous.has(property) || (property === '*' && previous.size)) {
      fail('overlap', path, 'operation overlaps an earlier write to the same row, state or property');
    }
    previous.add(property);
    touches.set(resource, previous);
  }

  patch.operations.forEach((operation, index) => {
    const path = `$.operations[${index}]`;
    switch (operation.op) {
      case 'set-panel-title':
      case 'set-theme':
      case 'set-layout': {
        const property = { 'set-panel-title': 'title', 'set-theme': 'theme', 'set-layout': 'layout' }[operation.op];
        touch('panel', property, path);
        candidate[property] = operation[property];
        break;
      }
      case 'set-row-label':
      case 'set-row-enabled': {
        const property = operation.op === 'set-row-label' ? 'label' : 'enabled';
        touch(`row:${operation.rowId}`, property, path);
        findRow(candidate, operation.rowId, `${path}.rowId`).row[property] = operation[property];
        break;
      }
      case 'set-state-initial': {
        touch(`state:${operation.fieldId}`, 'initial', path);
        const field = candidate.state.find(value => value.id === operation.fieldId);
        if (!field) fail('missing-state', `${path}.fieldId`, 'state field does not exist');
        field.initial = operation.value;
        break;
      }
      case 'set-button-label':
      case 'set-button-action': {
        const property = operation.op === 'set-button-label' ? 'buttonLabel' : 'action';
        touch(`row:${operation.rowId}`, property, path);
        const { row } = findRow(candidate, operation.rowId, `${path}.rowId`);
        if (row.kind !== 'button') fail('row-kind', `${path}.rowId`, 'button edit requires an existing button row');
        row[property] = operation[property];
        break;
      }
      case 'add-row': {
        touch(`row:${operation.row.id}`, '*', path);
        if (operation.state !== null) touch(`state:${operation.state.id}`, '*', path);
        const section = candidate.sections.find(value => value.id === operation.sectionId);
        if (!section) fail('missing-section', `${path}.sectionId`, 'section does not exist');
        if (candidate.sections.some(value => value.rows.some(row => row.id === operation.row.id))) {
          fail('duplicate', `${path}.row.id`, 'row identifier already exists');
        }
        if (operation.state !== null && candidate.state.some(value => value.id === operation.state.id)) fail('duplicate', `${path}.state.id`, 'state identifier already exists');
        const after = operation.afterRowId === null ? -1 : section.rows.findIndex(row => row.id === operation.afterRowId);
        if (operation.afterRowId !== null && after === -1) fail('missing-anchor', `${path}.afterRowId`, 'anchor must exist in the target section');
        section.rows.splice(after + 1, 0, operation.row);
        if (operation.state !== null) candidate.state.push(operation.state);
        break;
      }
      case 'remove-row': {
        touch(`row:${operation.rowId}`, '*', path);
        const { section, index: rowIndex, row } = findRow(candidate, operation.rowId, `${path}.rowId`);
        if (Object.hasOwn(row, 'bind')) touch(`state:${row.bind}`, '*', path);
        section.rows.splice(rowIndex, 1);
        if (Object.hasOwn(row, 'bind')) candidate.state = candidate.state.filter(field => field.id !== row.bind);
        if (candidate.assets) candidate.assets.rowIcons = candidate.assets.rowIcons.filter(icon => icon.rowId !== row.id);
        break;
      }
    }
  });

  const spec = validatePanelSpec(candidate);
  const before = rowContents(original);
  const after = rowContents(spec);
  const changedRowIds = [...new Set([...before.keys(), ...after.keys()])]
    .filter(id => before.get(id) !== after.get(id)).sort();
  const [patchSha256, resultSpecSha256] = await Promise.all([digestJson(patch), digestJson(spec)]);
  return {
    spec,
    receipt: { patchVersion: '0.1', baseSpecSha256, patchSha256, resultSpecSha256, changedRowIds, status: 'APPLIED' },
  };
}
