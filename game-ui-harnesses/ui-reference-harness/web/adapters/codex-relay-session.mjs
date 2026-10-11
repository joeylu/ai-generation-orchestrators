import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  relayHash,
  exactRelay,
  argumentsDigest,
  readRelayJson,
  sameRelayIdentity,
} from "./codex-relay-contract.mjs";

export const relaySessionId = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function filesBelow(root, matches, depth = 0) {
  if (!fs.existsSync(root)) return [];
  if (depth > 8 || fs.lstatSync(root).isSymbolicLink())
    throw new Error("CODEX_RELAY_ARTIFACT_PATH_INVALID");
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error("CODEX_RELAY_ARTIFACT_PATH_INVALID");
    const file = path.join(root, entry.name);
    if (entry.isDirectory())
      found.push(...filesBelow(file, matches, depth + 1));
    else if (entry.isFile() && matches(entry.name)) found.push(file);
    if (found.length > 4096) throw new Error("CODEX_RELAY_ARTIFACT_LIMIT");
  }
  return found;
}
export function findRelayLog(home, sessionId) {
  if (!relaySessionId(sessionId))
    throw new Error("CODEX_RELAY_SESSION_INVALID");
  const files = filesBelow(path.join(home, "sessions"), (name) =>
    name.endsWith(`${sessionId}.jsonl`),
  );
  if (files.length !== 1) throw new Error("CODEX_RELAY_SESSION_LOG_AMBIGUOUS");
  return files[0];
}
export function relayOutputs(home, sessionId) {
  if (!relaySessionId(sessionId))
    throw new Error("CODEX_RELAY_SESSION_INVALID");
  const root = path.join(home, "generated_images", sessionId);
  const files = filesBelow(root, (name) => name.toLowerCase().endsWith(".png"));
  if (files.length > 16) throw new Error("CODEX_RELAY_ARTIFACT_LIMIT");
  return new Map(
    files.map((file) => {
      if (fs.statSync(file).size > 64 * 1024 * 1024)
        throw new Error("CODEX_IMAGE_RESULT_INVALID");
      return [file, relayHash(fs.readFileSync(file))];
    }),
  );
}
export function readRelayWindow(file, offset = 0) {
  const size = fs.statSync(file).size;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    size < offset ||
    size > 256 * 1024 * 1024
  )
    throw new Error("CODEX_RELAY_TRANSCRIPT_INVALID");
  const fd = fs.openSync(file, "r");
  try {
    const bytes = Buffer.alloc(size - offset);
    fs.readSync(fd, bytes, 0, bytes.length, offset);
    return bytes
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error("CODEX_RELAY_TRANSCRIPT_INVALID");
  } finally {
    fs.closeSync(fd);
  }
}
export function verifyRelayAudit(
  job,
  request,
  payloadSha256,
  sessionId,
  entries,
  selected,
) {
  const fail = () => {
    throw new Error("CODEX_RELAY_AUDIT_FAILED");
  };
  const calls = entries
    .filter((item) => item.type === "response_item")
    .map((item) => item.payload)
    .filter(
      (item) =>
        item?.type === "custom_tool_call" &&
        ["exec", "functions.exec"].includes(item.name),
    );
  if (calls.length !== 1 || !exactRelay(calls[0].input)) fail();
  if (selected) {
    const contexts = entries
      .filter((item) => item.type === "turn_context")
      .map((item) => item.payload);
    if (
      !contexts.length ||
      contexts.some(
        (item) =>
          item.model !== selected.model ||
          item.effort !== selected.effort ||
          item.approval_policy !== "never" ||
          item.sandbox_policy?.type !== "read-only",
      )
    )
      fail();
  }
  const pre = readRelayJson(path.join(job, "arguments-call.json")),
    read = readRelayJson(path.join(job, "arguments-read.json"));
  const image = readRelayJson(path.join(job, "image-call.json")),
    post = readRelayJson(path.join(job, "image-post.json"));
  if (
    ![pre, image, post].every((item) =>
      sameRelayIdentity(item, request, sessionId),
    ) ||
    read.requestSha256 !== request.requestSha256 ||
    read.payloadSha256 !== payloadSha256 ||
    read.argumentsSha256 !== argumentsDigest(request.arguments) ||
    image.argumentsSha256 !== argumentsDigest(request.arguments) ||
    image.transparentBackground !== false ||
    image.toolUseId !== post.toolUseId ||
    image.toolUseId === pre.toolUseId
  )
    fail();
  return {
    sessionId,
    observedRelayCalls: 1,
    exactRelayProgram: true,
    nestedImageGateVerified: true,
    postImageGateVerified: true,
    argumentsSha256: argumentsDigest(request.arguments),
    transparentBackground: false,
  };
}

/** No retries, shell, inherited diagnostics or raw model text in execution evidence. */
export function runRelayProcess(
  executable,
  { args, cwd, prompt, timeoutMs, onEvent },
) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "",
      failure = null,
      total = 0,
      lines = 0,
      done = false;
    const finish = (exitCode) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ exitCode, failure });
      }
    };
    const stop = (code) => {
      failure ??= code;
      child.kill();
    };
    const line = (text) => {
      if (!text.trim() || failure) return;
      if (++lines > 4096) return stop("CODEX_PROTOCOL_TOO_LARGE");
      try {
        onEvent(JSON.parse(text));
      } catch {
        stop("CODEX_PROTOCOL_INVALID");
      }
    };
    const timer = setTimeout(
      () => stop("CODEX_IMAGE_TIMEOUT_NO_RESUBMIT"),
      timeoutMs,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      total += Buffer.byteLength(chunk);
      buffer += chunk;
      if (total > 128 * 1024 * 1024 || buffer.length > 96 * 1024 * 1024)
        return stop("CODEX_PROTOCOL_TOO_LARGE");
      let at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
      }
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => {
      failure ??= "CODEX_CLI_UNAVAILABLE";
      finish(null);
    });
    child.on("close", (code) => {
      if (buffer.trim()) line(buffer);
      finish(code);
    });
    child.stdin.end(prompt);
  });
}
