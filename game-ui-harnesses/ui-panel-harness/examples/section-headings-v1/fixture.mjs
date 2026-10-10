/** Authored deterministic fixtures, never user task exports or model results. */
export function headingSpec(panel, catalog, { title = '音量控制面板', titles = ['音量'], labels = [['音量']], mode = 'auto', tabs = false, themeId = 'modern-blue-light' } = {}) {
  const theme = catalog.themes.find(theme => theme.id === themeId && (theme.headingStyle?.startsWith(mode === 'show' ? 'visible-' : 'concise-') || !theme.headingStyle));
  const ref = kind => { const recipe = catalog.recipes.find(value => value.kind === kind); return { id: recipe.id, version: recipe.version }; };
  let index = 0;
  const state = [], sections = titles.map((title, sectionIndex) => ({ id: `section${sectionIndex}`, title,
    rows: labels[sectionIndex].map(label => {
      const id = `row${index++}`;
      state.push({ id, type: 'number', initial: 57, min: 0, max: 100, step: 1 });
      return { id, kind: 'slider', recipe: ref('slider-row'), label, bind: id, enabled: true, event: `audio.${id}`,
        format: { fractionDigits: 0, prefix: '', suffix: '%' } };
    }) }));
  const navigation = tabs ? { id: 'audio-pages', recipe: ref('tabs'), bind: 'page', enabled: true, event: 'audio.page',
    pages: sections.map((section, i) => ({ id: `page${i}`, label: `${section.title}页`, sections: [section.id] })) } : null;
  if (navigation) state.push({ id: 'page', type: 'enum', initial: 'page0', options: navigation.pages.map(({ id, label }) => ({ id, label })) });
  return panel.validatePanelSpec({ panelSpecVersion: '0.7', id: 'heading-fixture', title,
    theme: { id: theme.id, version: theme.version }, assets: null, tabs: navigation,
    canvas: { width: 624, height: 560 }, layout: { width: 560, padding: 32, gap: 16, sectionGap: 20, labelWidth: 112,
      rowHeight: 56, titleHeight: 40, sectionTitleHeight: 32, maxHeight: 460, overflow: 'scroll',
      body: { id: 'body', kind: 'column', width: 'fill', gap: 20, align: 'start', children: sections.map(section => ({ kind: 'section', sectionId: section.id, width: 'fill' })) } },
    state, sections, provenance: { kind: 'programmatic-fixture', description: 'Owned section-heading regression fixture. Not a real model result or user task.', assumptions: [] } });
}
export const headingCases = [
  { id: 'single', headings: [] },
  { id: 'single-other-title', titles: ['调节选项'], headings: [] },
  { id: 'duplicate-panel', titles: ['音量控制'], headings: [] },
  { id: 'classified', titles: ['声音输出'], labels: [['音乐', '音效']], headings: ['声音输出'] },
  { id: 'duplicate-multi', title: '声音输出', titles: ['声音输出'], labels: [['音乐', '音效']], headings: [] },
  { id: 'distinct-groups', titles: ['音乐', '音效'], labels: [['音量'], ['音量']], headings: ['音乐', '音效'] },
  { id: 'explicit-show', mode: 'show', headings: ['音量'] },
  { id: 'single-dark', themeId: 'modern-blue-dark', headings: [] },
  { id: 'explicit-show-dark', themeId: 'modern-blue-dark', mode: 'show', headings: ['音量'] },
  { id: 'tabs', tabs: true, titles: ['音乐', '音效'], labels: [['音量'], ['音量']], headings: ['音乐', '音效'] },
];
export const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
