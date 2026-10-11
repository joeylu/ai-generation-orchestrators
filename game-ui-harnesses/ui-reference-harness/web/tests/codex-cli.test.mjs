import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createCodexCliAdapter } from "../adapters/codex-cli.mjs";
import { imageHook } from "../adapters/codex-image-hook.mjs";
import { syntheticImage } from "../../tests/helpers.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(
  t,
  { outcome = "completed", trusted = true, changedModel = false } = {},
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ui-reference-codex-test-"),
  );
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("ui-reference-codex-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const first = syntheticImage(960, 800),
    second = syntheticImage(320, 240);
  const input = {
    requestSha256: "f".repeat(64),
    prompt: "Frozen compiled UI prompt. 下拉框保持关闭。",
    width: 960,
    height: 800,
    resolution: { mode: "native" },
    output: { format: "png" },
    images: [
      { role: "layout", sha256: hash(first), bytes: first },
      { role: "style", sha256: hash(second), bytes: second },
    ],
  };
  const calls = [],
    commands = [],
    connections = [];
  const adapter = createCodexCliAdapter({
    workspace: root,
    command: async (args) => {
      commands.push(args);
      if (args[0] === "login")
        return { stdout: "", stderr: "Logged in using ChatGPT" };
      if (args[0] === "features")
        return {
          stdout: "image_generation stable true\nhooks stable true\n",
          stderr: "",
        };
      return {
        stdout: JSON.stringify({
          models: [
            {
              slug: "gpt-6-luna",
              supported_reasoning_levels: [{ effort: "xhigh" }],
            },
          ],
        }),
        stderr: "",
      };
    },
    rpcFactory: (args, { cwd, onNotification }) => {
      const rpc = {
        closed: false,
        args,
        initialize: async () => {},
        close() {
          this.closed = true;
        },
        async request(method, params) {
          calls.push({ method, params });
          if (method === "hooks/list")
            return {
              data: [
                {
                  errors: [],
                  hooks: ["preToolUse", "postToolUse"].map((eventName) => ({
                    eventName,
                    enabled: true,
                    source: "sessionFlags",
                    trustStatus: trusted ? "trusted" : "untrusted",
                  })),
                },
              ],
            };
          if (method === "account/read")
            return { account: { type: "chatgpt" } };
          if (method === "config/read")
            return {
              config: {
                mcp_servers: { unrelated: {} },
                plugins: { unrelated: {} },
              },
            };
          if (method === "thread/start" || method === "thread/resume")
            return {
              thread: { id: "test-thread" },
              model: changedModel ? "other" : params.model,
              reasoningEffort: "xhigh",
            };
          if (method === "turn/start") {
            if (outcome === "transport_error") {
              queueMicrotask(() =>
                onNotification({
                  method: "error",
                  params: {
                    error: {
                      message: "Bearer PRIVATE_TOKEN C:/Users/private/file.png",
                      codexErrorInfo: {
                        responseStreamConnectionFailed: { httpStatusCode: 503 },
                      },
                    },
                  },
                }),
              );
              return {};
            }
            const hook = imageHook(cwd, {
              cwd,
              hook_event_name: "PreToolUse",
              tool_name: "image_genimagegen",
              tool_use_id: "image-1",
              tool_input: {
                prompt: "Must be replaced",
                transparent_background: true,
              },
            });
            assert.equal(hook.hookSpecificOutput.permissionDecision, "allow");
            assert.equal(
              hook.hookSpecificOutput.updatedInput.prompt,
              input.prompt,
            );
            assert.equal(
              hook.hookSpecificOutput.updatedInput.transparent_background,
              false,
            );
            assert.deepEqual(
              hook.hookSpecificOutput.updatedInput.referenced_image_paths.map(
                (file) => hash(fs.readFileSync(file)),
              ),
              input.images.map((image) => image.sha256),
            );
            queueMicrotask(() => {
              onNotification({
                method: "item/started",
                params: { item: { id: "image-1", type: "imageGeneration" } },
              });
              onNotification({
                method: "item/completed",
                params: {
                  item: {
                    id: "image-1",
                    type: "imageGeneration",
                    status: outcome,
                    result:
                      outcome === "completed" ? first.toString("base64") : "",
                    transparentBackground: false,
                  },
                },
              });
              onNotification({
                method: "turn/completed",
                params: { turn: { status: "completed" } },
              });
            });
            return {};
          }
          throw new Error("UNEXPECTED_METHOD");
        },
      };
      connections.push(rpc);
      return rpc;
    },
  });
  return { root, input, adapter, calls, commands, connections };
}

test("CLI preflight is read-only and preserves the explicitly selected Luna/xhigh model", async (t) => {
  const { adapter, calls, commands, root } = fixture(t);
  assert.deepEqual(await adapter.preflight(), {
    name: "Codex CLI",
    model: "gpt-6-luna",
    effort: "xhigh",
  });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["hooks/list"],
  );
  assert.deepEqual(fs.readdirSync(root), []);
  assert.deepEqual(
    commands.map((args) => args[0]),
    ["login", "features", "debug"],
  );
});

test("one frozen CLI request preserves reference bytes/order, writes raw PNG and closes before another turn", async (t) => {
  const { adapter, input, root, calls, connections } = fixture(t);
  const bytes = await adapter.generate(input);
  assert.deepEqual(bytes, input.images[0].bytes);
  assert.deepEqual(
    fs.readFileSync(path.join(root, input.requestSha256, "result.png")),
    bytes,
  );
  assert.equal(connections.at(-1).closed, true);
  const thread = calls.find((call) => call.method === "thread/start").params;
  const turn = calls.find((call) => call.method === "turn/start").params;
  assert.equal(turn.model, "gpt-6-luna");
  assert.equal(turn.effort, "xhigh");
  assert.equal(thread.sandbox, "read-only");
  assert.equal(thread.config["mcp_servers.unrelated.enabled"], false);
  assert.equal(
    thread.config["model_providers.ui_reference_codex"].request_max_retries,
    0,
  );
  assert.equal(
    thread.config["model_providers.ui_reference_codex"].stream_max_retries,
    0,
  );
  assert.ok(
    !connections
      .at(-1)
      .args.some((arg) => /bypass|danger-full-access/.test(arg)),
  );
  await assert.rejects(
    adapter.generate(input),
    /CODEX_REQUEST_ALREADY_DISPATCHED/,
  );
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 1);
});

test("the deterministic hook refuses a second call, unrelated tools and changed references", async (t) => {
  const { adapter, input, root } = fixture(t);
  await adapter.generate(input);
  const job = path.join(root, input.requestSha256);
  const event = {
    cwd: job,
    hook_event_name: "PreToolUse",
    tool_name: "image_gen.imagegen",
    tool_use_id: "image-2",
  };
  assert.equal(
    imageHook(job, event).hookSpecificOutput.permissionDecision,
    "deny",
  );
  assert.equal(
    imageHook(job, { ...event, tool_name: "Bash" }).hookSpecificOutput
      .permissionDecision,
    "deny",
  );
  const fresh = path.join(root, "changed");
  fs.mkdirSync(fresh);
  fs.writeFileSync(
    path.join(fresh, "input.json"),
    JSON.stringify({
      requestSha256: input.requestSha256,
      prompt: input.prompt,
      images: [
        { path: path.join(fresh, "reference.png"), sha256: "0".repeat(64) },
      ],
    }),
  );
  fs.writeFileSync(path.join(fresh, "reference.png"), input.images[0].bytes);
  assert.equal(
    imageHook(fresh, event).hookSpecificOutput.permissionDecision,
    "deny",
  );
  assert.equal(fs.existsSync(path.join(fresh, "image-call.json")), false);
});

test("the CLI concatenated namespace name stops after the same single native image call", async (t) => {
  const { adapter, input, root } = fixture(t);
  await adapter.generate(input);
  const job = path.join(root, input.requestSha256);
  const claim = JSON.parse(fs.readFileSync(path.join(job, "image-call.json")));
  assert.equal(claim.toolName, "image_genimagegen");
  assert.equal(
    imageHook(job, {
      hook_event_name: "PostToolUse",
      tool_name: claim.toolName,
    }).continue,
    false,
  );
  assert.equal(
    imageHook(job, {
      hook_event_name: "PreToolUse",
      tool_name: claim.toolName,
      tool_use_id: "another-image",
    }).hookSpecificOutput.permissionDecision,
    "deny",
  );
});

test("failed native image calls are terminal and are never submitted again", async (t) => {
  const { adapter, input, calls, connections } = fixture(t, {
    outcome: "failed",
  });
  await assert.rejects(
    adapter.generate(input),
    /CODEX_IMAGE_FAILED_NO_RESUBMIT/,
  );
  await assert.rejects(
    adapter.generate(input),
    /CODEX_REQUEST_ALREADY_DISPATCHED/,
  );
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 1);
  assert.equal(connections.at(-1).closed, true);
});

test("a separately authorized immutable plan can reuse inputs without repeating an old attempt", async (t) => {
  const { adapter, input, root, calls } = fixture(t);
  const first = { ...input, attemptSha256: "a".repeat(64) };
  const second = { ...input, attemptSha256: "b".repeat(64) };
  await adapter.generate(first);
  await assert.rejects(
    adapter.generate(first),
    /CODEX_REQUEST_ALREADY_DISPATCHED/,
  );
  await adapter.generate(second);
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 2);
  assert.deepEqual(
    fs.readFileSync(path.join(root, first.attemptSha256, "result.png")),
    fs.readFileSync(path.join(root, second.attemptSha256, "result.png")),
  );
});
test("a panel session persists the CLI thread and resumes it with a fresh frozen job; other panels start separate threads", async (t) => {
  const { adapter, input, root, calls } = fixture(t);
  const sessionKey = "c".repeat(64);
  await adapter.generate({
    ...input,
    attemptSha256: "a".repeat(64),
    sessionKey,
  });
  const persisted = JSON.parse(
    fs.readFileSync(path.join(root, "sessions", `${sessionKey}.json`)),
  );
  assert.equal(persisted.status, "completed");
  assert.equal(
    calls.find((call) => call.method === "thread/start").params.ephemeral,
    false,
  );
  await adapter.generate({
    ...input,
    attemptSha256: "b".repeat(64),
    sessionKey,
  });
  const resumed = calls.find((call) => call.method === "thread/resume").params;
  assert.equal(resumed.threadId, persisted.threadId);
  assert.equal(resumed.cwd, path.join(root, "b".repeat(64)));
  assert.equal(resumed.excludeTurns, true);
  await adapter.generate({
    ...input,
    attemptSha256: "d".repeat(64),
    sessionKey: "e".repeat(64),
  });
  assert.equal(
    calls.filter((call) => call.method === "thread/start").length,
    2,
  );
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 3);
});

test("transport failure preserves bounded private stage evidence without arbitrary diagnostics or resubmission", async (t) => {
  const { adapter, input, root, calls } = fixture(t, {
    outcome: "transport_error",
  });
  await assert.rejects(adapter.generate(input), /CODEX_TURN_FAILED/);
  const log = fs.readFileSync(
    path.join(root, input.requestSha256, "execution.jsonl"),
    "utf8",
  );
  const events = log.trim().split("\n").map(JSON.parse);
  assert.ok(
    events.some(
      (event) =>
        event.event === "error" &&
        event.errorType === "responseStreamConnectionFailed" &&
        event.httpStatusCode === 503,
    ),
  );
  assert.ok(
    events.some(
      (event) => event.event === "exception" && event.phase === "image_result",
    ),
  );
  for (const value of ["PRIVATE_TOKEN", "Users", input.prompt, "base64"])
    assert.equal(log.includes(value), false);
  assert.equal(
    fs.existsSync(path.join(root, input.requestSha256, "image-call.json")),
    false,
  );
  await assert.rejects(
    adapter.generate(input),
    /CODEX_REQUEST_ALREADY_DISPATCHED/,
  );
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 1);
});

test("an indeterminate persistent CLI turn stays in its old thread; a fresh authorized attempt never resumes or repeats it", async (t) => {
  const { adapter, input, root, calls } = fixture(t, {
    outcome: "transport_error",
  });
  const sessionKey = "c".repeat(64);
  const first = { ...input, sessionKey, attemptSha256: "a".repeat(64) };
  await assert.rejects(adapter.generate(first), /CODEX_TURN_FAILED/);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(root, "sessions", `${sessionKey}.json`)),
    ).status,
    "indeterminate",
  );
  await assert.rejects(
    adapter.generate(first),
    /CODEX_REQUEST_ALREADY_DISPATCHED/,
  );
  await assert.rejects(
    adapter.generate({ ...first, attemptSha256: "b".repeat(64) }),
    /CODEX_TURN_FAILED/,
  );
  assert.equal(
    calls.filter((call) => call.method === "thread/start").length,
    2,
  );
  assert.equal(
    calls.filter((call) => call.method === "thread/resume").length,
    0,
  );
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 2);
});

for (const [name, options, error] of [
  ["unreviewed hooks", { trusted: false }, "CODEX_IMAGE_GATE_UNAVAILABLE"],
  [
    "model substitution",
    { changedModel: true },
    "CODEX_MODEL_CONFIGURATION_CHANGED",
  ],
])
  test(`${name} prevent any model turn or image call`, async (t) => {
    const { adapter, input, calls } = fixture(t, options);
    await assert.rejects(adapter.generate(input), new RegExp(error));
    assert.equal(
      calls.filter((call) => call.method === "turn/start").length,
      0,
    );
  });
