import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { canonical } from "../../src/common.mjs";
import {
  loadRelayRequest,
  argumentsDigest,
  readRelayJson,
  claimRelayJson,
} from "./codex-relay-contract.mjs";

/** A data-only MCP server. It never generates, executes code or chooses files. */
export class RelayArguments {
  constructor(job, expected) {
    this.job = job;
    this.expected = expected;
    this.initialized = false;
    loadRelayRequest(job, expected);
  }
  handle(message) {
    if (message.method === "initialize")
      return {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "ui_reference_frozen", version: "1" },
      };
    if (message.method === "notifications/initialized") {
      this.initialized = true;
      return;
    }
    if (message.method === "ping") return {};
    if (!this.initialized) throw new Error("NOT_INITIALIZED");
    if (message.method === "tools/list")
      return {
        tools: [
          {
            name: "read_arguments",
            description:
              "Return the frozen image arguments once. Forward structuredContent unchanged. Never retry.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            outputSchema: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                num_last_images_to_include: { type: "integer" },
                transparent_background: { type: "boolean" },
              },
              required: [
                "prompt",
                "num_last_images_to_include",
                "transparent_background",
              ],
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
          },
        ],
      };
    if (
      message.method !== "tools/call" ||
      message.params?.name !== "read_arguments" ||
      canonical(message.params.arguments ?? {}) !== "{}"
    )
      throw new Error("TOOL_NOT_ALLOWED");
    try {
      const request = loadRelayRequest(this.job, this.expected);
      const receipt = readRelayJson(path.join(this.job, "arguments-call.json"));
      if (
        receipt.requestSha256 !== request.requestSha256 ||
        receipt.attemptSha256 !== request.attemptSha256 ||
        !receipt.sessionId ||
        !receipt.toolUseId
      )
        throw new Error();
      claimRelayJson(this.job, "arguments-read.json", {
        requestSha256: request.requestSha256,
        payloadSha256: this.expected,
        argumentsSha256: argumentsDigest(request.arguments),
      });
      return {
        content: [{ type: "text", text: canonical(request.arguments) }],
        structuredContent: request.arguments,
        isError: false,
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: "FROZEN_ARGUMENTS_UNAVAILABLE; stop without resubmission.",
          },
        ],
        isError: true,
      };
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = new RelayArguments(process.argv[2], process.argv[3]);
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let message;
    try {
      if (Buffer.byteLength(line) > 65536) throw new Error();
      message = JSON.parse(line);
      if (message.jsonrpc !== "2.0") throw new Error();
      const result = server.handle(message);
      if ("id" in message)
        process.stdout.write(
          canonical({ jsonrpc: "2.0", id: message.id, result }) + "\n",
        );
    } catch {
      if (message && "id" in message)
        process.stdout.write(
          canonical({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: "FROZEN_ARGUMENTS_UNAVAILABLE" },
          }) + "\n",
        );
    }
  }
}
