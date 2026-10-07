/** Optional Codex wire format. Program-owned offsets; literal source evidence only. */
import { snapshotJson } from './spec.mjs';
import { PanelEditPlanningError, validatePanelEditContext, validatePanelEditProposal } from './edit-planning.mjs';

const fail = (code, path, message) => { throw new PanelEditPlanningError(code, path, message); };
const INPUT_KEYS = ['op', 'sectionId', 'afterRowId', 'id', 'recipeKey', 'label', 'enabled', 'initial',
  'placeholder', 'inputType', 'readOnly', 'maxLength', 'required', 'minLength', 'validationMessages'];
function exact(value, keys, path) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('EDIT_FIELDS', path, 'Exact draft fields required');
}

function formOperation(context, operation, index) {
  const path = `$.patch.operations[${index}]`;
  if (operation?.op !== 'add-input-row') {
    if (operation?.op === 'add-row' && operation.row?.kind === 'input') {
      fail('EDIT_FIELDS', path, 'Draft 0.2 uses add-input-row for new inputs');
    }
    return operation;
  }
  exact(operation, INPUT_KEYS, path);
  if (!context.capabilities.operations.includes('add-row')) fail('EDIT_PATCH', path, 'add-row capability required');
  const recipe = context.catalog.recipes.find(recipe => `${recipe.id}@${recipe.version}` === operation.recipeKey);
  if (!recipe || recipe.kind !== 'input-row' || !recipe.supports.includes('pixi')) {
    fail('EDIT_INPUT_RECIPE', `${path}.recipeKey`, 'Exact supported input recipe required');
  }
  if (operation.validationMessages !== null) {
    exact(operation.validationMessages, ['requiredMessage', 'minLengthMessage'], `${path}.validationMessages`);
  }
  const messages = operation.validationMessages ?? {
    requiredMessage: '此项不能为空', minLengthMessage: `至少输入 ${operation.minLength} 个字符`,
  };
  const namespacedEvent = `${context.spec.id}.${operation.id}`;
  // The new row ID is also its new field ID. Values are never coerced, truncated,
  // filled in or repaired. Public Patch/Spec gates validate every lowered value.
  return { op: 'add-row', sectionId: operation.sectionId, afterRowId: operation.afterRowId,
    row: { id: operation.id, kind: 'input', recipe: { id: recipe.id, version: recipe.version },
      label: operation.label, enabled: operation.enabled,
      event: namespacedEvent.length <= 128 ? namespacedEvent : `panel.${operation.id}`,
      bind: operation.id, placeholder: operation.placeholder, inputType: operation.inputType,
      readOnly: operation.readOnly, validation: { required: operation.required, minLength: operation.minLength, ...messages } },
    state: { id: operation.id, type: 'string', initial: operation.initial, maxLength: operation.maxLength } };
}

/** No guessed quotes, repaired values, silent business defaults, or dropped evidence. */
export async function materializeCodexEditDraft(contextInput, input) {
  const draft = snapshotJson(input), contextSnapshot = snapshotJson(contextInput);
  const context = await validatePanelEditContext(contextSnapshot);
  const current = draft.codexEditDraftVersion === '0.3';
  exact(draft, ['codexEditDraftVersion', 'contextSha256', 'patch', 'bases', 'unresolved', ...(current ? ['noChange'] : [])], '$');
  if (!['0.1', '0.2', '0.3'].includes(draft.codexEditDraftVersion)) fail('EDIT_PROPOSAL_VERSION', '$.codexEditDraftVersion', 'Only edit draft 0.1/0.2/0.3 is supported');
  if (draft.codexEditDraftVersion === '0.2' && !['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(context.spec.panelSpecVersion)) {
    fail('EDIT_PROPOSAL_VERSION', '$.codexEditDraftVersion', 'Draft 0.2 requires Spec 0.7');
  }
  const proposal = { editProposalVersion: '0.1', contextSha256: draft.contextSha256,
    patch: draft.patch, decisions: [], unresolved: draft.unresolved };
  if (current && draft.noChange !== null) {
    exact(draft.noChange, ['reason', 'quote'], '$.noChange');
    if (draft.bases !== null) fail('EDIT_FIELDS', '$.bases', 'No-change result requires null bases');
    const quote = draft.noChange.quote;
    if (typeof quote !== 'string' || !quote.trim()) fail('EDIT_QUOTE', '$.noChange.quote', 'Nonempty literal request quote required');
    const start = context.request.text.indexOf(quote);
    if (start < 0) fail('EDIT_QUOTE', '$.noChange.quote', 'Quote must occur verbatim in this exact edit request');
    return validatePanelEditProposal(context, { ...proposal, editProposalVersion: '0.2', noChange: {
      reason: draft.noChange.reason, basis: { kind: 'request-interpretation', start, end: start + quote.length, quote },
    } });
  }
  if (draft.patch === null) {
    if (draft.bases !== null) fail('EDIT_FIELDS', '$.bases', 'Null patch requires null bases');
    return validatePanelEditProposal(context, proposal);
  }
  if (!Array.isArray(draft.patch?.operations) || !Array.isArray(draft.bases)
    || draft.patch.operations.length < 1 || draft.patch.operations.length > 32
    || draft.bases.length !== draft.patch.operations.length) fail('EDIT_COVERAGE', '$.bases', 'One basis per operation in exact order required');
  if (draft.codexEditDraftVersion === '0.2' || (current && ['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(context.spec.panelSpecVersion))) {
    proposal.patch = { ...draft.patch, operations: draft.patch.operations.map((operation, index) => formOperation(context, operation, index)) };
  }
  proposal.decisions = draft.bases.map((basis, operationIndex) => {
    const path = `$.bases[${operationIndex}]`;
    if (basis?.kind === 'request-interpretation') {
      exact(basis, ['kind', 'quote'], path);
      if (typeof basis.quote !== 'string' || !basis.quote.trim()) fail('EDIT_QUOTE', `${path}.quote`, 'Nonempty literal request quote required');
      // indexOf and length use UTF-16, exactly as the unchanged public gate does.
      // For repeated identical quotes, the earliest literal occurrence is canonical.
      const start = context.request.text.indexOf(basis.quote);
      if (start < 0) fail('EDIT_QUOTE', `${path}.quote`, 'Quote must occur verbatim in this exact edit request');
      return { operationIndex, basis: { ...basis, start, end: start + basis.quote.length } };
    }
    exact(basis, ['kind', 'reason'], path);
    return { operationIndex, basis };
  });
  // Digest/capability binding, basis kind, surrogate boundaries, business origin,
  // dependencies, overlap, questions and final Spec remain public gate-owned.
  return validatePanelEditProposal(context, proposal);
}
