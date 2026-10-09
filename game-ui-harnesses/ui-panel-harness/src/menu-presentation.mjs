import {buttonFontSize} from './button-font.mjs';

/** Structural scope only: labels, section titles and action semantics are never inferred. */
export function isStandaloneMenu(spec) {
  return !spec.tabs && spec.sections.length === 1 && !(spec.assets?.rowIcons.length)
    && spec.sections[0].rows.every(row => row.kind === 'button' && row.label === '');
}

export function panelThemeTokens(spec, theme) {
  return theme.surfaceStyle === 'minimal-v2' && isStandaloneMenu(spec) ? theme.menuTokens : theme.tokens;
}

/** Existing explicit actionLayouts are handled first by the shared presentation policy. */
export function measurePolishedMenu(spec, tokens, section, width, showTitle, geometry) {
  const natural = Math.max(280, ...section.rows.map(row => Math.ceil([...row.buttonLabel].reduce((sum, char) =>
    sum + (/^[\x00-\x7f]$/.test(char) ? .8 : 1.1), 0) * buttonFontSize(spec, row.id, tokens.fontSize)) + 32));
  const sizes = section.rows.map(row => geometry(row, Math.min(width, natural), 48));
  if (sizes.some(size => size.width > width)) { const error = new Error('Menu button exceeds its section'); error.code = 'ACTION_LAYOUT_OVERFLOW'; throw error; }
  let y = showTitle ? spec.layout.sectionTitleHeight + spec.layout.gap : 0;
  const rows = sizes.map((size, index) => {
    const height = Math.max(spec.layout.rowHeight, size.height);
    const place = {y,height,explicitAction:true,controlX:(width-size.width)/2,controlWidth:size.width,
      controlHeight:size.height,circle:size.circle};
    y += height + (index < sizes.length - 1 ? 12 : 0); return place;
  });
  // A hidden duplicate heading still needs the pinned section recipe's 80px slot.
  return {purpose:'menu',showTitle,grouped:false,height:Math.max(80,y),rows};
}
