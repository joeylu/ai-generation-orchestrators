// Explicit synthetic UI-test host only. Never used by npm start or the real studio.
import http from "node:http";
import path from "node:path";
import { createStudio } from "../host.mjs";
import { syntheticImage } from "../../tests/helpers.mjs";

const workspace = process.argv[2];
const faultCases = process.argv.includes("--fault-cases");
const brokenRunImage = process.argv.includes("--broken-run-image");
const delayOption = process.argv.find((arg) => arg.startsWith("--delay-ms="));
const delayMs = delayOption
  ? Number(delayOption.slice("--delay-ms=".length))
  : 0;
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 120000)
  throw new Error("TEST_DELAY_INVALID");
if (!workspace) throw new Error("TEST_WORKSPACE_REQUIRED");
let calls = 0;
const studio = createStudio({
  workspace: path.resolve(workspace),
  adapter: process.argv.includes("--host-exchange")
    ? null
    : {
        resolveStyle: async ({ base, notes }) => {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (notes.includes("[test:style-failure]"))
            throw new Error("STYLE_RESOLUTION_FAILED");
          return {
            render_style: {
              ...base.pack.render_style,
              color: "统一青紫色系，以最终配色为准。",
              lighting: "克制的青紫色边光。",
            },
            ui_rules: { ...base.pack.ui_rules },
            palette: {
              background: "#101426",
              surface: "#202740",
              primary: "#00DFFF",
              secondary: "#F040FF",
              text: "#F1F4FF",
            },
            negative_rules: [...base.pack.negative_rules],
            summary: "合成测试配置：统一青紫配色，保留原型布局与文案。",
          };
        },
        generate: async (request) => {
          calls++;
          console.log(`synthetic-provider-call=${calls}`);
          if (delayMs)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (faultCases && request.prompt.includes("[test:failure]")) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            throw new Error("Synthetic failure, never a provider connection.");
          }
          if (faultCases && calls > 1 && request.resolution.mode === "native")
            return syntheticImage(request.width * 1.25, request.height * 1.25);
          return syntheticImage(request.width, request.height);
        },
      },
});
studio.setOrigin("http://127.0.0.1:4187");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4187");
  if (
    brokenRunImage &&
    req.method === "GET" &&
    url.pathname.endsWith("/image") &&
    url.searchParams.get("kind") === "run"
  ) {
    res.writeHead(503, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    });
    res.end("Synthetic image download failure.");
    return;
  }
  studio.handler(req, res);
});
server.listen(4187, "127.0.0.1", () =>
  console.log(
    `Synthetic browser fixture: http://127.0.0.1:4187 pid=${process.pid}`,
  ),
);
