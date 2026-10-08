/** Bounded validation evidence only. Never expose proposal values or raw CLI/errors. */
import { snapshotJson } from './spec.mjs';

const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const CODES = new Set(`EDIT_REQUEST_INCOMPLETE EDIT_BASE_MISMATCH EDIT_BASIS EDIT_BUSINESS_ORIGIN EDIT_CATALOG EDIT_CONTEXT_MISMATCH EDIT_CONTEXT_VERSION EDIT_COVERAGE EDIT_EMPTY_PATCH EDIT_FIELDS EDIT_JSON EDIT_LIST EDIT_OBJECT EDIT_OPERATION_INDEX EDIT_PATCH EDIT_PLAN_NEEDS_INPUT EDIT_PROPOSAL_VERSION EDIT_QUOTE EDIT_REQUEST EDIT_RESULT_SPEC EDIT_SPAN EDIT_SPEC EDIT_TEXT EDIT_UNRESOLVED_ID PLAN_ASSET_CANDIDATE PLAN_ASSET_CONTEXT_VERSION PLAN_ASSET_LIBRARY PLAN_BASIS PLAN_BUSINESS_ORIGIN PLAN_CONTEXT_MISMATCH PLAN_COVERAGE PLAN_EMPTY_SPEC PLAN_FIELDS PLAN_LIST PLAN_NEEDS_INPUT PLAN_OBJECT PLAN_PROVENANCE PLAN_QUOTE PLAN_SPAN PLAN_SPEC_CONTEXT_VERSION PLAN_TARGET PLAN_TEXT PLAN_UNRESOLVED_ID PLAN_VERSION VALIDATION_FAILED accessor action-field action-kind array asset-binding asset-digest asset-key asset-selection binding binding-type boolean cycle duplicate enum-value identifier integer json-type layout-align layout-coverage layout-kind layout-overflow layout-section layout-structure number object prototype provenance range required row-kind state-type step structure-limit text unknown-key unused-state version`.split(' '));
const FIELDS = new Set(`spec proposalVersion editProposalVersion contextSha256 decisions unresolved target basis kind start end quote reason id question panelSpecVersion title theme version canvas width height layout padding gap sectionGap labelWidth rowHeight titleHeight sectionTitleHeight maxHeight overflow body direction children columns breakpoint align justify sectionId state type initial min max step options label sections rows recipe bind enabled event format fractionDigits prefix suffix buttonLabel action fields text provenance description assumptions assets library sha256 panelSurface rowIcons rowId asset patch patchVersion baseSpecSha256 operations op operationIndex afterRowId fieldId value catalog recipes themes capabilities request requestVersion editContextVersion catalogSha256`.split(' '));
const KEYS = ['codexValidationDiagnosticVersion', 'operation', 'contextSha256', 'proposalJsonSha256', 'stage', 'validatorCode', 'path'];
const OUTPUT_CODES = new Set(['OUTPUT_JSON', 'OUTPUT_WRAPPER', 'OUTPUT_PROPOSAL_JSON']);
CODES.add('INTENT_NATIVE_QUOTE');
CODES.add('INTENT_SOURCE_REFERENCE'); FIELDS.add('sourceRef');
CODES.add('INTENT_TEXT_LABEL');
CODES.add('INTENT_TEXT_CONTENT');
for (const code of ['DRAFT_FIELDS', 'DRAFT_COUNT', 'DRAFT_VERSION', 'INTENT_FIELDS', 'INTENT_COUNT', 'INTENT_QUOTE', 'INTENT_VERSION', 'INTENT_REFERENCE', 'INTENT_PRECISION', 'INTENT_DEFAULT', ...OUTPUT_CODES]) CODES.add(code);
for (const field of ['codexPanelDraftVersion', 'codexEditDraftVersion', 'bases', 'overall', 'surface', 'proposalJson', 'panelIntentVersion', 'panel', 'sourceQuote', 'themeKey', 'recipeKey', 'icon', 'canvasWidth', 'canvasHeight', 'initialLabel', 'resetRows']) FIELDS.add(field);
for (const code of ['EDIT_INPUT_RECIPE', 'EDIT_NO_CHANGE', 'EDIT_PLAN_NO_CHANGES', 'input-value', 'input-type']) CODES.add(code);
FIELDS.add('noChange');
CODES.add('layout-details'); CODES.add('layout-details-version'); FIELDS.add('details');
for (const field of ['placeholder', 'inputType', 'readOnly', 'maxLength', 'validation', 'required', 'minLength',
  'requiredMessage', 'minLengthMessage', 'validationMessages', 'submitRows', 'tabs', 'pages', 'pageId']) FIELDS.add(field);
const TARGET_ISSUES = new Set(['duplicate', 'unmatched', 'non-string']);
const bad = () => { const error = new Error('CODEX_DIAGNOSTIC_INVALID'); error.code = error.message; throw error; };

function safePath(input) {
  if (typeof input !== 'string' || input.length > 256 || !input.startsWith('$')) return null;
  const pattern = /\.(\w+)|\[(\d{1,4})\]|\["(\w+)"\]/g;
  let position = 1, path = '$', match;
  while ((match = pattern.exec(input))) {
    if (match.index !== position) return null;
    const field = match[1] ?? match[3];
    if (field !== undefined) { if (!FIELDS.has(field)) return null; path += `.${field}`; }
    else { if (Number(match[2]) > 1023) return null; path += `[${Number(match[2])}]`; }
    position = pattern.lastIndex;
  }
  return position === input.length ? path : null;
}

export function validateCodexDiagnostic(input, { operation, contextSha256, failureCode } = {}) {
  let value;
  try { value = snapshotJson(input); } catch { bad(); }
  const keys = [...KEYS, ...(value && Object.hasOwn(value, 'targetIssue') ? ['targetIssue'] : []),
    ...(value && Object.hasOwn(value, 'cause') ? ['cause'] : [])];
  if (!value || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')
    || value.codexValidationDiagnosticVersion !== '0.1' || !['plan', 'edit'].includes(value.operation)
    || !HASH.test(value.contextSha256 ?? '') || !HASH.test(value.proposalJsonSha256 ?? '')
    || !['output-validation', 'draft-validation', 'intent-validation', 'proposal-validation', 'proposal-check', 'provenance-validation'].includes(value.stage)
    || ((value.stage === 'output-validation') !== OUTPUT_CODES.has(value.validatorCode))
    || (value.stage === 'output-validation' && !['$', '$.proposalJson'].includes(value.path))
    || (['draft-validation', 'intent-validation'].includes(value.stage) && value.operation !== 'plan')
    || (Object.hasOwn(value, 'targetIssue') && (value.operation !== 'plan'
      || value.validatorCode !== 'PLAN_TARGET' || !TARGET_ISSUES.has(value.targetIssue)))
    || !CODES.has(value.validatorCode) || (value.path !== null && safePath(value.path) !== value.path)
    || (failureCode !== undefined && (!['CODEX_OUTPUT_INVALID', 'CODEX_PROPOSAL_INVALID', 'CODEX_PROVENANCE_INVALID'].includes(failureCode)
      || ((failureCode === 'CODEX_OUTPUT_INVALID') !== (value.stage === 'output-validation'))))
    || (operation !== undefined && value.operation !== operation)
    || (contextSha256 !== undefined && value.contextSha256 !== contextSha256)) bad();
  if (Object.hasOwn(value, 'cause')) {
    const cause = value.cause;
    if (value.operation !== 'edit' || !['EDIT_RESULT_SPEC', 'EDIT_PATCH'].includes(value.validatorCode)
      || !['proposal-validation', 'proposal-check'].includes(value.stage)
      || !cause || Array.isArray(cause) || Object.keys(cause).sort().join('|') !== 'path|validatorCode'
      || !CODES.has(cause.validatorCode) || cause.validatorCode === 'VALIDATION_FAILED'
      || (cause.path !== null && safePath(cause.path) !== cause.path)) bad();
  }
  return value;
}

export function createCodexDiagnostic(error, { operation, contextSha256, proposalJsonSha256, stage }) {
  // Only constants from public validators and known schema field names survive.
  const validatorCode = CODES.has(error?.code) ? error.code : 'VALIDATION_FAILED';
  const candidatePath = error?.path ?? (typeof error?.message === 'string' ? error.message.split(':', 1)[0] : undefined);
  const nested = operation === 'edit' && ['EDIT_RESULT_SPEC', 'EDIT_PATCH'].includes(validatorCode)
    && ['proposal-validation', 'proposal-check'].includes(stage) && CODES.has(error?.cause?.code)
    && error.cause.code !== 'VALIDATION_FAILED'
    ? { cause: { validatorCode: error.cause.code, path: safePath(error.cause.path) } } : {};
  return validateCodexDiagnostic({ codexValidationDiagnosticVersion: '0.1', operation, contextSha256,
    proposalJsonSha256, stage, validatorCode, path: safePath(candidatePath), ...nested,
    ...(operation === 'plan' && validatorCode === 'PLAN_TARGET' && TARGET_ISSUES.has(error?.targetIssue)
      ? { targetIssue: error.targetIssue } : {}) });
}
