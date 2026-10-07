import {validateCatalog} from './catalog.mjs';

const accents = {mint:'薄荷绿 / mint / green',blue:'蓝色 / blue',violet:'紫色 / purple / violet',orange:'橙色 / orange'};

/** Reading aid only. The Agent interprets prose; exact catalog refs remain authoritative. */
export function themePlanningGuide(catalogInput, currentTheme, appearancePolicy) {
  const catalog = validateCatalog(catalogInput);
  const choices = catalog.themes.map(theme => {
    const match = /^modern-(mint|blue|violet|orange)-(light|dark)$/.exec(theme.id);
    return {themeKey:`${theme.id}@${theme.version}`, ...(['modern-v2', 'modern-v3'].includes(theme.visualStyle) && match ? {
      mode:match[2] === 'dark' ? '深色 / 暗色 / dark' : '浅色 / light', accent:accents[match[1]],
    } : {})};
  });
  const presentation = catalog.themes.some(theme => theme.visualStyle === 'modern-v3')
    ? 'Modern-v3 uses program-measured layouts: form fields have labels above their inputs, trailing form/dialog actions form a compact footer, settings keep list rows and menus keep stacked buttons. Preserve control order and all business actions. Do not add decorative row icons unless requested or needed to distinguish an explicitly described item; choose icon:null for ordinary form fields and confirm/cancel buttons. Do not repeat the panel heading as the only section heading. Geometry is owned by the compiler; do not invent unsupported controls or use text rows as layout spacers.\n' : '';
  const custom = currentTheme && appearancePolicy === 'panel-local-v1'
    ? 'This edit context also supports set-appearance for explicit arbitrary opaque #RRGGBB colors and uniform panel/control/button radii. Use its panel-local values instead of inventing catalog entries. Preserve unmentioned appearance fields. A preset theme switch preserves existing overrides unless the request also authorizes replacing/clearing them. A request for a green panel background means appearance.panelColor, not merely a green accent. Unsupported animation, per-corner radii or component-specific popup styling still require clarification of the entire request.\n' : '';
  return presentation + custom + `### Theme selection\n${JSON.stringify({choices, ...(currentTheme ? {currentThemeKey:`${currentTheme.id}@${currentTheme.version}`} : {defaultThemeKey:choices[0].themeKey})})}\n`
    + (currentTheme
      ? 'Preserve the exact current theme unless this edit explicitly requests a theme, light/dark mode or accent change. Changing business controls, wording, defaults or layout does not authorize a theme change. If only mode is requested, keep the current accent; if only accent is requested, keep the current mode. Use set-theme with current-request quotation evidence, never a design-choice basis. If the requested variant is absent from THIS pinned catalog and cannot be expressed by an advertised set-appearance operation, return a concrete clarification; do not replace the catalog, upgrade a saved theme, invent tokens, or change anything partially.\n'
      : 'Select an exact themeKey from THIS pinned catalog. If no style is requested, use its defaultThemeKey. For catalog choices with mode/accent labels: unspecified mode defaults to light and unspecified accent defaults to mint. Preserve explicitly requested mode and accent. Conflicting style requests or an unavailable color/mode require a concrete clarification; do not silently approximate an arbitrary hex color or invent a catalog entry.\n');
}
