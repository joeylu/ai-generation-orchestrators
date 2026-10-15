import assert from "node:assert/strict";
import { chromium } from "playwright";
import { presetDocument } from "../../src/panel/data.mjs";
import { previewHeaders } from "../../src/editor/policy.mjs";
import { checkPanelBackgrounds } from "./background-checks.mjs";
import {settingsDocument} from '../../src/panel/settings.mjs';
import settingsContent from '../../configs/settings-content.json' with {type:'json'};
import settingsLayout from '../../configs/settings-layout.json' with {type:'json'};
export async function checkEditor(candidate, channel = "chrome") {
  const browser = await chromium.launch({
      channel,
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    }),
    page = await browser.newPage({
      viewport: { width: 1600, height: 1050 },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    }),
    errors = [],
    checks = [],
    images = {};
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          status: 200,
          headers: previewHeaders,
          body: candidate.html,
        })
      : route.abort(),
  );
  const check = async (id, description, fn) => {
    try {
      await fn();
      checks.push({ id, description, status: "passed" });
    } catch (e) {
      checks.push({ id, description, status: "failed", message: e.message });
    }
    console.log(
      `${id} ${checks.at(-1).status}${checks.at(-1).message ? " " + checks.at(-1).message : ""}`,
    );
  };
  const open = async (index) =>
    page.evaluate(
      (doc) => editor.open(doc),
      presetDocument(candidate.data.presets.presets[index], candidate.data),
    );
  const point = async (id, fx = 0.5, fy = 0.5) =>
    page.evaluate(
      ({ id, fx, fy }) => {
        const r = editor.currentRect(id),
          c = editor.app.canvas.getBoundingClientRect();
        return {
          x: c.x + (r.x + r.width * fx) * editor.scale,
          y: c.y + (r.y + r.height * fy) * editor.scale,
        };
      },
      { id, fx, fy },
    );
  const select = async (id) =>
    page.locator(`#tree [data-node="${id}"]`).click();
  const revision = () => page.evaluate(() => editor.session.revision);
  const waitCommit = async (before) =>
    page.waitForFunction((before) => editor.session.revision > before, before, {
      timeout: 3000,
    }).catch(async e=>{throw Error(e.message+'; '+await page.locator('#status').textContent());});
  try {
    await page.goto("http://127.0.0.1:4175/");
    await page.waitForFunction(
      () => window.editorReady || window.editorError,
      {},
      { timeout: 30000 },
    );
    await check(
      "E01.boot",
      "离线启动、字体加载、横版画布与 16 类组件库",
      async () => {
        assert.equal(await page.evaluate(() => window.editorError), undefined);
        assert.equal(
          await page.locator("#library button").count(),
          candidate.data.registry.recipes.length,
        );
        assert.equal(await page.evaluate(() => editor.app.screen.width), 1280);
        images["landscape.png"] = await page.screenshot();
      },
    );
    if (!(await page.evaluate(() => !!window.editorReady)))
      return {
        report: {
          kind: "ui_canvas_editor_acceptance",
          version: "0.1",
          status: "failed",
          checks,
          errors,
        },
        images,
      };
    await check(
      "E02.properties",
      "属性栏真实修改中文，撤销重做保持稳定 ID",
      async () => {
        await select("note");
        const before = await revision();
        await page
          .locator('[data-field="props.text"]')
          .fill("验收修改：中文 ABC");
        await page.locator("#apply").click();
        await waitCommit(before);
        assert.equal(
          await page.evaluate(
            () =>
              editor.session.document.nodes.find((n) => n.id === "note").props
                .text,
          ),
          "验收修改：中文 ABC",
        );
        await page.locator("#undo").click();
        await page.waitForFunction(
          () =>
            editor.session.document.nodes.find((n) => n.id === "note").props
              .text !== "验收修改：中文 ABC",
        );
        await page.locator("#redo").click();
        await page.waitForFunction(
          () =>
            editor.session.document.nodes.find((n) => n.id === "note").props
              .text === "验收修改：中文 ABC",
        );
      },
    );
    await check(
      "E03.free-drag",
      "自由区域实际指针拖动、缩放与单次撤销事务",
      async () => {
        await open(0);
        await select("note");
        const before = await revision(),
          p = await point("note"),
          scale = await page.evaluate(() => editor.scale);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x + 32 * scale, p.y + 16 * scale, { steps: 5 });
        await page.mouse.up();
        await waitCommit(before);
        assert.deepEqual(
          await page.evaluate(
            () =>
              editor.session.document.nodes.find((n) => n.id === "note")
                .position,
          ),
          { x: 48, y: 32 },
        );
        await page.locator("#undo").click();
        await page.waitForFunction(
          () =>
            editor.session.document.nodes.find((n) => n.id === "note").position
              .x === 16,
        );
        await select("note");
        const rev = await revision(),
          r = await point("note", 1, 1);
        await page.mouse.move(r.x, r.y);
        await page.mouse.down();
        await page.mouse.move(r.x + 32 * scale, r.y, { steps: 4 });
        await page.mouse.up();
        await waitCommit(rev);
        assert.equal(
          await page.evaluate(
            () =>
              editor.session.document.nodes.find((n) => n.id === "note").size
                .width,
          ),
          368,
        );
      },
    );
    await check(
      "E04.atomic-failure",
      "非法尺寸不改文档/历史/实例；错误后可正常继续编辑",
      async () => {
        await select("note");
        const before = await revision(),
          previous = await page.evaluate(() => editor.session.exportDocument());
        await page.locator('[data-field="width"]').fill("1");
        await page.locator("#apply").click();
        await page.waitForFunction(() =>
          document.getElementById("status").classList.contains("error"),
        );
        assert.equal(await revision(), before);
        assert.equal(
          await page.evaluate(() => editor.session.exportDocument()),
          previous,
        );
        await page.locator('[data-field="width"]').fill("352");
        await page.locator("#apply").click();
        await waitCommit(before);
      },
    );
    await check(
      "E05.flow-sort",
      "流式区域实际拖动只改顺序、不产生自由坐标",
      async () => {
        await open(0);
        const before = await revision(),
          from = await point("music"),
          target = await point("volume", 0.5, 0.95);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 5 });
        await page.mouse.up();
        await waitCommit(before);
        const doc = await page.evaluate(() => editor.session.document);
        assert.ok(
          doc.nodes
            .find((n) => n.id === "settings-body")
            .slots.children.indexOf("music") >
            doc.nodes
              .find((n) => n.id === "settings-body")
              .slots.children.indexOf("volume"),
        );
        assert.equal(
          doc.nodes.find((n) => n.id === "music").position,
          undefined,
        );
      },
    );
    await check(
      "E06.play-isolation",
      "编辑点击不触发业务；试玩开关不污染保存值；退出试玩恢复默认",
      async () => {
        await open(0);
        const p = await point("music");
        await page.mouse.click(p.x, p.y);
        assert.equal(await page.evaluate(() => editor.events.length), 0);
        const original = await page.evaluate(() =>
          editor.session.exportDocument(),
        );
        await page.locator("#play").click();
        await page.mouse.click(p.x, p.y);
        assert.equal(
          await page.evaluate(
            () =>
              editor.session.current.runtime.handles.get("music").readState()
                .checked,
          ),
          false,
        );
        assert.equal(
          await page.evaluate(() => editor.session.exportDocument()),
          original,
        );
        await page.locator("#edit").click();
        assert.equal(
          await page.evaluate(
            () =>
              editor.session.current.runtime.handles.get("music").readState()
                .checked,
          ),
          true,
        );
      },
    );
    await check(
      "E07.all-components",
      "16 类均由组件库真实添加、选择、复制/删除、撤销；组合槽可编译",
      async () => {
        for (const r of candidate.data.registry.recipes) {
          await page.evaluate(
            async (doc) => {
              doc.nodes = [doc.nodes.find((n) => n.id === doc.rootId)];
              doc.nodes[0].slots.children = [];
              await editor.open(doc);
              editor.choose(doc.rootId);
            },
            presetDocument(candidate.data.presets.presets[0], candidate.data),
          );
          const before = await revision();
          await page
            .locator(`[data-recipe="${r.recipeId}@${r.recipeVersion}"]`)
            .click();
          await waitCommit(before);
          assert.equal(
            await page.evaluate(
              () =>
                editor.session.current.runtime.handles.get(editor.selected)
                  .recipe.type,
            ),
            r.type,
          );
          const count = await page.evaluate(
            () => editor.session.document.nodes.length,
          );
          await page.locator("#duplicate").click();
          await page.waitForFunction(
            (n) => editor.session.document.nodes.length > n,
            count,
          );
          await page.locator("#delete").click();
          await page.waitForFunction(
            (n) => editor.session.document.nodes.length === n,
            count,
          );
        }
      },
    );
    await check(
      "E08.save-reopen",
      "真实下载创作 JSON、导出资源引用包、上传重开、拒绝错版资源",
      async () => {
        await open(0);
        const original = await page.evaluate(() => editor.session.document);
        const download = page.waitForEvent("download");
        await page.locator("#save").click();
        const file = await download;
        assert.match(file.suggestedFilename(), /\.json$/);
        const stream = await file.createReadStream(),
          chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const text = Buffer.concat(chunks).toString();
        assert.deepEqual(JSON.parse(text), original);
        const before = await revision();
        await page.locator("#file").setInputFiles({
          name: "saved.json",
          mimeType: "application/json",
          buffer: Buffer.from(text),
        });
        await waitCommit(before);
        const reopened = await page.evaluate(() => editor.session.document);
        delete reopened.revision;
        delete original.revision;
        assert.deepEqual(reopened, original);
        const pack = await page.evaluate(() =>
          JSON.parse(editor.session.exportPackage()),
        );
        assert.ok(pack.resources.assets.includes("surface.panel"));
        assert.equal(
          pack.document.bindings.sha256,
          candidate.data.binding.sha256,
        );
      },
    );
    await check(
      "E09.portrait",
      "竖版预设、缩放/平移不改文档，选择和拖动坐标正确",
      async () => {
        await page
          .locator("#preset")
          .selectOption(candidate.data.presets.presets[1].id);
        await page.waitForFunction(
          () => editor.session.document.canvas === "portrait",
        );
        assert.equal(await page.evaluate(() => editor.app.screen.height), 1280);
        const original = await page.evaluate(() =>
          editor.session.exportDocument(),
        );
        await page.locator("#zoom").selectOption("0.5");
        await page.locator("#fit").click();
        assert.equal(
          await page.evaluate(() => editor.session.exportDocument()),
          original,
        );
        await select("note");
        const before = await revision(),
          p = await point("note"),
          s = await page.evaluate(() => editor.scale);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x + 16 * s, p.y + 16 * s, { steps: 4 });
        await page.mouse.up();
        await waitCommit(before);
        assert.deepEqual(
          await page.evaluate(
            () =>
              editor.session.document.nodes.find((n) => n.id === "note")
                .position,
          ),
          { x: 32, y: 32 },
        );
        images["portrait.png"] = await page.screenshot();
      },
    );
    await check(
      "E10.render-rollback",
      "候选 Text 渲染溢出失败后，原画面/文档/共享纹理仍可使用",
      async () => {
        await open(0);
        const result = await page.evaluate(async () => {
          const previous = editor.session.current.root,
            before = editor.session.exportDocument();
          let rejected = false;
          try {
            await editor.session.mutate({
              type: "update",
              id: "note",
              patch: {
                props: {
                  overflow: "error",
                  text: "不可缩小的超长内容".repeat(500),
                },
              },
            });
          } catch {
            rejected = true;
          }
          return {
            rejected,
            same: previous === editor.session.current.root,
            unchanged: before === editor.session.exportDocument(),
            alive: !previous.root.destroyed,
          };
        });
        assert.deepEqual(result, {
          rejected: true,
          same: true,
          unchanged: true,
          alive: true,
        });
      },
    );
    await check(
      "E11.layout-lock",
      "属性栏切换流式/自由布局可撤销，锁定后拖动不提交",
      async () => {
        await select("free-notes");
        const before = await revision();
        await page.locator('[data-field="childrenMode"]').selectOption("flow");
        await page.locator("#apply").click();
        await waitCommit(before);
        assert.equal(
          await page.evaluate(
            () =>
              editor.session.document.nodes.find((n) => n.id === "note")
                .position,
          ),
          undefined,
        );
        await page.locator("#undo").click();
        await page.waitForFunction(
          () =>
            !!editor.session.document.nodes.find((n) => n.id === "note")
              .position,
        );
        await select("free-notes");
        const rev = await revision();
        await page.locator('[data-field="locked"]').check();
        await page.locator("#apply").click();
        await waitCommit(rev);
        const locked = await revision(),
          p = await point("note");
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.move(p.x + 30, p.y + 20, { steps: 3 });
        await page.mouse.up();
        assert.equal(await revision(), locked);
        await select("free-notes");
        await page.locator('[data-field="locked"]').uncheck();
        await page.locator("#apply").click();
        await waitCommit(locked);
      },
    );
    await check("E12.binding", "导入错误资源版本不覆盖当前文档", async () => {
      const result = await page.evaluate(async () => {
        const before = editor.session.exportDocument(),
          bad = editor.session.document;
        bad.bindings.sha256 = "0".repeat(64);
        let failed = false;
        try {
          await editor.open(bad);
        } catch {
          failed = true;
        }
        return {
          failed,
          unchanged: before === editor.session.exportDocument(),
        };
      });
      assert.deepEqual(result, { failed: true, unchanged: true });
    });
    await check("E14.panel-slicing", "Panel 倍率属性可保存、重开，内容区保持独立", async () => {
      await open(0);
      const id = await page.evaluate(() => editor.session.document.nodes.find(n => n.recipeRef === "panel@1.0.0").id);
      await select(id);
      const before = await revision();
      await page.locator('[data-field="props.pixelsPerUnitMultiplier"]').fill("2");
      await page.locator("#apply").click();
      await waitCommit(before);
      const saved = await page.evaluate(() => editor.session.exportDocument());
      await page.evaluate(saved => editor.open(JSON.parse(saved)), saved);
      assert.equal(await page.evaluate(id => editor.session.document.nodes.find(n => n.id === id).props.pixelsPerUnitMultiplier, id), 2);
      assert.equal(await page.locator("#slice-editor").isVisible(), true);
    });
    await checkPanelBackgrounds({ browser, page, candidate, check, images });
    await check('E15.layout-rules','高级布局属性保存、实际填充、网格排版及重新导入',async()=>{
      await open(0);await select('actions');
      let before=await revision();await page.locator('[data-field="justify"]').selectOption('space-between');await page.locator('#apply').click();await waitCommit(before);
      await select('confirm');await page.getByText('尺寸与弹性（高级）',{exact:true}).click();before=await revision();
      await page.locator('[data-field="widthMode"]').selectOption('fill');await page.locator('#apply').click();await waitCommit(before);
      assert.ok(await page.evaluate(()=>editor.session.current.runtime.handles.get('confirm').size.width>editor.session.document.nodes.find(n=>n.id==='confirm').size.width));
      await select('actions');before=await revision();await page.locator('[data-field="direction"]').selectOption('grid');
      await page.locator('[data-field="columns"]').fill('2');await page.locator('[data-field="cellHeight"]').fill('40');await page.locator('#apply').click();await waitCommit(before);
      const saved=await page.evaluate(()=>editor.session.exportDocument());await page.evaluate(s=>editor.open(JSON.parse(s)),saved);
      const sizes=await page.evaluate(()=>['confirm','cancel'].map(id=>editor.session.current.runtime.handles.get(id).size));assert.equal(sizes[0].width,sizes[1].width);
      assert.equal(JSON.parse(saved).version,'0.3');images['layout-properties.png']=await page.screenshot();
    });
    await check('E16.generated-layout','新设置面板横竖版编译采用弹性宽度且保持表单值',async()=>{
      for(const canvas of ['landscape','portrait']){
        const doc=settingsDocument(settingsContent,settingsLayout,canvas,candidate.data);await page.evaluate(doc=>editor.open(doc),doc);
        const result=await page.evaluate(()=>{const r=editor.session.current.runtime,c=r.handles.get('music'),row=r.handles.get('music-row');return {width:c.size.width,row:row.size.width,checked:c.readState().checked,version:editor.session.document.version};});
        assert.equal(result.version,'0.3');assert.equal(result.checked,true);
        assert.ok(Math.abs(result.width-(canvas==='landscape'?result.row-settingsLayout.orientations.landscape.labelWidth-settingsLayout.orientations.landscape.rowGap:result.row))<.1);
      }
    });
    await check(
      "E13.errors",
      "浏览器无未捕获异常，停止编辑后无残留原生输入",
      async () => {
        assert.deepEqual(errors, []);
        assert.equal(
          await page.evaluate(
            () =>
              [...document.querySelectorAll("input")].filter(
                (x) => !x.closest("header,aside,.toolbar"),
              ).length,
          ),
          0,
        );
      },
    );
    return {
      report: {
        kind: "ui_canvas_editor_acceptance",
        version: "0.1",
        status: checks.every((r) => r.status === "passed")
          ? "passed"
          : "failed",
        sourceKind: "fixture",
        browser: browser.version(),
        network: "blocked",
        rendering: "software-webgl-swiftshader",
        checks,
        errors,
      },
      images,
    };
  } catch (e) {
    console.error(
      "Editor boot diagnostics:",
      JSON.stringify({
        errors,
        status: await page.locator("#status").textContent(),
      }),
    );
    throw e;
  } finally {
    await browser.close();
  }
}
