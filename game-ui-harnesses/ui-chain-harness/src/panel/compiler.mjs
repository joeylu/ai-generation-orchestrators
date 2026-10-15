import { createRuntime } from "../runtime/runtime.mjs";
import {
  validateDocument,
  resourceClosure,
  indexDocument,
  fail,
} from "./document.mjs";
import {surfaceSlotBox} from '../runtime/surface-slots.mjs';
export function compilePanel(input, ctx, { app, skin, panelBackgrounds, onEvent = () => {} }) {
  const doc = validateDocument(input, ctx),
    closure = resourceClosure(doc, ctx),
    { nodes } = indexDocument(doc);
  if (skin.sourceKind !== doc.bindings.sourceKind || (doc.bindings.sourceKind === 'imported' && skin.manifestSha256 !== doc.bindings.sha256))
    fail('panel.binding', '面板绑定的皮肤与实际加载皮肤不一致。');
  const runtime = createRuntime({
    app,
    skin,
    panelBackgrounds,
    registry: ctx.registry,
    usage: ctx.usage,
    onEvent,
  });
  runtime.setMode("edit");
  try {
    function build(id) {
      const n = nodes.get(id),
        slots = Object.fromEntries(
          Object.entries(n.slots).map(([key, ids]) => [key, ids.map(build)]),
        );
      return runtime.create(n, slots);
    }
    const root = build(doc.rootId);
    runtime.mount(root);
    for (const n of doc.nodes) {
      const handle = runtime.handles.get(n.id),
        owner = handle.parent;
      if (
        !owner ||
        owner.recipe.type === "ScrollView" ||
        owner.recipe.type === "List" ||
        !handle.root.visible
      )
        continue;
      const origin = owner.root.toLocal(handle.root.toGlobal({ x: 0, y: 0 }));
      const slot=owner.surfaceLayer?surfaceSlotBox(owner.surfaceSlotOptions(owner.size)):null;
      if(slot){
        if(origin.x<slot.x-.5||origin.x+handle.size.width>slot.x+slot.width+.5||(!slot.allowVerticalOverflow&&(origin.y<slot.y-.5||origin.y+handle.size.height>slot.y+slot.height+.5)))fail('panel.bounds','组件超出表面的安全内容区。',n.id);
        continue;
      }
      if (
        origin.x < -0.5 ||
        origin.y < -0.5 ||
        origin.x + handle.size.width > owner.size.width + 0.5 ||
        origin.y + handle.size.height > owner.size.height + 0.5
      )
        fail(
          "panel.bounds",
          "组件超出父级区域，请调整尺寸或使用滚动区域。",
          n.id,
        );
    }
    return {
      runtime,
      root,
      closure,
      document: doc,
      dispose: () => runtime.dispose(),
    };
  } catch (e) {
    runtime.dispose();
    throw e;
  }
}
