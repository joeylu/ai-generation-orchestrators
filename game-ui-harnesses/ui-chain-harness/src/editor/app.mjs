import "@fontsource/noto-sans-sc/400.css";
import "./editor.css";
import { Application } from "pixi.js";
import { createFixtureSkin } from "../runtime/skin.mjs";
import { preparePanel } from "../panel/prepare.mjs";
import { createBackgroundPool } from "../panel/background-pool.mjs";
import { maxPanelJsonBytes } from "../slicing/package.mjs";
import { panelBackgroundControls } from "./panel-background-controls.mjs";
import { createSession } from "../panel/session.mjs";
import { indexDocument } from "../panel/document.mjs";
import { presetDocument } from "../panel/presets.mjs";
import { recipeRef, propsSchema } from "../contracts/props.mjs";
const $ = (id) => document.getElementById(id),
  data = window.UI_CHAIN_DATA;
let session,
  app,
  skin,
  selected = null,
  mode = "edit",
  scale = 1,
  pan = { x: 0, y: 0 },
  space = false,
  gesture = null,
  busy = false,
  disposed = false;
const events = [];
const backgroundPool = createBackgroundPool();
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
};
const node = () => session?.document.nodes.find((n) => n.id === selected);
function documentFromPreset(p) {
  return presetDocument(p, data);
}
function currentRect(id) {
  const h = session.current?.runtime.handles.get(id);
  if (!h) return null;
  const p = h.root.toGlobal({ x: 0, y: 0 });
  return { x: p.x, y: p.y, width: h.size.width, height: h.size.height };
}
function local(e) {
  const rect = $("world").getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / scale,
    y: (e.clientY - rect.top) / scale,
  };
}
function camera() {
  const canvas = data.canvases.presets[session.document.canvas];
  $("world").style.width = canvas.width + "px";
  $("world").style.height = canvas.height + "px";
  $("world").style.transform =
    `translate(${pan.x}px,${pan.y}px) scale(${scale})`;
}
function fit() {
  const c = data.canvases.presets[session.document.canvas],
    v = $("viewport");
  scale = Math.min(
    (v.clientWidth - 64) / c.width,
    (v.clientHeight - 64) / c.height,
    1,
  );
  pan = {
    x: (v.clientWidth - c.width * scale) / 2,
    y: (v.clientHeight - c.height * scale) / 2,
  };
  $("zoom").value = "fit";
  camera();
}
function selection(rect = currentRect(selected)) {
  const n = node(),
    box = $("selection");
  if (mode !== "edit" || !n || !rect) {
    box.style.display = "none";
    return;
  }
  Object.assign(box.style, {
    display: "block",
    left: rect.x + "px",
    top: rect.y + "px",
    width: rect.width + "px",
    height: rect.height + "px",
  });
  $("selection-label").textContent = n.name + (n.locked ? " · 已锁定" : "");
  $("resize-handle").hidden = n.id === session.document.rootId || n.locked;
}
function choose(id) {
  selected = id;
  renderTree();
  renderProperties();
  selection();
}
function renderTree() {
  const doc = session.document,
    { nodes } = indexDocument(doc);
  $("tree").replaceChildren();
  function visit(id, depth) {
    const n = nodes.get(id),
      r = data.registry.recipes.find((r) => recipeRef(r) === n.recipeRef),
      button = document.createElement("button");
    button.dataset.node = id;
    button.style.paddingLeft = 12 + depth * 12 + "px";
    button.className = selected === id ? "selected" : "";
    button.textContent =
      (n.locked ? "▣ " : Object.values(n.slots).flat().length ? "▾ " : "· ") +
      n.name;
    button.title = r.type + " · " + id;
    button.onclick = () => choose(id);
    $("tree").append(button);
    Object.values(n.slots)
      .flat()
      .forEach((id) => visit(id, depth + 1));
  }
  visit(doc.rootId, 0);
  $("node-count").textContent = doc.nodes.length + " 个节点";
}
const labels = {
  label: "文案",
  text: "文字内容",
  title: "标题",
  enabled: "启用",
  visible: "可见",
  checked: "默认选中",
  value: "默认值",
  selectedId: "默认选择 ID",
  activeId: "默认页签 ID",
  options: "选项",
  items: "条目数据",
  tabs: "页签与页面",
  actions: "操作按钮",
  placeholder: "占位文字",
  min: "最小值",
  max: "最大值",
  step: "步长",
  showValue: "显示数值",
  readOnly: "只读",
  maxLength: "最大长度",
  inputType: "输入类型",
  variant: "皮肤变体",
  direction: "排列方向",
  maxVisibleItems: "可见条目数",
  selection: "选择模式",
  gapToken: "间距",
  itemRecipeRef: "条目配方",
  sourceRef: "图片资源",
  fit: "图片适配",
  position: "图片锚点",
  textStyleRef: "文字样式",
  wrap: "换行",
  overflow: "溢出处理",
  align: "文字对齐",
  open: "默认打开",
  modal: "模态",
  closeOnBackdrop: "点遮罩关闭",
  scrollbar: "滚动条",
  initialOffsetY: "默认滚动位置",
  contentPadding: "内容内边距",
  pixelsPerUnitMultiplier: "边框倍率（越大越细）",
  backgroundRef: "背景素材",
};
function field(label, value, kind = "text", options) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  const input = document.createElement(
    options
      ? "select"
      : kind === "json" || kind === "textarea"
        ? "textarea"
        : "input",
  );
  if (options) {
    for (const option of options) {
      const el = document.createElement("option");
      el.value = typeof option === "object" ? option.value : option;
      el.textContent = typeof option === "object" ? option.label : option;
      input.append(el);
    }
  } else if (input.tagName === "INPUT")
    input.type =
      kind === "boolean" ? "checkbox" : kind === "number" ? "number" : "text";
  if (kind === "boolean") {
    input.checked = !!value;
    wrap.classList.add("check-field");
  } else
    input.value =
      kind === "json" ? JSON.stringify(value, null, 2) : (value ?? "");
  wrap.append(span, input);
  input.read = () =>
    kind === "boolean"
      ? input.checked
      : kind === "number"
        ? input.value === ""
          ? null
          : Number(input.value)
        : kind === "json"
          ? JSON.parse(input.value)
          : value === null && input.value === ""
            ? null
            : input.value;
  return { wrap, input };
}
function renderProperties() {
  const n = node(),
    host = $("properties");
  host.replaceChildren();
  if (!n) return;
  const r = data.registry.recipes.find((r) => recipeRef(r) === n.recipeRef);
  $("selected-type").textContent = r.type;
  const form = document.createElement("form");
  host.append(form);
  const inputs = {};
  function add(key, label, value, kind, options) {
    const f = field(label, value, kind, options);
    f.input.dataset.field = key;
    inputs[key] = f.input;
    form.append(f.wrap);
    return f;
  }
  add("name", "图层名称", n.name);
  add("locked", "锁定对象", n.locked ?? false, "boolean");
  const sizeRow = document.createElement("div");
  sizeRow.className = "field-row";
  form.append(sizeRow);
  for (const k of ["width", "height"]) {
    const f = field(k === "width" ? "宽度" : "高度", n.size[k], "number");
    f.input.dataset.field = k;
    f.input.disabled = n.id === session.document.rootId;
    inputs[k] = f.input;
    sizeRow.append(f.wrap);
  }
  if (n.position) {
    const row = document.createElement("div");
    row.className = "field-row";
    form.append(row);
    for (const k of ["x", "y"]) {
      const f = field(k.toUpperCase(), n.position[k], "number");
      f.input.dataset.field = k;
      inputs[k] = f.input;
      row.append(f.wrap);
    }
  }
  const sizingDetails=document.createElement('details');
  const sizingTitle=document.createElement('summary');sizingTitle.textContent='尺寸与弹性（高级）';sizingDetails.append(sizingTitle);form.append(sizingDetails);
  for(const axis of ['width','height']){
    const label=axis==='width'?'宽度':'高度';
    const options=[{value:'fixed',label:'指定尺寸'},{value:'fill',label:'填充剩余空间'}];
    if(r.type==='Container')options.push({value:'content',label:'适应子项内容'});
    const f=add(axis+'Mode',label+'模式',n.sizing?.[axis+'Mode']??'fixed','text',options);sizingDetails.append(f.wrap);f.input.disabled=n.id===session.document.rootId;
  }
  for(const [key,label] of Object.entries({minWidth:'最小宽度',maxWidth:'最大宽度',minHeight:'最小高度',maxHeight:'最大高度',grow:'扩展权重',shrink:'收缩权重'})){
    const f=add(key,label,n.sizing?.[key]??'','number');sizingDetails.append(f.wrap);f.input.disabled=n.id===session.document.rootId;
    f.input.read=()=>f.input.value.trim()===''?undefined:Number(f.input.value);
  }
  if (r.type === "Container") {
    const section = document.createElement("div");
    section.className = "form-section";
    section.textContent = "排版";
    form.append(section);
    add("childrenMode", "区域类型", n.layout?.childrenMode ?? "flow", "text", [
      { value: "flow", label: "预设流式排版" },
      { value: "free", label: "局部自由摆放" },
    ]);
    add("direction", "排列方向", n.layout?.direction ?? "column", "text", [
      { value: "column", label: "纵向" },
      { value: "row", label: "横向" },
      { value: "wrap", label: "自动换行" },
      { value: "grid", label: "固定列网格" },
    ]);
    add("gap", "间距", n.layout?.gap ?? 8, "number");
    add("padding", "内边距", n.layout?.padding ?? 0, "number");
    add("align", "交叉轴对齐", n.layout?.align ?? "flex-start", "text", [
      "flex-start",
      "center",
      "flex-end",
      "stretch",
    ]);
    add('justify','主轴分布',n.layout?.justify??'flex-start','text',['flex-start','center','flex-end','space-between','space-around','space-evenly']);
    for(const [key,label,fallback]of [['columns','网格列数',2],['cellHeight','网格行高',80],['cellWidth','网格列宽（留空均分）','']]){
      const f=add(key,label,n.layout?.[key]??fallback,'number');f.input.read=()=>f.input.value.trim()===''?undefined:Number(f.input.value);
      f.wrap.hidden=(n.layout?.direction??'column')!=='grid';
      inputs.direction.addEventListener('change',()=>{f.wrap.hidden=inputs.direction.value!=='grid';});
    }
  }
  const section = document.createElement("div");
  section.className = "form-section";
  section.textContent = "组件属性";
  form.append(section);
  const properties = propsSchema(data.registry, r).properties;
  for (const [key, s] of Object.entries(properties)) {
    const value = n.props[key],
      types = Array.isArray(s.type) ? s.type : [s.type];
    const f = add(
      "props." + key,
      labels[key] ?? key,
      value,
      s.enum
        ? "text"
        : types.includes("boolean")
          ? "boolean"
          : types.includes("object") || types.includes("array")
            ? "json"
            : types.includes("number") || types.includes("integer")
              ? "number"
              : key === "text"
                ? "textarea"
                : "text",
      key === "backgroundRef" ? [{ value: "", label: "默认工程皮肤" }, ...Object.entries(session.document.panelBackgrounds ?? {}).map(([value, asset], i) => ({ value, label: `背景 ${i + 1} · ${asset.source.width} × ${asset.source.height}` }))] : s.enum,
    );
    if (key === "backgroundRef") f.input.read = () => f.input.value || null;
    if (["object", "array"].some((t) => types.includes(t))) f.input.rows = 4;
  }
  const button = document.createElement("button");
  button.type = "submit";
  button.id = "apply";
  button.className = "apply";
  button.textContent = "应用修改";
  button.disabled = mode !== "edit";
  form.append(button);
  const note = document.createElement("p");
  note.className = "property-note";
  note.textContent = n.position
    ? "此对象位于自由区域，可以拖动定位。"
    : "此对象由预设排版定位，拖动会调整同级顺序。";
  host.append(note);
  if (r.type === "Panel") panelBackgroundControls({ host, node: n, session, app, act, download, mode, selected: () => selected });
  form.onsubmit = (e) => {
    e.preventDefault();
    act(async () => {
      const patch = {
        name: inputs.name.read(),
        locked: inputs.locked.read(),
        size: { width: inputs.width.read(), height: inputs.height.read() },
        props: {},
      };
      if(n.id!==session.document.rootId){
        patch.sizing={};
        for(const k of ['widthMode','heightMode','minWidth','maxWidth','minHeight','maxHeight','grow','shrink']){
          const value=inputs[k].read();if(value!==undefined && value!=='fixed')patch.sizing[k]=value;
        }
        if(n.sizing?.alignSelf)patch.sizing.alignSelf=n.sizing.alignSelf;
      }
      for (const key of Object.keys(properties))
        patch.props[key] = inputs["props." + key].read();
      if (n.position)
        patch.position = { x: inputs.x.read(), y: inputs.y.read() };
      if (r.type === "Container") {
        patch.layout = Object.fromEntries(
          ["childrenMode", "direction", "gap", "padding", "align", "justify"].map((k) => [
            k,
            inputs[k].read(),
          ]),
        );
        if(patch.layout.direction==='grid')for(const k of ['columns','cellWidth','cellHeight']){const value=inputs[k].read();if(value!==undefined)patch.layout[k]=value;}
        if (patch.layout.childrenMode !== (n.layout?.childrenMode ?? "flow")) {
          const doc = session.document,
            target = doc.nodes.find((x) => x.id === n.id);
          Object.assign(target, patch);
          doc.version='0.3';
          for (const id of target.slots.children ?? []) {
            const child = doc.nodes.find((x) => x.id === id);
            if (patch.layout.childrenMode === "free") {
              const a = currentRect(id),
                b = currentRect(n.id);
              child.position = {
                x: Math.round(a.x - b.x),
                y: Math.round(a.y - b.y),
              };
            } else delete child.position;
          }
          await session.commit(doc);
          return;
        }
      }
      if (n.locked && !patch.locked) {
        await session.mutate({
          type: "update",
          id: n.id,
          patch: { locked: false },
        });
        return;
      }
      await session.mutate({ type: "update", id: n.id, patch });
    }, "属性已更新");
  };
}
async function act(fn, message = "修改已保存到当前文档") {
  if (busy) return;
  if (mode !== "edit") {
    status("请先切回编辑模式。", true);
    return;
  }
  busy = true;
  try {
    await fn();
    status(message);
  } catch (e) {
    status(e.message, true);
  } finally {
    busy = false;
    renderChrome();
  }
}
function renderChrome() {
  const doc = session.document;
  const c = data.canvases.presets[doc.canvas];
  if (!doc.nodes.some((n) => n.id === selected)) selected = doc.rootId;
  $("document-title").textContent = doc.title;
  if (data.presets.presets.some((p) => p.id === doc.id))
    $("preset").value = doc.id;
  $("revision").textContent = "修订 " + doc.revision;
  $("canvas-label").textContent = `${c.label} · ${c.width} × ${c.height}`;
  $("undo").disabled = !session.canUndo || mode !== "edit";
  $("redo").disabled = !session.canRedo || mode !== "edit";
  $("interaction").classList.toggle("play", mode === "play");
  $("edit").classList.toggle("active", mode === "edit");
  $("play").classList.toggle("active", mode === "play");
  $("mode-label").textContent =
    mode === "edit"
      ? "编辑模式 · 组件不会触发业务事件"
      : "试玩模式 · 离开后恢复创作默认值";
  renderTree();
  renderProperties();
  selection();
  camera();
}
async function setMode(next) {
  if (mode === next || busy) return;
  cancelGesture();
  busy = true;
  try {
  if (next === "edit") {
    // Rebuild from the unchanged authoring document; no play state is saved.
    const old = session.current;
    const fresh = await preparePanel(session.document, data, { app, skin, pool: backgroundPool, onEvent });
    old.dispose();
    Object.assign(old, fresh);
  } else session.current.runtime.setMode("play");
  mode = next;
  renderChrome();
  status(
    next === "edit"
      ? "已恢复创作默认值。"
      : "正在试玩；交互不会修改已保存的文档。",
  );
  } catch (e) { status(e.message, true); }
  finally { busy = false; }
}
function onEvent(e) {
  events.push(e);
  if (events.length > 12) events.shift();
  $("events").textContent = events.map((e) => JSON.stringify(e)).join("\n");
}
function download(name, text) {
  const url = URL.createObjectURL(
    text instanceof Blob ? text : new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("已下载 " + name);
}
function addBlock(ref) {
  act(async () => {
    const { nodes, parents } = indexDocument(session.document),
      r = data.registry.recipes.find((r) => recipeRef(r) === ref);
    let parent = nodes.get(selected);
    while (
      parent &&
      !data.registry.recipes
        .find((r) => recipeRef(r) === parent.recipeRef)
        ?.slots.some((s) => s.name === "children")
    )
      parent = parents.get(parent.id)?.node;
    if (!parent) parent = nodes.get(session.document.rootId);
    const source = data.blocks.blocks.find((b) => b.type === r.type),
      block = structuredClone(source);
    block.nodes.find((n) => n.id === block.rootId).recipeRef = ref;
    const prefix = "node-" + crypto.randomUUID().slice(0, 8);
    await session.mutate({
      type: "add",
      id: parent.id,
      slot: "children",
      block,
      prefix,
      position: { x: 24, y: 24 },
    });
    selected = prefix + "-0";
  }, "组件已添加。");
}
function hit(point) {
  const doc = session.document,
    { nodes, parents } = indexDocument(doc);
  const visible = (n) => {
    for (let x = n; x; x = parents.get(x.id)?.node) {
      if (x.props.visible === false) return false;
      const h = session.current.runtime.handles.get(x.id);
      for (let v = h?.root; v; v = v.parent) if (!v.visible) return false;
    }
    return true;
  };
  // Traverse document order, with descendants and later siblings above parents.
  const order = [];
  function walk(id) {
    const n = nodes.get(id);
    order.push(n);
    Object.values(n.slots).flat().forEach(walk);
  }
  walk(doc.rootId);
  return order.reverse().find((n) => {
    const r = currentRect(n.id);
    if (
      !r ||
      !visible(n) ||
      point.x < r.x ||
      point.y < r.y ||
      point.x > r.x + r.width ||
      point.y > r.y + r.height
    )
      return false;
    for (let p = parents.get(n.id)?.node; p; p = parents.get(p.id)?.node) {
      const b = currentRect(p.id);
      if (
        point.x < b.x ||
        point.y < b.y ||
        point.x > b.x + b.width ||
        point.y > b.y + b.height
      )
        return false;
    }
    return true;
  });
}
function gestureStart(e) {
  if (mode !== "edit" || busy) return;
  if (e.button === 1 || space) {
    e.preventDefault();
    gesture = {
      type: "pan",
      start: { x: e.clientX, y: e.clientY },
      pan: { ...pan },
    };
    return;
  }
  if (e.button !== 0) return;
  const point = local(e),
    resize = e.target === $("resize-handle"),
    n = resize ? node() : hit(point);
  if (!n) return;
  choose(n.id);
  if (n.locked || n.id === session.document.rootId) return;
  const { parents } = indexDocument(session.document);
  for (
    let parent = parents.get(n.id)?.node;
    parent;
    parent = parents.get(parent.id)?.node
  )
    if (parent.locked) return;
  const rect = currentRect(n.id);
  gesture = {
    type: resize ? "resize" : n.position ? "move" : "sort",
    id: n.id,
    start: point,
    rect,
    base: session.revision,
  };
  $("viewport").focus();
  e.preventDefault();
}
function gestureMove(e) {
  if (!gesture) return;
  if (gesture.type === "pan") {
    pan = {
      x: gesture.pan.x + e.clientX - gesture.start.x,
      y: gesture.pan.y + e.clientY - gesture.start.y,
    };
    camera();
    return;
  }
  const point = local(e),
    snap = $("snap").checked ? 8 : 1,
    dx = Math.round((point.x - gesture.start.x) / snap) * snap,
    dy = Math.round((point.y - gesture.start.y) / snap) * snap;
  gesture.dx = dx;
  gesture.dy = dy;
  if (gesture.type === "move")
    selection({
      ...gesture.rect,
      x: gesture.rect.x + dx,
      y: gesture.rect.y + dy,
    });
  if (gesture.type === "resize") {
    const handle = session.current.runtime.handles.get(gesture.id);
    if (handle?.recipe.type === "Panel" && session.revision === gesture.base) {
      try {
        handle.resize(Math.max(24, gesture.rect.width + dx), Math.max(24, gesture.rect.height + dy));
        session.current.runtime.flush();
      } catch (error) { status(error.message, true); }
    }
    selection({
      ...gesture.rect,
      width: Math.max(24, gesture.rect.width + dx),
      height: Math.max(24, gesture.rect.height + dy),
    });
  }
}
function restoreResize(g) {
  if (g?.type !== "resize" || g.base !== session.revision) return;
  const h = session.current.runtime.handles.get(g.id);
  if (h?.recipe.type === "Panel") { h.resize(g.rect.width, g.rect.height); session.current.runtime.flush(); }
}
function cancelGesture() {
  restoreResize(gesture); gesture = null; selection();
}
function gestureEnd(e) {
  const g = gesture;
  gesture = null;
  if (!g || g.type === "pan") return;
  restoreResize(g);
  if (!g.dx && !g.dy) {
    selection();
    return;
  }
  act(async () => {
    const n = session.document.nodes.find((n) => n.id === g.id);
    if (g.type === "move")
      await session.mutate(
        {
          type: "update",
          id: n.id,
          patch: {
            position: {
              x: n.position.x + (g.dx ?? 0),
              y: n.position.y + (g.dy ?? 0),
            },
          },
        },
        g.base,
      );
    else if (g.type === "resize")
      await session.mutate(
        {
          type: "update",
          id: n.id,
          patch: {
            size: {
              width: Math.max(24, n.size.width + (g.dx ?? 0)),
              height: Math.max(24, n.size.height + (g.dy ?? 0)),
            },
          },
        },
        g.base,
      );
    else {
      const { parents } = indexDocument(session.document),
        owner = parents.get(n.id);
      if (!owner) return;
      const ids = owner.node.slots[owner.slot],
        point = local(e),
        axis = owner.node.layout?.direction === "row" ? "x" : "y",
        size = axis === "x" ? "width" : "height";
      let index = ids
        .filter((id) => id !== n.id)
        .filter((id) => {
          const r = currentRect(id);
          return point[axis] > r[axis] + r[size] / 2;
        }).length;
      await session.mutate({ type: "reorder", id: n.id, index }, g.base);
    }
  }, "画布修改已提交，可撤销。");
}
async function boot() {
  await Promise.all([...document.fonts].map((f) => f.load()));
  await document.fonts.ready;
  app = new Application();
  const initial = documentFromPreset(data.presets.presets[0]),
    c = data.canvases.presets[initial.canvas];
  await app.init({
    width: c.width,
    height: c.height,
    background: "#101B2B",
    antialias: true,
    preference: "webgl",
    preserveDrawingBuffer: true,
    layout: { autoUpdate: true, throttle: 0 },
    eventFeatures: { globalMove: true },
  });
  $("canvas-host").append(app.canvas);
  skin = createFixtureSkin(data.template, data.usage, data.profile);
  session = createSession(initial, data, doc => preparePanel(doc, data, { app, skin, pool: backgroundPool, onEvent }));
  await session.initialize();
  selected = "note";
  let previousCanvas = initial.canvas;
  session.subscribe(() => {
    renderChrome();
    if (previousCanvas !== session.document.canvas) {
      previousCanvas = session.document.canvas;
      fit();
    }
  });
  for (const r of data.registry.recipes) {
    const b = document.createElement("button");
    b.textContent = "+ " + r.type;
    b.dataset.recipe = recipeRef(r);
    b.onclick = () => addBlock(recipeRef(r));
    $("library").append(b);
  }
  $("component-count").textContent = data.registry.recipes.length + " 个配方";
  for (const p of data.presets.presets) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.label;
    $("preset").append(o);
  }
  $("preset").onchange = () =>
    act(async () => {
      const p = data.presets.presets.find((p) => p.id === $("preset").value);
      await session.commit(documentFromPreset(p));
      selected = session.document.rootId;
      fit();
    }, "预设已载入；可撤销回到原面板。");
  $("undo").onclick = () => act(() => session.undo(), "已撤销");
  $("redo").onclick = () => act(() => session.redo(), "已重做");
  $("fit").onclick = fit;
  $("zoom").onchange = () => {
    if ($("zoom").value === "fit") fit();
    else {
      scale = Number($("zoom").value);
      camera();
    }
  };
  $("edit").onclick = () => setMode("edit");
  $("play").onclick = () => setMode("play");
  $("save").onclick = () =>
    download(session.document.id + ".json", session.exportDocument());
  $("slice-editor").onclick = () => { window.open("slice.html", "_blank", "noopener"); };
  $("export").onclick = () =>
    download(session.document.id + ".panel.json", session.exportPackage());
  $("open").onclick = () => $("file").click();
  $("file").onchange = () =>
    act(async () => {
      const file = $("file").files[0];
      if (!file) return;
      if (file.size > maxPanelJsonBytes) throw Error("文档最大为 12 MiB；内嵌背景原图总计最多 8 MiB。");
      const value = JSON.parse(await file.text());
      await session.commit(
        value.kind === "ui_panel_fixture_export" ? value.document : value,
      );
      fit();
    }, "JSON 已载入并校验。");
  $("duplicate").onclick = () =>
    act(async () => {
      const prefix = "copy-" + crypto.randomUUID().slice(0, 8);
      await session.mutate({ type: "duplicate", id: selected, prefix });
      selected = prefix + "-0";
    });
  $("delete").onclick = () =>
    act(() => session.mutate({ type: "delete", id: selected }));
  for (const [id, delta] of [
    ["up", -1],
    ["down", 1],
  ])
    $(id).onclick = () =>
      act(() => {
        const { parents } = indexDocument(session.document),
          owner = parents.get(selected);
        if (!owner) throw Error("画板根不能排序。");
        const ids = owner.node.slots[owner.slot];
        return session.mutate({
          type: "reorder",
          id: selected,
          index: Math.max(
            0,
            Math.min(ids.length - 1, ids.indexOf(selected) + delta),
          ),
        });
      });
  $("interaction").addEventListener("pointerdown", gestureStart);
  $("viewport").addEventListener("pointerdown", (e) => {
    if (e.target === $("viewport") || e.button === 1) gestureStart(e);
  });
  document.addEventListener("pointermove", gestureMove);
  document.addEventListener("pointerup", gestureEnd);
  document.addEventListener("pointercancel", () => {
    cancelGesture();
  });
  $("viewport").addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const before = local(e),
        v = $("viewport").getBoundingClientRect();
      scale = Math.max(
        0.15,
        Math.min(2, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)),
      );
      pan = {
        x: e.clientX - v.left - before.x * scale,
        y: e.clientY - v.top - before.y * scale,
      };
      camera();
    },
    { passive: false },
  );
  document.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    if (e.code === "Space" && mode === "edit") {
      space = true;
      e.preventDefault();
    }
    if (e.key === "Escape") {
      cancelGesture();
    }
    if (mode !== "edit") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      act(() => (e.shiftKey ? session.redo() : session.undo()));
    }
    if (e.key === "Delete") {
      $("delete").click();
      e.preventDefault();
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") space = false;
  });
  window.addEventListener("blur", () => {
    space = false;
    cancelGesture();
  });
  new ResizeObserver(() => {
    if ($("zoom").value === "fit") fit();
  }).observe($("viewport"));
  renderChrome();
  fit();
  status("就绪。可选中说明文字拖动，或从左侧选择组件。");
  // Read-only diagnostics plus explicit operations for offline acceptance.
  window.editor = {
    get session() {
      return session;
    },
    get mode() {
      return mode;
    },
    get selected() {
      return selected;
    },
    get scale() {
      return scale;
    },
    data,
    choose,
    setMode,
    currentRect,
    fit,
    events,
    app,
    async open(doc) {
      await session.commit(doc);
      fit();
    },
    dispose() {
      if (disposed) return; disposed = true;
      session.dispose();
      skin.dispose();
      app.destroy({ removeView: true }, { children: true });
    },
  };
  window.editorReady = true;
  window.addEventListener("pagehide", () => window.editor.dispose(), { once: true });
}
boot().catch((e) => {
  status(e.message, true);
  $("empty-state").hidden = false;
  window.editorError = e.message;
});
