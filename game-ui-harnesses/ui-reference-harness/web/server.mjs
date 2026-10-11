import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStudio } from "./host.mjs";

async function start() {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];
    if (key === "--dev") {
      options.dev = true;
      continue;
    }
    if (
      ![
        "--port",
        "--workspace",
        "--sample-catalog",
        "--showcase-project",
        "--adapter",
      ].includes(key) ||
      !process.argv[index + 1] ||
      options[key]
    )
      throw new Error("STARTUP_OPTION_INVALID");
    options[key] = process.argv[++index];
  }
  const port = Number(options["--port"] ?? 4186);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error("PORT_INVALID");
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  let adapter = null;
  if (options["--adapter"])
    adapter = await import(
      pathToFileURL(path.resolve(options["--adapter"])).href
    );
  if (adapter && typeof adapter.generate !== "function")
    throw new Error("ADAPTER_INTERFACE_INVALID");
  console.log("Validating local studio inputs…");
  const studio = createStudio({
    workspace:
      options["--workspace"] ??
      path.join(repo, "work/ui-reference-studio/data"),
    sampleCatalog: options["--sample-catalog"] ?? null,
    showcaseProject: options["--showcase-project"] ?? null,
    adapter,
  });
  studio.setOrigin(`http://127.0.0.1:${port}`);
  studio.preload();
  let vite = null;
  if (options.dev) {
    const { createServer } = await import("vite");
    vite = await createServer({
      root: fileURLToPath(new URL("./", import.meta.url)),
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    studio.handler.frontend = vite.middlewares;
  }
  const server = http.createServer(studio.handler);
  server.on("error", fail);
  server.requestTimeout = 15 * 60 * 1000;
  server.listen(port, "127.0.0.1", () =>
    console.log(`UI Reference Studio: http://127.0.0.1:${port}`),
  );
  const close = () => {
    server.close();
    if (vite) void vite.close();
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
function fail(error) {
  const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(error?.message)
    ? error.message
    : error?.code === "EADDRINUSE"
      ? "PORT_ALREADY_IN_USE"
      : "STARTUP_FAILED";
  console.error(`UI Reference Studio: ${code}`);
  process.exitCode = 1;
}
start().catch(fail);
