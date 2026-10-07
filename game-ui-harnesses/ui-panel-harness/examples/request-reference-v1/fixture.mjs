/** Convert owned 0.7 expectation fixtures only. Never call this on model output. */
export function requestReferenceFixture(input) {
  if (input.panelIntentVersion !== '0.7') throw new Error('FIXTURE_VERSION');
  const intent = structuredClone(input);
  const replace = node => {
    if (!Object.hasOwn(node, 'sourceQuote')) throw new Error('FIXTURE_SOURCE');
    delete node.sourceQuote; node.sourceRef = 'request';
  };
  const visit = node => {
    if (node.kind === 'tabs') { replace(node); node.pages.forEach(page => { replace(page); visit(page.body); }); }
    else if (node.kind === 'section') node.rows.forEach(replace);
    else node.children.forEach(visit);
  };
  if (intent.panel) visit(intent.panel.body);
  intent.panelIntentVersion = '0.8';
  return intent;
}
