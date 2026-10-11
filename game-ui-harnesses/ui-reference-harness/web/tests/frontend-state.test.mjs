import test from "node:test";
import assert from "node:assert/strict";
import {
  fileJson,
  panelInputKind,
  mutateAndRefresh,
  panelStatus,
  panelActionLabel,
  request,
} from "../src/api.js";

test("prototype upload recognizes top-level format markers and rejects ambiguous or unrelated JSON", () => {
  assert.equal(
    panelInputKind({ panelSpecVersion: "0.10", id: "fixture" }),
    "spec",
  );
  assert.equal(
    panelInputKind({
      panelBundleVersion: "0.10",
      spec: { panelSpecVersion: "0.10" },
    }),
    "bundle",
  );
  for (const value of [
    null,
    [],
    "spec",
    {},
    { spec: { panelSpecVersion: "0.10" } },
    { panelSpecVersion: 10 },
    { panelBundleVersion: "0.10", panelSpecVersion: "0.10" },
  ])
    assert.throws(() => panelInputKind(value), {
      message: "PANEL_FILE_UNSUPPORTED",
    });
});

test("a failed media mutation refreshes terminal state exactly once without retrying the mutation", async () => {
  const failure = new Error("ADAPTER_INDETERMINATE_NO_RESUBMIT");
  let calls = 0,
    state = "authorized";
  await assert.rejects(
    mutateAndRefresh(
      async () => {
        calls++;
        throw failure;
      },
      async () => {
        state = "indeterminate";
      },
    ),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
  assert.equal(state, "indeterminate");
});
test("a secondary refresh failure cannot hide the original compute error or trigger another request", async () => {
  const failure = new Error("GENERATED_NOT_OPAQUE");
  let refreshes = 0;
  await assert.rejects(
    mutateAndRefresh(
      async () => {
        throw failure;
      },
      async () => {
        refreshes++;
        throw new Error("NETWORK_UNAVAILABLE");
      },
    ),
    (error) => error === failure,
  );
  assert.equal(refreshes, 1);
});
test("connection and malformed-response errors are bounded and never cause automatic resubmission", async (t) => {
  let calls = 0;
  const mock = t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("private transport details");
  });
  await assert.rejects(request("/api/local", {}), {
    message: "NETWORK_UNAVAILABLE",
  });
  assert.equal(calls, 1);
  mock.mock.mockImplementation(async () => ({
    ok: false,
    json: async () => {
      throw new Error("private HTML diagnostic");
    },
  }));
  await assert.rejects(request("/api/local"), { message: "RESPONSE_INVALID" });
});
test("missing, malformed and oversized JSON files fail clearly before a project mutation", async () => {
  await assert.rejects(fileJson(null), { message: "FILE_REQUIRED" });
  await assert.rejects(fileJson({ size: 2, text: async () => "{!" }), {
    message: "FILE_JSON_INVALID",
  });
  await assert.rejects(
    fileJson({
      size: 21 * 1024 * 1024,
      text: async () => {
        throw new Error("should not read");
      },
    }),
    { message: "UPLOAD_TOO_LARGE" },
  );
});
test("a pending or rejected latest image is not labelled as an accepted delivery version", () => {
  const pending = {
    status: "accepted_current_style",
    image: "/fixture.png",
    latestRun: { current: true, status: "pending_visual_review" },
  };
  assert.equal(panelActionLabel(pending), "验收图片");
  assert.equal(panelActionLabel(pending, true), "查看图片");
  assert.equal(
    panelActionLabel({
      ...pending,
      latestRun: { current: true, status: "indeterminate" },
    }),
    "查看详情",
  );
  assert.equal(
    panelStatus({
      status: "accepted_current_style",
      latestRun: { current: true, status: "pending_visual_review" },
    }),
    "pending_visual_review",
  );
  assert.equal(
    panelStatus({
      status: "accepted_current_style",
      latestRun: { current: true, status: "rejected_visual" },
    }),
    "rejected_visual",
  );
  assert.equal(
    panelStatus({
      status: "needs_style_update",
      latestRun: { current: false, status: "accepted" },
    }),
    "needs_style_update",
  );
});
