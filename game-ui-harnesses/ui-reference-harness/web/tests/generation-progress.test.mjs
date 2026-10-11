import test from "node:test";
import assert from "node:assert/strict";
import { generationProgress, elapsedTime } from "../src/generation-progress.js";

test("a new click starts fresh instead of inheriting the previous image stage", () => {
  const session = {
    active: false,
    turns: [{ operationId: "old", image: "/old.png", created: "2020-01-01" }],
  };
  const operation = {
    id: "new",
    startedAt: 5000,
    revision: true,
    phase: "saving",
  };
  assert.equal(generationProgress(session, null), null);
  assert.deepEqual(generationProgress(session, operation), {
    revision: true,
    stage: 0,
    label: "正在保存补充信息…",
    startedAt: 5000,
  });
  assert.equal(
    generationProgress(session, { ...operation, phase: "waiting" }).stage,
    0,
  );
});

test("reopening an active revision restores its observed stage and start time", () => {
  const session = {
    active: true,
    turns: [
      {
        operationId: "new",
        round: 2,
        status: "reserved_no_resubmit",
        created: "2026-10-11T00:00:00Z",
      },
    ],
  };
  const progress = generationProgress(session, null);
  assert.equal(progress.revision, true);
  assert.equal(progress.stage, 1);
  assert.equal(progress.label, "正在修改图片，等待返回…");
  assert.equal(progress.startedAt, Date.parse(session.turns[0].created));
  session.turns[0].status = "raw_received_needs_finish";
  assert.equal(generationProgress(session, null).stage, 2);
  session.active = false;
  assert.equal(generationProgress(session, null), null);
});

test("elapsed time handles minutes, clock skew and missing timestamps", () => {
  assert.deepEqual(elapsedTime(1000, 66000), {
    seconds: 65,
    text: "1 分 5 秒",
  });
  assert.deepEqual(elapsedTime(5000, 4000), { seconds: 0, text: "0 秒" });
  assert.equal(elapsedTime(NaN, 66000).seconds, 0);
});
