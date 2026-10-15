import assert from "node:assert/strict";
export async function runCompositeChecks(h, onResult = () => {}) {
  const { page } = h,
    results = [];
  const check = async (id, type, description, fn) => {
    try {
      await fn();
      results.push({
        id,
        componentType: type,
        description,
        status: "passed",
        scope: "offline-fixture-subset",
      });
    } catch (e) {
      results.push({
        id,
        componentType: type,
        description,
        status: "failed",
        message: e.message.split("\n")[0],
        scope: "offline-fixture-subset",
      });
    }
    onResult(results.at(-1));
  };
  await check(
    "G.composite-list",
    "List",
    "显式条目支持 Panel 复合内容；稳定选择、键盘、销毁和共享资源",
    async () => {
      await page.evaluate(() => {
        harness.clear();
        const content = ["row-a", "row-b"].map((id) =>
          harness.make(
            "Panel",
            { id, size: { width: 260, height: 126 } },
            false,
          ),
        );
        window.current = harness.runtime.create(
          {
            id: "custom-list",
            recipeRef: "list@1.0.0",
            props: {
              itemRecipeRef: "panel@1.0.0",
              items: [
                { id: "a", label: "A" },
                { id: "b", label: "B" },
              ],
            },
            size: { width: 280, height: 280 },
          },
          { items: content },
        );
        current.root.position.set(40, 40);
        harness.runtime.mount(current);
        harness.runtime.focus(current);
        harness.events.length = 0;
      });
      await page.keyboard.press("End");
      assert.equal(
        await page.evaluate(() => current.readState().selectedId),
        "b",
      );
      assert.equal(await page.evaluate(() => harness.events.length), 1);
      await page.evaluate(() => current.dispose());
      assert.equal(await page.evaluate(() => harness.runtime.handles.size), 0);
    },
  );
  await check(
    "G.keyboard-composites",
    "all",
    "单选/页签/下拉键盘跳过禁用项；滑条端点；Input Tab 释放 DOM",
    async () => {
      for (const type of ["RadioGroup", "Tabs", "Select"]) {
        await page.evaluate((type) => {
          harness.clear();
          const sample = harness.cases.find((c) => c.type === type),
            key = type === "Tabs" ? "tabs" : "options";
          const items = structuredClone(sample.props[key]);
          items[1].enabled = false;
          items.push({ ...items[0], id: "c", label: "第三项", enabled: true });
          window.current = harness.make(type, {
            props: {
              [key]: items,
              ...(type === "Tabs" ? {} : { selectedId: "a" }),
            },
            size: { height: 144 },
          });
          harness.runtime.focus(current);
          harness.events.length = 0;
        }, type);
        await page.keyboard.press("ArrowRight");
        if (type === "Select") await page.keyboard.press("Enter");
        assert.equal(
          await page.evaluate(
            () =>
              current.readState().selectedId ?? current.readState().activeId,
          ),
          "c",
        );
        assert.equal(await page.evaluate(() => harness.events.length), 1);
      }
      await page.evaluate(() => {
        harness.clear();
        window.current = harness.make("Slider", {
          props: { min: 0.1, max: 1, step: 0.3, value: 0.1 },
        });
        harness.runtime.focus(current);
        harness.events.length = 0;
      });
      await page.keyboard.press("End");
      assert.equal(await page.evaluate(() => current.readState().value), 1);
      await page.evaluate(() => {
        harness.clear();
        window.current = harness.make("Input");
        window.next = harness.make("Button");
        harness.runtime.focus(current);
      });
      assert.equal(await page.locator("input").count(), 1);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("input").count(), 0);
    },
  );
  await check(
    "G.nested-scroll",
    "ScrollView",
    "嵌套滚动一次滚轮只由最内层消费，编辑模式不滚动",
    async () => {
      await page.evaluate(() => {
        harness.clear();
        window.inner = harness.make(
          "ScrollView",
          { id: "inner", size: { width: 220, height: 112 } },
          false,
        );
        const body = harness.runtime.create(
          {
            id: "outer-body",
            recipeRef: "container@1.0.0",
            props: {},
            size: { width: 260, height: 500 },
          },
          { children: [inner] },
        );
        window.current = harness.runtime.create(
          {
            id: "outer",
            recipeRef: "scroll-view@1.0.0",
            props: {},
            size: { width: 300, height: 200 },
          },
          { content: [body] },
        );
        current.root.position.set(40, 40);
        harness.runtime.mount(current);
      });
      await page.mouse.move(100, 100);
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(60);
      const values = await page.evaluate(() => [
        inner.readState().initialOffsetY,
        current.readState().initialOffsetY,
      ]);
      assert.ok(values[0] > 0);
      assert.equal(values[1], 0);
      await page.evaluate(() => harness.runtime.setMode("edit"));
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(30);
      assert.deepEqual(
        await page.evaluate(() => [
          inner.readState().initialOffsetY,
          current.readState().initialOffsetY,
        ]),
        values,
      );
    },
  );
  await check(
    "G.empty-content",
    "all",
    "空集合和空文案可创建/释放；超长中文不缩字、不产生浏览器异常",
    async () => {
      await page.evaluate(() => {
        for (const type of [
          "Button",
          "Input",
          "Text",
          "List",
          "Select",
          "RadioGroup",
        ]) {
          harness.clear();
          const props =
            type === "Text"
              ? { text: "" }
              : type === "Input"
                ? { value: "", placeholder: "" }
                : type === "List"
                  ? { items: [], selectedId: null }
                  : ["Select", "RadioGroup"].includes(type)
                    ? { options: [], selectedId: null }
                    : { label: "" };
          const n = harness.make(type, { props });
          n.dispose();
        }
        const n = harness.make("Text", {
          props: { text: "长中文🙂".repeat(1000), overflow: "ellipsis" },
        });
        n.resize(180, 64);
        n.dispose();
      });
      assert.deepEqual(h.errors, []);
    },
  );
  return results;
}
