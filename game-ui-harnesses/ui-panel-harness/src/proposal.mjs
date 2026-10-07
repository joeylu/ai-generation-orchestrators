import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { validatePlanningContext } from './planning-context.mjs';
import { resolveRecipe, resolveTheme } from './catalog.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';

export class PanelPlanningError extends Error {
  constructor(code, path, message) { super(`${path}: ${message} [${code}]`); this.name = 'PanelPlanningError'; this.code = code; this.path = path; }
}
const fail = (code, path, message) => { throw new PanelPlanningError(code, path, message); };
function exact(value, fields, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('PLAN_OBJECT', path, 'Object required');
  if (Object.keys(value).sort().join('|') !== [...fields].sort().join('|')) fail('PLAN_FIELDS', path, 'Missing or unknown fields');
}
function text(value, path, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\p{Cc}\p{Cs}]/u.test(value)) fail('PLAN_TEXT', path, 'Nonempty bounded text required');
}
function list(value, path, max) {
  if (!Array.isArray(value) || value.length > max) fail('PLAN_LIST', path, 'Bounded array required');
}

export function proposalTargets(spec, proposalVersion = '0.1') {
  const checked = validatePanelSpec(spec);
  return ['panel', 'theme', 'canvas', 'layout',
    ...(checked.assets ? ['assets'] : []),
    ...(checked.assets && ['0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9'].includes(proposalVersion) ? [
      ...(checked.assets.panelSurface ? ['asset:surface'] : []),
      ...checked.assets.rowIcons.map(icon => `asset:row:${icon.rowId}`),
    ] : []),
    ...(checked.actionLayouts ?? []).map(value => 'action-layout:' + value.sectionId),
    ...(checked.textLayouts ?? []).map(value => 'text-layout:' + value.rowId),
    ...checked.sections.flatMap(section => [`section:${section.id}`, ...section.rows.map(row => `row:${row.id}`)]),
    ...(checked.tabs ? ['tabs', ...checked.tabs.pages.map(page => `tab:${page.id}`)] : []),
    ...checked.state.map(field => `state:${field.id}`)];
}

/** Agent-authored content is input, never a success receipt or user approval. */
export async function validatePanelProposal(contextInput, proposalInput) {
  const contextSnapshot = snapshotJson(contextInput), proposal = snapshotJson(proposalInput);
  const context = await validatePlanningContext(contextSnapshot);
  exact(proposal, ['proposalVersion', 'contextSha256', 'spec', 'decisions', 'unresolved'], '$');
  if (!['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9'].includes(proposal.proposalVersion)) fail('PLAN_VERSION', '$.proposalVersion', 'Only proposal 0.1 through 0.9 are supported');
  if (proposal.proposalVersion !== context.planningContextVersion) {
    fail('PLAN_ASSET_CONTEXT_VERSION', '$.proposalVersion', 'Proposal and planning context versions must match');
  }
  if (proposal.contextSha256 !== context.sha256) fail('PLAN_CONTEXT_MISMATCH', '$.contextSha256', 'Proposal belongs to a different request or catalog');
  list(proposal.unresolved, '$.unresolved', 64);
  const unknownIds = new Set();
  for (const [index, unknown] of proposal.unresolved.entries()) {
    const path = `$.unresolved[${index}]`;
    exact(unknown, ['id', 'question'], path);
    text(unknown.id, `${path}.id`, 64); text(unknown.question, `${path}.question`, 500);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(unknown.id) || unknownIds.has(unknown.id)) fail('PLAN_UNRESOLVED_ID', path, 'Unique symbolic question ID required');
    unknownIds.add(unknown.id);
  }
  list(proposal.decisions, '$.decisions', 512);
  if (proposal.spec === null) {
    if (!proposal.unresolved.length || proposal.decisions.length) fail('PLAN_EMPTY_SPEC', '$.spec', 'An empty spec must have questions and no claimed decisions');
    return proposal;
  }
  const spec = validatePanelSpec(proposal.spec);
  if (context.capabilities.panelSpecVersions && !context.capabilities.panelSpecVersions.includes(spec.panelSpecVersion)) fail('PLAN_SPEC_CONTEXT_VERSION', '$.spec.panelSpecVersion', 'Spec version was not advertised by this context');
  if (spec.panelSpecVersion === '0.7' && !['0.7','0.8','0.9'].includes(context.planningContextVersion)) fail('PLAN_SPEC_CONTEXT_VERSION', '$.spec.panelSpecVersion', 'Forms requires context 0.7');
  if (spec.panelSpecVersion === '0.6' && !['0.6', '0.7', '0.8', '0.9'].includes(context.planningContextVersion)) fail('PLAN_SPEC_CONTEXT_VERSION', '$.spec.panelSpecVersion', 'Tabs requires context 0.6');
  if (spec.panelSpecVersion === '0.5' && !['0.5', '0.6', '0.7', '0.8', '0.9'].includes(context.planningContextVersion)) {
    fail('PLAN_SPEC_CONTEXT_VERSION', '$.spec.panelSpecVersion', 'PanelSpec 0.5 requires planning context 0.5');
  }
  if (spec.panelSpecVersion === '0.4' && !['0.4', '0.5', '0.6', '0.7', '0.8', '0.9'].includes(context.planningContextVersion)) {
    fail('PLAN_SPEC_CONTEXT_VERSION', '$.spec.panelSpecVersion', 'PanelSpec 0.4 requires planning context 0.4');
  }
  if (spec.panelSpecVersion === '0.3' && !['0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9'].includes(context.planningContextVersion)) {
    fail('PLAN_SPEC_CONTEXT_VERSION', '$.spec.panelSpecVersion', 'PanelSpec 0.3 requires planning context 0.3 or 0.4');
  }
  if (!['agent-authored', 'programmatic-fixture'].includes(spec.provenance.kind)) fail('PLAN_PROVENANCE', '$.spec.provenance.kind', 'Agent proposals must identify their author; user-authored documents use direct compile');
  resolveTheme(context.catalog, spec.theme);
  resolveRecipe(context.catalog, { id: 'settings.panel', version: '0.1.0' }, 'panel');
  resolveRecipe(context.catalog, { id: 'settings.section', version: '0.1.0' }, 'section');
  if (spec.tabs) resolveRecipe(context.catalog, spec.tabs.recipe, 'tabs');
  for (const section of spec.sections) for (const row of section.rows) {
    resolveRecipe(context.catalog, row.recipe, `${row.kind}-row`);
  }
  if (context.assetRetrieval && spec.assets) {
    if (canonicalJson(spec.assets.library) !== canonicalJson(context.assetRetrieval.library)) fail('PLAN_ASSET_LIBRARY', '$.spec.assets.library', 'Select from the pinned planning library');
    const candidates = context.assetRetrieval.candidates;
    const requireCandidate = (key, slot, path) => {
      if (!candidates.some(candidate => candidate.slot === slot && candidate.asset.key === key)) fail('PLAN_ASSET_CANDIDATE', path, 'Exact asset key must be a candidate for this slot');
    };
    if (spec.assets.panelSurface) requireCandidate(spec.assets.panelSurface, 'panel-surface', '$.spec.assets.panelSurface');
    for (const [i, icon] of spec.assets.rowIcons.entries()) requireCandidate(icon.asset, 'row-icon', `$.spec.assets.rowIcons[${i}].asset`);
  }
  const required = new Set(proposalTargets(spec, proposal.proposalVersion)), seen = new Set();
  for (const [index, decision] of proposal.decisions.entries()) {
    const path = `$.decisions[${index}]`;
    exact(decision, ['target', 'basis'], path);
    if (!required.has(decision.target) || seen.has(decision.target)) {
      const error = new PanelPlanningError('PLAN_TARGET', `${path}.target`, 'Expected one decision per authored target');
      error.targetIssue = typeof decision.target !== 'string' ? 'non-string'
        : seen.has(decision.target) ? 'duplicate' : 'unmatched';
      throw error;
    }
    seen.add(decision.target);
    const basis = decision.basis;
    if (basis?.kind === 'request-interpretation') {
      exact(basis, ['kind', 'start', 'end', 'quote'], `${path}.basis`);
      if (!Number.isSafeInteger(basis.start) || !Number.isSafeInteger(basis.end)
        || basis.start < 0 || basis.start >= basis.end || basis.end > context.request.text.length) fail('PLAN_SPAN', path, 'Invalid UTF-16 source offsets');
      for (const offset of [basis.start, basis.end]) {
        const previous = context.request.text.charCodeAt(offset - 1), current = context.request.text.charCodeAt(offset);
        if (previous >= 0xD800 && previous <= 0xDBFF && current >= 0xDC00 && current <= 0xDFFF) fail('PLAN_SPAN', path, 'Source spans must not split Unicode surrogate pairs');
      }
      if (typeof basis.quote !== 'string' || basis.quote !== context.request.text.slice(basis.start, basis.end) || !basis.quote.trim()) fail('PLAN_QUOTE', path, 'Quote must exactly match the request span');
    } else if (basis?.kind === 'design-choice') {
      exact(basis, ['kind', 'reason'], `${path}.basis`);
      text(basis.reason, `${path}.basis.reason`, 500);
      // Design choices may style and arrange the panel. Business-bearing targets require
      // a request interpretation; any absent behavior belongs in unresolved questions.
      if (decision.target.startsWith('state:') || decision.target.startsWith('row:') || decision.target === 'tabs' || decision.target.startsWith('tab:')) fail('PLAN_BUSINESS_ORIGIN', path, 'State and control semantics require request evidence, not an implicit design default');
    } else fail('PLAN_BASIS', `${path}.basis`, 'Explicit request interpretation or design choice required');
  }
  if (seen.size !== required.size) fail('PLAN_COVERAGE', '$.decisions', 'Every target must state its source');
  return { ...proposal, spec };
}

/** Structural/source evidence only; this does not certify the interpretation of natural language. */
export async function checkPanelProposal(contextInput, proposalInput) {
  const contextSnapshot = snapshotJson(contextInput), proposalSnapshot = snapshotJson(proposalInput);
  const context = await validatePlanningContext(contextSnapshot), proposal = await validatePanelProposal(context, proposalSnapshot);
  return {
    planningReportVersion: proposal.proposalVersion, status: proposal.unresolved.length ? 'NEEDS_INPUT' : 'READY_TO_COMPILE',
    contextSha256: context.sha256, requestSha256: context.requestSha256,
    proposalSha256: await digestJson(proposal), specSha256: proposal.spec === null ? null : await digestJson(proposal.spec),
    unresolved: proposal.unresolved,
    designChoices: proposal.decisions.filter(item => item.basis.kind === 'design-choice'),
    sourceEvidence: 'EXACT_SPANS_ONLY', semanticReview: 'NOT_RUN', humanVisualReview: 'NOT_RUN',
    ...(context.assetRetrieval ? { assetEvidence: {
      library: context.assetRetrieval.library, libraryVerification: 'REQUIRES_BUILD_VERIFICATION',
      candidateCount: context.assetRetrieval.candidates.length,
      selectedKeys: proposal.spec?.assets ? [...new Set([proposal.spec.assets.panelSurface,
        ...proposal.spec.assets.rowIcons.map(icon => icon.asset)].filter(Boolean))].sort() : [],
    } } : {}),
  };
}

export async function requireReadyProposal(contextInput, input) {
  const contextSnapshot = snapshotJson(contextInput), proposalSnapshot = snapshotJson(input);
  const context = await validatePlanningContext(contextSnapshot);
  const proposal = await validatePanelProposal(context, proposalSnapshot);
  const report = await checkPanelProposal(context, proposal);
  if (report.status !== 'READY_TO_COMPILE') fail('PLAN_NEEDS_INPUT', '$.unresolved', 'Resolve the recorded questions before building');
  return { proposal, report };
}
