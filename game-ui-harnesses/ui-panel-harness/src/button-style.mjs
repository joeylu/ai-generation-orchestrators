/** Complete, bounded per-button overrides; null fields inherit panel/theme values. */
export const BUTTON_STYLE_KEYS = Object.freeze(['backgroundColor', 'textColor', 'borderColor', 'borderWidth', 'cornerRadius', 'width', 'height', 'shape']);
export function checkButtonStyle(value, fail, path = '$.style') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== BUTTON_STYLE_KEYS.length || BUTTON_STYLE_KEYS.some(key => !Object.hasOwn(value, key)))
    fail('button-style', path, 'complete button style required');
  for (const key of ['backgroundColor', 'textColor', 'borderColor'])
    if (value[key] !== null && (typeof value[key] !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value[key]))) fail('button-style-color', `${path}.${key}`, 'opaque #RRGGBB or null required');
  for (const [key, min, max] of [['borderWidth', 0, 8], ['cornerRadius', 0, 128], ['width', 44, 512], ['height', 44, 512]])
    if (value[key] !== null && (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)) fail('button-style-size', `${path}.${key}`, `integer ${min}..${max} or null required`);
  if (value.shape !== null && !['default', 'circle'].includes(value.shape)) fail('button-style-shape', path, 'default, circle or null required');
  if (value.shape === 'circle' && value.width !== null && value.height !== null && value.width !== value.height) fail('button-style-circle', path, 'circle dimensions must be equal');
}
export function checkButtonStyles(spec, fail) {
  if (!Array.isArray(spec.buttonStyles) || spec.buttonStyles.length > 128) fail('button-styles', '$.buttonStyles', 'at most 128 overrides required');
  const seen = new Set(), rows = spec.sections.flatMap(section => section.rows);
  for (const [i, value] of spec.buttonStyles.entries()) {
    const path = `$.buttonStyles[${i}]`;
    if (!value || Object.keys(value).sort().join('|') !== 'rowId|style') fail('button-style', path, 'rowId and style required');
    const row = rows.find(row => row.id === value.rowId);
    if (!row || row.kind !== 'button' || seen.has(value.rowId)) fail('button-style-target', path, 'unique existing button required');
    seen.add(value.rowId); checkButtonStyle(value.style, fail, `${path}.style`);
    if (['width', 'height', 'shape'].some(key => value.style[key] !== null) && (row.label !== '' || spec.assets?.rowIcons.some(icon => icon.rowId === row.id)))
      fail('button-style-geometry', path, 'explicit button dimensions require standalone buttons without external row icons');
  }
}
