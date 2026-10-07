import { hasTextWrap,wrapStaticText,wrappedLinePresentation } from './text-wrap.mjs';
import { validatePanelSpec, validatePanelState } from './spec.mjs';
import { controlId, choiceId, initialPanelState } from './compiler.mjs';
import { navigationRows, tabPageId } from './tabs.mjs';
import { progressDisplayValue, progressDisplayMax } from './progress.mjs';
import { formErrorId, inputError, formErrors, buttonEnabled } from './forms.mjs';

const userSources = new Set(['mouse', 'touch', 'pen', 'keyboard']);
const rowsOf = spec => [...spec.sections.flatMap(section => section.rows), ...navigationRows(spec)];
const runtimeTypes = { slider: 'Slider', switch: 'Switch', select: 'Select', button: 'Button', tabs: 'Tabs', progress: 'ProgressBar', input: 'Input' };

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
  if (userSources.has(input.source) && spec.tabs && row.kind !== 'tabs') {
    const section = spec.sections.find(section => section.rows.some(item => item.id === row.id));
    const page = spec.tabs.pages.find(page => page.sections.includes(section.id));
    if (page.id !== state[spec.tabs.bind]) return { state, event: null };
  }
  if (row.kind === 'input' && row.readOnly && userSources.has(input.source)) return { state, event: null };
  if (row.kind === 'button') {
    if (input.source === 'control') return { state, event: null };
    if (row.action.kind === 'submit' && !buttonEnabled(spec, row, state)) return { state, event: null };
    const nextValues = { ...state };
    if (row.action.kind === 'reset-initial') {
      const fields = new Map(spec.state.map(field => [field.id, field]));
      for (const fieldId of row.action.fields) nextValues[fieldId] = fields.get(fieldId).initial;
    }
    const next = validatePanelState(spec, nextValues);
    return { state: next, event: {
      name: row.event, rowId: row.id, action: row.action.kind,
      state: structuredClone(next), source: input.source,
      ...(row.action.kind === 'submit' ? { values: Object.fromEntries(row.action.fields.map(id => [id, next[id]])) } : {}),
    } };
  }
  const field = spec.state.find(field => field.id === row.bind);
  const value = ['select', 'tabs'].includes(row.kind) ? semanticChoice(spec, row, field, input.value) : input.value;
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
  const inputRows = rows.filter(row => row.kind === 'input');
  if (inputRows.length && (!suppliedState || typeof runtime.setVisible !== 'function' || typeof runtime.setEnabled !== 'function')) throw new Error('PANEL_INPUT_RUNTIME_REQUIRED');
  const document = runtime.getDocument();
  if (document?.id !== spec.id || document.schemaVersion !== '0.2') throw new Error('PANEL_RUNTIME_MISMATCH');
  const nodes = new Map();
  const visit = node => { nodes.set(node.id, node); for (const child of node.children ?? []) visit(child); };
  visit(document.root);
  const hydrated = {};
  for (const row of rows) {
    const node = nodes.get(controlId(spec.id, row.id)), field = fieldMap.get(row.bind);
    if (row.kind === 'text') {
      if (!node || node.type !== 'Text') throw new Error('PANEL_RUNTIME_MISMATCH');
      if (hasTextWrap(spec,row.id)) {
        const container=nodes.get(`${spec.id}.row.${row.id}`),fontSize=node.props.style.fontSize;
        if(container?.type!=='Container')throw new Error('PANEL_RUNTIME_MISMATCH');
        const width=container.layout.width-24,expected=wrapStaticText(row.text,width,fontSize);
        if(expected.lines.some((line,i)=>{
          const child=nodes.get(i===0?node.id:node.id+'.line'+i),display=wrappedLinePresentation(line,fontSize);
          return child?.type!=='Text'||child.props.text!==display.text||child.layout.width!==width-display.indent
            ||child.layout.x!==12+display.indent||child.layout.y!==12+Math.ceil(fontSize*1.3)+8+i*expected.lineHeight
            ||child.layout.height!==expected.lineHeight+4||child.props.style.fontSize!==fontSize;
        }) || nodes.has(node.id+'.line'+expected.lines.length))throw new Error('PANEL_RUNTIME_MISMATCH');
      } else if(node.props.text!==row.text)throw new Error('PANEL_RUNTIME_MISMATCH');
      continue;
    }
    const expectedEnabled = row.kind === 'button' && row.action.kind === 'submit' ? buttonEnabled(spec, row, suppliedState) : row.enabled;
    if (!node || node.type !== runtimeTypes[row.kind] || node.props?.enabled !== expectedEnabled) throw new Error('PANEL_RUNTIME_MISMATCH');
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
    if (row.kind === 'input' && (node.props.maxLength !== field.maxLength || ['placeholder', 'inputType', 'readOnly'].some(key => node.props[key] !== row[key]))) throw new Error('PANEL_RUNTIME_MISMATCH');
    if (row.kind === 'tabs') {
      if (!Array.isArray(node.props.tabs) || node.props.tabs.length !== field.options.length || node.props.tabs.some((option, i) => option.id !== choiceId(spec.id, row.id, field.options[i].id) || option.label !== field.options[i].label || option.contentId !== tabPageId(spec.id, field.options[i].id))) throw new Error('PANEL_RUNTIME_MISMATCH');
      hydrated[row.bind] = semanticChoice(spec, row, field, node.props.activeId, 'PANEL_RUNTIME_MISMATCH');
    } else if (row.kind === 'select') {
      if (!Array.isArray(node.props.options) || node.props.options.length !== field.options.length
        || node.props.options.some((option, index) => option?.id !== choiceId(spec.id, row.id, field.options[index].id)
          || option.label !== field.options[index].label)) throw new Error('PANEL_RUNTIME_MISMATCH');
      hydrated[row.bind] = semanticChoice(spec, row, field, node.props.selectedId, 'PANEL_RUNTIME_MISMATCH');
    } else hydrated[row.bind] = node.props[['slider', 'input'].includes(row.kind) ? 'value' : 'checked'];
  }
  let state = validatePanelState(spec, hydrated), alive = true, updating = false, interactionLocked = false;
  const updateFormViews = () => {
    for (const row of inputRows) {
      const code = inputError(row, state[row.bind]);
      for (const key of ['required', 'min-length']) runtime.setVisible(formErrorId(spec.id, row.id, key), code === key);
    }
    for (const row of rows.filter(row => row.kind === 'button' && row.action.kind === 'submit'))
      runtime.setEnabled(controlId(spec.id, row.id), !interactionLocked && buttonEnabled(spec, row, state));
  };
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
          : ['select', 'tabs'].includes(row.kind) ? choiceId(spec.id, row.id, next[row.bind]) : next[row.bind];
        runtime.setValue(controlId(spec.id, row.id), value);
        guard();
      }
      state = next;
      updateFormViews();
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
    else { state = projected.state; updateFormViews(); }
    if (projected.event) onEvent(projected.event);
  });
  if (typeof detach !== 'function') { alive = false; throw new Error('PANEL_RUNTIME_REQUIRED'); }
  unsubscribe = detach;
  // Guard a runtime which synchronously destroys itself while subscribing.
  if (!alive) { unsubscribe = () => {}; detach(); }
  if (alive) updateFormViews();
  return Object.freeze({
    getState() { guard(); return structuredClone(state); },
    setState: applyState,
    getFormErrors() { guard(); return formErrors(spec, state); },
    setInteractionLocked(value) { guard(); interactionLocked = Boolean(value); updateFormViews(); },
    setProgress(fieldId, value) {
      guard();
      if (fieldMap.get(fieldId)?.type !== 'progress') throw new Error('PANEL_PROGRESS_FIELD');
      applyState({ ...state, [fieldId]: value });
    },
    setText(fieldId, value) {
      guard();
      if (fieldMap.get(fieldId)?.type !== 'string') throw new Error('PANEL_INPUT_FIELD');
      applyState({ ...state, [fieldId]: value });
    },
    destroy,
  });
}

export { initialPanelState };
