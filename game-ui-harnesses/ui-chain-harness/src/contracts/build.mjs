import {
  readFile,
  writeFile,
  mkdir,
  lstat,
  open,
  unlink,
  rename,
  readdir,
} from "node:fs/promises";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { root, fail } from "../templates/contract.mjs";
import { readContracts } from "./validate.mjs";
import { deriveContracts } from "./derive.mjs";
import { dependencyEvidence } from "./dependencies.mjs";

export const defaults = {
  registry: fileURLToPath(
    new URL("configs/component-registry.draft.json", root),
  ),
  usage: fileURLToPath(new URL("configs/skin-usage.draft.json", root)),
  template: fileURLToPath(
    new URL("configs/skin-template-set.draft.json", root),
  ),
  output: fileURLToPath(new URL("generated/component-contracts/", root)),
};
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const sourceKeys = ["registry", "usage", "template"];
const sourceHashes = (inputs) =>
  Object.fromEntries(
    sourceKeys.map((k) => [
      k,
      {
        sha256: hash(inputs.bytes[k]),
        revision: inputs[k].revision,
        version: inputs[k].version,
      },
    ]),
  );
const names = [
  "registry.source.json",
  "usage.source.json",
  "template.source.json",
  "catalog.json",
  "props-schema.json",
  "acceptance-plan.json",
  "catalog.md",
  "acceptance-plan.md",
  "dependency-evidence.json",
];
async function toolIdentity() {
  const files = [
    "package.json",
    "package-lock.json",
    "scripts/contracts.mjs",
    "schemas/component-registry.schema.json",
    "schemas/skin-usage.schema.json",
    "schemas/skin-template-set.schema.json",
    "src/templates/contract.mjs",
    ...(await readdir(new URL("src/contracts/", root)))
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => "src/contracts/" + f),
  ];
  const evidence = [];
  for (const file of files.sort())
    evidence.push({ file, sha256: hash(await readFile(new URL(file, root))) });
  return { sha256: hash(json(evidence)), files: evidence };
}
async function directory(path) {
  await mkdir(path, { recursive: true });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink())
    fail("/output", "output.directory", "输出路径须是普通目录。");
}
async function regular(path) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink())
    fail("/output", "output.file", "输出必须为普通文件。");
  return readFile(path);
}
async function move(from, to) {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (e) {
      if (
        process.platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(e.code) ||
        i === 3
      )
        throw e;
      await delay(25 * (i + 1));
    }
  }
}

export async function buildContracts(options = {}) {
  const paths = { ...defaults, ...options },
    inputs = await readContracts(paths),
    sources = sourceHashes(inputs),
    tool = await toolIdentity(),
    dependencies = await dependencyEvidence();
  for (const k of sourceKeys) {
    const rel = relative(resolve(paths.output), resolve(paths[k]));
    if (
      !rel ||
      (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
    )
      fail("/output", "output.source", "维护源必须在派生目录之外。");
  }
  await directory(paths.output);
  let lock;
  try {
    lock = await open(join(paths.output, ".build.lock"), "wx");
  } catch (e) {
    if (e.code === "EEXIST")
      fail(
        "/output",
        "build.busy",
        "已有合同构建正在执行；异常退出锁恢复方法见维护说明。",
      );
    throw e;
  }
  const buildId = randomUUID();
  let published,
    phase = "derive";
  try {
    await lock.writeFile(json({ buildId }));
    for (const dir of [".staging", "builds"])
      await directory(join(paths.output, dir));
    const staging = join(paths.output, ".staging", buildId);
    await mkdir(staging);
    const outputs = deriveContracts(inputs, sources, dependencies);
    // Preserve exact bytes, not JSON reserialization: snapshots carry the source hash.
    for (const k of sourceKeys) outputs[k + ".source.json"] = inputs.bytes[k];
    const files = [];
    for (const file of names) {
      await writeFile(join(staging, file), outputs[file], { flag: "wx" });
      const bytes = await regular(join(staging, file));
      files.push({ file, bytes: bytes.length, sha256: hash(bytes) });
    }
    phase = "verify";
    for (const k of sourceKeys)
      if (hash(await readFile(paths[k])) !== sources[k].sha256)
        fail(
          "/sources",
          "build.changed",
          "构建期间源发生变化；当前版本未切换。",
        );
    if (
      (await toolIdentity()).sha256 !== tool.sha256 ||
      json(await dependencyEvidence()) !== json(dependencies)
    )
      fail("/tool", "build.changed", "构建期间工具或依赖发生变化。");
    const record = {
      kind: "ui_contract_build",
      version: "0.1",
      buildId,
      sources,
      tool,
      dependencySha256: hash(json(dependencies)),
      files,
    };
    const recordBytes = json(record);
    await writeFile(join(staging, "build-record.json"), recordBytes, {
      flag: "wx",
    });
    phase = "publish";
    await move(staging, join(paths.output, "builds", buildId));
    const pending = join(paths.output, `.current-${buildId}.json`);
    await writeFile(
      pending,
      json({
        kind: "ui_contract_current",
        version: "0.1",
        buildId,
        recordSha256: hash(recordBytes),
      }),
      { flag: "wx" },
    );
    await move(pending, join(paths.output, "current.json"));
    published = {
      status: "built-draft",
      buildId,
      recipeCount: inputs.registry.recipes.length,
      blockerCount: inputs.blockers.length,
      productionReady: false,
      catalog: `builds/${buildId}/catalog.md`,
    };
    return published;
  } catch (e) {
    if (e.issues) throw e;
    fail(
      "/build/" + phase,
      "build.failed",
      `合同构建 ${phase} 失败；候选 ${buildId} 未更新当前入口。`,
    );
  } finally {
    try {
      await lock.close();
      await unlink(join(paths.output, ".build.lock"));
    } catch {
      if (published)
        published.warning = "构建成功，但锁清理失败；按维护说明恢复。";
    }
  }
}

export async function contractStatus(options = {}) {
  const paths = { ...defaults, ...options };
  let pointer, record;
  try {
    pointer = JSON.parse(await regular(join(paths.output, "current.json")));
  } catch (e) {
    return { status: e.code === "ENOENT" ? "missing" : "corrupt" };
  }
  try {
    if (
      pointer.kind !== "ui_contract_current" ||
      pointer.version !== "0.1" ||
      !uuid.test(pointer.buildId) ||
      !digest.test(pointer.recordSha256)
    )
      throw Error();
    const dir = join(paths.output, "builds", pointer.buildId);
    for (const path of [paths.output, join(paths.output, "builds"), dir]) {
      const s = await lstat(path);
      if (!s.isDirectory() || s.isSymbolicLink()) throw Error();
    }
    const bytes = await regular(join(dir, "build-record.json"));
    if (hash(bytes) !== pointer.recordSha256) throw Error();
    record = JSON.parse(bytes);
    if (
      record.kind !== "ui_contract_build" ||
      record.version !== "0.1" ||
      record.buildId !== pointer.buildId ||
      !digest.test(record.tool.sha256) ||
      !digest.test(record.dependencySha256) ||
      json(record.files.map((f) => f.file).sort()) !== json([...names].sort())
    )
      throw Error();
    for (const entry of record.files) {
      const b = await regular(join(dir, entry.file));
      if (
        !digest.test(entry.sha256) ||
        hash(b) !== entry.sha256 ||
        b.length !== entry.bytes
      )
        throw Error();
    }
    const frozen = await readContracts(
      Object.fromEntries(
        sourceKeys.map((k) => [k, join(dir, k + ".source.json")]),
      ),
    );
    if (
      json(sourceHashes(frozen)) !== json(record.sources) ||
      hash(await regular(join(dir, "dependency-evidence.json"))) !==
        record.dependencySha256
    )
      throw Error();
  } catch {
    return { status: "corrupt" };
  }
  const previous = {
    buildId: pointer.buildId,
    catalog: `builds/${pointer.buildId}/catalog.md`,
  };
  let inputs, dependencies;
  try {
    inputs = await readContracts(paths);
    dependencies = await dependencyEvidence();
  } catch (e) {
    return { status: "invalid-source", ...previous, issues: e.issues ?? [] };
  }
  const sourceChanged = json(sourceHashes(inputs)) !== json(record.sources),
    toolChanged = (await toolIdentity()).sha256 !== record.tool.sha256,
    dependenciesChanged = hash(json(dependencies)) !== record.dependencySha256;
  return {
    status:
      sourceChanged || toolChanged || dependenciesChanged ? "stale" : "current",
    ...previous,
    sourceChanged,
    toolChanged,
    dependenciesChanged,
    productionReady: false,
  };
}
