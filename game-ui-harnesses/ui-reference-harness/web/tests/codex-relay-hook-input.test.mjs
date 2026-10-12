import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  relayHash,
  claimRelayJson,
  readRelayJson,
  argumentsDigest,
  relayCode,
} from "../adapters/codex-relay-contract.mjs";
import { syntheticImage } from "../../tests/helpers.mjs";
import {
  readRelayHookEvent,
  relayHookInputLimits,
} from "../adapters/codex-relay-hook.mjs";
import { verifyRelayAudit } from "../adapters/codex-relay-session.mjs";

const script = fileURLToPath(
  new URL("../adapters/codex-relay-hook.mjs", import.meta.url),
);
const sessionId = "00000000-0000-0000-0000-000000000001";
function fixture(t) {
  const job = fs.mkdtempSync(
    path.join(os.tmpdir(), "ui-reference-hook-input-"),
  );
  t.after(() => {
    assert.equal(path.dirname(job), os.tmpdir());
    assert.ok(path.basename(job).startsWith("ui-reference-hook-input-"));
    fs.rmSync(job, { recursive: true, force: true });
  });
  const image = syntheticImage(320, 240);
  const file = path.join(job, "reference-1.png");
  fs.writeFileSync(file, image);
  const request = {
    kind: "ui_reference_codex_relay_request_v1",
    requestSha256: "a".repeat(64),
    attemptSha256: "b".repeat(64),
    arguments: {
      prompt: "Synthetic Hook receipt fixture. Never submit media.",
      num_last_images_to_include: 1,
      transparent_background: false,
    },
    images: [{ path: file, sha256: relayHash(image), role: "layout" }],
  };
  claimRelayJson(job, "relay-request.json", request);
  const digest = relayHash(
    fs.readFileSync(path.join(job, "relay-request.json")),
  );
  claimRelayJson(job, "image-call.json", {
    requestSha256: request.requestSha256,
    attemptSha256: request.attemptSha256,
    sessionId,
    toolUseId: "synthetic-image-call",
    argumentsSha256: argumentsDigest(request.arguments),
    transparentBackground: false,
  });
  const event = {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    tool_use_id: "synthetic-image-call",
    tool_name: "image_genimagegen",
    tool_response: {
      content: [
        { type: "image", data: "x".repeat(Math.ceil(2.19 * 1024 * 1024)) },
      ],
    },
  };
  return { job, request, digest, event };
}
function invoke(
  f,
  input = JSON.stringify(f.event),
  selfHash = relayHash(fs.readFileSync(script)),
) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, selfHash, f.job, f.digest], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (bytes) => (stdout += bytes));
    child.stderr.on("data", (bytes) => (stderr += bytes));
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      assert.equal(code, 0);
      assert.equal(stderr, "");
      resolve(JSON.parse(stdout));
    });
    child.stdin.end(input);
  });
}

test("a real Hook process accepts a 2.19 MiB post-image reply and writes only bounded identity evidence", async (t) => {
  const f = fixture(t);
  assert.ok(Buffer.byteLength(JSON.stringify(f.event)) > 2 * 1024 * 1024);
  claimRelayJson(f.job, "arguments-call.json", {
    requestSha256: f.request.requestSha256,
    attemptSha256: f.request.attemptSha256,
    sessionId,
    toolUseId: "synthetic-arguments-call",
  });
  claimRelayJson(f.job, "arguments-read.json", {
    requestSha256: f.request.requestSha256,
    payloadSha256: f.digest,
    argumentsSha256: argumentsDigest(f.request.arguments),
  });
  const result = await invoke(f);
  assert.equal(result.continue, false);
  const receipt = fs.readFileSync(path.join(f.job, "image-post.json"));
  assert.ok(receipt.length < 1024);
  assert.deepEqual(JSON.parse(receipt), {
    requestSha256: f.request.requestSha256,
    attemptSha256: f.request.attemptSha256,
    sessionId,
    toolUseId: "synthetic-image-call",
  });
  assert.equal(fs.readdirSync(f.job).length, 6);
  assert.equal(
    readRelayJson(path.join(f.job, "image-call.json")).toolUseId,
    "synthetic-image-call",
  );
  assert.equal(
    verifyRelayAudit(f.job, f.request, f.digest, sessionId, [
      {
        type: "response_item",
        payload: { type: "custom_tool_call", name: "exec", input: relayCode },
      },
    ]).postImageGateVerified,
    true,
  );
});

test("large PreToolUse input still stops before granting an argument read", async (t) => {
  const f = fixture(t);
  const event = {
    ...f.event,
    hook_event_name: "PreToolUse",
    tool_name: "mcp__ui_reference_frozen__read_arguments",
    tool_input: {},
  };
  const result = await invoke(f, JSON.stringify(event));
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(result.continue, false);
  assert.equal(fs.existsSync(path.join(f.job, "arguments-call.json")), false);
  assert.equal(fs.existsSync(path.join(f.job, "image-post.json")), false);
});

for (const patch of [
  { session_id: "foreign-session" },
  { tool_use_id: "foreign-call" },
])
  test(`large post-image input retains identity checks: ${Object.keys(patch)[0]}`, async (t) => {
    const f = fixture(t);
    const result = await invoke(f, JSON.stringify({ ...f.event, ...patch }));
    assert.equal(result.continue, false);
    assert.equal(fs.existsSync(path.join(f.job, "image-post.json")), false);
  });

test("large reply without the original single-use image claim cannot mint a receipt", async (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.job, "image-call.json"));
  const result = await invoke(f);
  assert.equal(result.continue, false);
  assert.equal(fs.existsSync(path.join(f.job, "image-post.json")), false);
});

test("truncated large JSON fails closed and leaves no success receipt", async (t) => {
  const f = fixture(t);
  const result = await invoke(f, JSON.stringify(f.event).slice(0, -1));
  assert.equal(result.continue, false);
  assert.equal(fs.existsSync(path.join(f.job, "image-post.json")), false);
});

test("self-check mismatch on a large reply fails closed without reading or minting receipts", async (t) => {
  const f = fixture(t);
  const result = await invoke(f, JSON.stringify(f.event), "0".repeat(64));
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(result.continue, false);
  assert.equal(fs.existsSync(path.join(f.job, "image-post.json")), false);
});

test("duplicate large replies cannot replace the original post-image receipt", async (t) => {
  const f = fixture(t);
  await invoke(f);
  const receipt = fs.readFileSync(path.join(f.job, "image-post.json"));
  const result = await invoke(f);
  assert.equal(result.continue, false);
  assert.ok(
    fs.readFileSync(path.join(f.job, "image-post.json")).equals(receipt),
  );
  assert.equal(fs.readdirSync(f.job).length, 4);
});

test("changed reference bytes still block a large post-image reply", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.job, "reference-1.png"), "CHANGED");
  const result = await invoke(f);
  assert.equal(result.continue, false);
  assert.equal(fs.existsSync(path.join(f.job, "image-post.json")), false);
});

test("PreToolUse has an exact 2 MiB byte boundary even with a larger reply allowance", async () => {
  const base = { hook_event_name: "PreToolUse", padding: "" };
  const padding =
    relayHookInputLimits.pre - Buffer.byteLength(JSON.stringify(base));
  const bytes = Buffer.from(
    JSON.stringify({ ...base, padding: "x".repeat(padding) }),
  );
  assert.equal(bytes.length, 2 * 1024 * 1024);
  assert.equal(
    (await readRelayHookEvent([bytes])).hook_event_name,
    "PreToolUse",
  );
  await assert.rejects(
    readRelayHookEvent([Buffer.concat([bytes, Buffer.from(" ")])]),
    /INPUT_TOO_LARGE/,
  );
});

test("post-image input has a finite 96 MiB ceiling and stops reading when exceeded", async () => {
  const chunk = Buffer.alloc(1024 * 1024, 32);
  let reads = 0;
  async function* input() {
    for (let i = 0; i < 100; i++) {
      reads++;
      yield chunk;
    }
  }
  assert.equal(relayHookInputLimits.post, 96 * 1024 * 1024);
  await assert.rejects(readRelayHookEvent(input()), /INPUT_TOO_LARGE/);
  assert.equal(reads, 97);
});

test("split UTF-8 reply bytes parse correctly but invalid text and event types fail closed", async () => {
  const event = {
    hook_event_name: "PostToolUse",
    session_id: sessionId,
    tool_use_id: "image-1",
    tool_name: "image_genimagegen",
    tool_response: "合成图🙂",
  };
  const bytes = Buffer.from(JSON.stringify(event));
  const split = bytes.indexOf(Buffer.from("合")) + 1;
  assert.deepEqual(
    await readRelayHookEvent([bytes.subarray(0, split), bytes.subarray(split)]),
    {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      tool_use_id: "image-1",
      tool_name: "image_genimagegen",
    },
  );
  const invalid = Buffer.from(bytes);
  invalid[split - 1] = 255;
  await assert.rejects(readRelayHookEvent([invalid]));
  for (const text of ["null", "[]", "{}", '{"hook_event_name":"Unknown"}'])
    await assert.rejects(
      readRelayHookEvent([Buffer.from(text)]),
      /EVENT_INVALID/,
    );
});
