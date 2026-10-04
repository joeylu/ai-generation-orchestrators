/** Actual pointer acceptance of declared UI effects. No control-API state setup. */
export async function checkLayerUiInteractions(page, bundle) {
  const nodes = []; const parents = new Map();
  const visit = (node, parent) => { nodes.push(node); parents.set(node.id, parent); for (const child of node.children ?? []) visit(child, node.id); };
  visit(bundle.document.root);
  const internal = nodes.filter(n => n.type === 'Button' && n.props.interaction?.mode === 'internal');
  const external = nodes.filter(n => n.type === 'Button' && n.props.interaction?.mode === 'external').map(n => n.id);
  if (!internal.length) return { status: 'pass', scope: 'declared-effects-only', bindings: [], external };
  const source = id => nodes.find(n => n.id === id);
  const descendant = (id, owner) => { for (let current = id; current; current = parents.get(current)) if (current === owner) return true; return false; };
  const snapshot = () => page.evaluate(() => window.layerPlanCheck.snapshot());
  const click = async id => {
    const state = await snapshot(), current = state.inspection.nodes.find(n => n.id === id);
    const box = await page.locator('#check-canvas canvas').boundingBox();
    if (!box || !current?.visible) throw Error(`UI_INTERACTION_TARGET_UNREACHABLE: ${id}`);
    const bounds = current.bounds;
    await page.mouse.click(box.x + (bounds.x + bounds.width / 2) * box.width / bundle.document.canvas.width,
      box.y + (bounds.y + bounds.height / 2) * box.height / bundle.document.canvas.height);
  };
  const reachable = async id => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const state = await snapshot(), current = state.inspection.nodes.find(n => n.id === id);
      const dialogs = state.inspection.nodes.filter(n => n.type === 'Dialog' && n.visible && n.value === true && source(n.id).props.modal);
      const blocker = dialogs.at(-1);
      const visible = b => state.inspection.nodes.find(n => n.id === b.id)?.visible
        && state.inspection.nodes.find(n => n.id === b.id)?.enabled;
      if (blocker && !descendant(id, blocker.id)) {
        const close = internal.find(b => visible(b) && descendant(b.id, blocker.id)
          && b.props.interaction.effects.some(e => e.kind === 'dialog-open' && e.targetId === blocker.id && e.open === false));
        if (!close) throw Error(`UI_INTERACTION_MODAL_EXIT_MISSING: ${blocker.id}`);
        await click(close.id); continue;
      }
      if (current?.visible) return;
      const owners = nodes.filter(n => n.type === 'Dialog' && descendant(id, n.id));
      const closed = owners.find(n => state.inspection.nodes.find(item => item.id === n.id)?.value === false);
      const open = closed && internal.find(b => visible(b)
        && (!blocker || descendant(b.id, blocker.id))
        && b.props.interaction.effects.some(e => e.kind === 'dialog-open' && e.targetId === closed.id && e.open === true));
      if (!open) throw Error(`UI_INTERACTION_TARGET_UNREACHABLE: ${id}`);
      await click(open.id);
    }
    throw Error(`UI_INTERACTION_PATH_LIMIT: ${id}`);
  };
  const bindings = [];
  for (const button of internal) {
    const initial = await page.evaluate(value => window.layerPlanCheck.check(value), bundle);
    if (initial.status !== 'pass') throw Error('UI_INTERACTION_RESET_FAILED');
    await reachable(button.id);
    const before = await snapshot(), count = before.events.filter(e => e.id === button.id && e.type === 'activate').length;
    const enabled = before.inspection.nodes.find(n => n.id === button.id).enabled;
    await click(button.id);
    const after = await snapshot(), activations = after.events.filter(e => e.id === button.id && e.type === 'activate').length - count;
    if (activations !== (enabled ? 1 : 0)) throw Error(`UI_INTERACTION_ACTIVATION_FAILED: ${button.id}`);
    for (const effect of button.props.interaction.effects) {
      const target = after.inspection.nodes.find(n => n.id === effect.targetId);
      if (effect.kind === 'dialog-open' && enabled && target.value !== effect.open) throw Error(`UI_INTERACTION_DIALOG_FAILED: ${button.id}`);
      if (effect.kind === 'input-step') {
        const prior = before.inspection.nodes.find(n => n.id === effect.targetId).value;
        const expected = enabled ? String(Math.min(effect.max, Math.max(effect.min, Number(prior) + effect.delta))) : prior;
        if (target.value !== expected) throw Error(`UI_INTERACTION_STEP_FAILED: ${button.id}`);
      }
      if (effect.kind === 'copy-text' && enabled && !target.renderedTextBounds?.some(text => text.text === source(effect.sourceId).props.text)) throw Error(`UI_INTERACTION_TEXT_FAILED: ${button.id}`);
      if (effect.kind === 'copy-image' && enabled && !after.document.interactionState?.copies.some(copy => copy.targetId === effect.targetId && copy.sourceId === effect.sourceId)) throw Error(`UI_INTERACTION_IMAGE_FAILED: ${button.id}`);
    }
    bindings.push({ buttonId: button.id, status: 'pass', input: 'actual-mouse', enabled, activations });
  }
  const restored = await page.evaluate(value => window.layerPlanCheck.check(value), bundle);
  if (restored.status !== 'pass') throw Error('UI_INTERACTION_RESTORE_FAILED');
  return { status: 'pass', scope: 'declared-effects-only', bindings, external };
}
