/** Form checks never rewrite user text. Length limits use UTF-16 units in both engines. */
export const formErrorId = (panelId, rowId, code) => `${panelId}.row.${rowId}.error.${code}`;
export function inputError(row, value) {
  const length = value.trim().length;
  if (length === 0) return row.validation.required ? 'required' : null;
  return length < row.validation.minLength ? 'min-length' : null;
}
export function formErrors(spec, state) {
  return Object.fromEntries(spec.sections.flatMap(section => section.rows).filter(row => row.kind === 'input')
    .map(row => [row.bind, inputError(row, state[row.bind])]));
}
export function buttonEnabled(spec, row, state) {
  if (!row.enabled || row.action.kind !== 'submit') return row.enabled;
  const errors = formErrors(spec, state);
  return row.action.fields.every(id => errors[id] === null);
}
