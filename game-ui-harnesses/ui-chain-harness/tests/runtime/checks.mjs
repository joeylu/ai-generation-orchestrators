import assert from "node:assert/strict";
import { runMatrixChecks } from "./matrix-checks.mjs";
import { runCompositeChecks } from "./composite-checks.mjs";

export async function runComponentChecks(h, onResult = () => {}) {
  const { page } = h,
    results = [];
  const check = async (id, type, description, fn) => {
    try {
      await fn();
      const r = {
        id,
        componentType: type,
        description,
        status: "passed",
        scope: "offline-fixture-subset",
      };
      results.push(r);
      onResult(r);
    } catch (error) {
      const r = {
        id,
        componentType: type,
        description,
        status: "failed",
        message: error.message.split("\n")[0],
        scope: "offline-fixture-subset",
      };
      results.push(r);
      onResult(r);
    }
  };
  const make = (type, overrides = {}) =>
    page.evaluate(
      ({ type, overrides }) => {
        harness.clear();
        window.current = harness.make(type, overrides);
        harness.events.length = 0;
        return current.snapshot();
      },
      { type, overrides },
    );
  const click = async (expr = "current.adapter.view") => {
    const p = await page.evaluate((expression) => {
      const view = Function("return " + expression)();
      harness.runtime.flush();
      const b = view.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, expr);
    await page.mouse.click(p.x, p.y);
  };
  const state = () => page.evaluate(() => current.readState());
  const events = () => page.evaluate(() => harness.events);
  await check(
    "T01.fixture",
    "Button",
    "三变体、点击/取消/禁用/键盘、创作快照不被试玩污染",
    async () => {
      for (const variant of ["primary", "secondary", "compact"]) {
        await make("Button", { props: { variant } });
        await click();
        assert.equal(
          (await events()).filter((e) => e.event === "activate").length,
          1,
        );
      }
      await page.evaluate(() => (harness.events.length = 0));
      await page.mouse.move(70, 55);
      await page.mouse.down();
      await page.mouse.move(800, 500);
      await page.mouse.up();
      assert.equal((await events()).length, 0);
      await page.evaluate(() => {
        current.setEnabled(false);
        harness.events.length = 0;
      });
      await click();
      assert.equal((await events()).length, 0);
      await page.evaluate(() => {
        current.setEnabled(true);
        harness.runtime.focus(current);
      });
      await page.keyboard.press("Enter");
      assert.equal(
        (await events()).filter((e) => e.event === "activate").length,
        1,
      );
      await make("Button", { props: { enabled: false } });
      await click();
      assert.equal((await events()).length, 0);
      await page.evaluate(() => current.setEnabled(true));
      await click();
      assert.equal(
        (await events()).filter((e) => e.event === "activate").length,
        1,
      );
    },
  );
  await check(
    "T02.fixture",
    "Switch",
    "两态一次事件、静默赋值、快照与重开恢复初始值",
    async () => {
      await make("Switch");
      await click();
      assert.equal((await state()).checked, true);
      assert.equal((await events()).length, 1);
      await page.evaluate(() => {
        current.setState({ checked: false });
        harness.events.length = 0;
      });
      assert.equal((await state()).checked, false);
      await click();
      assert.equal((await state()).checked, true);
      assert.equal(
        await page.evaluate(() => current.snapshot().props.checked),
        false,
      );
      await make("Switch");
      assert.equal((await state()).checked, false);
    },
  );
  await check(
    "T03.fixture",
    "CheckBox",
    "框与标签点击均只翻转一次，禁用保留选中态",
    async () => {
      await make("CheckBox");
      await page.mouse.click(52, 52);
      assert.equal((await state()).checked, true);
      await click("current.adapter.view.labelText");
      assert.equal((await state()).checked, false);
      assert.equal((await events()).length, 2);
      await page.evaluate(() => {
        current.setState({ checked: true });
        current.setEnabled(false);
        harness.events.length = 0;
      });
      await click();
      assert.equal((await state()).checked, true);
      assert.equal((await events()).length, 0);
    },
  );
  await check(
    "T04.fixture",
    "RadioGroup",
    "稳定选项 ID、空/未选中与禁用项",
    async () => {
      await make("RadioGroup", { props: { selectedId: null } });
      assert.equal((await state()).selectedId, null);
      await click("current.adapter.view.items[1]");
      assert.equal((await state()).selectedId, "b");
      assert.equal((await events()).length, 1);
      await make("RadioGroup", {
        props: {
          options: [
            { id: "a", label: "同名", enabled: true },
            { id: "b", label: "同名", enabled: false },
          ],
          selectedId: "a",
        },
      });
      await click("current.adapter.view.items[1]");
      assert.equal((await state()).selectedId, "a");
      await make("RadioGroup", { props: { options: [], selectedId: null } });
      assert.equal((await state()).selectedId, null);
    },
  );
  await check(
    "T05.fixture",
    "Input",
    "原生输入、UTF-16/组合事件、只读、editEnd 和隐藏清理（桌面模拟）",
    async () => {
      await make("Input", { props: { maxLength: 8 } });
      await click();
      await page.locator("input").waitFor({ state: "attached" });
      await page.keyboard.insertText("中文");
      assert.equal((await state()).value, "中文");
      await page.keyboard.press("Enter");
      assert.equal(
        (await events()).filter((e) => e.event === "editEnd").length,
        1,
      );
      assert.equal(await page.locator("input").count(), 0);
      await make("Input", { props: { readOnly: true, value: "只读" } });
      await click();
      await page.keyboard.insertText("改");
      assert.equal((await state()).value, "只读");
      await page.evaluate(() => current.setVisible(false));
      assert.equal(await page.locator("input").count(), 0);
      await make("Input", { props: { maxLength: 2 } });
      await click();
      await page.evaluate(() => {
        const input = document.querySelector("input");
        input.dispatchEvent(new CompositionEvent("compositionstart"));
        input.value = "中文多字";
        input.dispatchEvent(new InputEvent("input", { isComposing: true }));
        input.dispatchEvent(new CompositionEvent("compositionend"));
      });
      assert.equal((await state()).value.length, 2);
    },
  );
  await check(
    "T06.fixture",
    "Select",
    "真实条目按钮、空选择、稳定 ID、浮层位置与外部关闭",
    async () => {
      await make("Select");
      assert.equal((await state()).selectedId, null);
      await click();
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.selects.size),
        1,
      );
      await click("current.adapter.view.rows[1]");
      assert.equal((await state()).selectedId, "b");
      assert.equal(
        (await events()).filter((e) => e.event === "selectionChange").length,
        1,
      );
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.selects.size),
        0,
      );
      await page.evaluate(() => {
        current.root.y = 680;
        harness.runtime.flush();
        current.adapter.view.open();
      });
      const box = await page.evaluate(() => {
        const b = current.adapter.view.view.getBounds();
        return { y: b.y, bottom: b.y + b.height };
      });
      assert.ok(box.y >= 0 && box.bottom <= 720.1);
      await page.mouse.click(900, 200);
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.selects.size),
        0,
      );
    },
  );
  await check(
    "T07.fixture",
    "Slider",
    "相对 min 的小数步长、最大端点、拖动完成与取消",
    async () => {
      await make("Slider", {
        props: { min: -0.1, max: 1, step: 0.2, value: 0.3 },
      });
      const p = await page.evaluate(() => {
        const v = current.adapter.view;
        return {
          start: v.toGlobal({ x: 0, y: 6 }),
          end: v.toGlobal({ x: 252, y: 6 }),
        };
      });
      await page.mouse.move(p.start.x, p.start.y);
      await page.mouse.down();
      assert.equal(await page.evaluate(()=>current.adapter.view._slider1.children[0].texture===harness.skin.texture('skin.slider.thumb.pressed')),true);
      await page.mouse.move(p.end.x, p.end.y, { steps: 5 });
      await page.mouse.up();
      assert.equal(await page.evaluate(()=>current.adapter.view._slider1.children[0].texture===harness.skin.texture('skin.slider.thumb.normal')),true);
      assert.equal((await state()).value, 1);
      assert.equal(
        (await events()).filter((e) => e.event === "valueCommit").length,
        1,
      );
      await page.evaluate(() => {
        current.setState({ value: 0.3 });
        harness.events.length = 0;
      });
      await page.mouse.move(p.start.x + 50, p.start.y);
      await page.mouse.down();
      await page.mouse.move(p.start.x + 110, p.start.y);
      await page.evaluate(() =>
        document.dispatchEvent(new PointerEvent("pointercancel")),
      );
      assert.equal(await page.evaluate(()=>current.adapter.view._slider1.children[0].texture===harness.skin.texture('skin.slider.thumb.normal')),true);
      await page.mouse.up();
      assert.equal(
        (await events()).filter((e) => e.event === "valueCommit").length,
        0,
      );
      assert.equal((await state()).value, 0.3);
    },
  );
  await check(
    "T08.fixture",
    "ProgressBar",
    "非零范围映射与静默更新，非法值拒绝",
    async () => {
      await make("ProgressBar", { props: { min: 10, max: 30, value: 20 } });
      assert.equal(await page.evaluate(() => current.adapter.bar.progress), 50);
      await page.evaluate(() => current.setState({ value: 30 }));
      assert.equal(
        await page.evaluate(() => current.adapter.bar.progress),
        100,
      );
      assert.equal((await events()).length, 0);
      assert.equal(
        await page.evaluate(() => {
          try {
            current.setState({ value: 31 });
            return false;
          } catch {
            return true;
          }
        }),
        true,
      );
    },
  );
  await check(
    "T09.fixture",
    "ScrollView",
    "真实轮滚、条块同值、裁切和隐藏后的输入隔离",
    async () => {
      await make("ScrollView");
      await page.mouse.move(120, 80);
      await page.mouse.wheel(0, 100);
      await page.waitForFunction(() => current.readState().initialOffsetY > 0);
      const s = await page.evaluate(() => ({
        offset: current.readState().initialOffsetY,
        bar: current.adapter.bar.value,
        mask: !!current.adapter.box.mask,
      }));
      assert.equal(s.offset, s.bar);
      assert.ok(s.mask);
      const track = await page.evaluate(() => {
        const b = current.adapter.bar.bg.getBounds();
        const thumb = current.adapter.bar.slider1.getBounds();
        return {
          x: b.x + b.width / 2,
          top: b.y,
          bottom: b.y + b.height,
          start: thumb.y + thumb.height / 2,
          width: b.width,
        };
      });
      assert.ok(Math.abs(track.width - await page.evaluate(()=>harness.skin.profile.geometry.scrollbarWidth)) < 0.1);
      assert.ok(Math.abs(track.bottom - track.top - await page.evaluate(()=>current.adapter.box.height)) < 0.1);
      assert.ok(await page.evaluate(()=>{
        const {view,background,box,bar}=current.adapter;
        const bounds=bar.bg.getBounds(),outer=background.getBounds();
        return view.children[0]===background && background.eventMode==='none' && box.x>0 && box.y>0 && bounds.maxX<outer.maxX && bounds.maxY<outer.maxY;
      }));
      await page.mouse.move(track.x, track.start);
      await page.mouse.down();
      await page.mouse.move(track.x, track.bottom, { steps: 5 });
      await page.mouse.up();
      assert.equal(
        await page.evaluate(() => current.readState().initialOffsetY),
        await page.evaluate(
          () => current.adapter.box.contentHeight - current.adapter.box.height,
        ),
      );
      const thumbBottom = await page.evaluate(() => {
        const b = current.adapter.bar.slider1.getBounds();
        return b.y + b.height;
      });
      assert.ok(Math.abs(thumbBottom - track.bottom) < 0.1);
      await page.evaluate(() => {
        current.setVisible(false);
        harness.events.length = 0;
      });
      await page.mouse.wheel(0, 100);
      assert.equal((await events()).length, 0);
    },
  );
  await check(
    "T10.fixture",
    "List",
    "条目 ID 单选、无选择模式、数据不重复实例化",
    async () => {
      await make("List");
      await click("current.adapter.rows[1]");
      assert.equal((await state()).selectedId, "b");
      assert.equal((await events()).length, 1);
      assert.equal(await page.evaluate(() => current.adapter.rows.length), 2);
      await make("List", { props: { selection: "none" } });
      await click("current.adapter.rows[1]");
      assert.equal((await state()).selectedId, null);
      assert.equal((await events()).length, 0);
    },
  );
  await check(
    "T11.fixture",
    "Dialog",
    "动作 ID、关闭一次、程序关闭静默、独立模态占用",
    async () => {
      await make("Dialog");
      await click("current.adapter.buttons[0]");
      const e = await events();
      assert.equal(e[0].actionId, "ok");
      assert.equal(e.filter((x) => x.event === "closed").length, 1);
      await page.evaluate(() => current.adapter.view.close());
      assert.equal(
        (await events()).filter((x) => x.event === "closed").length,
        1,
      );
      await make("Dialog", { props: { open: false, modal: true } });
      await page.evaluate(() => current.setState({ open: true }));
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.modals.length),
        1,
      );
      await page.evaluate(() => {
        window.second = harness.make("Dialog", { props: { modal: true } });
      });
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.modals.length),
        2,
      );
      await page.evaluate(() => second.dispose());
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.modals.length),
        1,
      );
      await page.evaluate(() => current.setState({ open: false }));
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.modals.length),
        0,
      );
      assert.equal((await events()).length, 0);
    },
  );
  await check(
    "T12.fixture",
    "Tabs",
    "稳定页 ID，切换时隐藏页失去输入资格，初始文档不变",
    async () => {
      await make("Tabs");
      assert.equal(await page.evaluate(() => current.adapter.rows[0].selectionRole), "skin.tab.selected");
      await click("current.adapter.rows[1]");
      assert.equal((await state()).activeId, "b");
      assert.equal(await page.evaluate(() => current.adapter.rows[0].selectionRole), "skin.tab.normal");
      assert.equal(await page.evaluate(() => current.adapter.rows[1].selectionRole), "skin.tab.selected");
      assert.equal(await page.evaluate(() => current.adapter.rows[1].defaultView.tint), 0xffffff);
      assert.equal((await events()).length, 1);
      assert.equal(
        await page.evaluate(() => current.adapter.switcher.views[0].visible),
        false,
      );
      assert.equal(
        await page.evaluate(() => current.snapshot().props.activeId),
        "a",
      );
      await page.evaluate(() => current.setState({ activeId: "a" }));
      assert.equal((await state()).activeId, "a");
    },
  );
  await check(
    "T12.surface",
    "Tabs",
    "双层底板独立包裹整体和内容、安全留白、缩放、切页和皮肤纹理所有权",
    async () => {
      await make("Tabs");
      const geometry=()=>page.evaluate(()=>{
        const a=current.adapter,s=harness.skin,box=a.background.getBounds(),content=a.switcher.getBounds();
        return {texture:a.background.texture===s.texture('skin.surface.content'),eventMode:a.background.eventMode,
          outer:{width:a.outerBackground.width,height:a.outerBackground.height,x:a.outerBackground.x,y:a.outerBackground.y,eventMode:a.outerBackground.eventMode},
          distinct:a.background!==a.outerBackground,order:a.view.getChildIndex(a.outerBackground)<a.view.getChildIndex(a.background),bx:a.background.x,
          width:a.background.width,height:a.background.height,y:a.background.y,header:s.profile.itemHeight+s.profile.geometry.labelGap,
          x:a.switcher.x,cy:a.switcher.y,hx:a.header.x,hy:a.header.y,headerWidth:a.header.width,pad:s.insets('skin.surface.content'),padding:s.profile.padding,
          mask:a.switcher.mask===a.contentMask,root:current.size,contentX:content.x-box.x,
          textScale:a.switcher.views[0].scale.x};
      });
      const verify=g=>{
        const left=Math.max(g.pad.left,g.padding),right=Math.max(g.pad.right,g.padding),top=Math.max(g.pad.top,g.padding),bottom=Math.max(g.pad.bottom,g.padding);
        assert.equal(g.texture,true);assert.equal(g.eventMode,'none');assert.equal(g.mask,true);assert.equal(g.distinct,true);assert.equal(g.order,true);
        assert.deepEqual(g.outer,{...g.root,x:0,y:0,eventMode:'none'});
        assert.equal(g.width,g.root.width-left-right);assert.equal(g.height,g.root.height-g.header-top-bottom);assert.equal(g.bx,left);assert.equal(g.y,top+g.header);
        assert.equal(g.hx,left);assert.equal(g.hy,top);assert.ok(Math.abs(g.headerWidth-g.width)<.1);
        assert.equal(g.x,left*2);assert.equal(g.cy,g.header+top*2);assert.equal(g.textScale,1);
      };
      verify(await geometry());
      await click("current.adapter.rows[1]");assert.equal((await state()).activeId,'b');verify(await geometry());
      await page.evaluate(()=>current.resize(360,210));verify(await geometry());assert.equal((await state()).activeId,'b');
      const count=(await events()).length;
      await page.evaluate(()=>{window.tabSize=current.size;try{current.resize(360,24);}catch{};});
      assert.deepEqual(await page.evaluate(()=>current.size),{width:360,height:210});assert.equal((await events()).length,count);
      await page.evaluate(()=>{window.tabTexture=current.adapter.background.texture;current.dispose();window.current=harness.make('Tabs');});
      assert.equal(await page.evaluate(()=>!tabTexture.destroyed&&current.adapter.background.texture===tabTexture),true);
    },
  );
  await check(
    "T13.fixture",
    "Image",
    "contain/cover/fill、资源失效与共享纹理所有权",
    async () => {
      for (const fit of ["contain", "cover", "fill"]) {
        await make("Image", { props: { fit } });
        const b = await page.evaluate(() => {
          const s = current.adapter.sprite;
          return {
            w: s.getBounds().width,
            h: s.getBounds().height,
            tw: s.texture.width,
            th: s.texture.height,
          };
        });
        if (fit !== "fill") assert.ok(Math.abs(b.w / b.h - b.tw / b.th) < 0.01);
        else assert.ok(Math.abs(b.w / b.h - 276 / 96) < 0.01);
      }
      assert.equal(
        await page.evaluate(() => {
          try {
            harness.make("Image", { props: { sourceRef: "missing" } });
            return false;
          } catch {
            return true;
          }
        }),
        true,
      );
      await page.evaluate(() => {
        const texture = current.adapter.sprite.texture;
        current.dispose();
        window.second = harness.make("Image");
        window.sharedOk =
          !texture.destroyed && second.adapter.sprite.texture === texture;
      });
      assert.equal(await page.evaluate(() => sharedOk), true);
    },
  );
  await check(
    "T14.fixture",
    "Text",
    "锁定中文字体、换行/省略、溢出明确失败且不缩字",
    async () => {
      await make("Text");
      const family = await page.evaluate(() => current.adapter.text.style.fontFamily);
      if (h.data.skinPack) {
        assert.ok(family.startsWith(`Skin-${h.data.skinPack.manifestSha256.slice(0,20)}-`));
        assert.equal(await page.evaluate(f => [...document.fonts].some(face => face.family === f && face.status === 'loaded'), family), true);
      } else assert.equal(family, "Noto Sans SC");
      assert.equal(await page.evaluate(() => current.adapter.text.scale.x), 1);
      await make("Text", {
        props: {
          text: "很长的中文文本".repeat(20),
          wrap: "none",
          overflow: "ellipsis",
        },
        size: { width: 100, height: 40 },
      });
      assert.ok(
        await page.evaluate(() => current.adapter.text.text.endsWith("…")),
      );
      assert.equal(
        await page.evaluate(() => {
          try {
            harness.make("Text", {
              props: { text: "超长内容".repeat(30), overflow: "error" },
              size: { width: 40, height: 30 },
            });
            return false;
          } catch (e) {
            return e.code === "text.overflow";
          }
        }),
        true,
      );
    },
  );
  await check(
    "T15.fixture",
    "Container",
    "Layout 实际行/列排版，普通容器不截获空白输入",
    async () => {
      await make("Container");
      const positions = await page.evaluate(() =>
        [...harness.runtime.handles.values()]
          .filter((h) => h.parent === current)
          .map((h) => h.root.toGlobal({ x: 0, y: 0 }).y),
      );
      assert.ok(positions[1] > positions[0]);
      assert.equal(
        await page.evaluate(() => current.root.eventMode),
        "passive",
      );
      await make("Container", {
        layout: { direction: "row" },
        size: { width: 600 },
      });
      const xs = await page.evaluate(() =>
        [...harness.runtime.handles.values()]
          .filter((h) => h.parent === current)
          .map((h) => h.root.toGlobal({ x: 0, y: 0 }).x),
      );
      assert.ok(xs[1] > xs[0]);
    },
  );
  await check(
    "T16.fixture",
    "Panel",
    "背景九宫格与安全区、加宽保留边框、普通面板无模态",
    async () => {
      await make("Panel");
      const left = await page.evaluate(() => current.adapter.bg.leftWidth);
      await page.evaluate(() => current.resize(380, 170));
      assert.equal(
        await page.evaluate(() => current.adapter.bg.leftWidth),
        left,
      );
      assert.equal(await page.evaluate(() => current.adapter.bg.width), 380);
      assert.equal(
        await page.evaluate(() => harness.runtime.overlay.modals.length),
        0,
      );
      assert.equal(
        await page.evaluate(() => {
          try {
            harness.make("Panel", {
              props: {
                contentPadding: { left: 0, top: 0, right: 0, bottom: 0 },
              },
            });
            return false;
          } catch (e) {
            return e.code === "panel.padding";
          }
        }),
        true,
      );
    },
  );
  await check(
    "G.recipes",
    "all",
    "注册配方共用类型夹具，新增已有能力配方无需复制运行时名单",
    async () => {
      for (const recipe of h.data.registry.recipes) {
        await make(recipe.type, {
          recipeRef: `${recipe.recipeId}@${recipe.recipeVersion}`,
        });
        assert.equal(
          await page.evaluate(() => current.snapshot().recipeRef),
          `${recipe.recipeId}@${recipe.recipeVersion}`,
        );
      }
      // Add an existing-capability recipe in memory: defaults must be consumed
      // by the real renderer without changing the adapter or fixture lists.
      const variant = await page.evaluate(() => {
        harness.clear();
        const r = structuredClone(
          harness.runtime.registry.recipes.find((r) => r.type === "Button"),
        );
        r.recipeId = "fixture-button-secondary";
        r.propsSchema.properties.variant.default = "secondary";
        harness.runtime.registry.recipes.push(r);
        try {
          const n = harness.make("Button", {
            recipeRef: r.recipeId + "@" + r.recipeVersion,
          });
          window.current = n;
          return {
            variant: n.snapshot().props.variant,
            texture:
              n.adapter.view.defaultView.texture ===
              harness.skin.texture("skin.button.secondary.normal"),
          };
        } finally {
          harness.runtime.registry.recipes.pop();
        }
      });
      assert.deepEqual(variant, { variant: "secondary", texture: true });
      await click();
      assert.equal(
        (await events()).filter((e) => e.event === "activate").length,
        1,
      );
    },
  );
  await check(
    "G.lifecycle",
    "all",
    "16 类逐一重挂载/销毁：无额外共享 ticker、原生输入或悬空句柄",
    async () => {
      for (const sample of h.data.cases.cases) {
        await page.evaluate(() => harness.clear());
        const before = await page.evaluate(() => harness.diagnostics());
        await page.evaluate((type) => {
          const n = harness.make(type);
          n.dispose();
          n.dispose();
        }, sample.type);
        const after = await page.evaluate(() => harness.diagnostics());
        assert.equal(
          after.sharedTickerListeners,
          before.sharedTickerListeners,
          sample.type + " ticker",
        );
        assert.equal(after.inputs, 0, sample.type + " input");
        assert.equal(after.handles, 0, sample.type + " handles");
      }
    },
  );
  await check(
    "G.editor-mode",
    "all",
    "编辑模式阻断控件事件，恢复试玩后可继续操作",
    async () => {
      await make("CheckBox");
      await page.evaluate(() => harness.runtime.setMode("edit"));
      await click();
      assert.equal((await state()).checked, false);
      assert.equal((await events()).length, 0);
      await page.evaluate(() => harness.runtime.setMode("play"));
      await click();
      assert.equal((await state()).checked, true);
    },
  );
  await check("G.errors", "all", "浏览器无未捕获异常", async () =>
    assert.deepEqual(h.errors, []),
  );
  results.push(...(await runMatrixChecks(h, onResult)));
  results.push(...(await runCompositeChecks(h, onResult)));
  return results;
}
