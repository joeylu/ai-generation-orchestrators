import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { readContracts } from "../../src/contracts/validate.mjs";
import { defaults } from "../../src/contracts/build.mjs";

const root = new URL("../../", import.meta.url);
export async function startHarness({
  width = 1280,
  height = 720,
  channel = process.env.UI_CHAIN_TEST_BROWSER ?? "chrome",
  skinPack,
  pilotSkin,
  profile,
} = {}) {
  const inputs = await readContracts(defaults),
    data = {
      registry: inputs.registry,
      usage: inputs.usage,
      template: inputs.template,
      profile: JSON.parse(
        await readFile(new URL("fixtures/neutral.skin.json", root)),
      ),
      cases: JSON.parse(
        await readFile(new URL("fixtures/component-cases.json", root)),
      ),
      matrix: JSON.parse(
        await readFile(new URL("fixtures/component-matrix.json", root)),
      ),
      skinPack,
      pilotSkin,
    };
  if(profile)data.profile=profile;
  if (
    data.cases.cases.length !==
      new Set(inputs.registry.recipes.map((r) => r.type)).size ||
    new Set(data.cases.cases.map((c) => c.type)).size !==
      data.cases.cases.length ||
    data.cases.cases.some(
      (c) =>
        !inputs.registry.recipes.some(
          (r) =>
            r.type === c.type &&
            `${r.recipeId}@${r.recipeVersion}` === c.recipeRef,
        ),
    )
  )
    throw Error("Fixture case coverage differs from registry.");
  const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL("tests/runtime/browser-entry.mjs", root)),
    ],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    outdir: "virtual",
    loader: { ".woff2": "dataurl", ".woff": "dataurl" },
    logLevel: "silent",
  });
  const browser = await chromium.launch({
      channel,
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    }),
    page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => route.request().url() === 'http://127.0.0.1/skin-offline-check'
    ? route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body style="margin:0"></body>'}) : route.abort());
  await page.goto('http://127.0.0.1/skin-offline-check');
  try {
    await page.addStyleTag({
      content: bundle.outputFiles.find((f) => f.path.endsWith(".css")).text,
    });
    await page.addScriptTag({
      type: "module",
      content: bundle.outputFiles.find((f) => f.path.endsWith(".js")).text,
    });
    await page.waitForFunction(
      () => typeof window.initializeComponents === "function",
    );
    await page.evaluate(
      ({ data, width, height }) => initializeComponents(data, width, height),
      { data, width, height },
    );
  } catch (e) {
    await browser.close();
    throw e;
  }
  return {
    page,
    browser,
    errors,
    data,
    async close() {
      try {
        await page.evaluate(() => harness.dispose());
      } finally {
        await browser.close();
      }
    },
  };
}
