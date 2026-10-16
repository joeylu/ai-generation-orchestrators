import Ajv from "ajv";
import schema from "../../schemas/panel-document.schema.json" with { type: "json" };
import { validateProps, recipeRef } from "../contracts/props.mjs";
import { assertSize } from "../runtime/geometry.mjs";
import sliceSchema from "../../schemas/slice-document.schema.json" with { type: "json" };
import backgroundSchema from "../../schemas/panel-background.schema.json" with { type: "json" };
import { validateBackgroundAsset, backgroundGeometry, maxBackgroundBytes } from "../slicing/package.mjs";
import { measureSlices } from "../slicing/geometry.mjs";
import { documentLayout } from './layout.mjs';
import { hasLayoutRules } from '../runtime/layout.mjs';
import {surfaceTextBox,surfaceStyleInfo,surfaceLayerInfo,surfaceLayerTypes} from '../skins/surface-styles.mjs';
import {assertSurfaceSlotChildren,surfaceGeometryForContext} from '../runtime/surface-slots.mjs';
import {inventorySlotRoles} from '../runtime/inventory-policy.mjs';
const check = new Ajv({ allErrors: true, strict: true }).addSchema(sliceSchema).addSchema(backgroundSchema).compile(schema);
export function fail(code, message, path = "") {
  const e = new Error(path ? `${path}: ${message}` : message);
  e.code = code;
  throw e;
}
export function indexDocument(doc) {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n])),
    parents = new Map();
  for (const node of doc.nodes)
    for (const [slot, ids] of Object.entries(node.slots))
      for (const id of ids) parents.set(id, { node, slot });
  return { nodes, parents };
}
export function validateDocument(input, ctx) {
  const doc = structuredClone(input);
  if (!check(doc))
    fail(
      "panel.schema",
      check.errors.map((e) => `${e.instancePath} ${e.message}`).join("; "),
    );
  if (
    doc.bindings.sourceKind !== ctx.binding.sourceKind ||
    doc.bindings.sha256 !== ctx.binding.sha256
  )
    fail("panel.binding", "当前工程资源版本不匹配，拒绝静默换肤。");
  if (doc.panelBackgrounds && !["0.2","0.3"].includes(doc.version)) fail("panel.version", "自定义背景需要 PanelDocument 0.2 或以上。");
  if(doc.version!=='0.3'&&doc.nodes.some(n=>hasLayoutRules(n)||n.surfaceStyle||n.surfaceLayer||n.surfaceTextInsets||n.surfaceScale||n.surfaceBand||n.surfaceFontSize))fail('panel.version','增强布局和表面配方需要 PanelDocument 0.3。');
  const bytes = Object.values(doc.panelBackgrounds ?? {}).reduce((sum, asset) => sum + validateBackgroundAsset(asset), 0);
  if (bytes > maxBackgroundBytes) fail("background.size", "画布背景原图总计最多 8 MiB。");
  const sources = new Map(Object.values(doc.panelBackgrounds ?? {}).map(a => [a.source.sha256, a.source]));
  if ([...sources.values()].reduce((sum, s) => sum + s.width * s.height, 0) > 4096 * 4096)
    fail("background.pixels", "画布背景原图解码像素总计最多 4096 × 4096。");
  const canvas = ctx.canvases.presets[doc.canvas];
  if (!canvas) fail("panel.canvas", "未知画布预设。");
  const ratio = doc.canvas === "landscape" ? [16, 9] : [9, 16];
  if (
    !Number.isInteger(canvas.width) ||
    !Number.isInteger(canvas.height) ||
    canvas.width < 320 ||
    canvas.height < 320 ||
    canvas.width > 4096 ||
    canvas.height > 4096 ||
    canvas.width * ratio[1] !== canvas.height * ratio[0]
  )
    fail("panel.canvas", "画布预设须是合法的 16:9 或 9:16 逻辑尺寸。");
  const nodes = new Map(),
    parents = new Map(),
    recipes = new Map();
  for (const n of doc.nodes) {
    if (nodes.has(n.id)) fail("panel.duplicate", "重复节点 ID。", n.id);
    nodes.set(n.id, n);
    const recipe = ctx.registry.recipes.find(
      (r) => recipeRef(r) === n.recipeRef,
    );
    if (!recipe) fail("panel.recipe", "未知配方或版本。", n.id);
    recipes.set(n.id, recipe);
    for (const [slot, ids] of Object.entries(n.slots)) {
      if (!recipe.slots.some((s) => s.name === slot))
        fail("panel.slot", "未知内容槽。", n.id + "/" + slot);
      for (const id of ids) {
        if (parents.has(id))
          fail("panel.owner", "一个节点只能有一个父级。", id);
        parents.set(id, { node: n, slot });
      }
    }
    for (const s of recipe.slots) {
      const length = n.slots[s.name]?.length ?? 0;
      if (length < s.min || (s.max !== null && length > s.max))
        fail("panel.slot", "内容槽数量不合法。", n.id + "/" + s.name);
    }
    const result = validateProps(ctx.registry, n.recipeRef, n.props, {
      resourceIds: [...(ctx.skinGeometry?.materialAssets??[]).map(a=>a.assetId),...ctx.template.sheets.flatMap((s) =>
        s.parts.map((p) => p.assetId),
      )],
      textStyleIds: ["body"],
      nodeIds: Object.values(n.slots).flat(),
      layoutTokens: ctx.usage.layoutTokens,
    });
    if (result.issues.length || result.unresolved.length)
      fail(
        "panel.props",
        JSON.stringify([...result.issues, ...result.unresolved]),
        n.id,
      );
    n.props = result.props;
    if(n.surfaceTextInsets&&!(recipe.type==='Text'&&['title','section'].includes(n.surfaceStyle)))fail('panel.surface-style','Text surface insets require a semantic heading.',n.id);
    if(n.surfaceScale!==undefined&&n.surfaceLayer!=='frame')fail('panel.surface-layer','Surface scale is reserved for an explicit main frame.',n.id);
    if(n.surfaceBand&&!(recipe.type==='Text'&&['title','section'].includes(n.surfaceStyle)))fail('panel.surface-style','Reference bands require a semantic heading.',n.id);
    if(n.surfaceFontSize!==undefined&&!(recipe.type==='Text'&&['title','section'].includes(n.surfaceStyle)&&n.surfaceBand==='reference-v1'))fail('panel.surface-style','Reference heading font size requires its versioned heading band.',n.id);
    if(n.surfaceLayer){
      if(!surfaceLayerTypes.includes(recipe.type)||n.surfaceStyle||n.props.backgroundRef)fail('panel.surface-layer','Surface layer conflicts with node type or authored background.',n.id);
      if(recipe.type==='Panel'&&n.props.pixelsPerUnitMultiplier!==1)fail('panel.surface-layer','显式表面层仅支持默认切片倍率 1。',n.id);
      const info=surfaceLayerInfo(ctx.skinGeometry,n.surfaceLayer,n.surfaceScale);
      if(ctx.binding.sourceKind==='imported'&&!info)fail('panel.surface-layer','Verified surface geometry is required.',n.id);
      if(info&&(n.size.width<info.minWidth||n.size.height<info.minHeight))fail('panel.surface-layer','Surface layer is smaller than its skin minimum.',n.id);
      if(info&&recipe.type==='Panel'&&n.props.contentPadding&&Object.keys(info.insets).some(key=>n.props.contentPadding[key]<info.insets[key]))fail('panel.padding','Padding intrudes into the selected surface layer.',n.id);
    }
    if(n.surfaceStyle){
      if(!(recipe.type==='Text'&&['title','section'].includes(n.surfaceStyle)||recipe.type==='Panel'&&n.surfaceStyle==='panel'))fail('panel.surface-style','Surface style does not match node type.',n.id);
      surfaceTextBox(ctx.skinGeometry,n.surfaceStyle,n.size.width,n.size.height,n.surfaceTextInsets);
    }
    if (n.props.backgroundRef) {
      const asset = doc.panelBackgrounds?.[n.props.backgroundRef];
      if (!asset) fail("background.reference", "Panel 引用的背景素材不存在。", n.id);
      measureSlices(backgroundGeometry(asset, n.size, n.props.pixelsPerUnitMultiplier));
    }
    assertSize(recipe.type, n.props, ctx.profile, n.size.width, n.size.height);
    if (recipe.type !== "Container" && Object.keys(n.layout ?? {}).length)
      fail("panel.layout", "排版规则只能设置在 Container。", n.id);
  }
  if (
    !nodes.has(doc.rootId) ||
    parents.has(doc.rootId) ||
    recipes.get(doc.rootId).type !== "Container"
  )
    fail("panel.root", "画板根必须是无父级的 Container。");
  const root = nodes.get(doc.rootId);
  if (
    root.position ||
    Object.keys(root.sizing??{}).length ||
    root.size.width !== canvas.width ||
    root.size.height !== canvas.height
  )
    fail("panel.canvas", "画板根尺寸必须与画布预设一致。");
  const visited = new Set(),
    active = new Set();
  function walk(id, depth) {
    if (active.has(id)) fail("panel.cycle", "节点不能循环引用。", id);
    if (depth > 16) fail("panel.depth", "嵌套深度最多 16 层。");
    const n = nodes.get(id);
    if (!n) fail("panel.reference", "引用节点不存在。", id);
    active.add(id);
    visited.add(id);
    for (const child of Object.values(n.slots).flat()) walk(child, depth + 1);
    active.delete(id);
  }
  walk(doc.rootId, 0);
  if (visited.size !== nodes.size) fail("panel.orphan", "存在未挂载节点。");
  const resolved=documentLayout(nodes,recipes,parents,ctx.profile);
  const surfaceGeometry=doc.nodes.some(n=>n.surfaceLayer)?surfaceGeometryForContext(ctx):null;
  for (const n of doc.nodes) {
    const r = recipes.get(n.id),
      children = Object.values(n.slots)
        .flat()
        .map((id) => nodes.get(id));
    if(n.surfaceLayer){const info=surfaceLayerInfo(ctx.skinGeometry,n.surfaceLayer,n.surfaceScale),size=resolved.get(n.id)??n.size;if(info&&(size.width<info.minWidth||size.height<info.minHeight))fail('panel.surface-layer','Resolved surface layer is smaller than its skin minimum.',n.id);}
    if(n.surfaceLayer)assertSurfaceSlotChildren({type:r.type,props:n.props,size:resolved.get(n.id)??n.size,profile:ctx.profile,geometry:surfaceGeometry,surfaceLayer:n.surfaceLayer,surfaceScale:n.surfaceScale},children.map(child=>({id:child.id,size:resolved.get(child.id)??child.size})));
    const surface=n.surfaceStyle??(!n.surfaceLayer&&r.type==='Panel'&&!n.props.backgroundRef&&ctx.skinGeometry?.surfaceStyles?.panel?'panel':null);
    if(surface){const size=resolved.get(n.id)??n.size;surfaceTextBox(ctx.skinGeometry,surface,size.width,size.height,n.surfaceTextInsets);}
    if (r.type === "List") {
      const items = n.slots.items ?? [];
      if (
        items.length &&
        (items.length !== n.props.items.length ||
          items.some((id) => nodes.get(id).recipeRef !== n.props.itemRecipeRef))
      )
        fail("panel.list", "自定义条目必须与数据和条目配方逐项对应。", n.id);
      if (
        !items.length &&
        n.props.items.length &&
        ctx.registry.recipes.find((x) => recipeRef(x) === n.props.itemRecipeRef)
          ?.type !== "Button"
      )
        fail("panel.list", "非 Button 条目必须提供 items 内容槽。", n.id);
    }
    if (
      r.type === "Tabs" &&
      new Set(n.props.tabs.map((x) => x.contentNodeId)).size !==
        (n.slots.pages ?? []).length
    )
      fail("panel.tabs", "每个页面必须恰好被一个页签引用。", n.id);
    if (r.type === "Container") {
      if(resolved.has(n.id))continue; // Shared Yoga solver already checked effective bounds.
      const layout = n.layout ?? {},
        pad = layout.padding ?? 0,
        width = n.size.width - pad * 2,
        height = n.size.height - pad * 2;
      for (const child of children) {
        if (layout.childrenMode === "free") {
          if (!child.position)
            fail("panel.position", "自由区域子节点需要位置。", child.id);
          if (
            child.position.x + child.size.width > n.size.width - pad ||
            child.position.y + child.size.height > n.size.height - pad ||
            child.position.x < pad ||
            child.position.y < pad
          )
            fail("panel.bounds", "自由区域子节点越界。", child.id);
        } else {
          if (child.position)
            fail("panel.position", "流式区域不接受手动坐标。", child.id);
          if (child.size.width > width || child.size.height > height)
            fail("panel.bounds", "子节点尺寸超过容器。", child.id);
        }
      }
      const visible = children.filter((c) => c.props.visible),
        gap = layout.gap ?? 8;
      if (
        layout.childrenMode !== "free" &&
        layout.direction !== "wrap" &&
        visible.length
      ) {
        const axis = layout.direction === "row" ? "width" : "height";
        if (
          visible.reduce((a, c) => a + c.size[axis], 0) +
            gap * (visible.length - 1) >
          (axis === "width" ? width : height) + 0.01
        )
          fail(
            "panel.overflow",
            "流式区域内容放不下，请增大容器或使用滚动区域。",
            n.id,
          );
      }
    } else
      for (const child of children)
        if (child.position)
          fail(
            "panel.position",
            "只有自由 Container 的直接子节点可定位。",
            child.id,
          );
  }
  return doc;
}

export function resourceClosure(doc, ctx) {
  const recipes = new Set(),
    roles = new Set(),
    assets = new Set(),
    textStyles = new Set();
  const collect = (ref, p, seen = new Set()) => {
    if (seen.has(ref)) return;
    seen.add(ref);
    recipes.add(ref);
    const r = ctx.registry.recipes.find((x) => recipeRef(x) === ref);
    if (!r) fail("panel.recipe", "资源闭包中的配方不存在。");
    for (const b of r.skinRoles) {
      if (
        b.when &&
        (("equals" in b.when && p[b.when.prop] !== b.when.equals) ||
          ("notEquals" in b.when && p[b.when.prop] === b.when.notEquals))
      )
        continue;
      roles.add(b.role);
    }
    r.textStyles.forEach((x) => textStyles.add(x));
    for (const child of [
      ...r.composedRecipes,
      ...(p.itemRecipeRef ? [p.itemRecipeRef] : []),
    ])
      collect(child, validateProps(ctx.registry, child, {}).props ?? {}, seen);
    if (p.sourceRef) assets.add(p.sourceRef);
  };
  doc.nodes.forEach((n) => {
    collect(n.recipeRef,n.props);
    const recipe=ctx.registry.recipes.find(r=>recipeRef(r)===n.recipeRef);
    if(recipe.type==='List'&&n.props.inventory)for(const role of inventorySlotRoles(ctx.skinGeometry??surfaceGeometryForContext(ctx),n.props.inventory))roles.add(role);
    const layer=n.surfaceLayer?surfaceLayerInfo(surfaceGeometryForContext(ctx),n.surfaceLayer,n.surfaceScale):null;
    if(layer)roles.add(layer.baseRole);
    if(n.surfaceLayer&&recipe.type==='List'&&n.props.inventory){roles.add('skin.scrollbar.track');roles.add('skin.scrollbar.thumb');}
    const key=n.surfaceStyle??(n.surfaceLayer?layer?.materialStyle:recipe.type==='Panel'&&!n.props.backgroundRef&&ctx.skinGeometry?.surfaceStyles?.panel?'panel':null);
    if(key){const info=surfaceStyleInfo(ctx.skinGeometry,key);if(!info)fail('panel.surface-style','Missing surface geometry.');roles.add(info.style.baseRole);for(const layer of info.style.layers)assets.add(layer.assetId);}
  });
  // Role mappings are version-bound along with template geometry and fixture.
  for (const role of roles) {
    const binding = ctx.usage.bindings.find((r) => r.role === role);
    if (!binding) fail("panel.resource", "缺少皮肤角色。", role);
    assets.add(binding.assetId);
  }
  return {
    sourceKind: doc.bindings.sourceKind,
    binding: doc.bindings,
    recipes: [...recipes].sort(),
    roles: [...roles].sort(),
    assets: [...assets].sort(),
    textStyles: [...textStyles].sort(),
    panelBackgrounds: [...new Set(doc.nodes.map(n => n.props.backgroundRef).filter(Boolean))].sort().map(id => ({ id, ...doc.panelBackgrounds[id].source })),
  };
}
