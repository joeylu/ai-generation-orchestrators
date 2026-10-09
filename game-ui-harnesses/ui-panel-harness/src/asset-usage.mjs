import { validatePanelSpec } from './spec.mjs';
import { rankPortableAssets, validateAssetRetrieval } from './asset-retrieval.mjs';
import { sectionPurpose } from './panel-presentation.mjs';
import { canonicalJson } from './canonical.mjs';

export const ICON_USAGE_POLICY = 'restrained-v1';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Advisory only. Never changes a proposal, saved spec, bindings, state or layout.
 * Row display labels are evidence; IDs, events, field defaults and body prose are not icon semantics.
 * An explicit user choice may differ from these presentation defaults. */
export function recommendPanelIcons(specInput, requestText, retrievalInput) {
  const spec = validatePanelSpec(specInput), retrieval = validateAssetRetrieval(requestText, retrievalInput);
  if (spec.assets && canonicalJson(spec.assets.library) !== canonicalJson(retrieval.library))
    throw Object.assign(new Error('ASSET_USAGE_LIBRARY_MISMATCH'), { code: 'ASSET_USAGE_LIBRARY_MISMATCH' });
  const candidates = retrieval.candidates.filter(candidate => candidate.slot === 'row-icon').map(candidate => candidate.asset);
  const selected = new Map((spec.assets?.rowIcons ?? []).map(icon => [icon.rowId, icon.asset]));
  const rows = [], styles = new Map();
  const panelPurpose = sectionPurpose({ rows: spec.sections.flatMap(section => section.rows) });
  for (const section of spec.sections) {
    const purpose = sectionPurpose(section), explicitLayout = spec.actionLayouts?.some(value => value.sectionId === section.id);
    for (const row of section.rows) {
      const text = row.kind === 'button' ? row.buttonLabel : row.label;
      let reason = null;
      if (explicitLayout) reason = 'EXPLICIT_ACTION_LAYOUT';
      else if (['text', 'progress'].includes(row.kind)) reason = 'READ_ONLY_CONTENT';
      else if (row.kind === 'button' && (purpose !== 'menu' || panelPurpose !== 'menu')) reason = 'TEXT_ACTION';
      else if (!/[\p{L}\p{N}]/u.test(text)) reason = 'INLINE_GLYPH';
      const matches = reason ? [] : rankPortableAssets(text, candidates, retrieval.policy.style);
      const entry = { sectionId: section.id, rowId: row.id, selectedAsset: selected.get(row.id) ?? null,
        recommendedAsset: null, reason: reason ?? (matches.length ? 'SEMANTIC_MATCH' : 'NO_MATCH'), matchedTerms: [], matches };
      rows.push(entry);
      // One surface uses a common authored style. Choose greatest row coverage, then total score.
      for (const style of new Set(matches.map(match => match.asset.style))) {
        const best = matches.find(match => match.asset.style === style), score = styles.get(style) ?? { coverage: 0, score: 0 };
        score.coverage++; score.score += best.score; styles.set(style, score);
      }
    }
  }
  const style = [...styles].sort(([a, x], [b, y]) => y.coverage - x.coverage || y.score - x.score || compare(a, b))[0]?.[0] ?? null;
  const variants = new Map();
  for (const entry of rows) {
    const matches = entry.matches.filter(match => match.asset.style === style);
    for (const variant of new Set(matches.map(match => match.asset.variant))) {
      const best = matches.find(match => match.asset.variant === variant), score = variants.get(variant) ?? { coverage: 0, score: 0 };
      score.coverage++; score.score += best.score; variants.set(variant, score);
    }
  }
  const variant = [...variants].sort(([a, x], [b, y]) => y.coverage - x.coverage || y.score - x.score || compare(a, b))[0]?.[0] ?? null;
  const used = new Map();
  for (const entry of rows) {
    const termLength = match => Math.max(...match.matchedTerms.map(term => [...term].length));
    const matches = entry.matches.filter(match => match.asset.style === style)
      .sort((a, b) => b.score - a.score || termLength(b) - termLength(a)
        || Number(b.asset.variant === variant) - Number(a.asset.variant === variant) || compare(a.asset.key, b.asset.key));
    if (entry.matches.length && !matches.length) entry.reason = 'STYLE_FALLBACK';
    if (matches.length) {
      const sectionUsed = used.get(entry.sectionId) ?? new Set();
      // Do not replace a duplicate with a weaker, differently meaningful icon just to fill a slot.
      const best = matches[0];
      if (matches.some(match => match !== best && match.score === best.score && termLength(match) === termLength(best)
        && match.asset.family !== best.asset.family)) entry.reason = 'AMBIGUOUS_MATCH';
      else if (sectionUsed.has(best.asset.key)) entry.reason = 'REPEATED_ICON';
      else if (sectionUsed.size >= 3) entry.reason = 'SECTION_BUDGET';
      else {
        entry.recommendedAsset = best.asset.key; entry.matchedTerms = best.matchedTerms;
        sectionUsed.add(best.asset.key); used.set(entry.sectionId, sectionUsed);
      }
    }
    delete entry.matches;
  }
  // Existing menu geometry centers the icon+button cell. Mixing decorated and
  // text-only cells shifts button edges, so the default keeps the group uniform.
  if (panelPurpose === 'menu') for (const section of spec.sections) {
    const group = rows.filter(row => row.sectionId === section.id);
    if (group.some(row => row.recommendedAsset === null)) for (const row of group) {
      if (row.recommendedAsset) { row.recommendedAsset = null; row.matchedTerms = []; row.reason = 'MENU_TEXT_FALLBACK'; }
    }
  }
  return { iconUsageVersion: '0.1', policy: ICON_USAGE_POLICY, status: 'ADVISORY_ONLY',
    library: retrieval.library, style, variantPreference: variant, maxIconsPerSection: 3, rows };
}

/** Shared generation/editing instructions. The model still owns explicit choices and must obey its schema. */
export function iconUsageGuide(editing = false) {
  return `### Icon usage: ${ICON_USAGE_POLICY}
Icons are optional presentation, never a substitute for readable labels, controls or business behavior.
Use ONLY exact keys in the current row-icon candidate set. Whole-request rank is not proof that an icon fits every row.
Compare each control's visible label (buttonLabel for buttons) with the candidate's name, tags and family. Do not infer icon meaning from IDs, event names, field defaults or unrelated body copy.
Unless the user explicitly requests otherwise, use restrained decoration: at most three distinct icons in a section, avoid repeated copies of one icon, and prefer one authored style on the same surface. Prefer the same variant when equally relevant alternatives exist.
Menu actions may use clear purpose-specific icons. Form/dialog footer and settings action buttons normally stay text-only. Static body copy and progress indicators normally have icon:null. Existing inline glyph labels do not need a second external icon.
Keep a menu group uniform: if any action lacks a suitable icon, keep the whole group text-only rather than mixing cells with shifted button edges. An all-button footer inside a mixed settings/form panel is an action area, not a separate menu.
An explicit standalone button arrangement cannot use external row icons in the current contract; keep icon:null there. The compiler owns the existing 24/28 logical pixel contain slots and spacing; do not invent icon geometry or change button text to force an icon to fit.
If no semantically suitable candidate exists, use icon:null and retain the complete readable text. Optional decoration does not require clarification. If the user explicitly requires an unavailable image or unsupported icon presentation, ask a specific question rather than silently dropping that requirement. Explicit user choices take precedence over these defaults when the public contract supports them.
${editing ? 'Editing: preserve the current exact asset choices unless an authorized operation removes their row. Do not rebalance or replace saved icons as a side effect of a title, theme, value or layout edit. This guidance grants no new patch operations; if requested resource changes are not in the authoritative operation list, ask a concrete clarification.' : 'Generation: decide row icons after resolving each row purpose and any explicit action layout. Do not decorate all rows merely because the request mentions a panel theme or one icon.'}`;
}
