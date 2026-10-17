import test from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./harness.mjs";
import { runComponentChecks } from "./checks.mjs";
test("全部 16 类离线组件夹具：真实 PixiUI 交互和独立断言（不替代完整 P1）", async () => {
  const h = await startHarness();
  try {
    const results = await runComponentChecks(h, (r) =>
      console.log(`${r.id} ${r.status}${r.message ? " " + r.message : ""}`),
    );
    assert.deepEqual(
      results.filter((r) => r.status === "failed"),
      [],
    );
  } finally {
    await h.close();
  }
});
