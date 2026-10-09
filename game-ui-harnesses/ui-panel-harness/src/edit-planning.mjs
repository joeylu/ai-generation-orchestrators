import {explicitPropertyRequirements,checkExplicitPropertyRequirements} from './edit-property-review.mjs';
import { explicitEditRequirements, checkExplicitEditRequirements } from './edit-review.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';
import { validateCatalog } from './catalog.mjs';
import { validatePanelRequest } from './planning-context.mjs';
import { applyPanelPatch, PanelPatchError } from './patch.mjs';
import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { selectedEditOperations, selectedEditRow, isSelectedEditOperation } from './edit-selection.mjs';

/** Invalid edit planning evidence; never an applied edit or semantic approval. */
export class PanelEditPlanningError extends Error {
  constructor(code, path, message, cause) {
    super(`${path}: ${message} [${code}]`, cause ? { cause } : undefined);
    this.name = 'PanelEditPlanningError';
    this.code = code;
    this.path = path;
  }
}

const LEGACY_OPERATIONS = Object.freeze([
  'set-panel-title', 'set-theme', 'set-layout', 'set-row-label',
  'set-row-enabled', 'set-state-initial', 'add-row', 'remove-row',
]);
const OPERATIONS = Object.freeze([...LEGACY_OPERATIONS, 'set-button-label', 'set-button-action']);
const TABS_OPERATIONS = Object.freeze([...OPERATIONS, 'set-tab-label', 'set-tabs-enabled']);
const INPUT_OPERATION = 'set-input-properties';
const CONTEXT_FIELDS = ['editContextVersion', 'request', 'spec', 'catalog', 'baseSpecSha256', 'catalogSha256', 'capabilities', 'sha256'];
const fail = (code, path, message) => { throw new PanelEditPlanningError(code, path, message); };

function checked(operation, code, path) {
  try { return operation(); }
  catch (cause) { throw new PanelEditPlanningError(code, path, cause.message, cause); }
}

function snapshot(input, path) {
  return checked(() => snapshotJson(input), 'EDIT_JSON', path);
}

function exact(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('EDIT_OBJECT', path, 'Object required');
  if (Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    fail('EDIT_FIELDS', path, 'Missing or unknown fields');
  }
}

function text(value, path, max) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\p{Cc}\p{Cs}]/u.test(value)) {
    fail('EDIT_TEXT', path, `Nonempty text of at most ${max} Unicode characters without controls required`);
  }
}

function list(value, path, max) {
  if (!Array.isArray(value) || value.length > max) fail('EDIT_LIST', path, `Array of at most ${max} entries required`);
}

async function buildContext(specInput, catalogInput, requestInput, operations, version, selection) {
  const spec = checked(() => validatePanelSpec(specInput), 'EDIT_SPEC', '$.spec');
  const catalog = checked(() => validateCatalog(catalogInput), 'EDIT_CATALOG', '$.catalog');
  const request = checked(() => validatePanelRequest(requestInput), 'EDIT_REQUEST', '$.request');
  const appearance = ['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(spec.panelSpecVersion) && catalog.themes.some(theme => theme.id === spec.theme.id && theme.version === spec.theme.version && theme.visualStyle === 'modern-v3');
  version ??= spec.panelSpecVersion === '0.14' ? '0.9' : appearance ? '0.8' : selection ? '0.5' : '0.1';
  if (['0.2', '0.3', '0.4', '0.5', '0.6', '0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) && !appearance || spec.panelSpecVersion === '0.8' && !['0.2', '0.3', '0.4', '0.5', '0.6', '0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version)
    || spec.panelSpecVersion === '0.9' && !['0.3','0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) || spec.panelSpecVersion === '0.10' && !['0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version)
    || spec.panelSpecVersion === '0.11' && !['0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) || spec.panelSpecVersion === '0.12' && !['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) || spec.panelSpecVersion === '0.13' && !['0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) || spec.panelSpecVersion === '0.14' && !['0.9','0.10','0.11','0.12','0.13','0.14'].includes(version)) fail('EDIT_CONTEXT_VERSION', '$.editContextVersion', 'Context version must match the appearance and action layout capabilities');
  const selected = version === '0.5' || ['0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) && selection !== null;
  if (selected) checked(() => selectedEditRow(spec, selection), 'EDIT_SELECTION', '$.selection');
  operations ??= [...(spec.tabs ? TABS_OPERATIONS : OPERATIONS), ...(['0.7', '0.8', '0.9', '0.10', '0.11', '0.12', '0.13', '0.14'].includes(spec.panelSpecVersion) ? [INPUT_OPERATION] : []),
    ...(['0.2', '0.3', '0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? ['set-appearance'] : []), ...(['0.3','0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? ['set-action-layout'] : []), ...(['0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? ['set-row-order','set-text','set-button-style'] : []), ...(['0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? ['set-button-font-size'] : []), ...(['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? ['set-title-bar'] : []), ...(['0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? ['set-text-wrap'] : [])];
  if(['0.9','0.10','0.11','0.12','0.13','0.14'].includes(version))operations.push(...['set-panel-frame','set-panel-ratio'].filter(op=>!operations.includes(op)));
  if(['0.10','0.11','0.12','0.13','0.14'].includes(version)&&!operations.includes('set-layout-details'))operations.push('set-layout-details');
  if (selected) operations = selectedEditOperations(spec, selection, operations);
  const [baseSpecSha256, catalogSha256] = await Promise.all([digestJson(spec), digestJson(catalog)]);
  const payload = {
    editContextVersion: version, request, spec, catalog, baseSpecSha256, catalogSha256,
    ...(version === '0.11' ? {requestChecks:explicitEditRequirements(request.text,selection)} : ['0.12','0.13','0.14'].includes(version) ? {requestChecks:explicitPropertyRequirements(request.text,spec,catalog,selection,version==='0.14'?'explicit-properties-v4':version==='0.13'?'explicit-properties-v3':'explicit-properties-v2')} : {}),
    ...(['0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? { selection } : {}),
    capabilities: {
      operations: [...operations], target: 'pixi', statePolicy: 'preserve-current-at-apply', semanticReview: 'NOT_RUN',
      ...(catalog.themes.some(theme => theme.id === spec.theme.id && theme.version === spec.theme.version && ['modern-v2', 'modern-v3'].includes(theme.visualStyle))
        ? { themePolicy: 'explicit-change-v1' } : {}),
      ...(['0.2', '0.3', '0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? { appearancePolicy: 'panel-local-v1' } : {}),
      ...(['0.3','0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? { actionLayoutPolicy: 'section-buttons-v1' } : {}), ...(['0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? { buttonStylePolicy: 'per-button-v1' } : {}),
      ...(['0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? { buttonFontPolicy: 'per-button-font-size-v1' } : {}),
      ...(['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? { titleBarPolicy: 'panel-title-bar-v1' } : {}),
      ...(['0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? {textWrapPolicy:'static-text-wrap-v1'} : {}),
      ...(['0.9','0.10','0.11','0.12','0.13','0.14'].includes(version) ? {panelFramePolicy:'fixed-panel-frame-v1'} : {}),
      ...(['0.10','0.11','0.12','0.13','0.14'].includes(version) ? {layoutDetailsPolicy:'layout-details-v1'} : {}),
      ...(['0.11','0.12','0.13','0.14'].includes(version) ? {requestCheckPolicy:version==='0.14'?'explicit-properties-v4':version==='0.13'?'explicit-properties-v3':version === '0.12'?'explicit-properties-v2':'explicit-geometry-v1'} : {}),
      ...(selected ? { selectionPolicy: 'selected-row-v1' } : {}),
    },
  };
  return { ...payload, sha256: await digestJson(payload) };
}

/** Bind an exact document and request. Live session state is deliberately absent. */
export async function createPanelEditContext(specInput, catalogInput, requestInput, selectionInput = null, { panelFrame = false, layoutDetails = false, requestChecks = false } = {}) {
  // Snapshot every caller-owned input before the first await or digest computation.
  const spec = snapshot(specInput, '$.spec');
  const catalog = snapshot(catalogInput, '$.catalog');
  const request = snapshot(requestInput, '$.request');
  const selection = selectionInput === null ? null : snapshot(selectionInput, '$.selection');
  return buildContext(spec, catalog, request, undefined, (panelFrame || layoutDetails || requestChecks) && catalog.themes.some(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version&&theme.visualStyle==='modern-v3') ? requestChecks === 'properties-v4' ? '0.14' : requestChecks === 'properties-v3' ? '0.13' : requestChecks === 'properties-v2' ? '0.12' : requestChecks ? '0.11' : layoutDetails ? '0.10' : '0.9' : undefined, selection);
}

async function validateContextSnapshot(context) {
  exact(context, [...CONTEXT_FIELDS, ...(['0.11','0.12','0.13','0.14'].includes(context?.editContextVersion) ? ['requestChecks'] : []), ...(['0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(context?.editContextVersion) ? ['selection'] : [])], '$');
  if (!['0.1', '0.2', '0.3', '0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(context.editContextVersion)) fail('EDIT_CONTEXT_VERSION', '$.editContextVersion', 'Only edit context 0.1 through 0.14 is supported');
  // Existing exported contexts keep their original capabilities and digest.
  // Only these two complete, ordered capability sets are accepted, never subsets.
  const suppliedOperations = context.capabilities?.operations ?? null;
  const formsOperations = [...(context.spec?.tabs ? TABS_OPERATIONS : OPERATIONS), INPUT_OPERATION];
  const operations = ['0.4','0.5','0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(context.editContextVersion) ? [...formsOperations, 'set-appearance', 'set-action-layout', 'set-row-order','set-text','set-button-style', ...(['0.6','0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(context.editContextVersion) ? ['set-button-font-size'] : []), ...(['0.7','0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(context.editContextVersion) ? ['set-title-bar'] : []), ...(['0.8','0.9','0.10','0.11','0.12','0.13','0.14'].includes(context.editContextVersion) ? ['set-text-wrap'] : [])]
    : context.editContextVersion === '0.3' ? [...formsOperations, 'set-appearance', 'set-action-layout']
    : context.editContextVersion === '0.2' ? [...formsOperations, 'set-appearance']
    : context.spec?.panelSpecVersion === '0.7' && canonicalJson(suppliedOperations) === canonicalJson(formsOperations) ? formsOperations
    : canonicalJson(suppliedOperations) === canonicalJson(LEGACY_OPERATIONS) ? LEGACY_OPERATIONS
    : canonicalJson(suppliedOperations) === canonicalJson(TABS_OPERATIONS) && context.spec?.tabs ? TABS_OPERATIONS : OPERATIONS;
  const expected = await buildContext(context.spec, context.catalog, context.request, operations, context.editContextVersion, context.selection);
  if (canonicalJson(context) !== canonicalJson(expected)) {
    fail('EDIT_CONTEXT_MISMATCH', '$', 'Context evidence does not match its exact request, PanelSpec and catalog');
  }
  return expected;
}

/** Recompute all program-owned fields instead of trusting a supplied digest. */
export async function validatePanelEditContext(input) {
  return validateContextSnapshot(snapshot(input, '$'));
}

function validateBasis(basis, operation, request, path) {
  if (basis?.kind === 'request-interpretation') {
    exact(basis, ['kind', 'start', 'end', 'quote'], path);
    if (!Number.isSafeInteger(basis.start) || !Number.isSafeInteger(basis.end)
      || basis.start < 0 || basis.start >= basis.end || basis.end > request.length) {
      fail('EDIT_SPAN', path, 'Invalid UTF-16 half-open source offsets');
    }
    for (const offset of [basis.start, basis.end]) {
      const previous = request.charCodeAt(offset - 1), current = request.charCodeAt(offset);
      if (previous >= 0xD800 && previous <= 0xDBFF && current >= 0xDC00 && current <= 0xDFFF) {
        fail('EDIT_SPAN', path, 'Source spans must not split Unicode surrogate pairs');
      }
    }
    if (typeof basis.quote !== 'string' || !basis.quote.trim() || basis.quote !== request.slice(basis.start, basis.end)) {
      fail('EDIT_QUOTE', path, 'Quote must exactly match the original request span');
    }
  } else if (basis?.kind === 'design-choice') {
    exact(basis, ['kind', 'reason'], path);
    text(basis.reason, `${path}.reason`, 500);
    if (!['set-theme', 'set-layout'].includes(operation.op)) {
      fail('EDIT_BUSINESS_ORIGIN', path, 'Only theme and layout changes allow design choices; other operations require request evidence');
    }
  } else fail('EDIT_BASIS', path, 'Explicit request interpretation or design choice required');
}

function requestCheck(context,spec,proposal) {
  if (!context.requestChecks || proposal.unresolved.length) return null;
  const result = ['explicit-properties-v2','explicit-properties-v3','explicit-properties-v4'].includes(context.capabilities.requestCheckPolicy)
    ? checkExplicitPropertyRequirements(context.requestChecks,spec,context.catalog,context.spec)
    : checkExplicitEditRequirements(context.requestChecks,spec);
  if (result.status === 'MISMATCH') {
    const error = new PanelEditPlanningError('EDIT_REQUEST_INCOMPLETE','$.patch','Explicit requested properties are not satisfied; no edit applied');
    error.requestCheck = result;
    throw error;
  }
  return result;
}

async function validateProposalSnapshots(contextSnapshot, proposal) {
  const context = await validateContextSnapshot(contextSnapshot);
  const noChanges = proposal.editProposalVersion === '0.2';
  exact(proposal, ['editProposalVersion', 'contextSha256', 'patch', 'decisions', 'unresolved', ...(noChanges ? ['noChange'] : [])], '$');
  if (!['0.1', '0.2'].includes(proposal.editProposalVersion)) fail('EDIT_PROPOSAL_VERSION', '$.editProposalVersion', 'Only edit proposal 0.1/0.2 is supported');
  if (proposal.contextSha256 !== context.sha256) fail('EDIT_CONTEXT_MISMATCH', '$.contextSha256', 'Proposal belongs to a different edit context');
  list(proposal.unresolved, '$.unresolved', 64);
  const questionIds = new Set();
  for (const [index, question] of proposal.unresolved.entries()) {
    const path = `$.unresolved[${index}]`;
    exact(question, ['id', 'question'], path);
    text(question.id, `${path}.id`, 64);
    text(question.question, `${path}.question`, 500);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$(?![\s\S])/u.test(question.id) || questionIds.has(question.id)) {
      fail('EDIT_UNRESOLVED_ID', `${path}.id`, 'Unique stable ASCII question ID required');
    }
    questionIds.add(question.id);
  }
  list(proposal.decisions, '$.decisions', 32);
  if (noChanges) {
    if (proposal.patch !== null || proposal.decisions.length || proposal.unresolved.length) {
      fail('EDIT_NO_CHANGE', '$.noChange', 'No-change evidence cannot accompany operations, decisions or questions');
    }
    exact(proposal.noChange, ['reason', 'basis'], '$.noChange');
    text(proposal.noChange.reason, '$.noChange.reason', 500);
    if (proposal.noChange.basis?.kind !== 'request-interpretation') {
      fail('EDIT_BASIS', '$.noChange.basis', 'No-change results require exact current-request evidence');
    }
    validateBasis(proposal.noChange.basis, null, context.request.text, '$.noChange.basis');
    return { context, proposal, result: null, requestCheck:requestCheck(context,context.spec,proposal) };
  }
  if (proposal.patch === null) {
    if (!proposal.unresolved.length || proposal.decisions.length) {
      fail('EDIT_EMPTY_PATCH', '$.patch', 'A null patch requires unresolved questions and no decisions');
    }
    return { context, proposal, result: null };
  }
  if (proposal.patch && typeof proposal.patch === 'object' && !Array.isArray(proposal.patch)
    && proposal.patch.baseSpecSha256 !== context.baseSpecSha256) {
    fail('EDIT_BASE_MISMATCH', '$.patch.baseSpecSha256', 'Patch must target the exact PanelSpec bound to this context');
  }
  let result;
  if (Array.isArray(proposal.patch?.operations) && proposal.patch.operations.some(operation =>
    !context.capabilities.operations.includes(operation?.op))) {
    fail('EDIT_PATCH', '$.patch.operations', 'Every operation must be advertised by this exact edit context');
  }
  if (context.selection && proposal.patch?.operations?.some(operation => !isSelectedEditOperation(context.spec, context.selection, operation))) {
    fail('EDIT_SELECTION_SCOPE', '$.patch.operations', 'Clear the selection before editing other controls or the whole panel');
  }
  if (context.capabilities.themePolicy === 'explicit-change-v1') {
    for (const [index, operation] of (Array.isArray(proposal.patch?.operations) ? proposal.patch.operations : []).entries()) {
      if (operation.op === 'set-theme' && !context.catalog.themes.some(theme => theme.id === operation.theme?.id && theme.version === operation.theme?.version))
        fail('EDIT_THEME_REFERENCE', `$.patch.operations[${index}].theme`, 'Select an exact theme from this panel\'s pinned catalog');
    }
  }
  try { result = await applyPanelPatch(context.spec, proposal.patch); }
  catch (cause) {
    const code = cause instanceof PanelPatchError ? 'EDIT_PATCH' : 'EDIT_RESULT_SPEC';
    throw new PanelEditPlanningError(code, '$.patch', cause.message, cause);
  }
  const seen = new Set();
  for (const [index, decision] of proposal.decisions.entries()) {
    const path = `$.decisions[${index}]`;
    exact(decision, ['operationIndex', 'basis'], path);
    if (!Number.isSafeInteger(decision.operationIndex) || decision.operationIndex < 0
      || decision.operationIndex >= proposal.patch.operations.length || seen.has(decision.operationIndex)) {
      fail('EDIT_OPERATION_INDEX', `${path}.operationIndex`, 'Expected one unique in-range operation index per decision');
    }
    seen.add(decision.operationIndex);
    if (context.capabilities.themePolicy === 'explicit-change-v1'
      && proposal.patch.operations[decision.operationIndex].op === 'set-theme' && decision.basis?.kind !== 'request-interpretation') {
      fail('EDIT_THEME_ORIGIN', `${path}.basis`, 'Theme changes require current-request evidence; an unrequested design choice is not allowed');
    }
    validateBasis(decision.basis, proposal.patch.operations[decision.operationIndex], context.request.text, `${path}.basis`);
  }
  if (seen.size !== proposal.patch.operations.length) fail('EDIT_COVERAGE', '$.decisions', 'Every operation must state its source exactly once');
  return { context, proposal, result, requestCheck:requestCheck(context,result.spec,proposal) };
}

/** Validate bounded patch instructions and exact source evidence; bounded explicit geometry only; broader prose is not semantically approved. */
export async function validatePanelEditProposal(contextInput, proposalInput) {
  const context = snapshot(contextInput, '$.context'), proposal = snapshot(proposalInput, '$.proposal');
  return (await validateProposalSnapshots(context, proposal)).proposal;
}

async function reportFor({ context, proposal, result, requestCheck }) {
  return {
    editPlanningReportVersion: proposal.editProposalVersion, contextSha256: context.sha256,
    proposalSha256: await digestJson(proposal), baseSpecSha256: context.baseSpecSha256,
    status: proposal.editProposalVersion === '0.2' ? 'NO_CHANGES' : proposal.unresolved.length ? 'NEEDS_INPUT' : 'READY_TO_APPLY',
    unresolvedCount: proposal.unresolved.length, operationCount: proposal.patch?.operations.length ?? 0,
    resultSpecSha256: result?.receipt.resultSpecSha256 ?? null,
    changedRowIds: result?.receipt.changedRowIds ?? [],
    ...(requestCheck ? {requestCheck} : {}),
    semanticReview: 'NOT_RUN', humanVisualReview: 'NOT_RUN', compilation: 'NOT_RUN',
  };
}

/** Read-only structural report. Applying requires caller-side current-document and build checks. */
export async function checkPanelEditProposal(contextInput, proposalInput) {
  const context = snapshot(contextInput, '$.context'), proposal = snapshot(proposalInput, '$.proposal');
  return reportFor(await validateProposalSnapshots(context, proposal));
}

export async function requireReadyEditProposal(contextInput, proposalInput) {
  const context = snapshot(contextInput, '$.context'), proposal = snapshot(proposalInput, '$.proposal');
  const validated = await validateProposalSnapshots(context, proposal);
  const report = await reportFor(validated);
  if (report.status === 'NO_CHANGES') fail('EDIT_PLAN_NO_CHANGES', '$.noChange', 'No-change result contains no applicable patch');
  if (report.status !== 'READY_TO_APPLY') fail('EDIT_PLAN_NEEDS_INPUT', '$.unresolved', 'Resolve recorded questions before applying this edit');
  return { proposal: validated.proposal, report };
}
