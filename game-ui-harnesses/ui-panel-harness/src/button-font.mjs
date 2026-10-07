/** Logical pixels for inline button text/glyphs; independent of hit target geometry. */
export function checkButtonFontSize(value, fail, path) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 8 || value > 96)) {
    fail('button-font-size', path, 'must be null (inherit) or an integer from 8 through 96');
  }
}

export function checkButtonFonts(spec, fail) {
  if (!Array.isArray(spec.buttonFonts) || spec.buttonFonts.length > 128) fail('button-fonts', '$.buttonFonts', 'array of at most 128 overrides required');
  const buttons = new Set(spec.sections.flatMap(section => section.rows).filter(row => row.kind === 'button').map(row => row.id)), seen = new Set();
  spec.buttonFonts.forEach((entry, index) => {
    const path = `$.buttonFonts[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'rowId') || !Object.hasOwn(entry, 'fontSize')) fail('button-fonts', path, 'exact rowId and fontSize required');
    if (!buttons.has(entry.rowId) || seen.has(entry.rowId)) fail('button-font-target', path + '.rowId', 'unique existing button required');
    seen.add(entry.rowId);
    checkButtonFontSize(entry.fontSize, fail, path + '.fontSize');
    if (entry.fontSize === null) fail('button-fonts', path + '.fontSize', 'omit an inherited override');
  });
}

export function buttonFontSize(spec, rowId, inherited) {
  return spec.buttonFonts?.find(entry => entry.rowId === rowId)?.fontSize ?? inherited;
}
