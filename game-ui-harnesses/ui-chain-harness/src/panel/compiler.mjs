import { createRuntime } from "../runtime/runtime.mjs";
import {
  validateDocument,
  resourceClosure,
  indexDocument,
  fail,
} from "./document.mjs";
import {componentContentBox} from '../runtime/content-bounds.mjs';

// Post-render coordinates are owner-local. Dialog bodies are scroll viewports:
// keep their horizontal safe area while permitting the tall content they own.
// Every authored child owner uses its actual content slot. Scrolling only
// exempts the vertical extent; it never releases the horizontal safe area.
export function assertCompiledChildBounds(options,child){
  if(child.visible===false)return;
  const {origin,size}=child,slot=componentContentBox(options);
  if(slot){
    if(origin.x<slot.x-.5||origin.x+size.width>slot.x+slot.width+.5||(!slot.allowVerticalOverflow&&(origin.y<slot.y-.5||origin.y+size.height>slot.y+slot.height+.5)))fail('panel.bounds','组件超出表面的安全内容区。',child.id);
    return;
  }
  if(origin.x<-.5||origin.y<-.5||origin.x+size.width>options.size.width+.5||origin.y+size.height>options.size.height+.5)fail('panel.bounds','组件超出父级区域，请调整尺寸或使用滚动区域。',child.id);
}
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
    referenceTextFlow:doc.nodes.some(n=>n.surfaceLayer==='frame'&&n.surfaceScale!==undefined)&&doc.nodes.some(n=>n.surfaceBand==='reference-v1'),
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
        !handle.root.visible
      )
        continue;
      const origin = owner.root.toLocal(handle.root.toGlobal({ x: 0, y: 0 }));
      const options=owner.surfaceLayer?owner.surfaceSlotOptions(owner.size):{type:owner.recipe.type,props:owner.props,size:owner.size,layout:owner.layout,profile:skin.profile,geometry:skin.surfaceGeometry??skin};
      assertCompiledChildBounds(options,{id:n.id,origin,size:handle.size,visible:handle.root.visible});
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
