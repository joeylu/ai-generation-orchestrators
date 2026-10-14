import { canonicalJson } from './canonical.mjs';
import { resolveTheme } from './catalog.mjs';

/** Versioned presentation only. Semantic titles and tab labels remain intact. */
export function sectionHeadingVisible(spec, section, headingStyle, legacyVisible = true) {
  if (['visible-v1','visible-v2','visible-v3','visible-v4'].includes(headingStyle)) return true;
  if(headingStyle==='concise-v4'){
    if(section.rows.every(row=>row.kind==='button'))return false;
    if(!spec.tabs)return spec.sections.length!==1;
    const page=spec.tabs.pages.find(page=>page.sections.includes(section.id));
    if(!page)return legacyVisible;
    const content=spec.sections.filter(group=>page.sections.includes(group.id)&&!group.rows.every(row=>row.kind==='button'));
    const heading=value=>value.trim().replace(/(?:界面|面板)$/,'');
    return content.length>1&&heading(section.title)!==heading(page.label);
  }
  if (headingStyle === 'concise-v3' && !spec.tabs && (spec.sections.length === 1 || section.rows.every(row => row.kind === 'button'))) return false;
  if (!['concise-v1','concise-v2','concise-v3'].includes(headingStyle)) return legacyVisible;
  if (spec.tabs || spec.sections.length !== 1) return true;
  if (section.rows.length === 1) return false;
  // Exact comparison after the same bounded terminal type suffix used by legacy themes.
  const heading = value => value.trim().replace(/(?:界面|面板)$/, '');
  return heading(spec.title) !== heading(section.title);
}

/** Explicit adoption can change only the heading policy of an otherwise equal theme. */
export function headingThemeTarget(spec, sourceCatalog, targetCatalog, mode) {
  if (!['auto', 'show'].includes(mode)) throw new Error('HEADING_MODE_INVALID');
  const policies = mode === 'show' ? ['visible-v4','visible-v3','visible-v2','visible-v1'] : ['concise-v4','concise-v3','concise-v2','concise-v1'];
  const visual = ({ version, headingStyle, ...theme }) => {
    // Image cards are a 0.15 presentation feature. Older Specs cannot contain
    // those rows; their explicit heading adoption retains its original geometry.
    if (!['0.15','0.16'].includes(spec.panelSpecVersion)) delete theme.cardAlignment;
    return canonicalJson(theme);
  };
  const current = resolveTheme(sourceCatalog, spec.theme);
  const target = policies.flatMap(policy => targetCatalog.themes.filter(theme => theme.headingStyle === policy && visual(theme) === visual(current)))[0];
  if (!target || sourceCatalog.recipes.some(recipe => !targetCatalog.recipes.some(other => canonicalJson(recipe) === canonicalJson(other))))
    throw new Error('HEADING_UPGRADE_UNAVAILABLE');
  return { id: target.id, version: target.version };
}
