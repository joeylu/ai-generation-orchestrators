import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentDisposition,
  namedImageZip,
  projectExportFilename,
} from "../image-export.mjs";
import { readImageZip } from "./read-image-zip.mjs";

test("project downloads retain Unicode prefixes with filesystem-safe names and ASCII headers", () => {
  const cases = [
    ["幻想冒险", "幻想冒险"],
    ["  My Game  ", "My Game"],
    ['A"/B\\C:*?<>|\r\n', "A__B_C________"],
    ["CON", "_CON"],
    ["...", "project"],
    ["游戏.png", "游戏.png"],
    ["e\u0301", "é"],
    ["", "project"],
  ];
  for (const [projectName, prefix] of cases) {
    for (const [format, suffix] of [
      ["images", "reference-images"],
      ["complete", "references"],
    ]) {
      const filename = projectExportFilename(projectName, format);
      assert.equal(filename, `${prefix}-${suffix}.zip`);
      assert.ok(!/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/u.test(filename));
      const header = attachmentDisposition(filename);
      assert.match(
        header,
        /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/u,
      );
      assert.equal(decodeURIComponent(header.split("UTF-8''")[1]), filename);
    }
  }
  const long = projectExportFilename("冒险🌟".repeat(100), "images");
  assert.ok(Buffer.byteLength(long) < 240);
  assert.ok(!long.includes("�"));
  assert.equal(
    decodeURIComponent(attachmentDisposition(long).split("UTF-8''")[1]),
    long,
  );
  assert.ok(
    !/[!'()*]/u.test(
      attachmentDisposition("玩家的 UI (2)'!.zip").split("UTF-8''")[1],
    ),
  );
  assert.throws(
    () => projectExportFilename("Game", "other"),
    /EXPORT_FORMAT_INVALID/u,
  );
});

test("image archive preserves Chinese names, deduplicates titles and preserves payload bytes", () => {
  const images = [
    { panelId: "a", title: "游戏大厅", bytes: Buffer.from("123456789") },
    { panelId: "b", title: "游戏大厅", bytes: Buffer.from("second") },
    { panelId: "c", title: "游戏大厅 (2)", bytes: Buffer.from("third") },
    { panelId: "d", title: "设置.png", bytes: Buffer.from("fourth") },
  ];
  const zip = namedImageZip(images),
    files = readImageZip(zip);
  assert.deepEqual(
    [...files.keys()],
    ["游戏大厅.png", "游戏大厅 (2).png", "游戏大厅 (2) (2).png", "设置.png"],
  );
  assert.deepEqual(
    [...files.values()],
    images.map((image) => image.bytes),
  );
  assert.equal(zip.readUInt32LE(14), 0xcbf43926); // Known CRC-32 of 123456789.
  assert.deepEqual(namedImageZip(images), zip);
});

test("image archive makes traversal, Windows device, long and case-colliding titles safe", () => {
  const titles = [
    "../危险\\文件:*?",
    "CON",
    "aux.txt",
    "..",
    "A",
    "a",
    "长".repeat(200),
  ];
  const zip = namedImageZip(
    titles.map((title, index) => ({
      panelId: `panel-${index}`,
      title,
      bytes: Buffer.from([index]),
    })),
  );
  const names = [...readImageZip(zip).keys()];
  assert.equal(
    new Set(names.map((name) => name.toLowerCase())).size,
    titles.length,
  );
  assert.ok(
    names.every(
      (name) => !/[\\/:*?"<>|]/u.test(name) && Buffer.byteLength(name) < 240,
    ),
  );
  assert.equal(names[1], "_CON.png");
  assert.equal(names[2], "_aux.txt.png");
  assert.equal(names[3], "panel-3.png");
  assert.equal(names[5], "a (2).png");
});

test("existing SDK state panels get distinct display and export names without overriding custom titles", () => {
  const images = [
    {
      panelId: "sdk-loading",
      title: "场景加载",
      bytes: Buffer.from("loading"),
    },
    {
      panelId: "sdk-loading-failed",
      title: "场景加载",
      bytes: Buffer.from("failed"),
    },
    {
      panelId: "sdk-pause-online",
      title: "已暂停",
      bytes: Buffer.from("online"),
    },
    {
      panelId: "sdk-pause-local",
      title: "已暂停",
      bytes: Buffer.from("local"),
    },
    {
      panelId: "sdk-result-complete",
      title: "通关",
      bytes: Buffer.from("complete"),
    },
    {
      panelId: "sdk-result-failed",
      title: "未通关",
      bytes: Buffer.from("result-failed"),
    },
    {
      panelId: "sdk-loading",
      title: "我的加载页",
      bytes: Buffer.from("custom"),
    },
    {
      panelId: "custom-loading",
      title: "场景加载",
      bytes: Buffer.from("uploaded"),
    },
  ];
  const files = readImageZip(namedImageZip(images));
  assert.deepEqual(
    [...files.keys()],
    [
      "场景加载 · 加载中.png",
      "场景加载 · 加载失败.png",
      "暂停面板 · 在线.png",
      "暂停面板 · 本地 _ 离线.png",
      "结算面板 · 完成.png",
      "结算面板 · 失败.png",
      "我的加载页.png",
      "场景加载.png",
    ],
  );
  assert.deepEqual(
    [...files.values()],
    images.map((image) => image.bytes),
  );
});
