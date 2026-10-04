/** Optional Codex wire format. Targets are derived from validated Spec IDs, never repaired. */
import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { validatePlanningContext } from './planning-context.mjs';
import { PanelPlanningError, proposalTargets, validatePanelProposal } from './proposal.mjs';

const fail = (code, path) => { throw new PanelPlanningError(code, path, 'Draft evidence must exactly match the authored spec'); };
function exact(value, keys, path) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('DRAFT_FIELDS', path);
}
function aligned(value, count, path) {
  if (!Array.isArray(value) || value.length !== count) fail('DRAFT_COUNT', path);
}

/** Each evidence array follows its own Spec collection. No defaults, deduplication or dropped entries. */
export async function materializeCodexPanelDraft(contextInput, input) {
  const draft = snapshotJson(input), context = await validatePlanningContext(snapshotJson(contextInput));
  exact(draft, ['codexPanelDraftVersion', 'contextSha256', 'spec', 'bases', 'unresolved'], '$');
  if (draft.codexPanelDraftVersion !== '0.1') fail('DRAFT_VERSION', '$.codexPanelDraftVersion');
  const proposal = { proposalVersion: context.planningContextVersion, contextSha256: draft.contextSha256,
    spec: draft.spec, decisions: [], unresolved: draft.unresolved };
  if (draft.spec === null) {
    if (draft.bases !== null) fail('DRAFT_FIELDS', '$.bases');
    return validatePanelProposal(context, proposal);
  }
  const spec = validatePanelSpec(draft.spec), bases = draft.bases;
  exact(bases, ['panel', 'theme', 'canvas', 'layout', 'assets', 'sections', 'state'], '$.bases');
  aligned(bases.sections, spec.sections.length, '$.bases.sections');
  aligned(bases.state, spec.state.length, '$.bases.state');
  const evidence = [bases.panel, bases.theme, bases.canvas, bases.layout];
  if (spec.assets) {
    exact(bases.assets, ['overall', 'surface', 'rowIcons'], '$.bases.assets');
    evidence.push(bases.assets.overall);
    const slots = context.planningContextVersion !== '0.1';
    aligned(bases.assets.rowIcons, slots ? spec.assets.rowIcons.length : 0, '$.bases.assets.rowIcons');
    if (slots && spec.assets.panelSurface) evidence.push(bases.assets.surface);
    else if (bases.assets.surface !== null) fail('DRAFT_FIELDS', '$.bases.assets.surface');
    evidence.push(...bases.assets.rowIcons);
  } else if (bases.assets !== null) fail('DRAFT_FIELDS', '$.bases.assets');
  for (const [index, section] of spec.sections.entries()) {
    const source = bases.sections[index], path = `$.bases.sections[${index}]`;
    exact(source, ['section', 'rows'], path);
    aligned(source.rows, section.rows.length, `${path}.rows`);
    evidence.push(source.section, ...source.rows);
  }
  evidence.push(...bases.state);
  const targets = proposalTargets(spec, context.planningContextVersion);
  if (evidence.length !== targets.length) fail('DRAFT_COUNT', '$.bases');
  proposal.spec = spec;
  proposal.decisions = targets.map((target, index) => ({ target, basis: evidence[index] }));
  // The public gate still checks every span, business origin, asset, recipe, digest and question.
  return validatePanelProposal(context, proposal);
}
