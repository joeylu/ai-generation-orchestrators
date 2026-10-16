import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonical } from "../../src/common.mjs";
import {
  relayHash,
  loadRelayRequest,
  relayIdentity,
  sameRelayIdentity,
  argumentsDigest,
  exactRelay,
  readRelayJson,
  claimRelayJson,
} from "./codex-relay-contract.mjs";

const imageNames = new Set([
  "image_gen.imagegen",
  "image_gen__imagegen",
  "image_genimagegen",
  "imagegen",
]);
const argumentNames = new Set([
  "mcp__ui_reference_frozen__read_arguments",
  "mcp__ui_reference_frozen.read_arguments",
]);
const deny = () => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason:
      "Only one verified frozen image request is permitted.",
  },
});
const allow = () => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
  },
});
const stop = () => ({
  continue: false,
  stopReason: "The single image attempt has ended. Do not submit again.",
});

/** Code-mode enforcement belongs to the nested tool, not the freeform exec wrapper. */
export function relayHook(job, expected, event) {
  try {
    const request = loadRelayRequest(job, expected),
      identity = relayIdentity(request, event);
    if (event.hook_event_name === "PostToolUse") {
      if (!imageNames.has(event.tool_name)) return { continue: true };
      const pre = readRelayJson(path.join(job, "image-call.json"));
      if (
        !sameRelayIdentity(pre, request, event.session_id) ||
        pre.toolUseId !== event.tool_use_id
      )
        throw new Error();
      claimRelayJson(job, "image-post.json", identity);
      return stop();
    }
    if (event.hook_event_name !== "PreToolUse") return deny();
    if (["exec", "functions.exec"].includes(event.tool_name)) {
      const code =
        typeof event.tool_input === "string"
          ? event.tool_input
          : (event.tool_input?.code ?? event.tool_input?.input);
      if (!exactRelay(code)) return deny();
      claimRelayJson(job, "outer-call.json", {
        ...identity,
        codeSha256: relayHash(code),
      });
      return allow();
    }
    if (argumentNames.has(event.tool_name)) {
      if (canonical(event.tool_input) !== "{}") return deny();
      claimRelayJson(job, "arguments-call.json", identity);
      return allow();
    }
    if (imageNames.has(event.tool_name)) {
      const pre = readRelayJson(path.join(job, "arguments-call.json"));
      const read = readRelayJson(path.join(job, "arguments-read.json"));
      if (
        !sameRelayIdentity(pre, request, event.session_id) ||
        read.requestSha256 !== request.requestSha256 ||
        read.payloadSha256 !== expected ||
        read.argumentsSha256 !== argumentsDigest(request.arguments) ||
        canonical(event.tool_input) !== canonical(request.arguments)
      )
        return deny();
      claimRelayJson(job, "image-call.json", {
        ...identity,
        argumentsSha256: argumentsDigest(request.arguments),
        transparentBackground: request.arguments.transparent_background,
      });
      return allow();
    }
    if (["wait", "functions.wait"].includes(event.tool_name))
      return event.tool_input?.terminate !== true &&
        typeof event.tool_input?.cell_id === "string"
        ? allow()
        : deny();
    return deny();
  } catch {
    return event.hook_event_name === "PostToolUse" ? stop() : deny();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (relayHash(fs.readFileSync(process.argv[1])) !== process.argv[2])
      throw new Error();
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) throw new Error();
      chunks.push(chunk);
    }
    process.stdout.write(
      JSON.stringify(
        relayHook(
          process.argv[3],
          process.argv[4],
          JSON.parse(Buffer.concat(chunks)),
        ),
      ),
    );
  } catch {
    process.stdout.write(JSON.stringify(deny()));
  }
}
