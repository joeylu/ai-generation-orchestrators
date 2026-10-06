/** Deterministic PanelSpec 0.4 geometry. The caller validates the input contract. */
import { pageLayout } from './tabs.mjs';
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const offset = (space, align) => align === 'center' ? space / 2 : align === 'end' ? space : 0;
const positive = value => Number.isFinite(value) && value > 0;

export function measureFlowLayout(spec) {
  const l = spec.layout, width = Math.min(l.width, spec.canvas.width);
  const bodyWidth = width - l.padding * 2;
  const bodyY = l.padding + l.titleHeight + l.gap;
  const chromeHeight = bodyY + l.padding;
  const sectionsById = new Map(spec.sections.map(section => [section.id, section]));
  const sectionHeight = section => l.sectionTitleHeight + l.gap
    + section.rows.length * l.rowHeight + (section.rows.length - 1) * l.gap;
  if (!positive(bodyWidth)) fail('LAYOUT_GEOMETRY', 'Panel padding must leave positive content width');

  function measure(node, availableWidth) {
    const ownWidth = node.width === 'fill' ? availableWidth : node.width;
    if (!positive(ownWidth)) fail('LAYOUT_GEOMETRY', 'Every flow node needs positive width');
    if (ownWidth > availableWidth) fail('LAYOUT_OVERFLOW', 'Explicit flow width exceeds its available slot');
    if (node.kind === 'section') {
      const section = sectionsById.get(node.sectionId);
      if (!section) fail('LAYOUT_GEOMETRY', 'Flow section reference does not exist');
      const height = sectionHeight(section);
      return { width: ownWidth, height, sections: [{ id: section.id, x: 0, y: 0, width: ownWidth, height }] };
    }
    const count = node.children.length;
    let columns = node.kind === 'column' ? 1 : node.kind === 'row' ? count
      : 2 * node.minColumnWidth + node.gap <= ownWidth ? 2 : 1;
    columns = Math.min(columns, count);
    const slotWidth = (ownWidth - node.gap * (columns - 1)) / columns;
    if (!positive(slotWidth)) fail('LAYOUT_GEOMETRY', 'Flow gaps must leave positive child slots');
    const children = node.children.map(child => measure(child, slotWidth));
    const result = [], rowHeights = [];
    for (let index = 0; index < children.length; index += columns) {
      rowHeights.push(Math.max(...children.slice(index, index + columns).map(child => child.height)));
    }
    let rowY = 0;
    for (let row = 0; row < rowHeights.length; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const child = children[row * columns + column]; if (!child) continue;
        const x = column * (slotWidth + node.gap)
          + (node.kind === 'row' ? 0 : offset(slotWidth - child.width, node.align));
        const y = rowY + (node.kind === 'column' ? 0 : offset(rowHeights[row] - child.height, node.align));
        result.push(...child.sections.map(section => ({ ...section, x: section.x + x, y: section.y + y })));
      }
      rowY += rowHeights[row] + (row + 1 < rowHeights.length ? node.gap : 0);
    }
    return { width: ownWidth, height: rowY, sections: result };
  }

  // The first pass decides whether scrolling is needed. Reserve a visual gutter
  // (the programmatic runtime has no scrollbar chrome); remeasure if columns collapse.
  let measured = measure(l.body, bodyWidth), scrollable = false, reserve = 0;
  let viewportWidth = bodyWidth, panelHeight, viewportHeight;
  const fields = new Map(spec.state.map(field => [field.id, field]));
  for (let pass = 0; pass < 3; pass += 1) {
    const availableHeight = Math.min(l.maxHeight, spec.canvas.height - reserve);
    const naturalHeight = chromeHeight + measured.height;
    if (!scrollable && naturalHeight > availableHeight) {
      if (l.overflow !== 'scroll') fail('LAYOUT_OVERFLOW', 'Flow content exceeds the declared panel height');
      scrollable = true;
      reserve = Math.max(0, ...spec.sections.flatMap(section => section.rows)
        .filter(row => row.kind === 'select').map(row => 40 * fields.get(row.bind).options.length + 2));
      viewportWidth = bodyWidth - 16;
      if (!positive(viewportWidth)) fail('LAYOUT_GEOMETRY', 'The scroll gutter leaves no content width');
      measured = measure(l.body, viewportWidth);
      continue;
    }
    panelHeight = Math.min(naturalHeight, availableHeight);
    viewportHeight = panelHeight - chromeHeight;
    if (!positive(panelHeight) || !positive(viewportHeight)
        || (scrollable && viewportHeight < l.rowHeight)) {
      fail('LAYOUT_OVERFLOW', 'The scroll viewport must fit one complete row after title and popup clearance');
    }
    break;
  }
  if (!positive(panelHeight) || !positive(viewportHeight)) fail('LAYOUT_GEOMETRY', 'Flow measurement did not converge');
  return {
    width, panelHeight, panelX: (spec.canvas.width - width) / 2,
    panelY: (spec.canvas.height - reserve - panelHeight) / 2,
    body: { x: l.padding, y: bodyY, width: viewportWidth, height: viewportHeight },
    contentHeight: measured.height, scrollable, sections: measured.sections,
  };
}

/** Fixed header, independent page scroll offsets, stable panel height across navigation. */
export function measureTabbedLayout(spec) {
  if (!spec.tabs) return measureFlowLayout(spec);
  const header = 48, gap = spec.layout.gap;
  const overhead = header + gap;
  const measurePages = maxHeight => spec.tabs.pages.map(page => measureFlowLayout({ ...spec,
    sections: spec.sections.filter(section => page.sections.includes(section.id)),
    canvas: { ...spec.canvas, height: spec.canvas.height - overhead },
    layout: { ...spec.layout, maxHeight, body: pageLayout(spec.layout.body, page.sections) },
  }));
  let layouts = measurePages(spec.layout.maxHeight - overhead);
  // Popup clearance is shared across pages; a short page with many choices
  // must not leave the larger page below the canvas edge.
  const reserve = Math.max(...layouts.map(layout => spec.canvas.height - overhead - layout.panelHeight - layout.panelY * 2));
  layouts = measurePages(Math.min(spec.layout.maxHeight - overhead, spec.canvas.height - overhead - reserve));
  const largest = layouts.reduce((a, b) => a.panelHeight >= b.panelHeight ? a : b);
  const panelHeight = largest.panelHeight + overhead;
  const contentHeight = largest.body.height;
  return { width: largest.width, panelHeight, panelX: largest.panelX, panelY: (spec.canvas.height - reserve - panelHeight) / 2,
    body: { ...largest.body, width: largest.width - spec.layout.padding * 2, height: contentHeight + overhead },
    sections: layouts.flatMap((layout, index) => layout.sections.map(section => ({ ...section, pageId: spec.tabs.pages[index].id }))),
    pages: layouts.map((layout, index) => ({ id: spec.tabs.pages[index].id, ...layout, viewportHeight: contentHeight })),
    headerHeight: header, pageY: overhead,
  };
}
