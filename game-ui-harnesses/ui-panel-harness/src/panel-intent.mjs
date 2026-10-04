/** Typed natural-language intent. Programs own geometry/bindings; Agents own explicit business facts. */
import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { validatePlanningContext } from './planning-context.mjs';
import { validatePanelProposal, PanelPlanningError } from './proposal.mjs';
import { measureFlowLayout } from './flow-layout.mjs';
import { progressValueWidth } from './progress.mjs';

const kinds = ['slider', 'switch', 'select', 'button', 'text', 'progress'];
const common = ['id', 'kind', 'label', 'recipeKey', 'sourceQuote', 'icon'];
const rowKeys = { slider: [...common, 'enabled', 'min', 'max', 'step', 'initial', 'prefix', 'suffix'],
  switch: [...common, 'enabled', 'initial'], select: [...common, 'enabled', 'options', 'initialLabel'],
  button: [...common, 'enabled', 'action', 'resetRows'], text: [...common, 'text'],
  progress: [...common, 'max', 'initial', 'display', 'fractionDigits'] };
const fail = (code, path) => { throw new PanelPlanningError(code, path, 'Intent must preserve explicit facts and exact request evidence'); };
const exact = (value, keys, path) => {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('INTENT_FIELDS', path);
};
const bounded = (list, min, max, path) => { if (!Array.isArray(list) || list.length < min || list.length > max) fail('INTENT_COUNT', path); };
const design = reason => ({ kind: 'design-choice', reason });
const refKey = ref => `${ref.id}@${ref.version}`;
const str = { type: 'string' }, bool = { type: 'boolean' }, num = { type: 'number' };
const objectSchema = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const arraySchema = items => ({ type: 'array', items });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });

/** Direct native JSON schema: no encoded JSON string, parallel evidence lists or invented readiness. */
export function buildPanelIntentResponseSchema(context) {
  const rowIds = Array.from({ length: 128 }, (_, i) => `row${i}`), sectionIds = Array.from({ length: 32 }, (_, i) => `section${i}`);
  const recipes = kind => context.catalog.recipes.filter(recipe => recipe.kind === `${kind}-row`).map(refKey);
  const slots = slot => context.assetRetrieval?.candidates.filter(candidate => candidate.slot === slot).map(candidate => candidate.asset.key) ?? [];
  const asset = slot => ({ type: ['string', 'null'], enum: [null, ...slots(slot)] });
  const rows = kinds.filter(kind => recipes(kind).length).map(kind => objectSchema({ kind: { type: 'string', enum: [kind] },
    id: { type: 'string', enum: rowIds }, label: str, recipeKey: { type: 'string', enum: recipes(kind) }, sourceQuote: str,
    icon: asset('row-icon'), ...(kind === 'text' ? { text: str } : kind === 'progress' ? {} : { enabled: bool }),
    ...(kind === 'progress' ? { max: num, initial: num, display: { type: 'string', enum: ['percent', 'value'] }, fractionDigits: { type: 'integer', minimum: 0, maximum: 6 } } : {}),
    ...(kind === 'slider' ? { min: num, max: num, step: num, initial: num, prefix: str, suffix: str } : {}),
    ...(kind === 'switch' ? { initial: bool } : {}),
    ...(kind === 'select' ? { options: arraySchema(objectSchema({ label: str, initial: bool })) } : {}),
    ...(kind === 'button' ? { action: { type: 'string', enum: ['emit', 'reset-initial'] }, resetRows: arraySchema({ type: 'string', enum: rowIds }) } : {}) }));
  const dimensions = nullable({ type: 'integer' });
  const layout = objectSchema({ width: dimensions, canvasWidth: dimensions, canvasHeight: dimensions, maxHeight: dimensions,
    overflow: { type: 'string', enum: ['auto', 'scroll', 'error'] } });
  return { ...objectSchema({ panelIntentVersion: { type: 'string', enum: [context.planningContextVersion === '0.5' ? '0.4' : '0.3'] },
    contextSha256: { type: 'string', enum: [context.sha256] },
    panel: nullable(objectSchema({ id: { type: 'string', enum: [context.request.id] }, title: str,
      themeKey: { type: 'string', enum: context.catalog.themes.map(refKey) }, panelSurface: asset('panel-surface'),
      layout, body: { $ref: '#/$defs/container' } })),
    unresolved: arraySchema(objectSchema({ id: str, question: str })) }),
    $defs: { body: { anyOf: [objectSchema({ kind: { type: 'string', enum: ['section'] }, id: { type: 'string', enum: sectionIds }, title: str, rows: arraySchema({ anyOf: rows }) }),
      { $ref: '#/$defs/container' }] }, container: objectSchema({ kind: { type: 'string', enum: ['column', 'row', 'grid'] }, children: arraySchema({ $ref: '#/$defs/body' }) }) } };
}

/** Exact unique quotes become UTF-16 spans deterministically. Ambiguity is rejected, never guessed. */
function quoteBasis(request, quote, path, fallback) {
  if (quote === null && fallback) return design(fallback);
  if (typeof quote !== 'string' || !quote.trim()) fail('INTENT_QUOTE', path);
  const start = request.indexOf(quote);
  if (start < 0 || request.indexOf(quote, start + 1) >= 0) fail('INTENT_QUOTE', path);
  return { kind: 'request-interpretation', start, end: start + quote.length, quote };
}
function identity(value, path) {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z][A-Za-z0-9_-]*$(?![\s\S])/.test(value)) fail('identifier', path);
}
function display(value, path, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || [...value].length > 120 || /[\p{Cc}\p{Cs}]/u.test(value)) fail('text', path);
}
export const conservativeTextWidth = (text, size) => Math.ceil([...text].reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? size * 0.8 : size * 1.1), 0));
function digits(value) {
  for (let i = 0; i <= 6; i++) if (Number(value.toFixed(i)) === value) return i;
  fail('INTENT_PRECISION', '$.panel.sections.rows');
}

/** Shared measured layout policy, also usable by the explicit composition tool. */
export function arrangeIntentSpec(spec, settings, theme) {
  exact(settings, ['width', 'canvasWidth', 'canvasHeight', 'maxHeight', 'overflow', 'body', 'sourceQuote'], '$.panel.layout');
  for (const key of ['width', 'canvasWidth', 'canvasHeight', 'maxHeight']) if (settings[key] !== null && (!Number.isInteger(settings[key]) || settings[key] < 1 || settings[key] > 4096)) fail('integer', `$.panel.layout.${key}`);
  if (!['auto', 'scroll', 'error'].includes(settings.overflow)) fail('INTENT_FIELDS', '$.panel.layout.overflow');
  const rows = spec.sections.flatMap(section => section.rows), size = theme.tokens.fontSize;
  const labelWidth = Math.max(112, ...rows.filter(row => row.kind !== 'button').map(row => conservativeTextWidth(row.label, size) + (spec.assets?.rowIcons.some(icon => icon.rowId === row.id) ? 40 : 0)));
  const fields = new Map(spec.state.map(field => [field.id, field]));
  const minWidth = Math.max(320, ...rows.map(row => {
    const content = row.kind === 'slider' ? 96 + Math.max(64, size * 4) + 12
      : row.kind === 'progress' ? 96 + progressValueWidth(row, fields.get(row.bind), size) + 12
      : row.kind === 'select' ? Math.max(120, ...fields.get(row.bind).options.map(option => conservativeTextWidth(option.label, size) + 56))
      : row.kind === 'text' ? conservativeTextWidth(row.text, size) + 8 : row.kind === 'switch' ? 76 : Math.max(120, conservativeTextWidth(row.buttonLabel, size) + 32);
    return (row.kind === 'button' ? 24 : labelWidth + 36) + content;
  }));
  let counter = 0, count = 0;
  const convert = (node, depth = 1) => {
    if (++count > 96 || depth > 8) fail('layout-structure', '$.panel.layout.body');
    if (node?.kind === 'section') { exact(node, ['kind', 'sectionId'], '$.panel.layout.body'); return { kind: 'section', sectionId: node.sectionId, width: 'fill' }; }
    exact(node, ['kind', 'children'], '$.panel.layout.body');
    if (!['column', 'row', 'grid'].includes(node.kind)) fail('layout-kind', '$.panel.layout.body');
    bounded(node.children, 1, 96, '$.panel.layout.body.children');
    return { id: `flow${counter++}`, kind: node.kind, width: 'fill', gap: 20, align: 'start',
      ...(node.kind === 'grid' ? { minColumnWidth: minWidth } : {}), children: node.children.map(child => convert(child, depth + 1)) };
  };
  const body = convert(settings.body ?? { kind: 'column', children: spec.sections.map(section => ({ kind: 'section', sectionId: section.id })) });
  const requiredWidth = node => node.kind === 'section' ? minWidth
    : node.kind === 'column' ? Math.max(...node.children.map(requiredWidth))
    : node.kind === 'grid' ? 2 * Math.max(...node.children.map(requiredWidth)) + 20
    : node.children.reduce((sum, child) => sum + requiredWidth(child), 20 * (node.children.length - 1));
  const width = settings.width ?? Math.max(640, requiredWidth(body) + 64);
  const maxHeight = settings.maxHeight ?? 560;
  const popup = Math.max(0, ...spec.state.filter(field => field.type === 'enum').map(field => field.options.length * 40 + 2));
  spec.canvas = { width: settings.canvasWidth ?? Math.min(4096, width + 64), height: settings.canvasHeight ?? Math.max(640, maxHeight + popup * 2 + 96) };
  spec.layout = { width, padding: 24, gap: 12, sectionGap: 20, labelWidth, rowHeight: Math.max(56, Math.ceil(size * 1.3) + 16),
    titleHeight: Math.max(48, Math.ceil(theme.tokens.titleSize * 1.3)), sectionTitleHeight: Math.max(32, Math.ceil(theme.tokens.headingSize * 1.3)),
    maxHeight, overflow: settings.overflow === 'auto' ? 'scroll' : settings.overflow, body };
  // Full contract/geometry gate; explicit narrow dimensions fail rather than changing business or requested layout.
  const checked = validatePanelSpec(spec); measureFlowLayout(checked); return checked;
}

export async function materializePanelIntent(contextInput, input) {
  return materializeIntent(contextInput, input, false);
}
async function materializeIntent(contextInput, input, progressTransport) {
  const context = await validatePlanningContext(contextInput), intent = snapshotJson(input);
  exact(intent, ['panelIntentVersion', 'contextSha256', 'panel', 'unresolved'], '$');
  if (!['0.1', '0.2', '0.3', '0.4'].includes(intent.panelIntentVersion)) fail('INTENT_VERSION', '$.panelIntentVersion');
  if (intent.panelIntentVersion === '0.4' && context.planningContextVersion !== '0.5') fail('INTENT_VERSION', '$.panelIntentVersion');
  progressTransport ||= intent.panelIntentVersion === '0.4';
  if (intent.contextSha256 !== context.sha256) fail('PLAN_CONTEXT_MISMATCH', '$.contextSha256');
  const proposal = { proposalVersion: context.planningContextVersion, contextSha256: intent.contextSha256, spec: null, decisions: [], unresolved: intent.unresolved };
  if (intent.panel === null) return validatePanelProposal(context, proposal);
  if (['0.3', '0.4'].includes(intent.panelIntentVersion)) {
    const panel = intent.panel;
    exact(panel, ['id', 'title', 'themeKey', 'panelSurface', 'layout', 'body'], '$.panel');
    exact(panel.layout, ['width', 'canvasWidth', 'canvasHeight', 'maxHeight', 'overflow'], '$.panel.layout');
    if (!['column', 'row', 'grid'].includes(panel.body?.kind)) fail('layout-kind', '$.panel.body');
    let nodes = 0;
    const attach = (node, depth = 1) => {
      if (++nodes > 96 || depth > 8) fail('layout-structure', '$.panel.body');
      if (node?.kind === 'section') { exact(node, ['kind', 'id', 'title', 'rows'], '$.panel.body'); return { ...node, sourceQuote: null }; }
      exact(node, ['kind', 'children'], '$.panel.body');
      if (!['column', 'row', 'grid'].includes(node.kind)) fail('layout-kind', '$.panel.body');
      bounded(node.children, 1, 96, '$.panel.body.children');
      return { ...node, children: node.children.map(child => attach(child, depth + 1)) };
    };
    return materializeIntent(context, { ...intent, panelIntentVersion: '0.2', panel: { ...panel, sourceQuote: null,
      layout: { ...panel.layout, sourceQuote: null }, body: attach(panel.body) } }, progressTransport);
  }
  if (intent.panelIntentVersion === '0.2') {
    const panel = intent.panel;
    exact(panel, ['id', 'title', 'sourceQuote', 'themeKey', 'panelSurface', 'layout', 'body'], '$.panel');
    exact(panel.layout, ['width', 'canvasWidth', 'canvasHeight', 'maxHeight', 'overflow', 'sourceQuote'], '$.panel.layout');
    const sections = []; let nodes = 0;
    const convert = (node, depth = 1) => {
      if (++nodes > 96 || depth > 8) fail('layout-structure', '$.panel.body');
      if (node?.kind === 'section') {
        exact(node, ['kind', 'id', 'title', 'sourceQuote', 'rows'], '$.panel.body');
        const { kind, ...section } = node;
        bounded(section.rows, 1, 128, '$.panel.body.rows');
        section.rows = section.rows.map(row => {
          if (row?.kind !== 'select') return row;
          exact(row, [...common, 'enabled', 'options'], '$.panel.body.rows');
          bounded(row.options, 1, 8, '$.panel.body.rows.options');
          for (const option of row.options) { exact(option, ['label', 'initial'], '$.panel.body.rows.options');
            if (typeof option.initial !== 'boolean') fail('boolean', '$.panel.body.rows.options.initial'); }
          const selected = row.options.filter(option => option.initial);
          if (selected.length !== 1) fail('INTENT_DEFAULT', '$.panel.body.rows.options');
          return { ...row, options: row.options.map(option => option.label), initialLabel: selected[0].label };
        });
        sections.push(section);
        return { kind: 'section', sectionId: section.id };
      }
      exact(node, ['kind', 'children'], '$.panel.body');
      if (!['column', 'row', 'grid'].includes(node.kind)) fail('layout-kind', '$.panel.body');
      bounded(node.children, 1, 96, '$.panel.body.children');
      return { kind: node.kind, children: node.children.map(child => convert(child, depth + 1)) };
    };
    const body = convert(panel.body), { body: sourceBody, ...rest } = panel;
    // Spec references are generated from embedded leaves, never authored in a parallel collection.
    return materializeIntent(context, { ...intent, panelIntentVersion: '0.1', panel: { ...rest, sections, layout: { ...panel.layout, body } } }, progressTransport);
  }
  if (!['0.4', '0.5'].includes(context.planningContextVersion)) fail('PLAN_SPEC_CONTEXT_VERSION', '$.panel');
  const panel = intent.panel;
  exact(panel, ['id', 'title', 'sourceQuote', 'themeKey', 'panelSurface', 'layout', 'sections'], '$.panel');
  identity(panel.id, '$.panel.id'); display(panel.title, '$.panel.title');
  const theme = context.catalog.themes.find(theme => refKey(theme) === panel.themeKey);
  if (!theme) fail('INTENT_REFERENCE', '$.panel.themeKey');
  const state = [], rowsById = new Map(), decisions = [], rowIcons = [];
  const basis = (quote, path, reason) => quoteBasis(context.request.text, quote, path, reason);
  bounded(panel.sections, 1, 32, '$.panel.sections');
  const sections = panel.sections.map((section, i) => {
    const path = `$.panel.sections[${i}]`; exact(section, ['id', 'title', 'sourceQuote', 'rows'], path);
    identity(section.id, `${path}.id`); display(section.title, `${path}.title`); bounded(section.rows, 1, 128, `${path}.rows`);
    decisions.push({ target: `section:${section.id}`, basis: basis(section.sourceQuote, `${path}.sourceQuote`, 'Grouping is a presentation choice; no business defaults are inferred.') });
    const rows = section.rows.map((inputRow, j) => {
      const p = `${path}.rows[${j}]`, r = inputRow; if (!kinds.includes(r?.kind)) fail('row-kind', `${p}.kind`);
      exact(r, rowKeys[r.kind], p); identity(r.id, `${p}.id`); display(r.label, `${p}.label`);
      if (rowsById.has(r.id) || rowsById.size >= 128) fail('duplicate', `${p}.id`);
      const recipe = context.catalog.recipes.find(recipe => recipe.kind === `${r.kind}-row` && refKey(recipe) === r.recipeKey);
      if (!recipe) fail('INTENT_REFERENCE', `${p}.recipeKey`);
      const source = basis(r.sourceQuote, `${p}.sourceQuote`), row = { id: r.id, kind: r.kind, recipe: { id: recipe.id, version: recipe.version }, label: r.kind === 'button' ? '' : r.label };
      decisions.push({ target: `row:${r.id}`, basis: source });
      if (r.kind === 'text') { display(r.text, `${p}.text`); row.text = r.text; }
      else if (r.kind === 'progress') {
        if (!progressTransport) fail('INTENT_VERSION', `${p}.kind`);
        row.bind = r.id; row.format = { mode: r.display, fractionDigits: r.fractionDigits };
        state.push({ id: r.id, type: 'progress', initial: r.initial, max: r.max });
        decisions.push({ target: `state:${r.id}`, basis: source });
      }
      else {
        if (typeof r.enabled !== 'boolean') fail('boolean', `${p}.enabled`);
        Object.assign(row, { enabled: r.enabled, event: `panel.${r.id}` });
        if (r.kind === 'button') {
          if (!['emit', 'reset-initial'].includes(r.action)) fail('action-kind', `${p}.action`);
          bounded(r.resetRows, r.action === 'emit' ? 0 : 1, 128, `${p}.resetRows`);
          if (r.action === 'emit' && r.resetRows.length) fail('action-field', `${p}.resetRows`);
          row.buttonLabel = r.label; row.action = r.action === 'emit' ? { kind: 'emit' } : { kind: 'reset-initial', fields: r.resetRows };
        } else {
          row.bind = r.id; let field;
          if (r.kind === 'slider') {
            for (const key of ['min', 'max', 'step', 'initial']) if (typeof r[key] !== 'number' || !Number.isFinite(r[key])) fail('number', `${p}.${key}`);
            display(r.prefix, `${p}.prefix`, true); display(r.suffix, `${p}.suffix`, true);
            field = { id: r.id, type: 'number', initial: r.initial, min: r.min, max: r.max, step: r.step };
            row.format = { fractionDigits: Math.max(...[r.min, r.max, r.step, r.initial].map(digits)), prefix: r.prefix, suffix: r.suffix };
          } else if (r.kind === 'switch') field = { id: r.id, type: 'boolean', initial: r.initial };
          else {
            bounded(r.options, 1, 8, `${p}.options`); r.options.forEach((option, k) => display(option, `${p}.options[${k}]`));
            if (new Set(r.options).size !== r.options.length || !r.options.includes(r.initialLabel)) fail('enum-value', `${p}.initialLabel`);
            field = { id: r.id, type: 'enum', initial: `option${r.options.indexOf(r.initialLabel)}`, options: r.options.map((label, k) => ({ id: `option${k}`, label })) };
          }
          state.push(field); decisions.push({ target: `state:${r.id}`, basis: source });
        }
      }
      rowsById.set(r.id, row);
      if (r.icon !== null) rowIcons.push({ rowId: r.id, asset: r.icon });
      return row;
    });
    return { id: section.id, title: section.title, rows };
  });
  const assets = panel.panelSurface === null && !rowIcons.length ? null : { library: context.assetRetrieval?.library,
    panelSurface: panel.panelSurface, rowIcons };
  let spec = { panelSpecVersion: context.planningContextVersion === '0.5' ? '0.5' : '0.4', id: panel.id, title: panel.title, theme: { id: theme.id, version: theme.version },
    state, sections, assets, provenance: { kind: 'agent-authored', description: 'Agent-interpreted explicit business facts; deterministic intent adapter supplies typed bindings and measured layout.',
      assumptions: ['Preview actions notify the host; no actual game business is executed.', 'Geometry follows deterministic intent layout policy 0.1.',
        ...(state.some(field => field.type === 'progress') ? ['Determinate progress is host-owned and read-only. Unspecified presentation defaults are max 100, initial 0, percent display with 0 fraction digits; explicit request values take precedence.'] : [])] } };
  spec = arrangeIntentSpec(spec, panel.layout, theme);
  const top = [ { target: 'panel', basis: basis(panel.sourceQuote, '$.panel.sourceQuote', 'Panel title and identity are presentation choices.') },
    { target: 'theme', basis: design('Selected exact theme from the pinned complete catalog.') },
    { target: 'canvas', basis: design('Logical canvas reserves bounded control and popup geometry under intent layout policy 0.1.') },
    { target: 'layout', basis: basis(panel.layout.sourceQuote, '$.panel.layout.sourceQuote', 'Deterministic measured section layout; explicit dimensions are preserved.') } ];
  if (assets) {
    top.push({ target: 'assets', basis: design('Selected exact assets from the pinned planning candidates.') });
    if (assets.panelSurface) top.push({ target: 'asset:surface', basis: design('Pinned surface candidate selected for panel appearance.') });
    for (const icon of rowIcons) top.push({ target: `asset:row:${icon.rowId}`, basis: design('Pinned row icon candidate selected for appearance.') });
  }
  proposal.spec = spec; proposal.decisions = [...top, ...decisions];
  return validatePanelProposal(context, proposal);
}
