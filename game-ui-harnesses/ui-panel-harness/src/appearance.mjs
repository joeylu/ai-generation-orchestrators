/** Portable, panel-local styling. Null values inherit the pinned catalog theme. */
export const APPEARANCE_COLORS = Object.freeze([
  'canvasColor', 'panelColor', 'controlColor', 'accentColor', 'textColor',
  'mutedColor', 'borderColor', 'buttonColor', 'buttonTextColor',
]);
export const APPEARANCE_RADII = Object.freeze(['panelRadius', 'controlRadius', 'buttonRadius']);
export const APPEARANCE_KEYS = Object.freeze([...APPEARANCE_COLORS, ...APPEARANCE_RADII]);

// Called only after the containing JSON has been safely snapshotted.
export function checkAppearance(value, fail, path = '$.appearance') {
  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('appearance-object', path, 'must be null or an appearance object');
  for (const key of Object.keys(value)) if (!APPEARANCE_KEYS.includes(key)) fail('unknown-key', `${path}.${key}`, 'unknown appearance field');
  for (const key of APPEARANCE_KEYS) if (!Object.hasOwn(value, key)) fail('required', `${path}.${key}`, 'use null to inherit an unmodified value');
  for (const key of APPEARANCE_COLORS) if (value[key] !== null && (typeof value[key] !== 'string' || !/^#[0-9a-fA-F]{6}$(?![\s\S])/.test(value[key])))
    fail('appearance-color', `${path}.${key}`, 'must be null or an opaque #RRGGBB color');
  for (const key of APPEARANCE_RADII) if (value[key] !== null && (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 128))
    fail('appearance-radius', `${path}.${key}`, 'must be null or an integer in 0..128');
}

export function appearanceTokens(tokens, appearance) {
  const mapping = { canvasColor: 'background', panelColor: 'surface', controlColor: 'control',
    accentColor: 'accent', textColor: 'text', mutedColor: 'muted', borderColor: 'border' };
  return { ...tokens, ...Object.fromEntries(Object.entries(mapping).filter(([key]) => appearance?.[key] != null)
    .map(([key, token]) => [token, appearance[key]])) };
}
