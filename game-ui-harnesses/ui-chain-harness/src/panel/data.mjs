import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readContracts } from "../contracts/validate.mjs";
import { defaults } from "../contracts/build.mjs";
export { presetDocument } from "./presets.mjs";
const root = new URL("../../", import.meta.url);
export async function editorData() {
  const c = await readContracts(defaults);
  const read = async (f) =>
    JSON.parse(await readFile(new URL(f, root), "utf8"));
  const data = {
    registry: c.registry,
    usage: c.usage,
    template: c.template,
    profile: await read("fixtures/neutral.skin.json"),
    canvases: await read("configs/canvas-presets.json"),
    blocks: await read("configs/editor-blocks.json"),
    presets: await read("configs/panel-presets.json"),
  };
  data.binding = {
    sourceKind: "fixture",
    sha256: createHash("sha256")
      .update(
        JSON.stringify({
          registry: data.registry,
          usage: data.usage,
          template: data.template,
          profile: data.profile,
          canvases: data.canvases,
          dependencies: await read("package-lock.json"),
        }),
      )
      .digest("hex"),
  };
  return data;
}
