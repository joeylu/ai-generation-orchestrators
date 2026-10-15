import test from "node:test";
import assert from "node:assert/strict";
import profile from "../fixtures/neutral.skin.json" with { type: "json" };
import {
  validateFixtureProfile,
  minimumSize,
  assertSize,
} from "../src/runtime/geometry.mjs";
test("工程皮肤字段严格校验；未知字段、坏颜色和无效数值在创建纹理前拒绝", () => {
  assert.doesNotThrow(() => validateFixtureProfile(profile));
  for (const mutate of [
    (p) => (p.extra = true),
    (p) => (p.geometry.lineHeight = -1),
    (p) => (p.padding = NaN),
    (p) => (p.palette.base = "bad"),
    (p) => (p.fontFamily = "Unloaded Font"),
  ]) {
    const p = structuredClone(profile);
    mutate(p);
    assert.throws(
      () => validateFixtureProfile(p),
      (e) => e.code === "fixture.profile",
    );
  }
});
test("Dialog 最小尺寸包含所有动作、标题、内容和安全区，拒绝压成负区域", () => {
  const p = { title: "标题", actions: [{}, {}] };
  assert.deepEqual(minimumSize("Dialog", p, profile), {
    width: 128,
    height: 120,
  });
  assert.doesNotThrow(() => assertSize("Dialog", p, profile, 180, 126));
  for (const [w, h] of [
    [127, 126],
    [180, 119],
    [Infinity, 126],
    [180, NaN],
  ])
    assert.throws(
      () => assertSize("Dialog", p, profile, w, h),
      (e) => e.code === "node.size",
    );
});
test("行向单选组、开关和带值滑条均保留自身几何；改 fixture 参数即可调整最小盒子", () => {
  assert.deepEqual(
    minimumSize("RadioGroup", { direction: "row", options: [{}, {}] }, profile),
    { width: 120, height: 24 },
  );
  assert.throws(
    () => assertSize("Switch", {}, profile, 79, 40),
    (e) => e.code === "node.size",
  );
  assert.throws(
    () => assertSize("Slider", { showValue: true }, profile, 180, 59),
    (e) => e.code === "node.size",
  );
  const p = structuredClone(profile);
  p.geometry.labelGap = 12;
  assert.deepEqual(minimumSize("Switch", {}, p), { width: 84, height: 24 });
});
