/** Portable geometry for existing button-only sections; no executable layout or row rewriting. */
export function checkActionLayouts(spec, fail) {
  const layouts = spec.actionLayouts;
  if (!Array.isArray(layouts) || layouts.length > 32) fail('action-layout', '$.actionLayouts', 'at most 32 section arrangements required');
  const seen = new Set();
  layouts.forEach((value, index) => {
    const path = `$.actionLayouts[${index}]`, keys = ['sectionId', 'direction', 'align', 'gap', 'buttonWidth', 'buttonHeight', 'shape'];
    if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k)))
      fail('action-layout', path, 'complete section button layout required');
    const section = spec.sections.find(s => s.id === value.sectionId);
    if (!section || seen.has(value.sectionId)) fail('action-layout-target', path, 'existing unique section required');
    seen.add(value.sectionId);
    if (!section.rows.every(row => row.kind === 'button' && row.label === ''))
      fail('action-layout-rows', path, 'section must contain only standalone button rows');
    if (!['row', 'column'].includes(value.direction) || !['start', 'center', 'end'].includes(value.align)
      || !['default', 'circle'].includes(value.shape)) fail('action-layout', path, 'unsupported direction, alignment or shape');
    for (const key of ['gap', 'buttonWidth', 'buttonHeight']) {
      const min = key === 'gap' ? 0 : 44, max = key === 'gap' ? 128 : 512;
      if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) fail('action-layout-size', `${path}.${key}`, `integer ${min}..${max} required`);
    }
    if (value.shape === 'circle' && value.buttonWidth !== value.buttonHeight)
      fail('action-layout-circle', path, 'a circle requires equal width and height');
  });
}
