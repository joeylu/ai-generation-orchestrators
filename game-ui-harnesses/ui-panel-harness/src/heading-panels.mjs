/** Versioned heading chrome. Titles remain semantic Text children of noninteractive Panels. */
export const hasHeadingPanels = theme => theme?.headingSurface === 'panel-v1';
export const HEADING_PANEL_PADDING = 8;
export const headingPanelHeights = tokens => ({
  title:Math.max(64,Math.ceil(tokens.titleSize*1.3)+HEADING_PANEL_PADDING*2),
  section:Math.max(48,Math.ceil(tokens.headingSize*1.3)+HEADING_PANEL_PADDING*2),
});
