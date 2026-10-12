/** Versioned presentation; does not rewrite names, actions, or selection state. */
export function centeredCardTextIds(spec, theme) {
  if (spec.panelSpecVersion !== '0.15' || theme?.cardAlignment !== 'centered-v1') return [];
  return spec.sections.flatMap(section => {
    const images = section.rows.filter(row => row.kind === 'image');
    const buttons = section.rows.filter(row => row.kind === 'button');
    if (images.length !== 1 || buttons.length !== 1
      || !section.rows.every(row => ['image', 'text', 'button'].includes(row.kind))
      || buttons[0].label !== '' || buttons[0].action.kind !== 'emit') return [];
    return [`${spec.id}.section.${section.id}.title`,
      ...(images[0].source === null ? [`${spec.id}.row.${images[0].id}.control.placeholder`] : [])];
  });
}

/** Actual environment glyph measurements; reset only these text offsets to avoid drift. */
export function alignCardText(bundle, runtime) {
  const theme = bundle.catalog.themes.find(value => value.id === bundle.spec.theme.id && value.version === bundle.spec.theme.version);
  const ids = centeredCardTextIds(bundle.spec, theme);
  if (!ids.length) return;
  const initial = new Set(runtime.inspect().nodes.map(node => node.id));
  for (const id of ids) if (initial.has(id)) runtime.applyMotion(id, {x: 0});
  const nodes = new Map(runtime.inspect().nodes.map(node => [node.id, node]));
  for (const id of ids) {
    const node = nodes.get(id), glyph = node?.renderedTextBounds?.[0]?.bounds;
    if (!glyph) continue; // A legitimately suppressed heading has no rendered node.
    runtime.applyMotion(id, {x: (node.bounds.width - glyph.width) / 2 - (glyph.x - node.bounds.x)});
  }
}
