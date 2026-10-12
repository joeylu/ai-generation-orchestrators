import { canonical, isId, readBytes, readJson, requireThat, seal, storeBlob, jsonBytes, validationMemo, validationScope, verifyBlob, exact, unseal } from './common.mjs';
import { canvas, decodePng, encodePng, rectangle } from './png.mjs';

const intersect = (a, b) => {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
  return [x, y, Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - x), Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - y)];
};
export function visualStructure(document) {
  const nodes = [], full = [0, 0, document.canvas.width, document.canvas.height];
  function visit(node, parentX, parentY, clip) {
    const { x, y, width, height } = node.layout;
    const box = [parentX + x, parentY + y, width, height], visible = intersect(box, clip);
    if (!visible[2] || !visible[3]) return;
    const copy = {};
    // Only visible authored copy/state crosses into the reference contract. No bindings or events.
    for (const field of ['text', 'label', 'placeholder', 'value', 'checked', 'selectedId', 'activeId', 'min', 'max', 'options', 'tabs']) {
      if (Object.hasOwn(node.props ?? {}, field)) copy[field] = structuredClone(node.props[field]);
    }
    nodes.push({ id: node.id, type: node.type, box, visibleBox: visible, content: copy });
    let children = node.children ?? [];
    if (node.type === 'Tabs') {
      const selected = node.props.tabs.find(tab => tab.id === node.props.activeId);
      requireThat(selected, 'TAB_SELECTION_INVALID');
      children = children.filter(child => child.id === selected.contentId);
    }
    for (const child of children) visit(child, box[0], box[1], node.type === 'ScrollView' ? intersect(clip, box) : clip);
  }
  visit(document.root, 0, 0, full);
  return nodes;
}
export function neutralPrototype(size, nodes) {
  const image = canvas(size.width, size.height);
  for (const node of nodes) {
    const fill = node.type === 'Text' ? '#999999' : ['Container', 'ScrollView'].includes(node.type) ? '#EAEAEA' : '#CCCCCC';
    rectangle(image, node.visibleBox, fill, node.type === 'Text' ? '#999999' : '#555555');
  }
  return encodePng(image);
}
export async function importPanel(root, { bundle = null, spec = null, catalog = null, preview = null }) {
  requireThat(Boolean(bundle) !== Boolean(spec) && (!spec || catalog), 'PANEL_INPUT_REQUIRED');
  // Read-only adapter to current public producers; no producer directories are copied.
  const [{ loadWorkspaceCore }, { createPanelBundle, validatePanelBundle }] = await Promise.all([
    import('../../ui-panel-harness/src/component-adapter.mjs'), import('../../ui-panel-harness/src/panel-bundle.mjs')]);
  const core = await loadWorkspaceCore();
  const upstream = bundle ? await validatePanelBundle(readJson(bundle), core)
    : await createPanelBundle(readJson(spec), readJson(catalog), core);
  requireThat(isId(upstream.spec.id), 'PANEL_ID_UNSUPPORTED');
  const nodes = visualStructure(upstream.componentBundle.document);
  const source = storeBlob(root, jsonBytes(upstream), 'json');
  const layout = storeBlob(root, neutralPrototype(upstream.spec.canvas, nodes), 'png');
  let screenshot = null;
  if (preview) {
    const bytes = readBytes(preview), image = decodePng(bytes);
    requireThat(image.width === upstream.spec.canvas.width && image.height === upstream.spec.canvas.height, 'PREVIEW_SIZE_MISMATCH');
    screenshot = storeBlob(root, bytes, 'png');
  }
  const prototype = seal({ kind: 'ui_reference_prototype_v1', panelId: upstream.spec.id, title: upstream.spec.title,
    canvas: upstream.spec.canvas, producer: { kind: 'ui-panel-harness', panelSpecVersion: upstream.spec.panelSpecVersion,
      compilerVersion: upstream.compilerVersion, bundleSha256: upstream.sha256 }, source, layout, screenshot, nodes,
    textPolicy: 'preserve-visible-copy', view: 'saved-state-selected-tab-scroll-origin',
    neutralDisclosure: 'Neutral rectangles show visible geometry; exact text is in nodes. No font or artwork fidelity is claimed.' });
  return { prototype, artifact: storeBlob(root, jsonBytes(prototype), 'json') };
}
export function loadPrototype(root, artifact) {
  return validationScope(() => structuredClone(validationMemo(canonical(['prototype', root, artifact]), () => loadPrototypeEvidence(root, artifact))));
}
function loadPrototypeEvidence(root, artifact) {
  const prototype = JSON.parse(verifyBlob(root, artifact)); unseal(prototype);
  exact(prototype, ['kind', 'panelId', 'title', 'canvas', 'producer', 'source', 'layout', 'screenshot', 'nodes', 'textPolicy', 'view', 'neutralDisclosure', 'sha256']);
  requireThat(prototype.kind === 'ui_reference_prototype_v1', 'PROTOTYPE_KIND');
  verifyBlob(root, prototype.source); decodePng(verifyBlob(root, prototype.layout));
  if (prototype.screenshot) decodePng(verifyBlob(root, prototype.screenshot));
  return prototype;
}
