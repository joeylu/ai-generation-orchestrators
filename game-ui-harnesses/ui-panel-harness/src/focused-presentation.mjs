import { hasTextWrap, wrapStaticText } from './text-wrap.mjs';
import { buttonFontSize } from './button-font.mjs';

// Opt-in geometry only. Never changes order, labels, action scopes or values.
export function measureFocusedSection(spec, tokens, section, width, purpose, geometry, titleOverride) {
  const l = spec.layout, line = Math.ceil(tokens.fontSize * 1.3);
  const textWidth = (value, size) => Math.ceil([...value].reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? size * .8 : size * 1.1), 0));
  const icons = new Set((spec.assets?.rowIcons ?? []).map(icon => icon.rowId));
  const local = new Map((spec.buttonStyles ?? []).map(entry => [entry.rowId, entry.style]));
  const heading = value => value.trim().replace(/(?:界面|面板)$/, '');
  const showTitle = titleOverride ?? !(!spec.tabs && spec.sections.length === 1 && heading(spec.title) === heading(section.title));
  const standalone = row => row.kind === 'button' && row.label === '';
  // A labelled action is still a list row; preserve its original label/value layout.
  if (purpose === 'menu' && !section.rows.every(standalone)) return null;
  const naturalWidth = row => Math.max(112, textWidth(row.buttonLabel, buttonFontSize(spec, row.id, tokens.fontSize)) + 32);
  const menuWidth = Math.min(width - (section.rows.some(row => icons.has(row.id)) ? 40 : 0), Math.max(240, ...section.rows.filter(standalone).map(naturalWidth)));
  const size = row => geometry(row, purpose === 'menu' ? menuWidth : Math.min(width - (icons.has(row.id) ? 40 : 0), naturalWidth(row)),
    Math.max(44, Math.ceil(buttonFontSize(spec, row.id, tokens.fontSize) * 1.3) + 8));
  const sizes = new Map(section.rows.filter(standalone).map(row => [row.id, size(row)]));
  let footerStart = section.rows.length;
  if (purpose !== 'menu') while (footerStart && standalone(section.rows[footerStart - 1])) footerStart--;
  const footer = section.rows.slice(footerStart), cellWidth = row => sizes.get(row.id).width + (icons.has(row.id) ? 40 : 0);
  const footerWidth = footer.reduce((sum, row) => sum + cellWidth(row), 0) + Math.max(0, footer.length - 1) * l.gap;
  const grouped = footer.length > 1 && footerWidth <= width;
  const footerHeight = Math.max(l.rowHeight, 56, ...footer.map(row => sizes.get(row.id).height));
  let y = showTitle ? l.sectionTitleHeight + l.gap : 0;
  const rows = [];
  for (const [index, row] of section.rows.entries()) {
    if (index === footerStart && index > 0) y += Math.max(8, l.gap);
    const inset = icons.has(row.id) ? 12 : 0;
    const copy = row.kind === 'text', textBlock = copy && hasTextWrap(spec,row.id) ? wrapStaticText(row.text, width - inset * 2, tokens.fontSize) : null;
    const copyTextY = row.label ? line + 8 : 0;
    const button = sizes.get(row.id), inFooter = index >= footerStart;
    const height = copy ? Math.max(l.rowHeight, 56, copyTextY + (textBlock?.height ?? line))
      : row.kind === 'input' ? Math.max(l.rowHeight, line * 2 + 60)
      : button ? grouped && inFooter ? footerHeight : Math.max(l.rowHeight, 56, button.height) : Math.max(l.rowHeight, 56);
    const placement = { y, height, stacked: copy || row.kind === 'input', buttonRole: null,
      ...(copy || row.kind === 'input' ? {labelX:inset, labelY:0, controlX:inset, controlWidth:width-inset*2} : {}),
      ...(copy ? {copy:true, copyTextY, textBlock, allowPartialScroll:Boolean(textBlock)} : {}) };
    if (button) {
      const icon = icons.has(row.id) ? 40 : 0;
      const cellX = grouped && inFooter ? width - footerWidth + footer.slice(0,index-footerStart).reduce((sum,r)=>sum+cellWidth(r)+l.gap,0)
        : purpose === 'menu' ? (width - button.width - icon) / 2 : width - button.width - icon;
      if (cellX < 0) { const error = new Error('Button and icon exceed their section width'); error.code = 'ACTION_LAYOUT_OVERFLOW'; throw error; }
      Object.assign(placement, {controlX:cellX+icon,controlWidth:button.width,controlHeight:button.height,circle:button.circle,explicitAction:true,iconX:cellX});
    }
    rows.push(placement);
    if (!(grouped && inFooter && index < section.rows.length-1)) y += height + (index < section.rows.length-1 ? l.gap : 0);
  }
  return {purpose,showTitle,grouped,height:Math.max(80,y),rows};
}
