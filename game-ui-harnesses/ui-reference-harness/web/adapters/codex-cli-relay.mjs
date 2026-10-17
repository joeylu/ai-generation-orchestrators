import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { atomicJson, local } from "../../src/common.mjs";
import { CodexRpc } from "./codex-rpc.mjs";
import { codexArgs, tomlValue } from "./codex-cli.mjs";
import { createCodexStyleResolver } from "./codex-style.mjs";
import {
  relayHash,
  relayCode,
  claimRelayJson,
  readRelayJson,
  loadRelayRequest,
} from "./codex-relay-contract.mjs";
import { trustRelayHooks } from "./codex-relay-trust.mjs";
import {
  runRelayProcess,
  relaySessionId,
  findRelayLog,
  relayOutputs,
  readRelayWindow,
  verifyRelayAudit,
} from "./codex-relay-session.mjs";

const exec = promisify(execFile);
const hookPath = fileURLToPath(
  new URL("./codex-relay-hook.mjs", import.meta.url),
);
const serverPath = fileURLToPath(
  new URL("./codex-relay-arguments.mjs", import.meta.url),
);
const quoted = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const psQuoted = (value) => `'${value.replaceAll("'", "''")}'`;
const pngMagic = Buffer.from("89504e470d0a1a0a", "hex");
export function relayLaunchConfig(
  job,
  payloadSha256,
  model = "gpt-6-luna",
  effort = "xhigh",
  withArguments = true,
) {
  const parts = [
    process.execPath,
    hookPath,
    relayHash(fs.readFileSync(hookPath)),
    job,
    payloadSha256,
  ];
  const handler = {
    type: "command",
    command: parts.map(quoted).join(" "),
    command_windows: `powershell.exe -NoProfile -NonInteractive -Command "& ${parts.map(psQuoted).join(" ")}"`,
    timeout: 10,
  };
  const config = {
    model,
    model_reasoning_effort: effort,
    model_provider: "ui_reference_relay",
    approval_policy: "never",
    sandbox_mode: "read-only",
    project_doc_max_bytes: 0,
    web_search: "disabled",
    suppress_unstable_features_warning: true,
    "features.code_mode": true,
    "features.code_mode_host": true,
    "features.image_generation": true,
    "features.hooks": true,
    "features.skip_host_skill_discovery": true,
    "model_providers.ui_reference_relay": {
      name: "Codex UI reference frozen relay",
      wire_api: "responses",
      requires_openai_auth: true,
      request_max_retries: 0,
      stream_max_retries: 0,
    },
    "hooks.PreToolUse": [{ hooks: [handler] }],
    "hooks.PostToolUse": [{ hooks: [handler] }],
  };
  for (const feature of [
    "apps",
    "plugins",
    "shell_tool",
    "unified_exec",
    "multi_agent",
    "view_image",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "computer_use",
    "in_app_browser",
    "memories",
    "skill_search",
    "shell_snapshot",
    "unbounded_connection_retries",
  ])
    config[`features.${feature}`] = false;
  if (withArguments)
    config["mcp_servers.ui_reference_frozen"] = {
      command: process.execPath,
      args: [serverPath, job, payloadSha256],
      enabled: true,
      required: true,
      enabled_tools: ["read_arguments"],
    };
  return config;
}
export function relayExecArgs(config, job, images, resumeId = null) {
  return [
    "exec",
    "--strict-config",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    job,
    "--model",
    config.model,
    "--json",
    "--color",
    "never",
    ...Object.entries(config).flatMap(([key, value]) => [
      "-c",
      `${key}=${tomlValue(value)}`,
    ]),
    ...(resumeId ? ["resume", resumeId] : []),
    "--image",
    images.map((item) => item.path).join(","),
    "-",
  ];
}

/** Explicit optional transport; never an automatic fallback after a native attempt. */
export function createCodexCliRelayAdapter({
  executable = "codex",
  workspace,
  codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  model = "gpt-6-luna",
  effort = "xhigh",
  timeoutMs = 12 * 60 * 1000,
  transparentBackground = false,
  rpcFactory = (args, options) => new CodexRpc(executable, args, options),
  command = (args) =>
    exec(executable, args, {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 4e6,
    }),
  runner = (options) => runRelayProcess(executable, options),
} = {}) {
  if (typeof transparentBackground !== "boolean")
    throw new Error("CODEX_TRANSPARENCY_BOOLEAN_REQUIRED");
  const root = workspace && path.resolve(workspace),
    home = path.resolve(codexHome);
  const metadata = Object.freeze({ name: "Codex CLI relay", model, effort });
  let checkedAt = 0;
  async function preflight() {
    if (!root) throw new Error("CODEX_WORKSPACE_REQUIRED");
    if (Date.now() - checkedAt < 10000) return metadata;
    let login, features, catalog, help;
    try {
      [login, features, catalog, help] = await Promise.all([
        command(["login", "status"]),
        command(["features", "list"]),
        command(["debug", "models", "--bundled"]),
        command(["exec", "--help"]),
      ]);
    } catch {
      throw new Error("CODEX_CLI_LOGIN_OR_SETUP_REQUIRED");
    }
    if (!/Logged in using ChatGPT/.test(login.stdout + login.stderr))
      throw new Error("CODEX_CHATGPT_LOGIN_REQUIRED");
    for (const name of ["code_mode_host", "image_generation", "hooks"])
      if (!new RegExp(`^${name}\\s+\\S+\\s+true$`, "m").test(features.stdout))
        throw new Error("CODEX_RELAY_TOOLS_REQUIRED");
    for (const flag of ["--ignore-user-config", "--strict-config", "--json"])
      if (!help.stdout.includes(flag))
        throw new Error("CODEX_RELAY_CLI_UNSUPPORTED");
    let selected;
    try {
      const models = JSON.parse(catalog.stdout);
      selected = (Array.isArray(models) ? models : models.models)?.find(
        (item) => [item.slug, item.id, item.model].includes(model),
      );
    } catch {
      throw new Error("CODEX_MODEL_EFFORT_UNSUPPORTED");
    }
    if (
      !selected?.supported_reasoning_levels?.some(
        (level) => (level.effort ?? level.reasoning_effort ?? level) === effort,
      )
    )
      throw new Error("CODEX_MODEL_EFFORT_UNSUPPORTED");
    const cwd = fs.existsSync(root) ? root : path.dirname(root);
    await trustRelayHooks(
      relayLaunchConfig(cwd, "0".repeat(64), model, effort, false),
      cwd,
      rpcFactory,
      codexArgs,
    );
    checkedAt = Date.now();
    return metadata;
  }
  async function generate(input) {
    await preflight();
    if (
      !/^[a-f0-9]{64}$/.test(input.requestSha256) ||
      (input.attemptSha256 !== undefined &&
        !/^[a-f0-9]{64}$/.test(input.attemptSha256)) ||
      (input.sessionKey !== undefined &&
        !/^[a-f0-9]{64}$/.test(input.sessionKey)) ||
      typeof input.prompt !== "string" ||
      !input.prompt ||
      !Array.isArray(input.images) ||
      input.images.length < 1 ||
      input.images.length > 5
    )
      throw new Error("CODEX_INPUT_INVALID");
    fs.mkdirSync(root, { recursive: true });
    const sessionPath = input.sessionKey
      ? `relay-sessions/${input.sessionKey}.json`
      : null;
    const saved =
      sessionPath && fs.existsSync(local(root, sessionPath))
        ? readRelayJson(local(root, sessionPath))
        : null;
    if (
      saved &&
      (saved.transport !== "code-mode-relay" ||
        saved.model !== model ||
        saved.effort !== effort ||
        (saved.threadId !== null && !relaySessionId(saved.threadId)))
    )
      throw new Error("CODEX_MODEL_CONFIGURATION_CHANGED");
    const resumeId = saved?.status === "completed" ? saved.threadId : null;
    const offset = resumeId
      ? fs.statSync(findRelayLog(home, resumeId)).size
      : 0;
    const before = resumeId ? relayOutputs(home, resumeId) : new Map();
    const attemptSha256 = input.attemptSha256 ?? input.requestSha256,
      job = path.join(root, attemptSha256);
    try {
      fs.mkdirSync(job);
    } catch {
      throw new Error("CODEX_REQUEST_ALREADY_DISPATCHED");
    }
    let record = null,
      phase = "references",
      evidenceCount = 0;
    const evidence = (value) => {
      if (evidenceCount++ < 128)
        fs.appendFileSync(
          path.join(job, "execution.jsonl"),
          JSON.stringify({ at: new Date().toISOString(), phase, ...value }) +
            "\n",
        );
    };
    const stage = (value) => {
      phase = value;
      evidence({ event: "stage" });
    };
    const persist = () => {
      if (sessionPath && record) atomicJson(root, sessionPath, record);
    };
    try {
      const images = input.images.map((image, index) => {
        if (relayHash(image.bytes) !== image.sha256)
          throw new Error("CODEX_REFERENCE_CHANGED");
        const file = path.join(job, `reference-${index + 1}.png`);
        fs.writeFileSync(file, image.bytes, { flag: "wx" });
        return { path: file, sha256: image.sha256, role: image.role };
      });
      const request = {
        kind: "ui_reference_codex_relay_request_v1",
        requestSha256: input.requestSha256,
        attemptSha256,
        arguments: {
          prompt: input.prompt,
          num_last_images_to_include: images.length,
          transparent_background: transparentBackground,
        },
        images,
      };
      claimRelayJson(job, "relay-request.json", request);
      const payloadSha256 = relayHash(
        fs.readFileSync(path.join(job, "relay-request.json")),
      );
      loadRelayRequest(job, payloadSha256);
      stage("hooks/list");
      const config = await trustRelayHooks(
        relayLaunchConfig(job, payloadSha256, model, effort),
        job,
        rpcFactory,
        codexArgs,
      );
      const args = relayExecArgs(config, job, images, resumeId);
      const prompt =
        `Execute one already-authorized UI reference request ${input.requestSha256}, attempt ${attemptSha256}.\n` +
        "The current attached images are the frozen references in their supplied order. Previous session history is context only.\n" +
        `Run this code VERBATIM in functions.exec exactly once. Forward structuredContent unchanged, including transparent_background=${transparentBackground}.\n` +
        "If any required tool is missing, denied or fails, stop. No native image fallback, shell, web, API, other MCP, agents or retries.\n" +
        "If exec yields, only functions.wait on the same cell is permitted. Never submit a second image call.\n" +
        relayCode;
      record = {
        transport: "code-mode-relay",
        threadId: resumeId,
        model,
        effort,
        status: "active",
        attemptSha256,
        previousThreads: resumeId
          ? (saved.previousThreads ?? [])
          : [
              ...(saved?.previousThreads ?? []),
              ...(saved?.threadId ? [saved.threadId] : []),
            ],
      };
      persist();
      claimRelayJson(job, "dispatch.json", {
        attemptSha256,
        requestSha256: input.requestSha256,
        payloadSha256,
        model,
        effort,
        resumingSession: !!resumeId,
        automaticResubmissions: 0,
      });
      let sessionId = resumeId,
        sawThread = false,
        completed = false,
        failed = false,
        result;
      stage(resumeId ? "session/resume" : "session/start");
      try {
        result = await runner({
          args,
          cwd: job,
          prompt,
          timeoutMs,
          onEvent: (event) => {
            if (event.type === "thread.started") {
              if (
                sawThread ||
                !relaySessionId(event.thread_id) ||
                (resumeId && event.thread_id !== resumeId)
              )
                throw new Error("CODEX_RELAY_SESSION_INVALID");
              sawThread = true;
              sessionId = event.thread_id;
              record.threadId = sessionId;
              persist();
            }
            if (event.type === "turn.completed") completed = true;
            if (["turn.failed", "error"].includes(event.type)) failed = true;
            if (
              [
                "thread.started",
                "turn.started",
                "turn.completed",
                "turn.failed",
                "error",
              ].includes(event.type)
            )
              evidence({ event: event.type });
            if (
              event.type === "item.started" &&
              event.item?.type === "mcp_tool_call"
            )
              stage("image_result");
          },
        });
      } catch {
        result = { exitCode: null, failure: "CODEX_RELAY_PROCESS_FAILED" };
      }
      claimRelayJson(job, "session-result.json", {
        exitCode: result.exitCode,
        failure: result.failure ?? null,
        sessionId,
        completed,
        automaticResubmissions: 0,
      });
      const after = sessionId ? relayOutputs(home, sessionId) : new Map();
      const outputs = [...after.keys()].filter((file) => !before.has(file));
      // Retain any returned raw images even if the subsequent transcript or gate audit fails.
      for (const [index, file] of outputs.entries())
        fs.copyFileSync(
          file,
          path.join(job, `original-output-${index + 1}.png`),
          fs.constants.COPYFILE_EXCL,
        );
      if (
        result.exitCode !== 0 ||
        result.failure ||
        failed ||
        !completed ||
        !sawThread
      )
        throw new Error("CODEX_RELAY_SESSION_NOT_COMPLETED");
      if ([...before].some(([file, digest]) => after.get(file) !== digest))
        throw new Error("CODEX_RELAY_PREVIOUS_OUTPUT_CHANGED");
      if (outputs.length !== 1) throw new Error("CODEX_IMAGE_RESULT_AMBIGUOUS");
      stage("image_audit");
      const entries = readRelayWindow(findRelayLog(home, sessionId), offset);
      const audit = verifyRelayAudit(
        job,
        request,
        payloadSha256,
        sessionId,
        entries,
        { model, effort },
      );
      const bytes = fs.readFileSync(outputs[0]);
      if (!bytes.subarray(0, 8).equals(pngMagic))
        throw new Error("CODEX_IMAGE_RESULT_INVALID");
      fs.writeFileSync(path.join(job, "result.png"), bytes, { flag: "wx" });
      claimRelayJson(job, "image-call-audit.json", {
        ...audit,
        requestSha256: input.requestSha256,
        attemptSha256,
        originalSha256: relayHash(bytes),
        observedOutputCount: 1,
        humanVisualAcceptance: false,
      });
      record.status = "completed";
      persist();
      evidence({ event: "image_saved", bytes: bytes.length });
      return bytes;
    } catch (error) {
      if (record) {
        record.status = "indeterminate";
        persist();
      }
      const code = /^CODEX_[A-Z_]{1,90}$/.test(error.message)
        ? error.message
        : "CODEX_RELAY_OPERATION_FAILED";
      evidence({ event: "failed", code });
      throw new Error(code);
    }
  }
  const resolveStyle = createCodexStyleResolver({
    workspace: root,
    model,
    effort,
    rpcFactory,
    argsFor: codexArgs,
  });
  return { metadata, preflight, generate, resolveStyle };
}

const configured = createCodexCliRelayAdapter({
  executable: process.env.UI_REFERENCE_CODEX_BIN ?? "codex",
  workspace: process.env.UI_REFERENCE_CODEX_WORKSPACE,
});
export const metadata = configured.metadata;
export const preflight = configured.preflight;
export const generate = configured.generate;
export const resolveStyle = configured.resolveStyle;
