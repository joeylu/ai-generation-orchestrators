import assert from "node:assert/strict";
import {hoverScrollBox,deliverCanvasWheel} from './wheel.mjs';
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
    "显式条目支持 Panel 复合内容；稳定选择、鼠标、销毁和共享资源",
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
      const point=await page.evaluate(()=>{const row=current.adapter.rows[1];const b=(row.view??row).getBounds();return {x:b.x+8,y:b.y+8};});
      await page.mouse.click(point.x,point.y);
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
    "G.pointer-only",
    "all",
    "组件不响应导航快捷键、不创建焦点框；Input 保留文字编辑",
    async () => {
      for (const type of ['Button','Switch','CheckBox','RadioGroup','Select','Slider','List','Dialog','Tabs']) {
        const before=await page.evaluate(type=>{harness.clear();window.current=harness.make(type);harness.runtime.focus(current);harness.events.length=0;return current.readState();},type);
        for(const key of ['Tab','ArrowRight','End','Enter','Space','Escape']) await page.keyboard.press(key);
        assert.deepEqual(await page.evaluate(()=>current.readState()),before,type);
        assert.equal(await page.evaluate(()=>harness.events.length),0,type);
        assert.equal(await page.evaluate(()=>!!current.focusRing),false,type);
      }
      await page.evaluate(()=>{harness.clear();window.current=harness.make('Input');harness.runtime.focus(current);});
      await page.keyboard.insertText('保留中文输入');
      assert.equal(await page.evaluate(()=>current.readState().value),'保留中文输入');
      assert.equal(await page.evaluate(()=>!!current.focusRing),false);
      await page.evaluate(()=>harness.runtime.focus(null));
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
      await hoverScrollBox(page,'inner.adapter.box');
      await deliverCanvasWheel(page,0,80,'inner.adapter.box',{scrollCondition:'inner.readState().initialOffsetY > 0',scrollTimeout:5000});
      const values = await page.evaluate(() => [
        inner.readState().initialOffsetY,
        current.readState().initialOffsetY,
      ]);
      assert.ok(values[0] > 0);
      assert.equal(values[1], 0);
      await page.evaluate(() => harness.runtime.setMode("edit"));
      await deliverCanvasWheel(page,0,80,'inner.adapter.box');
      assert.deepEqual(await page.evaluate(()=>[inner.readState().initialOffsetY,current.readState().initialOffsetY]),values);
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
