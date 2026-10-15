import { parseArgs } from "node:util";
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  rename,
  open,
  unlink,
  lstat,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startHarness } from "../tests/runtime/harness.mjs";
import { runComponentChecks } from "../tests/runtime/checks.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)),
  hash = (b) => createHash("sha256").update(b).digest("hex"),
  json = (v) => JSON.stringify(v, null, 2) + "\n";
const baseNames = [
  "inputs.json",
  "report.json",
  "overview.md",
  "landscape.png",
  "portrait.png",
];
const matrixName = (i) => `matrix-${String(i + 1).padStart(2, "0")}.png`;
const outputNames = (count) => [
  ...baseNames,
  ...Array.from({ length: count }, (_, i) => matrixName(i)),
];
async function identity() {
  const files = [
    "package.json",
    "package-lock.json",
    "scripts/components.mjs",
    "src/templates/contract.mjs",
  ];
  for (const dir of [
    "src/runtime",
    "src/slicing",
    "src/skins",
    "src/contracts",
    "tests/runtime",
    "configs",
    "schemas",
    "fixtures",
  ])
    for (const f of await readdir(join(root, dir)))
      if (/\.(mjs|json)$/.test(f)) files.push(dir + "/" + f);
  const entries = [];
  for (const file of files.sort())
    entries.push({ file, sha256: hash(await readFile(join(root, file))) });
  return { sha256: hash(json(entries)), files: entries };
}
async function move(a, b) {
  for (let i = 0; ; i++) {
    try {
      return await rename(a, b);
    } catch (e) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || i === 3) throw e;
      await delay(25 * (i + 1));
    }
  }
}
async function regular(path) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink())
    throw Error("Artifact must be a regular file.");
  return readFile(path);
}
async function directory(path) {
  await mkdir(path, { recursive: true });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink())
    throw Error("Output must be a regular directory.");
}
async function status(output) {
  let current;
  try {
    current = JSON.parse(await regular(join(output, "current.json")));
  } catch (e) {
    return { status: e.code === "ENOENT" ? "missing" : "corrupt" };
  }
  try {
    if (
      current.kind !== "ui_component_fixture_current" ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(current.buildId)
    )
      throw Error();
    const dir = join(output, "builds", current.buildId);
    for (const path of [output, join(output, "builds"), dir]) {
      const s = await lstat(path);
      if (!s.isDirectory() || s.isSymbolicLink()) throw Error();
    }
    const bytes = await regular(join(dir, "build-record.json"));
    if (hash(bytes) !== current.recordSha256) throw Error();
    const record = JSON.parse(bytes);
    const sheetCount = record.version === "0.1" ? 0 : record.matrixSheetCount;
    if (!Number.isInteger(sheetCount) || sheetCount < 0 || sheetCount > 256)
      throw Error();
    if (
      record.kind !== "ui_component_fixture_build" ||
      record.buildId !== current.buildId ||
      !["0.1", "0.2"].includes(record.version) ||
      json(record.files.map((f) => f.file).sort()) !==
        json(outputNames(sheetCount).sort())
    )
      throw Error();
    for (const f of record.files) {
      const b = await regular(join(dir, f.file));
      if (hash(b) !== f.sha256 || b.length !== f.bytes) throw Error();
    }
    return {
      status:
        (await identity()).sha256 === record.source.sha256
          ? "current"
          : "stale",
      buildId: current.buildId,
      p1Complete: false,
      overview: `builds/${current.buildId}/overview.md`,
    };
  } catch {
    return { status: "corrupt" };
  }
}
async function check(output, channel) {
  // An output ancestor must never encompass editable project sources.
  const outputPath = resolve(output);
  if (
    root === outputPath ||
    root.startsWith(outputPath + "\\") ||
    ["configs", "src", "tests", "schemas", "fixtures"].some(
      (p) => outputPath === join(root, p),
    )
  )
    throw Error("Unsafe output location.");
  const source = await identity();
  await directory(output);
  let lock;
  try {
    lock = await open(join(output, ".build.lock"), "wx");
  } catch (e) {
    if (e.code === "EEXIST")
      throw Error("Another component check owns .build.lock.");
    throw e;
  }
  const buildId = randomUUID();
  let harness,
    published = false;
  try {
    await lock.writeFile(json({ buildId }));
    await directory(join(output, ".staging"));
    await directory(join(output, "builds"));
    const dir = join(output, ".staging", buildId);
    await mkdir(dir);
    harness = await startHarness({ channel });
    await writeFile(join(dir, "inputs.json"), json(harness.data));
    const results = await runComponentChecks(harness, (r) =>
      console.log(`${r.id}: ${r.status}`),
    );
    const browserVersion = harness.browser.version();
    let portrait;
    const checks = [];
    for (const [orientation, width, height] of [
      ["landscape", 1280, 720],
      ["portrait", 720, 1280],
    ]) {
      const run =
        orientation === "landscape"
          ? harness
          : (portrait = await startHarness({ channel, width, height }));
      try {
        const boxes = await run.page.evaluate(() => harness.gallery());
        await run.page.evaluate(() => document.fonts.ready);
        const png = await run.page.evaluate(() => harness.png());
        await writeFile(
          join(dir, orientation + ".png"),
          Buffer.from(png.split(",")[1], "base64"),
        );
        const within = boxes.every(
          (b) =>
            b.box.x >= -0.5 &&
            b.box.y >= -0.5 &&
            b.box.x + b.box.width <= width + 0.5 &&
            b.box.y + b.box.height <= height + 0.5,
        );
        checks.push({
          orientation,
          width,
          height,
          componentCount: boxes.length,
          allBoxesWithinCanvas: within,
          boxes,
        });
        if (!within)
          results.push({
            id: "G.orientation." + orientation,
            status: "failed",
            message: "Component box outside the canvas.",
          });
        if (run.errors.length)
          results.push({
            id: "G.browser." + orientation,
            status: "failed",
            message: "Uncaught browser exception.",
          });
      } finally {
        if (orientation === "portrait") {
          await portrait.close();
          portrait = null;
        }
      }
    }
    const sheets = [],
      matrixRun = await startHarness({ channel, width: 1440, height: 1440 });
    try {
      const types = harness.data.cases.cases.map((c) => c.type);
      for (let offset = 0; offset < types.length; offset += 4) {
        const boxes = await matrixRun.page.evaluate(
          (types) => harness.matrixGallery(types),
          types.slice(offset, offset + 4),
        );
        const file = matrixName(sheets.length),
          png = await matrixRun.page.evaluate(() => harness.png());
        await writeFile(
          join(dir, file),
          Buffer.from(png.split(",")[1], "base64"),
        );
        const within = boxes.every(
          ({ box: b, cell: c }) =>
            b.x >= c.x - 0.6 &&
            b.y >= c.y - 0.6 &&
            b.x + b.width <= c.x + c.width + 0.6 &&
            b.y + b.height <= c.y + c.height + 0.6,
        );
        sheets.push({
          file,
          width: 1440,
          height: 1440,
          allBoxesWithinCells: within,
          boxes,
        });
        if (!within)
          results.push({
            id: "G.matrix." + file,
            status: "failed",
            message: "Matrix sample outside its cell.",
          });
      }
      if (matrixRun.errors.length)
        results.push({
          id: "G.matrix.browser",
          status: "failed",
          message: "Uncaught browser exception.",
        });
    } finally {
      await matrixRun.close();
    }
    const names = outputNames(sheets.length);
    const report = {
      kind: "ui_component_fixture_report",
      version: "0.2",
      buildId,
      status: results.every((r) => r.status === "passed")
        ? "fixture-subset-passed"
        : "failed",
      p1Complete: false,
      sourceKind: "fixture",
      sourceSha256: source.sha256,
      scope:
        "All registered baseline component types exercised using synthetic skins. Only listed assertions were run; not full G01-G07/T01-T16 acceptance, a production SkinPack or an editor.",
      environment: {
        browser: browserVersion,
        channel,
        rendering: "software-webgl-swiftshader",
        network: "blocked",
        font: "@fontsource/noto-sans-sc@5.3.1",
      },
      componentTypes: [
        ...new Set(harness.data.registry.recipes.map((r) => r.type)),
      ],
      recipeRefs: harness.data.registry.recipes.map(
        (r) => `${r.recipeId}@${r.recipeVersion}`,
      ),
      results,
      orientations: checks,
      matrixSheets: sheets,
      remaining: [
        "Further state/content/theme extremes and device-specific composite input",
        "Device IME/touch and mobile keyboard acceptance",
        "Production texture/font manifests, exact skin metadata and manual art acceptance",
        "Canvas editor acceptance is recorded separately in previews/editor, not inferred from this component report",
      ],
    };
    await writeFile(join(dir, "report.json"), json(report));
    if (report.status === "failed")
      throw Error(`Fixture checks failed; retained candidate ${buildId}.`);
    const rows = results.map(
      (r) =>
        `| ${r.id} | ${r.componentType} | ${r.description} | 通过（子集） |`,
    );
    await writeFile(
      join(dir, "overview.md"),
      [
        "# 全部组件离线夹具验收",
        "",
        `${report.componentTypes.length} 类基础组件；${results.length} 项检查通过。P1 尚未完成。这里是程序素材与浏览器断言的工程预览，不是正式皮肤或面板编辑器。`,
        "",
        "[完整报告](report.json) · [冻结输入](inputs.json) · [来源与文件摘要](build-record.json)",
        "",
        "## 横版 16:9",
        "",
        "![横版夹具](landscape.png)",
        "",
        "## 竖版 9:16",
        "",
        "![竖版夹具](portrait.png)",
        "",
        "## 尺寸与状态对照（正方形 PNG）",
        "",
        "各类展示三档尺寸和适用状态；横竖总览、方形验收图与正式 1:1 皮肤部件模板分别管理。",
        ...sheets.flatMap((s, i) => ["", `![尺寸与状态 ${i + 1}](${s.file})`]),
        "",
        "| 检查 | 类型 | 断言范围 | 结果 |",
        "| --- | --- | --- | --- |",
        ...rows,
        "",
        "完整阶段状态和剩余工作见执行文档；不能把本页的子集通过改写成正式用例全部通过。",
        "",
      ].join("\n"),
    );
    await harness.close();
    harness = null;
    if ((await identity()).sha256 !== source.sha256)
      throw Error("Source changed during checks; current was not updated.");
    const files = [];
    for (const file of names) {
      const b = await regular(join(dir, file));
      files.push({ file, sha256: hash(b), bytes: b.length });
    }
    const bytes = json({
      kind: "ui_component_fixture_build",
      version: "0.2",
      buildId,
      matrixSheetCount: sheets.length,
      source,
      files,
    });
    await writeFile(join(dir, "build-record.json"), bytes);
    await move(dir, join(output, "builds", buildId));
    const pending = join(output, `.current-${buildId}.json`);
    await writeFile(
      pending,
      json({
        kind: "ui_component_fixture_current",
        version: "0.1",
        buildId,
        recordSha256: hash(bytes),
      }),
      { flag: "wx" },
    );
    await move(pending, join(output, "current.json"));
    published = true;
    return {
      status: "fixture-subset-passed",
      buildId,
      componentTypeCount: report.componentTypes.length,
      checks: results.length,
      p1Complete: false,
      overview: `builds/${buildId}/overview.md`,
    };
  } finally {
    if (harness) await harness.close();
    try {
      await lock.close();
      await unlink(join(output, ".build.lock"));
    } catch {
      if (published)
        console.warn("Published, but .build.lock requires manual cleanup.");
    }
  }
}
try {
  const { values, positionals } = parseArgs({
    strict: true,
    allowPositionals: true,
    options: {
      out: { type: "string" },
      browser: { type: "string", default: "chrome" },
      help: { type: "boolean" },
    },
  });
  if (values.help)
    console.log(
      "node scripts/components.mjs check|status [--browser chrome|msedge|chromium] [--out path]",
    );
  else {
    if (
      positionals.length !== 1 ||
      !["check", "status"].includes(positionals[0]) ||
      !["chrome", "msedge", "chromium"].includes(values.browser)
    )
      throw Error("Invalid command.");
    const output = values.out
      ? resolve(values.out)
      : join(root, "previews/components");
    const r =
      positionals[0] === "check"
        ? await check(output, values.browser)
        : await status(output);
    console.log(json(r));
    if (!["current", "fixture-subset-passed"].includes(r.status))
      process.exitCode = 1;
  }
} catch (e) {
  console.error(
    json({
      status: "failed",
      code: e.code ?? "components.failed",
      message: e.issues
        ? "Input contracts are invalid."
        : e.message.includes("candidate")
          ? e.message
          : "Component checks or environment failed; inspect the retained staging candidate and run npm run test:components for diagnostics.",
    }),
  );
  process.exitCode = 1;
}
