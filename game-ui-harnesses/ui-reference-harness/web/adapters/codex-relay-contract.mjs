import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonical } from "../../src/common.mjs";

export const relayHash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const relayCode =
  '// @exec: {"yield_time_ms": 120000, "max_output_tokens": 1000}\n' +
  "const frozen = await tools.mcp__ui_reference_frozen__read_arguments({});\n" +
  'if (frozen.isError || !frozen.structuredContent) throw new Error("FROZEN_ARGUMENTS_UNAVAILABLE");\n' +
  "const result = await tools.image_gen__imagegen(frozen.structuredContent);\n" +
  "generatedImage(result);";
export const exactRelay = (code) =>
  typeof code === "string" && code.trim() === relayCode;
export const readRelayJson = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8"));
export const claimRelayJson = (job, file, value) =>
  fs.writeFileSync(path.join(job, file), canonical(value) + "\n", {
    flag: "wx",
  });
export const argumentsDigest = (value) => relayHash(canonical(value));

/** The command-line digest covers every byte, including ordered reference paths. */
export function loadRelayRequest(job, expected) {
  const file = path.join(job, "relay-request.json"),
    bytes = fs.readFileSync(file);
  if (bytes.length > 1024 * 1024 || relayHash(bytes) !== expected)
    throw new Error("CODEX_RELAY_REQUEST_CHANGED");
  const request = JSON.parse(bytes),
    args = request.arguments;
  if (
    request.kind !== "ui_reference_codex_relay_request_v1" ||
    !/^[a-f0-9]{64}$/.test(request.requestSha256) ||
    !/^[a-f0-9]{64}$/.test(request.attemptSha256) ||
    !args ||
    Object.keys(args).sort().join(",") !==
      "num_last_images_to_include,prompt,transparent_background" ||
    typeof args.prompt !== "string" ||
    !args.prompt ||
    typeof args.transparent_background !== "boolean" ||
    !Array.isArray(request.images) ||
    request.images.length < 1 ||
    request.images.length > 5 ||
    args.num_last_images_to_include !== request.images.length
  )
    throw new Error("CODEX_RELAY_REQUEST_INVALID");
  for (const [index, image] of request.images.entries()) {
    const expectedPath = path.join(
      path.resolve(job),
      `reference-${index + 1}.png`,
    );
    if (
      image.path !== expectedPath ||
      !/^[a-f0-9]{64}$/.test(image.sha256) ||
      fs.lstatSync(image.path).isSymbolicLink() ||
      relayHash(fs.readFileSync(image.path)) !== image.sha256
    )
      throw new Error("CODEX_REFERENCE_CHANGED");
  }
  return request;
}

export function relayIdentity(request, event) {
  if (
    typeof event.session_id !== "string" ||
    !event.session_id ||
    typeof event.tool_use_id !== "string" ||
    !event.tool_use_id
  )
    throw new Error("CODEX_RELAY_IDENTITY_MISSING");
  return {
    requestSha256: request.requestSha256,
    attemptSha256: request.attemptSha256,
    sessionId: event.session_id,
    toolUseId: event.tool_use_id,
  };
}

export function sameRelayIdentity(receipt, request, sessionId) {
  return (
    receipt.requestSha256 === request.requestSha256 &&
    receipt.attemptSha256 === request.attemptSha256 &&
    receipt.sessionId === sessionId &&
    typeof receipt.toolUseId === "string" &&
    !!receipt.toolUseId
  );
}
