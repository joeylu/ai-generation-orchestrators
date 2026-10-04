/** Optional Codex wire format. Program-owned offsets; literal source evidence only. */
import { snapshotJson } from './spec.mjs';
import { PanelEditPlanningError, validatePanelEditContext, validatePanelEditProposal } from './edit-planning.mjs';

const fail = (code, path, message) => { throw new PanelEditPlanningError(code, path, message); };
function exact(value, keys, path) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('EDIT_FIELDS', path, 'Exact draft fields required');
}

/** No guessed quotes, repaired operations, silent defaults, or dropped evidence. */
export async function materializeCodexEditDraft(contextInput, input) {
  const draft = snapshotJson(input), contextSnapshot = snapshotJson(contextInput);
  const context = await validatePanelEditContext(contextSnapshot);
  exact(draft, ['codexEditDraftVersion', 'contextSha256', 'patch', 'bases', 'unresolved'], '$');
  if (draft.codexEditDraftVersion !== '0.1') fail('EDIT_PROPOSAL_VERSION', '$.codexEditDraftVersion', 'Only edit draft 0.1 is supported');
  const proposal = { editProposalVersion: '0.1', contextSha256: draft.contextSha256,
    patch: draft.patch, decisions: [], unresolved: draft.unresolved };
  if (draft.patch === null) {
    if (draft.bases !== null) fail('EDIT_FIELDS', '$.bases', 'Null patch requires null bases');
    return validatePanelEditProposal(context, proposal);
  }
  if (!Array.isArray(draft.patch?.operations) || !Array.isArray(draft.bases)
    || draft.patch.operations.length < 1 || draft.patch.operations.length > 32
    || draft.bases.length !== draft.patch.operations.length) fail('EDIT_COVERAGE', '$.bases', 'One basis per operation in exact order required');
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
