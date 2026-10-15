import assert from "node:assert/strict";

import { matrix, longProps } from "./matrix-fixtures.mjs";
export async function runMatrixChecks(h, onResult = () => {}) {
  const results = [],
    { page } = h;
  const check = async (id, type, description, fn) => {
    try {
      const evidence = await fn();
      const r = {
        id,
        componentType: type,
        description,
        status: "passed",
        scope: "offline-size-state-subset",
        evidence,
      };
      results.push(r);
      onResult(r);
    } catch (e) {
      const r = {
        id,
        componentType: type,
        description,
        status: "failed",
        scope: "offline-size-state-subset",
        message: e.message.split("\n")[0],
      };
      results.push(r);
      onResult(r);
    }
  };
  for (const sample of h.data.cases.cases)
    await check(
      sample.caseId + ".sizes",
      sample.type,
      "长内容，180/276/420 三档宽度；缩小再放大不缩字、不越界，非法尺寸不破坏原对象",
      async () => {
        await page.evaluate(
          ({ type, props }) => {
            harness.clear();
            window.current = harness.make(type, { props });
          },
          { type: sample.type, props: longProps(sample.type) },
        );
        const evidence = [];
        for (const variant of [
          ...matrix.variants,
          ...matrix.variants.slice(0, 1),
        ]) {
          const { width, heightDelta } = variant;
          const item = await page.evaluate(
            ({ width, height }) => {
              current.resize(width, height);
              harness.runtime.flush();
              const b = current.root.getBounds(),
                origin = current.root.toGlobal({ x: 0, y: 0 }),
                texts = [];
              function visit(v) {
                if (v.constructor.name === "Text" && v.visible) {
                  const m = v.worldTransform;
                  texts.push({
                    text: v.text,
                    sx: Math.hypot(m.a, m.b),
                    sy: Math.hypot(m.c, m.d),
                    size: v.style.fontSize,
                  });
                }
                for (const c of v.children ?? []) visit(c);
              }
              visit(current.root);
              return {
                width,
                height,
                bounds: {
                  x: b.x - origin.x,
                  y: b.y - origin.y,
                  width: b.width,
                  height: b.height,
                },
                texts,
                state: current.readState(),
              };
            },
            { width, height: sample.size.height + heightDelta },
          );
          assert.ok(
            item.bounds.x >= -0.6 &&
              item.bounds.y >= -0.6 &&
              item.bounds.x + item.bounds.width <= item.width + 0.6 &&
              item.bounds.y + item.bounds.height <= item.height + 0.6,
            `${sample.type}: painted bounds ${JSON.stringify(item.bounds)} outside ${item.width}x${item.height}`,
          );
          assert.ok(
            item.texts.every(
              (t) =>
                Math.abs(t.sx - 1) < 0.01 &&
                Math.abs(t.sy - 1) < 0.01 &&
                t.size === h.data.profile.fontSize,
            ),
            sample.type + ": text was scaled",
          );
          evidence.push(item);
        }
        const preserved = await page.evaluate(() => {
          const before = JSON.stringify(current.snapshot()),
            state = JSON.stringify(current.readState());
          let rejected = false;
          try {
            current.resize(1, 1);
          } catch {
            rejected = true;
          }
          harness.runtime.flush();
          return (
            rejected &&
            !current.root.destroyed &&
            before === JSON.stringify(current.snapshot()) &&
            state === JSON.stringify(current.readState())
          );
        });
        assert.equal(preserved, true);
        return evidence;
      },
    );
  await check(
    "G.resize-error",
    "Text",
    "溢出拒绝先于修改；连续失败与后续成功均保留同一文字对象",
    async () => {
      const result = await page.evaluate(() => {
        harness.clear();
        const n = harness.make("Text", {
          props: {
            text: "必须完整显示的一段文字",
            wrap: "none",
            overflow: "error",
          },
          size: { width: 400, height: 50 },
        });
        const text = n.adapter.text,
          before = n.snapshot();
        let errors = 0;
        for (let i = 0; i < 3; i++)
          try {
            n.resize(40, 30);
          } catch (e) {
            if (e.code === "text.overflow") errors++;
          }
        const kept =
          !text.destroyed &&
          JSON.stringify(n.snapshot()) === JSON.stringify(before) &&
          text.text === before.props.text;
        n.resize(450, 60);
        harness.runtime.flush();
        return {
          errors,
          kept,
          same: n.adapter.text === text,
          alive: !text.destroyed,
        };
      });
      assert.deepEqual(result, {
        errors: 3,
        kept: true,
        same: true,
        alive: true,
      });
    },
  );
  await check(
    "G.mode-toggle",
    "all",
    "编辑期间切换 enabled/visible 不恢复交互；不支持 enabled 的类型拒绝字段污染",
    async () => {
      await page.evaluate(() => {
        harness.clear();
        window.current = harness.make("CheckBox");
        harness.runtime.setMode("edit");
        current.setEnabled(false);
        current.setEnabled(true);
      });
      await page.mouse.click(52, 52);
      assert.equal(
        await page.evaluate(() => current.readState().checked),
        false,
      );
      const unchanged = await page.evaluate(() => {
        harness.clear();
        const n = harness.make("Text");
        const before = JSON.stringify(n.snapshot());
        try {
          n.setEnabled(false);
        } catch {
          return before === JSON.stringify(n.snapshot());
        }
        return false;
      });
      assert.equal(unchanged, true);
    },
  );
  const stateByType = matrix.values;
  for (const sample of h.data.cases.cases)
    await check(
      sample.caseId + ".states",
      sample.type,
      "运行值静默更新，隐藏/显示、适用禁用/启用和编辑/试玩切换均保留值",
      async () => {
        const result = await page.evaluate(
          ({ type, state }) => {
            harness.clear();
            const n = harness.make(type, {
              props: type === "Dialog" ? { modal: true } : {},
            });
            harness.events.length = 0;
            if (state) n.setState(state);
            const expected = n.readState(),
              snap = n.snapshot();
            const records = [];
            const record = (step) =>
              records.push({
                step,
                state: n.readState(),
                allowed: n.allowed(),
                modalOwners: harness.runtime.overlay.modals.length,
                openView: type === "Dialog" ? n.adapter.view.isOpen : null,
              });
            n.setVisible(false);
            record("hidden");
            n.setVisible(true);
            record("visible");
            if (n.recipe.propsSchema.properties.enabled) {
              n.setEnabled(false);
              record("disabled");
              n.setEnabled(true);
              record("enabled");
            }
            harness.runtime.setMode("edit");
            record("edit");
            harness.runtime.setMode("play");
            record("play");
            harness.runtime.flush();
            return {
              expected,
              records,
              events: [...harness.events],
              authoringUnchanged:
                JSON.stringify(n.snapshot()) === JSON.stringify(snap),
              inputs: document.querySelectorAll("input").length,
            };
          },
          { type: sample.type, state: stateByType[sample.type] ?? null },
        );
        for (const row of result.records) {
          assert.deepEqual(
            row.state,
            result.expected,
            sample.type + " " + row.step,
          );
          const active = ["visible", "enabled", "play"].includes(row.step);
          assert.equal(row.allowed, active);
          if (sample.type === "Dialog") {
            assert.equal(row.modalOwners, active ? 1 : 0);
            assert.equal(row.openView, true);
          }
        }
        assert.deepEqual(result.events, []);
        assert.equal(result.inputs, 0);
        assert.equal(result.authoringUnchanged, true);
        return result.records;
      },
    );
  await check(
    "G.resized-hit",
    "all",
    "扩大后的按钮/开关可点新区域；缩小后的列表行不会响应旧命中区域",
    async () => {
      for (const type of ["Button", "Switch"]) {
        await page.evaluate((type) => {
          harness.clear();
          window.current = harness.make(type);
          current.resize(420, 60);
          harness.events.length = 0;
        }, type);
        await page.mouse.click(440, 60);
        assert.equal(await page.evaluate(() => harness.events.length), 1, type);
      }
      await page.evaluate(() => {
        harness.clear();
        window.current = harness.make("List");
        current.resize(180, 80);
        harness.events.length = 0;
      });
      await page.mouse.click(300, 56);
      assert.equal(await page.evaluate(() => harness.events.length), 0);
      await page.mouse.click(205, 56);
      assert.equal(await page.evaluate(() => harness.events.length), 1);
    },
  );
  await check(
    "G.dialog-resize",
    "Dialog",
    "窗口改尺寸后重开与隐藏恢复不回到旧中心；初始隐藏模态不阻断其他输入",
    async () => {
      const result = await page.evaluate(() => {
        harness.clear();
        const n = harness.make("Dialog", {
          props: { modal: true, visible: false },
        });
        const initial = harness.runtime.overlay.modals.length;
        n.resize(420, 180);
        n.setVisible(true);
        n.setState({ open: false });
        n.setState({ open: true });
        harness.runtime.flush();
        const b = n.adapter.view.innerView.getBounds();
        return { initial, x: b.x, y: b.y, w: b.width, h: b.height };
      });
      assert.deepEqual(result, { initial: 0, x: 40, y: 40, w: 420, h: 180 });
    },
  );
  await check(
    "G.input-mask",
    "Input",
    "输入框保留主题正文颜色；蒙版不改变正文颜色",
    async () => {
      const pixels = await page.evaluate(() => {
        harness.clear();
        const n = harness.make("Input", {
          props: { value: "输入文字亮度检查" },
        });
        harness.runtime.flush();
        const canvas = document.createElement("canvas");
        canvas.width = harness.app.screen.width;
        canvas.height = harness.app.screen.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(harness.app.canvas, 0, 0);
        const masked = ctx.getImageData(55,45,200,30).data;
        const mask=n.adapter.view.inputField.mask;
        n.adapter.view.inputField.mask=null;harness.runtime.flush();
        ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(harness.app.canvas,0,0);
        const reference=ctx.getImageData(55,45,200,30).data;
        n.adapter.view.inputField.mask=mask;
        let maxError=0;for(let i=0;i<masked.length;i++)maxError=Math.max(maxError,Math.abs(masked[i]-reference[i]));
        return maxError;
      });
      assert.ok(
        pixels <= 2,
        "Expected theme-colored body text, not the skin red-channel mask.",
      );
    },
  );
  await check('G.input-vertical-center','Input','正文、占位与光标在不同高度和安全边距下保持同一中心',async()=>{
    const result=await page.evaluate(()=>{
      harness.clear();
      const n=harness.make('Input',{props:{value:'测试'}}),view=n.adapter.view;
      const errors=[];
      for(const height of [40,64]){
        n.resize(260,height);
        for(const value of ['测试','']){
          view.value=value;view.align();
          const center=(height+view.paddingTop-view.paddingBottom)/2;
          for(const item of [view.inputField,view.placeholder,view._cursor])if(item)errors.push(Math.abs(item.y-center));
        }
      }
      view.padding={top:10,bottom:2,left:26,right:26};view.align();
      for(const item of [view.inputField,view.placeholder,view._cursor])if(item)errors.push(Math.abs(item.y-36));
      return Math.max(...errors);
    });
    assert.ok(result<0.01);
  });
  await check(
    "G.matrix-errors",
    "all",
    "尺寸与状态检查后浏览器无未捕获异常",
    async () => assert.deepEqual(h.errors, []),
  );
  return results;
}
