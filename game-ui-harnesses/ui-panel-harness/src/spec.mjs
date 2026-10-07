import { checkPanelFrame } from './panel-frame.mjs';
import { checkTextLayouts,checkWrappedText,hasTextWrap } from './text-wrap.mjs';
import { checkTitleBar } from './title-bar.mjs';
import { checkButtonFonts } from './button-font.mjs';
import { checkButtonStyles } from './button-style.mjs';
import { checkActionLayouts } from './action-layout.mjs';
import { checkAppearance } from './appearance.mjs';
/** Strict, dependency-free PanelSpec 0.1–0.13 validation. No defaults are inserted. */
export class PanelSpecError extends Error {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = 'PanelSpecError';
    this.code = code;
    this.path = path;
  }
}

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SYMBOL = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const ASSET_SLUG = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;
const ASSET_KEY = /^([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]{0,63})@((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$(?![\s\S])/;
const SHA256 = /^[a-f0-9]{64}$(?![\s\S])/;
const INVALID_TEXT = /[\p{Cc}\p{Cs}]/u;
const fail = (code, path, message) => { throw new PanelSpecError(code, path, message); };
const at = (path, key) => `${path}[${JSON.stringify(key)}]`;

// Inspect descriptors before reading values: getters, custom prototypes, sparse arrays,
// symbols, cycles and non-JSON values must not cross the public contract boundary.
export function snapshotJson(input) {
  const active = new Set();
  let count = 0;
  function visit(value, path, depth) {
    if (++count > 20000 || depth > 32) fail('structure-limit', path, 'JSON structure is too large or deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('number', path, 'must be finite');
      return value;
    }
    if (typeof value !== 'object') fail('json-type', path, 'must contain only JSON values');
    if (active.has(value)) fail('cycle', path, 'cyclic values are not accepted');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype)) {
      fail('prototype', path, 'must be a plain JSON object or array');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) fail('json-type', path, 'symbol keys are not accepted');
    if (keys.length > (array ? 1025 : 256)) fail('structure-limit', path, 'too many entries');
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) fail('accessor', at(path, key), 'accessors are not accepted');
      if (!(array && key === 'length') && !descriptor.enumerable) {
        fail('json-type', at(path, key), 'non-enumerable properties are not accepted');
      }
    }
    active.add(value);
    let result;
    if (array) {
      const length = descriptors.length.value;
      if (length > 1024 || keys.length !== length + 1) fail('json-type', path, 'must be a dense JSON array');
      result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) fail('json-type', path, 'must be a dense JSON array without extra properties');
        result.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
      }
    } else {
      result = Object.fromEntries(keys.map(key => [key, visit(descriptors[key].value, at(path, key), depth + 1)]));
    }
    active.delete(value);
    return result;
  }
  return visit(input, '$', 0);
}

function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object', path, 'must be an object');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail('unknown-key', `${path}.${key}`, 'unknown field');
  for (const key of keys) if (!Object.hasOwn(value, key)) fail('required', `${path}.${key}`, 'required field is missing');
}

function text(value, path, max = 120, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || [...value].length > max || INVALID_TEXT.test(value)) {
    fail('text', path, `must be ${empty ? 'a' : 'a non-empty'} string of at most ${max} Unicode characters without control characters`);
  }
}

function identifier(value, path, symbolic = false) {
  text(value, path, symbolic ? 128 : 64);
  if (!(symbolic ? SYMBOL : ID).test(value)) fail('identifier', path, 'invalid symbolic identifier');
}

function reference(value, path) {
  object(value, ['id', 'version'], path);
  identifier(value.id, `${path}.id`, true);
  text(value.version, `${path}.version`, 32);
  if (!VERSION.test(value.version)) fail('version', `${path}.version`, 'must be an exact major.minor.patch version');
}

function integer(value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail('integer', path, `must be an integer in ${min}..${max}`);
}

function bool(value, path) {
  if (typeof value !== 'boolean') fail('boolean', path, 'must be a boolean');
}

function finite(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('number', path, 'must be a finite number');
}

function array(value, path, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail('array', path, `must be an array with ${min}..${max} entries`);
}

function unique(value, seen, path) {
  if (seen.has(value)) fail('duplicate', path, 'identifier must be unique');
  seen.add(value);
}

function aligned(value, definition, path) {
  const ticks = (value - definition.min) / definition.step;
  const rounded = Math.round(ticks);
  // Roundoff allowance must never grow large enough to accept a fractional tick.
  const tolerance = Math.min(1e-7, 16 * Number.EPSILON * Math.max(1, Math.abs(ticks)));
  if (!Number.isSafeInteger(rounded) || Math.abs(ticks - rounded) > tolerance) {
    fail('step', path, 'must align to the declared step measured from min');
  }
}

function stateValue(value, definition, path) {
  if (definition.type === 'string') {
    text(value, path, 512, true);
    if (value.length > definition.maxLength || /[\u2028\u2029]/u.test(value)) fail('input-value', path, 'single-line text exceeds its UTF-16 limit');
    return;
  }
  if (definition.type === 'boolean') return bool(value, path);
  if (definition.type === 'enum') {
    identifier(value, path);
    if (!definition.options.some(option => option.id === value)) fail('enum-value', path, 'must reference a declared option ID');
    return;
  }
  finite(value, path);
  if (value < (definition.type === 'progress' ? 0 : definition.min) || value > definition.max) fail('range', path, 'must be within the declared min/max');
  if (definition.type === 'progress') return;
  aligned(value, definition, path);
}

function exactAssetKey(value, path) {
  const match = typeof value === 'string' && value.length <= 153 ? ASSET_KEY.exec(value) : null;
  if (!match || match[3].length > 23 || match[3].split('.').some(part => Number(part) > 1000000)) {
    fail('asset-key', path, 'must be namespace/id@major.minor.patch with lowercase slugs of at most 64 characters and each version part at most 1000000');
  }
}

function panelAssets(value, rowIds) {
  object(value, ['library', 'panelSurface', 'rowIcons'], '$.assets');
  object(value.library, ['id', 'sha256'], '$.assets.library');
  if (typeof value.library.id !== 'string' || !ASSET_SLUG.test(value.library.id)) {
    fail('identifier', '$.assets.library.id', 'must be a lowercase slug of at most 64 characters');
  }
  if (typeof value.library.sha256 !== 'string' || !SHA256.test(value.library.sha256)) {
    fail('asset-digest', '$.assets.library.sha256', 'must be an exact lowercase SHA-256 digest');
  }
  if (value.panelSurface !== null) exactAssetKey(value.panelSurface, '$.assets.panelSurface');
  array(value.rowIcons, '$.assets.rowIcons', 0, 128);
  const assignedRows = new Set();
  value.rowIcons.forEach((entry, index) => {
    const path = `$.assets.rowIcons[${index}]`;
    object(entry, ['rowId', 'asset'], path);
    identifier(entry.rowId, `${path}.rowId`);
    if (!rowIds.has(entry.rowId)) fail('asset-binding', `${path}.rowId`, 'row identifier does not exist');
    unique(entry.rowId, assignedRows, `${path}.rowId`);
    exactAssetKey(entry.asset, `${path}.asset`);
  });
  if (value.panelSurface === null && value.rowIcons.length === 0) {
    fail('asset-selection', '$.assets', 'An assets object requires a panel surface or at least one row icon');
  }
}

function layoutBody(value, sectionIds) {
  const containers = new Set(), references = new Set();
  let count = 0;
  function visit(node, path, depth) {
    if (++count > 96 || depth > 8) fail('layout-structure', path, 'layout body supports at most 96 nodes and 8 levels');
    if (!node || !['section', 'column', 'row', 'grid'].includes(node.kind)) {
      fail('layout-kind', `${path}.kind`, 'must be section, column, row or grid');
    }
    const leaf = node.kind === 'section';
    object(node, leaf ? ['kind', 'sectionId', 'width']
      : ['id', 'kind', 'width', 'gap', 'align', 'children', ...(node.kind === 'grid' ? ['minColumnWidth'] : [])], path);
    if (node.width !== 'fill') integer(node.width, `${path}.width`, 1, 4096);
    if (leaf) {
      identifier(node.sectionId, `${path}.sectionId`);
      if (!sectionIds.has(node.sectionId)) fail('layout-section', `${path}.sectionId`, 'section does not exist');
      unique(node.sectionId, references, `${path}.sectionId`);
      return;
    }
    identifier(node.id, `${path}.id`);
    unique(node.id, containers, `${path}.id`);
    integer(node.gap, `${path}.gap`, 0, 256);
    if (!['start', 'center', 'end'].includes(node.align)) fail('layout-align', `${path}.align`, 'must be start, center or end');
    if (node.kind === 'grid') integer(node.minColumnWidth, `${path}.minColumnWidth`, 1, 4096);
    array(node.children, `${path}.children`, 1, 96);
    node.children.forEach((child, index) => visit(child, `${path}.children[${index}]`, depth + 1));
  }
  visit(value, '$.layout.body', 1);
  if (references.size !== sectionIds.size) fail('layout-coverage', '$.layout.body', 'every section must be referenced exactly once');
}

/** Return an isolated, validated JSON value; throw PanelSpecError on failure. */
export function validatePanelSpec(input) {
  const spec = snapshotJson(input);
  const sized = spec?.panelSpecVersion === '0.14', wrapping = sized || spec?.panelSpecVersion === '0.13', titled = wrapping || spec?.panelSpecVersion === '0.12', typography = titled || spec?.panelSpecVersion === '0.11', individual = typography || spec?.panelSpecVersion === '0.10', arranged = individual || spec?.panelSpecVersion === '0.9', styled = arranged || spec?.panelSpecVersion === '0.8';
  const forms = styled || spec?.panelSpecVersion === '0.7';
  const tabbed = forms || spec?.panelSpecVersion === '0.6';
  const progress = tabbed || spec?.panelSpecVersion === '0.5';
  const containers = progress || spec?.panelSpecVersion === '0.4';
  const controls = spec?.panelSpecVersion === '0.3' || containers;
  const hasAssetsField = spec?.panelSpecVersion === '0.2' || controls;
  object(spec, ['panelSpecVersion', 'id', 'title', 'theme', 'canvas', 'layout', 'state', 'sections', 'provenance', ...(hasAssetsField ? ['assets'] : []), ...(tabbed ? ['tabs'] : []), ...(styled ? ['appearance'] : []), ...(arranged ? ['actionLayouts'] : []), ...(individual ? ['buttonStyles'] : []), ...(typography ? ['buttonFonts'] : []), ...(titled ? ['titleBar'] : []), ...(wrapping ? ['textLayouts'] : []), ...(sized ? ['frame'] : [])], '$');
  if (!['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(spec.panelSpecVersion)) fail('version', '$.panelSpecVersion', 'only PanelSpec 0.1 through 0.14 are supported');
  if (styled) checkAppearance(spec.appearance, fail);
  identifier(spec.id, '$.id');
  text(spec.title, '$.title');
  reference(spec.theme, '$.theme');
  object(spec.canvas, ['width', 'height'], '$.canvas');
  for (const key of ['width', 'height']) integer(spec.canvas[key], `$.canvas.${key}`, 1, 4096);
  const layoutScalars = ['width', 'padding', 'gap', 'sectionGap', 'labelWidth', 'rowHeight', 'titleHeight', 'sectionTitleHeight'];
  object(spec.layout, [...layoutScalars, ...(containers ? ['maxHeight', 'overflow', 'body'] : [])], '$.layout');
  for (const key of layoutScalars) {
    integer(spec.layout[key], `$.layout.${key}`, ['padding', 'gap', 'sectionGap'].includes(key) ? 0 : 1, 4096);
  }
  if (containers) {
    integer(spec.layout.maxHeight, '$.layout.maxHeight', 1, 4096);
    if (!['error', 'scroll'].includes(spec.layout.overflow)) fail('layout-overflow', '$.layout.overflow', 'must be error or scroll');
  }
  if(sized){checkPanelFrame(spec.frame,fail);if(spec.frame&&(spec.layout.width!==spec.frame.width||spec.layout.maxHeight!==Math.ceil(spec.frame.height)))fail('panel-frame-layout','$.frame','frame must match layout width and height ceiling');}
  array(spec.state, '$.state', containers ? 0 : 1, 128);
  const states = new Map();
  spec.state.forEach((definition, index) => {
    const path = `$.state[${index}]`;
    if (!definition || !(forms ? ['number', 'boolean', 'enum', 'progress', 'string'] : progress ? ['number', 'boolean', 'enum', 'progress'] : controls ? ['number', 'boolean', 'enum'] : ['number', 'boolean']).includes(definition.type)) {
      fail('state-type', `${path}.type`, progress ? 'must be number, boolean, enum or progress' : controls ? 'must be number, boolean or enum' : 'must be number or boolean');
    }
    object(definition, ['id', 'type', 'initial', ...(definition.type === 'number' ? ['min', 'max', 'step'] : definition.type === 'progress' ? ['max'] : definition.type === 'enum' ? ['options'] : definition.type === 'string' ? ['maxLength'] : [])], path);
    if (definition.type === 'string') integer(definition.maxLength, `${path}.maxLength`, 1, 512);
    identifier(definition.id, `${path}.id`);
    if (states.has(definition.id)) fail('duplicate', `${path}.id`, 'state identifier must be unique');
    if (definition.type === 'number') {
      for (const key of ['min', 'max', 'step']) finite(definition[key], `${path}.${key}`);
      if (definition.min >= definition.max || !Number.isFinite(definition.max - definition.min)) fail('range', path, 'max must exceed min with a finite span');
      if (definition.step <= 0) fail('step', `${path}.step`, 'step must be positive');
      aligned(definition.max, definition, `${path}.max`);
    }
    if (definition.type === 'progress') {
      finite(definition.max, `${path}.max`);
      if (definition.max <= 0) fail('range', `${path}.max`, 'progress maximum must be positive');
    }
    if (definition.type === 'enum') {
      array(definition.options, `${path}.options`, 1, 8);
      const optionIds = new Set();
      definition.options.forEach((option, optionIndex) => {
        const optionPath = `${path}.options[${optionIndex}]`;
        object(option, ['id', 'label'], optionPath);
        identifier(option.id, `${optionPath}.id`);
        unique(option.id, optionIds, `${optionPath}.id`);
        text(option.label, `${optionPath}.label`);
      });
    }
    stateValue(definition.initial, definition, `${path}.initial`);
    states.set(definition.id, definition);
  });
  array(spec.sections, '$.sections', 1, 32);
  const sectionIds = new Set();
  const rowIds = new Set();
  const events = new Set();
  const bindings = new Set();
  spec.sections.forEach((section, sectionIndex) => {
    const sectionPath = `$.sections[${sectionIndex}]`;
    object(section, ['id', 'title', 'rows'], sectionPath);
    identifier(section.id, `${sectionPath}.id`);
    unique(section.id, sectionIds, `${sectionPath}.id`);
    text(section.title, `${sectionPath}.title`);
    array(section.rows, `${sectionPath}.rows`, 1, 128);
    section.rows.forEach((row, rowIndex) => {
      const path = `${sectionPath}.rows[${rowIndex}]`;
      const kinds = forms ? ['slider', 'switch', 'select', 'button', 'text', 'progress', 'input'] : progress ? ['slider', 'switch', 'select', 'button', 'text', 'progress'] : containers ? ['slider', 'switch', 'select', 'button', 'text'] : controls ? ['slider', 'switch', 'select', 'button'] : ['slider', 'switch'];
      if (!row || !kinds.includes(row.kind)) {
        fail('row-kind', `${path}.kind`, `must be ${kinds.join(', ')}`);
      }
      object(row, row.kind === 'progress' ? ['id', 'kind', 'recipe', 'label', 'bind', 'format'] : row.kind === 'text' ? ['id', 'kind', 'recipe', 'label', 'text']
        : ['id', 'kind', 'recipe', 'label', 'enabled', 'event', ...(row.kind === 'button' ? ['buttonLabel', 'action'] : ['bind']), ...(row.kind === 'slider' ? ['format'] : row.kind === 'input' ? ['placeholder', 'inputType', 'readOnly', 'validation'] : [])], path);
      identifier(row.id, `${path}.id`);
      unique(row.id, rowIds, `${path}.id`);
      if (rowIds.size > 128) fail('structure-limit', '$.sections', 'at most 128 rows are supported');
      if (!(containers && row.kind === 'button' && row.label === '')) text(row.label, `${path}.label`);
      if (row.kind === 'text') {
        if (wrapping && hasTextWrap(spec,row.id)) checkWrappedText(row.text,fail,`${path}.text`); else text(row.text, `${path}.text`);
        if (!hasTextWrap(spec,row.id) && /[\u2028\u2029]/u.test(row.text)) fail('text', `${path}.text`, 'must be a single line');
        reference(row.recipe, `${path}.recipe`);
        return;
      }
      if (row.kind !== 'progress') bool(row.enabled, `${path}.enabled`);
      if (row.kind === 'button') {
        text(row.buttonLabel, `${path}.buttonLabel`);
        if (!row.action || !(forms ? ['emit', 'reset-initial', 'submit'] : ['emit', 'reset-initial']).includes(row.action.kind)) fail('action-kind', `${path}.action.kind`, 'unsupported button action');
        object(row.action, row.action.kind === 'emit' ? ['kind'] : ['kind', 'fields'], `${path}.action`);
        if (['reset-initial', 'submit'].includes(row.action.kind)) {
          array(row.action.fields, `${path}.action.fields`, 1, 128);
          const actionFields = new Set();
          row.action.fields.forEach((field, fieldIndex) => {
            const fieldPath = `${path}.action.fields[${fieldIndex}]`;
            identifier(field, fieldPath);
            unique(field, actionFields, fieldPath);
            if (!states.has(field)) fail('action-field', fieldPath, 'reset field does not exist');
            if (row.action.kind === 'submit' && states.get(field).type !== 'string') fail('action-field', fieldPath, 'submit must reference input string fields');
          });
        }
      } else {
        identifier(row.bind, `${path}.bind`);
        const definition = states.get(row.bind);
        if (!definition) fail('binding', `${path}.bind`, 'state field does not exist');
        const expected = { slider: 'number', switch: 'boolean', select: 'enum', progress: 'progress', input: 'string' }[row.kind];
        if (definition.type !== expected) fail('binding-type', `${path}.bind`, 'state type does not match the row kind');
        unique(row.bind, bindings, `${path}.bind`);
      }
      if (row.kind !== 'progress') {
        identifier(row.event, `${path}.event`, true);
        unique(row.event, events, `${path}.event`);
      }
      reference(row.recipe, `${path}.recipe`);
      if (row.kind === 'slider') {
        object(row.format, ['fractionDigits', 'prefix', 'suffix'], `${path}.format`);
        integer(row.format.fractionDigits, `${path}.format.fractionDigits`, 0, 6);
        text(row.format.prefix, `${path}.format.prefix`, 32, true);
        text(row.format.suffix, `${path}.format.suffix`, 32, true);
      }
      if (row.kind === 'input') {
        text(row.placeholder, `${path}.placeholder`, 120, true);
        if (/[\u2028\u2029]/u.test(row.placeholder) || !['text', 'password'].includes(row.inputType)) fail('input-type', path, 'single-line text/password inputs only');
        bool(row.readOnly, `${path}.readOnly`);
        object(row.validation, ['required', 'minLength', 'requiredMessage', 'minLengthMessage'], `${path}.validation`);
        bool(row.validation.required, `${path}.validation.required`);
        integer(row.validation.minLength, `${path}.validation.minLength`, 0, states.get(row.bind).maxLength);
        for (const key of ['requiredMessage', 'minLengthMessage']) {
          text(row.validation[key], `${path}.validation.${key}`, 80);
          if (/[\u2028\u2029]/u.test(row.validation[key])) fail('text', path, 'validation messages must be single-line');
        }
      }
      if (row.kind === 'progress') {
        object(row.format, ['mode', 'fractionDigits'], `${path}.format`);
        if (!['percent', 'value'].includes(row.format.mode)) fail('progress-format', `${path}.format.mode`, 'must be percent or value');
        integer(row.format.fractionDigits, `${path}.format.fractionDigits`, 0, 6);
      }
    });
  });
  if (arranged) checkActionLayouts(spec, fail);
  if (individual) checkButtonStyles(spec, fail);
  if (typography) checkButtonFonts(spec, fail);
  if (titled) checkTitleBar(spec.titleBar, fail);
  if (wrapping) checkTextLayouts(spec,fail);
  if (containers) layoutBody(spec.layout.body, sectionIds);
  if (tabbed && spec.tabs !== null) {
    const tabs = spec.tabs, path = '$.tabs';
    object(tabs, ['id', 'recipe', 'bind', 'event', 'enabled', 'pages'], path);
    identifier(tabs.id, `${path}.id`); unique(tabs.id, rowIds, `${path}.id`);
    if (rowIds.size > 128) fail('structure-limit', path, 'at most 128 controls including navigation are supported');
    reference(tabs.recipe, `${path}.recipe`); bool(tabs.enabled, `${path}.enabled`);
    identifier(tabs.bind, `${path}.bind`); identifier(tabs.event, `${path}.event`, true);
    unique(tabs.bind, bindings, `${path}.bind`); unique(tabs.event, events, `${path}.event`);
    const field = states.get(tabs.bind);
    if (field?.type !== 'enum') fail('binding-type', `${path}.bind`, 'tabs must bind a distinct enum field');
    array(tabs.pages, `${path}.pages`, 2, 8);
    const pages = new Set(), covered = new Set();
    tabs.pages.forEach((page, index) => {
      const p = `${path}.pages[${index}]`;
      object(page, ['id', 'label', 'sections'], p); identifier(page.id, `${p}.id`);
      unique(page.id, pages, `${p}.id`); text(page.label, `${p}.label`);
      array(page.sections, `${p}.sections`, 1, 32);
      page.sections.forEach((id, i) => { identifier(id, `${p}.sections[${i}]`);
        if (!sectionIds.has(id)) fail('tabs-section', p, 'page section does not exist');
        unique(id, covered, `${p}.sections[${i}]`); });
      if (field.options[index]?.id !== page.id || field.options[index]?.label !== page.label) fail('tabs-options', p, 'enum options must exactly match ordered pages');
    });
    if (covered.size !== sectionIds.size || field.options.length !== tabs.pages.length) fail('tabs-coverage', path, 'every section must belong to exactly one declared page');
  }
  for (const id of states.keys()) if (!bindings.has(id)) fail('unused-state', '$.state', `state field ${id} is not bound to a row`);
  if (hasAssetsField && !(controls && spec.assets === null)) panelAssets(spec.assets, rowIds);
  object(spec.provenance, ['kind', 'description', 'assumptions'], '$.provenance');
  if (!['programmatic-fixture', 'user-authored', 'agent-authored'].includes(spec.provenance.kind)) fail('provenance', '$.provenance.kind', 'must identify a fixture, user-authored, or agent-authored source');
  text(spec.provenance.description, '$.provenance.description', 1000);
  array(spec.provenance.assumptions, '$.provenance.assumptions', 0, 32);
  spec.provenance.assumptions.forEach((item, index) => text(item, `$.provenance.assumptions[${index}]`, 500));
  return spec;
}

/** Validate a complete state snapshot; partial updates and implicit defaults are rejected. */
export function validatePanelState(inputSpec, inputState) {
  const spec = validatePanelSpec(inputSpec);
  const values = snapshotJson(inputState);
  object(values, spec.state.map(definition => definition.id), '$.state');
  for (const definition of spec.state) stateValue(values[definition.id], definition, `$.state.${definition.id}`);
  return values;
}
