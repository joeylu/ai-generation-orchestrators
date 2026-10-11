import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCodexCliAdapter } from "../adapters/codex-cli.mjs";
import { resolvedStylePack } from "../style-resolution.mjs";
import { builtinPack, resolvePack } from "../../src/packs.mjs";

function baseStyle() {
  return {
    kind: "ui_reference_style_v2",
    sha256: "a".repeat(64),
    source: { pack: { sha256: "b".repeat(64) } },
    pack: resolvePack(builtinPack("chinese-fantasy")),
  };
}
function result(base) {
  return {
    render_style: {
      ...base.pack.render_style,
      color: "以明确的赛博朋克冷色配色为准。",
      lighting: "克制的青紫霓虹边光。",
    },
    ui_rules: { ...base.pack.ui_rules },
    palette: {
      background: "#101426",
      surface: "#1B2240",
      primary: "#00E5FF",
      secondary: "#F04DFF",
      text: "#F1F5FF",
    },
    negative_rules: [...base.pack.negative_rules],
    summary: "统一使用青紫霓虹配色，保留原有布局与可读性。",
  };
}
function fixture(t, outcome = "success") {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ui-style-test-"));
  t.after(() => {
    assert.equal(path.dirname(workspace), os.tmpdir());
    assert.ok(path.basename(workspace).startsWith("ui-style-test-"));
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  const calls = [],
    connections = [],
    base = baseStyle(),
    output = result(base);
  const adapter = createCodexCliAdapter({
    workspace,
    command: async () => {
      throw new Error("Image preflight must not run");
    },
    rpcFactory: (args, { onNotification }) => {
      const rpc = {
        args,
        closed: false,
        initialize: async () => {},
        close() {
          this.closed = true;
        },
        async request(method, params) {
          calls.push({ method, params });
          if (method === "account/read")
            return { account: { type: "chatgpt" } };
          if (method === "config/read")
            return {
              config: { mcp_servers: { other: {} }, plugins: { other: {} } },
            };
          if (method === "thread/start")
            return {
              thread: { id: "text-thread" },
              model: params.model,
              reasoningEffort: "xhigh",
            };
          if (method === "turn/start") {
            queueMicrotask(() => {
              if (outcome === "failure")
                return onNotification({
                  method: "error",
                  params: {
                    error: { message: "secret token C:/Users/private" },
                  },
                });
              if (outcome === "tool")
                return onNotification({
                  method: "item/started",
                  params: { item: { id: "image", type: "imageGeneration" } },
                });
              onNotification({
                method: "item/completed",
                params: {
                  threadId: "text-thread",
                  item: {
                    id: "answer",
                    type: "agentMessage",
                    phase: "final_answer",
                    text:
                      outcome === "invalid"
                        ? "not json"
                        : JSON.stringify(output),
                  },
                },
              });
              onNotification({
                method: "turn/completed",
                params: { turn: { status: "completed" } },
              });
            });
            return { turn: { id: "one-text-turn" } };
          }
          throw new Error("Unexpected method");
        },
      };
      connections.push(rpc);
      return rpc;
    },
  });
  return { adapter, workspace, calls, connections, base, output };
}

test("style preferences resolve in one ephemeral Luna/xhigh text turn with media/tools/retries disabled", async (t) => {
  const { adapter, workspace, calls, connections, base, output } = fixture(t);
  assert.deepEqual(
    await adapter.resolveStyle({ base, notes: "颜色以赛博朋克风格为主" }),
    output,
  );
  const start = calls.find((call) => call.method === "thread/start").params;
  const turn = calls.find((call) => call.method === "turn/start").params;
  assert.equal(start.ephemeral, true);
  assert.equal(start.model, "gpt-6-luna");
  assert.equal(turn.effort, "xhigh");
  assert.equal(start.config["features.image_generation"], false);
  assert.equal(start.config["features.shell_tool"], false);
  assert.equal(start.config["mcp_servers.other.enabled"], false);
  assert.equal(start.config["plugins.other.enabled"], false);
  assert.equal(
    start.config["model_providers.ui_reference_style"].request_max_retries,
    0,
  );
  assert.equal(
    start.config["model_providers.ui_reference_style"].stream_max_retries,
    0,
  );
  assert.deepEqual(start.config["hooks.PreToolUse"], []);
  assert.equal(turn.outputSchema.additionalProperties, false);
  assert.equal(turn.input.length, 1);
  assert.match(turn.input[0].text, /颜色以赛博朋克风格为主/);
  assert.equal(calls.filter((call) => call.method === "turn/start").length, 1);
  assert.ok(connections.every((rpc) => rpc.closed));
  assert.equal(fs.existsSync(path.join(workspace, "sessions")), false);
});
for (const [outcome, error] of [
  ["failure", "STYLE_RESOLUTION_FAILED"],
  ["invalid", "STYLE_RESOLUTION_INVALID"],
  ["tool", "STYLE_RESOLUTION_TOOL_FORBIDDEN"],
])
  test(`style ${outcome} fails safely without another model turn`, async (t) => {
    const { adapter, calls, connections, base } = fixture(t, outcome);
    await assert.rejects(
      adapter.resolveStyle({ base, notes: "蓝色" }),
      new RegExp(error),
    );
    assert.equal(
      calls.filter((call) => call.method === "turn/start").length,
      1,
    );
    assert.ok(connections.every((rpc) => rpc.closed));
  });

test("resolved full packs replace conflicting negatives and reject malformed, extra and unchanged output", () => {
  const base = baseStyle(),
    output = result(base);
  base.pack.negative_rules.push("禁止霓虹色。");
  const { pack, resolution } = resolvedStylePack(base, output);
  assert.ok(!pack.negative_rules.includes("禁止霓虹色。"));
  assert.equal(pack.base_style, undefined);
  assert.equal(pack.origin.sha256, base.source.pack.sha256);
  assert.ok(resolution.changes.includes("配色"));
  assert.throws(() => resolvedStylePack(base, { ...output, commands: [] }));
  assert.throws(() =>
    resolvedStylePack(base, {
      ...output,
      palette: { ...output.palette, primary: "blue" },
    }),
  );
  assert.throws(() =>
    resolvedStylePack(base, {
      ...output,
      ui_rules: { typography: "incomplete" },
    }),
  );
  const { render_style, ui_rules, palette, negative_rules } = base.pack;
  assert.throws(
    () =>
      resolvedStylePack(base, {
        render_style,
        ui_rules,
        palette: Object.fromEntries(Object.entries(palette).reverse()),
        negative_rules,
        summary: "unchanged",
      }),
    /STYLE_RESOLUTION_UNCHANGED/,
  );
});
