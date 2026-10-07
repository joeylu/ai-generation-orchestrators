/** Opt-in modern-v3 geometry. Typed controls determine presentation; actions remain unchanged. */
export const presentationTextWidth = (value, size) => Math.ceil([...value].reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? size * 0.8 : size * 1.1), 0));

export function sectionPurpose(section) {
  const kinds = section.rows.map(row => row.kind);
  if (kinds.every(kind => kind === 'button')) return 'menu';
  if (kinds.includes('input') && kinds.every(kind => ['input', 'text', 'button'].includes(kind))) return 'form';
  if (kinds.includes('button') && kinds.every(kind => ['text', 'button'].includes(kind))) return 'dialog';
  return 'settings';
}

export function createPresentationPolicy(spec, tokens) {
  const l = spec.layout, textHeight = Math.ceil(tokens.fontSize * 1.3);
  const icons = new Set((spec.assets?.rowIcons ?? []).map(icon => icon.rowId));
  const heading = value => value.trim().replace(/(?:界面|面板)$/, '');
  return (section, width) => {
    const purpose = sectionPurpose(section), compact = ['form', 'dialog'].includes(purpose);
    const showTitle = !(compact && !spec.tabs && spec.sections.length === 1 && heading(spec.title) === heading(section.title));
    const titleHeight = showTitle ? l.sectionTitleHeight + l.gap : 0;
    const placements = [], primary = compact
      ? section.rows.find(row => row.kind === 'button' && row.action.kind === 'submit')
        ?? section.rows.find(row => row.kind === 'button' && row.action.kind === 'emit') : null;
    const buttonWidth = row => Math.max(120, presentationTextWidth(row.buttonLabel, tokens.fontSize) + 32) + (icons.has(row.id) ? 40 : 0);
    let footerStart = section.rows.length;
    if (compact) while (footerStart > 0 && section.rows[footerStart - 1].kind === 'button' && section.rows[footerStart - 1].label === '') footerStart--;
    const footer = section.rows.slice(footerStart), footerWidth = footer.reduce((sum, row) => sum + buttonWidth(row), 0) + Math.max(0, footer.length - 1) * l.gap;
    const grouped = footer.length > 1 && footerWidth <= width - 24;
    let y = titleHeight;
    for (const [index, row] of section.rows.entries()) {
      const stacked = purpose === 'form' && row.kind === 'input';
      const height = row.kind === 'input' ? Math.max(l.rowHeight, stacked ? 2 * textHeight + 60 : Math.max(80, textHeight + 48))
        : Math.max(l.rowHeight, 56);
      const placement = { y, height, stacked, buttonRole: compact && row.kind === 'button' ? row === primary ? 'primary' : 'secondary' : null };
      if (grouped && index >= footerStart) {
        const cellX = width - 12 - footerWidth + footer.slice(0, index - footerStart).reduce((sum, item) => sum + buttonWidth(item) + l.gap, 0);
        placement.controlX = cellX + (icons.has(row.id) ? 40 : 0);
        placement.controlWidth = buttonWidth(row) - (icons.has(row.id) ? 40 : 0);
        placement.iconX = cellX;
      }
      placements.push(placement);
      if (!(grouped && index >= footerStart && index < section.rows.length - 1)) y += height + (index < section.rows.length - 1 ? l.gap : 0);
    }
    return { purpose, showTitle, grouped, height: Math.max(80, y), rows: placements };
  };
}
