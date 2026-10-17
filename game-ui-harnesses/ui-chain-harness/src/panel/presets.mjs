export function presetDocument(preset, ctx) {
  const { id, title, canvas, rootId, nodes } = preset;
  return {
    kind: "ui_panel_document",
    version: "0.1",
    id,
    revision: 0,
    title,
    canvas,
    bindings: structuredClone(ctx.binding),
    rootId,
    nodes: structuredClone(nodes),
  };
}
