import { indexDocument, fail } from "./document.mjs";
import { hasLayoutRules } from '../runtime/layout.mjs';
export function cloneTree(nodes, rootId, prefix) {
  const byId = new Map(nodes.map((n) => [n.id, n])),
    result = [],
    mapping = new Map();
  function visit(id) {
    const node = byId.get(id);
    if (!node) fail("panel.reference", "组件模板缺少节点。");
    if (mapping.has(id)) fail("panel.owner", "组件模板不是单一所有权树。");
    mapping.set(id, `${prefix}-${mapping.size}`);
    result.push(structuredClone(node));
    Object.values(node.slots).flat().forEach(visit);
  }
  visit(rootId);
  for (const n of result) {
    n.id = mapping.get(n.id);
    for (const k of Object.keys(n.slots))
      n.slots[k] = n.slots[k].map((x) => mapping.get(x));
    if (n.props.tabs)
      n.props.tabs = n.props.tabs.map((x) => ({
        ...x,
        contentNodeId: mapping.get(x.contentNodeId),
      }));
  }
  return { rootId: mapping.get(rootId), nodes: result };
}
export function applyOperation(document, operation) {
  const doc = structuredClone(document),
    { nodes, parents } = indexDocument(doc),
    op = operation;
  const node = nodes.get(op.id);
  const assertEditable = (n, allowOwnLock = false) => {
    if (!n) fail("edit.node", "节点不存在。");
    for (let current = n; current; current = parents.get(current.id)?.node)
      if (current.locked && !(current === n && allowOwnLock))
        fail("edit.locked", "节点或父级已锁定。");
  };
  const removeTree = (id) => {
    const n = nodes.get(id);
    Object.values(n.slots).flat().forEach(removeTree);
    doc.nodes = doc.nodes.filter((x) => x.id !== id);
  };
  if (op.type === "update") {
    assertEditable(
      node,
      Object.keys(op.patch).every((k) => k === "locked"),
    );
    if (
      Object.keys(op.patch).some(
        (k) =>
          !["name", "props", "size", "sizing", "position", "layout", "locked"].includes(
            k,
          ),
      )
    )
      fail("edit.field", "不允许直接改写身份和槽位。");
    for (const [k, v] of Object.entries(op.patch))
      node[k] = ["props", "size", "layout"].includes(k)
        ? { ...node[k], ...v }
        : structuredClone(v);
    // A cleared optional property is omitted rather than converted into null
    // or an empty string. Required fields remain subject to document validation.
    if(op.patch.props)for(const [key,value]of Object.entries(op.patch.props))if(value===undefined)delete node.props[key];
    if(op.patch.layout?.direction && op.patch.layout.direction!=='grid')for(const k of ['columns','cellWidth','cellHeight'])delete node.layout[k];
    if(op.patch.layout?.direction==='grid'&&!Object.hasOwn(op.patch.layout,'cellWidth'))delete node.layout.cellWidth;
  } else if (op.type === "add") {
    assertEditable(node);
    if (!Object.hasOwn(node.slots, op.slot))
      fail("edit.slot", "请选择存在的内容槽。");
    const tree = cloneTree(op.block.nodes, op.block.rootId, op.prefix);
    const root = tree.nodes.find((n) => n.id === tree.rootId);
    if (node.layout?.childrenMode === "free")
      root.position = op.position ?? {
        x: node.layout.padding ?? 0,
        y: node.layout.padding ?? 0,
      };
    else delete root.position;
    node.slots[op.slot].push(tree.rootId);
    doc.nodes.push(...tree.nodes);
  } else if (op.type === "duplicate") {
    assertEditable(node);
    const owner = parents.get(node.id);
    if (!owner) fail("edit.root", "画板根不能复制。");
    assertEditable(owner.node);
    if (["pages", "items"].includes(owner.slot))
      fail("edit.collection", "请通过集合属性和内容槽联合编辑该结构。");
    const tree = cloneTree(doc.nodes, node.id, op.prefix);
    const root = tree.nodes[0];
    root.name += " 副本";
    if (root.position) {
      root.position.x = Math.min(
        owner.node.size.width - root.size.width,
        root.position.x + 16,
      );
      root.position.y = Math.min(
        owner.node.size.height - root.size.height,
        root.position.y + 16,
      );
    }
    const ids = owner.node.slots[owner.slot];
    ids.splice(ids.indexOf(node.id) + 1, 0, tree.rootId);
    doc.nodes.push(...tree.nodes);
  } else if (op.type === "delete") {
    assertEditable(node);
    const owner = parents.get(node.id);
    if (!owner) fail("edit.root", "画板根不能删除。");
    assertEditable(owner.node);
    owner.node.slots[owner.slot] = owner.node.slots[owner.slot].filter(
      (id) => id !== node.id,
    );
    if (owner.slot === "pages" && owner.node.props.tabs) {
      owner.node.props.tabs = owner.node.props.tabs.filter(
        (t) => t.contentNodeId !== node.id,
      );
      if (
        !owner.node.props.tabs.some((t) => t.id === owner.node.props.activeId)
      )
        owner.node.props.activeId = owner.node.props.tabs[0]?.id ?? null;
    }
    if (owner.slot === "items")
      fail(
        "edit.collection",
        "列表内容请通过完整文档修改，避免数据与条目错位。",
      );
    removeTree(node.id);
  } else if (op.type === "reorder") {
    assertEditable(node);
    const owner = parents.get(node.id);
    if (!owner) fail("edit.root", "画板根不能排序。");
    assertEditable(owner.node);
    if (["items", "pages"].includes(owner.slot))
      fail("edit.collection", "集合内容顺序由 items/tabs 数据维护。");
    const ids = owner.node.slots[owner.slot],
      from = ids.indexOf(node.id);
    if (!Number.isInteger(op.index) || op.index < 0 || op.index >= ids.length)
      fail("edit.index", "排序位置不合法。");
    ids.splice(from, 1);
    ids.splice(op.index, 0, node.id);
  } else fail("edit.operation", "未知编辑操作。");
  if(doc.nodes.some(hasLayoutRules))doc.version='0.3';
  return doc;
}
