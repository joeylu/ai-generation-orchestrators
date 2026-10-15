import { readFile } from "node:fs/promises";
import { root, fail } from "../templates/contract.mjs";
import { createHash } from "node:crypto";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Installed declaration/source probes. These are version evidence, never interaction tests.
const probes = [
  [
    "@pixi/ui",
    "lib/index.d.ts",
    [
      "FancyButton",
      "CheckBox",
      "RadioGroup",
      "Select",
      "Slider",
      "ProgressBar",
      "ScrollBox",
      "List",
      "Dialog",
      "Switcher",
      "input",
    ],
  ],
  [
    "@pixi/ui",
    "lib/input/Input.d.ts",
    ["class Input", "onEnter:", "onChange:"],
  ],
  [
    "@pixi/ui",
    "lib/Select.d.ts",
    ["protected convertItemsToButtons", "onSelect:", "protected scrollBox"],
  ],
  ["@pixi/ui", "lib/Slider.d.ts", ["onUpdate:", "onChange:", "set step"]],
  ["@pixi/ui", "lib/ScrollBox.d.ts", ["onScroll:", "scrollY", "destroy("]],
  ["@pixi/ui", "lib/Dialog.d.ts", ["onSelect:", "onClose:", "destroy("]],
  [
    "@pixi/layout",
    "dist/components/LayoutContainer.d.ts",
    ["class LayoutContainer"],
  ],
  [
    "@pixi/layout",
    "dist/components/LayoutContainer.mjs",
    ['this.eventMode = "static"'],
  ],
];
export async function dependencyEvidence() {
  const manifest = JSON.parse(await readFile(new URL("package.json", root))),
    lock = JSON.parse(await readFile(new URL("package-lock.json", root)));
  const packages = [];
  for (const name of ["pixi.js", "@pixi/ui", "@pixi/layout", "yoga-layout"]) {
    let installed;
    try {
      installed = JSON.parse(
        await readFile(new URL(`node_modules/${name}/package.json`, root)),
      );
    } catch {
      fail("/dependencies", "dependencies.missing", `依赖 ${name} 未安装。`);
    }
    const expected = manifest.dependencies[name],
      entry = lock.packages[`node_modules/${name}`];
    if (
      !/^\d+\.\d+\.\d+$/.test(expected ?? "") ||
      installed.version !== expected ||
      entry?.version !== expected ||
      !entry.integrity
    )
      fail(
        "/dependencies",
        "dependencies.version",
        `依赖 ${name} 的精确版本/锁不匹配。`,
      );
    packages.push({
      name,
      version: installed.version,
      lockIntegrity: entry.integrity,
      peerDependencies: installed.peerDependencies ?? {},
    });
  }
  const files = [];
  for (const [name, path, symbols] of probes) {
    let bytes;
    try {
      bytes = await readFile(new URL(`node_modules/${name}/${path}`, root));
    } catch {
      fail(
        "/dependencies",
        "dependencies.api",
        `缺少已锁定依赖的 API 文件 ${name}/${path}。`,
      );
    }
    if (symbols.some((s) => !bytes.toString().includes(s)))
      fail(
        "/dependencies",
        "dependencies.api",
        `API 声明探针不匹配：${name}/${path}。`,
      );
    files.push({
      package: name,
      file: path,
      sha256: hash(bytes),
      observedSymbols: symbols,
    });
  }
  return {
    kind: "ui_dependency_declaration_evidence",
    version: "0.1",
    scope:
      "Installed versions and source/declaration probes only; no instantiation, layout or behavior acceptance.",
    packages,
    files,
  };
}
