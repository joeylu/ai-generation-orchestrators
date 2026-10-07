/** Program-owned selection scope. Labels and screen positions are never identities. */
export function selectedEditRow(spec, selection) {
  if (!selection || Object.getPrototypeOf(selection) !== Object.prototype
      || Object.keys(selection).length !== 1 || typeof selection.rowId !== 'string') throw new Error('EDIT_SELECTION');
  const row = spec.sections.flatMap(section => section.rows).find(row => row.id === selection.rowId);
  if (!row) throw new Error('EDIT_SELECTION');
  return row;
}

export function selectedEditOperations(spec, selection, operations) {
  const row = selectedEditRow(spec, selection);
  const allowed = new Set(['set-row-label', 'remove-row',
    ...(!['text', 'progress'].includes(row.kind) ? ['set-row-enabled'] : []),
    ...(row.bind ? ['set-state-initial'] : []),
    ...(row.kind === 'button' ? ['set-button-label', 'set-button-action', 'set-button-style', 'set-button-font-size'] : []),
    ...(row.kind === 'text' ? ['set-text','set-text-wrap'] : []),
    ...(row.kind === 'input' ? ['set-input-properties'] : []),
  ]);
  return operations.filter(op => allowed.has(op));
}

export function isSelectedEditOperation(spec, selection, operation) {
  const row = selectedEditRow(spec, selection);
  return selectedEditOperations(spec, selection, [operation.op]).length === 1
    && (operation.op === 'set-state-initial' ? operation.fieldId === row.bind : operation.rowId === row.id);
}
