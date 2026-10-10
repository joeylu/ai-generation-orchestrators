import { canonicalJson } from './canonical.mjs';
import { resolveTheme } from './catalog.mjs';

/** Versioned presentation only. Semantic titles and tab labels remain intact. */
export function sectionHeadingVisible(spec, section, headingStyle, legacyVisible = true) {
  if (headingStyle === 'visible-v1') return true;
  if (headingStyle !== 'concise-v1') return legacyVisible;
  if (spec.tabs || spec.sections.length !== 1) return true;
  if (section.rows.length === 1) return false;
  // Exact comparison after the same bounded terminal type suffix used by legacy themes.
  const heading = value => value.trim().replace(/(?:界面|面板)$/, '');
  return heading(spec.title) !== heading(section.title);
}

/** Explicit adoption can change only the heading policy of an otherwise equal theme. */
export function headingThemeTarget(spec, sourceCatalog, targetCatalog, mode) {
  if (!['auto', 'show'].includes(mode)) throw new Error('HEADING_MODE_INVALID');
  const headingStyle = mode === 'show' ? 'visible-v1' : 'concise-v1';
  const visual = ({ version, headingStyle, ...theme }) => canonicalJson(theme);
  const current = resolveTheme(sourceCatalog, spec.theme);
  const target = targetCatalog.themes.find(theme => theme.headingStyle === headingStyle && visual(theme) === visual(current));
  if (!target || sourceCatalog.recipes.some(recipe => !targetCatalog.recipes.some(other => canonicalJson(recipe) === canonicalJson(other))))
    throw new Error('HEADING_UPGRADE_UNAVAILABLE');
  return { id: target.id, version: target.version };
}
