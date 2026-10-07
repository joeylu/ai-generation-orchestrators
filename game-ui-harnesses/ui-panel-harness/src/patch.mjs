import { canonicalJson, digestJson } from './canonical.mjs';
import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { navigationRows } from './tabs.mjs';
import { checkButtonStyle, BUTTON_STYLE_KEYS } from './button-style.mjs';
import { checkTitleBar } from './title-bar.mjs';
import { checkButtonFontSize } from './button-font.mjs';
import { checkAppearance } from './appearance.mjs';
import { checkPanelFrame, ratioPanelFrame, applyPanelFrame } from './panel-frame.mjs';
import { checkLayoutDetails } from './layout-details.mjs';

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
  'set-appearance': ['op', 'appearance'],
  'set-action-layout': ['op', 'sectionId', 'layout'],
  'set-button-style': ['op', 'rowId', 'style'],
  'set-button-font-size': ['op', 'rowId', 'fontSize'],
  'set-title-bar': ['op','style'],
  'set-text-wrap': ['op','rowId','wrap'],
  'set-panel-frame': ['op','frame'],
  'set-panel-ratio': ['op','ratio','width'],
  'set-layout-details': ['op','details'],
  'set-row-order': ['op', 'sectionId', 'rowIds'],
  'set-text': ['op', 'rowId', 'text'],
  'set-row-label': ['op', 'rowId', 'label'],
  'set-row-enabled': ['op', 'rowId', 'enabled'],
  'set-button-label': ['op', 'rowId', 'buttonLabel'],
  'set-button-action': ['op', 'rowId', 'action'],
  'set-state-initial': ['op', 'fieldId', 'value'],
  'add-row': ['op', 'sectionId', 'afterRowId', 'row', 'state'],
  'remove-row': ['op', 'rowId'],
  'set-tab-label': ['op', 'pageId', 'label'],
  'set-tabs-enabled': ['op', 'enabled'],
  'set-input-properties': ['op', 'rowId', 'placeholder', 'inputType', 'readOnly', 'maxLength', 'validation'],
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
    if (Object.hasOwn(operation, 'pageId')) identifier(operation.pageId, `${path}.pageId`);
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
  return new Map([...spec.sections.flatMap(section => section.rows), ...navigationRows(spec)]
    .map(row => [row.id, canonicalJson({ row, state: Object.hasOwn(row, 'bind') ? state.get(row.bind) : null,
      ...(spec.buttonFonts?.some(entry => entry.rowId === row.id) ? { buttonFontSize: spec.buttonFonts.find(entry => entry.rowId === row.id).fontSize } : {}),
      ...(spec.textLayouts?.some(entry => entry.rowId === row.id) ? { textWrap: 'word' } : {}),
    })]));
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
      case 'set-layout-details': {
        if (!['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(candidate.panelSpecVersion)) fail('layout-details-version',path,'Modern form spec required');
        checkLayoutDetails(operation.details,fail,path+'.details');
        for (const [key,value] of Object.entries(operation.details)) if(value!==null) {
          touch('layout-details',key,path+'.details.'+key);
          candidate.layout[key]=value;
        }
        break;
      }
      case 'set-panel-frame':
      case 'set-panel-ratio': {
        if (!['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(candidate.panelSpecVersion)) fail('panel-frame-version',path,'modern form spec required');
        const frame=operation.op==='set-panel-ratio'?ratioPanelFrame(candidate,operation.ratio,operation.width,fail,path):operation.frame;
        checkPanelFrame(frame,fail,path+'.frame');touch('panel','layout',path);touch('panel','frame',path);touch('panel','canvas',path);
        if(frame===null&&!candidate.frame)break;
        Object.assign(candidate,{panelSpecVersion:'0.14',appearance:candidate.appearance??null,actionLayouts:candidate.actionLayouts??[],buttonStyles:candidate.buttonStyles??[],buttonFonts:candidate.buttonFonts??[],titleBar:candidate.titleBar??null,textLayouts:candidate.textLayouts??[]});
        applyPanelFrame(candidate,frame);break;
      }
      case 'set-row-order': {
        identifier(operation.sectionId, path + '.sectionId');
        const section = candidate.sections.find(s => s.id === operation.sectionId);
        if (!section) fail('missing-section', path, 'existing section required');
        const ids = operation.rowIds;
        if (!Array.isArray(ids) || ids.length !== section.rows.length || new Set(ids).size !== ids.length || ids.some(id => !section.rows.some(row => row.id === id))) fail('row-order', path, 'complete permutation of existing rows required');
        const structural = patch.operations.some(op => op.op === 'add-row' && op.sectionId === section.id || op.op === 'remove-row' && original.sections.find(s => s.id === section.id)?.rows.some(row => row.id === op.rowId));
        if (structural) fail('overlap', path, 'reordering and adding/removing in the same section must be separate edits');
        touch('section:' + section.id, 'row-order', path);
        section.rows = ids.map(id => section.rows.find(row => row.id === id)); break;
      }
      case 'set-text': {
        const { row } = findRow(candidate, operation.rowId, path + '.rowId');
        if (row.kind !== 'text') fail('row-kind', path, 'existing Text row required');
        touch('row:' + row.id, 'text', path); row.text = operation.text; break;
      }
      case 'set-text-wrap': {
        if (!['0.7','0.8','0.9','0.10','0.11','0.12','0.13', '0.14'].includes(candidate.panelSpecVersion)) fail('text-wrap-version',path,'modern form spec required');
        const {row}=findRow(candidate,operation.rowId,path+'.rowId');
        if(row.kind!=='text'||![null,'word'].includes(operation.wrap)) fail('text-wrap-target',path,'existing Text row and wrap:word/null required');
        // Adding static body text and opting into wrapping is one atomic edit.
        // The added row's definition remains reserved against all other writes.
        const added = patch.operations.slice(0,index).some(op=>op.op==='add-row'&&op.row.id===row.id&&op.row.kind==='text');
        touch(added?'text-layout:'+row.id:'row:'+row.id,'text-wrap',path);
        if(operation.wrap===null&&!candidate.textLayouts?.some(v=>v.rowId===row.id)) break;
        if(candidate.panelSpecVersion!=='0.14')candidate.panelSpecVersion='0.13';candidate.appearance??=null;candidate.actionLayouts??=[];candidate.buttonStyles??=[];candidate.buttonFonts??=[];candidate.titleBar??=null;candidate.textLayouts??=[];
        candidate.textLayouts=candidate.textLayouts.filter(v=>v.rowId!==row.id);
        if(operation.wrap!==null)candidate.textLayouts.push({rowId:row.id,wrap:operation.wrap});
        candidate.textLayouts.sort((a,b)=>a.rowId<b.rowId?-1:a.rowId>b.rowId?1:0);break;
      }
      case 'set-title-bar': {
        if (!['0.7','0.8','0.9','0.10','0.11','0.12','0.13', '0.14'].includes(candidate.panelSpecVersion)) fail('title-bar-version',path,'modern form spec required');
        checkTitleBar(operation.style,fail,path+'.style'); touch('panel','title-bar',path);
        if (operation.style === null && !candidate.titleBar) break;
        if (!['0.13','0.14'].includes(candidate.panelSpecVersion)) candidate.panelSpecVersion = '0.12'; candidate.appearance ??= null; candidate.actionLayouts ??= []; candidate.buttonStyles ??= []; candidate.buttonFonts ??= []; candidate.titleBar = operation.style; break;
      }
      case 'set-button-font-size': {
        if (!['0.7','0.8','0.9','0.10','0.11','0.12','0.13', '0.14'].includes(candidate.panelSpecVersion)) fail('button-font-version', path, 'modern form spec required');
        const { row } = findRow(candidate, operation.rowId, path + '.rowId');
        if (row.kind !== 'button') fail('row-kind', path, 'existing button required');
        touch('row:' + row.id, 'button-font-size', path);
        checkButtonFontSize(operation.fontSize, fail, path + '.fontSize');
        if (operation.fontSize === null && !candidate.buttonFonts?.some(entry => entry.rowId === row.id)) break;
        if (!['0.12','0.13', '0.14'].includes(candidate.panelSpecVersion)) candidate.panelSpecVersion = '0.11'; candidate.appearance ??= null; candidate.actionLayouts ??= []; candidate.buttonStyles ??= []; candidate.buttonFonts ??= [];
        candidate.buttonFonts = candidate.buttonFonts.filter(entry => entry.rowId !== row.id);
        if (operation.fontSize !== null) candidate.buttonFonts.push({ rowId: row.id, fontSize: operation.fontSize });
        candidate.buttonFonts.sort((a,b) => a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0); break;
      }
      case 'set-button-style': {
        if (!['0.7','0.8','0.9','0.10','0.11','0.12','0.13', '0.14'].includes(candidate.panelSpecVersion)) fail('button-style-version', path, 'modern form spec required');
        const { row } = findRow(candidate, operation.rowId, path + '.rowId');
        if (row.kind !== 'button') fail('row-kind', path, 'existing button required');
        touch('row:' + row.id, 'button-style', path);
        if (operation.style !== null) checkButtonStyle(operation.style, fail, path + '.style');
        const empty = operation.style === null || BUTTON_STYLE_KEYS.every(key => operation.style[key] === null);
        if (empty && !candidate.buttonStyles?.some(s => s.rowId === row.id)) break;
        if (!['0.11','0.12','0.13', '0.14'].includes(candidate.panelSpecVersion)) candidate.panelSpecVersion = '0.10'; candidate.appearance ??= null; candidate.actionLayouts ??= []; candidate.buttonStyles ??= [];
        candidate.buttonStyles = candidate.buttonStyles.filter(s => s.rowId !== row.id);
        if (!empty) candidate.buttonStyles.push({rowId:row.id,style:operation.style});
        candidate.buttonStyles.sort((a,b)=>a.rowId<b.rowId?-1:a.rowId>b.rowId?1:0); break;
      }
      case 'set-action-layout': {
        if (!['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(candidate.panelSpecVersion)) fail('action-layout-version', path, 'button layouts require Spec 0.7 or newer');
        identifier(operation.sectionId, `${path}.sectionId`);
        if (!candidate.sections.some(s => s.id === operation.sectionId)) fail('action-layout-target', path, 'section does not exist');
        touch(`section:${operation.sectionId}`, 'action-layout', path);
        if (operation.layout === null && !candidate.actionLayouts?.some(a => a.sectionId === operation.sectionId)) break;
        candidate.appearance ??= null; candidate.actionLayouts ??= []; if (!['0.10','0.11','0.12','0.13', '0.14'].includes(candidate.panelSpecVersion)) candidate.panelSpecVersion = '0.9';
        candidate.actionLayouts = candidate.actionLayouts.filter(a => a.sectionId !== operation.sectionId);
        if (operation.layout !== null) {
          object(operation.layout, ['direction', 'align', 'gap', 'buttonWidth', 'buttonHeight', 'shape'], `${path}.layout`);
          candidate.actionLayouts.push({ ...operation.layout, sectionId: operation.sectionId });
        }
        candidate.actionLayouts.sort((a, b) => a.sectionId < b.sectionId ? -1 : a.sectionId > b.sectionId ? 1 : 0);
        break;
      }
      case 'set-appearance': {
        if (!['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(candidate.panelSpecVersion)) fail('appearance-version', path, 'appearance requires Spec 0.7 or 0.8');
        checkAppearance(operation.appearance, fail, `${path}.appearance`);
        touch('panel', 'appearance', path);
        if (!['0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(candidate.panelSpecVersion)) candidate.panelSpecVersion = '0.8';
        candidate.appearance = operation.appearance;
        break;
      }
      case 'set-input-properties': {
        const { row } = findRow(candidate, operation.rowId, `${path}.rowId`);
        if (!['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(candidate.panelSpecVersion) || row.kind !== 'input') fail('row-kind', path, 'existing input in Spec 0.7/0.8 required');
        for (const key of ['placeholder', 'inputType', 'readOnly', 'validation']) { touch(`row:${row.id}`, key, path); row[key] = operation[key]; }
        touch(`state:${row.bind}`, 'maxLength', path);
        candidate.state.find(field => field.id === row.bind).maxLength = operation.maxLength;
        break;
      }
      case 'set-tab-label': {
        if (!candidate.tabs) fail('tabs-required', path, 'existing tabs are required');
        const page=candidate.tabs.pages.find(page=>page.id===operation.pageId);
        if (!page) fail('missing-page', path, 'page does not exist');
        touch(`tab:${page.id}`, 'label', path); text(operation.label, `${path}.label`, 120);
        page.label=operation.label;
        candidate.state.find(field=>field.id===candidate.tabs.bind).options.find(option=>option.id===page.id).label=operation.label;
        break;
      }
      case 'set-tabs-enabled': {
        if (!candidate.tabs) fail('tabs-required', path, 'existing tabs are required');
        touch('tabs', 'enabled', path); candidate.tabs.enabled=operation.enabled; break;
      }
      case 'set-panel-title':
      case 'set-theme':
      case 'set-layout': {
        const property = { 'set-panel-title': 'title', 'set-theme': 'theme', 'set-layout': 'layout' }[operation.op];
        touch('panel', property, path);
        if (property === 'layout') touch('layout-details','*',path);
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
        if (candidate.textLayouts) candidate.textLayouts = candidate.textLayouts.filter(entry=>entry.rowId!==operation.rowId);
        if (candidate.buttonFonts) candidate.buttonFonts = candidate.buttonFonts.filter(value => value.rowId !== row.id);
        if (candidate.buttonStyles) candidate.buttonStyles = candidate.buttonStyles.filter(value => value.rowId !== row.id);
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
