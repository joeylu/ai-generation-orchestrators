/** Root-level horizontal page navigation. Each section belongs to exactly one page. */
export const navigationRows = spec => spec.tabs ? [{ ...spec.tabs, kind: 'tabs' }] : [];
export const tabPageId = (specId, pageId) => `${specId}.page.${pageId}`;
export function pageLayout(body, sectionIds) {
  const wanted = new Set(sectionIds);
  const prune = node => {
    if (node.kind === 'section') return wanted.has(node.sectionId) ? structuredClone(node) : null;
    const children = node.children.map(prune).filter(Boolean);
    return children.length ? { ...node, children } : null;
  };
  return prune(body);
}
