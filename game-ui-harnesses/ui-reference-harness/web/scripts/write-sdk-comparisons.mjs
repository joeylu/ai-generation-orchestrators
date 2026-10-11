// Deterministic prototype review images. Never calls a model or provider.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { templateInput, templatePreview } from "../template-previews.mjs";
import { sdkPanels } from "../examples/sdk-fixed-panels.mjs";
import {
  createPanelBundle,
  validatePanelBundle,
} from "../../../ui-panel-harness/src/panel-bundle.mjs";
import { loadWorkspaceCore } from "../../../ui-panel-harness/src/component-adapter.mjs";

const [output, sharpPath] = process.argv.slice(2);
if (!output || !sharpPath || process.argv.length !== 4)
  throw new Error("OUTPUT_AND_SHARP_MODULE_REQUIRED");
const sharp = (await import(pathToFileURL(path.resolve(sharpPath)).href))
  .default;
await fs.mkdir(output, { recursive: false });
const core = await loadWorkspaceCore();
const panels = [];
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
const nested = (svg, prefix, x) =>
  svg
    .replace("<svg ", `<svg x="${x}" y="110" `)
    .replaceAll('id="clip-', `id="${prefix}-clip-`)
    .replaceAll("url(#clip-", `url(#${prefix}-clip-`);
for (const { spec: sdkSpec, ...metadata } of sdkPanels) {
  const item = {
    ...metadata,
    id: sdkSpec.id,
    name: `${metadata.groupName} · ${metadata.variant}`,
  };
  const [oldSvg, sdkSvg] = await Promise.all([
    templatePreview(`flow-${item.id}`),
    templatePreview(`fixed-${item.id}`),
  ]);
  const { spec, catalog } = templateInput(`fixed-${item.id}`);
  const bundle = await createPanelBundle(spec, catalog, core);
  await validatePanelBundle(JSON.parse(JSON.stringify(bundle)), core);
  const filename = `${item.id}-comparison.png`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1984" height="1010" viewBox="0 0 1984 1010" font-family="Microsoft YaHei, sans-serif"><rect width="1984" height="1010" fill="#ffffff"/><text x="32" y="42" font-size="30" font-weight="bold">${escape(item.name)}</text><text x="32" y="86" font-size="23" fill="#52665b">旧版：通用排版 · 面板宽 600</text><text x="1024" y="86" font-size="23" fill="#286548">新版：SDK 默认布局 · 同一 960 × 800 视口</text>${nested(oldSvg, "old", 16)}${nested(sdkSvg, "sdk", 1008)}<text x="32" y="951" font-size="22" fill="#52665b">${escape(item.description)}</text><text x="32" y="986" font-size="18" fill="#73847b">程序绘制的布局参考；中性配色，字体像素与动态效果由实际运行环境决定。</text></svg>`;
  await fs.writeFile(
    path.join(output, `${item.id}.panel.bundle.json`),
    JSON.stringify(bundle, null, 2),
  );
  await fs.writeFile(path.join(output, `${item.id}-comparison.svg`), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(output, filename));
  panels.push({
    id: item.id,
    name: item.name,
    description: item.description,
    file: filename,
    bundleSha256: bundle.sha256,
  });
}
const tiles = await Promise.all(
  panels.map(async (item, index) => ({
    input: await sharp(path.join(output, item.file))
      .resize(992, 505)
      .png()
      .toBuffer(),
    left: (index % 2) * 992,
    top: Math.floor(index / 2) * 505,
  })),
);
await sharp({
  create: { width: 1984, height: 2020, channels: 3, background: "#ffffff" },
})
  .composite(tiles)
  .png()
  .toFile(path.join(output, "all-comparisons.png"));
await fs.writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDK 原型布局对照</title><style>body{margin:0;padding:28px;background:#edf2ee;color:#233c2e;font:16px/1.6 "Microsoft YaHei",sans-serif}main{max-width:1984px;margin:auto}h1{font-size:28px}figure{margin:28px 0;background:white;padding:16px;border-radius:12px}img{width:100%;height:auto}a{color:#245c40}</style><main><h1>SDK 原型布局对照</h1><p>左：此前通用排版。右：按 SDK 默认 skin 转录的尺寸和位置。全部采用 960×800 逻辑视口和中性配色。</p>${panels.map((item) => `<figure><img src="${item.file}" alt="${escape(item.name)}布局对照"><figcaption><a href="${item.id}.panel.bundle.json">${escape(item.name)} · 下载新版原型 Bundle</a></figcaption></figure>`).join("")}</main></html>`,
);
await fs.writeFile(
  path.join(output, "comparison-index.json"),
  JSON.stringify(
    {
      kind: "sdk-prototype-layout-comparison-v1",
      viewport: { width: 960, height: 800 },
      modelCalls: 0,
      panels,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    panels: panels.length,
    output: path.resolve(output),
    modelCalls: 0,
  }),
);
