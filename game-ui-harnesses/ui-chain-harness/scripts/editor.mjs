import { parseArgs } from "node:util";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  buildEditor,
  publishEditor,
  editorStatus,
  scopedOutput,
  scopedPages,
} from "../src/editor/build.mjs";
import { previewHeaders } from "../src/editor/policy.mjs";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    browser: { type: "string", default: "chrome" },
    port: { type: "string", default: "4175" },
    scope: { type: 'string', default: 'all' },
  },
});
const command = positionals[0];
const scope = values.scope, buildOutput = scopedOutput(scope);
if (command === "status")
  console.log(JSON.stringify(await editorStatus(scope), null, 2));
else if (command === "build" || command === "check") {
  await mkdir(buildOutput, { recursive: true });
  const lockPath = join(buildOutput, ".build.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
    const candidate = await buildEditor(scope);
    let evidence = {};
    if (command === "check") {
      if (scope === 'all') {
        const { checkEditor } = await import("../tests/editor/checks.mjs");
        evidence = await checkEditor(candidate, values.browser);
      } else evidence = { report: { status: 'passed', checks: [], errors: [] }, images: {} };
      const { checkSliceEditor } = await import("../tools/panel-slicer/tests/browser/checks.mjs");
      const slicing = await checkSliceEditor(candidate, values.browser);
      const { checkLayoutExample } = await import("../tools/panel-slicer/tests/browser/layout-checks.mjs");
      const layout = await checkLayoutExample(candidate, values.browser);
      evidence.report.checks.push(...slicing.checks);
      evidence.report.checks.push(...layout.checks);
      evidence.report.errors.push(...slicing.errors);
      evidence.report.errors.push(...layout.errors);
      Object.assign(evidence.images, slicing.images);
      Object.assign(evidence.images, layout.images);
      evidence.report.status = evidence.report.checks.every(r => r.status === "passed") && !evidence.report.errors.length ? "passed" : "failed";
      if (evidence.report.status !== "passed") {
        await writeFile(
          join(candidate.dir, "report.json"),
          JSON.stringify(evidence.report, null, 2),
        );
        throw Error("Editor acceptance failed; staging candidate retained.");
      }
    }
    console.log(
      JSON.stringify(await publishEditor(candidate, evidence), null, 2),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    if (lock) {
      await lock.close();
      await unlink(lockPath);
    }
  }
} else if (command === "serve") {
  const current = await editorStatus(scope);
  const independent = scope === 'all' ? await editorStatus('slicing') : current;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid port.");
  const pages = new Map();
  if (current.status === 'current') for (const name of Object.keys(scopedPages(scope)))
    pages.set('/' + name, await readFile(join(buildOutput, 'builds', current.buildId, name)));
  if (independent.status === 'current') for (const name of Object.keys(scopedPages('slicing')))
    pages.set('/' + name, await readFile(join(scopedOutput('slicing'), 'builds', independent.buildId, name)));
  if (!pages.size) throw Error('No current preview. Run editor:check or slicing:check.');
  pages.set('/', pages.get('/index.html') ?? pages.get('/slice.html'));
  const server = createServer((req, res) => {
    if (
      !["GET", "HEAD"].includes(req.method) ||
      !pages.has(req.url) ||
      ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, previewHeaders);
    res.end(req.method === "HEAD" ? undefined : pages.get(req.url));
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Local editor: http://127.0.0.1:${port} · ${pages.has('/index.html') ? 'canvas + slicing' : 'slicing'} · ${current.status === 'current' ? current.verification : independent.verification}`,
    ),
  );
} else throw Error("Use build, check, status, or serve.");
