import test from "node:test";
import assert from "node:assert/strict";
import { editorData, presetDocument } from "../src/panel/data.mjs";
import { validateDocument, resourceClosure } from "../src/panel/document.mjs";
import { createSession } from "../src/panel/session.mjs";
const ctx = await editorData(),
  sample = () => presetDocument(ctx.presets.presets[0], ctx);
test("横竖预设从独立 JSON 加载，创作文档与递归资源闭包可重建", () => {
  for (const p of ctx.presets.presets) {
    const doc = validateDocument(presetDocument(p, ctx), ctx);
    const resources = resourceClosure(doc, ctx);
    assert.ok(resources.assets.includes("surface.panel"));
    assert.ok(resources.recipes.includes("slider@1.0.0"));
    assert.equal(resources.sourceKind, "fixture");
    assert.deepEqual(
      validateDocument(JSON.parse(JSON.stringify(doc)), ctx),
      doc,
    );
  }
});
test("未知字段、资源版本、重复/悬空/循环节点和非法自由区域坐标均拒绝", () => {
  for (const mutate of [
    (d) => (d.extra = true),
    (d) => (d.bindings.sha256 = "0".repeat(64)),
    (d) => d.nodes.push(d.nodes[0]),
    (d) => d.nodes[0].slots.children.push("missing"),
    (d) =>
      d.nodes
        .find((n) => n.id === "settings-body")
        .slots.children.push("settings"),
    (d) => (d.nodes.find((n) => n.id === "note").position.x = 10000),
    (d) => (d.nodes.find((n) => n.id === "note").props.unknown = 1),
  ]) {
    const d = sample();
    mutate(d);
    assert.throws(() => validateDocument(d, ctx));
  }
});
test("编辑操作原子提交，失败的文档/渲染不改变历史与当前实例", async () => {
  let disposed = 0;
  const s = createSession(sample(), ctx, (doc) => {
    if (doc.nodes.some((n) => n.name === "FAIL"))
      throw Error("renderer failed");
    return {
      dispose() {
        disposed++;
      },
    };
  });
  await s.initialize();
  const original = s.document;
  await assert.rejects(
    s.mutate({
      type: "update",
      id: "note",
      patch: { position: { x: 9999, y: 0 } },
    }),
  );
  assert.deepEqual(s.document, original);
  assert.equal(s.canUndo, false);
  assert.equal(disposed, 0);
  await assert.rejects(
    s.mutate({ type: "update", id: "note", patch: { name: "FAIL" } }),
  );
  assert.deepEqual(s.document, original);
  assert.equal(disposed, 0);
  await s.mutate({
    type: "update",
    id: "note",
    patch: { props: { text: "已修改" }, position: { x: 24, y: 24 } },
  });
  assert.equal(disposed, 1);
  await s.undo();
  assert.equal(
    s.document.nodes.find((n) => n.id === "note").props.text,
    original.nodes.find((n) => n.id === "note").props.text,
  );
  await s.redo();
  assert.equal(
    s.document.nodes.find((n) => n.id === "note").props.text,
    "已修改",
  );
  const reopened = createSession(JSON.parse(s.exportDocument()), ctx);
  assert.deepEqual(reopened.document, s.document);
  assert.equal(JSON.parse(s.exportPackage()).resources.sourceKind, "fixture");
  s.dispose();
});
test("过期编辑、锁定祖先、流式坐标失败；单次拖动只产生一条撤销历史", async () => {
  const s = createSession(sample(), ctx);
  const base = s.revision;
  await s.mutate(
    { type: "update", id: "note", patch: { position: { x: 32, y: 32 } } },
    base,
  );
  await assert.rejects(
    s.mutate({ type: "update", id: "note", patch: { name: "stale" } }, base),
  );
  await s.undo();
  assert.equal(s.canUndo, false);
  await s.mutate({ type: "update", id: "free-notes", patch: { locked: true } });
  assert.throws(() =>
    s.mutate({ type: "update", id: "note", patch: { name: "locked" } }),
  );
  await assert.rejects(
    s.mutate({
      type: "update",
      id: "music",
      patch: { position: { x: 0, y: 0 } },
    }),
  );
});
test("从 JSON 组件模板添加和复制稳定子树，所有 ID 与页签引用同步重映射", async () => {
  const s = createSession(sample(), ctx);
  const block = structuredClone(
    ctx.blocks.blocks.find((b) => b.type === "Tabs"),
  );
  // The padded Tabs viewport no longer fits the old 72px note-strip fixture.
  block.nodes[0].size = { width: 300, height: 112 };
  await s.mutate({
    type: "add",
    id: "artboard",
    slot: "children",
    block,
    prefix: "newtabs",
    position: { x: 200, y: 0 },
  });
  const added = s.document.nodes.find((n) => n.id === "newtabs-0");
  assert.ok(
    added.props.tabs.every((t) => t.contentNodeId.startsWith("newtabs-")),
  );
  await s.mutate({ type: "duplicate", id: added.id, prefix: "copy" });
  assert.equal(
    new Set(s.document.nodes.map((n) => n.id)).size,
    s.document.nodes.length,
  );
  await s.mutate({ type: "delete", id: "copy-0" });
  assert.ok(!s.document.nodes.some((n) => n.id.startsWith("copy-")));
});
