/** Programmatic preflight fixtures only; these must never count as real generation. */
export function inputStressFixture(item) {
  const state = [];
  const rows = item.expected.rows.map((wanted, i) => {
    const row = { id: `row${i}`, kind: wanted.kind, label: wanted.label,
      recipe: { id: `settings.${wanted.kind}`, version: '0.1.0' } };
    if (wanted.kind === 'text') return { ...row, text: wanted.text };
    Object.assign(row, { enabled: wanted.enabled, event: `panel.row${i}` });
    if (wanted.kind === 'button') return { ...row, label: '', buttonLabel: wanted.label,
      action: wanted.action === 'emit' ? { kind: 'emit' } : { kind: 'reset-initial',
        fields: wanted.resetLabels.map(label => `value${item.expected.rows.findIndex(row => row.label === label)}`) } };
    row.bind = `value${i}`;
    if (wanted.kind === 'slider') {
      state.push({ id: row.bind, type: 'number', initial: wanted.initial, min: wanted.min, max: wanted.max, step: wanted.step });
      row.format = { fractionDigits: wanted.step < 1 ? 1 : 0, prefix: '', suffix: '' };
    } else if (wanted.kind === 'switch') state.push({ id: row.bind, type: 'boolean', initial: wanted.initial });
    else if (wanted.kind === 'select') state.push({ id: row.bind, type: 'enum', initial: `option${wanted.options.indexOf(wanted.initialLabel)}`,
      options: wanted.options.map((label, i) => ({ id: `option${i}`, label })) });
    else throw new Error('STRESS_FIXTURE_KIND');
    return row;
  });
  const sections = (item.expected.groups ?? [item.expected.rows.map(row => row.label)]).map((labels, i) => ({
    id: `section${i}`, title: `分组${i + 1}`, rows: labels.map(label => rows[item.expected.rows.findIndex(row => row.label === label)]),
  }));
  const grid = item.expected.layout?.kind === 'grid';
  return { panelSpecVersion: '0.7', id: item.id, title: item.title,
    theme: { id: 'modern-mint-light', version: '0.1.0' }, canvas: { width: 1000, height: 1000 },
    layout: { width: grid ? 940 : 680, padding: 24, gap: 12, sectionGap: 20, labelWidth: 112,
      rowHeight: 56, titleHeight: 48, sectionTitleHeight: 32, maxHeight: item.expected.layout?.maxHeight ?? 840,
      overflow: item.expected.layout?.overflow ?? 'error', body: { id: 'stress-flow', kind: grid ? 'grid' : 'column',
        width: 'fill', align: 'start', gap: 20, ...(grid ? { minColumnWidth: 340 } : {}),
        children: sections.map(section => ({ kind: 'section', sectionId: section.id, width: 'fill' })) } },
    state, sections, tabs: null, assets: null,
    provenance: { kind: 'programmatic-fixture', description: 'Zero-model preflight fixture; not evidence of model success.', assumptions: [] } };
}
