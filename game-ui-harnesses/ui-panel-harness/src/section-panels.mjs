/** Semantic content groups own one noninteractive surface; action/message groups stay plain. */
export const hasSectionPanels = theme => ['panel-v1','panel-v2'].includes(theme?.sectionSurface);
export const SECTION_PANEL_PADDING = 12;
export const sectionHasPanel = (section, theme) => hasSectionPanels(theme)
  && section.rows.some(row => !['button', 'text'].includes(row.kind) || theme.sectionSurface==='panel-v2' && row.kind==='text' && row.recipe.id==='settings.text');
