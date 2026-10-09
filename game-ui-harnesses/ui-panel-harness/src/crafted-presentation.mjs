/** Compact audio/settings composition. Explicit action layouts remain authoritative. */
export function measureCraftedSettings(spec, tokens, section, width, purpose, showTitle) {
  if (purpose !== 'settings' || section.rows.some(row => !['slider','switch','progress'].includes(row.kind))) return null;
  const icons = new Set((spec.assets?.rowIcons ?? []).map(icon => icon.rowId));
  let y = showTitle ? spec.layout.sectionTitleHeight + 12 : 0;
  const rows = section.rows.map((row, index) => {
    const slider = row.kind === 'slider', height = Math.max(spec.layout.rowHeight, slider ? 68 : 56);
    const place = {y, height, stacked:slider, labelX:0, labelY:slider ? 0 : (height-Math.ceil(tokens.fontSize*1.3))/2,
      iconX:0, ...(slider ? {controlX:icons.has(row.id) ? 40 : 0, controlWidth:width-(icons.has(row.id) ? 40 : 0), sliderStack:true, iconY:0} : {})};
    y += height + (index < section.rows.length-1 ? 16 : 0);
    return place;
  });
  return {purpose, showTitle, grouped:false, height:y, rows};
}
