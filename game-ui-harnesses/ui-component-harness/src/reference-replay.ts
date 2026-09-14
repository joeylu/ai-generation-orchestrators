import { validateReferenceStates, type ReferenceEvidence } from './reference-evidence.ts';

/** Apply observed fields only; unknown fields retain runtime values and remain disclosed. */
export function replayReferenceState(evidence: ReferenceEvidence, runtime: {
  getDocument(): any; setValue(id: string, value: unknown): void; setSelectOpen(id: string, open: boolean): void;
  setInputEditing?(id: string, state: any): void;
}): { unknownFields: string[]; visualComparisonReady: boolean } {
  if (evidence.status !== 'complete' || !evidence.state || !evidence.scope) throw new Error('REFERENCE_EVIDENCE_REQUIRED');
  const document = runtime.getDocument();
  const unknownFields = validateReferenceStates(evidence.state, evidence.scope, document);
  const byId = new Map<string, any>();
  function visit(node: any) { byId.set(node.id, node); for (const child of node.children ?? []) visit(child); }
  visit(document.root);
  // Parent visibility/selection first, popups last (only one popup may be open).
  const rows = evidence.state.components as any[];
  const ordered = [...byId.keys()].map(id => rows.find(row => row.componentId === id)).filter(Boolean);
  const openPopups = ordered.filter(row => row.componentType === 'Select' && row.fields.popupOpen.status === 'observed' && row.fields.popupOpen.value);
  if (openPopups.length > 1) throw new Error('REFERENCE_MULTIPLE_OPEN_SELECTS');
  for (const row of ordered) {
    const known = Object.fromEntries(Object.entries(row.fields).filter(([, e]: [string, any]) => e.status === 'observed').map(([k, e]: [string, any]) => [k, e.value]));
    if (row.componentType === 'ScrollView') {
      if (Object.keys(known).length) runtime.setValue(row.componentId, { x: known.scrollX ?? byId.get(row.componentId).props.scrollX, y: known.scrollY ?? byId.get(row.componentId).props.scrollY });
    } else {
      const valueField = Object.keys(known).find(key => !['popupOpen','focused','selectionStart','selectionEnd','selectionDirection','caretVisible'].includes(key));
      if (valueField) runtime.setValue(row.componentId, known[valueField]);
    }
  }
  for (const row of ordered.filter(row => row.componentType === 'Select' && row.fields.popupOpen.status === 'observed')) runtime.setSelectOpen(row.componentId, row.fields.popupOpen.value);
  const inputs=ordered.filter(row=>row.componentType==='Input'&&row.fields.focused);
  for(const row of inputs.sort((a,b)=>Number(a.fields.focused.value===true)-Number(b.fields.focused.value===true))){
    const state=Object.fromEntries(Object.entries(row.fields).filter(([k,e]:[string,any])=>k!=='value'&&e.status==='observed').map(([k,e]:[string,any])=>[k,e.value]));
    if(!Object.keys(state).length)continue;
    if(!runtime.setInputEditing)throw Error('REFERENCE_INPUT_EDITING_UNSUPPORTED');
    // Unknown focus cannot be inferred from an observed caret offset.
    if(state.focused===undefined)continue;
    runtime.setInputEditing(row.componentId,state);
  }
  return { unknownFields, visualComparisonReady: unknownFields.length === 0 };
}
