// Geometry checks complement the existing actual screenshot pixel comparison.
export async function staticChildChecks(page, children, scale, parentBounds) {
  if (!children?.length) return [];
  const nodes = await page.evaluate(() => window.uiHarness.inspect().nodes);
  const cx = parentBounds.x + parentBounds.width / 2, cy = parentBounds.y + parentBounds.height / 2;
  return children.map(child => {
    const actual = nodes.find(n => n.id === child.nodeId);
    const expected = {x: cx + (child.rect[0] - cx) * scale,
      y: cy + (child.rect[1] - cy) * scale, width: child.rect[2] * scale, height: child.rect[3] * scale};
    return {slot: child.slot + '/geometry', visible: true, expected, actual: actual?.bounds,
      actualVisible: actual?.visible, clip: child.clip,
      pass: Boolean(actual?.visible && Object.keys(expected).every(k => Math.abs(actual.bounds[k] - expected[k]) < .05))};
  });
}
