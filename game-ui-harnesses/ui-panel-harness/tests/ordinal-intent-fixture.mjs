/** Mechanical conversion of owned test fixtures only; never repairs model output. */
export function ordinalFixture(input) {
  const intent = structuredClone(input), rows = [];
  const visit = node => {
    if (node.kind === 'tabs') node.pages.forEach(page => visit(page.body));
    else if (node.kind === 'section') rows.push(...node.rows);
    else node.children.forEach(visit);
  };
  if (intent.panel) {
    visit(intent.panel.body);
    const indices = new Map(rows.map((row, index) => [row.id, index]));
    for (const row of rows) {
      if (row.kind === 'button') {
        row.resetRows = row.resetRows.map(id => indices.get(id));
        row.submitRows = (row.submitRows ?? []).map(id => indices.get(id));
      }
      delete row.id;
    }
    const strip = node => {
      if (node.kind === 'tabs') node.pages.forEach(page => { delete page.id; strip(page.body); });
      else if (node.kind === 'section') delete node.id;
      else node.children.forEach(strip);
    };
    strip(intent.panel.body);
  }
  intent.panelIntentVersion = '0.7';
  return intent;
}
