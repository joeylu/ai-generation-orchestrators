import {
  readFile,
  writeFile,
  mkdir,
  rename,
  readdir,
  lstat,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const output = join(root, "previews/editor");
export const editorPages = Object.freeze({
  'index.html': { entry: 'src/editor/app.mjs', shell: 'src/editor/shell.html' },
  'slice.html': { entry: 'tools/panel-slicer/web/app.mjs', shell: 'tools/panel-slicer/web/shell.html' },
  'slice-runtime.html': { entry: 'examples/sliced-panel/app.mjs', shell: 'examples/sliced-panel/shell.html' },
});
export function scopedOutput(scope = 'all') {
  if (!['all', 'slicing'].includes(scope)) throw Error('Unknown editor scope.');
  return scope === 'all' ? output : join(root, 'previews/slicing');
}
export function scopedPages(scope = 'all') {
  scopedOutput(scope);
  return scope === 'all' ? editorPages : Object.fromEntries(Object.entries(editorPages).filter(([name]) => name !== 'index.html'));
}
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
async function move(from, to) {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (e) {
      if (i >= 9 || !["EPERM", "EACCES", "EBUSY"].includes(e.code)) throw e;
      await delay(50 * (i + 1));
    }
  }
}
export async function identity(scope = 'all', readSource = file => readFile(join(root, file))) {
  scopedOutput(scope);
  const files = [];
  async function walk(dir) {
    for (const item of await readdir(join(root, dir), {
      withFileTypes: true,
    })) {
      if (item.isSymbolicLink())
        throw Error("Source symlinks are not supported.");
      const file = dir + "/" + item.name;
      if (item.isDirectory()) await walk(file);
      else files.push(file);
    }
  }
  if (scope === 'slicing') {
    // Discover actual browser imports; unrelated canvas UI/configs are excluded.
    const graph = await build({ absWorkingDir: root, entryPoints: Object.values(scopedPages(scope)).map(p => p.entry),
      bundle: true, packages: 'external', metafile: true, write: false, outdir: 'virtual', logLevel: 'silent' });
    files.push(...Object.keys(graph.metafile.inputs).map(f => f.replaceAll('\\', '/')));
    files.push(...Object.values(scopedPages(scope)).map(p => p.shell),
      'tools/panel-slicer/web/data.mjs', 'tools/panel-slicer/cli/preview.mjs', 'src/editor/build.mjs', 'src/editor/policy.mjs',
      'src/contracts/validate.mjs', 'src/templates/contract.mjs',
      'schemas/component-registry.schema.json', 'schemas/skin-usage.schema.json', 'schemas/skin-template-set.schema.json',
      'configs/component-registry.draft.json', 'configs/skin-usage.draft.json', 'configs/skin-template-set.draft.json');
    await walk('tools/panel-slicer/tests/browser');
  } else for (const dir of [
    "src/runtime",
    "src/slicing",
    "src/slice-editor",
    "src/panel",
    "src/editor",
    "configs",
    "schemas",
    "tests/editor",
    "tests/slicing",
    "examples/sliced-panel",
    "tools/panel-slicer/src",
    "tools/panel-slicer/web",
    "tools/panel-slicer/tests/browser",
    "tools/panel-slicer/fixtures",
  ])
    await walk(dir);
  files.push(
    "package.json",
    "package-lock.json",
    "fixtures/neutral.skin.json",
    "fixtures/slice-sample.mjs",
    "src/contracts/props.mjs",
    "scripts/editor.mjs",
  );
  const evidence = await Promise.all(
    [...new Set(files)]
      .sort()
      .map(async (file) => ({
        file,
        sha256: hash(await readSource(file)),
      })),
  );
  return { sha256: hash(json(evidence)), files: evidence };
}
async function bundlePage(entry, shell, data) {
  const bundle = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    outdir: "virtual",
    loader: { ".woff2": "dataurl", ".woff": "dataurl" },
    minify: true,
    logLevel: "silent",
  });
  const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text,
    css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
  return (await readFile(join(root, shell), "utf8"))
    .replace("</head>", () => `<style>${css}</style></head>`)
    .replace(
      "</body>",
      () =>
        `<script>window.UI_CHAIN_DATA=${JSON.stringify(data).replaceAll("<", "\\u003c")};</script><script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script></body>`,
    );
}
export async function buildEditor(scope = 'all') {
  const output = scopedOutput(scope), source = await identity(scope);
  let data;
  if (scope === 'slicing') {
    const { sliceEditorData } = await import('../../tools/panel-slicer/web/data.mjs');
    data = await sliceEditorData();
  } else {
    const { editorData, presetDocument } = await import('../panel/data.mjs');
    const { validateDocument } = await import('../panel/document.mjs');
    data = await editorData();
    for (const preset of data.presets.presets) validateDocument(presetDocument(preset, data), data);
  }
  const pages = Object.fromEntries(await Promise.all(Object.entries(scopedPages(scope)).map(async ([name, { entry, shell }]) => [name, await bundlePage(entry, shell, data)])));
  const id = randomUUID(),
    dir = join(output, ".staging", id);
  await mkdir(dir, { recursive: true });
  for (const [name, html] of Object.entries(pages)) await writeFile(join(dir, name), html);
  return { id, dir, source, data, scope, html: pages['index.html'], sliceHtml: pages['slice.html'], layoutHtml: pages['slice-runtime.html'] };
}
export async function publishEditor(candidate, { report, images = {} } = {}) {
  const scope = candidate.scope ?? 'all', output = scopedOutput(scope);
  if (report && report.status !== 'passed') throw Error('Failed acceptance cannot be published.');
  if ((await identity(scope)).sha256 !== candidate.source.sha256)
    throw Error("Editor sources changed during build; candidate retained.");
  if (report) await writeFile(join(candidate.dir, "report.json"), json(report));
  for (const [name, bytes] of Object.entries(images))
    await writeFile(join(candidate.dir, name), bytes);
  const names = [
      ...Object.keys(scopedPages(scope)),
      ...(report ? ["report.json"] : []),
      ...Object.keys(images),
    ],
    files = [];
  for (const name of names)
    files.push({
      file: name,
      sha256: hash(await readFile(join(candidate.dir, name))),
    });
  const record = {
    kind: "ui_canvas_editor_build",
    version: "0.1",
    scope,
    buildId: candidate.id,
    status: report ? "offline-acceptance-passed" : "built-unverified",
    sourceKind: "fixture",
    source: candidate.source,
    files,
  };
  const bytes = json(record);
  await writeFile(join(candidate.dir, "build-record.json"), bytes);
  await mkdir(join(output, "builds"), { recursive: true });
  await move(candidate.dir, join(output, "builds", candidate.id));
  const pointer = {
    kind: "ui_canvas_editor_current",
    version: "0.1",
    buildId: candidate.id,
    recordSha256: hash(bytes),
  };
  const temporary = join(output, `current.${candidate.id}.tmp`);
  await writeFile(temporary, json(pointer));
  await move(temporary, join(output, "current.json"));
  return {
    status: record.status,
    buildId: candidate.id,
    entry: `builds/${candidate.id}/${scope === 'all' ? 'index.html' : 'slice.html'}`,
    sliceEntry: `builds/${candidate.id}/slice.html`,
    runtimeEntry: `builds/${candidate.id}/slice-runtime.html`,
  };
}
export async function editorStatus(scope = 'all') {
  const output = scopedOutput(scope);
  try {
    const pointer = JSON.parse(
      await readFile(join(output, "current.json"), "utf8"),
    );
    if (!/^[a-f0-9-]{36}$/.test(pointer.buildId)) return { status: "corrupt" };
    const dir = join(output, "builds", pointer.buildId),
      bytes = await readFile(join(dir, "build-record.json"));
    if (hash(bytes) !== pointer.recordSha256) return { status: "corrupt" };
    const record = JSON.parse(bytes);
    if ((record.scope ?? 'all') !== scope || Object.keys(scopedPages(scope)).some(name => !record.files.some(f => f.file === name))) return { status: 'corrupt' };
    for (const f of record.files) {
      if (!/^[a-z0-9.-]+$/.test(f.file)) return { status: "corrupt" };
      const path = join(dir, f.file);
      if (
        (await lstat(path)).isSymbolicLink() ||
        hash(await readFile(path)) !== f.sha256
      )
        return { status: "corrupt" };
    }
    return {
      status:
        (await identity(scope)).sha256 === record.source.sha256
          ? "current"
          : "stale",
      verification: record.status,
      buildId: pointer.buildId,
      entry: `builds/${pointer.buildId}/${scope === 'all' ? 'index.html' : 'slice.html'}`,
      sliceEntry: `builds/${pointer.buildId}/slice.html`,
      runtimeEntry: `builds/${pointer.buildId}/slice-runtime.html`,
    };
  } catch (e) {
    return { status: e.code === "ENOENT" ? "missing" : "corrupt" };
  }
}
