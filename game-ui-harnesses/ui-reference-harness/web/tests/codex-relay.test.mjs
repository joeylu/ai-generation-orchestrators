import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createCodexCliRelayAdapter,
  relayLaunchConfig,
  relayExecArgs,
} from "../adapters/codex-cli-relay.mjs";
import { relayHook } from "../adapters/codex-relay-hook.mjs";
import { RelayArguments } from "../adapters/codex-relay-arguments.mjs";
import {
  relayCode,
  relayHash,
  claimRelayJson,
  readRelayJson,
  loadRelayRequest,
} from "../adapters/codex-relay-contract.mjs";
import { vettedRelayHooks } from "../adapters/codex-relay-trust.mjs";
import {
  runRelayProcess,
  verifyRelayAudit,
  findRelayLog,
  readRelayWindow,
} from "../adapters/codex-relay-session.mjs";
import { syntheticImage } from "../../tests/helpers.mjs";

const permission = (value) => value.hookSpecificOutput?.permissionDecision;
const readCall = {
  method: "tools/call",
  params: { name: "read_arguments", arguments: {} },
};
const sessionId = (index) =>
  `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
function directory(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ui-reference-relay-test-"),
  );
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("ui-reference-relay-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function hookFixture(t) {
  const job = directory(t),
    image = syntheticImage(320, 240),
    file = path.join(job, "reference-1.png");
  fs.writeFileSync(file, image);
  const request = {
    kind: "ui_reference_codex_relay_request_v1",
    requestSha256: "a".repeat(64),
    attemptSha256: "b".repeat(64),
    arguments: {
      prompt: "Synthetic fixture, not a model request.",
      num_last_images_to_include: 1,
      transparent_background: false,
    },
    images: [{ path: file, sha256: relayHash(image), role: "layout" }],
  };
  claimRelayJson(job, "relay-request.json", request);
  const digest = relayHash(
    fs.readFileSync(path.join(job, "relay-request.json")),
  );
  const server = new RelayArguments(job, digest);
  server.handle({ method: "notifications/initialized" });
  const event = (name, input, id = "arguments-1") => ({
    hook_event_name: "PreToolUse",
    session_id: sessionId(1),
    tool_use_id: id,
    tool_name: name,
    tool_input: input,
  });
  const argumentEvent = event("mcp__ui_reference_frozen__read_arguments", {}),
    imageEvent = event("image_genimagegen", request.arguments, "image-1");
  const read = () => {
    assert.equal(permission(relayHook(job, digest, argumentEvent)), "allow");
    assert.deepEqual(
      server.handle(readCall).structuredContent,
      request.arguments,
    );
  };
  const entries = [
    {
      type: "response_item",
      payload: { type: "custom_tool_call", name: "exec", input: relayCode },
    },
  ];
  return {
    job,
    request,
    digest,
    image,
    file,
    server,
    event,
    argumentEvent,
    imageEvent,
    read,
    entries,
  };
}
function hooksResponse(config, trusted = true) {
  return {
    data: [
      {
        errors: [],
        hooks: [
          ["preToolUse", "hooks.PreToolUse"],
          ["postToolUse", "hooks.PostToolUse"],
        ].map(([eventName, field], index) => ({
          eventName,
          source: "sessionFlags",
          enabled: true,
          handlerType: "command",
          matcher: null,
          command:
            config[field][0].hooks[0][
              process.platform === "win32" ? "command_windows" : "command"
            ],
          key: `flags:${eventName}:0:0`,
          currentHash: `sha256:${String(index).repeat(64)}`,
          trustStatus: trusted ? "trusted" : "untrusted",
        })),
      },
    ],
  };
}

function adapterFixture(t, options = {}) {
  const root = directory(t),
    home = path.join(root, "codex-home"),
    workspace = path.join(root, "jobs");
  fs.mkdirSync(workspace);
  fs.mkdirSync(home);
  const first = syntheticImage(960, 800),
    second = syntheticImage(320, 240),
    calls = [],
    connections = [];
  let count = 0;
  const input = {
    requestSha256: "a".repeat(64),
    attemptSha256: "b".repeat(64),
    prompt: "Frozen synthetic UI prompt.",
    images: [
      { bytes: first, sha256: relayHash(first), role: "layout" },
      { bytes: second, sha256: relayHash(second), role: "style" },
    ],
  };
  const adapterOptions = {
    workspace,
    codexHome: home,
    command: async (args) => {
      calls.push({ command: args });
      if (args[0] === "login")
        return { stdout: "", stderr: "Logged in using ChatGPT" };
      if (args[0] === "features")
        return {
          stdout:
            "image_generation stable true\nhooks stable true\ncode_mode_host stable true\n",
          stderr: "",
        };
      if (args[0] === "exec")
        return {
          stdout: "--ignore-user-config --strict-config --json",
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
    rpcFactory: (args, { cwd }) => {
      const rpc = {
        args,
        cwd,
        closed: false,
        initialize: async () => {},
        close() {
          this.closed = true;
        },
        request: async (method) => {
          calls.push({ method });
          assert.equal(method, "hooks/list");
          const payload = fs.existsSync(path.join(cwd, "relay-request.json"))
            ? relayHash(fs.readFileSync(path.join(cwd, "relay-request.json")))
            : "0".repeat(64);
          const config = relayLaunchConfig(cwd, payload);
          const response = hooksResponse(
            config,
            args.some((arg) => arg.startsWith("hooks.state=")),
          );
          if (options.badTrust)
            response.data[0].hooks[0].command = "UNREVIEWED_COMMAND";
          return response;
        },
      };
      connections.push(rpc);
      return rpc;
    },
    runner: async ({ args, cwd: job, prompt, onEvent }) => {
      count++;
      calls.push({ runner: true, args, prompt, job });
      const request = readRelayJson(path.join(job, "relay-request.json")),
        digest = relayHash(
          fs.readFileSync(path.join(job, "relay-request.json")),
        );
      const resumeAt = args.indexOf("resume"),
        id = resumeAt >= 0 ? args[resumeAt + 1] : sessionId(count);
      onEvent({ type: "thread.started", thread_id: id });
      if (options.outcome === "failed") {
        onEvent({ type: "turn.failed", error: "PRIVATE_CREDENTIAL" });
        return { exitCode: 1 };
      }
      const event = (tool_name, tool_input, tool_use_id) => ({
        hook_event_name: "PreToolUse",
        session_id: id,
        tool_name,
        tool_input,
        tool_use_id,
      });
      const readEvent = event(
        "mcp__ui_reference_frozen__read_arguments",
        {},
        `arguments-${count}`,
      );
      assert.equal(permission(relayHook(job, digest, readEvent)), "allow");
      const server = new RelayArguments(job, digest);
      server.handle({ method: "notifications/initialized" });
      assert.deepEqual(
        server.handle(readCall).structuredContent,
        request.arguments,
      );
      const imageEvent = event(
        "image_genimagegen",
        request.arguments,
        `image-${count}`,
      );
      assert.equal(permission(relayHook(job, digest, imageEvent)), "allow");
      if (options.outcome !== "missing_post")
        relayHook(job, digest, {
          ...imageEvent,
          hook_event_name: "PostToolUse",
        });
      const imageDir = path.join(home, "generated_images", id);
      fs.mkdirSync(imageDir, { recursive: true });
      fs.writeFileSync(path.join(imageDir, `exec-${count}.png`), first);
      if (options.outcome === "multiple_outputs")
        fs.writeFileSync(path.join(imageDir, `extra-${count}.png`), second);
      if (options.outcome === "changed_previous" && count > 1)
        fs.writeFileSync(path.join(imageDir, "exec-1.png"), second);
      const logDir = path.join(home, "sessions", "synthetic");
      fs.mkdirSync(logDir, { recursive: true });
      const entry = {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          input:
            options.outcome === "changed_program"
              ? relayCode + "text(1);"
              : relayCode,
        },
      };
      const context = {
        type: "turn_context",
        payload: {
          model: options.outcome === "changed_model" ? "other" : "gpt-6-luna",
          effort: "xhigh",
          approval_policy: "never",
          sandbox_policy: { type: "read-only" },
        },
      };
      fs.appendFileSync(
        path.join(logDir, `rollout-${id}.jsonl`),
        JSON.stringify(context) + "\n" + JSON.stringify(entry) + "\n",
      );
      onEvent({ type: "turn.completed" });
      return { exitCode: 0 };
    },
  };
  const adapter = createCodexCliRelayAdapter(adapterOptions);
  return {
    root,
    home,
    workspace,
    input,
    adapter,
    calls,
    connections,
    options,
    adapterOptions,
  };
}

test("relay preflight is read-only and trusts only scoped fixed definitions", async (t) => {
  const f = adapterFixture(t);
  assert.deepEqual(await f.adapter.preflight(), {
    name: "Codex CLI relay",
    model: "gpt-6-luna",
    effort: "xhigh",
  });
  assert.equal(f.calls.filter((call) => call.runner).length, 0);
  assert.deepEqual(fs.readdirSync(f.workspace), []);
  assert.ok(f.connections.every((rpc) => rpc.closed));
  assert.equal(f.connections.length, 2);
  assert.ok(
    !f.connections[0].args.some((arg) => arg.startsWith("hooks.state=")),
  );
  assert.ok(
    f.connections[1].args.some((arg) => arg.startsWith("hooks.state=")),
  );
});
test("relay forwards false and ordered original bytes with complete call audit", async (t) => {
  const f = adapterFixture(t),
    bytes = await f.adapter.generate(f.input),
    job = path.join(f.workspace, f.input.attemptSha256);
  assert.ok(bytes.equals(f.input.images[0].bytes));
  const frozen = readRelayJson(path.join(job, "relay-request.json"));
  assert.equal(frozen.arguments.transparent_background, false);
  assert.equal(frozen.arguments.prompt, f.input.prompt);
  assert.deepEqual(
    frozen.images.map((image) => relayHash(fs.readFileSync(image.path))),
    f.input.images.map((image) => image.sha256),
  );
  const call = f.calls.find((call) => call.runner);
  assert.ok(call.args.includes("--ignore-user-config"));
  assert.ok(call.args.includes("read-only"));
  assert.ok(!call.args.includes("--dangerously-bypass-hook-trust"));
  assert.ok(!call.args.includes("--ephemeral"));
  assert.ok(call.prompt.endsWith(relayCode));
  const audit = readRelayJson(path.join(job, "image-call-audit.json"));
  assert.equal(audit.nestedImageGateVerified, true);
  assert.equal(audit.postImageGateVerified, true);
  assert.equal(audit.humanVisualAcceptance, false);
});
test("reserved attempt cannot dispatch twice across adapter instances", async (t) => {
  const f = adapterFixture(t);
  await f.adapter.generate(f.input);
  const restarted = createCodexCliRelayAdapter(f.adapterOptions);
  await assert.rejects(
    restarted.generate(f.input),
    /CODEX_REQUEST_ALREADY_DISPATCHED/,
  );
  assert.equal(f.calls.filter((call) => call.runner).length, 1);
});
test("another authorized plan with identical inputs may dispatch once", async (t) => {
  const f = adapterFixture(t);
  await f.adapter.generate(f.input);
  await f.adapter.generate({ ...f.input, attemptSha256: "c".repeat(64) });
  assert.equal(f.calls.filter((call) => call.runner).length, 2);
});
test("persistent session resumes four turns and audits only each new transcript window", async (t) => {
  const f = adapterFixture(t),
    sessionKey = "f".repeat(64);
  for (const key of ["b", "c", "d", "e"])
    await f.adapter.generate({
      ...f.input,
      attemptSha256: key.repeat(64),
      sessionKey,
    });
  const runs = f.calls.filter((call) => call.runner);
  assert.equal(runs.length, 4);
  assert.ok(!runs[0].args.includes("resume"));
  for (const run of runs.slice(1))
    assert.equal(run.args[run.args.indexOf("resume") + 1], sessionId(1));
  const session = readRelayJson(
    path.join(f.workspace, "relay-sessions", `${sessionKey}.json`),
  );
  assert.equal(session.status, "completed");
  assert.equal(session.threadId, sessionId(1));
  assert.equal(readRelayWindow(findRelayLog(f.home, sessionId(1))).length, 8);
});
test("unknown turn remains terminal and the next explicit plan starts a new thread", async (t) => {
  const f = adapterFixture(t, { outcome: "failed" }),
    sessionKey = "f".repeat(64),
    input = { ...f.input, sessionKey };
  await assert.rejects(
    f.adapter.generate(input),
    /CODEX_RELAY_SESSION_NOT_COMPLETED/,
  );
  assert.equal(
    readRelayJson(
      path.join(f.workspace, "relay-sessions", `${sessionKey}.json`),
    ).status,
    "indeterminate",
  );
  await assert.rejects(
    f.adapter.generate(input),
    /CODEX_REQUEST_ALREADY_DISPATCHED/,
  );
  f.options.outcome = "completed";
  await f.adapter.generate({ ...input, attemptSha256: "c".repeat(64) });
  const runs = f.calls.filter((call) => call.runner);
  assert.equal(runs.length, 2);
  assert.ok(!runs[1].args.includes("resume"));
});
for (const outcome of [
  "missing_post",
  "multiple_outputs",
  "changed_program",
  "changed_model",
])
  test(`relay retains raw output and fails without resubmission: ${outcome}`, async (t) => {
    const f = adapterFixture(t, { outcome });
    await assert.rejects(f.adapter.generate(f.input), /CODEX_/);
    const job = path.join(f.workspace, f.input.attemptSha256);
    assert.ok(
      fs
        .readFileSync(path.join(job, "original-output-1.png"))
        .equals(f.input.images[0].bytes),
    );
    assert.equal(fs.existsSync(path.join(job, "image-call-audit.json")), false);
    assert.equal(f.calls.filter((call) => call.runner).length, 1);
  });
test("a resumed turn cannot overwrite an earlier output", async (t) => {
  const f = adapterFixture(t),
    input = { ...f.input, sessionKey: "f".repeat(64) };
  await f.adapter.generate(input);
  f.options.outcome = "changed_previous";
  await assert.rejects(
    f.adapter.generate({ ...input, attemptSha256: "c".repeat(64) }),
    /CODEX_RELAY_PREVIOUS_OUTPUT_CHANGED/,
  );
});
test("unreviewed hook definition fails preflight before model dispatch", async (t) => {
  const f = adapterFixture(t, { badTrust: true });
  await assert.rejects(f.adapter.preflight(), /CODEX_RELAY_GATE_UNAVAILABLE/);
  assert.equal(f.calls.filter((call) => call.runner).length, 0);
});
test("reference fingerprint change is blocked before dispatch", async (t) => {
  const f = adapterFixture(t);
  f.input.images[0].sha256 = "0".repeat(64);
  await assert.rejects(f.adapter.generate(f.input), /CODEX_REFERENCE_CHANGED/);
  assert.equal(f.calls.filter((call) => call.runner).length, 0);
});
test("private execution evidence excludes prompts, paths, model messages and credentials", async (t) => {
  const f = adapterFixture(t, { outcome: "failed" });
  await assert.rejects(f.adapter.generate(f.input));
  const log = fs.readFileSync(
    path.join(f.workspace, f.input.attemptSha256, "execution.jsonl"),
    "utf8",
  );
  for (const secret of [f.input.prompt, f.root, "PRIVATE_CREDENTIAL", "base64"])
    assert.ok(!log.includes(secret));
  assert.ok(log.split("\n").filter(Boolean).length <= 128);
});
test("frozen argument MCP refuses an ungated read and replay after restart", (t) => {
  const f = hookFixture(t);
  assert.equal(f.server.handle(readCall).isError, true);
  f.read();
  assert.equal(f.server.handle(readCall).isError, true);
  const server = new RelayArguments(f.job, f.digest);
  server.handle({ method: "notifications/initialized" });
  assert.equal(server.handle(readCall).isError, true);
});
test("required nested image gate succeeds without an outer freeform exec hook", (t) => {
  const f = hookFixture(t);
  f.read();
  assert.equal(permission(relayHook(f.job, f.digest, f.imageEvent)), "allow");
  relayHook(f.job, f.digest, {
    ...f.imageEvent,
    hook_event_name: "PostToolUse",
  });
  assert.equal(
    verifyRelayAudit(f.job, f.request, f.digest, sessionId(1), f.entries)
      .observedRelayCalls,
    1,
  );
});
test("image gate blocks early, foreign-session, changed parameters and second calls", (t) => {
  const f = hookFixture(t);
  assert.equal(permission(relayHook(f.job, f.digest, f.imageEvent)), "deny");
  f.read();
  for (const patch of [
    { prompt: "injected" },
    { transparent_background: true },
    { extra: true },
  ])
    assert.equal(
      permission(
        relayHook(f.job, f.digest, {
          ...f.imageEvent,
          tool_input: { ...f.request.arguments, ...patch },
        }),
      ),
      "deny",
    );
  assert.equal(
    permission(
      relayHook(f.job, f.digest, { ...f.imageEvent, session_id: sessionId(2) }),
    ),
    "deny",
  );
  assert.equal(permission(relayHook(f.job, f.digest, f.imageEvent)), "allow");
  assert.equal(
    permission(
      relayHook(f.job, f.digest, { ...f.imageEvent, tool_use_id: "second" }),
    ),
    "deny",
  );
});
test("OS-level atomic image reservation permits only one competing process", async (t) => {
  const f = hookFixture(t);
  f.read();
  const script = fileURLToPath(
      new URL("../adapters/codex-relay-hook.mjs", import.meta.url),
    ),
    self = relayHash(fs.readFileSync(script));
  const run = (id) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, self, f.job, f.digest], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (bytes) => (output += bytes));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(permission(JSON.parse(output)))
          : reject(new Error("FIXTURE_FAILED")),
      );
      child.stdin.end(JSON.stringify({ ...f.imageEvent, tool_use_id: id }));
    });
  const results = await Promise.all(["image-a", "image-b", "image-c"].map(run));
  assert.equal(results.filter((value) => value === "allow").length, 1);
});
test("gate rejects shell, changed program and invalid reference or payload bytes", (t) => {
  const f = hookFixture(t);
  assert.equal(
    permission(relayHook(f.job, f.digest, f.event("Bash", {}))),
    "deny",
  );
  assert.equal(
    permission(
      relayHook(f.job, f.digest, f.event("exec", relayCode + "text(1);")),
    ),
    "deny",
  );
  fs.writeFileSync(f.file, "CHANGED");
  assert.throws(
    () => loadRelayRequest(f.job, f.digest),
    /CODEX_REFERENCE_CHANGED/,
  );
  assert.equal(permission(relayHook(f.job, f.digest, f.argumentEvent)), "deny");
});
test("self-check mismatch cannot mint a hook receipt", async (t) => {
  const f = hookFixture(t),
    script = fileURLToPath(
      new URL("../adapters/codex-relay-hook.mjs", import.meta.url),
    );
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [script, "0".repeat(64), f.job, f.digest],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (bytes) => (output += bytes));
    child.on("error", reject);
    child.on("close", () => resolve(JSON.parse(output)));
    child.stdin.end(JSON.stringify(f.argumentEvent));
  });
  assert.equal(permission(result), "deny");
  assert.equal(fs.existsSync(path.join(f.job, "arguments-call.json")), false);
});
test("post-image receipt must match the reserved call and transcript identity", (t) => {
  const f = hookFixture(t);
  f.read();
  relayHook(f.job, f.digest, f.imageEvent);
  relayHook(f.job, f.digest, {
    ...f.imageEvent,
    hook_event_name: "PostToolUse",
    tool_use_id: "foreign",
  });
  assert.throws(() =>
    verifyRelayAudit(f.job, f.request, f.digest, sessionId(1), f.entries),
  );
});
test("scoped trust rejects changed commands, extra hooks, errors and untrusted final state", () => {
  const config = relayLaunchConfig(os.tmpdir(), "0".repeat(64));
  for (const patch of [
    { command: "other" },
    { enabled: false },
    { matcher: "other" },
    { handlerType: "mcpTool" },
    { currentHash: "bad" },
  ]) {
    const result = hooksResponse(config);
    Object.assign(result.data[0].hooks[0], patch);
    assert.throws(() => vettedRelayHooks(result, config));
  }
  assert.throws(() =>
    vettedRelayHooks(hooksResponse(config, false), config, true),
  );
  const result = hooksResponse(config);
  result.data[0].hooks.push(result.data[0].hooks[0]);
  assert.throws(() => vettedRelayHooks(result, config));
});
test("launch config disables unrelated tools and freezes explicit relay transport", () => {
  const config = relayLaunchConfig(os.tmpdir(), "0".repeat(64));
  assert.equal(config["features.code_mode"], true);
  assert.equal(config["features.shell_tool"], false);
  assert.equal(config["features.plugins"], false);
  assert.equal(
    config["model_providers.ui_reference_relay"].request_max_retries,
    0,
  );
  assert.deepEqual(
    Object.keys(config).filter((key) => key.startsWith("mcp_servers.")),
    ["mcp_servers.ui_reference_frozen"],
  );
  const args = relayExecArgs(
    config,
    os.tmpdir(),
    [{ path: path.join(os.tmpdir(), "1.png") }],
    sessionId(1),
  );
  assert.equal(args[args.indexOf("resume") + 1], sessionId(1));
});
test("process transport handles final JSONL line and discards private diagnostics", async () => {
  const events = [];
  const result = await runRelayProcess(process.execPath, {
    args: [
      "-e",
      'process.stdin.resume(); process.stdin.on("end",()=>{process.stderr.write("PRIVATE");process.stdout.write(JSON.stringify({type:"turn.completed"}));});',
    ],
    cwd: os.tmpdir(),
    prompt: "synthetic stdin",
    timeoutMs: 5000,
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.failure, null);
  assert.deepEqual(events, [{ type: "turn.completed" }]);
});
test("process transport stops invalid protocol without a second process", async () => {
  const result = await runRelayProcess(process.execPath, {
    args: [
      "-e",
      'process.stdout.write("invalid\\n");setInterval(()=>{},1000);',
    ],
    cwd: os.tmpdir(),
    prompt: "",
    timeoutMs: 5000,
    onEvent: () => {},
  });
  assert.equal(result.failure, "CODEX_PROTOCOL_INVALID");
});
