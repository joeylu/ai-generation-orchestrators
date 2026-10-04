import { validatePanelSpec, validatePanelState } from './spec.mjs';
import { controlId, choiceId, initialPanelState } from './compiler.mjs';
import { progressDisplayValue, progressDisplayMax } from './progress.mjs';

const userSources = new Set(['mouse', 'touch', 'pen', 'keyboard']);
const rowsOf = spec => spec.sections.flatMap(section => section.rows);
const runtimeTypes = { slider: 'Slider', switch: 'Switch', select: 'Select', button: 'Button', progress: 'ProgressBar' };

function semanticChoice(spec, row, field, value, error = 'PANEL_CHOICE_VALUE') {
  const option = field.options.find(option => choiceId(spec.id, row.id, option.id) === value);
  if (!option) throw new Error(error);
  return option.id;
}

/** Project committed component changes, without interpreting labels or invoking game APIs. */
export function projectPanelEvent(specInput, stateInput, input) {
  const spec = validatePanelSpec(specInput), state = validatePanelState(spec, stateInput);
  if (!input || !['change', 'activate'].includes(input.type)) return { state, event: null };
  const row = rowsOf(spec).find(row => controlId(spec.id, row.id) === input.id);
  if (!row || ['text', 'progress'].includes(row.kind)) return { state, event: null };
  if (input.type !== (row.kind === 'button' ? 'activate' : 'change')) return { state, event: null };
  if (!userSources.has(input.source) && input.source !== 'control') throw new Error('PANEL_EVENT_SOURCE');
  if (userSources.has(input.source) && !row.enabled) return { state, event: null };
  if (row.kind === 'button') {
    if (input.source === 'control') return { state, event: null };
    const nextValues = { ...state };
    if (row.action.kind === 'reset-initial') {
      const fields = new Map(spec.state.map(field => [field.id, field]));
      for (const fieldId of row.action.fields) nextValues[fieldId] = fields.get(fieldId).initial;
    }
    const next = validatePanelState(spec, nextValues);
    return { state: next, event: {
      name: row.event, rowId: row.id, action: row.action.kind,
      state: structuredClone(next), source: input.source,
    } };
  }
  const field = spec.state.find(field => field.id === row.bind);
  const value = row.kind === 'select' ? semanticChoice(spec, row, field, input.value) : input.value;
  const next = validatePanelState(spec, { ...state, [row.bind]: value });
  const changed = state[row.bind] !== next[row.bind];
  return {
    state: next,
    event: changed && userSources.has(input.source)
      ? { name: row.event, fieldId: row.bind, value: next[row.bind], source: input.source }
      : null,
  };
}

/** Attach to an already-loaded TreePreview. The caller retains renderer ownership. */
export function attachPanelSession(specInput, runtime, onEvent, stateInput) {
  const spec = validatePanelSpec(specInput);
  if (typeof runtime?.getDocument !== 'function' || typeof runtime?.subscribe !== 'function'
    || typeof runtime?.setValue !== 'function' || typeof onEvent !== 'function') throw new Error('PANEL_RUNTIME_REQUIRED');
  const rows = rowsOf(spec), boundRows = rows.filter(row => Object.hasOwn(row, 'bind'));
  const fieldMap = new Map(spec.state.map(field => [field.id, field]));
  const suppliedState = stateInput === undefined ? null : validatePanelState(spec, stateInput);
  const document = runtime.getDocument();
  if (document?.id !== spec.id || document.schemaVersion !== '0.2') throw new Error('PANEL_RUNTIME_MISMATCH');
  const nodes = new Map();
  const visit = node => { nodes.set(node.id, node); for (const child of node.children ?? []) visit(child); };
  visit(document.root);
  const hydrated = {};
  for (const row of rows) {
    const node = nodes.get(controlId(spec.id, row.id)), field = fieldMap.get(row.bind);
    if (row.kind === 'text') {
      if (!node || node.type !== 'Text' || node.props.text !== row.text) throw new Error('PANEL_RUNTIME_MISMATCH');
      continue;
    }
    if (!node || node.type !== runtimeTypes[row.kind] || node.props?.enabled !== row.enabled) throw new Error('PANEL_RUNTIME_MISMATCH');
    if (row.kind === 'progress') {
      if (node.props.max !== progressDisplayMax(row, field)) throw new Error('PANEL_RUNTIME_MISMATCH');
      // Percent painting is scaled. Exact host values come from the verified bundle,
      // so hydration never introduces a floating-point round-trip into semantic state.
      if (!suppliedState) throw new Error('PANEL_PROGRESS_STATE_REQUIRED');
      if (node.props.value !== progressDisplayValue(row, field, suppliedState[row.bind])) throw new Error('PANEL_RUNTIME_MISMATCH');
      hydrated[row.bind] = suppliedState[row.bind];
      continue;
    }
    if (row.kind === 'button') {
      if (node.props.label !== row.buttonLabel) throw new Error('PANEL_RUNTIME_MISMATCH');
      continue;
    }
    if (row.kind === 'slider' && ['min', 'max', 'step'].some(key => node.props[key] !== field[key])) throw new Error('PANEL_RUNTIME_MISMATCH');
    if (row.kind === 'select') {
      if (!Array.isArray(node.props.options) || node.props.options.length !== field.options.length
        || node.props.options.some((option, index) => option?.id !== choiceId(spec.id, row.id, field.options[index].id)
          || option.label !== field.options[index].label)) throw new Error('PANEL_RUNTIME_MISMATCH');
      hydrated[row.bind] = semanticChoice(spec, row, field, node.props.selectedId, 'PANEL_RUNTIME_MISMATCH');
    } else hydrated[row.bind] = node.props[row.kind === 'slider' ? 'value' : 'checked'];
  }
  let state = validatePanelState(spec, hydrated), alive = true, updating = false;
  const guard = () => { if (!alive) throw new Error('PANEL_SESSION_DESTROYED'); };
  let unsubscribe = () => {};
  const destroy = () => {
    if (alive) {
      alive = false;
      const detach = unsubscribe; unsubscribe = () => {};
      detach();
    }
  };
  const applyState = input => {
    guard();
    if (updating) throw new Error('PANEL_SESSION_UPDATING');
    const next = validatePanelState(spec, input);
    updating = true;
    try {
      for (const row of boundRows) if (state[row.bind] !== next[row.bind]) {
        const value = row.kind === 'progress' ? progressDisplayValue(row, fieldMap.get(row.bind), next[row.bind])
          : row.kind === 'select' ? choiceId(spec.id, row.id, next[row.bind]) : next[row.bind];
        runtime.setValue(controlId(spec.id, row.id), value);
        guard();
      }
      state = next;
    } catch (error) {
      // A renderer can reject after earlier fields were written. Never report
      // an action success or retain a session with partially applied state.
      try { destroy(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'PANEL_SESSION_WRITE_AND_CLEANUP_FAILED'); }
      throw error;
    } finally { updating = false; }
  };
  const detach = runtime.subscribe(input => {
    if (!alive) return;
    if (input?.type === 'destroy') { destroy(); return; }
    if (updating) return;
    const projected = projectPanelEvent(spec, state, input);
    if (projected.event?.action === 'reset-initial') applyState(projected.state);
    else state = projected.state;
    if (projected.event) onEvent(projected.event);
  });
  if (typeof detach !== 'function') { alive = false; throw new Error('PANEL_RUNTIME_REQUIRED'); }
  unsubscribe = detach;
  // Guard a runtime which synchronously destroys itself while subscribing.
  if (!alive) { unsubscribe = () => {}; detach(); }
  return Object.freeze({
    getState() { guard(); return structuredClone(state); },
    setState: applyState,
    setProgress(fieldId, value) {
      guard();
      if (fieldMap.get(fieldId)?.type !== 'progress') throw new Error('PANEL_PROGRESS_FIELD');
      applyState({ ...state, [fieldId]: value });
    },
    destroy,
  });
}

export { initialPanelState };
