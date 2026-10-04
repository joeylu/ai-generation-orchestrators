/** Fixture producer only: explicit expectations, never model generation evidence. */
export function intentFixture(context, item) {
  const rows = item.expected.rows.map((r, i) => ({ id: `row${i}`, kind: r.kind, label: r.label,
    recipeKey: `settings.${r.kind}@0.1.0`, sourceQuote: context.request.text, icon: null,
    ...(r.kind === 'text' ? { text: r.text } : { enabled: r.enabled }),
    ...(r.kind === 'slider' ? { min: r.min, max: r.max, step: r.step, initial: r.initial, prefix: '', suffix: '' } : {}),
    ...(r.kind === 'switch' ? { initial: r.initial } : {}),
    ...(r.kind === 'select' ? { options: r.options, initialLabel: r.initialLabel } : {}),
    ...(r.kind === 'button' ? { action: r.action, resetRows: r.resetLabels.map(label => `row${item.expected.rows.findIndex(row => row.label === label)}`) } : {}) }));
  const split = item.id === 'eval-character' ? 1 : 2;
  const sections = item.expected.groups ? item.expected.groups.map((group, i) => ({ id: `group${i}`, title: `分组${i + 1}`, sourceQuote: null,
    rows: group.map(label => rows.find(row => row.label === label)) })) : item.expected.layout?.kind === 'grid'
    ? [{ id: 'first', title: '第一组', sourceQuote: null, rows: rows.slice(0, split) }, { id: 'second', title: '第二组', sourceQuote: null, rows: rows.slice(split) }]
    : [{ id: 'main', title: '设置', sourceQuote: null, rows }];
  return { panelIntentVersion: '0.1', contextSha256: context.sha256, unresolved: [], panel: {
    id: item.id, title: item.title, sourceQuote: context.request.text, themeKey: 'modern-mint-light@0.1.0', panelSurface: null,
    layout: { width: item.expected.layout?.width ?? null, canvasWidth: item.expected.layout?.canvasWidth ?? null,
      canvasHeight: null, maxHeight: item.expected.layout?.maxHeight ?? null, overflow: item.expected.layout?.overflow ?? 'auto',
      body: item.expected.bodyShape ? (function convert(node) { return node.kind === 'section' ? { kind: 'section', sectionId: sections[node.index].id }
        : { kind: node.kind, children: node.children.map(convert) }; })(item.expected.bodyShape)
        : item.expected.layout ? { kind: item.expected.layout.kind, children: sections.map(section => ({ kind: 'section', sectionId: section.id })) } : null,
      sourceQuote: item.expected.layout ? context.request.text : null }, sections } };
}

export function embeddedIntentFixture(context, item) {
  const original = intentFixture(context, item), { sections, layout, ...panel } = original.panel;
  const transform = node => {
    if (node.kind !== 'section') return { kind: node.kind, children: node.children.map(transform) };
    const section = sections.find(section => section.id === node.sectionId);
    return { kind: 'section', ...section, rows: section.rows.map(row => {
      if (row.kind !== 'select') return row;
      const { initialLabel, ...rest } = row;
      return { ...rest, options: row.options.map(label => ({ label, initial: label === initialLabel })) };
    }) };
  };
  const { body, ...settings } = layout;
  return { ...original, panelIntentVersion: '0.2', panel: { ...panel, layout: settings,
    body: transform(body ?? { kind: 'column', children: sections.map(section => ({ kind: 'section', sectionId: section.id })) }) } };
}

export function compactIntentFixture(context, item) {
  const original = embeddedIntentFixture(context, item), { sourceQuote, layout, ...panel } = original.panel;
  const { sourceQuote: layoutQuote, ...settings } = layout;
  const remove = node => {
    if (node.kind !== 'section') return { ...node, children: node.children.map(remove) };
    const { sourceQuote, ...section } = node; return section;
  };
  return { ...original, panelIntentVersion: '0.3', panel: { ...panel, layout: settings, body: remove(panel.body) } };
}
